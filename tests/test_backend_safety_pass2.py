"""Pass-2 backend-safety regressions (confirmed-findings #43-47, #134-140).

One test file for the whole dimension: each block names the finding it pins
down. Everything here runs against the real sandbox fixture -- no mocks of the
filesystem -- because every one of these defects was about what actually
happened on disk.
"""
import asyncio
import base64
import json
import os
import subprocess
from pathlib import Path

import aiosqlite
import pytest

import backend.config as _config
from backend import mover, operations_log as ol, stores, tagger, winshell


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _mk(sandbox, rel, content="x"):
    p = sandbox / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def _make_junction(link: Path, target: Path) -> bool:
    """mklink /J via cmd. Returns False (and the test skips) if it's refused."""
    if os.name != "nt":
        return False
    r = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)],
                       capture_output=True, text=True)
    return r.returncode == 0 and link.exists()


# ---------------------------------------------------------------------------
# #43 -- a user file named manifest.json must survive being trashed.
# ---------------------------------------------------------------------------

async def test_trashing_a_file_named_manifest_json_keeps_its_content(conn, sandbox):
    p = _mk(sandbox, "manifest.json", '{"items": ["my important data"]}')
    r = await mover.trash(conn, p)
    assert r["status"] == "done"
    trashed = Path(r["dest"])
    assert json.loads(trashed.read_text(encoding="utf-8")) == {"items": ["my important data"]}


async def test_trashing_a_non_json_file_named_manifest_json_succeeds(conn, sandbox):
    p = _mk(sandbox, "manifest.json", "not json at all")
    r = await mover.trash(conn, p)
    assert r["status"] == "done" and not p.exists()
    assert Path(r["dest"]).read_text(encoding="utf-8") == "not json at all"
    row = await ol.get_operation(conn, r["op_id"])
    assert row["executed"] == 1 and row["error"] is None  # so it is undoable
    undone = await mover.undo_operation(conn, r["op_id"])
    assert undone["status"] == "done" and p.read_text(encoding="utf-8") == "not json at all"


async def test_batch_trash_of_a_manifest_json_does_not_abort_the_batch(conn, sandbox):
    a = _mk(sandbox, "manifest.json", "not json at all")
    b = _mk(sandbox, "other.txt", "b")
    res = await mover.batch_trash(conn, [a, b])
    assert res["errors"] == [] and len(res["ops"]) == 2
    assert not a.exists() and not b.exists()


async def test_manifest_records_the_batch_beside_the_batch_folder(conn, sandbox):
    p = _mk(sandbox, "note.txt", "n")
    r = await mover.trash(conn, p)
    root = mover.trash_root_for(p)
    mf = mover.manifest_path_for(root, r["batch_id"])
    items = json.loads(mf.read_text(encoding="utf-8"))["items"]
    assert [i["original"] for i in items] == [str(p)]


async def test_a_failing_manifest_write_never_fails_a_completed_trash(conn, sandbox, monkeypatch):
    def boom(*_a, **_k):
        raise OSError("disk full")
    monkeypatch.setattr(mover, "_append_manifest", boom)
    p = _mk(sandbox, "keepme.txt", "k")
    r = await mover.trash(conn, p)
    assert r["status"] == "done" and not p.exists() and Path(r["dest"]).exists()
    row = await ol.get_operation(conn, r["op_id"])
    assert row["executed"] == 1 and row["error"] is None


# ---------------------------------------------------------------------------
# #44 -- a junction is trashed/moved/renamed as the link, never as its target.
# ---------------------------------------------------------------------------

@pytest.fixture
def junction(sandbox):
    target = sandbox / "RealData"
    target.mkdir()
    (target / "important.txt").write_text("important", encoding="utf-8")
    link = sandbox / "ShortcutToRealData"
    if not _make_junction(link, target):
        pytest.skip("creating a directory junction is not permitted in this environment")
    return link, target


async def test_trash_removes_the_junction_not_its_target(conn, sandbox, junction):
    link, target = junction
    r = await mover.trash(conn, link)
    assert r["status"] == "done"
    assert Path(r["src"]) == link
    assert not link.exists() and not os.path.lexists(str(link))
    assert target.is_dir() and (target / "important.txt").read_text(encoding="utf-8") == "important"


async def test_rename_renames_the_junction_not_its_target(conn, sandbox, junction):
    link, target = junction
    r = await mover.rename(conn, link, "RenamedLink")
    assert r["status"] == "done"
    assert (sandbox / "RenamedLink").exists() and target.is_dir()
    assert _config.is_reparse_point(sandbox / "RenamedLink")
    assert target.name == "RealData" and (target / "important.txt").exists()


