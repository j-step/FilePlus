"""FilePlus FastAPI backend — HTTP API served on localhost:9876.

The Electron frontend communicates exclusively through this API.
All business logic lives here; the renderer never touches the filesystem directly.
"""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import aiosqlite
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import backend.config as _config
from backend.config import OutOfSandboxError, path_guard
from backend.database import init_db
from backend.indexer import scan_directory, remove_stale_entries

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="FilePlus API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


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

def _scandir_entries(directory: Path) -> list[dict]:
    """Return a list of entry dicts for the given directory.

    Each entry includes name, is_dir, size, modified (epoch float),
    ext (lowercased, with leading dot, empty for directories),
    and is_hidden (Windows hidden attribute or leading dot).
    """
    entries: list[dict] = []
    for de in os.scandir(directory):
        try:
            stat = de.stat(follow_symlinks=False)
        except (PermissionError, FileNotFoundError):
            continue
        is_dir = de.is_dir(follow_symlinks=False)
        ext = "" if is_dir else os.path.splitext(de.name)[1].lower()
        is_hidden = de.name.startswith(".")
        if os.name == "nt":
            try:
                attrs = stat.st_file_attributes  # type: ignore[attr-defined]
                is_hidden = is_hidden or bool(attrs & 0x2)  # FILE_ATTRIBUTE_HIDDEN
            except (AttributeError, OSError):
                pass
        entries.append({
            "name": de.name,
            "is_dir": is_dir,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "ext": ext,
            "is_hidden": is_hidden,
        })
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return entries


@app.get("/fs/list")
async def fs_list(path: str = Query(..., description="Absolute path of directory to list")):
    """Return a directory listing for the given absolute path.

    Read-only, so path_guard (mode="read") allows any path — browsing real
    drives is the product (D2). Returns 404 if the path doesn't exist or
    isn't a directory.
    """
    try:
        resolved = path_guard(Path(path))
    except OutOfSandboxError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {path}")
    return {"path": str(resolved), "entries": _scandir_entries(resolved)}


@app.get("/fs/list/root")
async def fs_list_root():
    """Return the sandbox root listing without requiring a path argument."""
    root = _config.FILEPLUS_SANDBOX_PATH.resolve()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=404, detail=f"Sandbox root missing: {root}")
    return {"path": str(root), "entries": _scandir_entries(root)}


# ---------------------------------------------------------------------------
# Scan endpoint
# ---------------------------------------------------------------------------

class ScanRequest(BaseModel):
    path: Optional[str] = None


@app.post("/scan")
async def trigger_scan(body: Optional[ScanRequest] = None):
    """Index a directory. Uses FILEPLUS_SANDBOX_PATH when no path is provided."""
    root = Path(body.path) if (body and body.path) else _config.FILEPLUS_SANDBOX_PATH
    try:
        count = await scan_directory(root)
    except OutOfSandboxError as e:
        raise HTTPException(status_code=403, detail=str(e))
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
# Operations / undo endpoints
# ---------------------------------------------------------------------------

@app.get("/operations")
async def list_operations():
    # TODO: implement — Phase 3 (operations_log)
    return []


@app.post("/operations/{op_id}/undo")
async def undo_operation(op_id: int):
    # TODO: implement — Phase 3
    return {"status": "not_implemented"}


@app.post("/operations/batch/{batch_id}/undo")
async def undo_batch(batch_id: str):
    # TODO: implement — Phase 3
    return {"status": "not_implemented"}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api:app", host="127.0.0.1", port=9876, reload=False)
