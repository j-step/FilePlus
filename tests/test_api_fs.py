# tests/test_api_fs.py
"""Tests for the read-only /fs/list directory listing endpoint."""
import errno
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox):
    """FastAPI TestClient with sandbox fixture applied so path_guard works."""
    from backend.api import app
    return TestClient(app)


def test_fs_list_returns_directory_entries(client, sandbox):
    """GET /fs/list?path=<sandbox> returns the entries inside it."""
    (sandbox / "alpha.txt").write_text("a")
    (sandbox / "beta.md").write_text("b")
    sub = sandbox / "subdir"
    sub.mkdir()
    (sub / "inner.txt").write_text("c")

    r = client.get(f"/fs/list?path={sandbox}")
    assert r.status_code == 200
    data = r.json()

    assert data["path"] == str(sandbox.resolve())
    names = {e["name"] for e in data["entries"]}
    assert names == {"alpha.txt", "beta.md", "subdir"}
    types = {e["name"]: e["is_dir"] for e in data["entries"]}
    assert types == {"alpha.txt": False, "beta.md": False, "subdir": True}


def test_fs_list_includes_size_modified_ext(client, sandbox):
    """Entries include size, modified (epoch float), and ext (lowercase, with leading dot)."""
    f = sandbox / "doc.PDF"
    f.write_text("hello")

    r = client.get(f"/fs/list?path={sandbox}")
    entry = next(e for e in r.json()["entries"] if e["name"] == "doc.PDF")
    assert entry["size"] == 5
    assert isinstance(entry["modified"], float)
    assert entry["ext"] == ".pdf"
    assert entry["is_dir"] is False
    assert entry["is_hidden"] is False


def test_fs_list_directory_entry_has_no_ext(client, sandbox):
    """Directory entries have ext == '' (empty string)."""
    (sandbox / "myfolder").mkdir()
    r = client.get(f"/fs/list?path={sandbox}")
    folder = next(e for e in r.json()["entries"] if e["name"] == "myfolder")
    assert folder["ext"] == ""
    assert folder["is_dir"] is True


def test_fs_list_404_when_path_does_not_exist(client, sandbox):
    bogus = sandbox / "does-not-exist"
    r = client.get(f"/fs/list?path={bogus}")
    assert r.status_code == 404
    # FastAPI's generic route-miss returns {"detail": "Not Found"}.
    # Our endpoint returns a more specific message — assert it's not the bare miss.
    assert r.json().get("detail") != "Not Found"


def test_fs_list_404_when_path_is_file_not_dir(client, sandbox):
    f = sandbox / "file.txt"
    f.write_text("x")
    r = client.get(f"/fs/list?path={f}")
    assert r.status_code == 404
    # FastAPI's generic route-miss returns {"detail": "Not Found"}.
    # Our endpoint returns a more specific message — assert it's not the bare miss.
    assert r.json().get("detail") != "Not Found"


def test_fs_list_outside_sandbox_succeeds_read_only(client, sandbox, tmp_path):
    """/fs/list is a read; path_guard (mode="read") allows any path (D2)."""
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "o.txt").write_text("o")
    r = client.get(f"/fs/list?path={outside}")
    assert r.status_code == 200
    names = {e["name"] for e in r.json()["entries"]}
    assert names == {"o.txt"}


def test_fs_list_root_returns_sandbox_root(client, sandbox):
    """GET /fs/list/root returns the sandbox root listing without a path arg."""
    (sandbox / "x.txt").write_text("x")
    r = client.get("/fs/list/root")
    assert r.status_code == 200
    data = r.json()
    assert data["path"] == str(sandbox.resolve())
    assert any(e["name"] == "x.txt" for e in data["entries"])


def test_fs_list_root_honours_show_hidden(client, sandbox, db):
    """GET /fs/list/root must accept show_hidden, same filter as /fs/list --
    the first Browser open (loadDirectory(null)) hits this route and must
    honour ui.show_hidden the same as every later /fs/list call."""
    (sandbox / "v.txt").write_text("v")
    client.post("/fs/trash", json={"paths": [str(sandbox / "v.txt")]})
    names = {e["name"] for e in client.get("/fs/list/root").json()["entries"]}
    assert ".FilePlusTrash" not in names
    names = {e["name"] for e in client.get("/fs/list/root", params={"show_hidden": "true"}).json()["entries"]}
    assert ".FilePlusTrash" in names


# ---------------------------------------------------------------------------
# Task 8a item (4) -- an OSError raised while listing/statting a directory
# (unreachable UNC host, "device not ready", a sharing violation) must never
# 500; it becomes a 502 (network/IO) or 400 (EINVAL/bad-name), and
# PermissionError keeps whatever status it had before this handler existed.
# ---------------------------------------------------------------------------

def test_fs_list_returns_502_when_is_dir_raises_host_unreachable(client, sandbox, monkeypatch):
    def flaky_is_dir(self, *a, **kw):
        raise OSError(errno.EHOSTUNREACH, "No route to host")

    monkeypatch.setattr(Path, "is_dir", flaky_is_dir)
    r = client.get(f"/fs/list?path={sandbox}")
    assert r.status_code == 502
    body = r.json()
    assert body["detail"]
    assert body["path"] == str(sandbox)


def test_fs_list_returns_502_when_scandir_raises_device_not_ready(client, sandbox, monkeypatch):
    def flaky_scandir(path):
        raise OSError(errno.ENODEV, "The device is not ready")

    monkeypatch.setattr(os, "scandir", flaky_scandir)
    r = client.get(f"/fs/list?path={sandbox}")
    assert r.status_code == 502
    assert "not ready" in r.json()["detail"].lower()


def test_fs_list_returns_400_for_einval(client, sandbox, monkeypatch):
    def flaky_is_dir(self, *a, **kw):
        raise OSError(errno.EINVAL, "Invalid argument")

    monkeypatch.setattr(Path, "is_dir", flaky_is_dir)
    r = client.get(f"/fs/list?path={sandbox}")
    assert r.status_code == 400


def test_fs_list_permission_error_still_returns_its_existing_status(client, sandbox, monkeypatch):
    """PermissionError is an OSError subclass but keeps its own handler
    (403) -- the new generic OSError handler must never intercept it."""
    def flaky_is_dir(self, *a, **kw):
        raise PermissionError(errno.EACCES, "Access is denied")

    monkeypatch.setattr(Path, "is_dir", flaky_is_dir)
    r = client.get(f"/fs/list?path={sandbox}")
    assert r.status_code == 403
