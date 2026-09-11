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
    assert st["running"] is False and st["count"] >= 1 and st["error"] is None
    hits = client.get("/search", params={"q": "budget"}).json()
    assert hits and hits[0]["filename"] == "budget-2026.xlsx" and hits[0]["hash"] is None   # quick index does not hash


def test_files_pagination(client, sandbox):
    for i in range(5): (sandbox / f"f{i}.txt").write_text("x")
    client.post("/scan", json={})
    assert len(client.get("/files", params={"limit": 2, "offset": 0}).json()) == 2
    assert len(client.get("/files", params={"limit": 2, "offset": 4}).json()) == 1
