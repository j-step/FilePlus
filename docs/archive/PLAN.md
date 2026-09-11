# FilePlus Build Plan

Phase-by-phase implementation roadmap. Phase numbers match HANDOFF.md §8. Claude Code sessions should reference these phase numbers, not the old Nexus manual numbering.

**Estimated total:** ~38–47 Claude Code sessions.

---

## Phase 0 — Scaffolding

**Goal:** Project skeleton, DB schema, `config.py`, `path_guard()`, empty module stubs, first Git commit.

**Files:** all of `backend/`, `frontend/`, `tests/`, `docs/` per §7.1 repo layout (stubs only).

**Key implementation details:**
- `config.py`: load `.env` via `python-dotenv`; expose `FILEPLUS_DB_PATH`, `FILEPLUS_SANDBOX_PATH`, `FILEPLUS_EVERYTHING_PATH`, `SAFETY_MODE`, `OLLAMA_HOST`, `ANTHROPIC_API_KEY`, `AUTO_SORT_CONFIDENCE_THRESHOLD`; implement `path_guard(path: Path) -> Path` that raises `OutOfSandboxError` when `SAFETY_MODE=True` and the resolved path escapes the sandbox
- `database.py`: `init_db()` that creates all tables (WAL mode, `PRAGMA journal_mode=WAL`) and seeds `schema_version`; full schema from HANDOFF.md §7.3: `files`, `tags`, `file_tags`, `operations_log`, `snapshots`, `approvals`, `training_signals`, `schema_version`
- All other backend modules: stub functions with `# TODO: implement in Phase X` comments
- `frontend/index.html`: three-column layout shell (sidebar / content / inspector), CSS variables from design tokens v2, dark-mode default, collapsible panels — no features wired
- `frontend/src/actions.js`: stub dispatch map — every `data-action` logs and shows "not implemented" toast

**Dependencies:** none.

**Test criteria:**
- `pytest tests/` runs clean (all placeholder tests pass)
- `python -m backend.api` starts FastAPI without errors; `GET /health` returns `{"status":"ok"}`
- `npm start` (from `frontend/`) opens a blank Electron window

**Estimated sessions:** 1

---

## Phase 1 — Indexer + Hasher

**Goal:** Walk the sandbox filesystem, compute xxhash fingerprints, populate `files` table. Read-only. Moves nothing.

**Files:** `backend/indexer.py`, `backend/hasher.py`, `tests/test_indexer.py`

**Key implementation details:**
- `hash_file(path: Path) -> str`: open file in 64 KB chunks, feed to `xxhash.xxh64()`, return hex digest
- `index_file(path: Path, conn)`: call `path_guard(path)`; extract `filename`, `extension`, `size`, `os.stat().st_mtime` (ISO datetime), call `hash_file`; upsert into `files` with `INSERT OR REPLACE`; set `status='indexed'`
- `scan_directory(root: Path, conn)`: call `path_guard(root)`; use `os.walk()` to recurse; skip hidden files/dirs (names starting with `.`); skip partial downloads (`.crdownload`, `.part`, `.tmp`); call `index_file` for each file
- `remove_stale_entries(conn)`: query all paths from DB; check each with `os.path.exists()`; delete rows for missing paths
- DB connections: use `async with aiosqlite.connect(FILEPLUS_DB_PATH)` — never hold a global connection

**Dependencies:** Phase 0.

**Test criteria:**
- Populate `FILEPLUS_SANDBOX_PATH` with 100 dummy files including duplicates; run indexer; verify `SELECT COUNT(*) FROM files` matches
- Delete a test file, re-scan, verify it is removed from DB
- `path_guard()` raises `OutOfSandboxError` for paths outside sandbox when `SAFETY_MODE=True`

**Estimated sessions:** 2–3

---

## Phase 2 — Tagger + Classifier

**Goal:** Assign system tags (deterministic, from metadata) and semantic tags (AI-generated). Writes to DB only — never touches the filesystem. Rules engine first, local Ollama fallback, cloud Claude API fallback.

**Files:** `backend/tagger.py`, `backend/classifier.py`, `tests/test_tagger.py`, `tests/test_classifier.py`

