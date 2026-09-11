import aiosqlite
import pytest
from backend.database import init_db, CURRENT_SCHEMA_VERSION


async def _columns(db_path, table):
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute(f"PRAGMA table_info({table})")
        return {row[1] for row in await cur.fetchall()}


async def _tables(db_path):
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
        return {row[0] for row in await cur.fetchall()}


async def test_v3_tables_and_columns(db):
    assert CURRENT_SCHEMA_VERSION == 3
    names = await _tables(db)
    for t in ("config", "recent_actions", "favorites", "pinned_folders"):
        assert t in names
    for ix in ("idx_ops_source", "idx_ops_dest", "idx_ops_batch", "idx_file_tags_tag", "idx_files_filename", "idx_recent_ts"):
        assert ix in names
    cols = await _columns(db, "operations_log")
    assert {"error", "undo_of"} <= cols


async def test_migration_from_v2_adds_columns(tmp_path):
    """A v2 database (no error/undo_of columns, no new tables) upgrades in place."""
    db_path = tmp_path / "v2.db"
    async with aiosqlite.connect(db_path) as db:
        await db.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
        await db.execute("INSERT INTO schema_version VALUES (2)")
        await db.execute("""CREATE TABLE operations_log (id INTEGER PRIMARY KEY AUTOINCREMENT, op_type TEXT NOT NULL,
            source_path TEXT, dest_path TEXT, timestamp TEXT NOT NULL, batch_id TEXT, reason TEXT,
            executed INTEGER DEFAULT 0, undone INTEGER DEFAULT 0)""")
        await db.execute("INSERT INTO operations_log (op_type, source_path, timestamp) VALUES ('move','a','2026-01-01')")
        await db.commit()
    await init_db(db_path)
    cols = await _columns(db_path, "operations_log")
    assert {"error", "undo_of"} <= cols
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute("SELECT version FROM schema_version")
        assert (await cur.fetchone())[0] == 3
        cur = await db.execute("SELECT COUNT(*) FROM operations_log")
        assert (await cur.fetchone())[0] == 1  # data preserved
