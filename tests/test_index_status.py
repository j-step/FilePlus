"""Tests for GET /filetypes, GET /known-folders, GET /fs/peek, and the
index_roots-backed GET /index/status + DELETE /index lifecycle."""
import json
import time

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def _await_index_idle(client, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if client.get("/index/status").json()["running"] is False:
            return
        time.sleep(0.05)
    raise AssertionError("index did not finish in time")


def test_filetypes_route_matches_module(client):
    from backend import filetypes as ft
    assert client.get("/filetypes").json() == json.loads(json.dumps(ft.as_json()))


def test_known_folders_route_returns_at_least_six(client):
    body = client.get("/known-folders").json()
    assert len(body["folders"]) >= 6
    ids = {f["id"] for f in body["folders"]}
    assert {"desktop", "downloads", "documents", "pictures", "videos", "music"} <= ids


def test_fs_peek_returns_media_items_and_400_for_relative_path(client, sandbox):
    (sandbox / "a.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    (sandbox / "b.jpg").write_bytes(b"\xff\xd8\xff" + b"\x00" * 32)
    (sandbox / "c.mp4").write_bytes(b"\x00" * 32)
    (sandbox / "readme.txt").write_text("not media")

    r = client.get("/fs/peek", params={"path": str(sandbox), "n": 2})
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) <= 2
    for item in body["items"]:
        assert set(item) == {"name", "path", "ext"}
        assert item["ext"] in ("png", "jpg", "mp4")

    r2 = client.get("/fs/peek", params={"path": "relative\\path", "n": 2})
    assert r2.status_code == 400


def test_fs_peek_skips_hidden_and_trash(client, sandbox):
    import backend.config as _config
    (sandbox / ".hidden.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    trash = sandbox / _config.TRASH_DIRNAME
    trash.mkdir()
    (trash / "deleted.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    body = client.get("/fs/peek", params={"path": str(sandbox), "n": 5}).json()
    names = {item["name"] for item in body["items"]}
    assert ".hidden.png" not in names
    assert "deleted.png" not in names


def test_index_status_lifecycle(client, tmp_path):
    """Index a root, see it in /index/status with the right file_count, then
    remove it from disk and DELETE /index?root= to de-index the stale rows."""
    root = tmp_path / "indexed-root"
    root.mkdir()
    (root / "one.txt").write_text("one")
    (root / "two.txt").write_text("two")

    r = client.post("/index", json={"path": str(root)})
    assert r.status_code == 200 and r.json()["started"] is True
    _await_index_idle(client)

    status = client.get("/index/status").json()
    assert status["running"] is False
    entry = next(x for x in status["roots"] if x["root"] == str(root))
    assert entry["file_count"] == 2
    assert entry["last_run"]

    (root / "one.txt").unlink()
    (root / "two.txt").unlink()

    r = client.delete("/index", params={"root": str(root)})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["removed"] == 2

    status2 = client.get("/index/status").json()
    assert all(x["root"] != str(root) for x in status2["roots"])
