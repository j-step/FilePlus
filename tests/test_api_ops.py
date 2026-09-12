import aiosqlite
import pytest
from fastapi.testclient import TestClient

from backend import operations_log as ol


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_operations_list_undo_batch_undo(client, sandbox):
    (sandbox / "a.txt").write_text("a"); (sandbox / "b.txt").write_text("b"); (sandbox / "dst").mkdir()
    r = client.post("/fs/move", json={"sources": [str(sandbox / "a.txt"), str(sandbox / "b.txt")], "dest": str(sandbox / "dst")})
    batch = r.json()["batch_id"]
    ops = client.get("/operations", params={"limit": 10}).json()
    assert len(ops) == 2 and ops[0]["batch_id"] == batch
    r = client.post(f"/operations/{ops[0]['id']}/undo"); assert r.status_code == 200
    assert (sandbox / "b.txt").exists() or (sandbox / "a.txt").exists()
    r = client.post(f"/operations/batch/{batch}/undo"); assert r.status_code == 200
    assert (sandbox / "a.txt").exists() and (sandbox / "b.txt").exists()
    r = client.post(f"/operations/{ops[0]['id']}/undo"); assert r.status_code == 409


def test_operations_by_path_and_pending(client, sandbox):
    (sandbox / "p.txt").write_text("p")
    client.post("/fs/rename", json={"path": str(sandbox / "p.txt"), "new_name": "q.txt"})
    rows = client.get("/operations", params={"path": str(sandbox / "q.txt")}).json()
    assert len(rows) == 1 and rows[0]["op_type"] == "rename"
    assert client.get("/operations/pending").json() == []


def test_trash_empty_endpoint(client, sandbox, monkeypatch):
    from backend import mover
    sent = []
    monkeypatch.setattr(mover, "_send2trash", lambda p: sent.append(p))
    (sandbox / "e.txt").write_text("e")
    client.post("/fs/trash", json={"paths": [str(sandbox / "e.txt")]})
    r = client.post("/fs/trash/empty")
    assert r.status_code == 200 and r.json()["batches"] == 1 and len(sent) == 1


def test_tag_add_undo_via_operations_route(client, sandbox):
    """Task 8a item (6): the Inspector's History Undo button posts to
    /operations/{id}/undo and expects the inverse op's own result back —
    {op_id, op_type, status, src, dest, batch_id} (see frontend/src/
    inspector.js's inspectorUndoOp). This used to 409 ("has no inverse") for
    a tag-add row; it must now succeed with that same shape.
    """
    (sandbox / "doc.txt").write_text("d")
    file_id = client.get("/file", params={"path": str(sandbox / "doc.txt")}).json()["id"]
    r = client.post(f"/files/{file_id}/tags", json={"name": "work"})
    assert r.status_code == 200

    ops = client.get("/operations", params={"limit": 5}).json()
    tag_op = next(o for o in ops if o["op_type"] == "tag-add")

    r = client.post(f"/operations/{tag_op['id']}/undo")
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"op_id", "op_type", "status", "src", "dest", "batch_id"}
    assert body["op_type"] == "tag-remove" and body["status"] == "done"

    assert client.get(f"/files/{file_id}/tags").json() == []
    # the original tag-add op is now undone -- a second undo attempt 409s,
    # exactly like a file-op undo would.
    r = client.post(f"/operations/{tag_op['id']}/undo")
    assert r.status_code == 409


async def test_startup_reconcile_marks_completed_move(sandbox, db):
    """A crash-left pending 'move' row whose dest exists and source is gone is
    classified 'completed' by the lifespan's reconcile_pending call, before any
    request is served."""
    dest = sandbox / "recovered.txt"
    dest.write_text("d")
    async with aiosqlite.connect(db) as conn:
        await ol.log_operation(conn, "move", str(sandbox / "gone.txt"), str(dest))

    from backend.api import app
    with TestClient(app) as c:
        pending = c.get("/operations/pending").json()
        assert len(pending) == 1
        assert pending[0]["resolution"] == "completed"
        assert pending[0]["dest_path"] == str(dest)

        health = c.get("/health").json()
        assert health["pending_ops"] == 0