async def test_move_moves_the_junction_not_its_target(conn, sandbox, junction):
    link, target = junction
    dest = sandbox / "elsewhere"
    dest.mkdir()
    r = await mover.move(conn, link, dest)
    assert r["status"] == "done"
    assert _config.is_reparse_point(dest / link.name)
    assert target.is_dir() and (target / "important.txt").exists()


async def test_a_dangling_junction_can_still_be_trashed(conn, sandbox, junction):
    link, target = junction
    (target / "important.txt").unlink()
    target.rmdir()  # the junction now points at nothing
    r = await mover.trash(conn, link)
    assert r["status"] == "done" and not os.path.lexists(str(link))


def test_guard_operand_still_returns_the_resolved_path_for_ordinary_paths(sandbox):
    p = sandbox / "plain.txt"
    p.write_text("p", encoding="utf-8")
    assert _config.guard_operand(p, "write") == _config.path_guard(p, "write")


def test_guard_operand_refuses_a_junction_outside_the_sandbox(sandbox, tmp_path):
    """The link's own location has to pass containment, not just its target's."""
    outside = tmp_path / "outside"
    outside.mkdir()
    link = outside / "link-into-sandbox"
    if not _make_junction(link, sandbox):
        pytest.skip("creating a directory junction is not permitted in this environment")
    with pytest.raises(_config.OutOfSandboxError):
        _config.guard_operand(link, "write")


# ---------------------------------------------------------------------------
# #134 -- copy into the source's own folder must refuse, never trash the source.
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("policy", ["fail", "replace", "keep-both", "skip"])
async def test_copy_into_the_sources_own_folder_is_refused(conn, sandbox, policy):
    p = _mk(sandbox, "a.txt", "A")
    with pytest.raises(mover.RefusedError, match="already in the destination folder"):
        await mover.copy(conn, p, sandbox, on_conflict=policy)
    assert p.read_text(encoding="utf-8") == "A"
    assert not (sandbox / _config.TRASH_DIRNAME).exists()
    assert await ol.list_operations(conn) == []


async def test_batch_copy_into_the_same_folder_reports_an_error_and_keeps_the_file(conn, sandbox):
    p = _mk(sandbox, "a.txt", "A")
    res = await mover.batch_copy(conn, [p], sandbox, on_conflict="replace")
    assert res["ops"] == [] and len(res["errors"]) == 1
    assert "already in the destination folder" in res["errors"][0]["error"]
    assert p.read_text(encoding="utf-8") == "A"


async def test_copy_into_a_different_folder_still_works(conn, sandbox):
    p = _mk(sandbox, "a.txt", "A")
    dest = sandbox / "dest"
    dest.mkdir()
    r = await mover.copy(conn, p, dest)
    assert r["status"] == "done" and (dest / "a.txt").read_text(encoding="utf-8") == "A" and p.exists()


# ---------------------------------------------------------------------------
# #46 -- reconciliation of a crashed attr-set / folder-type-set row.
# ---------------------------------------------------------------------------

async def test_reconcile_marks_a_landed_attr_set_completed(conn, sandbox):
    folder = sandbox / "attrfolder"
    folder.mkdir()
    before = winshell.get_attributes(folder)["bits"]
    after = before | winshell.FILE_ATTRIBUTE_READONLY
    winshell.set_attributes(folder, after)  # the write landed...
    op_id = await ol.log_operation(conn, "attr-set", str(folder), None,
                                   reason=json.dumps({"before": before, "after": after}))
    # ...and the process died before mark_executed.
    out = await ol.reconcile_pending(conn)
    assert [r["resolution"] for r in out] == ["completed"]
    row = await ol.get_operation(conn, op_id)
    assert row["executed"] == 1 and row["error"] is None
    undone = await mover.undo_operation(conn, op_id)  # and it is undoable again
    assert undone["status"] == "done"
    assert winshell.get_attributes(folder)["bits"] & winshell.FILE_ATTRIBUTE_READONLY == 0


