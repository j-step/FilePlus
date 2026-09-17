"""Pass-2 backend "api-contracts" regressions (confirmed-findings #21-24,
#180, #182-184).

Each block names the finding it pins. The recurring theme is a response that
promised something the code did not do: a root that was never really removed
from the index, an index that never followed the files the app itself moved,
a status that could not say "it failed", a query string two routes read two
different ways.
"""
import os
from pathlib import Path

import aiosqlite
import pytest
from fastapi.testclient import TestClient

import backend.config as _config
from backend import api, indexer, mover, tagger
from backend.database import init_db


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _mk(root: Path, rel: str, content: str = "x") -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


async def _paths_in_index(db_path) -> set[str]:
    async with aiosqlite.connect(db_path) as c:
        cur = await c.execute("SELECT path FROM files")
        return {r[0] for r in await cur.fetchall()}


async def _row(db_path, path: Path):
    async with aiosqlite.connect(db_path) as c:
        c.row_factory = aiosqlite.Row
        cur = await c.execute("SELECT * FROM files WHERE path = ?", (str(path),))
        row = await cur.fetchone()
        return dict(row) if row else None


# ---------------------------------------------------------------------------
# #21 -- DELETE /index must really stop the root's files answering searches.
# ---------------------------------------------------------------------------

def test_delete_index_drops_rows_for_files_that_still_exist(client, sandbox, db):
    """The old code called remove_stale_entries, which only deletes rows whose
    path has *vanished* -- so a removed root's still-present files kept coming
    back from GET /search, contradicting the confirm modal's promise."""
    kept = sandbox / "keep"
    kept.mkdir()
    _mk(kept, "kept-note.txt")
    forgotten = sandbox / "forget"
    forgotten.mkdir()
    _mk(forgotten, "gone-note.txt")
    _mk(forgotten / "deep", "gone-deep-note.txt")

    assert client.post("/scan", json={"path": str(kept), "hash": False}).status_code == 200
    assert client.post("/scan", json={"path": str(forgotten), "hash": False}).status_code == 200
    names = {r["filename"] for r in client.get("/search", params={"q": "note"}).json()["results"]}
    assert names == {"kept-note.txt", "gone-note.txt", "gone-deep-note.txt"}

    res = client.delete("/index", params={"root": str(forgotten)})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["removed"] == 2  # the real count, not the stale sweep's 0

    # The files are untouched on disk; only the index forgot them.
    assert (forgotten / "gone-note.txt").exists()
    names = {r["filename"] for r in client.get("/search", params={"q": "note"}).json()["results"]}
    assert names == {"kept-note.txt"}
    roots = [r["root"] for r in client.get("/index/status").json()["roots"]]
    assert str(forgotten) not in roots


def test_delete_index_does_not_touch_a_sibling_whose_name_shares_a_prefix(client, sandbox):
    """`forget` must not sweep `forget-me-not` -- and a LIKE wildcard in the
    root's own name (`a_b` vs `aXb`) must be escaped, not honoured."""
    a = sandbox / "a_b"
    a.mkdir()
    _mk(a, "inside.txt")
    b = sandbox / "aXb"
    b.mkdir()
    _mk(b, "sibling.txt")
    for root in (a, b):
        assert client.post("/scan", json={"path": str(root), "hash": False}).status_code == 200

    assert client.delete("/index", params={"root": str(a)}).json()["removed"] == 1
    names = {r["filename"] for r in client.get("/search", params={"q": "txt"}).json()["results"]}
    assert names == {"sibling.txt"}


# ---------------------------------------------------------------------------
# #22 -- a deleted files row must take its file_tags rows with it.
# ---------------------------------------------------------------------------

