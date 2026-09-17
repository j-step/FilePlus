"""Regression tests for the pass-2 "backend-perf" findings.

Each test names the finding index it pins. The recurring shape is "this
blocking call must not run on the event loop": those tests await the route
coroutine directly (so the loop thread *is* the main thread) and assert the
blocking work was recorded on some other thread.
"""
import asyncio
import json
import sqlite3
import threading
from pathlib import Path

import aiosqlite
import pytest
from fastapi.testclient import TestClient

import backend.config as _config
from backend import api, indexer, mover, operations_log as ol, searcher


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


async def _search(**kw):
    """api.search_files with every Query default spelled out.

    The route coroutine is awaited directly (no TestClient) so the event loop
    runs on the test's own thread, which is what makes the "off the loop"
    assertions below meaningful -- but that also means FastAPI never fills in
    the Query() defaults, so they live here.
    """
    args = dict(q="", type_=None, ext=None, modified_after=None, modified_before=None,
                created_after=None, created_before=None, min_size=None, max_size=None,
                tag=None, hidden=False, whole_word=False, limit=50)
    args.update(kw)
    return await api.search_files(**args)


async def _fs_search(**kw):
    """api.fs_search with every Query default spelled out -- see _search."""
    args = dict(q="", type_=None, ext=None, modified_after=None, modified_before=None,
                created_after=None, created_before=None, min_size=None, max_size=None,
                tag=None, hidden=False, whole_word=False, limit=500)
    args.update(kw)
    return await api.fs_search(**args)


def _off_loop(recorder: dict) -> bool:
    """True when the recorded thread was not the one running the test's loop."""
    return recorder.get("thread") is not None and recorder["thread"] is not threading.main_thread()


# ---------------------------------------------------------------------------
# #64 -- the indexer's filesystem work never runs on the event loop
# ---------------------------------------------------------------------------

async def test_scan_walk_and_hash_run_off_the_event_loop(sandbox, db, monkeypatch):
    (sandbox / "a").mkdir()
    (sandbox / "a" / "one.txt").write_text("one")
    (sandbox / "two.txt").write_text("two")

    walk_threads: set = set()
    hash_threads: set = set()
    real_is_protected = indexer._is_protected
    real_hash = indexer.hash_file

    def spy_is_protected(path):
        walk_threads.add(threading.current_thread())
        return real_is_protected(path)

    def spy_hash(path):
        hash_threads.add(threading.current_thread())
        return real_hash(path)

    monkeypatch.setattr(indexer, "_is_protected", spy_is_protected)
    monkeypatch.setattr(indexer, "hash_file", spy_hash)

    assert await indexer.scan_directory(sandbox) == 2
    assert walk_threads and threading.main_thread() not in walk_threads
    assert hash_threads and threading.main_thread() not in hash_threads


async def test_get_file_does_not_hash_a_large_file_inline(sandbox, db, monkeypatch):
    """A selection of big media files fires one GET /file each; hashing them
    inline is what used to freeze the backend for the length of the read."""
    big = sandbox / "movie.mp4"
    big.write_bytes(b"x" * 64)
    monkeypatch.setattr(api, "_ONDEMAND_HASH_MAX_BYTES", 8)

    hashed = []
    monkeypatch.setattr(indexer, "hash_file", lambda p: hashed.append(p) or "nope")

    data = await api.file_meta(path=str(big))
    assert data["hash"] is None and hashed == []

    small = sandbox / "note.txt"
    small.write_text("s")
    assert (await api.file_meta(path=str(small)))["hash"]


# ---------------------------------------------------------------------------
# #65 -- the scan commits per chunk instead of holding one write transaction
# ---------------------------------------------------------------------------

async def test_scan_commits_between_chunks(sandbox, db, monkeypatch):
    for i in range(5):
        (sandbox / f"f{i}.txt").write_text(str(i))
    monkeypatch.setattr(indexer, "_WALK_BATCH", 2)

    seen_by_another_connection: list[int] = []
    real_next = indexer._next_chunk

    def spy(walker, size):
        chunk = real_next(walker, size)
        # A *separate* connection: rows are only visible here once the scan's
        # transaction has been committed.
        with sqlite3.connect(_config.FILEPLUS_DB_PATH) as probe:
            seen_by_another_connection.append(probe.execute("SELECT COUNT(*) FROM files").fetchone()[0])
        return chunk

    monkeypatch.setattr(indexer, "_next_chunk", spy)
    assert await indexer.scan_directory(sandbox, hash=False) == 5
    # First probe sees nothing, later ones see the earlier chunks already
    # committed -- with one transaction for the whole walk every probe saw 0.
    assert seen_by_another_connection[0] == 0
    assert max(seen_by_another_connection) >= 2


