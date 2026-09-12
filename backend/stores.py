"""FilePlus small-state stores: config, recent actions, favorites, pinned folders.

Same log-then-act-then-mark protocol as backend.mover, but these are DB-only
mutations so no thread offload (asyncio.to_thread) is needed -- everything
here runs directly against aiosqlite.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import aiosqlite

from backend import operations_log as ol

RECENT_CAP = 1000


def _now() -> str:
    # Microsecond precision (not operations_log's "seconds") so that two
    # recent_actions rows for the same path inserted in quick succession
    # don't tie on ts -- recent_groups relies on MAX(ts) to pick the latest.
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

async def config_get_all(conn: aiosqlite.Connection) -> dict:
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT key, value FROM config ORDER BY key")
    rows = await cur.fetchall()
    return {r["key"]: json.loads(r["value"]) for r in rows}


async def config_get(conn: aiosqlite.Connection, key: str) -> Any | None:
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT value FROM config WHERE key = ?", (key,))
    row = await cur.fetchone()
    if row is None:
        return None
    return json.loads(row["value"])


async def config_set(conn: aiosqlite.Connection, key: str, value: Any) -> None:
    encoded = json.dumps(value)
    op_id = await ol.log_operation(conn, "config-change", key, encoded[:200])
    await conn.execute(
        "INSERT INTO config (key, value, updated) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
        (key, encoded, _now()),
    )
    await conn.commit()
    await ol.mark_executed(conn, op_id)


async def config_delete(conn: aiosqlite.Connection, key: str) -> None:
    op_id = await ol.log_operation(conn, "config-change", key, None, reason="delete")
    await conn.execute("DELETE FROM config WHERE key = ?", (key,))
    await conn.commit()
    await ol.mark_executed(conn, op_id)


# ---------------------------------------------------------------------------
# Recent actions
# ---------------------------------------------------------------------------

async def recent_add(conn: aiosqlite.Connection, path: str, action: str) -> None:
    await conn.execute(
        "INSERT INTO recent_actions (path, action, ts) VALUES (?, ?, ?)",
        (path, action, _now()),
    )
    await conn.execute(
        "DELETE FROM recent_actions WHERE id NOT IN "
        "(SELECT id FROM recent_actions ORDER BY id DESC LIMIT ?)",
        (RECENT_CAP,),
    )
    await conn.commit()


def _bucket_for(ts: datetime, now: datetime) -> tuple[str, str]:
    """Classify a local-time timestamp against "now" (also local time).

    Buckets, in order: today, yesterday, this-week (Monday-start, excluding
    today/yesterday), earlier-this-month, last-month, earlier-this-year,
    year-<N> for each of the previous three calendar years, else ancient.
    """
    today_date = now.date()
    ts_date = ts.date()

    if ts_date == today_date:
        return "today", "Today"
    if ts_date == today_date - timedelta(days=1):
        return "yesterday", "Yesterday"

    week_start = today_date - timedelta(days=today_date.weekday())  # Monday
    if week_start <= ts_date < today_date - timedelta(days=1):
        return "this-week", "This week"

    if ts_date.year == today_date.year and ts_date.month == today_date.month:
        return "earlier-this-month", "Earlier this month"

    last_month_year = today_date.year if today_date.month > 1 else today_date.year - 1
    last_month_month = today_date.month - 1 if today_date.month > 1 else 12
    if ts_date.year == last_month_year and ts_date.month == last_month_month:
        return "last-month", "Last month"

    if ts_date.year == today_date.year:
        return "earlier-this-year", "Earlier this year"

    for back in (1, 2, 3):
        if ts_date.year == today_date.year - back:
            return f"year-{ts_date.year}", str(ts_date.year)

    return "ancient", "A long time ago"


_BUCKET_ORDER = [
    "today", "yesterday", "this-week", "earlier-this-month", "last-month",
    "earlier-this-year", "year-", "ancient",
]


def _bucket_sort_key(key: str) -> tuple[int, int]:
    """Sort buckets in display order; year-<N> buckets sort by year, descending."""
    if key.startswith("year-"):
        return (len(_BUCKET_ORDER) - 1, -int(key.split("-", 1)[1]))
    return (_BUCKET_ORDER.index(key), 0)


async def recent_groups(conn: aiosqlite.Connection, limit: int = 200) -> dict:
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute(
        "SELECT path, action, MAX(ts) AS ts FROM recent_actions GROUP BY path ORDER BY ts DESC LIMIT ?",
        (limit,),
    )
    rows = await cur.fetchall()

    now = datetime.now()
    labels: dict[str, str] = {}
    buckets: dict[str, list[dict]] = {}

    for row in rows:
        ts_raw = row["ts"]
        # ts is stored in UTC ISO format; convert to local time for bucketing.
        stored = datetime.fromisoformat(ts_raw)
        local_ts = stored.astimezone().replace(tzinfo=None) if stored.tzinfo is not None else stored
        key, label = _bucket_for(local_ts, now)
        if key not in buckets:
            buckets[key] = []
            labels[key] = label
        p = row["path"]
        buckets[key].append({
            "path": p,
            "name": Path(p).name,
            "ext": Path(p).suffix.lower(),
            "action": row["action"],
            "action_at": ts_raw,
        })

    ordered_keys = sorted(buckets.keys(), key=_bucket_sort_key)
    groups = [{"key": k, "label": labels[k], "files": buckets[k]} for k in ordered_keys]
    return {"groups": groups}


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------

def _file_entry(path: str, extra: dict) -> dict:
    return {
        "path": path,
        "name": Path(path).name,
        "ext": Path(path).suffix.lower(),
        **extra,
    }


async def favorites_list(conn: aiosqlite.Connection) -> dict:
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT id, path, position, created FROM favorites ORDER BY position")
    rows = await cur.fetchall()
    return {"files": [
        _file_entry(r["path"], {"id": r["id"], "position": r["position"], "created": r["created"]})
        for r in rows
    ]}


async def favorites_add(conn: aiosqlite.Connection, path: str, *,
                        batch_id: str | None = None, reason: str | None = None,
                        undo_of: int | None = None) -> dict:
    """Add *path* to favorites (idempotent -- a path already favorited is
    returned as-is, with no new operations_log row). *batch_id*/*reason*/
    *undo_of* are for backend.mover's undo of 'favorite-remove'; ordinary
    callers (POST /favorites) never pass them.
    """
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT id, path, position, created FROM favorites WHERE path = ?", (path,))
    existing = await cur.fetchone()
    if existing is not None:
        return _file_entry(existing["path"], {
            "id": existing["id"], "position": existing["position"], "created": existing["created"],
        })

    cur = await conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM favorites")
    (next_pos,) = await cur.fetchone()

    op_id = await ol.log_operation(conn, "favorite-add", path, batch_id=batch_id, reason=reason, undo_of=undo_of)
    created = _now()
    cur = await conn.execute(
        "INSERT INTO favorites (path, position, created) VALUES (?, ?, ?)",
        (path, next_pos, created),
    )
    await conn.commit()
    await ol.mark_executed(conn, op_id)
    return _file_entry(path, {"id": cur.lastrowid, "position": next_pos, "created": created})


async def favorites_remove(conn: aiosqlite.Connection, path: str, *,
                           batch_id: str | None = None, reason: str | None = None,
                           undo_of: int | None = None) -> None:
    """Remove *path* from favorites. *batch_id*/*reason*/*undo_of* are for
    backend.mover's undo of 'favorite-add'; ordinary callers (DELETE
    /favorites) never pass them.
    """
    op_id = await ol.log_operation(conn, "favorite-remove", path, batch_id=batch_id, reason=reason, undo_of=undo_of)
    await conn.execute("DELETE FROM favorites WHERE path = ?", (path,))
    await conn.commit()
    await ol.mark_executed(conn, op_id)
    await _repack_positions(conn, "favorites")


async def favorites_reorder(conn: aiosqlite.Connection, paths: list[str]) -> None:
    """Reorder favorites, tolerating a partial list.

    Rows named in `paths` (in that order, unknown entries ignored) come
    first; every row not mentioned keeps its previous relative order and is
    appended after. Positions are then re-packed 0..n-1 for all rows so a
    partial list can never leave duplicate or stale positions behind.
    """
    cur = await conn.execute("SELECT path FROM favorites ORDER BY position")
    current = [r[0] for r in await cur.fetchall()]
    current_set = set(current)
    new_order = [p for p in paths if p in current_set]
    named = set(new_order)
    new_order += [p for p in current if p not in named]
    for i, p in enumerate(new_order):
        await conn.execute("UPDATE favorites SET position = ? WHERE path = ?", (i, p))
    await conn.commit()


# ---------------------------------------------------------------------------
# Pinned folders
# ---------------------------------------------------------------------------

async def pins_list(conn: aiosqlite.Connection) -> list[dict]:
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT id, path, label, position, created FROM pinned_folders ORDER BY position")
    rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def pins_add(conn: aiosqlite.Connection, path: str, label: str | None = None, *,
                   batch_id: str | None = None, reason: str | None = None,
                   undo_of: int | None = None) -> dict:
    """Pin *path* (idempotent -- an already-pinned path is returned as-is,
    with no new operations_log row). *batch_id*/*reason*/*undo_of* are for
    backend.mover's undo of 'pin-remove'; ordinary callers (POST /pins)
    never pass them. Note: undoing a 'pin-remove' recreates the pin with a
    default label (the folder name) since the original custom label, if
    any, isn't recorded in the log.
    """
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT id, path, label, position, created FROM pinned_folders WHERE path = ?", (path,))
    existing = await cur.fetchone()
    if existing is not None:
        return dict(existing)

    if not label:
        label = Path(path).name

    cur = await conn.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM pinned_folders")
    (next_pos,) = await cur.fetchone()

    op_id = await ol.log_operation(conn, "pin-add", path, batch_id=batch_id, reason=reason, undo_of=undo_of)
    created = _now()
    cur = await conn.execute(
        "INSERT INTO pinned_folders (path, label, position, created) VALUES (?, ?, ?, ?)",
        (path, label, next_pos, created),
    )
    await conn.commit()
    await ol.mark_executed(conn, op_id)
    return {"id": cur.lastrowid, "path": path, "label": label, "position": next_pos, "created": created}


async def pins_update(conn: aiosqlite.Connection, pin_id: int, label: str) -> bool:
    """Return False when no row matched, so the route can answer 404."""
    cur = await conn.execute("UPDATE pinned_folders SET label = ? WHERE id = ?", (label, pin_id))
    await conn.commit()
    return cur.rowcount > 0


async def pins_remove(conn: aiosqlite.Connection, pin_id: int, *,
                      batch_id: str | None = None, reason: str | None = None,
                      undo_of: int | None = None) -> bool:
    """Return False when no row matched, so the route can answer 404.
    *batch_id*/*reason*/*undo_of* are for backend.mover's undo of
    'pin-add'; ordinary callers (DELETE /pins/{id}) never pass them.
    """
    conn.row_factory = aiosqlite.Row
    cur = await conn.execute("SELECT path FROM pinned_folders WHERE id = ?", (pin_id,))
    row = await cur.fetchone()
    if row is None:
        return False
    source = row["path"]

    op_id = await ol.log_operation(conn, "pin-remove", source, batch_id=batch_id, reason=reason, undo_of=undo_of)
    await conn.execute("DELETE FROM pinned_folders WHERE id = ?", (pin_id,))
    await conn.commit()
    await ol.mark_executed(conn, op_id)
    await _repack_positions(conn, "pinned_folders")
    return True


async def pins_reorder(conn: aiosqlite.Connection, ids: list[int]) -> None:
    """Reorder pins, tolerating a partial list (see favorites_reorder)."""
    cur = await conn.execute("SELECT id FROM pinned_folders ORDER BY position")
    current = [r[0] for r in await cur.fetchall()]
    current_set = set(current)
    new_order = [i for i in ids if i in current_set]
    named = set(new_order)
    new_order += [i for i in current if i not in named]
    for i, pin_id in enumerate(new_order):
        await conn.execute("UPDATE pinned_folders SET position = ? WHERE id = ?", (i, pin_id))
    await conn.commit()


async def _repack_positions(conn: aiosqlite.Connection, table: str) -> None:
    cur = await conn.execute(f"SELECT id FROM {table} ORDER BY position")
    ids = [r[0] for r in await cur.fetchall()]
    for i, row_id in enumerate(ids):
        await conn.execute(f"UPDATE {table} SET position = ? WHERE id = ?", (i, row_id))
    await conn.commit()