**Key implementation details:**
- `apply_tags(file_id, tags: list[str], conn)`: `INSERT OR IGNORE INTO tags`; `INSERT OR IGNORE INTO file_tags`
- `get_tags(file_id, conn) -> list`: `SELECT t.* FROM tags t JOIN file_tags ft ...`
- `auto_tag(file_id, conn)`: system tags by extension group (image, video, audio, document, code); `large-file` if size > 100 MB; `duplicate` if hash matches another row
- `classify_local(file_path: Path) -> dict`: POST to `{OLLAMA_HOST}/api/generate` with structured prompt (filename, ext, size, first 512 bytes for text files); parse JSON response; return `{"category": ..., "confidence": 0.0–1.0}`
- `classify_cloud(file_path: Path) -> dict`: Anthropic SDK call with same structured prompt
- `classify(file_path: Path, conn)`: try `classify_local` first; if it raises or returns `confidence < AUTO_SORT_CONFIDENCE_THRESHOLD`, fall back to `classify_cloud`; update `files.category` and `files.confidence`; graceful degradation: if both fail, set `category="Unclassified"`, `confidence=0.0`

**Dependencies:** Phase 1.

**Test criteria:**
- `auto_tag` marks a 200 MB file as `large-file`; marks two files with identical hashes as `duplicate`
- Mock Ollama returns correct JSON → `classify_local` parses it
- Mock Ollama fails → `classify` falls back to cloud
- Category and confidence written to `files` table

**Estimated sessions:** 3–4

---

## Phase 3 — FastAPI Backend + Operations Log

**Goal:** Expose Phase 1 + 2 functionality via REST API; implement operations_log read/write; stub all remaining endpoints from HANDOFF.md §7.2.

**Files:** `backend/api.py`, `backend/operations_log.py`, `tests/test_operations_log.py`

**Key implementation details:**
- `log_operation(op_type, source_path, dest_path, batch_id, reason, conn) -> int`: INSERT row with `executed=0`; return inserted `id`
- `mark_executed(op_id, conn)`: UPDATE `executed=1`
- `undo_operation(op_id, conn)`: read row; reverse the op (e.g. move `dest→src`); set `undone=1`
- `undo_batch(batch_id, conn)`: fetch all ops ordered `id DESC`; undo each in order
- FastAPI startup: call `init_db()`; launch watcher if configured
- Route stubs for every endpoint in §7.2: return `{"status":"not_implemented"}` for unbuilt ones
- Implemented routes: `GET /health`, `GET /files` (filters: path, tag, category, q), `GET /files/{id}`, `POST /index/scan`, `GET /tags`, `POST /files/{id}/tags`, `DELETE /files/{id}/tags/{tag_id}`, `GET /history`, `POST /undo/{op_id}`, `POST /undo/batch/{batch_id}`

**Dependencies:** Phases 1, 2.

**Test criteria:**
- `curl http://localhost:9876/health` returns `{"status":"ok"}`
- `POST /index/scan` with sandbox path triggers a scan; `GET /files` returns results
- `curl` each endpoint; verify JSON shape and status codes

**Estimated sessions:** 3

---

## Phase 4 — Frontend Shell + Chrome (Design Tokens v2)

**Goal:** Electron window with frameless custom titlebar, sidebar / content / Inspector three-pane layout, top toolbar with Approvals pill, bottom status bar, theme toggle. All CSS vars from design tokens v2. All chrome compositions per HANDOFF.md §6.6.

**Files:** `frontend/main.js`, `frontend/preload.js`, `frontend/index.html`, `frontend/src/app.js`, `frontend/src/styles.css`

**Key implementation details:**
- Electron: `frame: false`, `BrowserWindow` 1200×800 default, window state persistence
- Custom titlebar (32px): brand mark, title, custom min/max/close buttons per v2 Section 9
- Sidebar (240px / 52px collapsed): Quick Access, Tree, Tags, System sections, bottom anchor; 1px `border-hairline` right seam
- Toolbar (48px): Approvals pill, nav buttons, breadcrumb, search field (concave chrome), view mode segmented control
- Status bar (24px): bg-chrome, 1px `border-hairline` top, file count / task indicator / Review Bin pill
- Every `data-action` attribute calls through `src/actions.js`
- Run Section 41 audit checklist before marking phase complete

**Dependencies:** Phase 3 (needs API available).

**Test criteria:**
- `npm start` opens window; layout renders correctly
- Backend status indicator shows green when `python -m backend.api` is running
- Sidebar collapse/expand works; Approvals pill visible; status bar visible
- Section 41 audit passes (or every failure is explicitly flagged)

**Estimated sessions:** 4–5

---

## Phase 5 — Browser Screen + File Browsing

**Goal:** Sidebar navigation, file list (List + Grid views), Inspector with Preview/Tags/History tabs, preview renderers (image/PDF/text/audio), breadcrumbs, multi-select, right-click context menus, drag-and-drop.

**Files:** `frontend/src/app.js` (Browser view module), `frontend/src/actions.js`

