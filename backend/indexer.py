"""FilePlus file indexer — scans directories and populates the files table.

Responsible for:
- Walking the filesystem and recording file metadata in SQLite
- Detecting new, modified, and deleted files on re-scan
- Delegating hashing to hasher.py

Phase 1 implementation target.
"""
import os
import logging
from pathlib import Path

from backend import config  # noqa: F401 — used in Phase 1
from backend import database  # noqa: F401 — used in Phase 1

logger = logging.getLogger(__name__)


async def scan_directory(path: Path) -> None:
    """Walk *path* recursively and upsert every file into the database.

    Args:
        path: Directory to scan. Must pass path_guard() when SAFETY_MODE is on.
    """
    # TODO: implement in Phase 1
    pass


async def index_file(path: Path) -> None:
    """Insert or update a single file record in the database.

    Extracts filename, extension, size, modification time, and hash.

    Args:
        path: Absolute path to the file to index.
    """
    # TODO: implement in Phase 1
    pass


async def remove_stale_entries() -> None:
    """Delete database records for files that no longer exist on disk.

    Should be called after a full scan_directory() pass to keep the index
    in sync with filesystem reality.
    """
    # TODO: implement in Phase 1
    pass
