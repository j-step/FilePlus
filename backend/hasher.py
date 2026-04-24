"""FilePlus file hasher — fast content fingerprinting via xxhash.

Uses xxHash (xxh64) for non-cryptographic, high-speed file hashing.
Hashes are stored in the files table and used for deduplication.

Phase 1 implementation target.
"""
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# xxhash imported at call site to avoid hard failure if not yet installed
# import xxhash


def hash_file(path: Path) -> str:
    """Return the xxh64 hex digest of the file at *path*.

    Args:
        path: Absolute path to the file.

    Returns:
        Hex string of the xxh64 hash (16 characters).
    """
    # TODO: implement in Phase 1
    pass
