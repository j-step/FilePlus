"""FilePlus FastAPI backend — HTTP API served on localhost:9876 by default
(config.FILEPLUS_PORT overrides).

The Electron frontend communicates exclusively through this API.
All business logic lives here; the renderer never touches the filesystem directly.
"""
import asyncio
import base64
import ctypes
import errno
import logging
import mimetypes
import os
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from stat import S_ISDIR
from typing import Literal, Optional

import aiosqlite
import psutil
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from typing import Any

import backend.config as _config
from backend.config import BadPathError, OutOfSandboxError, ProtectedPathError, path_guard
from backend.database import init_db
from backend.indexer import index_file, scan_directory, remove_stale_entries, forget_root
from backend import filetypes as ft, mover, operations_log as ol, searcher, stores, tagger, winshell

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Auth is never off: an unset FILEPLUS_API_TOKEN is replaced here by a
    # minted, persisted one (config.ensure_api_token) before the first
    # request can be served. Assigned onto the module so _require_token's
    # request-time read sees it.
    _config.FILEPLUS_API_TOKEN = _config.ensure_api_token()
    await init_db()
    app.state.index_state = {"running": False, "path": None, "count": 0, "started": None, "error": None}
    app.state.index_task = None  # holds the running quick-index asyncio.Task, if any
    async with _db() as conn:
        app.state.reconciled = await ol.reconcile_pending(conn)  # classifies crash leftovers; warns per row
    yield
    # The shell-icon STA workers (backend.winshell.ICON_EXECUTOR) must not
    # keep the process alive past shutdown; an icon handler still running is
    # abandoned, not awaited.
    winshell.shutdown_icon_executor()


app = FastAPI(title="FilePlus API", version="0.1.0", lifespan=lifespan)


# ---------------------------------------------------------------------------
# Request auth — X-FilePlus-Token gates every route except /health (and CORS
# preflight). The token is always set in a running backend: lifespan mints and
# persists one when FILEPLUS_API_TOKEN is unset, so there is no "open by
# default" mode. Read at request time (not import time) so lifespan/tests can
# set it and so a packaged build can set it per-launch.
#
# Registered (via add_middleware, below CORSMiddleware in this file) *before*
# CORSMiddleware so that CORSMiddleware ends up outermost in the resulting
# stack (Starlette wraps outward in add_middleware call order — the last
# middleware added is outermost). That matters because a 401 short-circuits
# here without calling call_next: if CORS were inner of this middleware, its
# response-header logic would never run for a rejected request, and a 401
# would arrive at the Electron renderer with no Access-Control-Allow-Origin
# header — the fetch() would then fail as a CORS error instead of surfacing
# the real 401.
# ---------------------------------------------------------------------------

@app.middleware("http")
async def _require_token(request, call_next):
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)
    token = _config.FILEPLUS_API_TOKEN
    if token:
        supplied = request.headers.get("x-fileplus-token", "")
        # Compare as UTF-8 bytes: secrets.compare_digest raises TypeError on
        # a str argument containing non-ASCII characters (a header value a
        # client can send). Encoding both sides to bytes first — which
        # compare_digest always accepts — turns a bogus non-ASCII header into
        # a 401 instead of an unhandled 500.
        if not secrets.compare_digest(supplied.encode("utf-8"), token.encode("utf-8")):
            return JSONResponse(status_code=401, content={"detail": "missing or invalid API token"})
    return await call_next(request)


# The Electron renderer loads index.html over file://, so its Origin header is
# the literal string "null" — that is the only origin allowed. A wildcard here
# would let any web page the user has open preflight and then issue
# POST /fs/trash, /fs/move, ... against http://localhost:9876 and read the
# reply; the token gate is the other half of that defence, not a substitute.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["null"],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-FilePlus-Token"],
)


# ---------------------------------------------------------------------------
# Request log -- one line per request in backend.log (backend/logging_setup.py):
# method, path + query, status, duration. Registered last, so it is the
# outermost middleware and also records 401s and CORS preflights. The token
# header is never logged. /health is polled every few seconds by the renderer,
# so it logs at DEBUG; 4xx/5xx at WARNING. An exception no handler mapped is
# logged here with its full traceback, then re-raised to Starlette's own 500.
# ---------------------------------------------------------------------------

_request_log = logging.getLogger("backend.requests")


@app.middleware("http")
async def _log_requests(request, call_next):
    started = time.perf_counter()
    target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    try:
        response = await call_next(request)
    except Exception:
        _request_log.exception("%s %s -> unhandled error after %.0f ms", request.method, target,
                               (time.perf_counter() - started) * 1000)
        raise
    ms = (time.perf_counter() - started) * 1000
    level = (logging.DEBUG if request.url.path == "/health" and response.status_code < 400
             else logging.WARNING if response.status_code >= 400 else logging.INFO)
    _request_log.log(level, "%s %s -> %s (%.0f ms)", request.method, target, response.status_code, ms)
    return response


# ---------------------------------------------------------------------------
# Error mapping — mover/config exceptions become HTTP responses everywhere
# ---------------------------------------------------------------------------

