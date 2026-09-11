"""FilePlus operations log — every mutation is written here BEFORE it happens.

Rows are created with executed=0, marked executed after the action succeeds,
marked with an error message if it raises. Undo creates a new inverse row
(undo_of=<original id>) and flags the original undone=1. Reconciliation at
startup classifies rows left at executed=0 by a crash.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

logger = logging.getLogger(__name__)

_COLS = "id, op_type, source_path, dest_path, timestamp, batch_id, reason, executed, undone, error, undo_of"


def new_batch_id() -> str:
    return uuid.uuid4().hex


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row(r) -> dict:
    return dict(zip(_COLS.replace(" ", "").split(","), tuple(r)))


async def log_operation(conn: aiosqlite.Connection, op_type: str, source: str | None, dest: str | None = None,
                        batch_id: str | None = None, reason: str | None = None, undo_of: int | None = None) -> int:
    cur = await conn.execute(
        "INSERT INTO operations_log (op_type, source_path, dest_path, timestamp, batch_id, reason, executed, undone, undo_of)"
        " VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)",
        (op_type, source, dest, _now(), batch_id, reason, undo_of),
    )
    await conn.commit()
    return cur.lastrowid


async def mark_executed(conn, op_id: int) -> None:
    await conn.execute("UPDATE operations_log SET executed = 1, error = NULL WHERE id = ?", (op_id,))
    await conn.commit()


async def mark_error(conn, op_id: int, message: str) -> None:
    await conn.execute("UPDATE operations_log SET error = ? WHERE id = ?", (message[:500], op_id))
    await conn.commit()


async def mark_undone(conn, op_id: int) -> None:
    await conn.execute("UPDATE operations_log SET undone = 1 WHERE id = ?", (op_id,))
    await conn.commit()


async def get_operation(conn, op_id: int) -> dict | None:
    cur = await conn.execute(f"SELECT {_COLS} FROM operations_log WHERE id = ?", (op_id,))
    r = await cur.fetchone()
    return _row(r) if r else None


async def list_operations(conn, limit: int = 50, offset: int = 0, path: str | None = None) -> list[dict]:
    if path:
        cur = await conn.execute(
            f"SELECT {_COLS} FROM operations_log WHERE source_path = ? OR dest_path = ? ORDER BY id DESC LIMIT ? OFFSET ?",
            (path, path, limit, offset))
    else:
        cur = await conn.execute(f"SELECT {_COLS} FROM operations_log ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
    return [_row(r) for r in await cur.fetchall()]


async def list_batch(conn, batch_id: str) -> list[dict]:
    cur = await conn.execute(f"SELECT {_COLS} FROM operations_log WHERE batch_id = ? ORDER BY id DESC", (batch_id,))
    return [_row(r) for r in await cur.fetchall()]


async def pending_operations(conn) -> list[dict]:
    cur = await conn.execute(f"SELECT {_COLS} FROM operations_log WHERE executed = 0 AND error IS NULL ORDER BY id")
    return [_row(r) for r in await cur.fetchall()]


async def reconcile_pending(conn) -> list[dict]:
    """Classify crash leftovers. Only op types with a source and dest path are inspected."""
    out = []
    for row in await pending_operations(conn):
        src, dst = row["source_path"], row["dest_path"]
        src_exists = bool(src) and Path(src).exists()
        dst_exists = bool(dst) and Path(dst).exists()
        if dst_exists and not src_exists:
            await mark_executed(conn, row["id"]); resolution = "completed"
        elif src_exists and not dst_exists:
            await mark_error(conn, row["id"], "not-started"); resolution = "not-started"
        else:
            await mark_error(conn, row["id"], "ambiguous"); resolution = "ambiguous"
        logger.warning("reconciled op %s (%s %s -> %s): %s", row["id"], row["op_type"], src, dst, resolution)
        out.append({**row, "resolution": resolution})
    return out