**Key implementation details:**
- `loadDirectory(path)`: `GET /files?path=<path>` → render results in file area
- List view: 26px rows, grid layout per v2 Section 23; file icon (native Windows for branded / Lucide for generic), name, size (JetBrains Mono), modified (JetBrains Mono), tag poker-chip stack
- Grid view: tiles with thumbnail/icon, filename, tag stack
- Row states: default (flat), hover (`bg-raised` + `highlight-top`), selected (`accent-wash` + 2px `accent` left bar), drag-target (`accent-wash-strong` + perimeter border)
- Inspector: opens on first click (jump-cut), stays open, push-style (list compacts to single mono line per row); 340px default, resizable 280–520
- Multi-select: Ctrl+click, Shift+click, marquee drag
- Right-click context menus: file, folder, empty-area variants

**Dependencies:** Phase 4.

**Test criteria:**
- Scan sandbox via API, then `loadDirectory()` renders all files
- Switching view modes re-renders in correct layout
- Clicking a file updates Inspector; Inspector Preview/Tags/History tabs jump-cut

**Estimated sessions:** 5–6

---

## Phase 6 — Everything Folder Watcher + Review Bin

**Goal:** `watchdog` on Everything Folder, full classification pipeline for new files, Review Bin screen (grouped by destination, approval detail panel, "Similar past decisions"), tray popout wired.

**Files:** `backend/watcher.py`, `backend/mover.py`, Review Bin view module in `src/app.js`, `frontend/tray/index.html`, `approvals` table wiring in `api.py`

**Key implementation details:**
- `FilePlusEventHandler` extends `watchdog.events.FileSystemEventHandler`; `on_created`: `index_file` → `classify` → `auto_tag`; `on_moved`: update `path` in DB, log in `operations_log`
- `move_file(src, dest, reason, batch_id, conn)`: `path_guard(src)` + `path_guard(dest)` + `log_operation(executed=0)` + `shutil.copy2` then `os.remove` (atomic, never cut-paste) + `mark_executed`
- Review Bin: two-pane layout; groups by `approvals.proposed_dest`; detail pane shows confidence, AI reason, "Similar past decisions" from `training_signals`
- Tray popout (`frontend/tray/index.html`): 380px × 500–600px, state dots per state-dot system, action buttons at exactly 16×16 icon size
- Batch approve endpoint: `POST /review/batch-approve`

**Dependencies:** Phases 2, 3, 5.

**Test criteria:**
- Drop 20 files into Everything Folder; verify classification queue populates DB
- Approve some, override some, defer some; verify DB `approvals.resolution` state
- `move_file` writes `operations_log` row before moving; file exists at dest after; DB `files.path` updated

**Estimated sessions:** 5–6

---

## Phase 7 — Scan Pipeline (Config, Progress, Results)

**Goal:** Tie indexer + hasher + tagger + classifier + dedup together as a single background scan. Three-screen scan flow. Reorganization proposal as read-only tree in Results.

**Files:** scan orchestrator (in `api.py` or new `scanner.py`), three scan view modules in `src/app.js`

**Key implementation details:**
- Multi-pass: (1) index all files, (2) hash + dedup, (3) classify unclassified, (4) auto-tag, (5) generate folder proposals
- Progress: stream via `GET /scan/status` (SSE or polling); phases: indexing / hashing / classifying / proposing / review
- Proposals format: `[{source, dest, reason, confidence}]` — `GET /organize/propose`
- User must POST `/organize/execute` with `{approved_moves: [...]}` — nothing moves without this
- Scan Config screen: conversational mode (chat with AI, per design brief A.5) and structured form mode fallback
- Results screen: Duplicates tab, Cleanup tab, Reorganization tab (CTA → File Tree canvas proposal mode)

**Dependencies:** Phases 1, 2, 3.

**Test criteria:**
- Full scan on 100-file sandbox completes without errors
- Proposals JSON is valid; all dest paths are inside sandbox
- `POST /organize/execute` moves files; all moves in `operations_log`

**Estimated sessions:** 4–5

---

## Phase 8 — File Tree Canvas + Tag Canvas

**Goal:** Spatial tree viewer (live / snapshot / comparison modes), snapshot creation + restore, Tag Canvas graph overlay with right-click tag management.

**Files:** `backend/snapshotter.py`, File Tree canvas module, Tag Canvas overlay module in `src/app.js`