@app.exception_handler(OutOfSandboxError)
@app.exception_handler(ProtectedPathError)
async def _forbidden(_r, exc):
    logger.warning("refused (403): %s", exc)
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(mover.InvalidNameError)
@app.exception_handler(mover.ConflictError)
@app.exception_handler(mover.RefusedError)
async def _conflict(_r, exc):
    logger.warning("conflict (409): %s", exc)
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(FileNotFoundError)
async def _missing(_r, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(BadPathError)
@app.exception_handler(mover.InvalidPolicyError)
async def _bad_request(_r, exc):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(PermissionError)
async def _denied(_r, exc):
    return JSONResponse(status_code=403, content={"detail": f"Access denied: {exc}"})


# _EINVAL_ERRNOS: "the path itself is malformed/invalid", not "the path is
# unreachable" -- these get 400 (bad request) rather than 502. Everything
# else an OSError can carry from a filesystem call this app never expects to
# fail cleanly (unreachable UNC host, "device not ready", a sharing
# violation) is treated as a network/IO failure and gets 502, never a bare
# 500 traceback. PermissionError and FileNotFoundError are OSError
# subclasses but keep their own handlers above -- Starlette resolves a
# handler by walking the raised exception's actual MRO, so those two exact
# classes are matched before this general OSError handler is ever considered.
_EINVAL_ERRNOS = {errno.EINVAL}


# A long-running index no longer holds one write transaction for a whole
# walk (backend.indexer commits per chunk), but SQLite can still answer
# "database is locked" when two writers genuinely collide. That is a
# transient busy signal, not a bug in the request -- answer 503 (with a
# Retry-After) instead of an unhandled 500 traceback.
@app.exception_handler(sqlite3.OperationalError)
async def _db_busy(_r, exc):
    logger.error("database error: %s", exc, exc_info=exc)
    text = str(exc).lower()
    if "locked" in text or "busy" in text:
        return JSONResponse(status_code=503, content={"detail": f"database busy: {exc}"},
                            headers={"Retry-After": "1"})
    return JSONResponse(status_code=500, content={"detail": f"database error: {exc}"})


@app.exception_handler(OSError)
async def _os_error(request, exc):
    status = 400 if exc.errno in _EINVAL_ERRNOS else 502
    logger.error("filesystem error (%s) on %s: %s", status, getattr(exc, "filename", None)
                 or request.query_params.get("path"), exc, exc_info=exc if status >= 500 else None)
    path = getattr(exc, "filename", None) or request.query_params.get("path")
    return JSONResponse(status_code=status, content={"detail": exc.strerror or str(exc), "path": path})


def _db():
    return aiosqlite.connect(_config.FILEPLUS_DB_PATH)


async def aguard(path: Path | str, mode: str = "read") -> Path:
    r"""path_guard, off the event loop.

    path_guard resolves the path, and Path.resolve() on a UNC path opens an
    SMB session that can take ~20s to fail against an unroutable host (and
    the loopback-share detection ahead of it may do a bounded DNS lookup).
    Doing that inline in a coroutine freezes every other request -- /health
    included, which is how the status bar ends up claiming "Backend offline"
    while the backend is merely stuck resolving ``\\somehost\share``. Every
    route guards through this wrapper so the wait occupies a worker thread
    instead.
    """
    return await asyncio.to_thread(path_guard, path, mode)


# ---------------------------------------------------------------------------
# Human-readable "kind" by extension, for /file
# ---------------------------------------------------------------------------

KIND_BY_EXT = {
    ".md": "Markdown", ".txt": "Text", ".py": "Python source", ".js": "JavaScript",
    ".json": "JSON", ".pdf": "PDF document",
    ".png": "Image", ".jpg": "Image", ".jpeg": "Image", ".gif": "Image",
    ".webp": "Image", ".bmp": "Image", ".svg": "Image", ".ico": "Image",
    ".mp3": "Audio", ".wav": "Audio", ".flac": "Audio", ".m4a": "Audio", ".ogg": "Audio",
    ".mp4": "Video", ".mkv": "Video", ".mov": "Video", ".avi": "Video",
    ".zip": "Archive", ".7z": "Archive", ".rar": "Archive", ".tar": "Archive", ".gz": "Archive",
    ".exe": "Application", ".msi": "Application",
    ".docx": "Word document", ".xlsx": "Excel workbook", ".pptx": "PowerPoint",
}


def _kind_for(path: Path, is_dir: bool = False) -> str:
    """Human-readable kind for *path*. *is_dir* comes from the caller (which
    has already stat'ed the path in a worker thread) so this never issues a
    filesystem call of its own on the event loop."""
    if is_dir:
        return "Folder"
    ext = path.suffix.lower()
    if ext in KIND_BY_EXT:
        return KIND_BY_EXT[ext]
    return f"{ext[1:].upper()} file" if ext else "File"


# ---------------------------------------------------------------------------
# Preview extension sets
# ---------------------------------------------------------------------------

_PREVIEW_TEXT_EXTS = {
    "md", "txt", "py", "js", "ts", "json", "yaml", "yml", "toml", "csv", "log", "ini",
    "xml", "html", "css", "sh", "ps1", "c", "cpp", "h", "rs", "go", "java", "kt", "swift",
    "rb", "php", "sql", "bat", "cmd",
}
_PREVIEW_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico"}
_PREVIEW_MAX_IMAGE_BYTES = 25 * 1024 * 1024
_PREVIEW_TEXT_BYTES = 4096

# GET /files is always paginated -- see list_files.
_DEFAULT_FILES_LIMIT = 200
_MAX_FILES_LIMIT = 1000

# Rows GET /search scans when whole_word= is on -- the one filter that
# cannot be expressed in SQL, so it still runs in Python over a window.
_SEARCH_SCAN_CAP = 5000

# GET /search matches query words with LIKE. `%` and `_` are legal Windows
# filename characters, so they are escaped rather than left to act as
# wildcards -- searcher's own matcher does a literal substring find, and the
# two routes must read the same typed text the same way.
_LIKE_ESCAPE = "!"


def _like_literal(text: str) -> str:
    """*text* with LIKE's wildcards (and the escape char) neutralised."""
    for ch in (_LIKE_ESCAPE, "%", "_"):
        text = text.replace(ch, _LIKE_ESCAPE + ch)
    return text

# GET /file indexes an unseen file on demand. Hashing is a full read of the
# file's bytes, so only files up to this size are hashed inline; anything
# bigger is indexed without a hash (a later POST /scan fills it in). Selecting
# a folder of multi-gigabyte videos fires one GET /file per item, and hashing
# those would tie up the whole worker pool for tens of seconds each.
_ONDEMAND_HASH_MAX_BYTES = 64 * 1024 * 1024


def _read_head(path: Path, n: int) -> bytes:
    """First *n* bytes of *path*. Runs in a worker thread (GET /preview)."""
    with open(path, "rb") as fh:
        return fh.read(n)


def _entry_facts(path: Path) -> tuple[bool, bool, "os.stat_result | None"]:
    """(exists, is_dir, stat) for *path* in one worker-thread hop.

    A missing path reports (False, False, None) rather than raising; any
    other OSError (denied, device not ready) propagates so the route's
    handlers can map it.
    """
    try:
        st = path.stat()
    except FileNotFoundError:
        return False, False, None
    return True, S_ISDIR(st.st_mode), st


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    try:
        async with _db() as conn:
            await conn.execute("SELECT 1")
            # COUNT(*) over the partial index, not len(pending_operations()):
            # /health polls every few seconds and only ever wanted the number,
            # while materialising every pending row's full dict scanned (and
            # allocated) the whole never-pruned operations_log each time.
            pending_ops = await ol.count_pending(conn)
        db_ok = True
    except Exception:
        db_ok = False
        pending_ops = 0
    return {
        "status": "ok",
        "version": "0.1.0",
        "db_ok": db_ok,
        "write_unlocked": _config.writes_unlocked(),
        "env": _config.FILEPLUS_ENV,
        "pending_ops": pending_ops,
        "index_running": app.state.index_state["running"],
        "auth": bool(_config.FILEPLUS_API_TOKEN),
        # Capability flag for the renderer's Windows-icon mode: true when
        # POST /shell/icons can actually render (IShellItemImageFactory is
        # Windows-only). Read by checkBackend (app.js) so the renderer never
        # has to discover the route by a failed request -- a 404 logs an
        # unsuppressible Chromium console error even when caught.
        "shell_icons": os.name == "nt",
    }


# ---------------------------------------------------------------------------
# Files endpoints
# ---------------------------------------------------------------------------

@app.get("/files")
async def list_files(
    path: Optional[str] = Query(None, description="Filter to files whose path starts with this prefix"),
    q: Optional[str] = Query(None, description="Substring search on filename"),
    limit: int = Query(_DEFAULT_FILES_LIMIT, ge=1, le=_MAX_FILES_LIMIT),
    offset: int = Query(0, ge=0),
):
    """Return indexed files, optionally filtered by path prefix and/or filename search.

    Always paginated. `limit` used to default to None, which meant a bare
    GET /files serialised the entire files table -- at whole-drive index
    scale that is hundreds of thousands of rows through jsonable_encoder on
    the event loop. It now defaults to _DEFAULT_FILES_LIMIT and is capped at
    _MAX_FILES_LIMIT, the same shape GET /search already had; walk the table
    with `offset`.
    """
    conditions = []
    params: list = []
    if path:
        conditions.append("path LIKE ?")
        params.append(path.rstrip("\\").rstrip("/") + "%")
    if q:
        conditions.append("filename LIKE ?")
        params.append(f"%{q}%")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = (f"SELECT id, path, filename, extension, size, modified, category, status, is_pinned "
           f"FROM files {where} ORDER BY filename COLLATE NOCASE LIMIT ? OFFSET ?")
    params += [limit, offset]
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(sql, params)
        rows = await cur.fetchall()
    return [dict(row) for row in rows]


@app.get("/file")
async def file_meta(path: str = Query(..., description="Absolute path of the file")):
    """Return DB metadata for a single file, indexing it on demand if unseen.

    Unlike /files/{id}, this is addressed by filesystem path (what the
    Inspector has on hand) rather than DB id.
    """
    resolved = await aguard(path)
    exists, is_dir, st = await asyncio.to_thread(_entry_facts, resolved)
    if not exists:
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if is_dir:
        return {
            "id": None,
            "path": str(resolved),
            "filename": resolved.name or str(resolved),
            "extension": "",
            "size": None,
            "hash": None,
            "created": datetime.fromtimestamp(st.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(st.st_mtime).isoformat(),
            "category": None,
            "confidence": 0.0,
            "status": "directory",
            "is_pinned": 0,
            "tags": [],
            "kind": "Folder",
        }
    async with _db() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM files WHERE path = ?", (str(resolved),))
        row = await cur.fetchone()
        if row is None:
            # On-demand indexing must stay cheap: selecting a folder of large
            # media files fires one of these per item, so only small files are
            # hashed here (see _ONDEMAND_HASH_MAX_BYTES).
            await index_file(resolved, conn, hash=st.st_size <= _ONDEMAND_HASH_MAX_BYTES)
            await conn.commit()
            cur = await conn.execute("SELECT * FROM files WHERE path = ?", (str(resolved),))
            row = await cur.fetchone()
        data = dict(row)
        data["tags"] = await tagger.get_tags(conn, data["id"])
    data["kind"] = _kind_for(resolved, is_dir=False)
    return data


@app.get("/preview")
async def preview(path: str = Query(..., description="Absolute path of the file")):
    """Return a lightweight preview: text snippet, an image response, or a binary marker.

    Every filesystem touch (exists/is_dir/stat, and the head read for a text
    file) happens in a worker thread -- the same shape /fs/properties uses,
    and one stat instead of the two this used to take. Inline, a preview of a
    file on a slow or unresponsive volume blocked the whole event loop.
    """
    resolved = await aguard(path)
    exists, is_dir, st = await asyncio.to_thread(_entry_facts, resolved)
    if not exists:
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if is_dir:
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")
    ext = resolved.suffix.lower().lstrip(".")
    size = st.st_size
    if ext in _PREVIEW_IMAGE_EXTS:
        if size > _PREVIEW_MAX_IMAGE_BYTES:
            return {"kind": "too-large"}
        media_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        return FileResponse(str(resolved), media_type=media_type)
    if ext in _PREVIEW_TEXT_EXTS:
        raw = await asyncio.to_thread(_read_head, resolved, _PREVIEW_TEXT_BYTES)
        content = raw.decode("utf-8", errors="replace")
        return {"kind": "text", "content": content,
                "truncated": size > _PREVIEW_TEXT_BYTES, "total_size": size}
    return {"kind": "binary", "size": size}


@app.get("/files/history")
async def files_history(path: str = Query(..., description="Absolute path to look up operation history for")):
    """Return the operations_log rows touching *path*, most recent first.

    Registered before /files/{file_id} so "history" is never swallowed as an
    (invalid) integer file id.
    """
    resolved = await aguard(path)
    async with _db() as conn:
        return await ol.list_operations(conn, path=str(resolved))


@app.get("/search")
async def search_files(
    q: str = Query("", description="Substring to match against filename or path"),
    type_: Optional[str] = Query(None, alias="type", description="Search group or 'folder'"),
    ext: Optional[str] = Query(None, description="Single extension, no dot"),
    modified_after: Optional[float] = Query(None, description="Epoch seconds"),
    modified_before: Optional[float] = Query(None),
    created_after: Optional[float] = Query(None),
    created_before: Optional[float] = Query(None),
    min_size: Optional[int] = Query(None),
    max_size: Optional[int] = Query(None),
    tag: Optional[str] = Query(None),
    hidden: bool = Query(False),
    whole_word: bool = Query(False),
    limit: int = Query(50),
):
    """Name search over the index (the `files` table), plus filters.

    `q` is read exactly the way GET /fs/search reads it, because one search
    bar drives both routes off one typed string and flipping the `in:` chip
    must not change the query language: the text is split on whitespace and
    **every** word must occur in the *filename* (AND semantics, case
    insensitive, LIKE wildcards in the text escaped so `%` and `_` are
    literal). It used to match the whole string as a single substring of
    filename OR path, so an ordinary two-word query that worked in folder
    scope returned nothing from This PC, and a folder-name query returned
    that folder's whole subtree here but nothing there. Path matching is
    deliberately gone rather than mirrored into searcher: the renderer
    highlights index hits with the same per-word spans it computes for live
    hits (normalizeIndexResults), and a path-only match has none.

    Rows a mutation marked `status='trashed'` are excluded: the file still
    exists, but inside `.FilePlusTrash`, and offering it as a search result
    is offering a deleted file.

    Every filter except `whole_word` is applied in
    SQL: `ext`/`min_size`/`max_size`/`modified_*`/`created_*` against their
    own columns, `type` as an extension set derived from
    backend.filetypes.GROUPS (the 'other' group is the complement, and
    'folder' matches nothing here since indexed rows are always files),
    `hidden` as a `filename NOT LIKE '.%'` predicate (there is no stored
    column; this is the same approximation the indexer uses when it declines
    to index dot-prefixed names), and `tag` as an EXISTS join on
    file_tags/tags -- an exact file_id join, so a file renamed to change only
    its case matches without any path normalisation. `indexed_roots` is
    always included so the frontend's "This PC" search scope can flag drives
    that aren't indexed yet.

    Pushing those filters into SQL is what makes the row cap honest. They
    used to run in Python *after* a hard `LIMIT 5000`, so at index scale a
    `type=`/`tag=` search silently returned a subset of -- or nothing from --
    the real match set, because the 5000 rows the SQL query happened to
    return were drawn from unfiltered rows. Now the cap applies to
    already-filtered rows: the query asks for `limit` rows directly
    (`LIMIT ?`), except when `whole_word` is on, which is the one filter SQL
    LIKE cannot express (no word-boundary concept) and therefore still runs
    in Python over a capped `_SEARCH_SCAN_CAP` window.

    `truncated` says whether more matches exist than were returned -- the
    same signal GET /fs/search gives. The renderer used to fabricate it as
    `len(results) >= limit`, which is wrong whenever the whole_word pass
    drops rows after the scan cap.
    """
    limit = min(limit, 1000)
    conditions = []
    params: list = []
    for word in (q.split() if q else []):
        conditions.append(f"filename LIKE ? ESCAPE '{_LIKE_ESCAPE}'")
        params.append(f"%{_like_literal(word)}%")
    conditions.append("COALESCE(status, '') != 'trashed'")
    if ext:
        conditions.append("extension = ?")
        params.append("." + ext.lstrip(".").lower())
    if type_:
        spec = ft.extensions_for_group(type_)
        if spec is None:
            conditions.append("0")  # unknown group: matches nothing, same as before
        else:
            exts, negate = spec
            if not exts:
                conditions.append("0")  # 'folder': indexed rows are always files
            else:
                placeholders = ",".join("?" * len(exts))
                op = "NOT IN" if negate else "IN"
                conditions.append(f"COALESCE(extension, '') {op} ({placeholders})")
                params += ["." + e for e in sorted(exts)]
    if not hidden:
        conditions.append("filename NOT LIKE '.%'")
    if tag:
        conditions.append(
            "EXISTS (SELECT 1 FROM file_tags ft_ JOIN tags t_ ON t_.id = ft_.tag_id "
            "WHERE ft_.file_id = files.id AND t_.name = ?)"
        )
        params.append(tag)
    if min_size is not None:
        conditions.append("size >= ?")
        params.append(min_size)
    if max_size is not None:
        conditions.append("size <= ?")
        params.append(max_size)
    if modified_after is not None:
        conditions.append("modified >= ?")
        params.append(datetime.fromtimestamp(modified_after).isoformat())
    if modified_before is not None:
        conditions.append("modified <= ?")
        params.append(datetime.fromtimestamp(modified_before).isoformat())
    if created_after is not None:
        conditions.append("created >= ?")
        params.append(datetime.fromtimestamp(created_after).isoformat())
    if created_before is not None:
        conditions.append("created <= ?")
        params.append(datetime.fromtimestamp(created_before).isoformat())

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    words = q.split() if (q and whole_word) else []
    # One row past `limit` when SQL can answer on its own: that extra row is
    # what makes `truncated` a fact rather than the "we returned exactly
    # `limit`, so probably" guess the renderer was making.
    sql_limit = _SEARCH_SCAN_CAP if words else limit + 1

    async with _db() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            f"SELECT id, path, filename, extension, size, modified, created, hash FROM files "
            f"{where} ORDER BY filename COLLATE NOCASE LIMIT ?",
            params + [sql_limit],
        )
        rows = [dict(r) for r in await cur.fetchall()]
        cur2 = await conn.execute("SELECT root FROM index_roots ORDER BY root")
        indexed_roots = [r[0] for r in await cur2.fetchall()]

    scan_capped = bool(words) and len(rows) >= _SEARCH_SCAN_CAP
    if words:
        rows = [r for r in rows if searcher.match_spans(r["filename"], words, True) is not None]
    truncated = scan_capped or len(rows) > limit
    results = rows[:limit]
    return {"results": results, "indexed_roots": indexed_roots, "truncated": truncated}


@app.get("/files/{file_id}")
async def get_file(file_id: int):
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM files WHERE id = ?", (file_id,))
        row = await cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="File not found")
    return dict(row)


