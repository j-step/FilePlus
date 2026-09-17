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


# How many files one walk chunk carries back from the worker thread, and how
# many indexed files one write transaction holds before it commits. Both are
# the same number on purpose: the walk chunk is exactly the unit of work
# between commits, so the SQLite write lock is never held across a
# filesystem walk step.
_WALK_BATCH = 500


def _walk_files(root: Path):
    """Yield every indexable file under *root* (a blocking os.walk generator).

    Pruning matches scan_directory's contract: hidden names, the trash
    directory, protected roots, and partial-download extensions are skipped.
    Synchronous on purpose -- scan_directory pulls it in chunks from a worker
    thread so os.walk never runs on the event loop.
    """
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
            yield Path(dirpath) / filename


def _next_chunk(walker, size: int) -> list[Path]:
    """Drain up to *size* paths from *walker*. Runs in a worker thread."""
    out: list[Path] = []
    for path in walker:
        out.append(path)
        if len(out) >= size:
            break
    return out


async def scan_directory(root: Path, hash: bool = True) -> int:
    """Walk *root* recursively and upsert every file into the database.

    Skips hidden files/dirs (names starting with '.'), partial downloads,
    any directory named ``TRASH_DIRNAME``, and any path under a protected
    write root per ``config.is_protected_read`` (a Windows system root, or
    another protected root such as the app dir -- but never the sandbox,
    even though it lives inside the app dir). Opens a single DB connection
    for the entire walk for efficiency.

    The walk itself (``os.walk``, plus the per-directory protection checks)
    is blocking, so it runs in a worker thread and hands back chunks of
    ``_WALK_BATCH`` paths at a time -- the event loop stays free to serve
    other requests while a whole-drive scan is in progress. Each chunk is
    committed before the next one is fetched, so the SQLite write lock is
    released ``_WALK_BATCH`` files at a time instead of being held for the
    entire scan (which made every concurrent write fail with "database is
    locked").

    Args:
        root: Directory to scan. Reads are allowed anywhere (path_guard mode="read").
        hash: Whether to compute a content hash for each file (slow; the
            quick-index background scan passes hash=False).

    Returns:
        Number of files indexed during this scan.
    """
    root = await asyncio.to_thread(_config.path_guard, root)
    count = 0
    walker = _walk_files(root)

    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        await conn.execute("PRAGMA foreign_keys=ON")
        while True:
            chunk = await asyncio.to_thread(_next_chunk, walker, _WALK_BATCH)
            if not chunk:
                break
            for filepath in chunk:
                try:
                    await index_file(filepath, conn, hash=hash)
                    count += 1
                except Exception as exc:
                    logger.warning("Skipping %s: %s", filepath, exc)
            await conn.commit()  # release the write lock between chunks
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


def _file_facts(path: Path, want_hash: bool) -> tuple[Path, os.stat_result, str | None]:
    """Guard, stat and (optionally) hash *path* -- all the blocking work
    index_file needs, gathered into one worker-thread dispatch.

    path_guard resolves the path (a filesystem touch of its own), stat() hits
    the disk, and hash_file() is a chunked read of the whole file. GET /file
    indexes on demand, so doing any of this on the event loop would stall
    every other request for the duration of the read.
    """
    resolved = _config.path_guard(path)
    stat = resolved.stat()
    return resolved, stat, (hash_file(resolved) if want_hash else None)