**Key implementation details:**
- `create_snapshot(label, trigger, conn) -> int`: serialize current `files` tree to JSON; INSERT into `snapshots`; log to `operations_log` before writing
- `restore_snapshot(snapshot_id, conn)`: read `tree_json`; for each path diff, call `move_file`; wrap in a single `batch_id`
- Canvas: three modes with banners (live / snapshot-view / proposal-review); node chrome per v2 Section 35
- Live mode: drag-to-reparent → snackbar with undo; inline rename (F2); right-click context menu
- Snapshot mode: "Where is it now?" lookup; restore confirmation modal with typed "RESTORE" input
- Snapshots panel (right rail): list newest-first, right-click actions
- Tag Canvas overlay (820×540): graph SVG with tag relationship arrows; right-click tag node → rename/merge/delete

**Dependencies:** Phase 7 (for pre-scan snapshots), Phase 6 (for snapshot-restore conflict handling).

**Test criteria:**
- Create snapshot → modify sandbox → restore snapshot → verify all changes reverted
- `operations_log` reflects restore as a new batch of moves
- Tag Canvas renders tags from DB; right-click rename updates `tags.name`

**Estimated sessions:** 4

---

## Phase 9 — Command Palette + Onboarding

**Goal:** Ctrl+K palette with Files/Tags/Commands/chat modes; 5-step first-run onboarding flow.

**Files:** Palette overlay module, onboarding module in `src/app.js`; `frontend/setup/index.html` (standalone onboarding window)

**Key implementation details:**
- Palette (640px, `shadow-modal`): four modes; search mode hits `GET /search?q=`; chat mode calls Claude API, returns structured plan, "Send to Review Bin" drops result into `approvals`
- Chat-mode auto-detect: switch from search to chat mode when input contains a verb-phrase sentence
- Onboarding: 5 steps — welcome, Everything Folder location, browser redirect toggles, conversational scan config (chat interface), AI setup (Ollama check + optional API key); replaces shell until complete; per design brief A.13

**Dependencies:** Phases 3, 5, 6.

**Test criteria:**
- Palette searches files and tags; results render; keyboard navigation works
- Chat mode returns a plan; "Send to Review Bin" creates entries in `approvals` table
- Onboarding completes end-to-end from fresh state; settings written to `.env` or DB config

**Estimated sessions:** 3

---

## Phase 10 — Empty/Error States + Edge Cases + Undo Polish

**Goal:** Every empty state from the design brief wired; every error state wired; all 20 edge cases from HANDOFF.md §9.1 implemented; undo/redo keyboard shortcuts; batch undo UI; atomic move guarantee validated.

**Files:** scattered across modules; a pass over every view in `src/app.js`, `api.py`, `mover.py`

**Key implementation details:**
- Empty states (per v2 Section 29): Home Recent, Home Favorites, Browser empty folder, Review Bin, File Tree no snapshots, Search no results, Tag Canvas no tags, Everything Folder empty, Tray popout empty
- Error states (per design brief A.16): full-width inline banner, `bad-wash` + `bad-edge` + `highlight-top`; dismiss button
- Undo: `Ctrl+Z` in main window calls `POST /undo/{op_id}` for last op; batch undo for scan reorg
- Crash recovery: on launch, detect `executed=0` rows in `operations_log`; modal offering complete or undo
- Edge case highlights: second-instance detection (focus first, exit second); disk-full auto-pause; pinned-folder safety (`is_pinned=1` blocks AI moves); paste name-conflict modal (Replace/Skip/Keep both/Cancel)
- Run Section 41 audit across entire app; deliberately trigger each edge case; verify correct behavior

**Dependencies:** all prior phases.

**Test criteria:**
- `pytest tests/` passes across all test files
- Section 41 audit passes
- All 20 edge cases from HANDOFF.md §9.1 verified against the sandbox

**Estimated sessions:** 4–5

---

## Phase 11 — Packaging and Distribution *(v2)*

> Deferred to v2. Manual install is fine for the personal + small-friend-group v1 release.

**Goal:** Produce a single installable Windows package.

**Planned approach:**
- Backend: PyInstaller `--onefile` to bundle Python + dependencies into `fileplus-backend.exe`
- Frontend: `electron-builder` with `target: "nsis"` for Windows installer; app launches bundled backend as child process, polls `/health`, then loads `index.html`
- Ship a default `.env` baked in, or first-launch setup wizard
- NSIS installer: Start Menu shortcut, Windows app registration
- Code-sign the `.exe` to avoid SmartScreen warnings
- Test in a clean VM (no Python, no Node) before distributing

**Notes:**
- CI/CD: GitHub Actions workflow building on push to `main`
- Consider bundling Ollama + model in v3 for true zero-install experience

---

*Plan version: bootstrapped from HANDOFF.md — 2026-04-24*