# ---------------------------------------------------------------------------
# Filesystem listing (read-only) — /fs/list
# ---------------------------------------------------------------------------

# Raw os.scandir entries one /fs/list call will look at, before any
# hidden-entry filtering. LISTING_CAP bounds what comes back; this bounds the
# work done to produce it.
_LIST_SCAN_CAP = 50_000


def _scandir_entries(directory: Path, show_hidden: bool) -> tuple[list[dict], bool]:
    """Return (entries, truncated) for the given directory.

    Read-only, so any real drive can be listed (browsing real drives is the
    product). A PermissionError on the directory itself propagates so the
    caller can turn it into a 403 -- but a per-entry stat failure (a locked
    or permission-denied child, common under real drive roots like
    ``C:\\System Volume Information``) never aborts the whole listing: that
    entry is returned with an ``"error"`` field and zero size instead.

    Hidden entries (leading dot, or the Windows hidden attribute) are
    dropped unless show_hidden is true.

    Two separate budgets bound the work: the scan stops after
    _LIST_SCAN_CAP raw directory entries (hidden entries that are skipped
    count toward this one, so a folder of a million hidden files can't make
    the scan itself unbounded), and the returned listing is truncated to
    _config.LISTING_CAP entries. Either one sets truncated=True. The
    truncation happens *after* the sort, so a capped listing is the first
    LISTING_CAP entries in display order (folders first, then by name)
    rather than an arbitrary subset in raw directory order.
    """
    entries: list[dict] = []
    truncated = False
    scanned = 0
    for de in os.scandir(directory):
        scanned += 1
        if scanned > _LIST_SCAN_CAP:
            truncated = True
            break
        is_hidden = de.name.startswith(".")
        try:
            stat = de.stat(follow_symlinks=False)
        except FileNotFoundError:
            continue  # deleted mid-scan; not a real entry
        except OSError:
            if is_hidden and not show_hidden:
                continue
            entries.append({"name": de.name, "is_dir": False, "size": 0, "modified": 0.0,
                            "ext": "", "is_hidden": is_hidden, "error": "access denied"})
            continue
        is_dir = de.is_dir(follow_symlinks=False)
        ext = "" if is_dir else os.path.splitext(de.name)[1].lower()
        if os.name == "nt":
            try:
                attrs = stat.st_file_attributes  # type: ignore[attr-defined]
                is_hidden = is_hidden or bool(attrs & 0x2)  # FILE_ATTRIBUTE_HIDDEN
            except (AttributeError, OSError):
                pass
        if is_hidden and not show_hidden:
            continue
        entries.append({
            "name": de.name,
            "is_dir": is_dir,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "ext": ext,
            "is_hidden": is_hidden,
        })
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    if len(entries) > _config.LISTING_CAP:
        entries = entries[:_config.LISTING_CAP]
        truncated = True
    return entries, truncated


