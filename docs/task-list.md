# FilePlus — Task List & Build Roadmap

Last updated: 2026-04-24

---

## Current state

- **Backend:** Phase 1 complete. `config.py`, `database.py`, `hasher.py`, `indexer.py` are real implementations. `tagger.py`, `classifier.py`, `watcher.py`, `mover.py` are stubs. `api.py` has working `/health`, `POST /scan`, `GET /files`, `GET /files/{id}`, `GET /tags`.
- **Frontend:** Global chrome done (titlebar, tab bar, sidebar, toolbar, status bar). Home screen (3 sub-tabs) done. Browser screen (file list + inspector shell) done. All other screens are HTML stubs. Zero real data wired except scan → file list.
- **Integration:** `POST /scan` calls the indexer and returns count. `GET /files` queries the DB. Browser screen renders real rows from the API. Inspector opens on row click.
- **Tests:** 18/18 passing (indexer + hasher + config). No tests for API or frontend.
- **Bugs fixed today:** (1) Duplicate `const API_BASE` declaration between `actions.js` and `app.js` caused a SyntaxError that prevented all event listeners from attaching — nothing was clickable. (2) CSP `connect-src` only allowed port 8400, blocking all fetch() calls to the backend on port 9876.

---

## Steps summary

- Manually test all navigation buttons, tabs, sidebar, and keyboard shortcuts after the bug fixes
- Set up a real test sandbox with varied sample files
- Add a scan trigger button to the UI so scans can be run without the terminal
- Implement tagger.py (rule-based system tags — no AI)
- Implement classifier.py (Ollama local + Claude cloud fallback)
- Wire the Inspector pane with real file data (preview, tags, history)
- Implement Settings screen persistence
- Implement the Everything Folder watcher (watchdog)
- Build the Review Bin screen with real approval queue data
- Build mover.py and operations_log.py with undo support
- Build the File Tree canvas with snapshot creation and restore
- Build the Command Palette search mode against real indexed files
- Build the Onboarding / Setup wizard
- Implement all empty states, error states, and the 20 edge cases from the design brief
- Run Section 41 audit across the full app
- Package for distribution (PyInstaller + electron-builder NSIS installer)

---

## Full task list

### Environment and tooling

