"""mover: every mutation is guarded, logged before acting, and reversible."""
import os
from pathlib import Path

import aiosqlite
import pytest

import backend.config as _config
from backend import mover, operations_log as ol
from backend.config import OutOfSandboxError


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _mk(sandbox, rel, content="x"):
    p = sandbox / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


# ---- names / helpers -------------------------------------------------------

@pytest.mark.parametrize("bad", ["", "a/b", "a\\b", "con", "NUL", "COM1", "x.", "x ", "a:b", "a?b", ".", "..", "a\x00b"])
def test_validate_name_rejects(bad):
    with pytest.raises(mover.InvalidNameError):
        mover.validate_name(bad)


@pytest.mark.parametrize("ok", ["a.txt", "Résumé (final).docx", "no-ext", "con.txt", ".hidden"])
def test_validate_name_accepts(ok):
    mover.validate_name(ok)


def test_keep_both_name(sandbox):
    _mk(sandbox, "r.txt"); _mk(sandbox, "r (2).txt")
    assert mover.keep_both_name(sandbox / "r.txt").name == "r (3).txt"
    assert mover.keep_both_name(sandbox / "fresh.txt").name == "fresh.txt"


def test_trash_root_inside_sandbox(sandbox):
    assert mover.trash_root_for(sandbox / "deep" / "f.txt") == sandbox / _config.TRASH_DIRNAME


def test_trash_root_outside_sandbox_is_volume_root(sandbox, tmp_path):
    outside = tmp_path / "o" / "f.txt"
    drive = Path(os.path.splitdrive(str(outside.resolve()))[0] + "\\")
    assert mover.trash_root_for(outside) == drive / _config.TRASH_DIRNAME


# ---- move ------------------------------------------------------------------

async def test_move_logs_before_and_marks_after(conn, sandbox):
    src = _mk(sandbox, "a/one.txt", "1")
    dest_dir = sandbox / "b"; dest_dir.mkdir()
    r = await mover.move(conn, src, dest_dir)
    assert r["status"] == "done"
    assert not src.exists() and (dest_dir / "one.txt").read_text() == "1"
    row = await ol.get_operation(conn, r["op_id"])
    assert row["op_type"] == "move" and row["executed"] == 1
    assert row["source_path"] == str(src.resolve()) and row["dest_path"] == str((dest_dir / "one.txt").resolve())


async def test_move_directory(conn, sandbox):
    _mk(sandbox, "src/dir/inner.txt")
    (sandbox / "dst").mkdir()
    r = await mover.move(conn, sandbox / "src" / "dir", sandbox / "dst")
    assert r["status"] == "done" and (sandbox / "dst" / "dir" / "inner.txt").exists()


async def test_move_conflict_policies(conn, sandbox):
    _mk(sandbox, "a/f.txt", "new"); _mk(sandbox, "b/f.txt", "old")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b")  # fail
    assert r["status"] == "conflict" and (sandbox / "a/f.txt").exists()
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="skip")
    assert r["status"] == "skipped"
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="keep-both")
    assert r["status"] == "done" and (sandbox / "b" / "f (2).txt").read_text() == "new"
    _mk(sandbox, "a/f.txt", "newer")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="replace")
    assert r["status"] == "done" and (sandbox / "b/f.txt").read_text() == "newer"
    # the replaced file was trashed (logged), not deleted
    trashed = list((sandbox / _config.TRASH_DIRNAME).rglob("f.txt"))
    assert len(trashed) == 1 and trashed[0].read_text() == "old"


async def test_move_into_self_refused(conn, sandbox):
    _mk(sandbox, "d/x.txt")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "d", sandbox / "d")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "d", sandbox / "d" / "sub")


async def test_move_outside_sandbox_refused_and_not_logged(conn, sandbox, tmp_path):
    src = _mk(sandbox, "z.txt")
    outside = tmp_path / "out"; outside.mkdir()
    with pytest.raises(OutOfSandboxError):
        await mover.move(conn, src, outside)
    assert src.exists() and await ol.list_operations(conn) == []