def _listing_response(resolved: Path, entries: list[dict], truncated: bool) -> dict:
    """The /fs/list payload. Returned through JSONResponse(content=...) by
    both listing routes: every value here is already a plain str/int/float/
    bool, so FastAPI's default path (jsonable_encoder recursively walking up
    to LISTING_CAP six-key dicts on the event loop) is pure overhead --
    several times the cost of the threaded scandir walk it serialises."""
    parent = resolved.parent
    is_root = parent == resolved
    return {
        "path": str(resolved),
        "parent": None if is_root else str(parent),
        "is_root": is_root,
        "truncated": truncated,
        "entries": entries,
    }


@app.get("/fs/list")
async def fs_list(
    path: str = Query(..., description="Absolute path of directory to list"),
    show_hidden: bool = False,
):
    """Return a directory listing for the given absolute path.

    Read-only, so path_guard (mode="read") allows any path -- browsing real
    drives is the product (D2). *path* must be absolute with a drive (a bare
    "C:" or a relative path is refused with 400 -- neither is a listable
    location). Returns 404 if the path doesn't exist or isn't a directory;
    per-entry permission errors never 500 (see _scandir_entries), but a
    PermissionError on the directory itself is mapped to 403 by the
    exception handler above.
    """
    resolved = await aguard(path)  # _canonicalize refuses relative/driveless input -> BadPathError -> 400
    if not resolved.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {path}")
    entries, truncated = await asyncio.to_thread(_scandir_entries, resolved, show_hidden)
    return JSONResponse(content=_listing_response(resolved, entries, truncated))


@app.get("/fs/list/root")
async def fs_list_root(show_hidden: bool = False):
    """Return the sandbox root listing without requiring a path argument.

    Accepts the same show_hidden filter as /fs/list so the first Browser
    open (which calls this route with no path) honours ui.show_hidden the
    same as every later /fs/list call.
    """
    root = _config.FILEPLUS_SANDBOX_PATH.resolve()
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"Sandbox root missing: {root}")
    entries, truncated = await asyncio.to_thread(_scandir_entries, root, show_hidden)
    return JSONResponse(content=_listing_response(root, entries, truncated))


_PEEK_SCAN_CAP = 2000


def _peek_entries(directory: Path, n: int) -> list[dict]:
    """First *n* non-hidden media files directly inside *directory*, by name.

    Skips dot-prefixed and Windows-hidden entries, .FilePlusTrash, and
    sub-directories; gives up after _PEEK_SCAN_CAP entries even if *n* media
    hits were never reached (a huge non-media folder must not hang this).
    Walks the scandir iterator lazily -- no eager `sorted(os.scandir(...))`
    of the whole directory -- so a folder with thousands of entries costs
    only the ones actually visited before either limit is hit; only the
    (small) set of collected hits is sorted, at the end, by name.
    """
    items: list[dict] = []
    try:
        scandir_it = os.scandir(directory)
    except OSError:
        return items
    scanned = 0
    with scandir_it:
        for de in scandir_it:
            if len(items) >= n or scanned >= _PEEK_SCAN_CAP:
                break
            scanned += 1
            if de.name.startswith(".") or de.name == _config.TRASH_DIRNAME:
                continue
            try:
                if de.is_dir(follow_symlinks=False):
                    continue
                st = de.stat(follow_symlinks=False)
                if os.name == "nt" and st.st_file_attributes & 0x2:  # type: ignore[attr-defined]  FILE_ATTRIBUTE_HIDDEN
                    continue
            except OSError:
                continue
            ext = os.path.splitext(de.name)[1].lstrip(".").lower()
            if not ft.is_media(ext):
                continue
            # modified keys the renderer's thumbnail cache for the peeked
            # picture (pass 2 #143) -- the same field a /fs/list entry carries.
            items.append({"name": de.name, "path": str(directory / de.name), "ext": ext, "modified": st.st_mtime})
    items.sort(key=lambda item: item["name"].lower())
    return items