async def index_file(path: Path, conn: aiosqlite.Connection, hash: bool = True) -> int:
    """Insert or update a single file record in the database.

    Extracts filename, extension, size, creation/modification time, and
    (unless hash=False) a content hash. Uses an upsert so re-scanning a file
    updates it in place; when hash=False the existing stored hash (if any)
    is preserved rather than being overwritten with NULL.

    The guard/stat/hash trio runs in one ``asyncio.to_thread`` call (see
    _file_facts), and the row id comes back from the upsert's ``RETURNING id``
    rather than a second SELECT -- one DB round trip per file, not two.

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
    path, stat, file_hash = await asyncio.to_thread(_file_facts, path, hash)
    created = datetime.fromtimestamp(stat.st_ctime).isoformat()
    modified = datetime.fromtimestamp(stat.st_mtime).isoformat()

    cur = await conn.execute(
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
        RETURNING id
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
    row = await cur.fetchone()
    return row[0]


_LIKE_ESCAPE = "!"


def _like_prefix(root: Path) -> str:
    r"""A LIKE pattern matching *root* itself and everything under it.

    ``%`` / ``_`` / the escape character are legal in Windows filenames, so
    they are escaped (ESCAPE '!') rather than left to act as wildcards.
    """
    prefix = os.path.normpath(str(root)).rstrip("\\/")
    for ch in (_LIKE_ESCAPE, "%", "_"):
        prefix = prefix.replace(ch, _LIKE_ESCAPE + ch)
    return prefix


def _missing_paths(rows: list[tuple[int, str]]) -> list[int]:
    """Row ids whose path no longer exists. Runs in a worker thread."""
    return [row_id for row_id, path_str in rows if not os.path.exists(path_str)]


# ---------------------------------------------------------------------------
# Index reconciliation -- the files table follows what the app does to disk.
#
# backend.mover performs every mutation and is the only other module that
# needs the index to move with it; these helpers keep every write to `files`
# inside this module (see module docstring) so there is still exactly one
# writer of that table.
# ---------------------------------------------------------------------------

async def _delete_file_rows(conn: aiosqlite.Connection, where: str, params: tuple) -> int:
    """Delete `files` rows matching *where*, taking their file_tags with them.

    ``file_tags.file_id`` is declared ``ON DELETE CASCADE``, but SQLite
    enforces foreign keys *per connection* and only connections that ran
    ``PRAGMA foreign_keys=ON`` get the cascade. Callers hand in whatever
    connection they already hold (backend.api's `_db()` does not set the
    pragma), so the join rows are deleted explicitly rather than hoped for:
    an orphaned file_tags row inflates GET /tags' count while
    tagger.paths_for_tag -- an INNER JOIN on `files` -- cannot see it, so the
    sidebar chip and the `tag:` search it runs disagree forever.
    """
    await conn.execute(
        f"DELETE FROM file_tags WHERE file_id IN (SELECT id FROM files WHERE {where})", params)
    cur = await conn.execute(f"DELETE FROM files WHERE {where}", params)
    return cur.rowcount or 0


def _self_and_descendants(path: Path) -> tuple[str, str]:
    """(normalised path, LIKE pattern for everything strictly under it)."""
    return (os.path.normpath(str(path)),
            _like_prefix(path) + os.sep + "%")


async def forget_rows_under(conn: aiosqlite.Connection, root: Path) -> int:
    """Drop every `files` row at *root* or under it, existing or not.

    Unlike remove_stale_entries this never consults the disk: it is what
    "forget this root" (DELETE /index) and "the trash was emptied"
    (mover.empty_trash) mean -- the rows go whether or not the files are
    still there.
    """
    exact, pattern = _self_and_descendants(root)
    return await _delete_file_rows(
        conn,
        f"path = ? COLLATE NOCASE OR path LIKE ? ESCAPE '{_LIKE_ESCAPE}'",
        (exact, pattern),
    )


async def forget_root(root: Path) -> int:
    """forget_rows_under on its own connection, committed. For DELETE /index."""
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        removed = await forget_rows_under(conn, root)
        await conn.commit()
    if removed:
        logger.info("Forgot %d indexed rows under %s", removed, root)
    return removed


async def reindex_move(conn: aiosqlite.Connection, src: Path, dest: Path,
                       *, status: str | None = None) -> int:
    """Point the index at *dest* after *src* was moved/renamed there.

    Rewrites the row for *src* itself (path, filename, extension) and the
    path prefix of every row beneath it, so a folder rename carries its whole
    subtree. Any row already recorded at *dest* is dropped first: the
    destination was replaced, and `files.path` is UNIQUE.

    *status* is written alongside when given -- mover uses 'trashed' so a
    trashed file stops answering This-PC searches without losing its tags,
    and 'indexed' to put it back when the trash is undone.

    Returns the number of rows rewritten (0 when nothing under *src* was
    indexed, which is the common case).
    """
    src_exact, src_pattern = _self_and_descendants(src)
    dest_exact, dest_pattern = _self_and_descendants(dest)
    await _delete_file_rows(
        conn,
        f"path = ? COLLATE NOCASE OR path LIKE ? ESCAPE '{_LIKE_ESCAPE}'",
        (dest_exact, dest_pattern),
    )
    extra = ", status = ?" if status else ""
    tail = (status,) if status else ()
    cur = await conn.execute(
        f"UPDATE files SET path = ? || substr(path, ?){extra} "
        f"WHERE path LIKE ? ESCAPE '{_LIKE_ESCAPE}'",
        (dest_exact, len(src_exact) + 1) + tail + (src_pattern,),
    )
    rewritten = cur.rowcount or 0
    cur = await conn.execute(
        f"UPDATE files SET path = ?, filename = ?, extension = ?{extra} "
        "WHERE path = ? COLLATE NOCASE",
        (dest_exact, dest.name, dest.suffix.lower()) + tail + (src_exact,),
    )
    return rewritten + (cur.rowcount or 0)


async def remove_stale_entries(root: Path | None = None) -> int:
    """Delete database records for files that no longer exist on disk.

    Should be called after scan_directory() to keep the index in sync with
    filesystem reality. Filesystem always wins; DB adapts.

    When *root* is given the candidate rows are narrowed in SQL with a
    prefix LIKE instead of loading the whole files table and filtering in
    Python; ``config.is_under`` still has the final say on every returned
    row, so the SQL pattern can only ever be *broader* than the real
    containment test (SQLite's LIKE folds ASCII case, which is exactly what
    is_under's normcase does for ASCII paths) -- it never widens what gets
    deleted. The existence probes run in one worker thread rather than one
    blocking ``exists()`` per row on the event loop, and the deletes go out
    as chunked ``DELETE ... WHERE id IN (...)`` statements rather than one
    statement per stale row.

    Args:
        root: When given, only rows whose path is under *root* are
            considered -- a full scan_directory(root) only walked that
            subtree, so a global stale sweep would wrongly delete rows for
            files that still exist but simply weren't visited this pass.

    Returns:
        Number of stale rows removed.
    """
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        # Foreign keys are per-connection in SQLite: without this, the DELETE
        # below leaves file_tags rows pointing at ids that no longer exist
        # (scan_directory sets the same pragma for the same reason).
        await conn.execute("PRAGMA foreign_keys=ON")
        if root is None:
            cursor = await conn.execute("SELECT id, path FROM files")
            rows = list(await cursor.fetchall())
        else:
            prefix = _like_prefix(root)
            cursor = await conn.execute(
                f"SELECT id, path FROM files WHERE path = ? OR path LIKE ? ESCAPE '{_LIKE_ESCAPE}'",
                (os.path.normpath(str(root)), prefix + os.sep + "%"),
            )
            rows = [r for r in await cursor.fetchall()
                    if _config.is_under(Path(r[1]), root)]

        stale_ids = await asyncio.to_thread(_missing_paths, [(r[0], r[1]) for r in rows])
        for start in range(0, len(stale_ids), 500):
            chunk = stale_ids[start:start + 500]
            placeholders = ",".join("?" * len(chunk))
            await conn.execute(f"DELETE FROM file_tags WHERE file_id IN ({placeholders})", chunk)
            await conn.execute(f"DELETE FROM files WHERE id IN ({placeholders})", chunk)
        await conn.commit()
    removed = len(stale_ids)

    if removed:
        logger.info("Removed %d stale entries from index", removed)
    return removed