async def test_remove_stale_entries_does_not_orphan_file_tags(sandbox, db):
    """SQLite enforces foreign keys per connection, so ON DELETE CASCADE did
    nothing here: the orphan inflated GET /tags' count while the tag search
    (an INNER JOIN on files) returned nothing for the same chip."""
    doomed = _mk(sandbox, "doomed.txt")
    await indexer.scan_directory(sandbox, hash=False)
    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT id FROM files WHERE filename = 'doomed.txt'")
        file_id = (await cur.fetchone())[0]
        await tagger.apply_tags(c, file_id, ["invoice"])
        await c.commit()

    doomed.unlink()
    assert await indexer.remove_stale_entries(sandbox) == 1

    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT COUNT(*) FROM file_tags")
        assert (await cur.fetchone())[0] == 0


async def test_forget_root_takes_file_tags_with_it(sandbox, db):
    _mk(sandbox, "tagged.txt")
    await indexer.scan_directory(sandbox, hash=False)
    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT id FROM files WHERE filename = 'tagged.txt'")
        await tagger.apply_tags(c, (await cur.fetchone())[0], ["keep"])
        await c.commit()

    assert await indexer.forget_root(sandbox) == 1
    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT COUNT(*) FROM file_tags")
        assert (await cur.fetchone())[0] == 0


async def test_init_db_sweeps_file_tags_orphaned_by_an_older_build(sandbox, db):
    """Databases that already accumulated orphans are repaired on startup."""
    async with aiosqlite.connect(db) as c:
        await c.execute("INSERT INTO tags (name) VALUES ('ghost')")
        await c.execute("INSERT INTO file_tags (file_id, tag_id) VALUES (424242, 1)")
        await c.commit()

    await init_db(db)

    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT COUNT(*) FROM file_tags")
        assert (await cur.fetchone())[0] == 0


# ---------------------------------------------------------------------------
# #23 -- one search bar, one typed string, one query language.
# ---------------------------------------------------------------------------

def test_index_search_matches_every_word_of_a_multi_word_query(client, sandbox):
    """`report 2024` used to be matched as one literal substring, so a query
    that worked in folder scope returned nothing the moment the `in:` chip
    said This PC."""
    _mk(sandbox, "2024 quarterly report.pdf")
    _mk(sandbox, "unrelated.txt")
    client.post("/scan", json={"path": str(sandbox), "hash": False})

    names = [r["filename"] for r in client.get("/search", params={"q": "report 2024"}).json()["results"]]
    assert names == ["2024 quarterly report.pdf"]

    live = client.get("/fs/search", params={"root": str(sandbox), "q": "report 2024"}).json()
    assert [r["name"] for r in live["results"]] == ["2024 quarterly report.pdf"]


def test_index_search_matches_the_filename_not_the_path(client, sandbox):
    """The live route never consults the path; the index route no longer does
    either, so a folder-name query cannot mean two different things."""
    work = sandbox / "Work"
    work.mkdir()
    _mk(work, "notes.txt")
    client.post("/scan", json={"path": str(sandbox), "hash": False})

    assert client.get("/search", params={"q": "Work"}).json()["results"] == []
    live = client.get("/fs/search", params={"root": str(sandbox), "q": "Work"}).json()
    assert [r["name"] for r in live["results"]] == ["Work"]  # the folder itself, not its contents


def test_index_search_treats_like_wildcards_in_the_query_as_literals(client, sandbox):
    """`%` and `_` are legal Windows filename characters; searcher does a
    literal find, so the SQL half must escape them rather than match anything."""
    _mk(sandbox, "50% off.txt")
    _mk(sandbox, "50X off.txt")
    client.post("/scan", json={"path": str(sandbox), "hash": False})

    names = [r["filename"] for r in client.get("/search", params={"q": "50% off"}).json()["results"]]
    assert names == ["50% off.txt"]


# ---------------------------------------------------------------------------
# #24 -- GET /file must not hash a huge file inline (fixed in backend-perf;
# pinned here because it is an api-contracts finding too).
# ---------------------------------------------------------------------------

