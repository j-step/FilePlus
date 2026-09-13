"""Stage 2C Task 3: properties, attributes, and folder-type — the two new
logged/undoable mutations (attr-set, folder-type-set) in backend.mover, and
the GET /fs/properties[/details] + POST /fs/attributes + POST /fs/folder-type
routes in backend.api. backend.winshell's own unit tests live in
tests/test_winshell.py; this file covers the mover protocol (guard -> log ->
act -> mark, plus undo/redo) and the HTTP surface built on top of it.
"""
import json

import aiosqlite
import pytest
from fastapi.testclient import TestClient

import backend.config as _config
from backend import mover, operations_log as ol, winshell


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def _mk(sandbox, rel, content="x"):
    p = sandbox / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


async def _only(conn, op_type):
    rows = [r for r in await ol.list_operations(conn) if r["op_type"] == op_type]
    assert len(rows) == 1, f"expected exactly one {op_type!r} row, found {len(rows)}"
    return rows[0]


# ---------------------------------------------------------------------------
# backend.mover.set_attributes / attr-set undo+redo
# ---------------------------------------------------------------------------

async def test_set_attributes_logs_and_applies(conn, sandbox):
    p = _mk(sandbox, "a.txt")
    op = await mover.set_attributes(conn, p, read_only=True, hidden=None, archive=None, batch_id=ol.new_batch_id())

    assert op["op_type"] == "attr-set" and op["status"] == "done"
    assert winshell.get_attributes(p)["read_only"] is True
    row = await _only(conn, "attr-set")
    assert row["executed"] == 1 and row["error"] is None
    reason = json.loads(row["reason"])
    assert reason["after"] & winshell.FILE_ATTRIBUTE_READONLY
    assert not (reason["before"] & winshell.FILE_ATTRIBUTE_READONLY)


async def test_set_attributes_missing_source_is_refused(conn, sandbox):
    with pytest.raises(mover.RefusedError):
        await mover.set_attributes(conn, sandbox / "nope.txt", read_only=True, hidden=None, archive=None,
                                   batch_id=ol.new_batch_id())


async def test_undo_attr_set_swaps_before_after_and_redo_restores(conn, sandbox):
    p = _mk(sandbox, "b.txt")
    await mover.set_attributes(conn, p, read_only=True, hidden=None, archive=None, batch_id=ol.new_batch_id())
    add_op = await _only(conn, "attr-set")

    inv = await mover.undo_operation(conn, add_op["id"])
    assert inv["op_type"] == "attr-set" and inv["status"] == "done"
    assert winshell.get_attributes(p)["read_only"] is False
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 1
    assert (await ol.get_operation(conn, inv["op_id"]))["undo_of"] == add_op["id"]

    redo = await mover.undo_operation(conn, inv["op_id"])
    assert redo["op_type"] == "attr-set" and redo["status"] == "done"
    assert winshell.get_attributes(p)["read_only"] is True
    assert (await ol.get_operation(conn, redo["op_id"]))["undo_of"] == inv["op_id"]
    assert redo["op_id"] != add_op["id"], "redo must mint a fresh row, never replay the original id"


async def test_undo_attr_set_is_path_guarded(conn, sandbox, monkeypatch):
    """Fix round 1 [Critical]: _apply_attr_bits (the function undo_operation's
    attr-set case calls directly, with a path taken straight from the
    operations_log row) must re-run path_guard itself, exactly like
    move/rename/trash's own undo paths do (by calling move()/rename()/
    trash() again, which guard internally) -- otherwise a since-relocated
    sandbox lets an undo write outside the currently-allowed area.
    """
    p = _mk(sandbox, "relocate.txt")
    await mover.set_attributes(conn, p, read_only=True, hidden=None, archive=None, batch_id=ol.new_batch_id())
    add_op = await _only(conn, "attr-set")

    monkeypatch.setattr(_config, "FILEPLUS_SANDBOX_PATH", sandbox / "elsewhere")

    with pytest.raises(_config.OutOfSandboxError):
        await mover.undo_operation(conn, add_op["id"])
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 0


