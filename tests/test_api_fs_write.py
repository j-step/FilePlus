from collections import namedtuple

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_mkdir_touch_rename(client, sandbox):
    r = client.post("/fs/mkdir", json={"dir": str(sandbox), "name": "New"}); assert r.status_code == 200
    assert (sandbox / "New").is_dir() and r.json()["ops"][0]["op_type"] == "mkdir"
    r = client.post("/fs/touch", json={"dir": str(sandbox / "New"), "name": "a.txt"}); assert r.status_code == 200
    r = client.post("/fs/rename", json={"path": str(sandbox / "New" / "a.txt"), "new_name": "b.txt"}); assert r.status_code == 200
    assert (sandbox / "New" / "b.txt").exists()
    r = client.post("/fs/rename", json={"path": str(sandbox / "New" / "b.txt"), "new_name": "x/y"}); assert r.status_code == 409
    r = client.post("/fs/mkdir", json={"dir": str(sandbox), "name": "New"}); assert r.status_code == 409


def test_move_copy_trash_with_conflicts(client, sandbox):
    (sandbox / "s").mkdir(); (sandbox / "d").mkdir()
    (sandbox / "s" / "f.txt").write_text("1"); (sandbox / "d" / "f.txt").write_text("2")
    r = client.post("/fs/move", json={"sources": [str(sandbox / "s" / "f.txt")], "dest": str(sandbox / "d")})
    assert r.status_code == 200 and len(r.json()["conflicts"]) == 1 and r.json()["ops"] == []
    r = client.post("/fs/move", json={"sources": [str(sandbox / "s" / "f.txt")], "dest": str(sandbox / "d"), "on_conflict": "keep-both"})
    assert (sandbox / "d" / "f (2).txt").read_text() == "1"
    r = client.post("/fs/copy", json={"sources": [str(sandbox / "d" / "f.txt")], "dest": str(sandbox / "s")})
    assert r.status_code == 200 and (sandbox / "s" / "f.txt").read_text() == "2"
    r = client.post("/fs/trash", json={"paths": [str(sandbox / "s" / "f.txt")]})
    assert r.status_code == 200 and not (sandbox / "s" / "f.txt").exists() and r.json()["batch_id"]


def test_write_outside_sandbox_is_403(client, tmp_path):
    out = tmp_path / "o"; out.mkdir()
    r = client.post("/fs/mkdir", json={"dir": str(out), "name": "n"})
    assert r.status_code == 403 and "WRITE_UNLOCKED" in r.json()["detail"]


def test_move_bad_on_conflict_is_422(client, sandbox):
    (sandbox / "s.txt").write_text("x")
    r = client.post("/fs/move", json={"sources": [str(sandbox / "s.txt")], "dest": str(sandbox), "on_conflict": "bogus"})
    assert r.status_code == 422


def test_fs_list_relative_or_driveless_path_is_400(client):
    assert client.get("/fs/list", params={"path": "C:"}).status_code == 400
    assert client.get("/fs/list", params={"path": "relative"}).status_code == 400


def test_fs_list_reads_anywhere_and_flags_root(client, tmp_path, sandbox):
    out = tmp_path / "o"; out.mkdir(); (out / "z.txt").write_text("z")
    r = client.get("/fs/list", params={"path": str(out)})
    assert r.status_code == 200
    body = r.json()
    assert body["parent"] == str(out.parent) and body["is_root"] is False and body["truncated"] is False
    root = str(sandbox.resolve().drive) + "\\"
    r = client.get("/fs/list", params={"path": root})
    assert r.status_code == 200 and r.json()["is_root"] is True and r.json()["parent"] is None


def test_fs_list_hides_trash_unless_asked(client, sandbox):
    (sandbox / "v.txt").write_text("v")
    client.post("/fs/trash", json={"paths": [str(sandbox / "v.txt")]})
    names = {e["name"] for e in client.get("/fs/list", params={"path": str(sandbox)}).json()["entries"]}
    assert ".FilePlusTrash" not in names
    names = {e["name"] for e in client.get("/fs/list", params={"path": str(sandbox), "show_hidden": "true"}).json()["entries"]}
    assert ".FilePlusTrash" in names


def test_drives_and_health(client):
    d = client.get("/drives").json()
    assert isinstance(d, list) and d and {"letter", "mount", "total_bytes", "free_bytes", "used_bytes", "label"} <= set(d[0])
    h = client.get("/health").json()
    assert h["db_ok"] is True and h["write_unlocked"] is False and h["pending_ops"] == 0 and h["index_running"] is False


def test_drives_filters_out_removable_and_remote(client, monkeypatch):
    from backend import api as api_module

    SDiskPart = namedtuple("sdiskpart", "device mountpoint fstype opts")
    SDiskUsage = namedtuple("sdiskusage", "total used free percent")
    fake_parts = [
        SDiskPart("C:\\", "C:\\", "NTFS", "rw,fixed"),
        SDiskPart("D:\\", "D:\\", "FAT32", "rw,removable"),
        SDiskPart("E:\\", "E:\\", "NTFS", "rw,remote"),
    ]
    fake_usage = SDiskUsage(total=1000, used=400, free=600, percent=40.0)

    monkeypatch.setattr(api_module.psutil, "disk_partitions", lambda all=False: fake_parts)
    monkeypatch.setattr(api_module.psutil, "disk_usage", lambda mount: fake_usage)

    d = client.get("/drives").json()
    assert len(d) == 1
    assert d[0]["letter"] == "C:"
    assert {"letter", "mount", "total_bytes", "free_bytes", "used_bytes", "label"} <= set(d[0])
