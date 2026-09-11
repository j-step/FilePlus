"""FilePlus FastAPI backend — HTTP API served on localhost:9876.

The Electron frontend communicates exclusively through this API.
All business logic lives here; the renderer never touches the filesystem directly.
"""
import asyncio
import ctypes
import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiosqlite
import psutil
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Any

import backend.config as _config
from backend.config import OutOfSandboxError, ProtectedPathError, path_guard
from backend.database import init_db
from backend.indexer import index_file, scan_directory, remove_stale_entries
from backend import mover, operations_log as ol, stores, tagger

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


def _kind_for(path: Path) -> str:
    if path.is_dir():
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
    limit: Optional[int] = Query(None),
    offset: int = Query(0),
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
    if limit is not None:
        sql += " LIMIT ? OFFSET ?"
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
    resolved = path_guard(Path(path), "read")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    async with _db() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM files WHERE path = ?", (str(resolved),))
        row = await cur.fetchone()
        if row is None:
            await index_file(resolved, conn, hash=True)
            await conn.commit()
            cur = await conn.execute("SELECT * FROM files WHERE path = ?", (str(resolved),))
            row = await cur.fetchone()
        data = dict(row)
        data["tags"] = await tagger.get_tags(conn, data["id"])
    data["kind"] = _kind_for(resolved)
    return data


@app.get("/preview")
async def preview(path: str = Query(..., description="Absolute path of the file")):
    """Return a lightweight preview: text snippet, an image response, or a binary marker."""
    resolved = path_guard(Path(path), "read")
    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path}")
    if resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")
    ext = resolved.suffix.lower().lstrip(".")
    size = resolved.stat().st_size
    if ext in _PREVIEW_IMAGE_EXTS:
        if size > _PREVIEW_MAX_IMAGE_BYTES:
            return {"kind": "too-large"}
        media_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        return FileResponse(str(resolved), media_type=media_type)
    if ext in _PREVIEW_TEXT_EXTS:
        raw = resolved.read_bytes()
        content = raw[:4096].decode("utf-8", errors="replace")
        return {"kind": "text", "content": content, "truncated": size > 4096, "total_size": size}
    return {"kind": "binary", "size": size}


@app.get("/files/history")
async def files_history(path: str = Query(..., description="Absolute path to look up operation history for")):
    """Return the operations_log rows touching *path*, most recent first.

    Registered before /files/{file_id} so "history" is never swallowed as an
    (invalid) integer file id.
    """
    resolved = path_guard(Path(path), "read")
    async with _db() as conn:
        return await ol.list_operations(conn, path=str(resolved))


@app.get("/search")
async def search_files(q: str = Query(..., description="Substring to match against filename or path"), limit: int = Query(50)):
    async with _db() as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT id, path, filename, extension, size, modified, hash FROM files "
            "WHERE filename LIKE ? OR path LIKE ? ORDER BY filename COLLATE NOCASE LIMIT ?",
            (f"%{q}%", f"%{q}%", limit),
        )
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
    """Index a directory. Uses FILEPLUS_SANDBOX_PATH when no path is provided."""
    root = Path(body.path) if (body and body.path) else _config.FILEPLUS_SANDBOX_PATH
    do_hash = body.hash if body else True
    count = await scan_directory(root, hash=do_hash)
    stale = await remove_stale_entries()
    return {"count": count, "stale_removed": stale, "path": str(root)}


# ---------------------------------------------------------------------------
# Quick index — background scan without hashing
# ---------------------------------------------------------------------------

class IndexRequest(BaseModel):
    path: str


async def _run_index(path: Path) -> None:
    try:
        count = await scan_directory(path, hash=False)
        await remove_stale_entries()
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
    """
    resolved = path_guard(Path(body.path), "read")
    if any(_config.is_under(resolved, root) for root in _config.PROTECTED_WRITE_ROOTS):
        raise HTTPException(status_code=403, detail="system folders are not indexed")
    if app.state.index_state["running"]:
        raise HTTPException(status_code=409, detail="An index is already running")
    app.state.index_state.update({
        "running": True, "path": str(resolved), "count": 0,
        "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "error": None,
    })
    asyncio.create_task(_run_index(resolved))
    return {"started": True}


@app.get("/index/status")
async def index_status():
    return app.state.index_state


# ---------------------------------------------------------------------------
# Tags endpoints
# ---------------------------------------------------------------------------

@app.get("/tags")
async def list_tags(q: Optional[str] = Query(None), limit: int = Query(10)):
    async with _db() as conn:
        if q:
            return await tagger.search_tags(conn, q, limit)
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM tags ORDER BY name COLLATE NOCASE")
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
    uvicorn.run("backend.api:app", host="127.0.0.1", port=9876, reload=False)
