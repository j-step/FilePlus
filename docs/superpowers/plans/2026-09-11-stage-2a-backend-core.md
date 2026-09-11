# Stage 2A — Backend Safety Core and API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every file operation the explorer needs (list, mkdir, touch, rename, move, copy, trash, restore, undo/redo, empty trash) exists as a logged, guarded, tested backend function with an HTTP route, plus the supporting stores (config, recent, favorites, pins), search/quick-index, file meta/preview/tags/history, drives, and the Electron shell bridge.

**Architecture:** `config.path_guard(path, mode)` is the only gate. `operations_log.py` owns the log rows. `mover.py` owns every filesystem mutation and the inverse operations for undo; it always logs before acting and runs blocking I/O in `asyncio.to_thread`. `api.py` maps exceptions to status codes and stays thin. New tables arrive as schema v3. Nothing is hard-deleted: "delete" is a same-volume move into `.FilePlusTrash`; "empty trash" uses `send2trash`.

**Tech Stack:** Python 3.14 (`py -3`), FastAPI, aiosqlite, `psutil`, `send2trash`, ctypes (volume labels, hidden attribute), pytest with the `sandbox`/`db` fixtures; Electron 41 `shell`/`dialog`/`clipboard` via preload.

**Spec:** `docs/superpowers/specs/2026-09-11-stage-2-explorer-parity-design.md` §3 (safety), §4 (API), §5 (bridge), §8 (verification).

## Global Constraints

- Work in the worktree `C:\Dev\FilePlus\.worktrees\stage-2a-backend` on branch `stage/2a-backend` (created by the controller; `frontend/node_modules` installed there). Never touch `C:\Dev\FilePlus` itself.
- Python is `py -3`; tests run from the worktree root: `py -3 -m pytest -q`. The verify gate is `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` (green before every commit; expected pytest count grows per task and is stated in each task).
- `WRITE_UNLOCKED` is **false** in every test; tests that need "unlocked" behaviour monkeypatch `backend.config.WRITE_UNLOCKED`.
- Every mutating function: `path_guard(..., 'write')` on every source and destination → `log_operation(executed=0)` → act → `mark_executed`; on exception `mark_error` and re-raise. No exceptions to this order.
- No hard delete anywhere except the post-verification removal of a cross-volume move's source. `os.remove`/`shutil.rmtree` may appear only in `mover._remove_after_verified_copy` and in tests.
- Async everywhere; blocking I/O via `asyncio.to_thread`. No global DB connection: routes open `aiosqlite.connect(_config.FILEPLUS_DB_PATH)` per request and pass `conn` down.
- Routes have no `/api/` prefix. Frontend is untouched in this plan except `frontend/main.js` and `frontend/preload.js` (Task 9).
- Commit with `git -c core.safecrlf=false commit`; every message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (the trailer names the directing session; do not substitute another model name; if unwilling, omit it and say so).

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `backend/config.py` | `path_guard(path, mode)`, `WRITE_UNLOCKED`, `PROTECTED_WRITE_ROOTS`, `ProtectedPathError`, `TRASH_DIRNAME` | 1 |
| `tests/conftest.py`, `tests/test_api.py`, `tests/test_indexer.py`, `.env.example`, `requirements.txt` | guard changes, deps | 1 |
| `backend/database.py` | schema v3: `config`, `recent_actions`, `favorites`, `pinned_folders`; `operations_log.error/undo_of`; indexes | 2 |
| `backend/operations_log.py` | log rows: create, mark, list, pending, reconcile | 3 |
| `backend/mover.py` (part 1) | names, conflicts, trash roots, volume checks, `move`, `rename`, `trash`, `restore`, `copy`, `mkdir`, `touch`, batches, `empty_trash` | 4 |
| `backend/mover.py` (part 2) | `undo_operation`, `undo_batch` | 5 |
| `backend/api.py` (fs + operations + drives + health) | routes | 6 |
| `backend/api.py` (config, recent, favorites, pins) | routes + `backend/stores.py` | 7 |
| `backend/api.py` (file meta, preview, tags, history, search, quick index), `backend/tagger.py`, `backend/indexer.py` | routes + modules | 8 |
| `frontend/main.js`, `frontend/preload.js`, `scripts/verify.ps1`, `CLAUDE.md`, `docs/superpowers/runs/<date>-stage-2a.md` | bridge, startup reconcile, gate, docs | 9 |

---

### Task 1: `path_guard` modes, `WRITE_UNLOCKED`, protected roots

**Files:**
- Modify: `backend/config.py`, `tests/conftest.py`, `tests/test_api.py` (the 403 scan test), `tests/test_indexer.py` (any `SAFETY_MODE` reference), `.env.example`, `requirements.txt`
- Create: `tests/test_path_guard.py`

**Interfaces:**
- Produces: `path_guard(path, mode='read'|'write') -> Path`; exceptions `OutOfSandboxError`, `ProtectedPathError`; constants `WRITE_UNLOCKED: bool`, `PROTECTED_WRITE_ROOTS: list[Path]`, `TRASH_DIRNAME = ".FilePlusTrash"`, `FILEPLUS_APP_DIR`. `SAFETY_MODE` is gone.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_path_guard.py
"""path_guard: reads anywhere; writes sandboxed until WRITE_UNLOCKED; system roots never."""
from pathlib import Path
import pytest

import backend.config as _config
from backend.config import path_guard, OutOfSandboxError, ProtectedPathError


def test_read_allows_any_path(sandbox, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    assert path_guard(outside, "read") == outside.resolve()
    assert path_guard(Path("C:/Windows"), "read") == Path("C:/Windows").resolve()


def test_write_inside_sandbox_allowed_when_locked(sandbox):
    target = sandbox / "a" / "b.txt"
    assert path_guard(target, "write") == target.resolve()


def test_write_outside_sandbox_refused_when_locked(sandbox, tmp_path):
    outside = tmp_path / "elsewhere" / "x.txt"
    with pytest.raises(OutOfSandboxError) as e:
        path_guard(outside, "write")
    assert "WRITE_UNLOCKED" in str(e.value)


def test_write_outside_sandbox_allowed_when_unlocked(sandbox, tmp_path, monkeypatch):
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    outside = tmp_path / "elsewhere" / "x.txt"
    assert path_guard(outside, "write") == outside.resolve()


def test_protected_roots_refused_even_when_unlocked(sandbox, tmp_path, monkeypatch):
    monkeypatch.setattr(_config, "WRITE_UNLOCKED", True)
    fake_windows = tmp_path / "Windows"
    fake_windows.mkdir()
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [fake_windows])
    with pytest.raises(ProtectedPathError):
        path_guard(fake_windows / "System32" / "evil.dll", "write")


def test_sandbox_inside_protected_app_dir_is_still_writable(sandbox, monkeypatch):
    # The sandbox lives inside the repo, which is itself a protected root.
    monkeypatch.setattr(_config, "PROTECTED_WRITE_ROOTS", [sandbox.parent])
    assert path_guard(sandbox / "ok.txt", "write") == (sandbox / "ok.txt").resolve()


def test_case_insensitive_containment(sandbox):
    upper = Path(str(sandbox).upper()) / "F.TXT"
    assert path_guard(upper, "write")  # no exception


def test_unknown_mode_rejected(sandbox):
    with pytest.raises(ValueError):
        path_guard(sandbox / "x", "delete")
```

- [ ] **Step 2: Run to see failures**

Run: `py -3 -m pytest tests/test_path_guard.py -q`
Expected: failures/errors (`ProtectedPathError` import error, mode argument unsupported).

- [ ] **Step 3: Rewrite `backend/config.py`**

```python
"""FilePlus configuration — loads env vars from .env and owns the write guard.

path_guard(path, mode) is the single gate for filesystem access:
  read  — any path (browsing real drives is the product).
  write — inside FILEPLUS_SANDBOX_PATH until WRITE_UNLOCKED=true; Windows system
          roots (and the FilePlus app directory) are never writable.
"""
from dotenv import load_dotenv
import os
from pathlib import Path

load_dotenv()


class OutOfSandboxError(Exception):
    """Raised for a write outside the sandbox while WRITE_UNLOCKED is false."""


class ProtectedPathError(Exception):
    """Raised for a write under a protected system root, regardless of unlock state."""


FILEPLUS_APP_DIR = Path(__file__).resolve().parents[1]

FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", str(FILEPLUS_APP_DIR / "FilePlusTestSandbox")))
FILEPLUS_DB_PATH = Path(os.getenv("FILEPLUS_DB_PATH", str(FILEPLUS_APP_DIR / "fileplus.db")))
FILEPLUS_EVERYTHING_PATH = Path(os.getenv("FILEPLUS_EVERYTHING_PATH", r"C:\Everything"))

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

# Decision D2: writes stay in the sandbox until the author flips this.
WRITE_UNLOCKED = os.getenv("WRITE_UNLOCKED", "false").lower() == "true"
AUTO_SORT_ENABLED = os.getenv("AUTO_SORT_ENABLED", "false").lower() == "true"
AUTO_SORT_CONFIDENCE_THRESHOLD = float(os.getenv("AUTO_SORT_CONFIDENCE_THRESHOLD", "0.85"))
MAX_BATCH_SIZE = int(os.getenv("MAX_BATCH_SIZE", "100"))

TRASH_DIRNAME = ".FilePlusTrash"
LISTING_CAP = 10_000


def _env_path(name: str, default: str) -> Path:
    value = os.environ.get(name)
    return Path(value) if value else Path(default)


PROTECTED_WRITE_ROOTS: list[Path] = [
    _env_path("SystemRoot", r"C:\Windows"),
    _env_path("ProgramFiles", r"C:\Program Files"),
    _env_path("ProgramFiles(x86)", r"C:\Program Files (x86)"),
    _env_path("ProgramData", r"C:\ProgramData"),
    FILEPLUS_APP_DIR,
]


def is_under(path: Path, root: Path) -> bool:
    """Case-insensitive, separator-aware containment test (Windows semantics)."""
    p = os.path.normcase(os.path.normpath(str(path)))
    r = os.path.normcase(os.path.normpath(str(root)))
    return p == r or p.startswith(r.rstrip("\\/") + os.sep)


def path_guard(path: Path | str, mode: str = "read") -> Path:
    """Return the resolved path or raise. See module docstring."""
    resolved = Path(path).resolve()
    if mode == "read":
        return resolved
    if mode != "write":
        raise ValueError(f"path_guard mode must be 'read' or 'write', got {mode!r}")
    if is_under(resolved, FILEPLUS_SANDBOX_PATH):
        return resolved  # the sandbox is always writable, even inside the app dir
    for root in PROTECTED_WRITE_ROOTS:
        if is_under(resolved, root):
            raise ProtectedPathError(f"'{resolved}' is inside the protected location '{root}'; FilePlus never writes there.")
    if not WRITE_UNLOCKED:
        raise OutOfSandboxError(
            f"Writes are locked to the sandbox '{FILEPLUS_SANDBOX_PATH}' (WRITE_UNLOCKED=false); refused '{resolved}'."
        )
    return resolved
