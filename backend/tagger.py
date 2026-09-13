"""FilePlus tagging engine — manages tags and auto-tagging rules.

Handles three tag types:
- system: automatically assigned by the indexer (e.g. 'image', 'large-file')
- ai: assigned by the classifier with a confidence score
- user: manually assigned via the UI

Every mutation (add/remove) is logged to operations_log, matching the rest
of the app's "log before you act" convention.
"""
import logging

from backend import operations_log as ol

logger = logging.getLogger(__name__)

_TAG_COLS = ("id", "name", "color", "tag_group", "tag_type")


def _tag_row(row) -> dict:
    return dict(zip(_TAG_COLS, row))


async def _file_path(conn, file_id: int) -> str | None:
    cur = await conn.execute("SELECT path FROM files WHERE id = ?", (file_id,))
    row = await cur.fetchone()
    return row[0] if row else None


async def apply_tags(conn, file_id: int, names: list[str], *,
                     batch_id: str | None = None, reason: str | None = None,
                     undo_of: int | None = None) -> list[int]:
    """Attach a list of tag names to a file, creating tags that don't exist.

    Names are de-duplicated within the call. Blank/whitespace-only names are
    skipped. Creates missing tags with tag_type='user'. Follows the app-wide
    log-before-act protocol per name: log a 'tag-add' operation (source=file
    path, dest=tag name), perform the writes, then mark_executed — or
    mark_error and re-raise if the writes fail.

    Args:
        conn: Active aiosqlite connection.
        file_id: Primary key of the file in the files table.
        names: List of tag name strings to apply.
        batch_id: Optional batch id to log the operation(s) under (undo/redo
            of a 'tag-remove' passes the undo's own minted batch_id here).
        reason: Optional free-text reason to log against the operation(s).
        undo_of: When this call is itself the inverse of a previous
            'tag-remove' (an undo or redo), the id of the operation it
            undoes — threaded straight to operations_log so the History
            panel can show the undo chain. Only meaningful when *names* has
            exactly one entry (backend.mover always calls it that way for
            undo/redo; the normal multi-name path from POST
            /files/{id}/tags never passes it).

    Returns:
        The ids of the tags that were applied (one per de-duplicated name).
    """
    file_path = await _file_path(conn, file_id)
    seen: set[str] = set()
    tag_ids: list[int] = []
    for raw_name in names:
        name = raw_name.strip()
        if not name or name in seen:
            continue
        seen.add(name)
        op_id = await ol.log_operation(conn, "tag-add", file_path, name,
                                       batch_id=batch_id, reason=reason, undo_of=undo_of)
        try:
            await conn.execute("INSERT OR IGNORE INTO tags (name, tag_type) VALUES (?, 'user')", (name,))
            cur = await conn.execute("SELECT id FROM tags WHERE name = ?", (name,))
            tag_id = (await cur.fetchone())[0]
            await conn.execute("INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)", (file_id, tag_id))
        except Exception as exc:
            await ol.mark_error(conn, op_id, f"{type(exc).__name__}: {exc}")
            raise
        await ol.mark_executed(conn, op_id)
        tag_ids.append(tag_id)
    return tag_ids


async def get_tags(conn, file_id: int) -> list[dict]:
    """Return all tags attached to a file.

    Args:
        conn: Active aiosqlite connection.
        file_id: Primary key of the file.

    Returns:
        List of dicts with keys: id, name, color, tag_group, tag_type.
    """
    cur = await conn.execute(
        "SELECT t.id, t.name, t.color, t.tag_group, t.tag_type "
        "FROM tags t JOIN file_tags ft ON ft.tag_id = t.id "
        "WHERE ft.file_id = ? ORDER BY t.name COLLATE NOCASE",
        (file_id,),
    )
    return [_tag_row(r) for r in await cur.fetchall()]


