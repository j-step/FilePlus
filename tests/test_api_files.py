import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_file_meta_indexes_on_demand(client, sandbox):
    p = sandbox / "m.md"; p.write_text("# hi")
    r = client.get("/file", params={"path": str(p)}); assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "m.md" and body["size"] == 4 and body["hash"] and body["tags"] == [] and body["kind"] == "Markdown"
    assert client.get("/file", params={"path": str(sandbox / "nope.txt")}).status_code == 404


def test_preview_text_image_binary(client, sandbox):
    t = sandbox / "t.txt"; t.write_text("hello " * 2000)
    body = client.get("/preview", params={"path": str(t)}).json()
    assert body["kind"] == "text" and body["truncated"] is True and len(body["content"]) <= 4096
    png = sandbox / "i.png"; png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    r = client.get("/preview", params={"path": str(png)})
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/png")
    b = sandbox / "b.bin"; b.write_bytes(bytes(range(256)))
    assert client.get("/preview", params={"path": str(b)}).json()["kind"] == "binary"


def test_tags_crud_and_search(client, sandbox):
    p = sandbox / "tg.txt"; p.write_text("x")
    fid = client.get("/file", params={"path": str(p)}).json()["id"]
    r = client.post(f"/files/{fid}/tags", json={"name": "work"}); assert r.status_code == 200
    client.post(f"/files/{fid}/tags", json={"name": "docs"})
    tags = client.get(f"/files/{fid}/tags").json()
    assert {t["name"] for t in tags} == {"work", "docs"} and tags[0]["tag_type"] == "user"
    assert [t["name"] for t in client.get("/tags", params={"q": "wo"}).json()] == ["work"]
    tid = next(t["id"] for t in tags if t["name"] == "work")
    client.delete(f"/files/{fid}/tags/{tid}")
    assert [t["name"] for t in client.get(f"/files/{fid}/tags").json()] == ["docs"]
    ops = [o["op_type"] for o in client.get("/operations").json()]
    assert ops[:3] == ["tag-remove", "tag-add", "tag-add"]


def test_history_by_path(client, sandbox):
    p = sandbox / "h.txt"; p.write_text("h")
    client.post("/fs/rename", json={"path": str(p), "new_name": "h2.txt"})
    rows = client.get("/files/history", params={"path": str(sandbox / "h2.txt")}).json()
    assert len(rows) == 1 and rows[0]["op_type"] == "rename"


def test_search_and_quick_index(client, sandbox):
    (sandbox / "deep").mkdir(); (sandbox / "deep" / "budget-2026.xlsx").write_text("b")
    r = client.post("/index", json={"path": str(sandbox)}); assert r.status_code == 200 and r.json()["started"] is True
    import time
    for _ in range(50):
        if client.get("/index/status").json()["running"] is False: break
        time.sleep(0.1)
    st = client.get("/index/status").json()
    entry = next(r for r in st["roots"] if r["root"] == str(sandbox))
    assert st["running"] is False and entry["file_count"] >= 1 and entry["last_run"]
    # GET /search now returns {"results": [...], "indexed_roots": [...]} (Stage 2C Task 2)
    # instead of a bare list, so This-PC search can flag un-indexed drives.
    body = client.get("/search", params={"q": "budget"}).json()
    hits = body["results"]
    assert hits and hits[0]["filename"] == "budget-2026.xlsx" and hits[0]["hash"] is None   # quick index does not hash
    assert str(sandbox) in body["indexed_roots"]


def test_search_type_and_ext_filters_and_indexed_roots(client, sandbox):
    (sandbox / "doc-note.txt").write_text("hello")
    (sandbox / "doc-readme.md").write_text("hello")
    (sandbox / "doc-photo.png").write_bytes(b"\x89PNG")
    r = client.post("/index", json={"path": str(sandbox)}); assert r.status_code == 200
    import time
    for _ in range(50):
        if client.get("/index/status").json()["running"] is False: break
        time.sleep(0.1)

    body = client.get("/search", params={"q": "doc", "type": "document"}).json()
    assert {r["filename"] for r in body["results"]} == {"doc-note.txt", "doc-readme.md"}
    assert str(sandbox) in body["indexed_roots"]

    ext_body = client.get("/search", params={"q": "doc", "ext": "md"}).json()
    assert [r["filename"] for r in ext_body["results"]] == ["doc-readme.md"]


def test_search_whole_word_filter(client, sandbox):
    (sandbox / "mydoc.txt").write_text("x")
    (sandbox / "my doc.txt").write_text("x")
    client.post("/index", json={"path": str(sandbox)})
    import time
    for _ in range(50):
        if client.get("/index/status").json()["running"] is False: break
        time.sleep(0.1)

    body = client.get("/search", params={"q": "doc", "whole_word": "true"}).json()
    assert {r["filename"] for r in body["results"]} == {"my doc.txt"}


