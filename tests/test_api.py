"""Contract tests for every route registered in backend/api.py.

Stub routes are tested for their *current* not-implemented shape so that
Stage 2 turns each of those assertions into a real one deliberately.
"""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    """TestClient inside its context manager so the lifespan runs init_db()."""
    from backend.api import app
    with TestClient(app) as c:
        yield c


def _seed(sandbox):
    (sandbox / "alpha.txt").write_text("alpha")
    (sandbox / "notes.md").write_text("notes")
    sub = sandbox / "sub"
    sub.mkdir()
    (sub / "beta.txt").write_text("beta")
    (sandbox / ".hidden").write_text("skip me")
    (sandbox / "partial.crdownload").write_text("skip me too")


def test_health_shape(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert isinstance(body["version"], str)


def test_files_is_empty_before_any_scan(client):
    assert client.get("/files").json() == []


def test_scan_indexes_sandbox_and_skips_hidden_and_partial(client, sandbox):
    _seed(sandbox)
    r = client.post("/scan", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 3
    assert body["stale_removed"] == 0
    assert body["path"] == str(sandbox)
    names = {f["filename"] for f in client.get("/files").json()}
    assert names == {"alpha.txt", "notes.md", "beta.txt"}


def test_files_filters_by_path_prefix_and_q(client, sandbox):
    _seed(sandbox)
    client.post("/scan", json={})
    in_sub = client.get("/files", params={"path": str(sandbox / "sub")}).json()
    assert [f["filename"] for f in in_sub] == ["beta.txt"]
    q = client.get("/files", params={"q": "alph"}).json()
    assert [f["filename"] for f in q] == ["alpha.txt"]


def test_file_by_id_and_404(client, sandbox):
    _seed(sandbox)
    client.post("/scan", json={})
    first = client.get("/files").json()[0]
    r = client.get(f"/files/{first['id']}")
    assert r.status_code == 200
    assert r.json()["path"] == first["path"]
    assert "hash" in r.json()
    assert client.get("/files/999999").status_code == 404


def test_scan_removes_stale_rows(client, sandbox):
    _seed(sandbox)
    client.post("/scan", json={})
    (sandbox / "alpha.txt").unlink()
    body = client.post("/scan", json={}).json()
    assert body["count"] == 2
    assert body["stale_removed"] == 1


def test_scan_outside_sandbox_indexes_read_only(client, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "o.txt").write_text("o")
    r = client.post("/scan", json={"path": str(outside)})
    assert r.status_code == 200
    assert r.json()["count"] == 1


def test_tags_empty(client):
    assert client.get("/tags").json() == []


def test_fs_list_root_returns_sandbox(client, sandbox):
    _seed(sandbox)
    r = client.get("/fs/list/root")
    assert r.status_code == 200
    assert r.json()["path"] == str(sandbox.resolve())
    names = {e["name"] for e in r.json()["entries"]}
    assert {"alpha.txt", "notes.md", "sub"} <= names


def test_stub_routes_report_not_implemented(client):
    """/files/{id}/tags is real now (Task 8): unknown file id -> 404."""
    assert client.post("/files/999/tags", json={"name": "work"}).status_code == 404
    assert client.get("/operations").json() == []
    assert client.post("/operations/999/undo").status_code == 409