```

- [ ] **Step 4: Update fixtures, tests, env example, requirements**

`tests/conftest.py`: replace `monkeypatch.setattr(_config, "SAFETY_MODE", True)` with `monkeypatch.setattr(_config, "WRITE_UNLOCKED", False)`; also patch `PROTECTED_WRITE_ROOTS` to `[]` in the `sandbox` fixture (tmp dirs can live under any root; tests that need a protected root set their own). `tests/test_indexer.py`: replace any `SAFETY_MODE` usage the same way and change any test asserting that indexing outside the sandbox raises to assert it succeeds (reads are allowed) — keep the count assertions. `tests/test_api.py`: replace `test_scan_outside_sandbox_is_403` with:
```python
def test_scan_outside_sandbox_indexes_read_only(client, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "o.txt").write_text("o")
    r = client.post("/scan", json={"path": str(outside)})
    assert r.status_code == 200
    assert r.json()["count"] == 1
```
`backend/api.py`: the `trigger_scan` `except OutOfSandboxError` branch stays (harmless; reads never raise it now). `.env.example`: replace the `SAFETY_MODE` block with `WRITE_UNLOCKED=false` and a comment: "Writes (rename/move/copy/delete) stay inside FILEPLUS_SANDBOX_PATH until this is true. System roots are never writable." `requirements.txt`: add `psutil` and `send2trash`; run `py -3 -m pip install psutil send2trash`.

- [ ] **Step 5: Run the suite**

Run: `py -3 -m pytest -q` → Expected `61 passed` (53 + 8 new). Then verify → all green.

- [ ] **Step 6: Commit**

```bash
git add backend/config.py tests/conftest.py tests/test_path_guard.py tests/test_api.py tests/test_indexer.py .env.example requirements.txt
git -c core.safecrlf=false commit -m "feat(config): path_guard read/write modes, WRITE_UNLOCKED, protected system roots (D2)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Schema v3

**Files:**
- Modify: `backend/database.py`
- Create: `tests/test_schema_v3.py`

**Interfaces:**
- Produces tables `config(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL)`, `recent_actions(id, path TEXT NOT NULL, action TEXT NOT NULL, ts TEXT NOT NULL)`, `favorites(id, path TEXT UNIQUE NOT NULL, position INTEGER NOT NULL, created TEXT NOT NULL)`, `pinned_folders(id, path TEXT UNIQUE NOT NULL, label TEXT, position INTEGER NOT NULL, created TEXT NOT NULL)`; columns `operations_log.error TEXT`, `operations_log.undo_of INTEGER`; indexes `idx_ops_source(source_path)`, `idx_ops_dest(dest_path)`, `idx_ops_batch(batch_id)`, `idx_file_tags_tag(tag_id)`, `idx_files_filename(filename)`, `idx_recent_ts(ts)`; `CURRENT_SCHEMA_VERSION = 3`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_schema_v3.py
import aiosqlite
import pytest
from backend.database import init_db, CURRENT_SCHEMA_VERSION


async def _columns(db_path, table):
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute(f"PRAGMA table_info({table})")
        return {row[1] for row in await cur.fetchall()}


async def _tables(db_path):
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute("SELECT name FROM sqlite_master WHERE type IN ('table','index')")
        return {row[0] for row in await cur.fetchall()}


async def test_v3_tables_and_columns(db):
    assert CURRENT_SCHEMA_VERSION == 3
    names = await _tables(db)
    for t in ("config", "recent_actions", "favorites", "pinned_folders"):
        assert t in names
    for ix in ("idx_ops_source", "idx_ops_dest", "idx_ops_batch", "idx_file_tags_tag", "idx_files_filename", "idx_recent_ts"):
        assert ix in names
    cols = await _columns(db, "operations_log")
    assert {"error", "undo_of"} <= cols


async def test_migration_from_v2_adds_columns(tmp_path):
    """A v2 database (no error/undo_of columns, no new tables) upgrades in place."""
    db_path = tmp_path / "v2.db"
    async with aiosqlite.connect(db_path) as db:
        await db.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
        await db.execute("INSERT INTO schema_version VALUES (2)")
        await db.execute("""CREATE TABLE operations_log (id INTEGER PRIMARY KEY AUTOINCREMENT, op_type TEXT NOT NULL,
            source_path TEXT, dest_path TEXT, timestamp TEXT NOT NULL, batch_id TEXT, reason TEXT,
            executed INTEGER DEFAULT 0, undone INTEGER DEFAULT 0)""")
        await db.execute("INSERT INTO operations_log (op_type, source_path, timestamp) VALUES ('move','a','2026-01-01')")
        await db.commit()
    await init_db(db_path)
    cols = await _columns(db_path, "operations_log")
    assert {"error", "undo_of"} <= cols
    async with aiosqlite.connect(db_path) as db:
        cur = await db.execute("SELECT version FROM schema_version")
        assert (await cur.fetchone())[0] == 3
        cur = await db.execute("SELECT COUNT(*) FROM operations_log")
        assert (await cur.fetchone())[0] == 1  # data preserved
```

- [ ] **Step 2: Run to fail** → `py -3 -m pytest tests/test_schema_v3.py -q` → FAIL (version 2, missing tables).

- [ ] **Step 3: Implement**

In `backend/database.py`: set `CURRENT_SCHEMA_VERSION = 3`; add the four `CREATE TABLE IF NOT EXISTS` statements to `ALL_TABLES` (shapes above; `id INTEGER PRIMARY KEY AUTOINCREMENT`); add `CREATE INDEX IF NOT EXISTS` statements for the six indexes in a new `ALL_INDEXES` list executed after tables; in `_run_migrations` add:
```python
    if current < 3:
        for stmt in (
            "ALTER TABLE operations_log ADD COLUMN error TEXT",
            "ALTER TABLE operations_log ADD COLUMN undo_of INTEGER",
        ):
            try:
                await db.execute(stmt)
            except Exception:
                pass  # column already exists
```
(The `CREATE TABLE IF NOT EXISTS` for `operations_log` already includes the two columns for fresh databases — add them to `CREATE_OPERATIONS_LOG`.)

- [ ] **Step 4: Run suite** → `py -3 -m pytest -q` → `63 passed`. Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/database.py tests/test_schema_v3.py
git -c core.safecrlf=false commit -m "feat(db): schema v3 — config, recent_actions, favorites, pinned_folders; ops log error/undo_of; indexes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Operations log

**Files:**
- Modify: `backend/operations_log.py` (replace the stub), `tests/test_operations_log.py` (replace the placeholder)

**Interfaces:**
- Produces (all `async`, `conn: aiosqlite.Connection` first):
  - `new_batch_id() -> str` (sync, uuid4 hex)
  - `log_operation(conn, op_type, source, dest=None, batch_id=None, reason=None, undo_of=None) -> int`
  - `mark_executed(conn, op_id)`, `mark_error(conn, op_id, message)`, `mark_undone(conn, op_id)`
  - `get_operation(conn, op_id) -> dict | None`
  - `list_operations(conn, limit=50, offset=0, path=None) -> list[dict]` (newest first; `path` matches source or dest)
  - `list_batch(conn, batch_id) -> list[dict]` (newest first)
  - `pending_operations(conn) -> list[dict]` (`executed=0 AND error IS NULL`)
  - `reconcile_pending(conn) -> list[dict]` (each row plus `resolution`: `'completed' | 'not-started' | 'ambiguous'`)
- Row dict keys: `id, op_type, source_path, dest_path, timestamp, batch_id, reason, executed, undone, error, undo_of`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_operations_log.py
"""operations_log: log-before-act rows, marks, listing, crash reconciliation."""
import aiosqlite
import pytest

import backend.config as _config
from backend import operations_log as ol


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


async def test_log_then_mark_executed(conn):
    op_id = await ol.log_operation(conn, "move", "C:/a.txt", "C:/b/a.txt", batch_id="b1", reason="test")
    row = await ol.get_operation(conn, op_id)
    assert row["executed"] == 0 and row["undone"] == 0 and row["error"] is None
    assert row["batch_id"] == "b1" and row["reason"] == "test"
    await ol.mark_executed(conn, op_id)
    assert (await ol.get_operation(conn, op_id))["executed"] == 1


async def test_mark_error_and_undone(conn):
    op_id = await ol.log_operation(conn, "rename", "x", "y")
    await ol.mark_error(conn, op_id, "boom")
    assert (await ol.get_operation(conn, op_id))["error"] == "boom"
    await ol.mark_undone(conn, op_id)
    assert (await ol.get_operation(conn, op_id))["undone"] == 1


async def test_list_orders_newest_first_and_filters_by_path(conn):
    a = await ol.log_operation(conn, "move", "p1", "p2", batch_id="b")
    b = await ol.log_operation(conn, "move", "p3", "p1", batch_id="b")
    rows = await ol.list_operations(conn)
    assert [r["id"] for r in rows] == [b, a]
    rows = await ol.list_operations(conn, path="p3")
    assert [r["id"] for r in rows] == [b]
    batch = await ol.list_batch(conn, "b")
    assert [r["id"] for r in batch] == [b, a]


async def test_undo_of_link(conn):
    a = await ol.log_operation(conn, "move", "p1", "p2")
    inv = await ol.log_operation(conn, "move", "p2", "p1", undo_of=a)
    assert (await ol.get_operation(conn, inv))["undo_of"] == a


async def test_reconcile_pending(conn, sandbox):
    done_src, done_dst = sandbox / "done_src.txt", sandbox / "done_dst.txt"
    done_dst.write_text("moved")                      # dest exists, source gone => completed
    ns_src = sandbox / "ns.txt"
    ns_src.write_text("still here")                   # source exists, dest missing => not-started
    a = await ol.log_operation(conn, "move", str(done_src), str(done_dst))
    b = await ol.log_operation(conn, "move", str(ns_src), str(sandbox / "ns_dst.txt"))
    c = await ol.log_operation(conn, "move", str(sandbox / "gone1"), str(sandbox / "gone2"))  # neither => ambiguous
    d = await ol.log_operation(conn, "move", "q", "r")
    await ol.mark_executed(conn, d)                   # not pending
    result = await ol.reconcile_pending(conn)
    by_id = {r["id"]: r["resolution"] for r in result}
    assert by_id == {a: "completed", b: "not-started", c: "ambiguous"}
    assert (await ol.get_operation(conn, a))["executed"] == 1
    assert (await ol.get_operation(conn, b))["error"] == "not-started"
    assert (await ol.get_operation(conn, c))["error"] == "ambiguous"
    assert await ol.pending_operations(conn) == []
```

- [ ] **Step 2: Run to fail** → `py -3 -m pytest tests/test_operations_log.py -q` → FAIL (`TypeError`/`None` returns from stubs).