@app.get("/fs/peek")
async def fs_peek(
    path: str = Query(..., description="Absolute path of directory to peek into"),
    n: int = Query(2, description="Max number of media items to return"),
):
    """Return up to *n* media files (images/videos) directly inside *path*.

    Used for folder preview thumbnails (e.g. a fanned pair of images on a
    folder tile). Read-only, so any real path is allowed (D2).

    A path that is missing or is not a directory answers 200 with an empty
    list, not 404: a preview is a decoration, and the caller (a grid tile
    whose folder was deleted between the listing and the peek) has nothing to
    do with a 404 except swallow it -- while the browser still logs the failed
    request as a console error. Malformed input is still a hard error: a
    relative/driveless path raises BadPathError (400) and a guarded path
    raises ProtectedPathError (403) from path_guard above.
    """
    resolved = await aguard(path)  # relative/driveless -> BadPathError -> 400
    if not resolved.is_dir():
        return {"items": []}
    items = await asyncio.to_thread(_peek_entries, resolved, n)
    return {"items": items}


@app.get("/fs/search")
async def fs_search(
    root: str = Query(..., description="Absolute path of the folder to search live"),
    q: str = Query(""),
    type_: Optional[str] = Query(None, alias="type", description="Search group or 'folder'"),
    ext: Optional[str] = Query(None, description="Single extension, no dot"),
    modified_after: Optional[float] = Query(None, description="Epoch seconds"),
    modified_before: Optional[float] = Query(None),
    created_after: Optional[float] = Query(None),
    created_before: Optional[float] = Query(None),
    min_size: Optional[int] = Query(None),
    max_size: Optional[int] = Query(None),
    tag: Optional[str] = Query(None),
    hidden: bool = Query(False),
    whole_word: bool = Query(False),
    limit: int = Query(500),
):
    """Budgeted live search of the tree rooted at *root* -- see backend.searcher.

    *root* must be absolute (path_guard's _canonicalize raises BadPathError
    for a relative or driveless spelling -> 400 via the global handler) and
    is read-guarded like every other read route (D2: reads are allowed
    anywhere). `tag=` resolves to a path set up front via
    tagger.paths_for_tag so the blocking tree walk itself never touches the
    database; the set is normalised (searcher.normalize_path) so a file
    renamed to change only its case (the files-table row keeps whatever
    case existed when it was indexed) still matches during the live walk.
    The walk runs in asyncio.to_thread since it's blocking I/O, and so does
    the normalisation of the `tag=` path set (one normcase+normpath per
    tagged path, over a set with no upper bound).

    The renderer aborts the in-flight search on every keystroke and on tab
    switch. asyncio.to_thread cannot interrupt a thread, so the walk is
    handed a threading.Event that this route sets when the request is
    cancelled or the client disconnects -- otherwise every superseded query
    kept walking the disk to completion, piling up concurrent walks in the
    shared default executor (which /fs/list, /fs/peek and /fs/properties
    also draw from).
    """
    resolved = await aguard(root)
    tag_paths = None
    if tag:
        async with _db() as conn:
            raw_paths = await tagger.paths_for_tag(conn, tag)
        tag_paths = await asyncio.to_thread(
            lambda ps: {searcher.normalize_path(x) for x in ps}, raw_paths)
    filters = searcher.SearchFilters(
        q=q, type=type_, ext=ext,
        modified_after=modified_after, modified_before=modified_before,
        created_after=created_after, created_before=created_before,
        min_size=min_size, max_size=max_size,
        hidden=hidden, whole_word=whole_word, tag_paths=tag_paths,
    )
    capped_limit = min(limit, 1000)
    cancel = threading.Event()
    walk = asyncio.create_task(
        asyncio.to_thread(searcher.search_tree, resolved, filters,
                          limit=capped_limit, cancel=cancel))
    try:
        return await asyncio.shield(walk)
    except asyncio.CancelledError:
        cancel.set()          # tell the walk to stop; the thread ends on its own
        walk.add_done_callback(lambda t: t.exception())  # never an "exception was never retrieved" warning
        raise


# ---------------------------------------------------------------------------
# Properties — Explorer-style Properties dialog: file-type association, size
# (logical and on-disk), a recursive folder summary, timestamps, Windows
# attributes, and the desktop.ini-backed "folder type". Backed by
# backend.winshell; consumed verbatim by the frontend Properties panel.
# ---------------------------------------------------------------------------

def _created_time(st) -> float:
    """st_birthtime when the platform provides it (Python 3.12+ on Windows), else st_ctime."""
    return getattr(st, "st_birthtime", None) or st.st_ctime


def _immediate_child_names(directory: Path) -> list[tuple[str, bool]]:
    try:
        with os.scandir(directory) as entries:
            return [(e.name, e.is_dir(follow_symlinks=False)) for e in entries]
    except OSError:
        return []


def _properties_blocking(resolved: Path, is_dir: bool) -> dict:
    """Every blocking winshell/scandir call GET /fs/properties needs, gathered
    under one asyncio.to_thread dispatch (get_attributes, assoc/size_on_disk
    for a file; contains_counts/read_folder_type/detect_folder_type for a
    directory) rather than several separate to_thread round trips.
    """
    attrs = winshell.get_attributes(resolved)
    if is_dir:
        assoc_info = {"type_description": "File folder", "opens_with": None, "opens_with_exe": None}
        counts = winshell.contains_counts(resolved)
        size = size_on_disk = counts["bytes"]
        contains = {"files": counts["files"], "folders": counts["folders"], "truncated": counts["truncated"]}
        folder_type = winshell.read_folder_type(resolved)
        folder_type_detected = winshell.detect_folder_type(_immediate_child_names(resolved))
    else:
        ext = resolved.suffix.lstrip(".").lower()
        assoc_info = winshell.assoc(ext)
        size = resolved.stat().st_size
        size_on_disk = winshell.size_on_disk(resolved)
        contains = None
        folder_type = None
        folder_type_detected = None
    return {
        "attrs": attrs, "assoc_info": assoc_info, "size": size, "size_on_disk": size_on_disk,
        "contains": contains, "folder_type": folder_type, "folder_type_detected": folder_type_detected,
    }


@app.get("/fs/properties")
async def fs_properties(path: str = Query(..., description="Absolute path of the file or folder")):
    """Explorer-style Properties for a single file or folder.

    Read-only (path_guard "read" — D2: browsing/inspecting any real path is
    allowed). `contains` is populated (and `folder_type`/`folder_type_detected`
    computed) only for a directory; a file gets `contains: null` and both
    folder-type fields null. Every blocking call (attributes, association,
    size-on-disk, the recursive folder summary) runs together in a single
    asyncio.to_thread dispatch (_properties_blocking) instead of several.
    """
    resolved = await aguard(path)
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    st = resolved.stat()
    is_dir = resolved.is_dir()
    data = await asyncio.to_thread(_properties_blocking, resolved, is_dir)
    attrs = data["attrs"]
    assoc_info = data["assoc_info"]
    return {
        "path": str(resolved),
        "name": resolved.name or str(resolved),
        "is_dir": is_dir,
        "type_description": assoc_info["type_description"],
        "opens_with": assoc_info["opens_with"],
        "opens_with_exe": assoc_info["opens_with_exe"],
        "location": str(resolved.parent),
        "size": data["size"],
        "size_on_disk": data["size_on_disk"],
        "contains": data["contains"],
        "created": _created_time(st),
        "modified": st.st_mtime,
        "accessed": st.st_atime,
        "attributes": {
            "read_only": attrs["read_only"], "hidden": attrs["hidden"],
            "archive": attrs["archive"], "system": attrs["system"],
        },
        "folder_type": data["folder_type"],
        "folder_type_detected": data["folder_type_detected"],
    }


@app.get("/fs/properties/details")
async def fs_properties_details(path: str = Query(..., description="Absolute path of the file or folder")):
    """Extended Windows property list (pywin32 propsys) for the Properties "Details" tab.

    503 (not 500) when pywin32 isn't installed -- backend.winshell.property_details
    imports it lazily and raises RuntimeError for exactly that case. Any
    other failure (a COM error from a weird/locked file, say) is a 502
    rather than an unhandled 500, since it's an external-API failure, not a
    bug in the request itself.
    """
    resolved = await aguard(path)
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    try:
        details = await asyncio.to_thread(winshell.property_details, resolved)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"details": details}