def test_file_meta_skips_the_inline_hash_for_a_large_unindexed_file(client, sandbox, monkeypatch):
    big = _mk(sandbox, "big.bin", "x")
    monkeypatch.setattr(api, "_ONDEMAND_HASH_MAX_BYTES", 0)
    body = client.get("/file", params={"path": str(big)}).json()
    assert body["hash"] is None

    small = _mk(sandbox, "small.bin", "y")
    monkeypatch.setattr(api, "_ONDEMAND_HASH_MAX_BYTES", 1024)
    assert client.get("/file", params={"path": str(small)}).json()["hash"]


# ---------------------------------------------------------------------------
# #180 -- every /fs mutation reconciles the index it invalidates.
# ---------------------------------------------------------------------------

async def test_rename_moves_the_index_row_with_the_file(conn, sandbox, db):
    doc = _mk(sandbox, "doc-00.txt")
    await indexer.scan_directory(sandbox, hash=False)
    assert str(doc) in await _paths_in_index(db)

    await mover.rename(conn, doc, "zzz.txt")

    paths = await _paths_in_index(db)
    assert str(doc) not in paths
    assert str(sandbox / "zzz.txt") in paths
    row = await _row(db, sandbox / "zzz.txt")
    assert row["filename"] == "zzz.txt" and row["extension"] == ".txt"


async def test_renaming_a_folder_carries_its_whole_subtree(conn, sandbox, db):
    folder = sandbox / "old"
    folder.mkdir()
    _mk(folder / "deep", "leaf.txt")
    await indexer.scan_directory(sandbox, hash=False)

    await mover.rename(conn, folder, "new")

    paths = await _paths_in_index(db)
    assert paths == {str(sandbox / "new" / "deep" / "leaf.txt")}


async def test_move_follows_the_file_to_its_new_folder(conn, sandbox, db):
    dest = sandbox / "dest"
    dest.mkdir()
    src = _mk(sandbox, "moved.txt")
    await indexer.scan_directory(sandbox, hash=False)

    await mover.move(conn, src, dest)

    assert await _paths_in_index(db) == {str(dest / "moved.txt")}


async def test_a_trashed_file_stops_answering_searches_but_keeps_its_tags(client, conn, sandbox, db):
    """A trash is undoable, so the row (and its tags) survives -- marked
    'trashed' and filtered out of GET /search rather than deleted."""
    doomed = _mk(sandbox, "secret-plan.txt")
    await indexer.scan_directory(sandbox, hash=False)
    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT id FROM files WHERE filename = 'secret-plan.txt'")
        await tagger.apply_tags(c, (await cur.fetchone())[0], ["keep"])
        await c.commit()

    res = await mover.trash(conn, doomed)
    assert client.get("/search", params={"q": "secret-plan"}).json()["results"] == []
    async with aiosqlite.connect(db) as c:
        cur = await c.execute("SELECT COUNT(*) FROM file_tags")
        assert (await cur.fetchone())[0] == 1

    # ...and undoing the trash puts it back, tags and all.
    await mover.restore(conn, res["dest"], str(doomed))
    names = [r["filename"] for r in client.get("/search", params={"q": "secret-plan"}).json()["results"]]
    assert names == ["secret-plan.txt"]


async def test_emptying_the_trash_drops_the_rows_for_good(conn, sandbox, db, monkeypatch):
    doomed = _mk(sandbox, "bye.txt")
    await indexer.scan_directory(sandbox, hash=False)
    await mover.trash(conn, doomed)
    monkeypatch.setattr(mover, "_send2trash", lambda p: None)

    await mover.empty_trash(conn)

    assert await _paths_in_index(db) == set()


async def test_a_failed_reconcile_never_fails_the_operation(conn, sandbox, db, monkeypatch):
    """The filesystem is the source of truth and the move already happened, so
    a DB hiccup here is logged, not turned into a 5xx for a move that worked."""
    doc = _mk(sandbox, "resilient.txt")
    await indexer.scan_directory(sandbox, hash=False)

    async def boom(*a, **kw):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(mover.indexer, "reindex_move", boom)
    res = await mover.rename(conn, doc, "renamed.txt")
    assert res["status"] == "done"
    assert (sandbox / "renamed.txt").exists()


