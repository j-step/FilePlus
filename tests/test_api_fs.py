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


# ---------------------------------------------------------------------------
# GET /fs/search -- budgeted live tree search (Stage 2C Task 2)
# ---------------------------------------------------------------------------

def test_fs_search_finds_matches_with_spans(client, sandbox):
    (sandbox / "doc-01.txt").write_text("x")
    (sandbox / "doc-02.txt").write_text("x")
    (sandbox / "other.txt").write_text("x")

    r = client.get("/fs/search", params={"root": str(sandbox), "q": "doc"})
    assert r.status_code == 200
    body = r.json()
    names = {x["name"] for x in body["results"]}
    assert names == {"doc-01.txt", "doc-02.txt"}
    for item in body["results"]:
        assert item["match"] == [[0, 3]]
    assert body["truncated"] is False
    assert isinstance(body["elapsed_ms"], int)


def test_fs_search_relative_root_is_400(client):
    r = client.get("/fs/search", params={"root": r"relative\path", "q": "doc"})
    assert r.status_code == 400


def test_fs_search_type_and_hidden_filters(client, sandbox):
    (sandbox / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    (sandbox / "notes.txt").write_text("x")
    (sandbox / ".hidden.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    body = client.get("/fs/search", params={"root": str(sandbox), "type": "image"}).json()
    assert [x["name"] for x in body["results"]] == ["photo.png"]

    body_hidden = client.get(
        "/fs/search", params={"root": str(sandbox), "type": "image", "hidden": "true"}
    ).json()
    assert {x["name"] for x in body_hidden["results"]} == {"photo.png", ".hidden.png"}


def test_fs_search_tag_filter(sandbox, db):
    """tag= resolves through tagger.paths_for_tag before the walk starts, so
    only paths carrying that tag come back -- exercised via its own
    TestClient (with the lifespan's init_db) rather than the module `client`
    fixture, since tagging needs the files/tags tables."""
    from backend.api import app
    with TestClient(app) as client:
        tagged = sandbox / "tagged.txt"; tagged.write_text("x")
        (sandbox / "untagged.txt").write_text("x")
        fid = client.get("/file", params={"path": str(tagged)}).json()["id"]
        client.post(f"/files/{fid}/tags", json={"name": "keep"})

        r = client.get("/fs/search", params={"root": str(sandbox), "tag": "keep"})
        assert [x["name"] for x in r.json()["results"]] == ["tagged.txt"]


def test_fs_search_tag_filter_survives_case_only_rename(sandbox, db):
    """Windows is case-preserving but case-insensitive: renaming a file to
    change only its case doesn't update the files-table row (written once,
    at whatever case existed when it was indexed). tag= must still find the
    file during a live walk, which sees the *current* on-disk casing."""
    from backend.api import app
    with TestClient(app) as client:
        original = sandbox / "Doc.txt"; original.write_text("x")
        fid = client.get("/file", params={"path": str(original)}).json()["id"]
        client.post(f"/files/{fid}/tags", json={"name": "keep"})

        renamed = sandbox / "doc.txt"
        os.rename(str(original), str(renamed))

        r = client.get("/fs/search", params={"root": str(sandbox), "tag": "keep"})
        assert [x["name"] for x in r.json()["results"]] == ["doc.txt"]


# ---------------------------------------------------------------------------
# Pass 2: GET /shell/icon and POST /shell/icons (Windows-icon sharpness,
# design step 3) -- Explorer-exact icons at physical px for the renderer.
# ---------------------------------------------------------------------------

nt_only = pytest.mark.skipif(os.name != "nt", reason="IShellItemImageFactory is windows only")


def _ihdr(png: bytes) -> tuple[int, int]:
    return int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")


@nt_only
def test_shell_icon_answers_png_at_exact_px(client):
    r = client.get("/shell/icon", params={"path": r"C:\Windows", "px": 24})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert "max-age" in r.headers.get("cache-control", "")
    assert _ihdr(r.content) == (24, 24)


def test_shell_icon_rejects_px_out_of_range(client):
    assert client.get("/shell/icon", params={"path": r"C:\Windows", "px": 4}).status_code == 400
    assert client.get("/shell/icon", params={"path": r"C:\Windows", "px": 513}).status_code == 400


def test_shell_icon_missing_path_is_404(client, sandbox):
    r = client.get("/shell/icon", params={"path": str(sandbox / "nope.txt"), "px": 16})
    assert r.status_code == 404


def test_shell_icon_relative_path_is_400(client):
    assert client.get("/shell/icon", params={"path": "relative\\x.txt", "px": 16}).status_code == 400


@nt_only
def test_shell_icons_batch_in_order_with_shared_ext_key(client, sandbox):
    import base64
    (sandbox / "a.txt").write_text("a")
    (sandbox / "b.txt").write_text("b")
    body = {"items": [
        {"path": r"C:\Windows", "px": 16, "is_dir": True},
        {"path": str(sandbox / "a.txt"), "px": 16},
        {"path": str(sandbox / "b.txt"), "px": 16},
        {"path": str(sandbox / "missing.txt"), "px": 16},
        {"path": str(sandbox / "a.txt"), "px": 4},
    ]}
    r = client.post("/shell/icons", json=body)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 5
    assert items[0]["png"] and items[1]["png"] and items[2]["png"]
    assert items[1]["png"] == items[2]["png"], "same extension -> one shared key -> identical bytes"
    assert items[0]["png"] != items[1]["png"]
    assert items[3] == {"png": None, "pending": False}
    assert items[4] == {"png": None, "pending": False}, "a bad px is a null entry, never a batch failure"
    assert _ihdr(base64.b64decode(items[0]["png"])) == (16, 16)


def test_shell_icons_batch_caps_at_200(client):
    r = client.post("/shell/icons", json={"items": [{"path": r"C:\Windows", "px": 16}] * 201})
    assert r.status_code == 400


def test_shell_icons_empty_batch(client):
    r = client.post("/shell/icons", json={"items": []})
    assert r.status_code == 200 and r.json() == {"items": []}


def test_health_advertises_shell_icons(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["shell_icons"] is (os.name == "nt")