# ---------------------------------------------------------------------------
# Shell icons at physical pixels (Stage 2C pass 2 -- Windows-icon sharpness,
# docs/superpowers/specs/2026-09-14-stage-2c-pass-2-icon-design.md §4.8).
# Read-only (path_guard "read"): the renderer's Windows-icon mode asks here
# first ("Tier A", Explorer-exact for every entry at every px) and falls back
# to Electron's app.getFileIcon ("Tier B") only when this backend is down,
# too old to have the route, or did not answer an item within the batch
# timeout. Both routes sit behind the token gate like everything else.
# ---------------------------------------------------------------------------

class ShellIconItem(BaseModel):
    path: str
    px: int
    is_dir: bool = False


class ShellIconsRequest(BaseModel):
    items: list[ShellIconItem]


_SHELL_ICONS_MAX_ITEMS = 200
_SHELL_ICON_TIMEOUT_S = 5.0      # single route
_SHELL_ICONS_TIMEOUT_S = 2.5     # batch: finished items are returned, the rest `pending`


def _shell_icon_png_headers() -> dict:
    # The renderer's LRU is the real cache; this lets a plain <img src> of the
    # single route (or a curious developer's browser tab) hold it for an hour.
    return {"Cache-Control": "private, max-age=3600"}


def _shell_icon_key_for(path: str, px: int, is_dir_hint: bool) -> tuple | None:
    """Blocking: guard, exists, key. None for a bad path / px / missing item --
    a null batch entry, never a batch failure."""
    if not winshell.ICON_PX_MIN <= px <= winshell.ICON_PX_MAX:
        return None
    try:
        resolved = path_guard(Path(path), "read")
    except Exception:
        return None
    if not resolved.exists():
        return None
    return winshell.shell_icon_key(resolved, is_dir_hint or resolved.is_dir(), px), resolved


@app.get("/shell/icon")
async def shell_icon(
    path: str = Query(..., description="Absolute path of the file or folder"),
    px: int = Query(..., description="Physical pixel size, 8..512"),
):
    """Explorer-exact shell icon for one path at exactly px x px
    (IShellItemImageFactory::GetImage, SIIGBF_ICONONLY|SIIGBF_SCALEUP), as
    image/png. 400 for px outside 8..512 or a malformed path, 404 for a
    missing path or when the shell has no image / did not answer within 5 s.
    """
    if not winshell.ICON_PX_MIN <= px <= winshell.ICON_PX_MAX:
        raise HTTPException(status_code=400, detail=f"px must be {winshell.ICON_PX_MIN}..{winshell.ICON_PX_MAX}")
    resolved = await aguard(path)  # relative/driveless -> BadPathError -> 400
    if not await asyncio.to_thread(resolved.exists):
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    key = winshell.shell_icon_key(resolved, resolved.is_dir(), px)
    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(winshell.icon_executor(), winshell.shell_image_cached, key, resolved, px, True)
    done, _ = await asyncio.wait({fut}, timeout=_SHELL_ICON_TIMEOUT_S)
    png = fut.result() if (fut in done and not fut.exception()) else None
    if png is None:
        raise HTTPException(status_code=404, detail="no shell image")
    return Response(content=png, media_type="image/png", headers=_shell_icon_png_headers())


@app.post("/shell/icons")
async def shell_icons(req: ShellIconsRequest):
    """Batch form of GET /shell/icon for a viewport of rows: one HTTP round
    trip, de-duplicated by icon key (per extension; per path for
    exe/dll/ico/lnk/url/cpl/scr and for every directory). Answers in request
    order as {png: base64 | null, pending: bool}. A bad path or px is a null
    entry, never a batch failure; an item the executor has not finished
    within 2.5 s is `pending` (it keeps running and fills the cache for the
    next request) so one hung icon handler cannot hold the whole viewport.
    """
    if len(req.items) > _SHELL_ICONS_MAX_ITEMS:
        raise HTTPException(status_code=400, detail=f"at most {_SHELL_ICONS_MAX_ITEMS} items")
    if not req.items:
        return {"items": []}
    # One worker thread for all the guards/stats (path_guard can block on a
    # slow volume; 200 separate to_thread hops would be the slower choice).
    keyed = await asyncio.to_thread(
        lambda: [_shell_icon_key_for(it.path, it.px, it.is_dir) for it in req.items]
    )
    loop = asyncio.get_running_loop()
    futs: dict[tuple, asyncio.Future] = {}
    for hit, it in zip(keyed, req.items):
        if hit is None:
            continue
        key, resolved = hit
        if key not in futs:
            futs[key] = loop.run_in_executor(
                winshell.icon_executor(), winshell.shell_image_cached, key, resolved, it.px, True,
            )
    done: set = set()
    if futs:
        done, _ = await asyncio.wait(set(futs.values()), timeout=_SHELL_ICONS_TIMEOUT_S)
    out = []
    for hit in keyed:
        if hit is None:
            out.append({"png": None, "pending": False})
            continue
        fut = futs[hit[0]]
        if fut not in done:
            out.append({"png": None, "pending": True})
            continue
        png = None if fut.exception() else fut.result()
        out.append({"png": base64.b64encode(png).decode("ascii") if png else None, "pending": False})
    return {"items": out}


# ---------------------------------------------------------------------------
# File-type taxonomy and Windows known folders
# ---------------------------------------------------------------------------

@app.get("/filetypes")
async def filetypes():
    return ft.as_json()


@app.get("/known-folders")
async def known_folders():
    # Six SHGetKnownFolderPath COM calls plus an is_dir() probe each -- off
    # the event loop, exactly like /drives and /fs/properties.
    return {"folders": await asyncio.to_thread(winshell.known_folders)}


# ---------------------------------------------------------------------------
# Drives
# ---------------------------------------------------------------------------

def _volume_label(mount: str) -> str:
    buf = ctypes.create_unicode_buffer(261)
    ok = ctypes.windll.kernel32.GetVolumeInformationW(ctypes.c_wchar_p(mount), buf, 261, None, None, None, None, 0)
    return buf.value if ok else ""


@app.get("/drives")
async def drives():
    def scan():
        out = []
        for p in psutil.disk_partitions(all=False):
            if "fixed" not in p.opts:
                continue
            try:
                u = psutil.disk_usage(p.mountpoint)
            except OSError:
                continue
            out.append({"letter": p.device.rstrip("\\"), "mount": p.mountpoint, "label": _volume_label(p.mountpoint),
                        "total_bytes": u.total, "free_bytes": u.free, "used_bytes": u.used})
        return out
    return await asyncio.to_thread(scan)


# ---------------------------------------------------------------------------
# Scan endpoint
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    path: Optional[str] = None
    hash: bool = True


@app.post("/scan")
async def trigger_scan(body: Optional[ScanRequest] = None):
    """Index a directory. Uses FILEPLUS_SANDBOX_PATH when no path is provided.

    Guarded exactly like POST /index and DELETE /index: the path is
    canonicalised through path_guard, a protected system root is refused with
    403 (scan_directory would otherwise record an index_roots row that
    DELETE /index then refuses to remove), and a concurrent quick index is
    refused with 409.
    """
    raw = Path(body.path) if (body and body.path) else _config.FILEPLUS_SANDBOX_PATH
    root = await aguard(raw)
    if _config.is_protected_read(root):
        raise HTTPException(status_code=403, detail="system folders are not indexed")
    if app.state.index_state["running"]:
        raise HTTPException(status_code=409, detail="An index is already running")
    do_hash = body.hash if body else True
    count = await scan_directory(root, hash=do_hash)
    stale = await remove_stale_entries(root)
    return {"count": count, "stale_removed": stale, "path": str(root)}