- [ ] **Step 3: Implement `backend/operations_log.py`**

```python
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
```

- [ ] **Step 4: Run suite** → `68 passed` (63 − 1 placeholder + 6). Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/operations_log.py tests/test_operations_log.py
git -c core.safecrlf=false commit -m "feat(ops-log): log-before-act rows, marks, listing, crash reconciliation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Mover — mutations

**Files:**
- Modify: `backend/mover.py` (replace the stub), `tests/test_mover.py` (replace the placeholder)

**Interfaces:**
- Exceptions: `InvalidNameError`, `ConflictError` (message names the target), `RefusedError` (folder-into-itself, disk space, missing source).
- Sync helpers: `validate_name(name)`, `trash_root_for(path) -> Path`, `same_volume(a, b) -> bool`, `keep_both_name(target) -> Path`.
- Async (all take `conn` first; every one returns a dict `{"op_id", "op_type", "status", "src", "dest", "batch_id"}` where status ∈ `done | conflict | skipped`):
  - `move(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None)`
  - `rename(conn, path, new_name, *, batch_id=None, reason=None)`
  - `copy(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None)`
  - `trash(conn, path, *, batch_id=None, reason=None)` — op_type `trash`, dest = trash location
  - `restore(conn, trashed_path, original_path, *, batch_id=None, on_conflict="keep-both", reason=None)` — op_type `restore`
  - `mkdir(conn, parent, name, *, batch_id=None)`, `touch(conn, parent, name, *, batch_id=None)`
  - `batch_move(conn, sources, dest_dir, on_conflict="fail") -> {"batch_id", "ops", "conflicts", "errors"}`; `batch_copy(...)`, `batch_trash(conn, paths)`
  - `empty_trash(conn) -> {"batches": int, "roots": [str]}` — `send2trash` each batch folder; logs `trash-empty:final`
- Conflict policies: `fail` → status `conflict` (no op row created), `skip` → status `skipped` (no row), `replace` → the existing target is trashed first (its own logged op in the same batch), `keep-both` → `keep_both_name`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_mover.py
"""mover: every mutation is guarded, logged before acting, and reversible."""
import os
from pathlib import Path

import aiosqlite
import pytest

import backend.config as _config
from backend import mover, operations_log as ol
from backend.config import OutOfSandboxError


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


def _mk(sandbox, rel, content="x"):
    p = sandbox / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content)
    return p


# ---- names / helpers -------------------------------------------------------

@pytest.mark.parametrize("bad", ["", "a/b", "a\\b", "con", "NUL", "COM1", "x.", "x ", "a:b", "a?b", ".", "..", "a\x00b"])
def test_validate_name_rejects(bad):
    with pytest.raises(mover.InvalidNameError):
        mover.validate_name(bad)


@pytest.mark.parametrize("ok", ["a.txt", "Résumé (final).docx", "no-ext", "con.txt", ".hidden"])
def test_validate_name_accepts(ok):
    mover.validate_name(ok)


def test_keep_both_name(sandbox):
    _mk(sandbox, "r.txt"); _mk(sandbox, "r (2).txt")
    assert mover.keep_both_name(sandbox / "r.txt").name == "r (3).txt"
    assert mover.keep_both_name(sandbox / "fresh.txt").name == "fresh.txt"


def test_trash_root_inside_sandbox(sandbox):
    assert mover.trash_root_for(sandbox / "deep" / "f.txt") == sandbox / _config.TRASH_DIRNAME


def test_trash_root_outside_sandbox_is_volume_root(sandbox, tmp_path):
    outside = tmp_path / "o" / "f.txt"
    drive = Path(os.path.splitdrive(str(outside.resolve()))[0] + "\\")
    assert mover.trash_root_for(outside) == drive / _config.TRASH_DIRNAME


# ---- move ------------------------------------------------------------------

async def test_move_logs_before_and_marks_after(conn, sandbox):
    src = _mk(sandbox, "a/one.txt", "1")
    dest_dir = sandbox / "b"; dest_dir.mkdir()
    r = await mover.move(conn, src, dest_dir)
    assert r["status"] == "done"
    assert not src.exists() and (dest_dir / "one.txt").read_text() == "1"
    row = await ol.get_operation(conn, r["op_id"])
    assert row["op_type"] == "move" and row["executed"] == 1
    assert row["source_path"] == str(src.resolve()) and row["dest_path"] == str((dest_dir / "one.txt").resolve())


async def test_move_directory(conn, sandbox):
    _mk(sandbox, "src/dir/inner.txt")
    (sandbox / "dst").mkdir()
    r = await mover.move(conn, sandbox / "src" / "dir", sandbox / "dst")
    assert r["status"] == "done" and (sandbox / "dst" / "dir" / "inner.txt").exists()


async def test_move_conflict_policies(conn, sandbox):
    _mk(sandbox, "a/f.txt", "new"); _mk(sandbox, "b/f.txt", "old")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b")  # fail
    assert r["status"] == "conflict" and (sandbox / "a/f.txt").exists()
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="skip")
    assert r["status"] == "skipped"
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="keep-both")
    assert r["status"] == "done" and (sandbox / "b" / "f (2).txt").read_text() == "new"
    _mk(sandbox, "a/f.txt", "newer")
    r = await mover.move(conn, sandbox / "a/f.txt", sandbox / "b", on_conflict="replace")
    assert r["status"] == "done" and (sandbox / "b/f.txt").read_text() == "newer"
    # the replaced file was trashed (logged), not deleted
    trashed = list((sandbox / _config.TRASH_DIRNAME).rglob("f.txt"))
    assert len(trashed) == 1 and trashed[0].read_text() == "old"


async def test_move_into_self_refused(conn, sandbox):
    _mk(sandbox, "d/x.txt")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "d", sandbox / "d")
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, sandbox / "d", sandbox / "d" / "sub")


async def test_move_outside_sandbox_refused_and_not_logged(conn, sandbox, tmp_path):
    src = _mk(sandbox, "z.txt")
    outside = tmp_path / "out"; outside.mkdir()
    with pytest.raises(OutOfSandboxError):
        await mover.move(conn, src, outside)
    assert src.exists() and await ol.list_operations(conn) == []


async def test_cross_volume_move_copies_verifies_removes(conn, sandbox, monkeypatch):
    src = _mk(sandbox, "big.bin", "payload" * 1000)
    dest_dir = sandbox / "elsewhere"; dest_dir.mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    r = await mover.move(conn, src, dest_dir)
    assert r["status"] == "done" and not src.exists()
    assert (dest_dir / "big.bin").read_text() == "payload" * 1000


async def test_disk_space_refusal(conn, sandbox, monkeypatch):
    src = _mk(sandbox, "s.txt", "abc")
    (sandbox / "t").mkdir()
    monkeypatch.setattr(mover, "same_volume", lambda a, b: False)
    monkeypatch.setattr(mover, "_free_bytes", lambda p: 0)
    with pytest.raises(mover.RefusedError):
        await mover.move(conn, src, sandbox / "t")
    assert src.exists()


# ---- rename / mkdir / touch / copy ----------------------------------------

async def test_rename(conn, sandbox):
    p = _mk(sandbox, "old.txt")
    r = await mover.rename(conn, p, "new.txt")
    assert r["status"] == "done" and (sandbox / "new.txt").exists() and not p.exists()
    with pytest.raises(mover.InvalidNameError):
        await mover.rename(conn, sandbox / "new.txt", "bad/name")
    _mk(sandbox, "taken.txt")
    with pytest.raises(mover.ConflictError):
        await mover.rename(conn, sandbox / "new.txt", "taken.txt")


async def test_mkdir_and_touch(conn, sandbox):
    r = await mover.mkdir(conn, sandbox, "Folder")
    assert (sandbox / "Folder").is_dir() and r["op_type"] == "mkdir"
    r = await mover.touch(conn, sandbox / "Folder", "note.txt")
    assert (sandbox / "Folder" / "note.txt").stat().st_size == 0 and r["op_type"] == "touch"
    with pytest.raises(mover.ConflictError):
        await mover.mkdir(conn, sandbox, "Folder")


async def test_copy_file_and_dir(conn, sandbox):
    _mk(sandbox, "c/a.txt", "A"); _mk(sandbox, "c/sub/b.txt", "B")
    (sandbox / "out").mkdir()
    r = await mover.copy(conn, sandbox / "c" / "a.txt", sandbox / "out")
    assert r["status"] == "done" and (sandbox / "out/a.txt").read_text() == "A" and (sandbox / "c/a.txt").exists()
    r = await mover.copy(conn, sandbox / "c", sandbox / "out")
    assert (sandbox / "out/c/sub/b.txt").read_text() == "B"


# ---- trash / restore / empty ----------------------------------------------

async def test_trash_and_restore(conn, sandbox):
    p = _mk(sandbox, "docs/t.txt", "T")
    r = await mover.trash(conn, p)
    assert r["status"] == "done" and not p.exists()
    trashed = Path(r["dest"])
    assert trashed.exists() and _config.TRASH_DIRNAME in trashed.parts
    assert (trashed.parent / "manifest.json").exists()
    r2 = await mover.restore(conn, trashed, p)
    assert r2["status"] == "done" and p.read_text() == "T" and not trashed.exists()


async def test_restore_conflict_keeps_both(conn, sandbox):
    p = _mk(sandbox, "k.txt", "first")
    r = await mover.trash(conn, p)
    _mk(sandbox, "k.txt", "second")
    r2 = await mover.restore(conn, Path(r["dest"]), p)
    assert r2["status"] == "done" and (sandbox / "k (2).txt").read_text() == "first"


async def test_batch_trash_and_empty(conn, sandbox, monkeypatch):
    a = _mk(sandbox, "e1.txt"); b = _mk(sandbox, "e2.txt")
    res = await mover.batch_trash(conn, [a, b])
    assert len(res["ops"]) == 2 and res["batch_id"]
    sent = []
    monkeypatch.setattr(mover, "_send2trash", lambda p: sent.append(Path(p)))
    out = await mover.empty_trash(conn)
    assert out["batches"] == 1 and len(sent) == 1 and sent[0].name == res["batch_id"]
    rows = await ol.list_operations(conn)
    assert rows[0]["op_type"] == "trash-empty:final"


async def test_trash_root_is_hidden(conn, sandbox):
    p = _mk(sandbox, "h.txt")
    await mover.trash(conn, p)
    attrs = (sandbox / _config.TRASH_DIRNAME).stat().st_file_attributes
    assert attrs & 0x2
```

- [ ] **Step 2: Run to fail** → `py -3 -m pytest tests/test_mover.py -q` → many failures/errors.

- [ ] **Step 3: Implement `backend/mover.py`**

```python
"""FilePlus mover — every filesystem mutation, guarded and logged before it acts.

Protocol (never varies): path_guard(write) on every path involved ->
operations_log row (executed=0) -> perform in a thread -> mark_executed.
On exception: mark_error and re-raise.

Nothing is hard-deleted. "Delete" moves into a same-volume .FilePlusTrash
folder; empty_trash() hands those folders to the Windows Recycle Bin.
"""
from __future__ import annotations