async def test_cross_volume_move_copies_verifies_removes(conn, sandbox, monkeypatch):
    src = _mk(sandbox, "big.bin", "payload" * 1000)
    dest_dir = sandbox / "elsewhere"; dest_dir.mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    r = await mover.move(conn, src, dest_dir)
    assert r["status"] == "done" and not src.exists()
    assert (dest_dir / "big.bin").read_text() == "payload" * 1000


async def test_disk_space_refusal(conn, sandbox, monkeypatch):
    src = _mk(sandbox, "s.txt", "abc")
    (sandbox / "t").mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    monkeypatch.setattr(mover, "_free_bytes", lambda p: 0)
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, src, sandbox / "t")
    assert src.exists()


# ---- rename / mkdir / touch / copy ----------------------------------------

async def test_rename(conn, sandbox):
    p = _mk(sandbox, "old.txt")
    r = await mover.rename(conn, p, "new.txt")
    assert r["status"] == "done" and (sandbox / "new.txt").exists() and not p.exists()
    with pytest.raises(mover.InvalidNameError):
        await mover.rename(conn, sandbox / "new.txt", "bad/name")
    _mk(sandbox, "taken.txt")
    with pytest.raises(mover.ConflictError):
        await mover.rename(conn, sandbox / "new.txt", "taken.txt")


async def test_mkdir_and_touch(conn, sandbox):
    r = await mover.mkdir(conn, sandbox, "Folder")
    assert (sandbox / "Folder").is_dir() and r["op_type"] == "mkdir"
    r = await mover.touch(conn, sandbox / "Folder", "note.txt")
    assert (sandbox / "Folder" / "note.txt").stat().st_size == 0 and r["op_type"] == "touch"
    with pytest.raises(mover.ConflictError):
        await mover.mkdir(conn, sandbox, "Folder")


async def test_copy_file_and_dir(conn, sandbox):
    _mk(sandbox, "c/a.txt", "A"); _mk(sandbox, "c/sub/b.txt", "B")
    (sandbox / "out").mkdir()
    r = await mover.copy(conn, sandbox / "c" / "a.txt", sandbox / "out")
    assert r["status"] == "done" and (sandbox / "out/a.txt").read_text() == "A" and (sandbox / "c/a.txt").exists()
    r = await mover.copy(conn, sandbox / "c", sandbox / "out")
    assert (sandbox / "out/c/sub/b.txt").read_text() == "B"


# ---- trash / restore / empty ----------------------------------------------

async def test_trash_and_restore(conn, sandbox):
    p = _mk(sandbox, "docs/t.txt", "T")
    r = await mover.trash(conn, p)
    assert r["status"] == "done" and not p.exists()
    trashed = Path(r["dest"])
    assert trashed.exists() and _config.TRASH_DIRNAME in trashed.parts
    assert (trashed.parent / "manifest.json").exists()
    r2 = await mover.restore(conn, trashed, p)
    assert r2["status"] == "done" and p.read_text() == "T" and not trashed.exists()


async def test_restore_conflict_keeps_both(conn, sandbox):
    p = _mk(sandbox, "k.txt", "first")
    r = await mover.trash(conn, p)
    _mk(sandbox, "k.txt", "second")
    r2 = await mover.restore(conn, Path(r["dest"]), p)
    assert r2["status"] == "done" and (sandbox / "k (2).txt").read_text() == "first"


async def test_batch_trash_and_empty(conn, sandbox, monkeypatch):
    a = _mk(sandbox, "e1.txt"); b = _mk(sandbox, "e2.txt")
    res = await mover.batch_trash(conn, [a, b])
    assert len(res["ops"]) == 2 and res["batch_id"]
    sent = []
    monkeypatch.setattr(mover, "_send2trash", lambda p: sent.append(Path(p)))
    out = await mover.empty_trash(conn)
    assert out["batches"] == 1 and len(sent) == 1 and sent[0].name == res["batch_id"]
    rows = await ol.list_operations(conn)
    assert rows[0]["op_type"] == "trash-empty:final"


async def test_trash_root_is_hidden(conn, sandbox):
    p = _mk(sandbox, "h.txt")
    await mover.trash(conn, p)
    attrs = (sandbox / _config.TRASH_DIRNAME).stat().st_file_attributes
    assert attrs & 0x2