# ---------------------------------------------------------------------------
# #182 -- GET /index/status must be able to say "it failed".
# ---------------------------------------------------------------------------

def test_index_status_reports_the_recorded_index_error(client):
    body = client.get("/index/status").json()
    assert body["error"] is None
    assert set(body) >= {"roots", "running", "error", "path", "count", "started"}

    from backend.api import app
    app.state.index_state.update({"running": False, "error": "OSError: device not ready", "path": "E:\\"})
    body = client.get("/index/status").json()
    assert body["error"] == "OSError: device not ready"
    assert body["path"] == "E:\\"
    app.state.index_state["error"] = None


def test_a_failing_quick_index_records_its_error(client, sandbox, monkeypatch):
    async def boom(*a, **kw):
        raise OSError("the device is not ready")

    monkeypatch.setattr(api, "scan_directory", boom)
    assert client.post("/index", json={"path": str(sandbox)}).status_code == 200
    for _ in range(200):
        body = client.get("/index/status").json()
        if not body["running"]:
            break
    assert body["running"] is False
    assert "not ready" in (body["error"] or "")


# ---------------------------------------------------------------------------
# #183 -- GET /search reports truncation instead of leaving the renderer to
# guess it from the row count.
# ---------------------------------------------------------------------------

def test_index_search_returns_a_real_truncated_flag(client, sandbox):
    for i in range(5):
        _mk(sandbox, f"page-{i}.txt")
    client.post("/scan", json={"path": str(sandbox), "hash": False})

    body = client.get("/search", params={"q": "page", "limit": 2}).json()
    assert len(body["results"]) == 2
    assert body["truncated"] is True

    body = client.get("/search", params={"q": "page", "limit": 50}).json()
    assert len(body["results"]) == 5
    assert body["truncated"] is False


def test_truncated_is_false_when_the_limit_lands_exactly_on_the_match_count(client, sandbox):
    """The old renderer-side guess (`len(results) >= limit`) said True here."""
    for i in range(3):
        _mk(sandbox, f"exact-{i}.txt")
    client.post("/scan", json={"path": str(sandbox), "hash": False})

    body = client.get("/search", params={"q": "exact", "limit": 3}).json()
    assert len(body["results"]) == 3
    assert body["truncated"] is False


def test_whole_word_truncation_is_reported_from_the_scan_cap(client, sandbox, monkeypatch):
    for i in range(6):
        _mk(sandbox, f"word {i}.txt")
    client.post("/scan", json={"path": str(sandbox), "hash": False})
    monkeypatch.setattr(api, "_SEARCH_SCAN_CAP", 3)

    body = client.get("/search", params={"q": "word", "whole_word": "true", "limit": 50}).json()
    assert body["truncated"] is True


# ---------------------------------------------------------------------------
# #184 -- renaming a drive root is a clean refusal, not a bare 500.
# ---------------------------------------------------------------------------

async def test_renaming_a_drive_root_is_refused_not_a_value_error(conn, sandbox, monkeypatch):
    """Path.with_name() raises a bare ValueError for a path with no name, and
    api.py has no handler for it -- so it escaped as a 500 with a non-JSON
    body and a meaningless 'Internal Server Error' toast."""
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    root = Path(os.path.splitdrive(str(sandbox))[0] + os.sep)

    with pytest.raises(mover.RefusedError):
        await mover.rename(conn, root, "NewName")


def test_rename_route_answers_409_for_a_drive_root(client, sandbox, monkeypatch):
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    root = os.path.splitdrive(str(sandbox))[0] + os.sep
    res = client.post("/fs/rename", json={"path": root, "new_name": "NewName"})
    assert res.status_code == 409
    assert "detail" in res.json()
