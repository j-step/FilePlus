"""FilePlus database layer — async SQLite via aiosqlite with WAL mode.

Provides init_db() to create all tables and handle schema migrations.
SQLite is a cache of filesystem state; the filesystem is the source of truth.
"""
import aiosqlite
import logging
from pathlib import Path

import backend.config as _config

logger = logging.getLogger(__name__)

CURRENT_SCHEMA_VERSION = 2

# ---------------------------------------------------------------------------
# Table definitions — match HANDOFF.md §7.3 exactly
# ---------------------------------------------------------------------------

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
    confidence    REAL    DEFAULT 0.0,
    status        TEXT    DEFAULT 'indexed',
    original_path TEXT,
    is_pinned     INTEGER DEFAULT 0
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
    op_type     TEXT    NOT NULL,
    source_path TEXT,
    dest_path   TEXT,
    timestamp   TEXT    NOT NULL,
    batch_id    TEXT,
    reason      TEXT,
    executed    INTEGER DEFAULT 0,
    undone      INTEGER DEFAULT 0
);
"""

CREATE_SNAPSHOTS = """
CREATE TABLE IF NOT EXISTS snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    created   TEXT    NOT NULL,
    trigger   TEXT,
    label     TEXT,
    tree_json TEXT
);
"""

CREATE_APPROVALS = """
CREATE TABLE IF NOT EXISTS approvals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id       INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    proposed_dest TEXT    NOT NULL,
    confidence    REAL,
    alternatives  TEXT,
    ai_reason     TEXT,
    created       TEXT    NOT NULL,
    resolved      INTEGER DEFAULT 0,
    resolution    TEXT
);
"""

CREATE_TRAINING_SIGNALS = """
CREATE TABLE IF NOT EXISTS training_signals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ai_suggestion TEXT,
    user_choice   TEXT,
    file_context  TEXT,
    timestamp     TEXT
);
"""

CREATE_SCHEMA_VERSION = """
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
);
"""

ALL_TABLES = [
    CREATE_SCHEMA_VERSION,
    CREATE_FILES,
    CREATE_TAGS,
    CREATE_FILE_TAGS,
    CREATE_OPERATIONS_LOG,
    CREATE_SNAPSHOTS,
    CREATE_APPROVALS,
    CREATE_TRAINING_SIGNALS,
]


# ---------------------------------------------------------------------------
# Migration helpers
# ---------------------------------------------------------------------------

async def _get_schema_version(db: aiosqlite.Connection) -> int:
    cursor = await db.execute("SELECT version FROM schema_version LIMIT 1")
    row = await cursor.fetchone()
    return row[0] if row else 0


async def _set_schema_version(db: aiosqlite.Connection, version: int) -> None:
    await db.execute("DELETE FROM schema_version")
    await db.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))


async def _run_migrations(db: aiosqlite.Connection, current: int) -> None:
    """Apply pending migrations in order. Add new migrations at the bottom."""
    if current < 2:
        # v1 → v2: add snapshots, approvals, training_signals; add missing columns
        # New tables are created by CREATE TABLE IF NOT EXISTS above, so only
        # column additions for existing tables are needed here.
        for stmt in (
            "ALTER TABLE files ADD COLUMN is_pinned INTEGER DEFAULT 0",
            "ALTER TABLE operations_log ADD COLUMN reason TEXT",
            "ALTER TABLE operations_log ADD COLUMN executed INTEGER DEFAULT 0",
        ):
            try:
                await db.execute(stmt)
            except Exception:
                # Column already exists — safe to ignore
                pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def init_db(db_path: Path | None = None) -> None:
    """Create all tables and run pending migrations. Safe to call on every startup."""
    if db_path is None:
        db_path = _config.FILEPLUS_DB_PATH
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiosqlite.connect(db_path) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")

        for stmt in ALL_TABLES:
            await db.execute(stmt)

        version = await _get_schema_version(db)
        if version < CURRENT_SCHEMA_VERSION:
            logger.info("Migrating schema v%d → v%d", version, CURRENT_SCHEMA_VERSION)
            await _run_migrations(db, version)
            await _set_schema_version(db, CURRENT_SCHEMA_VERSION)

        await db.commit()
    logger.info("Database initialised at %s", db_path)