import asyncio
import ctypes
import json
import logging
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from send2trash import send2trash as _send2trash_impl

import backend.config as _config
from backend import operations_log as ol
from backend.hasher import hash_file

logger = logging.getLogger(__name__)


class InvalidNameError(ValueError): ...
class ConflictError(Exception): ...
class RefusedError(Exception): ...


_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
_KEEP_BOTH = re.compile(r"^(.*) \((\d+)\)$")
FILE_ATTRIBUTE_HIDDEN = 0x2
SPACE_MARGIN = 100 * 1024 * 1024
HASH_VERIFY_LIMIT = 1024 ** 3


def _send2trash(path: Path) -> None:  # indirection so tests can stub it
    _send2trash_impl(str(path))


def validate_name(name: str) -> None:
    if not name or name in (".", ".."):
        raise InvalidNameError("Name is empty or reserved.")
    if _BAD_CHARS.search(name):
        raise InvalidNameError('Name contains a character that Windows does not allow: \\ / : * ? " < > |')
    if name[-1] in ". ":
        raise InvalidNameError("Name may not end with a dot or a space.")
    if name.split(".")[0].upper() in _RESERVED and name.upper() in _RESERVED:
        raise InvalidNameError(f"'{name}' is a reserved device name.")


def keep_both_name(target: Path) -> Path:
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    m = _KEEP_BOTH.match(stem)
    base, n = (m.group(1), int(m.group(2)) + 1) if m else (stem, 2)
    while True:
        cand = target.with_name(f"{base} ({n}){suffix}")
        if not cand.exists():
            return cand
        n += 1


def same_volume(a: Path, b: Path) -> bool:
    return os.path.splitdrive(str(a.resolve()))[0].lower() == os.path.splitdrive(str(b.resolve()))[0].lower()


def trash_root_for(path: Path) -> Path:
    p = Path(path).resolve()
    if _config.is_under(p, _config.FILEPLUS_SANDBOX_PATH):
        return _config.FILEPLUS_SANDBOX_PATH.resolve() / _config.TRASH_DIRNAME
    drive = os.path.splitdrive(str(p))[0] + "\\"
    return Path(drive) / _config.TRASH_DIRNAME


def _free_bytes(path: Path) -> int:
    return shutil.disk_usage(str(path)).free


def _tree_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


def _hide(path: Path) -> None:
    if os.name == "nt":
        ctypes.windll.kernel32.SetFileAttributesW(str(path), FILE_ATTRIBUTE_HIDDEN)


def _ensure_trash_batch_dir(root: Path, batch_id: str) -> Path:
    if not root.exists():
        root.mkdir(parents=True)
        _hide(root)
    d = root / batch_id
    d.mkdir(exist_ok=True)
    return d


