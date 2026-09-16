from datetime import datetime, timedelta
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_config_roundtrip_and_log(client):
    assert client.get("/config").json() == {}
    r = client.post("/config", json={"key": "ui.theme", "value": "light"}); assert r.status_code == 200
    r = client.post("/config", json={"key": "ui.show_hidden", "value": True})
    assert client.get("/config").json() == {"ui.theme": "light", "ui.show_hidden": True}
    assert client.get("/config/ui.theme").json() == {"key": "ui.theme", "value": "light"}
    assert client.get("/config/nope").status_code == 404
    client.delete("/config/ui.theme")
    assert "ui.theme" not in client.get("/config").json()
    ops = client.get("/operations").json()
    assert ops[0]["op_type"] == "config-change" and ops[0]["source_path"] == "ui.theme"


def test_recent_groups(client, sandbox):
    p = sandbox / "r.txt"; p.write_text("r")
    r = client.post("/recent", json={"path": str(p), "action": "opened"}); assert r.status_code == 200
    body = client.get("/recent").json()
    assert body["groups"][0]["key"] == "today" and body["groups"][0]["files"][0]["name"] == "r.txt"
    assert body["groups"][0]["files"][0]["action"] == "opened"
    client.post("/recent", json={"path": str(p), "action": "modified"})
    files = client.get("/recent").json()["groups"][0]["files"]
    assert len(files) == 1 and files[0]["action"] == "modified"   # one entry per path, latest wins


def test_favorites_crud_and_reorder(client, sandbox):
    a = sandbox / "a.txt"; b = sandbox / "b.txt"; a.write_text("a"); b.write_text("b")
    client.post("/favorites", json={"path": str(a)}); client.post("/favorites", json={"path": str(b)})
    favs = client.get("/favorites").json()["files"]
    assert [f["name"] for f in favs] == ["a.txt", "b.txt"] and favs[0]["position"] == 0
    client.post("/favorites/reorder", json={"paths": [str(b), str(a)]})
    assert [f["name"] for f in client.get("/favorites").json()["files"]] == ["b.txt", "a.txt"]
    r = client.delete("/favorites", params={"path": str(a)}); assert r.status_code == 200
    assert [f["name"] for f in client.get("/favorites").json()["files"]] == ["b.txt"]
    assert client.get("/operations").json()[0]["op_type"] == "favorite-remove"


def test_pins_crud(client, sandbox):
    d = sandbox / "Projects"; d.mkdir()
    r = client.post("/pins", json={"path": str(d)}); pin = r.json()
    assert pin["label"] == "Projects" and pin["position"] == 0
    client.patch(f"/pins/{pin['id']}", json={"label": "Work"})
    assert client.get("/pins").json()[0]["label"] == "Work"
    e = sandbox / "Else"; e.mkdir(); pin2 = client.post("/pins", json={"path": str(e)}).json()
    client.post("/pins/reorder", json={"ids": [pin2["id"], pin["id"]]})
    assert [p["id"] for p in client.get("/pins").json()] == [pin2["id"], pin["id"]]
    client.delete(f"/pins/{pin['id']}")
    assert [p["id"] for p in client.get("/pins").json()] == [pin2["id"]]


def test_favorites_reorder_partial(client, sandbox):
    paths = {}
    for name in "abcd":
        p = sandbox / f"{name}.txt"; p.write_text(name)
        paths[name] = str(p)
        client.post("/favorites", json={"path": paths[name]})
    client.post("/favorites/reorder", json={"paths": [paths["c"], paths["a"]]})
    files = client.get("/favorites").json()["files"]
    assert [f["name"] for f in files] == ["c.txt", "a.txt", "b.txt", "d.txt"]
    assert [f["position"] for f in files] == [0, 1, 2, 3]
    assert len({f["name"] for f in files}) == 4  # no duplicates


def test_pins_reorder_partial(client, sandbox):
    ids = {}
    for name in "abcd":
        d = sandbox / name; d.mkdir()
        ids[name] = client.post("/pins", json={"path": str(d)}).json()["id"]
    client.post("/pins/reorder", json={"ids": [ids["c"], ids["a"]]})
    pins = client.get("/pins").json()
    assert [p["id"] for p in pins] == [ids["c"], ids["a"], ids["b"], ids["d"]]
    assert [p["position"] for p in pins] == [0, 1, 2, 3]
    assert len({p["id"] for p in pins}) == 4  # no duplicates


def test_pins_add_idempotent(client, sandbox):
    d = sandbox / "Projects"; d.mkdir()
    r1 = client.post("/pins", json={"path": str(d)}).json()
    r2 = client.post("/pins", json={"path": str(d)}).json()
    assert r1["id"] == r2["id"]
    assert len(client.get("/pins").json()) == 1
    pin_adds = [o for o in client.get("/operations").json() if o["op_type"] == "pin-add"]
    assert len(pin_adds) == 1


def test_pins_unknown_id_404(client):
    assert client.patch("/pins/999", json={"label": "x"}).status_code == 404
    assert client.delete("/pins/999").status_code == 404


def test_recent_groups_buckets():
    """Pin the bucket boundaries (unit test on the pure function).

    Covers the four fixed points called out in the task brief -- today,
    yesterday, 40 days ago, 400 days ago -- plus the remaining bucket edges,
    all measured against a fixed "now" for determinism.
    """
    from backend.stores import _bucket_for

    now = datetime(2026, 9, 11, 12, 0, 0)  # Friday

    assert _bucket_for(now, now) == ("today", "Today")
    assert _bucket_for(now - timedelta(days=1), now) == ("yesterday", "Yesterday")
    assert _bucket_for(now - timedelta(days=3), now) == ("this-week", "This week")  # Tue, same Mon-start week
    assert _bucket_for(now - timedelta(days=9), now) == ("earlier-this-month", "Earlier this month")  # Sept 2
    assert _bucket_for(now - timedelta(days=40), now) == ("last-month", "Last month")  # Aug 2, 2026
    assert _bucket_for(datetime(2026, 3, 1, 12, 0, 0), now) == ("earlier-this-year", "Earlier this year")
    assert _bucket_for(now - timedelta(days=400), now) == ("year-2025", "2025")  # Aug 7, 2025
    assert _bucket_for(now - timedelta(days=365 * 5), now) == ("ancient", "A long time ago")


def test_recent_and_favorites_carry_real_is_dir(client, sandbox):
    """Pass 2 #36: a folder whose name contains a dot is a folder (is_dir
    True, ext ''), not a ".folder" file -- the renderer keys its per-extension
    icon cache on ext and decides Open-behaviour on is_dir."""
    dotted = sandbox / "my.folder"; dotted.mkdir()
    f = sandbox / "a.txt"; f.write_text("a")
    client.post("/recent", json={"path": str(dotted), "action": "opened"})
    client.post("/recent", json={"path": str(f), "action": "opened"})
    files = {x["name"]: x for x in client.get("/recent").json()["groups"][0]["files"]}
    assert files["my.folder"]["is_dir"] is True and files["my.folder"]["ext"] == ""
    assert files["a.txt"]["is_dir"] is False and files["a.txt"]["ext"] == ".txt"
    client.post("/favorites", json={"path": str(dotted)}); client.post("/favorites", json={"path": str(f)})
    favs = {x["name"]: x for x in client.get("/favorites").json()["files"]}
    assert favs["my.folder"]["is_dir"] is True and favs["my.folder"]["ext"] == ""
    assert favs["a.txt"]["is_dir"] is False
