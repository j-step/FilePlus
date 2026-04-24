"""FilePlus FastAPI backend — HTTP API served on localhost:9876.

The Electron frontend communicates exclusively through this API.
All business logic lives here; the renderer never touches the filesystem directly.

Phase 4 implementation target.
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

app = FastAPI(title="FilePlus API", version="0.1.0")

# Allow the Electron renderer (file:// origin) to call the API
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
    """Return API status. Used by the frontend to detect backend availability."""
    return {"status": "ok", "version": "0.1.0"}


# ---------------------------------------------------------------------------
# Files endpoints — Phase 4
# ---------------------------------------------------------------------------

@app.get("/files")
async def list_files():
    # TODO: implement in Phase 4
    pass


@app.get("/files/{file_id}")
async def get_file(file_id: int):
    # TODO: implement in Phase 4
    pass


# ---------------------------------------------------------------------------
# Tags endpoints — Phase 4
# ---------------------------------------------------------------------------

@app.get("/tags")
async def list_tags():
    # TODO: implement in Phase 4
    pass


@app.post("/files/{file_id}/tags")
async def add_tag(file_id: int):
    # TODO: implement in Phase 4
    pass


# ---------------------------------------------------------------------------
# Indexer endpoints — Phase 4
# ---------------------------------------------------------------------------

@app.post("/index/scan")
async def trigger_scan():
    # TODO: implement in Phase 4
    pass


# ---------------------------------------------------------------------------
# Operations / undo endpoints — Phase 10
# ---------------------------------------------------------------------------

@app.get("/operations")
async def list_operations():
    # TODO: implement in Phase 10
    pass


@app.post("/operations/{op_id}/undo")
async def undo_operation(op_id: int):
    # TODO: implement in Phase 10
    pass


@app.post("/operations/batch/{batch_id}/undo")
async def undo_batch(batch_id: str):
    # TODO: implement in Phase 10
    pass


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    from backend.config import FILEPLUS_DB_PATH
    from backend.database import init_db
    import asyncio

    async def startup() -> None:
        await init_db()

    asyncio.run(startup())
    uvicorn.run("backend.api:app", host="127.0.0.1", port=9876, reload=False)