# ---------------------------------------------------------------------------
# Quick index — background scan without hashing
# ---------------------------------------------------------------------------

class IndexRequest(BaseModel):
    path: str


async def _run_index(path: Path) -> None:
    try:
        count = await scan_directory(path, hash=False)
        await remove_stale_entries(path)
        app.state.index_state["count"] = count
    except Exception as exc:
        app.state.index_state["error"] = str(exc)
        logger.exception("Quick index of %s failed", path)
    finally:
        app.state.index_state["running"] = False


@app.post("/index")
async def start_index(body: IndexRequest):
    """Kick off a background, non-hashing scan of *path*.

    Refused with 403 for a protected system root (reads are otherwise
    allowed everywhere, so this is an explicit check rather than relying on
    path_guard's write-mode rules) and with 409 while another index runs.
    The default sandbox lives inside FILEPLUS_APP_DIR, one of the protected
    roots -- config.is_protected_read exempts it the same way path_guard
    does for writes, so indexing the sandbox is never wrongly refused.
    """
    resolved = await aguard(body.path)
    if _config.is_protected_read(resolved):
        raise HTTPException(status_code=403, detail="system folders are not indexed")
    if app.state.index_state["running"]:
        raise HTTPException(status_code=409, detail="An index is already running")
    app.state.index_state.update({
        "running": True, "path": str(resolved), "count": 0,
        "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "error": None,
    })

    def _log_task_exception(task: "asyncio.Task") -> None:
        exc = task.exception() if not task.cancelled() else None
        if exc is not None:
            logger.error("Quick index task for %s raised: %r", resolved, exc)

    task = asyncio.create_task(_run_index(resolved))
    task.add_done_callback(_log_task_exception)
    app.state.index_task = task
    return {"started": True}


@app.get("/index/status")
async def index_status():
    """Indexed roots (from index_roots, kept current by scan_directory), plus
    whether a quick-index scan is running right now and how the last one
    ended.

    `error` is the message _run_index recorded when the background scan
    raised (None otherwise), alongside the `path`/`count`/`started` it also
    tracks. Without it "stopped running" and "succeeded" were the same
    answer, so a failed index reported as "Indexing finished" with nothing
    to show for it.
    """
    async with _db() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT root, file_count, last_run FROM index_roots ORDER BY root")
        rows = await cur.fetchall()
    state = app.state.index_state
    return {
        "roots": [dict(row) for row in rows],
        "running": state["running"],
        "error": state.get("error"),
        "path": state.get("path"),
        "count": state.get("count"),
        "started": state.get("started"),
    }


@app.delete("/index")
async def delete_index_root(root: str = Query(..., description="Absolute path of a previously-indexed root to forget")):
    """Forget an indexed root: drop every files row under it and its
    index_roots bookkeeping row. *root* need not still exist on disk --
    this is how a removed/unmounted root gets cleaned out of the index.

    The rows go whether or not the files are still there. This used to call
    remove_stale_entries, which by construction only deletes rows whose path
    has *vanished* -- so every still-present file under the removed root kept
    its row, and GET /search (which reads `files` with no index_roots join)
    kept returning them, contradicting the confirm modal's promise that the
    root "will stop appearing in This PC search results".

    Mirrors POST /index's guard checks: 403 for a protected system root, and
    409 while any quick-index scan is running -- not just one scanning this
    root, since a running scan of *any* root can re-insert an index_roots row
    concurrently with this delete (scan_directory's upsert would otherwise
    race the DELETE below and resurrect the very row this call means to
    remove).
    """
    resolved = await aguard(root)
    if _config.is_protected_read(resolved):
        raise HTTPException(status_code=403, detail="system folders are not indexed")
    if app.state.index_state["running"]:
        raise HTTPException(status_code=409, detail="An index is already running")
    removed = await forget_root(resolved)
    async with _db() as conn:
        await conn.execute("DELETE FROM index_roots WHERE root = ?", (str(resolved),))
        await conn.commit()
    return {"status": "ok", "removed": removed}


# ---------------------------------------------------------------------------
# Tags endpoints
# ---------------------------------------------------------------------------

@app.get("/tags")
async def list_tags(q: Optional[str] = Query(None), limit: int = Query(10)):
    """Every tag, with the number of files carrying it.

    The full (no-`q`) listing joins `file_tags` so each row carries a
    `count` -- the sidebar's Tags section ranks the top 8 tags by it, and a
    tag nobody has applied (count 0) is hidden there rather than offered as
    a search filter that can only ever return nothing. The prefix-search
    branch (`q=`, used by the Inspector's tag autocomplete) keeps
    tagger.search_tags' own shape untouched: it feeds a name picker, which
    has no use for a count.
    """
    async with _db() as conn:
        if q:
            return await tagger.search_tags(conn, q, limit)
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT t.id, t.name, t.color, t.tag_group, t.tag_type, "
            "       COUNT(ft.file_id) AS count "
            "FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id "
            "GROUP BY t.id, t.name, t.color, t.tag_group, t.tag_type "
            "ORDER BY t.name COLLATE NOCASE"
        )
        rows = await cur.fetchall()
    return [dict(row) for row in rows]


class TagAdd(BaseModel):
    name: str


async def _require_file(conn, file_id: int) -> None:
    cur = await conn.execute("SELECT 1 FROM files WHERE id = ?", (file_id,))
    if await cur.fetchone() is None:
        raise HTTPException(status_code=404, detail=f"File not found: {file_id}")


@app.get("/files/{file_id}/tags")
async def get_file_tags(file_id: int):
    async with _db() as conn:
        await _require_file(conn, file_id)
        return await tagger.get_tags(conn, file_id)


@app.post("/files/{file_id}/tags")
async def add_file_tag(file_id: int, body: TagAdd):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name must not be empty")
    async with _db() as conn:
        await _require_file(conn, file_id)
        tag_ids = await tagger.apply_tags(conn, file_id, [name])
    return {"status": "ok", "tag_ids": tag_ids}


@app.delete("/files/{file_id}/tags/{tag_id}")
async def delete_file_tag(file_id: int, tag_id: int):
    async with _db() as conn:
        await _require_file(conn, file_id)
        await tagger.remove_tag(conn, file_id, tag_id)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Filesystem mutations — every write is guarded and logged by backend.mover
# ---------------------------------------------------------------------------

class DirName(BaseModel):
    dir: str
    name: str


class RenameReq(BaseModel):
    path: str
    new_name: str


class MoveReq(BaseModel):
    sources: list[str]
    dest: str
    on_conflict: Literal["fail", "skip", "keep-both", "replace"] = "fail"


class PathsReq(BaseModel):
    paths: list[str]


class AttributesReq(BaseModel):
    path: str
    read_only: Optional[bool] = None
    hidden: Optional[bool] = None
    archive: Optional[bool] = None


class FolderTypeReq(BaseModel):
    path: str
    type: Literal["Generic", "Documents", "Pictures", "Videos", "Music"]


def _single(res: dict) -> dict:
    """Wrap a single-item mover result in the same shape as the batch routes."""
    return {
        "batch_id": res.get("batch_id"),
        "ops": [res] if res["status"] == "done" else [],
        "conflicts": [res] if res["status"] == "conflict" else [],
        "skipped": [res] if res["status"] == "skipped" else [],
        "errors": [],
    }


@app.post("/fs/mkdir")
async def fs_mkdir(body: DirName):
    async with _db() as conn:
        return _single(await mover.mkdir(conn, Path(body.dir), body.name, batch_id=ol.new_batch_id()))


@app.post("/fs/touch")
async def fs_touch(body: DirName):
    async with _db() as conn:
        return _single(await mover.touch(conn, Path(body.dir), body.name, batch_id=ol.new_batch_id()))


@app.post("/fs/rename")
async def fs_rename(body: RenameReq):
    async with _db() as conn:
        return _single(await mover.rename(conn, Path(body.path), body.new_name, batch_id=ol.new_batch_id()))


