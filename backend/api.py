"""FilePlus FastAPI backend — HTTP API served on localhost:9876.

The Electron frontend communicates exclusively through this API.
All business logic lives here; the renderer never touches the filesystem directly.
"""
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import aiosqlite
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import backend.config as _config
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
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="File not found")
    return dict(row)


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
