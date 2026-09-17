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
        assert set(item) == {"name", "path", "ext", "modified"}
        assert item["ext"] in ("png", "jpg", "mp4")

    r2 = client.get("/fs/peek", params={"path": "relative\\path", "n": 2})
    assert r2.status_code == 400


def test_fs_peek_answers_empty_for_a_missing_path_or_a_file(client, sandbox):
    """A preview of something that is not a directory is simply empty.

    404 would make the renderer's folder tiles log a console error for a
    folder deleted between the listing and the peek -- a decoration must not
    be able to redden the zero-console-errors gate. Malformed input (a
    relative path) still 400s; that is checked above.
    """
    missing = client.get("/fs/peek", params={"path": str(sandbox / "no-such-folder"), "n": 2})
    assert missing.status_code == 200
    assert missing.json() == {"items": []}

    a_file = sandbox / "not-a-directory.txt"
    a_file.write_text("hello")
    r = client.get("/fs/peek", params={"path": str(a_file), "n": 2})
    assert r.status_code == 200
    assert r.json() == {"items": []}


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


def test_fs_peek_lazy_scan_finds_early_media_without_full_sort(client, tmp_path):
    """2500 non-media files plus 2 media files that sort (and, on NTFS,
    enumerate) first -- a lazy, non-recursive scan finds both without ever
    needing to sort the whole directory."""
    d = tmp_path / "many-early"
    d.mkdir()
    (d / "0000-a.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (d / "0001-b.jpg").write_bytes(b"\xff\xd8\xff")
    for i in range(2500):
        (d / f"zzz-{i:05d}.txt").write_text("x")

    body = client.get("/fs/peek", params={"path": str(d), "n": 2}).json()
    names = {item["name"] for item in body["items"]}
    assert names == {"0000-a.png", "0001-b.jpg"}


def test_fs_peek_cap_is_real_when_only_media_file_is_near_the_end(client, tmp_path):
    """A directory with 2500 entries whose only media file sits at position
    2400 (past _PEEK_SCAN_CAP == 2000) must come back empty -- the entry cap
    is a real bound on work done, not just a safety net that never bites."""
    d = tmp_path / "many-late"
    d.mkdir()
    for i in range(2500):
        if i == 2400:
            (d / f"{i:05d}.png").write_bytes(b"x")
        else:
            (d / f"{i:05d}.txt").write_text("x")

    body = client.get("/fs/peek", params={"path": str(d), "n": 2}).json()
    assert body["items"] == []


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


def test_delete_index_conflict_while_running(client, tmp_path):
    """DELETE /index must refuse (409) while any quick-index scan is running,
    for any root -- not just the one being deleted -- since a running scan
    of a different root can still upsert this root's index_roots row
    concurrently with the delete (mirrors POST /index's own 409 check)."""
    from backend.api import app
    root = tmp_path / "some-root"
    root.mkdir()
    app.state.index_state["running"] = True
    try:
        r = client.delete("/index", params={"root": str(root)})
        assert r.status_code == 409
    finally:
        app.state.index_state["running"] = False


def test_delete_index_protected_root_forbidden(client, tmp_path, monkeypatch):
    """DELETE /index must refuse (403) a protected system root, mirroring
    POST /index's own check."""
    import backend.config as _config
    protected = tmp_path / "Win"
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [protected])
    r = client.delete("/index", params={"root": str(protected)})
    assert r.status_code == 403


def test_fs_peek_items_carry_modified(client, sandbox):
    """Pass 2 #143: a peeked picture's mtime keys the renderer's thumbnail
    cache for the folder preview's mini, so it must come back with the item."""
    (sandbox / "p.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(16))
    r = client.get("/fs/peek", params={"path": str(sandbox), "n": 2})
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["name"] for i in items] == ["p.png"]
    assert abs(items[0]["modified"] - (sandbox / "p.png").stat().st_mtime) < 1e-6