async def test_reconcile_marks_an_unstarted_attr_set_not_started(conn, sandbox):
    folder = sandbox / "attrfolder2"
    folder.mkdir()
    before = winshell.get_attributes(folder)["bits"]
    after = before | winshell.FILE_ATTRIBUTE_READONLY
    op_id = await ol.log_operation(conn, "attr-set", str(folder), None,
                                   reason=json.dumps({"before": before, "after": after}))
    out = await ol.reconcile_pending(conn)
    assert [r["resolution"] for r in out] == ["not-started"]
    row = await ol.get_operation(conn, op_id)
    assert row["executed"] == 0 and row["error"] == "not-started"


async def test_reconcile_marks_a_landed_folder_type_set_completed(conn, sandbox):
    folder = sandbox / "typed"
    folder.mkdir()
    bits_before = winshell.get_attributes(folder)["bits"]
    winshell.write_folder_type(folder, "Pictures")  # the write landed
    op_id = await ol.log_operation(conn, "folder-type-set", str(folder), None,
                                   reason=json.dumps({"before_ini": None,
                                                      "folder_bits_before": bits_before,
                                                      "after": "Pictures"}))
    out = await ol.reconcile_pending(conn)
    assert [r["resolution"] for r in out] == ["completed"]
    row = await ol.get_operation(conn, op_id)
    assert row["executed"] == 1 and row["error"] is None


async def test_reconcile_still_classifies_a_move_by_its_paths(conn, sandbox):
    """The generic src/dst heuristic is untouched for op types that have both."""
    src, dst = sandbox / "gone.txt", _mk(sandbox, "arrived.txt", "a")
    op_id = await ol.log_operation(conn, "move", str(src), str(dst))
    out = await ol.reconcile_pending(conn)
    assert [r["resolution"] for r in out] == ["completed"]
    assert (await ol.get_operation(conn, op_id))["executed"] == 1


# ---------------------------------------------------------------------------
# #135 / #136 -- folder-type-set undo: a zero-byte desktop.ini is restored,
# and a desktop.ini FilePlus created is trashed, never hard-deleted.
# ---------------------------------------------------------------------------

async def test_undo_restores_a_preexisting_zero_byte_desktop_ini(conn, sandbox):
    folder = sandbox / "zerobyte"
    folder.mkdir()
    ini = folder / "desktop.ini"
    ini.write_bytes(b"")
    op = await mover.set_folder_type(conn, folder, "Pictures", batch_id=ol.new_batch_id())
    reason = json.loads((await ol.get_operation(conn, op["op_id"]))["reason"])
    assert reason["before_ini"] == ""  # the encode side already recorded "existed, empty"
    r = await mover.undo_operation(conn, op["op_id"])
    assert r["status"] == "done"
    assert ini.exists() and ini.read_bytes() == b""


async def test_undo_trashes_a_desktop_ini_fileplus_created(conn, sandbox):
    folder = sandbox / "created"
    folder.mkdir()
    op = await mover.set_folder_type(conn, folder, "Pictures", batch_id=ol.new_batch_id())
    ini = folder / "desktop.ini"
    assert ini.exists()
    r = await mover.undo_operation(conn, op["op_id"])
    assert r["status"] == "done" and not ini.exists()
    # Not hard-deleted: a logged trash row put it in .FilePlusTrash.
    rows = await ol.list_operations(conn)
    trashed = [row for row in rows if row["op_type"] == "trash" and row["executed"]]
    assert len(trashed) == 1
    dest = Path(trashed[0]["dest_path"])
    assert dest.exists() and dest.name == "desktop.ini"
    assert _config.TRASH_DIRNAME in dest.parts


# ---------------------------------------------------------------------------
# #137 -- POST /scan enforces the same protected-root rule as POST /index.
# ---------------------------------------------------------------------------

def test_scan_refuses_a_protected_root(sandbox, db, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from backend.api import app

    protected = tmp_path / "FakeWindows"
    protected.mkdir()
    monkeypatch.setattr(_config, "SYSTEM_WRITE_ROOTS", [protected])
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [protected])
    with TestClient(app) as client:
        r = client.post("/scan", json={"path": str(protected), "hash": False})
        assert r.status_code == 403
        roots = client.get("/index/status").json()["roots"]
        assert all(row["root"] != str(protected) for row in roots)


def test_scan_of_the_sandbox_still_works(sandbox, db):
    from fastapi.testclient import TestClient
    from backend.api import app

    (sandbox / "s.txt").write_text("s", encoding="utf-8")
    with TestClient(app) as client:
        r = client.post("/scan", json={"path": str(sandbox), "hash": False})
        assert r.status_code == 200 and r.json()["count"] == 1


# ---------------------------------------------------------------------------
# #138 -- a remove that removed nothing logs nothing (so it can't be "undone").
# ---------------------------------------------------------------------------