async def remove_tag(conn, file_id: int, tag_id: int, *,
                     batch_id: str | None = None, reason: str | None = None,
                     undo_of: int | None = None) -> int:
    """Detach a tag from a file, logging the removal before acting.

    Follows the app-wide log-before-act protocol: log a 'tag-remove'
    operation, perform the delete, then mark_executed — or mark_error and
    re-raise if the delete fails. Only the (file_id, tag_id) pairing is
    removed — any other tag on the same file is untouched, and the tag
    definition itself (the tags table row) survives even if this was its
    last attachment, since other files may still use it.

    Args:
        conn: Active aiosqlite connection.
        file_id: Primary key of the file.
        tag_id: Primary key of the tag to detach.
        batch_id: Optional batch id to log the operation under (undo/redo of
            a 'tag-add' passes the undo's own minted batch_id here).
        reason: Optional free-text reason to log against the operation.
        undo_of: When this call is itself the inverse of a previous
            'tag-add' (an undo or redo), the id of the operation it undoes.

    Returns:
        The id of the logged 'tag-remove' operation.
    """
    file_path = await _file_path(conn, file_id)
    cur = await conn.execute("SELECT name FROM tags WHERE id = ?", (tag_id,))
    trow = await cur.fetchone()
    tag_name = trow[0] if trow else None
    op_id = await ol.log_operation(conn, "tag-remove", file_path, tag_name,
                                   batch_id=batch_id, reason=reason, undo_of=undo_of)
    try:
        await conn.execute("DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?", (file_id, tag_id))
    except Exception as exc:
        await ol.mark_error(conn, op_id, f"{type(exc).__name__}: {exc}")
        raise
    await ol.mark_executed(conn, op_id)
    return op_id


async def tag_id_for_name(conn, name: str) -> int | None:
    """Return the id of the tag named *name*, or None if no such tag exists.

    Used by backend.mover's undo of 'tag-add': the operations_log row only
    records the tag *name* (dest_path), so the id to detach has to be looked
    up fresh -- the tag may have been renamed or deleted since, though this
    module currently offers no way to do either.
    """
    cur = await conn.execute("SELECT id FROM tags WHERE name = ?", (name,))
    row = await cur.fetchone()
    return row[0] if row else None


async def file_id_for_path(conn, path: str) -> int | None:
    """Return the id of the files-table row at *path*, or None if unindexed.

    Used by backend.mover's undo of tag-add/tag-remove: the operations_log
    row only records the file's *path* (source_path), so the id to mutate
    has to be looked up fresh -- the file may since have been removed from
    the index (moved, deleted, or never re-scanned).
    """
    cur = await conn.execute("SELECT id FROM files WHERE path = ?", (path,))
    row = await cur.fetchone()
    return row[0] if row else None


async def search_tags(conn, q: str, limit: int = 10) -> list[dict]:
    """Return tags whose name starts with *q*, ordered by name.

    Args:
        conn: Active aiosqlite connection.
        q: Prefix to search for.
        limit: Maximum number of results.

    Returns:
        List of dicts with keys: id, name, color, tag_group, tag_type.
    """
    cur = await conn.execute(
        "SELECT id, name, color, tag_group, tag_type FROM tags "
        "WHERE name LIKE ? || '%' ORDER BY name COLLATE NOCASE LIMIT ?",
        (q, limit),
    )
    return [_tag_row(r) for r in await cur.fetchall()]


async def paths_for_tag(conn, tag_name: str) -> set[str]:
    """Return the paths of every indexed file tagged *tag_name*.

    Joins file_tags/tags/files by tag *name* (not id) since every caller
    (GET /fs/search's and GET /search's `tag=` param) addresses a tag by
    name. An unknown tag name yields an empty set rather than an error --
    same "absence is not failure" spirit as tag_id_for_name.

    Args:
        conn: Active aiosqlite connection.
        tag_name: Tag name to look up.

    Returns:
        Set of absolute file paths carrying that tag.
    """
    cur = await conn.execute(
        "SELECT f.path FROM files f "
        "JOIN file_tags ft ON ft.file_id = f.id "
        "JOIN tags t ON t.id = ft.tag_id "
        "WHERE t.name = ?",
        (tag_name,),
    )
    return {row[0] for row in await cur.fetchall()}


async def auto_tag(file_id: int) -> None:
    """Apply system-level auto-tags based on file metadata rules.

    Examples: tag as 'duplicate' if hash matches another file,
    tag as 'large-file' if size > threshold, tag by extension category.

    Args:
        file_id: Primary key of the file.
    """
    # TODO: implement in Phase 2 (classifier-driven auto-tagging)
    pass
