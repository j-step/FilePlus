"""Nexus database layer — async SQLite via aiosqlite with WAL mode.

Provides init_db() to create all tables and handle schema migrations.
Single source of indexed state; filesystem is the true source of reality.
"""
import aiosqlite
import logging
from pathlib import Path
from backend.config import NEXUS_DB_PATH

logger = logging.getLogger(__name__)

CURRENT_SCHEMA_VERSION = 1

CREATE_FILES = """
CREATE TABLE IF NOT EXISTS files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    path          TEXT    UNIQUE NOT NULL,
    filename      TEXT    NOT NULL,
    extension     TEXT,
    size          INTEGER,
    hash          TEXT,
    created       TEXT,
    modified      TEXT,
    category      TEXT,
    confidence    REAL,
    status        TEXT    NOT NULL DEFAULT 'active',
    original_path TEXT
);
"""

CREATE_TAGS = """
CREATE TABLE IF NOT EXISTS tags (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    UNIQUE NOT NULL,
    color     TEXT,
    tag_group TEXT,
    tag_type  TEXT
);
"""

CREATE_FILE_TAGS = """
CREATE TABLE IF NOT EXISTS file_tags (
    file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (file_id, tag_id)
);
"""

CREATE_OPERATIONS_LOG = """
CREATE TABLE IF NOT EXISTS operations_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    op_type     TEXT NOT NULL,
    source_path TEXT NOT NULL,
    dest_path   TEXT,
    timestamp   TEXT NOT NULL,
    batch_id    TEXT,
    undone      INTEGER NOT NULL DEFAULT 0
);
"""

CREATE_SCHEMA_VERSION = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);
"""


async def get_schema_version(db: aiosqlite.Connection) -> int:
    cursor = await db.execute("SELECT version FROM schema_version LIMIT 1")
    row = await cursor.fetchone()
    return row[0] if row else 0


async def set_schema_version(db: aiosqlite.Connection, version: int) -> None:
    await db.execute("DELETE FROM schema_version")
    await db.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))


async def run_migrations(db: aiosqlite.Connection, current: int) -> None:
    """Apply any pending migrations in order."""
    # Future migrations go here:
    # if current < 2:
    #     await db.execute("ALTER TABLE files ADD COLUMN ...")
    #     current = 2
    pass


async def init_db(db_path: Path = NEXUS_DB_PATH) -> None:
    """Create all tables and run pending migrations. Safe to call on every startup."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(db_path) as db:
        # Enable WAL mode for concurrent reads
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        # Create all tables
        await db.execute(CREATE_SCHEMA_VERSION)
        await db.execute(CREATE_FILES)
        await db.execute(CREATE_TAGS)
        await db.execute(CREATE_FILE_TAGS)
        await db.execute(CREATE_OPERATIONS_LOG)

        # Handle migrations
        version = await get_schema_version(db)
        if version < CURRENT_SCHEMA_VERSION:
            logger.info(f"Migrating schema from v{version} to v{CURRENT_SCHEMA_VERSION}")
            await run_migrations(db, version)
            await set_schema_version(db, CURRENT_SCHEMA_VERSION)

        await db.commit()
    logger.info(f"Database initialised at {db_path}")