def _append_manifest(batch_dir: Path, original: Path, trashed: Path) -> None:
    mf = batch_dir / "manifest.json"
    data = json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else {"items": []}
    data["items"].append({"original": str(original), "trashed": str(trashed), "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    mf.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _copy_tree_or_file(src: Path, dest: Path) -> None:
    if src.is_dir():
        shutil.copytree(src, dest, symlinks=True)
    else:
        shutil.copy2(src, dest)


def _verify_copy(src: Path, dest: Path) -> None:
    if src.is_file():
        if src.stat().st_size != dest.stat().st_size:
            raise RefusedError("Copy verification failed: size mismatch.")
        if src.stat().st_size <= HASH_VERIFY_LIMIT and hash_file(src) != hash_file(dest):
            raise RefusedError("Copy verification failed: hash mismatch.")
        return
    s = sorted((p.relative_to(src), p.stat().st_size) for p in src.rglob("*") if p.is_file())
    d = sorted((p.relative_to(dest), p.stat().st_size) for p in dest.rglob("*") if p.is_file())
    if s != d:
        raise RefusedError("Copy verification failed: tree mismatch.")


def _remove_after_verified_copy(src: Path) -> None:
    """The only place the mover removes bytes: the source of a verified cross-volume move."""
    if src.is_dir():
        shutil.rmtree(src)
    else:
        os.remove(src)


def _resolve_target(target: Path, on_conflict: str) -> tuple[Path | None, str]:
    """Return (target, action) with action in done|conflict|skipped|replace."""
    if not target.exists():
        return target, "done"
    if on_conflict == "fail":
        return None, "conflict"
    if on_conflict == "skip":
        return None, "skipped"
    if on_conflict == "keep-both":
        return keep_both_name(target), "done"
    if on_conflict == "replace":
        return target, "replace"
    raise ValueError(f"unknown on_conflict {on_conflict!r}")


def _result(op_id, op_type, status, src, dest, batch_id) -> dict:
    return {"op_id": op_id, "op_type": op_type, "status": status, "src": str(src) if src else None,
            "dest": str(dest) if dest else None, "batch_id": batch_id}


async def _perform(conn, op_type, src, dest, batch_id, reason, fn, undo_of=None) -> dict:
    """The protocol: log -> act (thread) -> mark. Shared by every mutation."""
    op_id = await ol.log_operation(conn, op_type, str(src) if src else None, str(dest) if dest else None,
                                   batch_id=batch_id, reason=reason, undo_of=undo_of)
    try:
        await asyncio.to_thread(fn)
    except Exception as exc:
        await ol.mark_error(conn, op_id, f"{type(exc).__name__}: {exc}")
        raise
    await ol.mark_executed(conn, op_id)
    return _result(op_id, op_type, "done", src, dest, batch_id)


def _move_fn(src: Path, dest: Path):
    def run():
        if same_volume(src, dest):
            os.replace(src, dest) if src.is_file() else os.rename(src, dest)
        else:
            need = _tree_size(src)
            if _free_bytes(dest.parent) < need + SPACE_MARGIN:
                raise RefusedError("Not enough free space on the destination volume.")
            _copy_tree_or_file(src, dest)
            _verify_copy(src, dest)
            _remove_after_verified_copy(src)
    return run


async def move(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None, _op_type="move", _undo_of=None) -> dict:
    src = _config.path_guard(src, "write")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot move a folder into itself.")
    if not dest_dir.is_dir():
        raise RefusedError(f"Destination folder does not exist: {dest_dir}")
    target, action = _resolve_target(dest_dir / src.name, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, _op_type, action, src, dest_dir / src.name, batch_id)
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced")
    if not same_volume(src, target):
        need = await asyncio.to_thread(_tree_size, src)
        if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
            raise RefusedError("Not enough free space on the destination volume.")
    return await _perform(conn, _op_type, src, target, batch_id, reason, _move_fn(src, target), undo_of=_undo_of)


async def rename(conn, path, new_name, *, batch_id=None, reason=None, _undo_of=None) -> dict:
    validate_name(new_name)
    src = _config.path_guard(path, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    target = _config.path_guard(src.with_name(new_name), "write")
    if target.exists() and target != src:
        raise ConflictError(f"'{new_name}' already exists here.")
    return await _perform(conn, "rename", src, target, batch_id, reason, lambda: os.rename(src, target), undo_of=_undo_of)


async def copy(conn, src, dest_dir, *, batch_id=None, on_conflict="fail", reason=None) -> dict:
    src = _config.path_guard(src, "read")
    dest_dir = _config.path_guard(dest_dir, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    if src.is_dir() and _config.is_under(dest_dir, src):
        raise RefusedError("Cannot copy a folder into itself.")
    target, action = _resolve_target(dest_dir / src.name, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "copy", action, src, dest_dir / src.name, batch_id)
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced")
    need = await asyncio.to_thread(_tree_size, src)
    if await asyncio.to_thread(_free_bytes, dest_dir) < need + SPACE_MARGIN:
        raise RefusedError("Not enough free space on the destination volume.")

    def run():
        _copy_tree_or_file(src, target)
        _verify_copy(src, target)
    return await _perform(conn, "copy", src, target, batch_id, reason, run)


async def trash(conn, path, *, batch_id=None, reason=None, _undo_of=None) -> dict:
    src = _config.path_guard(path, "write")
    if not src.exists():
        raise RefusedError(f"Source does not exist: {src}")
    batch_id = batch_id or ol.new_batch_id()
    root = trash_root_for(src)
    if _config.is_under(src, root):
        raise RefusedError("Already in the FilePlus trash.")
    batch_dir = await asyncio.to_thread(_ensure_trash_batch_dir, root, batch_id)
    target = keep_both_name(batch_dir / src.name)

    def run():
        os.rename(src, target)
        _append_manifest(batch_dir, src, target)
    return await _perform(conn, "trash", src, target, batch_id, reason, run, undo_of=_undo_of)


async def restore(conn, trashed_path, original_path, *, batch_id=None, on_conflict="keep-both", reason=None, _undo_of=None) -> dict:
    src = _config.path_guard(trashed_path, "write")
    original = _config.path_guard(original_path, "write")
    if not src.exists():
        raise RefusedError(f"Trashed item no longer exists: {src}")
    original.parent.mkdir(parents=True, exist_ok=True)
    target, action = _resolve_target(original, on_conflict)
    if action in ("conflict", "skipped"):
        return _result(None, "restore", action, src, original, batch_id)
    if action == "replace":
        await trash(conn, target, batch_id=batch_id, reason="replaced by restore")
    return await _perform(conn, "restore", src, target, batch_id, reason, lambda: os.rename(src, target), undo_of=_undo_of)


async def mkdir(conn, parent, name, *, batch_id=None, reason=None) -> dict:
    validate_name(name)
    target = _config.path_guard(Path(parent) / name, "write")
    if target.exists():
        raise ConflictError(f"'{name}' already exists here.")
    return await _perform(conn, "mkdir", None, target, batch_id, reason, lambda: target.mkdir())


async def touch(conn, parent, name, *, batch_id=None, reason=None) -> dict:
    validate_name(name)
    target = _config.path_guard(Path(parent) / name, "write")
    if target.exists():
        raise ConflictError(f"'{name}' already exists here.")
    return await _perform(conn, "touch", None, target, batch_id, reason, lambda: target.touch(exist_ok=False))


async def _batch(conn, items, fn) -> dict:
    batch_id = ol.new_batch_id()
    out = {"batch_id": batch_id, "ops": [], "conflicts": [], "errors": []}
    for item in items:
        try:
            r = await fn(item, batch_id)
        except (InvalidNameError, ConflictError, RefusedError, _config.OutOfSandboxError, _config.ProtectedPathError, OSError) as exc:
            out["errors"].append({"src": str(item), "error": f"{type(exc).__name__}: {exc}"})
            continue
        (out["conflicts"] if r["status"] == "conflict" else out["ops"]).append(r)
    return out


async def batch_move(conn, sources, dest_dir, on_conflict="fail") -> dict:
    return await _batch(conn, sources, lambda s, b: move(conn, s, dest_dir, batch_id=b, on_conflict=on_conflict))


async def batch_copy(conn, sources, dest_dir, on_conflict="fail") -> dict:
    return await _batch(conn, sources, lambda s, b: copy(conn, s, dest_dir, batch_id=b, on_conflict=on_conflict))


async def batch_trash(conn, paths) -> dict:
    return await _batch(conn, paths, lambda p, b: trash(conn, p, batch_id=b))


def _known_trash_roots() -> list[Path]:
    roots = [_config.FILEPLUS_SANDBOX_PATH.resolve() / _config.TRASH_DIRNAME]
    for letter in "CDEFGHIJKLMNOPQRSTUVWXYZ":
        cand = Path(f"{letter}:\\") / _config.TRASH_DIRNAME
        if cand.exists():
            roots.append(cand)
    return [r for r in roots if r.exists()]


async def empty_trash(conn) -> dict:
    roots = _known_trash_roots()
    batches = [d for r in roots for d in r.iterdir() if d.is_dir()]
    op_id = await ol.log_operation(conn, "trash-empty:final", None, None, reason=f"{len(batches)} batch folders -> Recycle Bin")

    def run():
        for d in batches:
            _send2trash(d)
    try:
        await asyncio.to_thread(run)
    except Exception as exc:
        await ol.mark_error(conn, op_id, str(exc)); raise
    await ol.mark_executed(conn, op_id)
    return {"batches": len(batches), "roots": [str(r) for r in roots]}
```

- [ ] **Step 4: Run** → `py -3 -m pytest tests/test_mover.py -q` → all pass (26 tests incl. parametrised). Full suite: `py -3 -m pytest -q` → `93 passed` (68 − 1 placeholder + 26). Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/mover.py tests/test_mover.py
git -c core.safecrlf=false commit -m "feat(mover): guarded, logged move/rename/copy/trash/restore/mkdir/touch, batches, FilePlus trash + empty to Recycle Bin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Undo and redo

**Files:**
- Modify: `backend/mover.py` (append), `tests/test_mover.py` (append)

**Interfaces:**
- `undo_operation(conn, op_id) -> dict` — raises `RefusedError` if the op is not executed, already undone, is `:final`, or its dest no longer exists; performs the inverse as a new logged op with `undo_of=op_id`, marks the original undone, returns the inverse op's result.
- `undo_batch(conn, batch_id) -> {"batch_id": new, "ops": [...], "errors": [...]}` — undoes every executed, not-undone op in the batch newest-first under one new batch id.
- Redo = `undo_operation(inverse_id)`.

- [ ] **Step 1: Failing tests (append to `tests/test_mover.py`)**

```python
# ---- undo / redo -----------------------------------------------------------

async def test_undo_move_then_redo(conn, sandbox):
    src = _mk(sandbox, "u/a.txt", "A"); (sandbox / "v").mkdir()
    r = await mover.move(conn, src, sandbox / "v")
    inv = await mover.undo_operation(conn, r["op_id"])
    assert src.read_text() == "A" and not (sandbox / "v/a.txt").exists()
    assert (await ol.get_operation(conn, r["op_id"]))["undone"] == 1
    assert (await ol.get_operation(conn, inv["op_id"]))["undo_of"] == r["op_id"]
    redo = await mover.undo_operation(conn, inv["op_id"])          # redo = undo the inverse
    assert (sandbox / "v/a.txt").exists() and redo["undo_of" if "undo_of" in redo else "op_id"]


async def test_undo_rename_trash_copy_mkdir_touch(conn, sandbox):
    p = _mk(sandbox, "r1.txt", "R")
    r = await mover.rename(conn, p, "r2.txt")
    await mover.undo_operation(conn, r["op_id"]); assert p.exists()
    r = await mover.trash(conn, p)
    await mover.undo_operation(conn, r["op_id"]); assert p.read_text() == "R"
    (sandbox / "cp").mkdir()
    r = await mover.copy(conn, p, sandbox / "cp")
    await mover.undo_operation(conn, r["op_id"]); assert not (sandbox / "cp/r1.txt").exists()
    assert list((sandbox / _config.TRASH_DIRNAME).rglob("r1.txt"))      # the copy went to trash
    r = await mover.mkdir(conn, sandbox, "made")
    await mover.undo_operation(conn, r["op_id"]); assert not (sandbox / "made").exists()
    r = await mover.touch(conn, sandbox, "t.txt")
    await mover.undo_operation(conn, r["op_id"]); assert not (sandbox / "t.txt").exists()


async def test_undo_refusals(conn, sandbox):
    p = _mk(sandbox, "x.txt"); (sandbox / "y").mkdir()
    r = await mover.move(conn, p, sandbox / "y")
    await mover.undo_operation(conn, r["op_id"])
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, r["op_id"])        # already undone
    (sandbox / "x.txt").unlink()                             # dest of the inverse gone
    inv = (await ol.list_operations(conn))[0]
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, inv["id"])
    op_id = await ol.log_operation(conn, "trash-empty:final", None, None); await ol.mark_executed(conn, op_id)
    with pytest.raises(mover.RefusedError):
        await mover.undo_operation(conn, op_id)


async def test_undo_batch(conn, sandbox):
    a = _mk(sandbox, "ba.txt"); b = _mk(sandbox, "bb.txt"); (sandbox / "dst").mkdir()
    res = await mover.batch_move(conn, [a, b], sandbox / "dst")
    out = await mover.undo_batch(conn, res["batch_id"])
    assert len(out["ops"]) == 2 and out["errors"] == [] and a.exists() and b.exists()
    assert all(r["undone"] == 1 for r in await ol.list_batch(conn, res["batch_id"]))
```

- [ ] **Step 2: Run to fail** → `AttributeError: undo_operation`.

- [ ] **Step 3: Append to `backend/mover.py`**

```python
# ---------------------------------------------------------------------------
# Undo / redo
# ---------------------------------------------------------------------------

async def undo_operation(conn, op_id: int) -> dict:
    row = await ol.get_operation(conn, op_id)
    if row is None:
        raise RefusedError(f"Operation {op_id} not found.")
    if row["op_type"].endswith(":final"):
        raise RefusedError("This operation cannot be undone.")
    if not row["executed"] or row["error"]:
        raise RefusedError("Operation did not complete; nothing to undo.")
    if row["undone"]:
        raise RefusedError("Operation is already undone.")
    src, dest = row["source_path"], row["dest_path"]
    t = row["op_type"]
    batch_id = ol.new_batch_id()
    if t in ("move", "rename"):
        if not dest or not Path(dest).exists():
            raise RefusedError("The moved item is no longer where the log left it.")
        if t == "move":
            result = await move(conn, dest, Path(src).parent, batch_id=batch_id, on_conflict="keep-both",
                                reason=f"undo of #{op_id}", _undo_of=op_id)
        else:
            result = await rename(conn, dest, Path(src).name, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    elif t == "trash":
        if not dest or not Path(dest).exists():
            raise RefusedError("The trashed item is gone (trash emptied?).")
        result = await restore(conn, dest, src, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    elif t == "restore":
        if not dest or not Path(dest).exists():
            raise RefusedError("The restored item is no longer where the log left it.")
        result = await trash(conn, dest, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    elif t in ("copy", "mkdir", "touch"):
        if not dest or not Path(dest).exists():
            raise RefusedError("The created item is no longer where the log left it.")
        result = await trash(conn, dest, batch_id=batch_id, reason=f"undo of #{op_id}", _undo_of=op_id)
    else:
        raise RefusedError(f"Operation type '{t}' has no inverse.")
    if result["status"] != "done":
        raise RefusedError(f"Undo could not complete: {result['status']}.")
    await ol.mark_undone(conn, op_id)
    return result


async def undo_batch(conn, batch_id: str) -> dict:
    rows = [r for r in await ol.list_batch(conn, batch_id) if r["executed"] and not r["undone"] and not r["error"]]
    out = {"batch_id": None, "ops": [], "errors": []}
    for r in rows:
        try:
            res = await undo_operation(conn, r["id"])
            out["batch_id"] = out["batch_id"] or res["batch_id"]
            out["ops"].append(res)
        except (RefusedError, ConflictError, _config.OutOfSandboxError, _config.ProtectedPathError, OSError) as exc:
            out["errors"].append({"op_id": r["id"], "error": f"{type(exc).__name__}: {exc}"})
    return out
```
Note: `undo_batch` creates one inverse batch id per op via `undo_operation`; that is acceptable for Stage 2 (the frontend tracks the first). If you prefer a single batch id, thread a `batch_id` parameter through `undo_operation` — either is fine; say which in the report.

- [ ] **Step 4: Run** → `py -3 -m pytest -q` → `97 passed`. Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/mover.py tests/test_mover.py
git -c core.safecrlf=false commit -m "feat(mover): undo/redo as logged inverse operations; batch undo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Routes — fs mutations, operations, drives, listing, health

**Files:**
- Modify: `backend/api.py`
- Create: `tests/test_api_fs_write.py`, `tests/test_api_ops.py`

**Interfaces (HTTP):** as spec §4 rows for `/health`, `/drives`, `/fs/list`, `/fs/mkdir`, `/fs/touch`, `/fs/rename`, `/fs/move`, `/fs/copy`, `/fs/trash`, `/fs/trash/empty`, `/operations`, `/operations/{id}/undo`, `/operations/batch/{batch_id}/undo`, `/operations/pending`. Error mapping: `OutOfSandboxError`/`ProtectedPathError`/`PermissionError` → 403 `{detail}`; `InvalidNameError`/`ConflictError`/`RefusedError` → 409; `FileNotFoundError` → 404.

- [ ] **Step 1: Failing tests**

```python
# tests/test_api_fs_write.py
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_mkdir_touch_rename(client, sandbox):
    r = client.post("/fs/mkdir", json={"dir": str(sandbox), "name": "New"}); assert r.status_code == 200
    assert (sandbox / "New").is_dir() and r.json()["ops"][0]["op_type"] == "mkdir"
    r = client.post("/fs/touch", json={"dir": str(sandbox / "New"), "name": "a.txt"}); assert r.status_code == 200
    r = client.post("/fs/rename", json={"path": str(sandbox / "New" / "a.txt"), "new_name": "b.txt"}); assert r.status_code == 200
    assert (sandbox / "New" / "b.txt").exists()
    r = client.post("/fs/rename", json={"path": str(sandbox / "New" / "b.txt"), "new_name": "x/y"}); assert r.status_code == 409
    r = client.post("/fs/mkdir", json={"dir": str(sandbox), "name": "New"}); assert r.status_code == 409


def test_move_copy_trash_with_conflicts(client, sandbox):
    (sandbox / "s").mkdir(); (sandbox / "d").mkdir()
    (sandbox / "s" / "f.txt").write_text("1"); (sandbox / "d" / "f.txt").write_text("2")
    r = client.post("/fs/move", json={"sources": [str(sandbox / "s" / "f.txt")], "dest": str(sandbox / "d")})
    assert r.status_code == 200 and len(r.json()["conflicts"]) == 1 and r.json()["ops"] == []
    r = client.post("/fs/move", json={"sources": [str(sandbox / "s" / "f.txt")], "dest": str(sandbox / "d"), "on_conflict": "keep-both"})
    assert (sandbox / "d" / "f (2).txt").read_text() == "1"
    r = client.post("/fs/copy", json={"sources": [str(sandbox / "d" / "f.txt")], "dest": str(sandbox / "s")})
    assert r.status_code == 200 and (sandbox / "s" / "f.txt").read_text() == "2"
    r = client.post("/fs/trash", json={"paths": [str(sandbox / "s" / "f.txt")]})
    assert r.status_code == 200 and not (sandbox / "s" / "f.txt").exists() and r.json()["batch_id"]


def test_write_outside_sandbox_is_403(client, tmp_path):
    out = tmp_path / "o"; out.mkdir()
    r = client.post("/fs/mkdir", json={"dir": str(out), "name": "n"})
    assert r.status_code == 403 and "WRITE_UNLOCKED" in r.json()["detail"]


def test_fs_list_reads_anywhere_and_flags_root(client, tmp_path, sandbox):
    out = tmp_path / "o"; out.mkdir(); (out / "z.txt").write_text("z")
    r = client.get("/fs/list", params={"path": str(out)})
    assert r.status_code == 200
    body = r.json()
    assert body["parent"] == str(out.parent) and body["is_root"] is False and body["truncated"] is False
    root = str(sandbox.resolve().drive) + "\\"
    r = client.get("/fs/list", params={"path": root})
    assert r.status_code == 200 and r.json()["is_root"] is True and r.json()["parent"] is None


def test_fs_list_hides_trash_unless_asked(client, sandbox):
    (sandbox / "v.txt").write_text("v")
    client.post("/fs/trash", json={"paths": [str(sandbox / "v.txt")]})
    names = {e["name"] for e in client.get("/fs/list", params={"path": str(sandbox)}).json()["entries"]}
    assert ".FilePlusTrash" not in names
    names = {e["name"] for e in client.get("/fs/list", params={"path": str(sandbox), "show_hidden": "true"}).json()["entries"]}
    assert ".FilePlusTrash" in names


def test_drives_and_health(client):
    d = client.get("/drives").json()
    assert isinstance(d, list) and d and {"letter", "mount", "total_bytes", "free_bytes", "used_bytes", "label"} <= set(d[0])
    h = client.get("/health").json()
    assert h["db_ok"] is True and h["write_unlocked"] is False and h["pending_ops"] == 0 and h["index_running"] is False
```

```python
# tests/test_api_ops.py
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_operations_list_undo_batch_undo(client, sandbox):
    (sandbox / "a.txt").write_text("a"); (sandbox / "b.txt").write_text("b"); (sandbox / "dst").mkdir()
    r = client.post("/fs/move", json={"sources": [str(sandbox / "a.txt"), str(sandbox / "b.txt")], "dest": str(sandbox / "dst")})
    batch = r.json()["batch_id"]
    ops = client.get("/operations", params={"limit": 10}).json()
    assert len(ops) == 2 and ops[0]["batch_id"] == batch
    r = client.post(f"/operations/{ops[0]['id']}/undo"); assert r.status_code == 200
    assert (sandbox / "b.txt").exists() or (sandbox / "a.txt").exists()
    r = client.post(f"/operations/batch/{batch}/undo"); assert r.status_code == 200
    assert (sandbox / "a.txt").exists() and (sandbox / "b.txt").exists()
    r = client.post(f"/operations/{ops[0]['id']}/undo"); assert r.status_code == 409


def test_operations_by_path_and_pending(client, sandbox):
    (sandbox / "p.txt").write_text("p")
    client.post("/fs/rename", json={"path": str(sandbox / "p.txt"), "new_name": "q.txt"})
    rows = client.get("/operations", params={"path": str(sandbox / "q.txt")}).json()
    assert len(rows) == 1 and rows[0]["op_type"] == "rename"
    assert client.get("/operations/pending").json() == []


def test_trash_empty_endpoint(client, sandbox, monkeypatch):
    from backend import mover
    sent = []
    monkeypatch.setattr(mover, "_send2trash", lambda p: sent.append(p))
    (sandbox / "e.txt").write_text("e")
    client.post("/fs/trash", json={"paths": [str(sandbox / "e.txt")]})
    r = client.post("/fs/trash/empty")
    assert r.status_code == 200 and r.json()["batches"] == 1 and len(sent) == 1
```

- [ ] **Step 2: Run to fail** → 404s.

- [ ] **Step 3: Implement in `backend/api.py`**

Add imports (`asyncio`, `psutil`, `ctypes`, `from backend import mover, operations_log as ol`, `from backend.config import ProtectedPathError`), pydantic models, exception handlers, and routes:

```python
# ---- error mapping ---------------------------------------------------------
@app.exception_handler(OutOfSandboxError)
@app.exception_handler(ProtectedPathError)
async def _forbidden(_r, exc): return JSONResponse(status_code=403, content={"detail": str(exc)})

@app.exception_handler(mover.InvalidNameError)
@app.exception_handler(mover.ConflictError)
@app.exception_handler(mover.RefusedError)
async def _conflict(_r, exc): return JSONResponse(status_code=409, content={"detail": str(exc)})

@app.exception_handler(FileNotFoundError)
async def _missing(_r, exc): return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(PermissionError)
async def _denied(_r, exc): return JSONResponse(status_code=403, content={"detail": f"Access denied: {exc}"})


def _db():
    return aiosqlite.connect(_config.FILEPLUS_DB_PATH)


# ---- models ----------------------------------------------------------------
class DirName(BaseModel): dir: str; name: str
class RenameReq(BaseModel): path: str; new_name: str
class MoveReq(BaseModel): sources: list[str]; dest: str; on_conflict: str = "fail"
class PathsReq(BaseModel): paths: list[str]


# ---- fs mutations ----------------------------------------------------------
def _single(res: dict) -> dict:
    return {"batch_id": res.get("batch_id"), "ops": [res] if res["status"] == "done" else [],
            "conflicts": [res] if res["status"] == "conflict" else [], "errors": []}

@app.post("/fs/mkdir")
async def fs_mkdir(body: DirName):
    async with _db() as conn: return _single(await mover.mkdir(conn, Path(body.dir), body.name))

@app.post("/fs/touch")
async def fs_touch(body: DirName):
    async with _db() as conn: return _single(await mover.touch(conn, Path(body.dir), body.name))

@app.post("/fs/rename")
async def fs_rename(body: RenameReq):
    async with _db() as conn: return _single(await mover.rename(conn, Path(body.path), body.new_name))

@app.post("/fs/move")
async def fs_move(body: MoveReq):
    async with _db() as conn: return await mover.batch_move(conn, [Path(s) for s in body.sources], Path(body.dest), body.on_conflict)

@app.post("/fs/copy")
async def fs_copy(body: MoveReq):
    async with _db() as conn: return await mover.batch_copy(conn, [Path(s) for s in body.sources], Path(body.dest), body.on_conflict)

@app.post("/fs/trash")
async def fs_trash(body: PathsReq):
    async with _db() as conn: return await mover.batch_trash(conn, [Path(p) for p in body.paths])

@app.post("/fs/trash/empty")
async def fs_trash_empty():
    async with _db() as conn: return await mover.empty_trash(conn)


# ---- operations ------------------------------------------------------------
@app.get("/operations")
async def operations(limit: int = 50, offset: int = 0, path: Optional[str] = None):
    async with _db() as conn: return await ol.list_operations(conn, limit=limit, offset=offset, path=path)

@app.get("/operations/pending")
async def operations_pending():
    return list(app.state.reconciled)   # filled at startup (Task 9); [] until then

@app.post("/operations/{op_id}/undo")
async def undo_operation(op_id: int):
    async with _db() as conn: return await mover.undo_operation(conn, op_id)

@app.post("/operations/batch/{batch_id}/undo")
async def undo_batch(batch_id: str):
    async with _db() as conn: return await mover.undo_batch(conn, batch_id)
```
Replace the three old stub operation routes with the above (`GET /operations` was `[]`; the two undo stubs returned `not_implemented`). Update `tests/test_api.py::test_stub_routes_report_not_implemented` accordingly: keep only the `POST /files/1/tags` assertion (replaced again in Task 8), and assert `GET /operations` returns `[]` on a fresh DB and `POST /operations/999/undo` returns 409.

`/fs/list` rewrite: accept `show_hidden: bool = False`; `resolved = path_guard(Path(path), "read")`; `if not resolved.is_dir(): 404`; run `_scandir_entries(resolved, show_hidden)` via `asyncio.to_thread`; inside `_scandir_entries` catch `PermissionError` for the directory itself (re-raise → 403) and per-entry stat errors (entry gets `"error": "access denied"` and zero size); skip entries whose `is_hidden` is true when `show_hidden` is false (dot-names and the hidden attribute — this hides `.FilePlusTrash`); stop at `_config.LISTING_CAP` entries and set `truncated`. Response: `{"path", "parent": str(resolved.parent) if resolved.parent != resolved else None, "is_root": resolved.parent == resolved, "truncated", "entries"}`. `/fs/list/root` keeps returning the sandbox root with the same shape. Existing `tests/test_api_fs.py` tests must still pass (they use no hidden files).

`/drives`:
```python
def _volume_label(mount: str) -> str:
    buf = ctypes.create_unicode_buffer(261)
    ok = ctypes.windll.kernel32.GetVolumeInformationW(ctypes.c_wchar_p(mount), buf, 261, None, None, None, None, 0)
    return buf.value if ok else ""

@app.get("/drives")
async def drives():
    def scan():
        out = []
        for p in psutil.disk_partitions(all=False):
            if "fixed" not in p.opts and "rw" not in p.opts: continue
            try: u = psutil.disk_usage(p.mountpoint)
            except OSError: continue
            out.append({"letter": p.device.rstrip("\\"), "mount": p.mountpoint, "label": _volume_label(p.mountpoint),
                        "total_bytes": u.total, "free_bytes": u.free, "used_bytes": u.used})
        return out
    return await asyncio.to_thread(scan)
```
`/health`: add `db_ok` (try `SELECT 1`), `write_unlocked: _config.WRITE_UNLOCKED`, `pending_ops` (count of `pending_operations`), `index_running: app.state.index_state["running"]` (state dict initialised in lifespan: `app.state.index_state = {"running": False, "path": None, "count": 0, "started": None, "error": None}`; `app.state.reconciled = []`).

- [ ] **Step 4: Run** → `py -3 -m pytest -q` → `107 passed`. Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/api.py tests/test_api_fs_write.py tests/test_api_ops.py tests/test_api.py
git -c core.safecrlf=false commit -m "feat(api): fs mutation routes, operations/undo, drives, unrestricted read listing, health details

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Config, recent, favorites, pins

**Files:**
- Create: `backend/stores.py`, `tests/test_stores_api.py`
- Modify: `backend/api.py`

**Interfaces:**
- `backend/stores.py` (async, `conn` first): `config_get_all(conn) -> dict`, `config_get(conn, key) -> Any|None`, `config_set(conn, key, value)` (JSON-encodes; logs `config-change` with source=key, dest=JSON value truncated to 200 chars), `config_delete(conn, key)`; `recent_add(conn, path, action)` (cap 1,000 rows, delete oldest), `recent_groups(conn, limit=200) -> {"groups": [{"key","label","files":[{path, name, ext, action, action_at}]}]}` with the bucket rules below; `favorites_list(conn)`, `favorites_add(conn, path)` (append position; logged `favorite-add`), `favorites_remove(conn, path)` (logged), `favorites_reorder(conn, paths)`; `pins_list(conn)`, `pins_add(conn, path, label=None)`, `pins_update(conn, pin_id, label)`, `pins_remove(conn, pin_id)`, `pins_reorder(conn, ids)` (logged `pin-add`/`pin-remove`).
- Bucket rules (local time): `today`, `yesterday`, `this-week` (Monday-start, excluding today/yesterday), `earlier-this-month`, `last-month`, `earlier-this-year`, `year-<N>` for the previous three calendar years, `ancient`; labels "Today", "Yesterday", "This week", "Earlier this month", "Last month", "Earlier this year", "<year>", "A long time ago"; empty groups omitted; one entry per path (latest action wins).
- Routes: `GET /config`, `GET /config/{key}`, `POST /config {key, value}`, `DELETE /config/{key}`; `GET /recent?limit`, `POST /recent {path, action}`; `GET /favorites`, `POST /favorites {path}`, `DELETE /favorites?path=`, `POST /favorites/reorder {paths}`; `GET /pins`, `POST /pins {path, label?}`, `PATCH /pins/{id} {label}`, `DELETE /pins/{id}`, `POST /pins/reorder {ids}`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_stores_api.py
from datetime import datetime, timedelta
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_config_roundtrip_and_log(client):
    assert client.get("/config").json() == {}
    r = client.post("/config", json={"key": "ui.theme", "value": "light"}); assert r.status_code == 200
    r = client.post("/config", json={"key": "ui.show_hidden", "value": True})
    assert client.get("/config").json() == {"ui.theme": "light", "ui.show_hidden": True}
    assert client.get("/config/ui.theme").json() == {"key": "ui.theme", "value": "light"}
    assert client.get("/config/nope").status_code == 404
    client.delete("/config/ui.theme")
    assert "ui.theme" not in client.get("/config").json()
    ops = client.get("/operations").json()
    assert ops[0]["op_type"] == "config-change" and ops[0]["source_path"] == "ui.theme"


def test_recent_groups(client, sandbox):
    p = sandbox / "r.txt"; p.write_text("r")
    r = client.post("/recent", json={"path": str(p), "action": "opened"}); assert r.status_code == 200
    body = client.get("/recent").json()
    assert body["groups"][0]["key"] == "today" and body["groups"][0]["files"][0]["name"] == "r.txt"
    assert body["groups"][0]["files"][0]["action"] == "opened"
    client.post("/recent", json={"path": str(p), "action": "modified"})
    files = client.get("/recent").json()["groups"][0]["files"]
    assert len(files) == 1 and files[0]["action"] == "modified"   # one entry per path, latest wins


def test_favorites_crud_and_reorder(client, sandbox):
    a = sandbox / "a.txt"; b = sandbox / "b.txt"; a.write_text("a"); b.write_text("b")
    client.post("/favorites", json={"path": str(a)}); client.post("/favorites", json={"path": str(b)})
    favs = client.get("/favorites").json()["files"]
    assert [f["name"] for f in favs] == ["a.txt", "b.txt"] and favs[0]["position"] == 0
    client.post("/favorites/reorder", json={"paths": [str(b), str(a)]})
    assert [f["name"] for f in client.get("/favorites").json()["files"]] == ["b.txt", "a.txt"]
    r = client.delete("/favorites", params={"path": str(a)}); assert r.status_code == 200
    assert [f["name"] for f in client.get("/favorites").json()["files"]] == ["b.txt"]
    assert client.get("/operations").json()[0]["op_type"] == "favorite-remove"


def test_pins_crud(client, sandbox):
    d = sandbox / "Projects"; d.mkdir()
    r = client.post("/pins", json={"path": str(d)}); pin = r.json()
    assert pin["label"] == "Projects" and pin["position"] == 0
    client.patch(f"/pins/{pin['id']}", json={"label": "Work"})
    assert client.get("/pins").json()[0]["label"] == "Work"
    e = sandbox / "Else"; e.mkdir(); pin2 = client.post("/pins", json={"path": str(e)}).json()
    client.post("/pins/reorder", json={"ids": [pin2["id"], pin["id"]]})
    assert [p["id"] for p in client.get("/pins").json()] == [pin2["id"], pin["id"]]
    client.delete(f"/pins/{pin['id']}")
    assert [p["id"] for p in client.get("/pins").json()] == [pin2["id"]]
```

- [ ] **Step 2: Run to fail** → 404s.

- [ ] **Step 3: Implement `backend/stores.py`** (async functions per the interface; JSON via `json.dumps/loads`; recent grouping computed in Python from `ts` ISO strings with `datetime.fromisoformat`; use `datetime.now()` local time for bucket boundaries; for `recent_groups` query the latest row per path with `SELECT path, action, MAX(ts) AS ts FROM recent_actions GROUP BY path ORDER BY ts DESC LIMIT ?`; file entries: `name = Path(path).name`, `ext = Path(path).suffix.lower()`, `action_at = ts`), and the routes in `api.py` (thin wrappers opening `_db()`; `POST /pins` derives `label` from the folder name when omitted; `DELETE /favorites` reads `path` from the query string). Pydantic models: `ConfigSet(key: str, value: Any)`, `RecentAdd(path: str, action: str)`, `PathBody(path: str)`, `ReorderPaths(paths: list[str])`, `PinAdd(path: str, label: str | None = None)`, `PinPatch(label: str)`, `ReorderIds(ids: list[int])`.

- [ ] **Step 4: Run** → `py -3 -m pytest -q` → `111 passed`. Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/stores.py backend/api.py tests/test_stores_api.py
git -c core.safecrlf=false commit -m "feat(api): config table, recent actions with time buckets, favorites, pinned folders

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: File meta, preview, tags, history, search, quick index

**Files:**
- Modify: `backend/tagger.py` (replace stubs for `apply_tags`, `get_tags`; add `remove_tag`, `search_tags`; keep `auto_tag` stub), `backend/indexer.py` (`hash` parameter, skip `.FilePlusTrash` and protected roots, `index_file` returns the row id), `backend/api.py`
- Create: `tests/test_api_files.py`; replace placeholder `tests/test_tagger.py`

**Interfaces:**
- `tagger.apply_tags(conn, file_id, names: list[str]) -> list[int]` (creates missing tags with `tag_type='user'`, links, logs `tag-add` per name with source=file path), `tagger.get_tags(conn, file_id) -> list[dict]`, `tagger.remove_tag(conn, file_id, tag_id)` (logs `tag-remove`), `tagger.search_tags(conn, q, limit=10) -> list[dict]`.
- `indexer.index_file(path, conn, hash=True) -> int` (row id; `hash=None` when skipped), `indexer.scan_directory(root, hash=True) -> int`, skipping any directory named `TRASH_DIRNAME` and any path under `PROTECTED_WRITE_ROOTS`.
- Routes: `GET /file?path` → `{...files row..., "tags": [...], "kind": <human kind from ext>}` (indexes on demand with hash if missing); `GET /preview?path` per spec §4; `GET /files/{id}/tags`, `POST /files/{id}/tags {name}`, `DELETE /files/{id}/tags/{tag_id}`, `GET /tags?q&limit`; `GET /files/history?path`; `GET /search?q&limit`; `POST /index {path}` → `{"started": true}` or 409 if running; `GET /index/status` → `app.state.index_state`; `GET /files` gains `limit`/`offset`; `POST /scan` gains `hash`.

- [ ] **Step 1: Failing tests**

```python
# tests/test_api_files.py
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(sandbox, db):
    from backend.api import app
    with TestClient(app) as c:
        yield c


def test_file_meta_indexes_on_demand(client, sandbox):
    p = sandbox / "m.md"; p.write_text("# hi")
    r = client.get("/file", params={"path": str(p)}); assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "m.md" and body["size"] == 4 and body["hash"] and body["tags"] == [] and body["kind"] == "Markdown"
    assert client.get("/file", params={"path": str(sandbox / "nope.txt")}).status_code == 404


def test_preview_text_image_binary(client, sandbox):
    t = sandbox / "t.txt"; t.write_text("hello " * 2000)
    body = client.get("/preview", params={"path": str(t)}).json()
    assert body["kind"] == "text" and body["truncated"] is True and len(body["content"]) <= 4096
    png = sandbox / "i.png"; png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    r = client.get("/preview", params={"path": str(png)})
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/png")
    b = sandbox / "b.bin"; b.write_bytes(bytes(range(256)))
    assert client.get("/preview", params={"path": str(b)}).json()["kind"] == "binary"


def test_tags_crud_and_search(client, sandbox):
    p = sandbox / "tg.txt"; p.write_text("x")
    fid = client.get("/file", params={"path": str(p)}).json()["id"]
    r = client.post(f"/files/{fid}/tags", json={"name": "work"}); assert r.status_code == 200
    client.post(f"/files/{fid}/tags", json={"name": "docs"})
    tags = client.get(f"/files/{fid}/tags").json()
    assert {t["name"] for t in tags} == {"work", "docs"} and tags[0]["tag_type"] == "user"
    assert [t["name"] for t in client.get("/tags", params={"q": "wo"}).json()] == ["work"]
    tid = next(t["id"] for t in tags if t["name"] == "work")
    client.delete(f"/files/{fid}/tags/{tid}")
    assert [t["name"] for t in client.get(f"/files/{fid}/tags").json()] == ["docs"]
    ops = [o["op_type"] for o in client.get("/operations").json()]
    assert ops[:3] == ["tag-remove", "tag-add", "tag-add"]


def test_history_by_path(client, sandbox):
    p = sandbox / "h.txt"; p.write_text("h")
    client.post("/fs/rename", json={"path": str(p), "new_name": "h2.txt"})
    rows = client.get("/files/history", params={"path": str(sandbox / "h2.txt")}).json()
    assert len(rows) == 1 and rows[0]["op_type"] == "rename"


def test_search_and_quick_index(client, sandbox):
    (sandbox / "deep").mkdir(); (sandbox / "deep" / "budget-2026.xlsx").write_text("b")
    r = client.post("/index", json={"path": str(sandbox)}); assert r.status_code == 200 and r.json()["started"] is True
    import time
    for _ in range(50):
        if client.get("/index/status").json()["running"] is False: break
        time.sleep(0.1)
    st = client.get("/index/status").json()
    assert st["running"] is False and st["count"] >= 1 and st["error"] is None
    hits = client.get("/search", params={"q": "budget"}).json()
    assert hits and hits[0]["filename"] == "budget-2026.xlsx" and hits[0]["hash"] is None   # quick index does not hash


def test_files_pagination(client, sandbox):
    for i in range(5): (sandbox / f"f{i}.txt").write_text("x")
    client.post("/scan", json={})
    assert len(client.get("/files", params={"limit": 2, "offset": 0}).json()) == 2
    assert len(client.get("/files", params={"limit": 2, "offset": 4}).json()) == 1
```

```python
# tests/test_tagger.py
import aiosqlite
import pytest
from backend import tagger
from backend.indexer import index_file


@pytest.fixture
async def conn(db):
    async with aiosqlite.connect(db) as c:
        c.row_factory = aiosqlite.Row
        yield c


async def test_apply_get_remove(conn, sandbox):
    p = sandbox / "a.txt"; p.write_text("a")
    fid = await index_file(p, conn); await conn.commit()
    ids = await tagger.apply_tags(conn, fid, ["work", "work", "docs"])
    assert len(ids) == 2
    assert {t["name"] for t in await tagger.get_tags(conn, fid)} == {"work", "docs"}
    await tagger.remove_tag(conn, fid, ids[0])
    assert len(await tagger.get_tags(conn, fid)) == 1
    assert [t["name"] for t in await tagger.search_tags(conn, "do")] == ["docs"]
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Implement**

`backend/indexer.py`: `index_file(path, conn, hash=True)` → `file_hash = hash_file(path) if hash else None`; the upsert keeps an existing hash when the new value is `None` (`hash = COALESCE(excluded.hash, files.hash)`); return `cur.lastrowid` or, on conflict update, re-select the id by path. `scan_directory(root, hash=True)`: prune dirnames equal to `TRASH_DIRNAME`; skip roots under `PROTECTED_WRITE_ROOTS` (`_config.is_under`); pass `hash` through.

`backend/tagger.py`: implement the four functions with plain SQL (`INSERT OR IGNORE INTO tags (name, tag_type) VALUES (?, 'user')`, select id, `INSERT OR IGNORE INTO file_tags`, log `tag-add` with `source=<file path from files row>`, `dest=<tag name>`); `remove_tag` deletes the link and logs `tag-remove`; `search_tags` uses `name LIKE ? || '%'` ordered by name.

`backend/api.py`:
- `KIND_BY_EXT` map (`.md: Markdown`, `.txt: Text`, `.py: Python source`, `.js: JavaScript`, `.json: JSON`, `.pdf: PDF document`, `.png/.jpg/.jpeg/.gif/.webp/.bmp/.svg/.ico: Image`, `.mp3/.wav/.flac/.m4a/.ogg: Audio`, `.mp4/.mkv/.mov/.avi: Video`, `.zip/.7z/.rar/.tar/.gz: Archive`, `.exe/.msi: Application`, `.docx: Word document`, `.xlsx: Excel workbook`, `.pptx: PowerPoint`, default `"<EXT> file"` or `"Folder"`).
- `GET /file`: `resolved = path_guard(path, 'read')`; 404 if missing; open conn; `SELECT * FROM files WHERE path=?`; if none → `index_file(resolved, conn, hash=True)`, commit, re-select; attach `tags` via `tagger.get_tags`, `kind`.
- `GET /preview`: text extensions set (`md txt py js ts json yaml yml toml csv log ini xml html css sh ps1 c cpp h rs go java kt swift rb php sql bat cmd`); image set; image → `FileResponse(path, media_type=mimetypes.guess_type(...)[0] or 'application/octet-stream')` if size ≤ 25 MB else `{kind:'too-large'}`; text → read first 4096 bytes as UTF-8 with `errors='replace'`, `{kind:'text', content, truncated: size > 4096, total_size}`; else `{kind:'binary', size}`.
- Tag routes, history (`ol.list_operations(conn, path=str(resolved))`), search (`SELECT id, path, filename, extension, size, modified, hash FROM files WHERE filename LIKE ? OR path LIKE ? ORDER BY filename COLLATE NOCASE LIMIT ?` with `%q%`), `GET /files` pagination.
- Quick index: `POST /index`: 409 if `app.state.index_state["running"]`; else set state and `asyncio.create_task(_run_index(path))` where `_run_index` calls `scan_directory(Path(path), hash=False)` then `remove_stale_entries()`, updating `count`, `error`, `running=False` in a `finally`. Note `TestClient` runs the app in a thread with its own loop: `create_task` inside a route works because the route runs on that loop.

- [ ] **Step 4: Run** → `py -3 -m pytest -q` → `117 passed` (111 − 1 placeholder + 6 + 1). Verify green.

- [ ] **Step 5: Commit**
```bash
git add backend/api.py backend/tagger.py backend/indexer.py tests/test_api_files.py tests/test_tagger.py
git -c core.safecrlf=false commit -m "feat(api): file meta, preview, tag CRUD, history, search, quick index without hashing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Electron bridge, startup reconcile, verify gate, docs, run summary

**Files:**
- Modify: `frontend/main.js`, `frontend/preload.js`, `backend/api.py` (lifespan), `scripts/verify.ps1`, `CLAUDE.md`, `.env.example` (already), `docs/superpowers/specs/2026-09-11-stage-2-explorer-parity-design.md` (only if an interface changed during the run — say so)
- Create: `docs/superpowers/runs/<today>-stage-2a.md`

**Interfaces:**
- `preload.js` adds: `openPath(path) -> Promise<string>` (empty string on success, else the error text), `showItemInFolder(path)`, `openWith(path)`, `pickFolder(defaultPath) -> Promise<string|null>`, `clipboardWriteText(text)`.
- Lifespan: after `init_db()`, open a connection, `app.state.reconciled = await ol.reconcile_pending(conn)`; log a warning per row.

- [ ] **Step 1: main.js + preload.js**

`main.js`: import `shell, dialog, clipboard` from electron and `spawn` from `child_process`. Inside `app.whenReady()`:
```js
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  ipcMain.handle('shell-open-path', async (_e, p) => isStr(p) ? await shell.openPath(p) : 'invalid path');
  ipcMain.on('shell-show-item', (_e, p) => { if (isStr(p)) shell.showItemInFolder(p); });
  ipcMain.on('shell-open-with', (_e, p) => {
    if (!isStr(p)) return;
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], { detached: true, stdio: 'ignore' }).unref();
  });
  ipcMain.handle('dialog-pick-folder', async (_e, defaultPath) => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], defaultPath: isStr(defaultPath) ? defaultPath : undefined });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  ipcMain.on('clipboard-write-text', (_e, t) => { if (typeof t === 'string') clipboard.writeText(t); });
```
`preload.js`: add the five methods (`invoke` for the two handles, `send` for the rest).

- [ ] **Step 2: Startup reconcile**

In `api.py` lifespan: `await init_db(); async with _db() as conn: app.state.reconciled = await ol.reconcile_pending(conn)`; initialise `app.state.index_state` there too (move from Task 6 if it was elsewhere).

- [ ] **Step 3: verify.ps1**

Before the backend stage add:
```powershell
Write-Host '== fixtures ==' -ForegroundColor Cyan
py -3 scripts/gen_sandbox.py
if ($LASTEXITCODE -ne 0) { Write-Host 'sandbox generation failed' -ForegroundColor Red; exit 1 }
```
Renumber stage headers to `/5`. Also export `$env:WRITE_UNLOCKED = 'false'` before starting the backend (belt and braces for the smoke run).

- [ ] **Step 4: CLAUDE.md**

Replace the two `path_guard` safety bullets with: "`path_guard(path, mode)` gates every filesystem touch: reads anywhere; writes inside `FILEPLUS_SANDBOX_PATH` until `WRITE_UNLOCKED=true` in `.env`; Windows system roots and the app directory are never writable (`ProtectedPathError`)." and "Delete is a same-volume move into `.FilePlusTrash`; `POST /fs/trash/empty` sends it to the Recycle Bin. The app never hard-deletes. Every mutation: guard → log (`executed=0`) → act → mark; undo is a logged inverse (`undo_of`)." Update the "Current state" paragraph to point at the Stage 2A run summary.

- [ ] **Step 5: Verify, run summary, commit**

Run verify (all green; pytest 117). Write `docs/superpowers/runs/<today>-stage-2a.md` with: branch/base/date/plan/verify; "What landed" from `git log master..HEAD --oneline --reverse`; "API surface" (one line per route group); "Rulings made by the controller" (supplied at dispatch); "Known debts"; "How to review" (switch, verify, try a few `curl`s against `py -3 -m backend.api`: list `C:\`, mkdir/rename/trash/undo inside the sandbox, `/operations`, `/fs/trash/empty`; merge in two commands). Commit:
```bash
git add frontend/main.js frontend/preload.js backend/api.py scripts/verify.ps1 CLAUDE.md docs/superpowers/runs/
git -c core.safecrlf=false commit -m "feat(shell): Electron open/reveal/open-with/pick-folder/clipboard bridge; startup crash reconcile; fixtures in verify; docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- **Coverage.** §3.1 guard → T1. §3.2 trash → T4 (`trash_root_for`, hidden attr, manifest, `empty_trash`). §3.3 log protocol → T3/T4 (`_perform`); undo/redo/inverses → T5; crash recovery → T3 + T9 lifespan + `/operations/pending` (T6). §3.4 names/conflicts/into-self/space → T4. §4 routes: health/drives/list/mutations/operations → T6; config/recent/favorites/pins → T7; file/preview/tags/history/search/index/files pagination/scan hash → T8. §5 bridge → T9. §8 backend tests → every task. `verify.ps1` fixtures → T9.
- **Placeholders.** None; `<today>` in T9 filled at execution.
- **Type consistency.** `path_guard(path, mode)` (T1) used by T4/T8 with `'read'`/`'write'`. `ol.log_operation(conn, op_type, source, dest, batch_id, reason, undo_of)` (T3) matches `_perform` (T4) and stores (T7). Result dict keys `op_id, op_type, status, src, dest, batch_id` (T4) consumed by `_single`/`_batch` (T6) and `undo_batch` (T5). `index_file(path, conn, hash=True) -> int` (T8) used by `tagger` tests and `/file`. `app.state.index_state` and `app.state.reconciled` initialised in lifespan (T9) and read by T6/T8 routes — T6's implementer must create them in lifespan already so T6's health test passes (state dict with `running False`), T9 adds the reconcile call.
