"""FilePlus file hasher — fast content fingerprinting via xxhash.

Uses xxHash (xxh64) for non-cryptographic, high-speed file hashing.
Hashes are stored in the files table and used for deduplication.
"""
import logging
from pathlib import Path

import xxhash

logger = logging.getLogger(__name__)

_CHUNK = 65_536  # 64 KB read chunks


def hash_file(path: Path) -> str:
    """Return the xxh64 hex digest of the file at *path*.

    Reads in 64 KB chunks so large files never load fully into memory.

    Args:
        path: Absolute path to the file.

    Returns:
        16-character hex string (xxh64 digest).

    Raises:
        OSError: If the file cannot be opened or read.
    """
    h = xxhash.xxh64()
    with open(path, "rb") as f:
        while chunk := f.read(_CHUNK):
            h.update(chunk)
    return h.hexdigest()