@app.post("/fs/attributes")
async def fs_attributes(body: AttributesReq):
    """Set read-only/hidden/archive on a file or folder (logged, undoable: op_type attr-set).

    Any of the three flags left as null leaves that attribute unchanged;
    SetFileAttributesW is called once with the merged bitmask, so it never
    touches a bit the caller didn't ask about (a folder's contents are never
    touched either way — attr-set only ever calls SetFileAttributesW on
    *path* itself). All three null at once means "change nothing" -- 422,
    with no operations_log row written, rather than a no-op attr-set that
    would clutter the history and be undoable to no visible effect.
    """
    if body.read_only is None and body.hidden is None and body.archive is None:
        raise HTTPException(status_code=422, detail="At least one of read_only, hidden, or archive must be set.")
    async with _db() as conn:
        op = await mover.set_attributes(conn, Path(body.path), read_only=body.read_only, hidden=body.hidden,
                                        archive=body.archive, batch_id=ol.new_batch_id())
    return {"batch_id": op["batch_id"], "op": op}


@app.post("/fs/folder-type")
async def fs_folder_type(body: FolderTypeReq):
    """Set a folder's Explorer "optimize this folder for" type (logged, undoable: op_type folder-type-set).

    *type* is one of the five Explorer folder types (Pydantic Literal ->
    automatic 422 for anything else, before this ever reaches mover).
    """
    async with _db() as conn:
        op = await mover.set_folder_type(conn, Path(body.path), body.type, batch_id=ol.new_batch_id())
    return {"batch_id": op["batch_id"], "op": op}


@app.post("/fs/move")
async def fs_move(body: MoveReq):
    async with _db() as conn:
        return await mover.batch_move(conn, [Path(s) for s in body.sources], Path(body.dest), body.on_conflict)


@app.post("/fs/copy")
async def fs_copy(body: MoveReq):
    async with _db() as conn:
        return await mover.batch_copy(conn, [Path(s) for s in body.sources], Path(body.dest), body.on_conflict)


@app.post("/fs/trash")
async def fs_trash(body: PathsReq):
    async with _db() as conn:
        return await mover.batch_trash(conn, [Path(p) for p in body.paths])


@app.post("/fs/trash/empty")
async def fs_trash_empty():
    async with _db() as conn:
        return await mover.empty_trash(conn)


# ---------------------------------------------------------------------------
# Operations / undo endpoints
# ---------------------------------------------------------------------------

@app.get("/operations")
async def operations(limit: int = 50, offset: int = 0, path: Optional[str] = None):
    async with _db() as conn:
        return await ol.list_operations(conn, limit=limit, offset=offset, path=path)


@app.get("/operations/pending")
async def operations_pending():
    return list(app.state.reconciled)  # filled at startup (Task 9); [] until then


@app.post("/operations/pending/ack")
async def operations_pending_ack():
    """Acknowledge the startup reconciliation report, clearing it.

    ``app.state.reconciled`` is computed once, in the lifespan, and nothing
    else ever drains it -- so the renderer's crash-recovery modal
    (checkCrashRecovery, frontend/src/app.js) re-opened on every renderer
    start, and on every Ctrl+R reload, for as long as the *backend* process
    lived. The renderer posts here once it has shown the report; the rows
    themselves stay in ``operations_log`` (this touches no database row and no
    file -- it only forgets the in-memory "show this once" report).
    """
    count = len(app.state.reconciled)
    app.state.reconciled = []
    return {"acknowledged": count}


@app.post("/operations/{op_id}/undo")
async def undo_operation(op_id: int):
    async with _db() as conn:
        return await mover.undo_operation(conn, op_id)


@app.post("/operations/batch/{batch_id}/undo")
async def undo_batch(batch_id: str):
    async with _db() as conn:
        return await mover.undo_batch(conn, batch_id)


# ---------------------------------------------------------------------------
# Config / recent / favorites / pins
# ---------------------------------------------------------------------------

class ConfigSet(BaseModel):
    key: str
    value: Any


class RecentAdd(BaseModel):
    path: str
    action: str


class PathBody(BaseModel):
    path: str


class ReorderPaths(BaseModel):
    paths: list[str]


class PinAdd(BaseModel):
    path: str
    label: Optional[str] = None


class PinPatch(BaseModel):
    label: str


class ReorderIds(BaseModel):
    ids: list[int]


@app.get("/config")
async def get_config():
    async with _db() as conn:
        return await stores.config_get_all(conn)


@app.get("/config/{key}")
async def get_config_key(key: str):
    async with _db() as conn:
        value = await stores.config_get(conn, key)
    if value is None:
        raise HTTPException(status_code=404, detail=f"No such config key: {key}")
    return {"key": key, "value": value}


@app.post("/config")
async def post_config(body: ConfigSet):
    async with _db() as conn:
        await stores.config_set(conn, body.key, body.value)
    return {"key": body.key, "value": body.value}


@app.delete("/config/{key}")
async def delete_config(key: str):
    async with _db() as conn:
        await stores.config_delete(conn, key)
    return {"status": "deleted", "key": key}


@app.get("/recent")
async def get_recent(limit: int = 200):
    async with _db() as conn:
        return await stores.recent_groups(conn, limit=limit)


@app.post("/recent")
async def post_recent(body: RecentAdd):
    async with _db() as conn:
        await stores.recent_add(conn, body.path, body.action)
    return {"status": "ok"}


@app.get("/favorites")
async def get_favorites():
    async with _db() as conn:
        return await stores.favorites_list(conn)


@app.post("/favorites")
async def post_favorites(body: PathBody):
    async with _db() as conn:
        return await stores.favorites_add(conn, body.path)


@app.delete("/favorites")
async def delete_favorites(path: str = Query(...)):
    async with _db() as conn:
        await stores.favorites_remove(conn, path)
    return {"status": "deleted", "path": path}


@app.post("/favorites/reorder")
async def post_favorites_reorder(body: ReorderPaths):
    async with _db() as conn:
        await stores.favorites_reorder(conn, body.paths)
    return {"status": "ok"}


@app.get("/pins")
async def get_pins():
    async with _db() as conn:
        return await stores.pins_list(conn)


@app.post("/pins")
async def post_pins(body: PinAdd):
    async with _db() as conn:
        return await stores.pins_add(conn, body.path, body.label)


@app.patch("/pins/{pin_id}")
async def patch_pins(pin_id: int, body: PinPatch):
    async with _db() as conn:
        ok = await stores.pins_update(conn, pin_id, body.label)
    if not ok:
        raise HTTPException(status_code=404, detail="pin not found")
    return {"status": "ok", "id": pin_id, "label": body.label}


@app.delete("/pins/{pin_id}")
async def delete_pins(pin_id: int):
    async with _db() as conn:
        ok = await stores.pins_remove(conn, pin_id)
    if not ok:
        raise HTTPException(status_code=404, detail="pin not found")
    return {"status": "deleted", "id": pin_id}


@app.post("/pins/reorder")
async def post_pins_reorder(body: ReorderIds):
    async with _db() as conn:
        await stores.pins_reorder(conn, body.ids)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    from backend.logging_setup import setup_logging

    _log_file = setup_logging(_config.FILEPLUS_LOG_DIR)
    logging.getLogger("backend.api").info(
        "backend starting: port=%s env=%s root=%s db=%s log=%s",
        _config.FILEPLUS_PORT, getattr(_config, "FILEPLUS_ENV", "-"),
        _config.FILEPLUS_SANDBOX_PATH, _config.FILEPLUS_DB_PATH, _log_file,
    )
    # log_config=None: uvicorn leaves logging alone, so its own records flow
    # through the root handlers setup_logging just installed (backend.log).
    uvicorn.run("backend.api:app", host="127.0.0.1", port=_config.FILEPLUS_PORT, reload=False, log_config=None)
