"""FilePlus file indexer — scans directories and populates the files table.

Responsible for:
- Walking the filesystem and recording file metadata in SQLite
- Detecting new, modified, and deleted files on re-scan
- Delegating hashing to hasher.py

Every public function calls path_guard() before touching the filesystem.
"""
import asyncio
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

import backend.config as _config
from backend.hasher import hash_file

logger = logging.getLogger(__name__)

# Partial-download extensions to ignore until the file is complete
_SKIP_EXTENSIONS = {".crdownload", ".part", ".tmp"}


def _is_protected(path: Path) -> bool:
    return _config.is_protected_read(path)


async def scan_directory(root: Path, hash: bool = True) -> int:
    """Walk *root* recursively and upsert every file into the database.

    Skips hidden files/dirs (names starting with '.'), partial downloads,
    any directory named ``TRASH_DIRNAME``, and any path under a protected
    write root per ``config.is_protected_read`` (a Windows system root, or
    another protected root such as the app dir -- but never the sandbox,
    even though it lives inside the app dir). Opens a single DB connection
    for the entire walk for efficiency.

    Args:
        root: Directory to scan. Reads are allowed anywhere (path_guard mode="read").
        hash: Whether to compute a content hash for each file (slow; the
            quick-index background scan passes hash=False).

    Returns:
        Number of files indexed during this scan.
    """
    root = _config.path_guard(root)
    count = 0

    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        await conn.execute("PRAGMA foreign_keys=ON")
        for dirpath, dirnames, filenames in os.walk(root):
            # Prune hidden, trash, and protected-root directories in-place so
            # os.walk skips their subtrees entirely.
            dirnames[:] = [
                d for d in dirnames
                if not d.startswith(".")
                and d != _config.TRASH_DIRNAME
                and not _is_protected(Path(dirpath) / d)
            ]
            if _is_protected(Path(dirpath)):
                continue
            for filename in filenames:
                if filename.startswith("."):
                    continue
                if Path(filename).suffix.lower() in _SKIP_EXTENSIONS:
                    continue
                filepath = Path(dirpath) / filename
                try:
                    await index_file(filepath, conn, hash=hash)
                    count += 1
                except Exception as exc:
                    logger.warning("Skipping %s: %s", filepath, exc)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        await conn.execute(
            """
            INSERT INTO index_roots (root, file_count, last_run)
            VALUES (?, ?, ?)
            ON CONFLICT(root) DO UPDATE SET
                file_count = excluded.file_count,
                last_run   = excluded.last_run
            """,
            (str(root), count, now),
        )
        await conn.commit()

    logger.info("Scanned %s: %d files indexed", root, count)
    return count


async def index_file(path: Path, conn: aiosqlite.Connection, hash: bool = True) -> int:
    """Insert or update a single file record in the database.

    Extracts filename, extension, size, creation/modification time, and
    (unless hash=False) a content hash. Uses an upsert so re-scanning a file
    updates it in place; when hash=False the existing stored hash (if any)
    is preserved rather than being overwritten with NULL.

    Args:
        path: Absolute path to the file to index.
        conn: Active aiosqlite connection (caller owns commit).
        hash: Whether to compute a content hash (xxh64). False for the
            quick-index background scan, which trades hashing for speed.

    Returns:
        The row id of the indexed file.

    Raises:
        OSError: If the file cannot be read or hashed.
    """
    path = _config.path_guard(path)
    # stat() and, far more importantly, hash_file() (a chunked read of the
    # whole file) are blocking. GET /file indexes on demand, so hashing a
    # large unindexed file inline would stall every other request on the
    # event loop for the duration of the read.
    stat = await asyncio.to_thread(path.stat)
    file_hash = await asyncio.to_thread(hash_file, path) if hash else None
    created = datetime.fromtimestamp(stat.st_ctime).isoformat()
    modified = datetime.fromtimestamp(stat.st_mtime).isoformat()

    await conn.execute(
        """
        INSERT INTO files
            (path, filename, extension, size, hash, created, modified, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed')
        ON CONFLICT(path) DO UPDATE SET
            filename  = excluded.filename,
            extension = excluded.extension,
            size      = excluded.size,
            hash      = COALESCE(excluded.hash, files.hash),
            created   = excluded.created,
            modified  = excluded.modified,
            status    = excluded.status
        """,
        (
            str(path),
            path.name,
            path.suffix.lower(),
            stat.st_size,
            file_hash,
            created,
            modified,
        ),
    )
    cur = await conn.execute("SELECT id FROM files WHERE path = ?", (str(path),))
    row = await cur.fetchone()
    return row[0]


async def remove_stale_entries(root: Path | None = None) -> int:
    """Delete database records for files that no longer exist on disk.

    Should be called after scan_directory() to keep the index in sync with
    filesystem reality. Filesystem always wins; DB adapts.

    Args:
        root: When given, only rows whose path is under *root* are
            considered — a full scan_directory(root) only walked that
            subtree, so a global stale sweep would wrongly delete rows for
            files that still exist but simply weren't visited this pass.

    Returns:
        Number of stale rows removed.
    """
    removed = 0
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        cursor = await conn.execute("SELECT id, path FROM files")
        rows = await cursor.fetchall()
        for row_id, path_str in rows:
            if root is not None and not _config.is_under(Path(path_str), root):
                continue
            if not Path(path_str).exists():
                await conn.execute("DELETE FROM files WHERE id = ?", (row_id,))
                removed += 1
        await conn.commit()

    if removed:
        logger.info("Removed %d stale entries from index", removed)
    return removed
