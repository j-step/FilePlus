"""FilePlus operations log — records and reverses file operations.

Every file operation (move, rename, tag change) is written here before
it happens. This is the basis for per-operation and batch undo.

Undo is implemented by reading the log and reversing the operation:
- move A→B is undone by moving B→A
- batch undo reverses all operations with the same batch_id in LIFO order

Phase 10 implementation target.
"""
import logging
from datetime import datetime, timezone
import uuid

from backend import database  # noqa: F401

logger = logging.getLogger(__name__)


async def log_operation(
    op_type: str,
    source: str,
    dest: str | None,
    batch_id: str | None = None,
) -> int:
    """Insert an operation record and return its id.

    Args:
        op_type:  Operation type string, e.g. 'move', 'rename', 'tag'.
        source:   Source path (or entity) as a string.
        dest:     Destination path (or new value) as a string, if applicable.
        batch_id: UUID string linking related operations; auto-generated if None.

    Returns:
        The integer id of the inserted row.
    """
    # TODO: implement in Phase 10
    pass


async def undo_operation(op_id: int) -> None:
    """Reverse a single logged operation by its id.

    Args:
        op_id: Primary key of the operation to undo.
    """
    # TODO: implement in Phase 10
    pass


async def undo_batch(batch_id: str) -> None:
    """Reverse all operations that share *batch_id* in LIFO order.

    Args:
        batch_id: UUID string identifying the batch.
    """
    # TODO: implement in Phase 10
    pass