# ---------------------------------------------------------------------------
# backend.mover.set_folder_type / folder-type-set undo+redo
# ---------------------------------------------------------------------------

async def test_set_folder_type_logs_and_writes_ini(conn, sandbox):
    d = sandbox / "Pix"; d.mkdir()
    op = await mover.set_folder_type(conn, d, "Pictures", batch_id=ol.new_batch_id())

    assert op["op_type"] == "folder-type-set" and op["status"] == "done"
    assert winshell.read_folder_type(d) == "Pictures"
    row = await _only(conn, "folder-type-set")
    reason = json.loads(row["reason"])
    assert reason["before_ini"] is None and reason["after"] == "Pictures"


async def test_set_folder_type_rejects_unknown_type(conn, sandbox):
    d = sandbox / "Weird"; d.mkdir()
    with pytest.raises(mover.InvalidPolicyError):
        await mover.set_folder_type(conn, d, "NotAType", batch_id=ol.new_batch_id())


async def test_set_folder_type_on_a_file_is_refused(conn, sandbox):
    p = _mk(sandbox, "notafolder.txt")
    with pytest.raises(mover.RefusedError):
        await mover.set_folder_type(conn, p, "Pictures", batch_id=ol.new_batch_id())


async def test_undo_folder_type_set_removes_ini_and_redo_restores(conn, sandbox):
    d = sandbox / "Vids"; d.mkdir()
    await mover.set_folder_type(conn, d, "Videos", batch_id=ol.new_batch_id())
    add_op = await _only(conn, "folder-type-set")
    assert (d / "desktop.ini").exists()

    inv = await mover.undo_operation(conn, add_op["id"])
    assert inv["op_type"] == "folder-type-set" and inv["status"] == "done"
    assert not (d / "desktop.ini").exists()
    assert winshell.read_folder_type(d) is None
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 1

    redo = await mover.undo_operation(conn, inv["op_id"])
    assert redo["status"] == "done"
    assert winshell.read_folder_type(d) == "Videos"
    assert redo["op_id"] != add_op["id"]


async def test_undo_folder_type_set_is_path_guarded(conn, sandbox, monkeypatch):
    """Fix round 1 [Critical]: same as attr-set's undo -- _undo_folder_type_set
    must re-run path_guard itself before restore_desktop_ini touches disk.
    """
    d = sandbox / "Guarded"; d.mkdir()
    await mover.set_folder_type(conn, d, "Pictures", batch_id=ol.new_batch_id())
    add_op = await _only(conn, "folder-type-set")

    monkeypatch.setattr(_config, "FILEPLUS_SANDBOX_PATH", sandbox / "elsewhere")

    with pytest.raises(_config.OutOfSandboxError):
        await mover.undo_operation(conn, add_op["id"])
    assert (await ol.get_operation(conn, add_op["id"]))["undone"] == 0


async def test_undo_folder_type_set_over_an_existing_customization_keeps_folder_readonly(conn, sandbox):
    """Changing Pictures -> Videos on an already-customized folder, then
    undoing, must restore the *previous* desktop.ini (Pictures) rather than
    removing it outright -- the folder was already an Explorer "system
    folder" before this change, and undo must not un-customize it entirely.
    """
    d = sandbox / "Multi"; d.mkdir()
    await mover.set_folder_type(conn, d, "Pictures", batch_id=ol.new_batch_id())
    assert winshell.get_attributes(d)["read_only"] is True
    await mover.set_folder_type(conn, d, "Videos", batch_id=ol.new_batch_id())
    assert winshell.get_attributes(d)["read_only"] is True
    rows = [r for r in await ol.list_operations(conn) if r["op_type"] == "folder-type-set"]
    latest = rows[0]  # list_operations orders id DESC -- rows[0] is the Videos change

    await mover.undo_operation(conn, latest["id"])
    assert winshell.read_folder_type(d) == "Pictures"
    assert (d / "desktop.ini").exists()
    assert winshell.get_attributes(d)["read_only"] is True, \
        "folder was already Explorer-customized before this change; undo must not un-customize it"


