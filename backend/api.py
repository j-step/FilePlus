"""FilePlus FastAPI backend — HTTP API served on localhost:9876.

The Electron frontend communicates exclusively through this API.
All business logic lives here; the renderer never touches the filesystem directly.
"""
import asyncio
import ctypes
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import aiosqlite
import psutil
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import backend.config as _config
from backend.config import OutOfSandboxError, ProtectedPathError, path_guard
from backend.database import init_db
from backend.indexer import scan_directory, remove_stale_entries
from backend import mover, operations_log as ol

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    app.state.index_state = {"running": False, "path": None, "count": 0, "started": None, "error": None}
    app.state.reconciled = []  # filled at startup by Task 9's reconcile call
    yield


app = FastAPI(title="FilePlus API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Error mapping — mover/config exceptions become HTTP responses everywhere
# ---------------------------------------------------------------------------

@app.exception_handler(OutOfSandboxError)
@app.exception_handler(ProtectedPathError)
async def _forbidden(_r, exc):
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(mover.InvalidNameError)
@app.exception_handler(mover.ConflictError)
@app.exception_handler(mover.RefusedError)
async def _conflict(_r, exc):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(FileNotFoundError)
async def _missing(_r, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(PermissionError)
async def _denied(_r, exc):
    return JSONResponse(status_code=403, content={"detail": f"Access denied: {exc}"})


def _db():
    return aiosqlite.connect(_config.FILEPLUS_DB_PATH)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    try:
        async with _db() as conn:
            await conn.execute("SELECT 1")
            pending_ops = len(await ol.pending_operations(conn))
        db_ok = True
    except Exception:
        db_ok = False
        pending_ops = 0
    return {
        "status": "ok",
        "version": "0.1.0",
        "db_ok": db_ok,
        "write_unlocked": _config.WRITE_UNLOCKED,
        "pending_ops": pending_ops,
        "index_running": app.state.index_state["running"],
    }


# ---------------------------------------------------------------------------
# Files endpoints
# ---------------------------------------------------------------------------

@app.get("/files")
async def list_files(
    path: Optional[str] = Query(None, description="Filter to files whose path starts with this prefix"),
    q: Optional[str] = Query(None, description="Substring search on filename"),
):
    """Return all indexed files, optionally filtered by path prefix and/or filename search."""
    conditions = []
    params: list = []
    if path:
        conditions.append("path LIKE ?")
        params.append(path.rstrip("\\").rstrip("/") + "%")
    if q:
        conditions.append("filename LIKE ?")
        params.append(f"%{q}%")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    sql = f"SELECT id, path, filename, extension, size, modified, category, status, is_pinned FROM files {where} ORDER BY filename COLLATE NOCASE"
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(sql, params)
        rows = await cur.fetchall()
    return [dict(row) for row in rows]


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

def _scandir_entries(directory: Path, show_hidden: bool) -> tuple[list[dict], bool]:
    """Return (entries, truncated) for the given directory.

    Read-only, so any real drive can be listed (browsing real drives is the
    product). A PermissionError on the directory itself propagates so the
    caller can turn it into a 403 -- but a per-entry stat failure (a locked
    or permission-denied child, common under real drive roots like
    ``C:\\System Volume Information``) never aborts the whole listing: that
    entry is returned with an ``"error"`` field and zero size instead.

    Hidden entries (leading dot, or the Windows hidden attribute) are
    dropped unless show_hidden is true. The listing stops at
    _config.LISTING_CAP entries and reports truncated=True when it does.
    """
    entries: list[dict] = []
    truncated = False
    for de in os.scandir(directory):
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
            if len(entries) >= _config.LISTING_CAP:
                truncated = True
                break
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
        if len(entries) >= _config.LISTING_CAP:
            truncated = True
            break
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return entries, truncated


def _listing_response(resolved: Path, entries: list[dict], truncated: bool) -> dict:
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
    drives is the product (D2). Returns 404 if the path doesn't exist or
    isn't a directory; per-entry permission errors never 500 (see
    _scandir_entries), but a PermissionError on the directory itself is
    mapped to 403 by the exception handler above.
    """
    resolved = path_guard(Path(path), "read")
    if not resolved.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {path}")
    entries, truncated = await asyncio.to_thread(_scandir_entries, resolved, show_hidden)
    return _listing_response(resolved, entries, truncated)


@app.get("/fs/list/root")
async def fs_list_root():
    """Return the sandbox root listing without requiring a path argument."""
    root = _config.FILEPLUS_SANDBOX_PATH.resolve()
    if not root.is_dir():
        raise HTTPException(status_code=404, detail=f"Sandbox root missing: {root}")
    entries, truncated = await asyncio.to_thread(_scandir_entries, root, False)
    return _listing_response(root, entries, truncated)


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
            if "fixed" not in p.opts and "rw" not in p.opts:
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


@app.post("/scan")
async def trigger_scan(body: Optional[ScanRequest] = None):
    """Index a directory. Uses FILEPLUS_SANDBOX_PATH when no path is provided."""
    root = Path(body.path) if (body and body.path) else _config.FILEPLUS_SANDBOX_PATH
    count = await scan_directory(root)
    stale = await remove_stale_entries()
    return {"count": count, "stale_removed": stale, "path": str(root)}


# ---------------------------------------------------------------------------
# Tags endpoints
# ---------------------------------------------------------------------------

@app.get("/tags")
async def list_tags():
    async with aiosqlite.connect(_config.FILEPLUS_DB_PATH) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM tags ORDER BY name COLLATE NOCASE")
        rows = await cur.fetchall()
    return [dict(row) for row in rows]


@app.post("/files/{file_id}/tags")
async def add_tag(file_id: int):
    # TODO: implement — Phase 2 (tagger)
    return {"status": "not_implemented"}


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
    on_conflict: str = "fail"


class PathsReq(BaseModel):
    paths: list[str]


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
        return _single(await mover.mkdir(conn, Path(body.dir), body.name))


@app.post("/fs/touch")
async def fs_touch(body: DirName):
    async with _db() as conn:
        return _single(await mover.touch(conn, Path(body.dir), body.name))


@app.post("/fs/rename")
async def fs_rename(body: RenameReq):
    async with _db() as conn:
        return _single(await mover.rename(conn, Path(body.path), body.new_name))


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


@app.post("/operations/{op_id}/undo")
async def undo_operation(op_id: int):
    async with _db() as conn:
        return await mover.undo_operation(conn, op_id)


@app.post("/operations/batch/{batch_id}/undo")
async def undo_batch(batch_id: str):
    async with _db() as conn:
        return await mover.undo_batch(conn, batch_id)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api:app", host="127.0.0.1", port=9876, reload=False)