def test_search_tag_filter(client, sandbox):
    p = sandbox / "tagged.txt"; p.write_text("x")
    other = sandbox / "untagged.txt"; other.write_text("x")
    fid = client.get("/file", params={"path": str(p)}).json()["id"]
    client.get("/file", params={"path": str(other)})  # index it too, untagged, so both rows exist
    client.post(f"/files/{fid}/tags", json={"name": "keep"})
    body = client.get("/search", params={"q": "", "tag": "keep"}).json()
    assert [r["filename"] for r in body["results"]] == ["tagged.txt"]


def test_files_pagination(client, sandbox):
    for i in range(5): (sandbox / f"f{i}.txt").write_text("x")
    client.post("/scan", json={})
    assert len(client.get("/files", params={"limit": 2, "offset": 0}).json()) == 2
    assert len(client.get("/files", params={"limit": 2, "offset": 4}).json()) == 1


def test_preview_large_text_bounded_read(client, sandbox):
    big = sandbox / "big.txt"
    big.write_text("x" * (1024 * 1024))
    body = client.get("/preview", params={"path": str(big)}).json()
    assert body["kind"] == "text" and body["truncated"] is True
    assert len(body["content"]) <= 4096
    assert body["total_size"] == big.stat().st_size


def test_index_protected_root_forbidden(client, tmp_path, monkeypatch):
    import backend.config as _config
    protected = tmp_path / "Win"
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [protected])
    r = client.post("/index", json={"path": str(protected)})
    assert r.status_code == 403


def test_index_sandbox_exempt_from_app_dir_like_protected_root(client, sandbox, monkeypatch):
    """Same rationale as test_indexer's counterpart: the sandbox sits inside
    FILEPLUS_APP_DIR (a protected root) and must stay indexable."""
    import backend.config as _config
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [sandbox.parent])
    r = client.post("/index", json={"path": str(sandbox)})
    assert r.status_code == 200 and r.json()["started"] is True


def test_file_meta_on_directory_returns_folder_record(client, sandbox):
    sub = sandbox / "subdir"
    sub.mkdir()
    r = client.get("/file", params={"path": str(sub)})
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "Folder"
    assert body["status"] == "directory"
    assert body["id"] is None
    assert body["size"] is None
    assert body["tags"] == []


def test_index_conflict_while_running(client, sandbox):
    from backend.api import app
    app.state.index_state["running"] = True
    try:
        r = client.post("/index", json={"path": str(sandbox)})
        assert r.status_code == 409
    finally:
        app.state.index_state["running"] = False


def test_tags_listing_carries_file_count(client, sandbox):
    """GET /tags (no q) reports how many files carry each tag — the sidebar's
    Tags section ranks by it and hides a zero-count tag (Stage 2C Task 14)."""
    a = sandbox / "ta.txt"; a.write_text("a")
    b = sandbox / "tb.txt"; b.write_text("b")
    fid_a = client.get("/file", params={"path": str(a)}).json()["id"]
    fid_b = client.get("/file", params={"path": str(b)}).json()["id"]
    client.post(f"/files/{fid_a}/tags", json={"name": "shared"})
    client.post(f"/files/{fid_b}/tags", json={"name": "shared"})
    client.post(f"/files/{fid_a}/tags", json={"name": "solo"})

    counts = {t["name"]: t["count"] for t in client.get("/tags").json()}
    assert counts == {"shared": 2, "solo": 1}

    # A tag every file has since dropped still lists, at count 0.
    tid = next(t["id"] for t in client.get(f"/files/{fid_a}/tags").json() if t["name"] == "solo")
    client.delete(f"/files/{fid_a}/tags/{tid}")
    assert {t["name"]: t["count"] for t in client.get("/tags").json()}["solo"] == 0

    # The q= (prefix search) branch is untouched — no count, same keys as before.
    hit = client.get("/tags", params={"q": "sha"}).json()
    assert [t["name"] for t in hit] == ["shared"] and "count" not in hit[0]


def test_index_search_created_is_epoch_float(client, sandbox):
    """Stage 2D: index-backed /search carries `created` as an epoch float like
    /fs/list and live search (the index stores an ISO string); a bad value is omitted."""
    import sqlite3, time
    from backend import config
    (sandbox / "epoch-me.txt").write_text("x")
    client.post("/index", json={"path": str(sandbox)})
    for _ in range(50):
        if client.get("/index/status").json()["running"] is False:
            break
        time.sleep(0.1)
    hit = client.get("/search", params={"q": "epoch-me"}).json()["results"][0]
    assert isinstance(hit["created"], float)
    assert abs(hit["created"] - (sandbox / "epoch-me.txt").stat().st_ctime) < 2
    con = sqlite3.connect(config.FILEPLUS_DB_PATH)
    con.execute("UPDATE files SET created = 'not a date' WHERE filename = 'epoch-me.txt'")
    con.commit(); con.close()
    hit = client.get("/search", params={"q": "epoch-me"}).json()["results"][0]
    assert "created" not in hit