# ---------------------------------------------------------------------------
# GET /fs/properties
# ---------------------------------------------------------------------------

def test_fs_properties_on_a_file(client, sandbox):
    p = _mk(sandbox, "note.txt", "hello world")
    r = client.get("/fs/properties", params={"path": str(p)})
    assert r.status_code == 200
    body = r.json()
    for key in ("path", "name", "is_dir", "type_description", "opens_with", "opens_with_exe",
                "location", "size", "size_on_disk", "contains", "created", "modified", "accessed",
                "attributes", "folder_type", "folder_type_detected"):
        assert key in body, key
    assert body["is_dir"] is False
    assert body["contains"] is None
    assert body["folder_type"] is None and body["folder_type_detected"] is None
    assert body["size"] == len("hello world")
    assert body["size_on_disk"] >= body["size"]
    assert set(body["attributes"]) == {"read_only", "hidden", "archive", "system"}


def test_fs_properties_on_a_folder_counts_contents(client, sandbox):
    d = sandbox / "Folder"; d.mkdir()
    (d / "a.txt").write_text("1"); (d / "b.txt").write_text("2")
    (d / "sub").mkdir()
    r = client.get("/fs/properties", params={"path": str(d)})
    assert r.status_code == 200
    body = r.json()
    assert body["is_dir"] is True
    assert body["contains"] == {"files": 2, "folders": 1, "truncated": False}
    assert body["folder_type"] is None
    assert body["folder_type_detected"] == "Documents"  # 2 .txt files, majority


def test_fs_properties_not_found_is_404(client, sandbox):
    r = client.get("/fs/properties", params={"path": str(sandbox / "nope.txt")})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /fs/properties/details
# ---------------------------------------------------------------------------

def test_fs_properties_details_200_shape(client, sandbox):
    p = _mk(sandbox, "note.txt", "hello")
    r = client.get("/fs/properties/details", params={"path": str(p)})
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        details = r.json()["details"]
        assert isinstance(details, list)
        for row in details:
            assert set(row) == {"group", "name", "value"}


def test_fs_properties_details_503_when_pywin32_missing(client, sandbox, monkeypatch):
    from backend import api as api_module

    def boom(path):
        raise RuntimeError("pywin32 not installed")

    monkeypatch.setattr(api_module.winshell, "property_details", boom)
    p = _mk(sandbox, "note2.txt", "hello")
    r = client.get("/fs/properties/details", params={"path": str(p)})
    assert r.status_code == 503 and r.json()["detail"] == "pywin32 not installed"


def test_fs_properties_details_502_on_other_failure(client, sandbox, monkeypatch):
    """Fix round 1 [Minor]: RuntimeError -> 503 (pywin32 missing) as before;
    any other exception from property_details (a COM failure on a weird
    file, say) -> 502 with the exception's own text, not an unhandled 500.
    """
    from backend import api as api_module

    def boom(path):
        raise OSError("simulated COM property-store failure")

    monkeypatch.setattr(api_module.winshell, "property_details", boom)
    p = _mk(sandbox, "note3.txt", "hello")
    r = client.get("/fs/properties/details", params={"path": str(p)})
    assert r.status_code == 502 and "simulated COM property-store failure" in r.json()["detail"]


# ---------------------------------------------------------------------------
# POST /fs/attributes
# ---------------------------------------------------------------------------

