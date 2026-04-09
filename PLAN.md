# Nexus Build Plan

Complete phase-by-phase implementation roadmap for the Nexus file explorer.

---

## Phase 1 — Indexer and Database

**Goal:** Walk the filesystem and build a fully populated SQLite index of all files.

**Files to modify/create:**
- `backend/hasher.py` — implement `hash_file(path)` using `xxhash.xxh64`
- `backend/indexer.py` — implement `scan_directory()`, `index_file()`, `remove_stale_entries()`
- `backend/database.py` — validate and test `init_db()` end-to-end
- `tests/test_indexer.py` — real tests replacing placeholder

**Key implementation details:**
- `hash_file`: open file in 64 KB chunks, feed to `xxhash.xxh64`, return hex digest
- `index_file`: extract `filename`, `extension`, `size`, `os.stat().st_mtime` (as ISO string), call `hash_file`; upsert into `files` with `INSERT OR REPLACE`
- `scan_directory`: call `path_guard()` first; use `os.walk()` to recurse; skip hidden files/dirs (names starting with `.`); call `index_file` for each file
- `remove_stale_entries`: query all paths from DB; check each with `os.path.exists()`; delete missing ones
- DB connection: use `async with aiosqlite.connect(NEXUS_DB_PATH)` — do not hold a global connection

**Dependencies:** None.

**Testing criteria:**
- `pytest tests/test_indexer.py` passes
- Scan `C:\NexusTestSandbox` (populate it with test files first), query DB with `SELECT COUNT(*) FROM files`, verify count matches
- Delete a test file, re-scan, verify it's removed from DB
- Confirm `path_guard()` raises `ValueError` for paths outside sandbox

**Estimated sessions:** 1–2

---

## Phase 2 — Tagging and Rules Engine

**Goal:** Implement the three-tier tag system (system, AI, user) and auto-tagging rules.

**Files to modify/create:**
- `backend/tagger.py` — implement `apply_tags()`, `get_tags()`, `auto_tag()`
- `tests/test_tagger.py` — real tests

**Key implementation details:**
- `apply_tags(file_id, tags)`: for each tag name, `INSERT OR IGNORE INTO tags`, then `INSERT OR IGNORE INTO file_tags`
- `get_tags(file_id)`: `SELECT t.* FROM tags t JOIN file_tags ft ON t.id=ft.tag_id WHERE ft.file_id=?`
- `auto_tag(file_id)`: query the file's extension and size; apply system tags:
  - Extension groups: image (`jpg,png,gif,webp,svg`), video (`mp4,mov,avi,mkv`), audio (`mp3,flac,wav,ogg`), document (`pdf,docx,xlsx,pptx,txt,md`), code (`py,js,ts,go,rs,java,cpp,c`)
  - `large-file` if size > 100 MB
  - `duplicate` if hash matches another row in `files`
- Tag colors: define a default color per `tag_type` (system=`#888888`, ai=`#4A90D9`, user=`#7ED321`)

**Dependencies:** Phase 1 (files table must be populated).

**Testing criteria:**
- Apply tags to a test file, retrieve them, verify round-trip
- `auto_tag` marks a 200 MB file as `large-file`
- `auto_tag` marks two files with identical hashes as `duplicate`

**Estimated sessions:** 1

---

## Phase 3 — AI Classification (Local LLM)

**Goal:** Classify files by category using Ollama locally, with Claude API as fallback.

**Files to modify/create:**
- `backend/classifier.py` — implement `classify_local()`, `classify_cloud()`, `classify()`
- `tests/test_classifier.py` — real tests (mock HTTP calls)

**Key implementation details:**
- `classify_local(file_path)`: POST to `{OLLAMA_HOST}/api/generate` with a prompt including filename, extension, size, and (for text files) first 512 bytes of content; parse JSON response; return `{category, confidence}`
- Prompt template: `"Classify this file into one of: [Documents, Images, Videos, Audio, Code, Archives, Data, Other]. Filename: {name}, Extension: {ext}, Size: {size}. Reply with JSON: {\"category\": \"...\", \"confidence\": 0.0-1.0}"`
- `classify_cloud(file_path)`: call Anthropic Claude API with same structured prompt; use `anthropic` SDK
- `classify(file_path)`: try `classify_local` first; if it raises or returns `confidence < AUTO_SORT_CONFIDENCE_THRESHOLD`, fall back to `classify_cloud`; update `files.category` and `files.confidence` in DB
- Graceful degradation: if both fail, set category to `"Unclassified"`, confidence to `0.0`

**Dependencies:** Phase 1 (files table), Phase 2 (tagger for applying AI tags).

**Testing criteria:**
- Mock Ollama returns correct JSON → `classify_local` parses it
- Mock Ollama fails → `classify` falls back to cloud
- Category and confidence written to `files` table

**Estimated sessions:** 1–2

---

## Phase 4 — FastAPI Backend

**Goal:** Expose the indexer, tagger, and classifier through a well-structured REST API.

**Files to modify/create:**
- `backend/api.py` — implement all route handlers
- Add `backend/models.py` (Pydantic response models)

