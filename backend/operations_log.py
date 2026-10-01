"""FilePlus operations log — every mutation is written here BEFORE it happens.

Rows are created with executed=0, marked executed after the action succeeds,
marked with an error message if it raises. Undo creates a new inverse row
(undo_of=<original id>) and flags the original undone=1. Reconciliation at
startup classifies rows left at executed=0 by a crash.
"""
from __future__ import annotations

import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

from backend.errors import RefusedError

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
    # Every operation passes through here BEFORE it runs (CLAUDE.md safety
    # rules), so this one line puts every move/rename/copy/trash/restore/tag/
    # config change in backend.log with its source and destination.
    logger.info("op #%s %s: %s -> %s%s%s", cur.lastrowid, op_type, source, dest,
                f" batch={batch_id}" if batch_id else "", f" undo_of={undo_of}" if undo_of else "")
    return cur.lastrowid


async def mark_executed(conn, op_id: int) -> None:
    await conn.execute("UPDATE operations_log SET executed = 1, error = NULL WHERE id = ?", (op_id,))
    await conn.commit()


async def mark_error(conn, op_id: int, message: str) -> None:
    logger.warning("op #%s failed: %s", op_id, message)
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


async def get_operation_by_undo_of(conn, undo_of: int) -> dict | None:
    """Return the most recently logged operation whose undo_of == *undo_of*.

    Used by backend.mover's undo of a DB-only op (tag/favorite/pin): the
    mutating function (backend.tagger / backend.stores) logs the fresh
    inverse row itself and doesn't hand its id back up, so it's looked up
    here by its undo_of back-reference instead. Each undo_operation call
    passes a distinct original op id as undo_of, so this is unambiguous even
    when several undos share one batch_id (undo_batch).
    """
    cur = await conn.execute(
        f"SELECT {_COLS} FROM operations_log WHERE undo_of = ? ORDER BY id DESC LIMIT 1", (undo_of,))
    r = await cur.fetchone()
    return _row(r) if r else None


async def list_batch(conn, batch_id: str) -> list[dict]:
    cur = await conn.execute(f"SELECT {_COLS} FROM operations_log WHERE batch_id = ? ORDER BY id DESC", (batch_id,))
    return [_row(r) for r in await cur.fetchall()]


async def pending_operations(conn) -> list[dict]:
    cur = await conn.execute(f"SELECT {_COLS} FROM operations_log WHERE executed = 0 AND error IS NULL ORDER BY id")
    return [_row(r) for r in await cur.fetchall()]


async def count_pending(conn) -> int:
    """How many operations are logged but not yet executed.

    Same predicate as pending_operations, but counted in SQL. /health polls
    for this number every few seconds and operations_log is append-only and
    never pruned, so materialising every pending row just to call len() on
    the list meant a growing full scan on every poll. Served by the partial
    index idx_ops_pending (backend/database.py).
    """
    cur = await conn.execute("SELECT COUNT(*) FROM operations_log WHERE executed = 0 AND error IS NULL")
    row = await cur.fetchone()
    return row[0] if row else 0


def _state_resolution(row: dict) -> str | None:
    """Classify a crashed attr-set / folder-type-set row by re-reading disk.

    These op types carry a source path but no dest path, so the generic
    src/dst existence heuristic below would always call them "not-started" --
    which is a lie for a write that actually landed, and (because
    reconciliation records that as an error) permanently blocks undo of a
    change the user can see. The forward op logs both the before and the
    after state in `reason`, so the current state answers the question
    directly. Returns None when the row can't be classified this way and the
    generic heuristic should run instead.
    """
    src = row["source_path"]
    if not src or not Path(src).exists():
        return None
    try:
        data = json.loads(row["reason"] or "{}")
    except ValueError:
        return None
    from backend import winshell  # local import: winshell is Windows-only and heavier

    t = row["op_type"]
    try:
        if t == "attr-set":
            if data.get("before") is None or data.get("after") is None:
                return None  # malformed row: fall back to the generic heuristic
            current = winshell.get_attributes(Path(src))["bits"]
            before, after = data["before"], data["after"]
        elif t == "folder-type-set":
            if "after" not in data:
                return None
            # before_ini None is legitimate here: "the folder had no
            # desktop.ini", which reads back as folder type None.
            current = winshell.read_folder_type(Path(src))
            before = winshell.folder_type_from_ini_bytes(
                base64.b64decode(data["before_ini"]) if data.get("before_ini") is not None else None)
            after = data["after"]
        else:
            return None
    except (OSError, ValueError, RefusedError):
        return "ambiguous"
    if current == after:
        return "completed"
    if current == before:
        return "not-started"
    return "ambiguous"


async def reconcile_pending(conn) -> list[dict]:
    """Classify crash leftovers. Only op types with a source and dest path are inspected."""
    out = []
    for row in await pending_operations(conn):
        src, dst = row["source_path"], row["dest_path"]
        src_exists = bool(src) and Path(src).exists()
        dst_exists = bool(dst) and Path(dst).exists()
        t = row["op_type"]
        state = _state_resolution(row) if t in ("attr-set", "folder-type-set") else None
        if state is not None:
            resolution = state
            if resolution == "completed":
                await mark_executed(conn, row["id"])
            else:
                await mark_error(conn, row["id"], resolution)
        elif t.endswith(":final") or t.split("-")[0] in ("config", "tag", "favorite", "pin"):
            await mark_error(conn, row["id"], "not-started"); resolution = "not-started"
        elif src_exists and not dst_exists:
            await mark_error(conn, row["id"], "not-started"); resolution = "not-started"
        elif dst_exists and not src_exists:
            await mark_executed(conn, row["id"]); resolution = "completed"
        elif not src and not dst_exists:
            await mark_error(conn, row["id"], "not-started"); resolution = "not-started"   # mkdir/touch never started
        else:
            await mark_error(conn, row["id"], "ambiguous"); resolution = "ambiguous"
        logger.warning("reconciled op %s (%s %s -> %s): %s", row["id"], row["op_type"], src, dst, resolution)
        out.append({**row, "resolution": resolution})
    return out