def test_a_busy_database_answers_503_not_500(client, monkeypatch):
    def boom(*_a, **_k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(api.ol, "list_operations", boom)
    r = client.get("/files/history", params={"path": str(_config.FILEPLUS_SANDBOX_PATH / "x.txt")})
    assert r.status_code == 503 and r.headers.get("Retry-After") == "1"


def test_a_non_busy_database_error_is_500_not_a_traceback(client, monkeypatch):
    def boom(*_a, **_k):
        raise sqlite3.OperationalError("no such column: nope")

    monkeypatch.setattr(api.ol, "list_operations", boom)
    r = client.get("/files/history", params={"path": str(_config.FILEPLUS_SANDBOX_PATH / "x.txt")})
    assert r.status_code == 500


# ---------------------------------------------------------------------------
# #66 / #120 -- type and tag filters are applied before the row cap
# ---------------------------------------------------------------------------

_BULK = 5001


async def _seed_bulk(db_path: Path) -> None:
    """5000 .txt rows that sort first, plus one .png that sorts last."""
    rows = [(f"C:\\bulk\\aaa{i:05d}.txt", f"aaa{i:05d}.txt", ".txt", 1, "2026-01-01T00:00:00")
            for i in range(_BULK - 1)]
    rows.append(("C:\\bulk\\zzz.png", "zzz.png", ".png", 1, "2026-01-01T00:00:00"))
    async with aiosqlite.connect(db_path) as conn:
        await conn.executemany(
            "INSERT INTO files (path, filename, extension, size, modified, status) "
            "VALUES (?, ?, ?, ?, ?, 'indexed')", rows)
        await conn.commit()


async def test_type_filter_survives_the_row_cap(sandbox, db):
    await _seed_bulk(db)
    body = await _search(type_="image")
    assert [r["filename"] for r in body["results"]] == ["zzz.png"]


async def test_tag_filter_survives_the_row_cap(sandbox, db):
    await _seed_bulk(db)
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT id FROM files WHERE filename = 'zzz.png'")
        file_id = (await cur.fetchone())[0]
        from backend import tagger
        await tagger.apply_tags(conn, file_id, ["keep"])
        await conn.commit()
    body = await _search(tag="keep")
    assert [r["filename"] for r in body["results"]] == ["zzz.png"]


async def test_hidden_filter_is_applied_in_sql(sandbox, db):
    async with aiosqlite.connect(db) as conn:
        await conn.executemany(
            "INSERT INTO files (path, filename, extension, size, modified, status) "
            "VALUES (?, ?, ?, ?, ?, 'indexed')",
            [("C:\\h\\.secret", ".secret", "", 1, "2026-01-01T00:00:00"),
             ("C:\\h\\plain.txt", "plain.txt", ".txt", 1, "2026-01-01T00:00:00")])
        await conn.commit()
    assert [r["filename"] for r in (await _search())["results"]] == ["plain.txt"]
    shown = {r["filename"] for r in (await _search(hidden=True))["results"]}
    assert shown == {".secret", "plain.txt"}


async def test_an_unknown_type_group_still_matches_nothing(sandbox, db):
    await _seed_bulk(db)
    assert (await _search(type_="not-a-group"))["results"] == []


async def test_files_with_no_extension_belong_to_the_other_group(sandbox, db):
    async with aiosqlite.connect(db) as conn:
        await conn.executemany(
            "INSERT INTO files (path, filename, extension, size, modified, status) "
            "VALUES (?, ?, ?, ?, ?, 'indexed')",
            [("C:\\o\\README", "README", "", 1, "2026-01-01T00:00:00"),
             ("C:\\o\\a.txt", "a.txt", ".txt", 1, "2026-01-01T00:00:00")])
        await conn.commit()
    assert [r["filename"] for r in (await _search(type_="other"))["results"]] == ["README"]


# ---------------------------------------------------------------------------
# #67 -- path_guard runs off the event loop (a UNC resolve can block for ~20s)
# ---------------------------------------------------------------------------

async def test_routes_guard_paths_off_the_event_loop(sandbox, db, monkeypatch):
    rec: dict = {}
    real = api.path_guard

    def spy(path, mode="read"):
        rec["thread"] = threading.current_thread()
        return real(path, mode)

    monkeypatch.setattr(api, "path_guard", spy)
    await api.fs_list(path=str(sandbox))
    assert _off_loop(rec)


async def test_mutations_guard_paths_off_the_event_loop(sandbox, db, monkeypatch):
    rec: dict = {}
    real = _config.path_guard

    def spy(path, mode="read"):
        rec["thread"] = threading.current_thread()
        return real(path, mode)

    monkeypatch.setattr(_config, "path_guard", spy)
    async with aiosqlite.connect(db) as conn:
        await mover.mkdir(conn, sandbox, "made")
    assert _off_loop(rec)


# ---------------------------------------------------------------------------
# #68 -- is_protected_read is not paid once per walked directory
# ---------------------------------------------------------------------------

def test_search_tree_checks_protection_once_per_walk(tmp_path, monkeypatch):
    root = tmp_path / "t"
    for name in ("a", "b", "c"):
        (root / name / "deep").mkdir(parents=True)
        (root / name / "deep" / "doc.txt").write_text("x")

    calls = []
    real = searcher.config.is_protected_read
    monkeypatch.setattr(searcher.config, "is_protected_read",
                        lambda p: (calls.append(p), real(p))[1])
    r = searcher.search_tree(root, searcher.SearchFilters(q="doc"))
    assert len(r["results"]) == 3
    assert len(calls) == 1  # the walk root only; 7 directories were visited


# ---------------------------------------------------------------------------
# #69 -- remove_stale_entries narrows in SQL, probes off-loop, deletes in bulk
# ---------------------------------------------------------------------------

async def test_remove_stale_entries_keeps_rows_outside_the_root(sandbox, db):
    inside = sandbox / "gone.txt"
    outside = sandbox.parent / "elsewhere.txt"
    outside.write_text("still here")
    async with aiosqlite.connect(db) as conn:
        await conn.executemany(
            "INSERT INTO files (path, filename, extension, size, modified, status) "
            "VALUES (?, ?, ?, ?, ?, 'indexed')",
            [(str(inside), "gone.txt", ".txt", 1, "2026-01-01T00:00:00"),
             (str(outside), "elsewhere.txt", ".txt", 1, "2026-01-01T00:00:00")])
        await conn.commit()

    assert await indexer.remove_stale_entries(sandbox) == 1
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT path FROM files")
        assert [r[0] for r in await cur.fetchall()] == [str(outside)]


async def test_remove_stale_entries_escapes_like_wildcards_in_the_root(sandbox, db):
    """An underscore is a legal filename character and a LIKE wildcard; an
    unescaped prefix would sweep a sibling folder's rows as well."""
    root = sandbox / "a_b"
    root.mkdir()
    sibling = sandbox / "aXb"
    sibling.mkdir()
    (sibling / "alive.txt").write_text("alive")
    async with aiosqlite.connect(db) as conn:
        await conn.executemany(
            "INSERT INTO files (path, filename, extension, size, modified, status) "
            "VALUES (?, ?, ?, ?, ?, 'indexed')",
            [(str(root / "gone.txt"), "gone.txt", ".txt", 1, "2026-01-01T00:00:00"),
             (str(sibling / "alive.txt"), "alive.txt", ".txt", 1, "2026-01-01T00:00:00")])
        await conn.commit()

    assert await indexer.remove_stale_entries(root) == 1
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT path FROM files")
        assert [r[0] for r in await cur.fetchall()] == [str(sibling / "alive.txt")]


async def test_remove_stale_entries_probes_the_filesystem_off_the_loop(sandbox, db, monkeypatch):
    rec: dict = {}
    real = indexer._missing_paths

    def spy(rows):
        rec["thread"] = threading.current_thread()
        return real(rows)

    monkeypatch.setattr(indexer, "_missing_paths", spy)
    async with aiosqlite.connect(db) as conn:
        await conn.execute(
            "INSERT INTO files (path, filename, extension, size, modified, status) "
            "VALUES (?, ?, ?, ?, ?, 'indexed')",
            (str(sandbox / "x.txt"), "x.txt", ".txt", 1, "2026-01-01T00:00:00"))
        await conn.commit()
    await indexer.remove_stale_entries(sandbox)
    assert _off_loop(rec)


# ---------------------------------------------------------------------------
# #70 -- the upsert returns the row id; no second SELECT
# ---------------------------------------------------------------------------

async def test_index_file_returns_the_row_id_from_the_upsert(sandbox, db):
    f = sandbox / "id.txt"
    f.write_text("a")
    async with aiosqlite.connect(db) as conn:
        first = await indexer.index_file(f, conn)
        f.write_text("bb")
        second = await indexer.index_file(f, conn)
        await conn.commit()
        cur = await conn.execute("SELECT id, size FROM files WHERE path = ?", (str(f),))
        row = await cur.fetchone()
    assert first == second == row[0] and row[1] == 2


# ---------------------------------------------------------------------------
# #71 / #119 -- empty_trash probes drives and enumerates batches off the loop
# ---------------------------------------------------------------------------

async def test_empty_trash_probes_and_enumerates_off_the_loop(sandbox, db, monkeypatch):
    trash_root = sandbox / _config.TRASH_DIRNAME
    (trash_root / "batch-1").mkdir(parents=True)
    probe: dict = {}
    listing: dict = {}
    real_contents = mover._trash_contents

    def spy_roots():
        probe["thread"] = threading.current_thread()
        return [trash_root]

    def spy_contents(roots):
        listing["thread"] = threading.current_thread()
        return real_contents(roots)

    monkeypatch.setattr(mover, "_known_trash_roots", spy_roots)
    monkeypatch.setattr(mover, "_trash_contents", spy_contents)
    monkeypatch.setattr(mover, "_send2trash", lambda p: None)
    async with aiosqlite.connect(db) as conn:
        res = await mover.empty_trash(conn)
    assert res["batches"] == 1
    assert _off_loop(probe) and _off_loop(listing)


# ---------------------------------------------------------------------------
# #73 -- GET /files is always paginated
# ---------------------------------------------------------------------------

def test_files_has_a_bounded_default_limit(client, db):
    conn = sqlite3.connect(_config.FILEPLUS_DB_PATH)
    conn.executemany(
        "INSERT INTO files (path, filename, extension, size, modified, status) "
        "VALUES (?, ?, ?, ?, ?, 'indexed')",
        [(f"C:\\m\\f{i:04d}.txt", f"f{i:04d}.txt", ".txt", 1, "2026-01-01T00:00:00")
         for i in range(250)])
    conn.commit(); conn.close()

    assert len(client.get("/files").json()) == api._DEFAULT_FILES_LIMIT
    assert len(client.get("/files", params={"limit": 10}).json()) == 10
    assert client.get("/files", params={"limit": api._MAX_FILES_LIMIT + 1}).status_code == 422


# ---------------------------------------------------------------------------
# #110 / #111 -- known-folders and preview do their blocking work off the loop
# ---------------------------------------------------------------------------

async def test_known_folders_runs_off_the_event_loop(sandbox, db, monkeypatch):
    rec: dict = {}

    def spy():
        rec["thread"] = threading.current_thread()
        return {}

    monkeypatch.setattr(api.winshell, "known_folders", spy)
    await api.known_folders()
    assert _off_loop(rec)


async def test_preview_reads_off_the_event_loop_and_stats_once(sandbox, db, monkeypatch):
    f = sandbox / "note.txt"
    f.write_text("hello preview")
    read_rec: dict = {}
    stat_rec: dict = {}
    real_read, real_facts = api._read_head, api._entry_facts
    stats = []

    def spy_read(path, n):
        read_rec["thread"] = threading.current_thread()
        return real_read(path, n)

    def spy_facts(path):
        stat_rec["thread"] = threading.current_thread()
        stats.append(path)
        return real_facts(path)

    monkeypatch.setattr(api, "_read_head", spy_read)
    monkeypatch.setattr(api, "_entry_facts", spy_facts)
    body = await api.preview(path=str(f))
    assert body["kind"] == "text" and body["content"] == "hello preview"
    assert body["total_size"] == len("hello preview") and body["truncated"] is False
    assert _off_loop(read_rec) and _off_loop(stat_rec)
    assert len(stats) == 1  # one stat, not two


# ---------------------------------------------------------------------------
# #112 -- a batch trash does not re-read the whole manifest per item
# ---------------------------------------------------------------------------

async def test_batch_trash_writes_one_manifest_without_rereading_it(sandbox, db, monkeypatch):
    mover._MANIFEST_CACHE.clear()
    paths = []
    for i in range(3):
        p = sandbox / f"d{i}.txt"
        p.write_text(str(i))
        paths.append(p)

    loads = []
    real_loads = mover.json.loads
    monkeypatch.setattr(mover.json, "loads", lambda *a, **k: (loads.append(1), real_loads(*a, **k))[1])

    async with aiosqlite.connect(db) as conn:
        res = await mover.batch_trash(conn, paths)
    appended_reads = len(loads)  # snapshot before this test does its own json.loads
    assert len(res["ops"]) == 3

    root = mover.trash_root_for(paths[0])
    mf = mover.manifest_path_for(root, res["batch_id"])
    items = json.loads(mf.read_text(encoding="utf-8"))["items"]
    assert [Path(i["original"]).name for i in items] == ["d0.txt", "d1.txt", "d2.txt"]
    assert appended_reads == 0  # the manifest was never re-parsed while being appended to


# ---------------------------------------------------------------------------
# #114 / #115 -- /fs/list sorts before it truncates, and serialises directly
# ---------------------------------------------------------------------------

async def test_fs_list_truncates_after_sorting(sandbox, db, monkeypatch):
    for name in ("z5.txt", "z1.txt", "z3.txt"):
        (sandbox / name).write_text("x")
    (sandbox / "bdir").mkdir()
    monkeypatch.setattr(_config, "LISTING_CAP", 2)
    body = json.loads((await api.fs_list(path=str(sandbox))).body)
    assert [e["name"] for e in body["entries"]] == ["bdir", "z1.txt"]
    assert body["truncated"] is True


async def test_fs_list_bounds_the_scan_itself(sandbox, db, monkeypatch):
    for i in range(5):
        (sandbox / f".hidden{i}").write_text("x")
    monkeypatch.setattr(api, "_LIST_SCAN_CAP", 2)
    body = json.loads((await api.fs_list(path=str(sandbox))).body)
    assert body["truncated"] is True


def test_fs_list_still_answers_json(client, sandbox):
    (sandbox / "one.txt").write_text("x")
    r = client.get("/fs/list", params={"path": str(sandbox)})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert [e["name"] for e in r.json()["entries"]] == ["one.txt"]


# ---------------------------------------------------------------------------
# #116 / #117 -- the indexes the hot queries actually need
# ---------------------------------------------------------------------------

async def test_schema_has_the_nocase_and_pending_indexes(db):
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
        names = {r[0] for r in await cur.fetchall()}
    assert {"idx_files_filename_nocase", "idx_ops_pending"} <= names


async def test_search_ordering_uses_the_nocase_index(db):
    async with aiosqlite.connect(db) as conn:
        cur = await conn.execute(
            "EXPLAIN QUERY PLAN SELECT id FROM files ORDER BY filename COLLATE NOCASE LIMIT 10")
        plan = " ".join(str(r[-1]) for r in await cur.fetchall())
    assert "idx_files_filename_nocase" in plan and "TEMP B-TREE" not in plan.upper()


async def test_count_pending_matches_pending_operations(db):
    async with aiosqlite.connect(db) as conn:
        await ol.log_operation(conn, "move", "a", "b")
        op_id = await ol.log_operation(conn, "move", "c", "d")
        await ol.mark_executed(conn, op_id)
        assert await ol.count_pending(conn) == len(await ol.pending_operations(conn)) == 1


# ---------------------------------------------------------------------------
# #118 -- a cross-volume move walks the source tree once, not twice
# ---------------------------------------------------------------------------

async def test_cross_volume_move_sizes_the_tree_once(sandbox, db, monkeypatch):
    src = sandbox / "tree"
    (src / "sub").mkdir(parents=True)
    (src / "sub" / "a.txt").write_text("A")
    (sandbox / "dst").mkdir()

    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    calls = []
    real = mover._tree_size
    monkeypatch.setattr(mover, "_tree_size", lambda p: (calls.append(p), real(p))[1])

    async with aiosqlite.connect(db) as conn:
        r = await mover.move(conn, src, sandbox / "dst")
    assert r["status"] == "done" and (sandbox / "dst" / "tree" / "sub" / "a.txt").read_text() == "A"
    assert len(calls) == 1


# ---------------------------------------------------------------------------
# #120 -- /fs/search normalises the tag path set off the event loop
# ---------------------------------------------------------------------------

async def test_fs_search_normalises_tag_paths_off_the_loop(sandbox, db, monkeypatch):
    f = sandbox / "tagged.txt"
    f.write_text("x")
    async with aiosqlite.connect(db) as conn:
        from backend import tagger
        file_id = await indexer.index_file(f, conn, hash=False)
        await tagger.apply_tags(conn, file_id, ["keep"])
        await conn.commit()

    rec: dict = {}
    real = searcher.normalize_path

    def spy(p):
        rec["thread"] = threading.current_thread()
        return real(p)

    monkeypatch.setattr(api.searcher, "normalize_path", spy)
    body = await _fs_search(root=str(sandbox), q="tagged", tag="keep")
    assert [r["name"] for r in body["results"]] == ["tagged.txt"]
    assert _off_loop(rec)