**Key implementation details:**
- `GET /health` — already done (returns `{status, version}`)
- `GET /files?path=&tag=&category=&q=` — query files table with optional filters
- `GET /files/{id}` — single file detail
- `POST /index/scan` body `{path: str}` — trigger `scan_directory()` as a background task
- `GET /tags` — list all tags
- `POST /files/{id}/tags` body `{names: [str]}` — apply tags
- `DELETE /files/{id}/tags/{tag_id}` — remove tag
- `POST /files/{id}/classify` — trigger classification for one file
- Response models: `FileResponse`, `TagResponse`, `ScanResponse` (with task_id)
- Use `fastapi.BackgroundTasks` for long-running scan/classify operations
- Startup event: call `init_db()`

**Dependencies:** Phases 1, 2, 3.

**Testing criteria:**
- `python -m backend.api` starts without errors
- `curl http://localhost:9876/health` returns `{"status":"ok"}`
- `POST /index/scan` with sandbox path triggers a scan; `GET /files` returns results

**Estimated sessions:** 1–2

---

## Phase 5 — Electron Frontend Shell

**Goal:** Complete the Electron shell with working navigation, API connectivity, and layout polish.

**Files to modify/create:**
- `frontend/src/app.js` — wire up backend polling, address bar navigation stub
- `frontend/src/styles.css` — any polish from Phase 4 API shape
- `frontend/electron.js` — add window state persistence (size/position)

**Key implementation details:**
- On startup: `GET /health`; show green dot if backend is running, red if not
- Address bar: on Enter, validate path exists via `GET /files?path=<value>`, update breadcrumb
- Sidebar nav items: clicking "Downloads" etc. sets the address bar path and triggers a load
- Window state: use `electron-store` or a plain JSON file in `userData` to persist window bounds

**Dependencies:** Phase 4.

**Testing criteria:**
- Launch `npm start` from `frontend/` — window opens, layout is correct
- Backend status dot shows green when `python -m backend.api` is running
- Sidebar collapse/expand works; preview panel close works
- F12 opens DevTools

**Estimated sessions:** 1

---

## Phase 6 — File Browsing in UI

**Goal:** Render a real file listing from the backend, with list/grid/detail view modes.

**Files to modify/create:**
- `frontend/src/app.js` — implement `loadDirectory()`, file rendering, selection
- `frontend/src/styles.css` — file list/grid item styles, selection highlight
- `frontend/src/components/` (optional) — split rendering logic into separate files

**Key implementation details:**
- `loadDirectory(path)`: `GET /files?path=<path>` → render results in `#file-area`
- List view: single-row items with icon, name, size, modified date, category badge
- Grid view: icon cards (72×72 icon, filename below)
- Detail view: full-width rows with all metadata columns
- File icons: map extension to an emoji or SVG icon (no external CDN)
- Selection: click to select (highlight), Ctrl+click to multi-select, store selected IDs
- Preview panel: on single-file selection, `GET /files/{id}` → render name, size, tags, category
- Breadcrumb: update to reflect current path, each segment clickable

**Dependencies:** Phase 5.

**Testing criteria:**
- Scan sandbox via API, then `loadDirectory()` renders all files
- Switching view modes re-renders the same data in the correct layout
- Clicking a file updates the preview panel

**Estimated sessions:** 2

---

## Phase 7 — Everything Folder Watcher

**Goal:** Watch a configured inbox directory and automatically classify new files.

**Files to modify/create:**
- `backend/watcher.py` — implement `NexusEventHandler`, `start_watcher()`, `stop_watcher()`
- `backend/api.py` — add `POST /watcher/start` and `POST /watcher/stop`
- `frontend/src/app.js` — add Everything Folder badge/indicator

**Key implementation details:**
- `NexusEventHandler` extends `watchdog.events.FileSystemEventHandler`
- `on_created`: call `index_file()`, then `classify()`, then `auto_tag()` for the new file
- `on_moved`: update the `path` in the DB; log the move in `operations_log`
- Observer runs in a daemon thread started by `start_watcher()`
- Global `_observer` variable holds the Observer instance for `stop_watcher()` to join
- Config: `NEXUS_EVERYTHING_PATH` (add to config.py and .env.example) — the watched inbox

**Dependencies:** Phases 1, 2, 3, 4.

**Testing criteria:**
- Start watcher, drop a file into the sandbox inbox, confirm it appears in DB within 2 seconds
- Move a file inside the watched directory; verify DB path is updated

**Estimated sessions:** 1

---

## Phase 8 — Scan and Reorganisation Pipeline

**Goal:** Full initial-scan wizard: multi-pass analysis, deduplication, AI categorisation, and a proposed folder tree that the user approves before any moves happen.

**Files to modify/create:**
- `backend/indexer.py` — add `full_scan()` multi-pass function
- `backend/organiser.py` (new) — propose folder structure, generate `batch_move` plan
- `backend/api.py` — add `/scan/full`, `/scan/proposals`, `/scan/apply` routes
- `frontend/src/app.js` — scan progress UI, proposal review panel