async def test_removing_a_favorite_that_is_not_there_logs_nothing(conn, sandbox):
    removed = await stores.favorites_remove(conn, str(sandbox / "never-favorited.txt"))
    assert removed is False
    assert await ol.list_operations(conn) == []


async def test_removing_a_real_favorite_still_logs(conn, sandbox):
    p = str(_mk(sandbox, "f.txt"))
    await stores.favorites_add(conn, p)
    assert await stores.favorites_remove(conn, p) is True
    types = [r["op_type"] for r in await ol.list_operations(conn)]
    assert types == ["favorite-remove", "favorite-add"]


async def test_removing_a_tag_the_file_does_not_have_logs_nothing(conn, sandbox):
    p = _mk(sandbox, "t.txt")
    from backend.indexer import index_file
    file_id = await index_file(p, conn)
    await conn.commit()
    tag_ids = await tagger.apply_tags(conn, file_id, ["work"])
    await tagger.remove_tag(conn, file_id, tag_ids[0])
    before = len(await ol.list_operations(conn))
    assert await tagger.remove_tag(conn, file_id, tag_ids[0]) is None
    assert len(await ol.list_operations(conn)) == before


# ---------------------------------------------------------------------------
# #139 -- concurrent trash requests must not race on creating .FilePlusTrash.
# ---------------------------------------------------------------------------

async def test_concurrent_trash_requests_share_one_trash_root(conn, sandbox):
    paths = [_mk(sandbox, f"c{i}.txt", str(i)) for i in range(6)]
    assert not (sandbox / _config.TRASH_DIRNAME).exists()
    results = await asyncio.gather(*(mover.trash(conn, p) for p in paths),
                                   return_exceptions=True)
    assert all(not isinstance(r, Exception) for r in results), results
    assert all(r["status"] == "done" for r in results)
    assert all(not p.exists() for p in paths)


# ---------------------------------------------------------------------------
# #140 -- MAX_BATCH_SIZE is a real ceiling.
# ---------------------------------------------------------------------------

async def test_batch_over_max_batch_size_is_refused_before_anything_moves(conn, sandbox, monkeypatch):
    monkeypatch.setattr(_config, "MAX_BATCH_SIZE", 2)
    paths = [_mk(sandbox, f"m{i}.txt") for i in range(3)]
    with pytest.raises(mover.RefusedError, match="MAX_BATCH_SIZE"):
        await mover.batch_trash(conn, paths)
    assert all(p.exists() for p in paths)
    assert await ol.list_operations(conn) == []


async def test_batch_at_max_batch_size_is_allowed(conn, sandbox, monkeypatch):
    monkeypatch.setattr(_config, "MAX_BATCH_SIZE", 2)
    paths = [_mk(sandbox, f"n{i}.txt") for i in range(2)]
    res = await mover.batch_trash(conn, paths)
    assert len(res["ops"]) == 2 and res["errors"] == []


def test_oversized_batch_is_a_409_not_a_500(sandbox, db, monkeypatch):
    from fastapi.testclient import TestClient
    from backend.api import app

    monkeypatch.setattr(_config, "MAX_BATCH_SIZE", 1)
    a = sandbox / "x1.txt"; a.write_text("1", encoding="utf-8")
    b = sandbox / "x2.txt"; b.write_text("2", encoding="utf-8")
    with TestClient(app) as client:
        r = client.post("/fs/trash", json={"paths": [str(a), str(b)]})
        assert r.status_code == 409 and "MAX_BATCH_SIZE" in r.json()["detail"]
    assert a.exists() and b.exists()


# ---------------------------------------------------------------------------
# #47 -- GET /file must not hash on the event loop.
# ---------------------------------------------------------------------------

async def test_index_file_hashes_off_the_event_loop(conn, sandbox, monkeypatch):
    """hash_file runs in a worker thread, so the loop stays responsive."""
    p = _mk(sandbox, "big.bin", "0123456789")
    from backend import indexer

    seen = {}

    def slow_hash(path):
        seen["thread"] = __import__("threading").current_thread().name
        return "deadbeef"

    monkeypatch.setattr(indexer, "hash_file", slow_hash)
    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            await asyncio.sleep(0)
            ticks += 1

    t = asyncio.create_task(ticker())
    await indexer.index_file(p, conn, hash=True)
    t.cancel()
    assert seen["thread"] != "MainThread"
    assert ticks > 0  # the loop kept running while the hash was computed