def test_fs_attributes_all_null_is_422_with_no_log_row(client, sandbox):
    p = _mk(sandbox, "untouched.txt")
    r = client.post("/fs/attributes", json={"path": str(p)})
    assert r.status_code == 422
    ops = client.get("/operations", params={"path": str(p)}).json()
    assert ops == [], "no operations_log row for a no-op request"


def test_fs_attributes_undo_after_sandbox_relocated_is_403_and_row_stays_undone(client, sandbox, tmp_path, monkeypatch):
    """Fix round 1 [Critical], route-level: forward op inside the sandbox,
    then the sandbox is relocated elsewhere before the undo is attempted --
    POST /operations/{id}/undo must 403, and the original row must stay
    undone=0 (the undo never got far enough to log or apply anything).
    """
    p = _mk(sandbox, "relocate2.txt")
    r = client.post("/fs/attributes", json={"path": str(p), "read_only": True})
    assert r.status_code == 200
    ops = client.get("/operations", params={"path": str(p)}).json()
    attr_op = next(o for o in ops if o["op_type"] == "attr-set")
    assert attr_op["undone"] == 0

    monkeypatch.setattr(_config, "FILEPLUS_SANDBOX_PATH", tmp_path / "elsewhere")

    r2 = client.post(f"/operations/{attr_op['id']}/undo")
    assert r2.status_code == 403

    ops2 = client.get("/operations", params={"path": str(p)}).json()
    still = next(o for o in ops2 if o["op_type"] == "attr-set" and o["id"] == attr_op["id"])
    assert still["undone"] == 0


def test_fs_attributes_sets_and_is_undoable(client, sandbox):
    p = _mk(sandbox, "ro.txt")
    r = client.post("/fs/attributes", json={"path": str(p), "read_only": True})
    assert r.status_code == 200
    body = r.json()
    assert body["batch_id"] and body["op"]["op_type"] == "attr-set" and body["op"]["status"] == "done"
    assert winshell.get_attributes(p)["read_only"] is True

    ops = client.get("/operations", params={"path": str(p)}).json()
    attr_ops = [o for o in ops if o["op_type"] == "attr-set"]
    assert len(attr_ops) == 1 and attr_ops[0]["executed"] == 1

    r2 = client.post(f"/operations/{attr_ops[0]['id']}/undo")
    assert r2.status_code == 200
    assert winshell.get_attributes(p)["read_only"] is False


def test_fs_attributes_write_outside_sandbox_is_403(client, tmp_path):
    out = tmp_path / "o.txt"; out.write_text("x")
    r = client.post("/fs/attributes", json={"path": str(out), "read_only": True})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# POST /fs/folder-type
# ---------------------------------------------------------------------------

def test_fs_folder_type_sets_and_is_undoable(client, sandbox):
    d = sandbox / "Music"; d.mkdir()
    r = client.post("/fs/folder-type", json={"path": str(d), "type": "Music"})
    assert r.status_code == 200
    body = r.json()
    assert body["batch_id"] and body["op"]["op_type"] == "folder-type-set" and body["op"]["status"] == "done"
    assert (d / "desktop.ini").exists()
    assert winshell.read_folder_type(d) == "Music"

    ops = client.get("/operations", params={"path": str(d)}).json()
    ft_ops = [o for o in ops if o["op_type"] == "folder-type-set"]
    assert len(ft_ops) == 1

    r2 = client.post(f"/operations/{ft_ops[0]['id']}/undo")
    assert r2.status_code == 200
    assert not (d / "desktop.ini").exists()


def test_fs_folder_type_bad_type_is_422(client, sandbox):
    d = sandbox / "Bad"; d.mkdir()
    r = client.post("/fs/folder-type", json={"path": str(d), "type": "Nonsense"})
    assert r.status_code == 422


def test_fs_folder_type_write_outside_sandbox_is_403(client, tmp_path):
    out = tmp_path / "o"; out.mkdir()
    r = client.post("/fs/folder-type", json={"path": str(out), "type": "Pictures"})
    assert r.status_code == 403