**Key implementation details:**
- Multi-pass: (1) index all files, (2) hash + dedup, (3) classify all unclassified, (4) auto-tag, (5) generate folder proposals
- Proposals: group files by `category` → suggest `{sandbox}/Documents/`, `{sandbox}/Images/` etc.; never propose moves outside sandbox
- Proposal format: `[{source, dest, reason, confidence}]` — returned as JSON from `/scan/proposals`
- User must explicitly call `POST /scan/apply` with `{approved_moves: [...]}` — nothing moves without this
- Progress: stream scan progress via `GET /scan/progress` using Server-Sent Events

**Dependencies:** Phases 1–5.

**Testing criteria:**
- Full scan on 100-file sandbox completes without errors
- Proposals JSON is valid and all dest paths are inside sandbox
- `POST /scan/apply` moves files and all moves are in `operations_log`

**Estimated sessions:** 2–3

---

## Phase 9 — Search, Smart Folders, and Polish

**Goal:** Full-text search across filenames and tags; smart folders as saved queries; UI polish.

**Files to modify/create:**
- `backend/api.py` — add `GET /search?q=` full-text endpoint; add `GET /smart-folders`, `POST /smart-folders`
- `backend/database.py` — add FTS5 virtual table for filenames and tags
- `frontend/src/app.js` — wire up search bar, smart folder sidebar entries, keyboard shortcuts

**Key implementation details:**
- SQLite FTS5: `CREATE VIRTUAL TABLE files_fts USING fts5(filename, path, content=files)` — add to `init_db()`
- Search query: `SELECT files.* FROM files JOIN files_fts ON files.rowid = files_fts.rowid WHERE files_fts MATCH ?`
- Smart folders stored in a new `smart_folders` table: `(id, name, icon, query_json)`
- `query_json` is a JSON object: `{tags: ["work"], category: "Documents", size_gt: 0, date_after: "..."}`
- Keyboard shortcut `Ctrl+F` focuses the search bar
- `Ctrl+K` opens a command palette (stub for future AI command bar — Phase 9 just renders a modal)

**Dependencies:** Phases 1–6.

**Testing criteria:**
- Search "report" returns all files with "report" in the name
- Smart folder "Large Files" (size > 100 MB) renders correct results
- Ctrl+F focuses search; Escape clears and collapses it

**Estimated sessions:** 2

---

## Phase 10 — Undo System and Safety

**Goal:** Full undo/redo for all file operations; safety hardening; final integration testing.

**Files to modify/create:**
- `backend/operations_log.py` — implement `log_operation()`, `undo_operation()`, `undo_batch()`
- `backend/mover.py` — implement `move_file()`, `batch_move()` with logging
- `backend/api.py` — wire up undo endpoints; add safety guard middleware
- `frontend/src/app.js` — undo history panel, `Ctrl+Z` handler

**Key implementation details:**
- `log_operation`: insert into `operations_log` BEFORE the operation; return the inserted `id`
- `undo_operation(op_id)`: read the row; reverse the operation (e.g. move `dest→src`); set `undone=1`
- `undo_batch(batch_id)`: fetch all ops with that `batch_id` ordered by `id DESC`; undo each in order
- `move_file`: call `path_guard(src)`, `path_guard(dest)`, `log_operation(...)`, then `shutil.move()`; update `files.path` in DB
- Safety middleware: FastAPI middleware that rejects any request involving a path outside sandbox when `SAFETY_MODE=true`
- History panel: `GET /operations?limit=50` → render list with "Undo" button per item

**Dependencies:** All prior phases.

**Testing criteria:**
- Move a file, then `POST /operations/{id}/undo` moves it back; verify on disk and in DB
- Batch move 5 files, undo the batch; all 5 return to original locations
- `path_guard()` rejects operations outside sandbox; middleware returns HTTP 403
- `pytest tests/test_mover.py` passes with real sandbox operations

**Estimated sessions:** 2

---

## Phase 11 — Packaging and Distribution

**Goal:** Produce a single installable package for Windows.

**Key implementation details:**
- **Backend**: use PyInstaller to bundle Python + all dependencies into a single `.exe` (or folder): `pyinstaller --onefile --name nexus-backend backend/api.py`
- **Frontend**: use `electron-builder` to package the Electron app; configure it to launch the bundled backend `.exe` as a child process on startup
- `electron-builder` config in `package.json` under `"build"` key: `target: "nsis"` for Windows installer
- The packaged Electron app should: (1) start the backend child process, (2) wait for `/health` to respond, (3) then load `index.html`
- Ship a default `.env` with safe defaults baked in, or add a first-launch setup wizard
- NSIS installer should create a Start Menu shortcut and register the app with Windows

**Notes:**
- Test the packaged app in a clean VM (no Python, no Node installed) before distributing
- Code-sign the `.exe` to avoid Windows SmartScreen warnings
- CI/CD: consider a GitHub Actions workflow that builds on push to `main`

---

*Last updated: Phase 0 scaffolding complete — 2026-04-08*
