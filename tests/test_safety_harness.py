"""Dev harness phase 4: the three safety rules, tested end to end on a fresh
copy of the messy fixture tree (tests/conftest.py `fixture_tree`).

1. Nothing moves without an explicit request. Today the only thing that moves
   a file is a user action through a mutation route; every read path
   (listing, search, peek, preview, properties, icons, scan, index) must
   leave the tree byte-identical and log no file operation. The automatic
   path -- the Everything-Folder watcher proposing a move that waits for an
   approval -- is Stage 3 and documented as strict xfail in test_watcher.py.
2. Every operation is written to operations_log BEFORE it executes.
3. Undo restores the original state.
"""
import hashlib
import sqlite3
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.config as _config
from backend import mover

FILE_OP_TYPES = ("move", "rename", "copy", "trash", "restore", "mkdir", "touch", "attr-set",
                 "folder-type-set", "trash-empty:final")


def _snapshot(root: Path) -> dict:
    """relative path -> ('dir',) or ('file', size, sha256) for everything under root."""
    out = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if p.is_dir():
            out[rel] = ("dir",)
        else:
            out[rel] = ("file", p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest())
    return out


def _file_ops(db_path: Path) -> list[tuple]:
    with sqlite3.connect(db_path) as c:
        marks = ",".join("?" * len(FILE_OP_TYPES))
        return c.execute(f"SELECT id, op_type, source_path, dest_path FROM operations_log WHERE op_type IN ({marks})",
                         FILE_OP_TYPES).fetchall()


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_read_paths_never_move_or_change_a_file(client, fixture_tree, sandbox):
    before = _snapshot(fixture_tree)
    pics, docs = fixture_tree / "Pictures", fixture_tree / "Documents"
    assert client.get("/fs/list", params={"path": str(fixture_tree)}).status_code == 200
    assert client.get("/fs/search", params={"root": str(fixture_tree), "q": "doc"}).status_code == 200
    assert client.get("/fs/peek", params={"path": str(pics), "n": 2}).status_code == 200
    assert client.get("/preview", params={"path": str(docs / "doc-00.txt")}).status_code == 200
    assert client.get("/file", params={"path": str(docs / "doc-00.txt")}).status_code == 200
    assert client.get("/fs/properties", params={"path": str(docs / "doc-00.txt")}).status_code == 200
    assert client.post("/shell/icons", json={"items": [{"path": str(pics), "px": 16, "is_dir": True}]}).status_code == 200
    assert client.post("/scan", json={"path": str(fixture_tree), "hash": True}).status_code in (200, 202)
    assert client.post("/index", json={"path": str(fixture_tree)}).status_code in (200, 202)
    for _ in range(100):  # the index runs in the background
        if not client.get("/index/status").json().get("running"):
            break
        time.sleep(0.05)
    assert _snapshot(fixture_tree) == before
    assert _file_ops(_config.FILEPLUS_DB_PATH) == []


def test_every_file_operation_is_logged_before_it_executes(client, fixture_tree, monkeypatch):
    """Wrap the 'act' step of mover._perform (the single log -> act -> mark
    protocol every mutation shares) and look in the database at the moment
    the filesystem is about to change: the row must already be there, with
    executed=0."""
    seen = []
    real_perform = mover._perform
    db_path = _config.FILEPLUS_DB_PATH

    async def spying_perform(conn, op_type, src, dest, batch_id, reason, fn, undo_of=None):
        def act():
            with sqlite3.connect(db_path) as c:
                row = c.execute("SELECT op_type, executed, source_path, dest_path FROM operations_log "
                                "ORDER BY id DESC LIMIT 1").fetchone()
            seen.append((op_type, row))
            return fn()
        return await real_perform(conn, op_type, src, dest, batch_id, reason, act, undo_of=undo_of)

    monkeypatch.setattr(mover, "_perform", spying_perform)
    docs, dl = fixture_tree / "Documents", fixture_tree / "Downloads"
    assert client.post("/fs/rename", json={"path": str(docs / "doc-00.txt"), "new_name": "renamed.txt"}).status_code == 200
    assert client.post("/fs/move", json={"sources": [str(docs / "doc-01.txt")], "dest": str(dl)}).json()["ops"]
    assert client.post("/fs/copy", json={"sources": [str(docs / "doc-02.txt")], "dest": str(dl)}).json()["ops"]
    assert client.post("/fs/trash", json={"paths": [str(docs / "doc-03.txt")]}).json()["ops"]
    assert client.post("/fs/mkdir", json={"dir": str(fixture_tree), "name": "New folder"}).status_code == 200

    assert [op for op, _ in seen] == ["rename", "move", "copy", "trash", "mkdir"]
    for op_type, row in seen:
        assert row is not None and row[0] == op_type, (op_type, row)
        assert row[1] == 0, f"{op_type} acted before its log row existed as pending"
    # ...and every one was marked executed afterwards.
    with sqlite3.connect(db_path) as c:
        assert c.execute("SELECT COUNT(*) FROM operations_log WHERE executed = 0").fetchone()[0] == 0


def test_undo_restores_the_original_tree(client, fixture_tree):
    before = _snapshot(fixture_tree)
    docs, dl, pics = fixture_tree / "Documents", fixture_tree / "Downloads", fixture_tree / "Pictures"
    op_ids = []
    op_ids.append(client.post("/fs/rename", json={"path": str(docs / "todo.md"), "new_name": "done.md"}).json()["ops"][0]["op_id"])
    op_ids += [o["op_id"] for o in client.post("/fs/move", json={"sources": [str(pics / "IMG_0001.png"), str(docs / "ノート.md")],
                                                                    "dest": str(dl)}).json()["ops"]]
    op_ids += [o["op_id"] for o in client.post("/fs/copy", json={"sources": [str(docs / "contract.pdf")], "dest": str(dl)}).json()["ops"]]
    op_ids += [o["op_id"] for o in client.post("/fs/trash", json={"paths": [str(fixture_tree / "Projects")]}).json()["ops"]]
    op_ids.append(client.post("/fs/mkdir", json={"dir": str(fixture_tree), "name": "Sorted"}).json()["ops"][0]["op_id"])
    assert len(op_ids) == 6
    assert _snapshot(fixture_tree) != before

    for op_id in reversed(op_ids):
        r = client.post(f"/operations/{op_id}/undo")
        assert r.status_code == 200, (op_id, r.text)

    assert _snapshot(fixture_tree) == before
