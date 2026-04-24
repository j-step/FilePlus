"""FilePlus file mover — safe, logged file move operations.

All moves are:
1. Validated against path_guard() before execution
2. Logged to operations_log BEFORE the filesystem operation
3. Atomic where possible (same-volume moves use os.rename)

Never deletes files. Moves to trash or a staging area instead.

Phase 10 implementation target (safety + undo integration).
"""
import logging
from pathlib import Path

from backend import config  # noqa: F401
from backend import operations_log  # noqa: F401

logger = logging.getLogger(__name__)

# shutil imported at call site
# import shutil


async def move_file(src: Path, dest: Path) -> None:
    """Move a single file from *src* to *dest*.

    Validates paths, logs the operation, then performs the move.

    Args:
        src:  Absolute source path. Must pass path_guard().
        dest: Absolute destination path. Must pass path_guard().
    """
    # TODO: implement in Phase 10
    pass


async def batch_move(moves: list[tuple[Path, Path]]) -> str:
    """Move multiple files as a single logged batch.

    Args:
        moves: List of (source, destination) path tuples.

    Returns:
        batch_id string that can be used to undo the entire batch at once.
    """
    # TODO: implement in Phase 10
    pass