- [ ] Confirm `npm install` has been run in `frontend/` and Electron launches cleanly (`npm start`)
- [ ] Start Python backend each session (`python -m backend.api`) and verify `/health` returns `{"status":"ok"}` before testing
- [ ] Create `C:\FilePlusTestSandbox\` with a realistic variety of files: images, PDFs, text files, code files, duplicates, a large file, hidden files — at least 50 items
- [ ] Decide on hot-reload strategy for frontend dev: F5 reload in DevTools or a watcher that calls `mainWindow.webContents.reload()`
- [ ] Keep DevTools (F12) Console open during every session — JS errors will surface there immediately

### Basic navigation (testable now)

- [ ] Test every sidebar item: Home, Review Bin, drive items, Tags section, File Tree, Scan, Everything Folder, Settings
- [ ] Test tab bar: switch tabs, close tab, open new tab, Ctrl+T, Ctrl+W, Ctrl+Shift+T
- [ ] Test window controls: minimize, maximize, close
- [ ] Test toolbar: theme toggle, inspector toggle, view mode list/grid
- [ ] Test keyboard shortcuts: Ctrl+K (palette), Ctrl+B (sidebar), Ctrl+I (inspector), Escape (close overlays)
- [ ] Confirm stub toasts appear for unimplemented actions (confirms click was registered)
- [ ] Test sidebar collapse/expand
- [ ] Test Home screen sub-tabs: Recent, Favorites (Shared is disabled by design)

### Scan and file display

- [ ] Add a `data-action="scan"` button somewhere accessible in the UI (toolbar or sidebar System section)
- [ ] After scan, confirm Browser screen renders real file rows with correct filename, size, modified date
- [ ] Confirm clicking a file row opens the Inspector and shows filename/path
- [ ] Fix grid view CSS for dynamically rendered rows (list view works; grid needs tile layout applied to injected rows)
- [ ] Add client-side column sort to the list header (name, size, modified)
- [ ] Wire view mode toggle so grid renders tiles, not list rows

### Backend: tagger.py

- [ ] Implement `auto_tag(file_id, conn)`: extension-based system tags (`image`, `video`, `audio`, `document`, `code`, `archive`); `large-file` if size > 100 MB; `duplicate` if hash matches another row
- [ ] Implement `apply_tags(file_id, tags, conn)`: insert into `tags` and `file_tags`
- [ ] Implement `get_tags(file_id, conn)`: join query returning tag name, color, type
- [ ] Wire `auto_tag` into `scan_directory` so every indexed file gets system tags automatically
- [ ] Add `GET /files/{id}/tags` endpoint
- [ ] Render tag chips on file rows in the Browser screen (`.fp-row__tags` div already in the row HTML)
- [ ] Write `tests/test_tagger.py`: extension grouping, large-file threshold, duplicate detection

### Backend: classifier.py

- [ ] Implement `classify_local(file_path)`: POST to Ollama with filename, extension, size, first 512 bytes of text files; parse JSON; return `{category, confidence}`
- [ ] Implement `classify_cloud(file_path)`: Anthropic SDK call with same prompt; use prompt caching
- [ ] Implement `classify(file_path, conn)`: try local → fall back to cloud if confidence < threshold or error; if both fail set `category="Unclassified"`, `confidence=0.0`; write to `files` table
- [ ] Wire classifier into scan pipeline after `auto_tag`
- [ ] Mock Ollama in tests (test suite must not require a live Ollama)
- [ ] Validate API key from `.env` before first cloud call; surface error if missing

### API: remaining endpoints

- [ ] `POST /scan` — add SSE progress stream (`?async=true`) for large directories (current sync version blocks until done)
- [ ] `DELETE /files/{id}/tags/{tag_id}` — for tag removal from Inspector
- [ ] `GET /history` — return `operations_log` rows
- [ ] `GET /scan/status` — SSE stream for scan phase progress (indexing / hashing / classifying / proposing)
- [ ] `GET /search?q=` — full-text search across filenames, paths, categories, tags
- [ ] `GET /drives` — list drives with used/total space for sidebar drive section
- [ ] `GET /review-bin/count` — integer count of pending approvals for status bar badge

### Inspector pane

- [ ] `Preview` tab: detect type and render — images get `<img>`, text/code gets `<pre>` with first 4 KB, PDFs show metadata, everything else shows file info
- [ ] `Tags` tab: fetch `GET /files/{id}/tags`, render chips with remove button, add "Add tag" input
- [ ] `History` tab: fetch operations log for this file path, render as timeline
- [ ] "Open" button: wire through IPC — `preload.js` exposes `shell.openPath()`, `main.js` handles it
- [ ] "Reveal in Explorer": wire `shell.showItemInFolder()` through IPC

### Settings screen

- [ ] Decide persistence strategy: SQLite config table (recommended — keeps everything in one DB) vs `electron-store`
- [ ] Wire every `settings-toggle` to read/write the config table
- [ ] Theme, density, accent — already in localStorage via `restoreSettings()`; confirm they survive app restarts
- [ ] Ollama model selection: write to config, pass to `classify_local()`
- [ ] API key field: write to config (encrypted if possible, never logged)
- [ ] Everything Folder path: native directory picker — add `dialog.showOpenDialog` IPC channel to `preload.js` and `main.js`
- [ ] Fix Settings screen init: only the active pane should be visible; call `switchSettingsPane('general')` on navigate to Settings

### Everything Folder watcher

- [ ] Implement `watcher.py`: `FilePlusEventHandler` extends `watchdog.FileSystemEventHandler`; `on_created` → `index_file` → `classify` → `auto_tag` → insert `approvals` row if confidence < threshold
- [ ] `on_moved` → update `files.path` in DB, log to `operations_log`
- [ ] `start_watcher(path)` / `stop_watcher()` — manage watchdog Observer lifecycle
- [ ] Call `start_watcher` from FastAPI lifespan startup if Everything Folder path is configured
- [ ] Add `GET /ef/status` and `POST /ef/pause` endpoints
- [ ] Wire tray popout to show live pending file count

### Review Bin screen

- [ ] Implement `GET /review-bin` — pending `approvals` rows joined with `files`
- [ ] Implement `GET /review-bin/count` — integer for status bar badge
- [ ] Implement `POST /review-bin/{id}/approve` — call `move_file()`, mark resolved
- [ ] Implement `POST /review-bin/{id}/reject` — mark rejected, keep file in place
- [ ] Implement `POST /review-bin/group/{dest}/approve-all` — batch approve
- [ ] Wire Review Bin screen to load from API on navigate; refresh count badge after each action
- [ ] "Similar past decisions" panel: query `training_signals` for matching extension/category

### mover.py and operations_log.py

- [ ] Implement `operations_log.py`: `log_operation()`, `mark_executed()`, `undo_operation()`, `undo_batch()`
- [ ] Implement `move_file(src, dest, reason, batch_id, conn)`: `path_guard` both → `log_operation(executed=0)` → `shutil.copy2` → `os.remove` → `mark_executed`; if copy fails, rollback log entry
- [ ] Wire `POST /operations/{id}/undo` and `POST /operations/batch/{id}/undo` in `api.py`
- [ ] Wire Ctrl+Z in `app.js` to fetch last operation then call undo
- [ ] On app startup, check for `executed=0` rows; show crash recovery modal if found
- [ ] Write `tests/test_mover.py` and `tests/test_operations_log.py`

### File Tree canvas

- [ ] Implement `snapshotter.py`: `create_snapshot(label, trigger, conn)` — serialize `files` tree to JSON, INSERT into `snapshots`; `restore_snapshot(id, conn)` — diff snapshot vs current, generate move list, call `batch_move`; `list_snapshots()`, `compare_snapshots(id1, id2)`
- [ ] Wire canvas mode banners (live / snapshot-view / proposal-review) — HTML already exists, JS just needs to toggle them
- [ ] `GET /tree/live` — return folder hierarchy for canvas rendering
- [ ] Canvas node rendering: scrollable tree of folder nodes
- [ ] Drag-to-reparent: POST `/proposals/move` → enters proposal-review mode
- [ ] Inline rename: F2 → contenteditable → `POST /fs/rename`
- [ ] Snapshot list panel: fetch `GET /snapshots`, render, right-click actions
- [ ] Write `tests/test_snapshotter.py`

### Command Palette

- [ ] Search mode: on keystroke call `GET /search?q=` and render results grouped by files / tags / commands
- [ ] Chat mode: stream Claude API response given user query + context (recent files, current directory)
- [ ] "Send to Review Bin" from chat: parse structured plan from Claude, create `approvals` rows
- [ ] Keyboard navigation: arrow keys, Enter to execute, Escape to close

### Onboarding / Setup wizard

- [ ] Build 5-step setup window (`frontend/setup/`): welcome, Everything Folder picker, browser redirect toggles, conversational scan config, AI setup
- [ ] On first launch, check `setup_complete` config flag; if unset, open setup window instead of main window
- [ ] After setup completes, close setup window, open main window, write `setup_complete = true`

### Empty states and error states

- [ ] Home / Recent: empty state when no recent files
- [ ] Browser: empty state when directory has no indexed files
- [ ] Review Bin: empty state when no pending approvals
- [ ] Everything Folder: empty state when not configured or nothing pending
- [ ] Tag Canvas: empty state when no tags exist
- [ ] Search: empty state when no results
- [ ] Error banner (`fp-error-banner`) for: backend offline, scan failure, file operation failure
- [ ] Confirm status bar backend dot changes color correctly when backend is offline

### Edge cases

- [ ] Second instance detection: `app.requestSingleInstanceLock()` in `main.js` — focus first instance, quit second
- [ ] Disk-full auto-pause: check available space before any move; pause + warn if < 500 MB
- [ ] Pinned folder safety: `files.is_pinned = 1` blocks AI move proposals in `mover.py`
- [ ] Paste name-conflict modal: when destination already has same filename, show Replace / Skip / Keep both / Cancel
- [ ] Scan already running: `POST /scan` returns 409 if scan in progress; show toast "Scan already running"
- [ ] External folder missing on navigation: catch 404/ENOENT from file listing, show error banner
- [ ] Inspector on externally-deleted file: show preview fail state
- [ ] Files added to Everything Folder while tray closed: update count badge on next tray open

### Code quality

- [ ] Run `/ultrareview` on each major phase before merging
- [ ] Run `pytest` after every backend change; add pre-commit hook or CI step
- [ ] Add `pytest-cov`; keep backend coverage above 80%
- [ ] Check DevTools Console after every frontend change before marking done
- [ ] Run Section 41 audit (from `docs/design-tokens.md`) after every UI phase

### Performance

- [ ] Add pagination to `GET /files` — `?limit=` and `?offset=` for large directories
- [ ] Add SQLite index on `files.path` if not already present
- [ ] Move scan to a background task so the API doesn't block during large directory scans
- [ ] Audit every backend function that touches the filesystem to confirm `path_guard()` is called

### Packaging (final step)

- [ ] PyInstaller: bundle backend into `fileplus-backend.exe`; test without Python installed
- [ ] Configure `electron-builder.yml` for Windows NSIS installer
- [ ] Main process: on startup, spawn `fileplus-backend.exe`, poll `/health`, load `index.html` only when ready
- [ ] Write a default `.env` on first launch if one doesn't exist
- [ ] Test full installer in a clean Windows VM with no Python and no Node
