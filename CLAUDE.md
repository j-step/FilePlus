# FilePlus — AI-Powered Windows File Explorer

**One-line description:** A Windows desktop file explorer replacement with local-first AI file organisation, tagging, smart folders, and a complete undo system.

---

## Tech Stack

| Component         | Technology                                              |
|-------------------|---------------------------------------------------------|
| Frontend          | Electron (HTML/CSS/JS, no framework), dark mode default |
| Backend           | Python 3.11+, FastAPI on `localhost:9876`, uvicorn      |
| Async DB          | aiosqlite (SQLite with WAL mode)                        |
| AI — local        | Ollama `llama3.1:8b` via HTTP                           |
| AI — cloud        | Claude API (Anthropic) — fallback only                  |
| Filesystem events | watchdog                                                |
| File hashing      | xxhash (xxh64)                                          |
| Metadata          | Pillow (images), mutagen (audio/video), python-magic-bin|
| Config            | python-dotenv, all vars in `.env`                       |

---

## Architecture

```
Electron renderer (index.html + app.js)
        │  fetch() only — no FS access
        ▼
FastAPI backend (localhost:9876)  ←→  SQLite DB (fileplus.db, WAL)
        │  path_guard() enforced
        ▼
Filesystem (FILEPLUS_SANDBOX_PATH in dev, real FS in prod)
```

- **Backend is the single source of authority** for all business logic.
- **SQLite is a cache** of filesystem state — it must always adapt to the real filesystem, never the other way around.
- **Filesystem is reality.** If a file exists on disk but not in the DB, the DB is wrong.
- All config comes from `.env` → `backend/config.py`. Nothing is ever hardcoded.
- `SAFETY_MODE=true` (default) restricts ALL file operations to `FILEPLUS_SANDBOX_PATH`.

---

## Coding Conventions

- **All paths come from `backend/config.py`** — never hardcode a path anywhere.
- **Log before you act** — call `operations_log.log_operation()` BEFORE executing any file operation.
- **Never delete without approval** — move to a staging area or mark for review, never silently delete.
- **Enforce `path_guard()`** in every function that touches the filesystem.
- **Async everywhere** in the backend — use `async def`, `aiosqlite`, `aiohttp`.
- **Frontend uses `fetch()` only** — the Electron renderer never calls Node fs APIs directly.

---

## Build Phases

| # | Phase                              | Status      |
|---|------------------------------------|-------------|
| 1 | Indexer and Database               | NOT STARTED |
| 2 | Tagging and Rules Engine           | NOT STARTED |
| 3 | AI Classification (Local LLM)      | NOT STARTED |
| 4 | FastAPI Backend                    | NOT STARTED |
| 5 | Electron Frontend Shell            | NOT STARTED |
| 6 | File Browsing in UI                | NOT STARTED |
| 7 | Everything Folder Watcher          | NOT STARTED |
| 8 | Scan and Reorganisation Pipeline   | NOT STARTED |
| 9 | Search, Smart Folders, and Polish  | NOT STARTED |
|10 | Undo System and Safety             | NOT STARTED |

---

## Current State

**Phase 0 scaffolding complete.** All backend modules are stubs with `pass` bodies. Frontend is a layout shell only (three-column layout, CSS variables, dark mode, collapsible panels). No features are implemented yet.

---

## Known Bugs

None.

---

## Next Task

**Phase 1 implementation:** build the file indexer and hasher, populate the database.

Files to implement:
- `backend/hasher.py` — `hash_file(path)` using xxhash
- `backend/indexer.py` — `scan_directory()`, `index_file()`, `remove_stale_entries()`
- `backend/database.py` — verify `init_db()` works end-to-end

Write tests in `tests/test_indexer.py` covering:
- Directory scan populates the `files` table correctly
- Re-scan detects modified files (changed `modified` timestamp)
- Stale entries are removed after files are deleted
- `path_guard()` blocks operations outside the sandbox when `SAFETY_MODE=true`

Verify with: `pytest tests/` from repo root (after installing deps).
