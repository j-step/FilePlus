import pytest
from fastapi.testclient import TestClient


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
