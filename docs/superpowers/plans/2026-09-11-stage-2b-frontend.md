# Stage 2B — Frontend Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Electron renderer becomes a real explorer on top of the Stage 2A API: real drives and pins in the sidebar, live browsing of any path, selection and keyboard navigation, every file operation (new, rename, move, copy, trash) with undo/redo and conflict handling, a real Inspector, real Home Recent/Favorites, palette search, persisted settings, crash-recovery modal, and an end-to-end smoke test that renames a file through the UI and undoes it.

**Architecture:** `actions.js` is deleted (S2-1); the `switch` in `app.js` stays the single dispatcher. New classic-script modules split the renderer by responsibility: `api.js` (fetch wrappers), `browser.js` (listing, navigation, selection, sort, rename, drag/drop), `fileops.js` (clipboard intent, mutations, undo/redo stacks, snackbars, conflict modal), `inspector.js`, `home.js`, `settings.js`. All are globals loaded in a fixed order before `app.js`; no build step. Every mutation goes through the API; the renderer never touches Node.

**Tech Stack:** Plain HTML/CSS/JS in `frontend/`, Electron 41 bridge (`window.electronAPI`), Stage 2A routes on `http://127.0.0.1:9876`, Playwright smoke test, `scripts/verify.ps1`.

**Spec:** `docs/superpowers/specs/2026-09-11-stage-2-explorer-parity-design.md` §6 (behaviour), §7 (structure), §8 (verification), §10 (graduation). API contracts: `docs/superpowers/runs/2026-09-11-stage-2a.md` "API surface" and `backend/api.py`.

## Global Constraints

- Work in the worktree `C:\Dev\FilePlus\.worktrees\stage-2b-frontend` on branch `stage/2b-frontend` (created by the controller from `master` after 2A merged; `frontend/node_modules` installed). Never touch `C:\Dev\FilePlus` itself.
- Verify gate from the worktree root: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` — green before every commit (154 pytest, contrast ok, smoke passing, 13+ screenshots). The smoke test's zero-console-error rule is the load-order guard for the new modules.
- **No visual redesign** (Stage 1 is done): reuse existing classes and tokens; new markup uses existing `fp-*` components. No layout or sizing changes.
- **Real data or nothing**: no new placeholder content; placeholder screens get the banner in Task 7.
- The renderer talks to the backend with `fetch()` only and to the OS only through `window.electronAPI` (`openPath`, `showItemInFolder`, `openWith`, `pickFolder`, `clipboardWriteText`, plus the existing window/zoom/theme/mica methods).
- Notifications gate: every snackbar/toast goes through the existing `showSnackbar`/`showToast` in `app.js` (gated by `fp-notifications-enabled`; only `'error'` bypasses). Never bypass it.
- `WRITE_UNLOCKED` stays false during the run; every write in the smoke test happens under `FilePlusTestSandbox\_gen`.
- Commit with `git -c core.safecrlf=false commit`; every message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (the trailer names the directing session; do not substitute another model name; if unwilling, omit it and say so).

---

## File Structure

| Path | Responsibility | Task |
|---|---|---|
| `frontend/src/api.js` (new) | `API.get/post/patch/del`, `ApiError`, `formatApiError` | 1 |
| `frontend/src/browser.js` (new) | `browserState`, `loadDirectory`, rendering, sort, selection, keyboard, inline rename, drag/drop | 1 (move), 3, 4 |
| `frontend/src/fileops.js` (new) | clipboard intent, `runMutation`, undo/redo stacks, conflict modal, crash-recovery modal | 4 |
| `frontend/src/inspector.js` (new) | Inspector meta/preview/tags/history/multi | 5 |
| `frontend/src/home.js` (new) | Recent, Favorites, `unfavoriteFile` (moved from actions.js), hover actions, reorder | 6 |
| `frontend/src/settings.js` (new) | config sync, personalization toggles, Data pane, placeholder banners | 7 |
| `frontend/src/app.js` | shell, tabs, screens, dispatch switch (cases added per task), init sequence | all |
| `frontend/index.html` | script tags order; sidebar drives/pins containers; inspector tag input; Data pane rows; banner markup | 1, 2, 5, 7 |
| `frontend/src/actions.js` | **deleted** | 1 |
| `frontend/test/smoke.spec.js` | e2e additions | 8 |
| `CLAUDE.md`, `docs/backend-integration.md`, `docs/superpowers/runs/<date>-stage-2b.md` | docs | 8 |

---

### Task 0: Guard hardening and request authentication (before graduation)

**Files:**
- Modify: `backend/config.py` (`_canonicalize`, `path_guard`), `backend/api.py` (auth dependency, CORS), `frontend/main.js` (token generation), `frontend/preload.js` (`apiToken()`), `frontend/src/app.js`/`api.js` (send the header), `tests/conftest.py`, `tests/test_indexer.py`, `tests/test_path_guard.py`, `tests/test_api_auth.py` (new), `docs/superpowers/runs/2026-09-11-stage-2a.md` (counts 166, `ValueError -> 400` line)

**Why:** the Stage 2A whole-branch audit parked four items that must land before `WRITE_UNLOCKED=true`: (1) the drive-relative/relative refusal in `path_guard` is dead code (`Path.resolve()` absolutises first); (2) loopback admin-share UNC spellings (`\\localhost\C$\Windows\x`, `\\127.0.0.1\C$\…`, `\\<COMPUTERNAME>\C$\…`) resolve to UNC form and bypass `SYSTEM_WRITE_ROOTS` string containment when unlocked; (3) CORS `*` with no auth lets any web page in any browser call the mutating API on localhost; (4) `ValueError → 400` also catches corrupt-row parse errors.

**Interfaces:**
- `config._canonicalize`: before resolving, `p = Path(path)`; if `not p.is_absolute() or not p.drive and not str(p).startswith("\\\\")` → `BadPathError`; after resolving, if the result is UNC (`str(resolved).startswith("\\\\")`) and its host is `localhost`, `127.0.0.1`, `::1` or `os.environ["COMPUTERNAME"]` (case-insensitive) and the share matches `[A-Za-z]\$` → map to the local drive path (`\\localhost\C$\Windows\x` → `C:\Windows\x`) and re-resolve; a new `class BadPathError(ValueError)` replaces the generic `ValueError` raises and the API maps `BadPathError` → 400 (remove the broad `ValueError` handler).
- Auth: `main.js` generates `crypto.randomBytes(32).toString('hex')` at startup, passes it to the backend process environment as `FILEPLUS_API_TOKEN` when it spawns the backend (Stage 5 packaging) — for now the dev flow is: `main.js` reads `FILEPLUS_API_TOKEN` from its own environment or `.env` (via a tiny parser of `frontend/../.env`, key only) and exposes it through `preload.js` as `electronAPI.apiToken()`; the backend requires header `X-FilePlus-Token` equal to `config.FILEPLUS_API_TOKEN` on every route except `/health` when the env var is set; when it is unset (tests, first run) the dependency is a no-op and `/health` reports `auth: false`. `api.js` attaches the header to every request. CORS: `allow_origins=["null", "file://"]` is not usable for Electron `file://` pages (origin is `null`); keep `*` for origins but rely on the token, and restrict `allow_methods` to the set the app uses.
- Tests: `test_path_guard.py` parametrised over `C:foo`, `foo`, `\\localhost\C$\Windows\x`, `\\127.0.0.1\C$\Windows\x` (with `SYSTEM_WRITE_ROOTS=[C:\Windows]` monkeypatched) → refused in write mode when unlocked; `test_api_auth.py`: with `FILEPLUS_API_TOKEN` monkeypatched to `"t"`, a request without the header → 401, with it → 200, `/health` always 200. `test_indexer.py:56-67` stop using real `C:\Windows`; add a test asserting the default `SYSTEM_WRITE_ROOTS`/`PROTECTED_WRITE_ROOTS` contents.
- verify.ps1: set `$env:FILEPLUS_API_TOKEN` to a fixed dev value before starting the backend and pass it to the smoke test through the same environment (the smoke test reads `process.env.FILEPLUS_API_TOKEN` for its own `/health` fetch; the renderer gets it via preload).

- [ ] Steps: TDD the guard changes → the auth dependency → the bridge/header plumbing → verify → commit `fix(guard,auth): absolute-input check, loopback admin-share mapping, API token, narrower 400 mapping`.

---

### Task 1: Module split and `actions.js` removal (no behaviour change)

**Files:**
- Create: `frontend/src/api.js`, `frontend/src/browser.js`, `frontend/src/fileops.js`, `frontend/src/inspector.js`, `frontend/src/home.js`, `frontend/src/settings.js`
- Modify: `frontend/index.html` (script tags), `frontend/src/app.js` (move code out; keep dispatch)
- Delete: `frontend/src/actions.js`

**Interfaces:**
- `api.js`:
```js
class ApiError extends Error { constructor(status, detail) { super(detail || `HTTP ${status}`); this.status = status; this.detail = detail; } }
const API = {
  base: 'http://127.0.0.1:9876',
  async request(method, path, { params, body } = {}) {
    const url = new URL(this.base + path);
    if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    if (!res.ok) throw new ApiError(res.status, data && data.detail ? data.detail : res.statusText);
    return data;
  },
  get(path, params) { return this.request('GET', path, { params }); },
  post(path, body) { return this.request('POST', path, { body }); },
  patch(path, body) { return this.request('PATCH', path, { body }); },
  del(path, params) { return this.request('DELETE', path, { params }); },
};
function formatApiError(err) { return err instanceof ApiError ? err.detail : (err && err.message) || String(err); }
```
- Script order in `index.html` (all before `app.js`): `src/api.js`, `src/fileops.js`, `src/browser.js`, `src/inspector.js`, `src/home.js`, `src/settings.js`, then `src/app.js`.
- Moved without change from `app.js`: `loadDirectory`, `pushHistory`, `navBack`, `navForward`, `navUp`, `fetchAndRender`, `refreshNavButtons`, `renderDirectory`, `renderFsRow`, `renderEmptyFolder`, `updateAddressBar`, `updateBreadcrumb`, `showErrorBanner`, `iconForExt`, `formatSize`, `formatModified`, `escapeHtml`, `ICON_FILE`, `ICON_FOLDER`, `setViewMode`, `initColumnSort`, `initMarqueeSelection` → `browser.js`; `updateInspector`, `switchInspectorTab`, `toggleInspector`, `initResizer` → `inspector.js`; `unfavoriteFile` (from `actions.js`) and `pruneEmptyHomeSections` → `home.js`; `switchSettingsPane`, `applyDensity`, accent functions, `restoreSettings` → `settings.js`. `app.js` keeps everything else (shell, tabs, screens, palette, modal, theme, snackbar/toast, context-menu machinery, zoom, keyboard, dispatch, init).

- [ ] **Step 1: Create the six modules** — `api.js` with the code above; the others initially contain only the moved functions (cut/paste, byte-identical bodies) plus a header comment naming the module's responsibility.
- [ ] **Step 2: Delete `actions.js`; update `index.html`** script tags; remove the `apiFetch`/`stub` references: grep `stub(` and `apiFetch(` across `frontend/src` → both must be 0 after the move (the `stub()` toast for unhandled actions is replaced by the `default:` branch in `app.js`'s switch, which already shows a toast for actions not in `IN_SCOPE_ACTIONS`).
- [ ] **Step 3: Verify** → all green, zero console errors (this proves load order). `npm start` sanity: Home, Browser, Settings still behave as before.
- [ ] **Step 4: Commit** — `refactor(frontend): split app.js into api/browser/fileops/inspector/home/settings modules; delete dead actions.js`.

---

### Task 2: Sidebar — real drives, pins, Downloads; listing options

**Files:**
- Modify: `frontend/index.html` (replace the two hardcoded drive items with `<div id="sb-drives"></div>`; pinned container `#sb-pinned-folders` already exists; Downloads item reads its path at runtime), `frontend/src/browser.js` (`showHidden`, drive-root breadcrumb), `frontend/src/app.js` (init + dispatch cases), `frontend/src/settings.js` (config cache)

**Interfaces:**
- `loadDrives()` → `GET /drives` → renders one `.fp-sidebar__drive-item` per drive with the existing markup (letter, label `"<letter> <label>"` or `"<letter> Drive"`, usage bar width `used/total`, `title` "X GB / Y GB used"); `data-path` = `mount`.
- `loadPins()` → `GET /pins` → renders `.fp-sidebar__item` per pin (`data-action="navigate-path"`, `data-path`, `data-pin-id`); sidebar-item context menu wired: `cm-open-new-tab`, `cm-unpin-sidebar` (`DELETE /pins/{id}`), `cm-rename-sidebar-item` (inline prompt via `openModal` with an input → `PATCH /pins/{id}`), remove `cm-pin-top`/`cm-remove-sidebar` from `CONTEXT_MENUS['sidebar-item']`.
- Downloads: `data-path` set at init from `config['paths.downloads']` or `electronAPI.hostname`-independent default `%USERPROFILE%\Downloads` (ask main: add `ipcMain.on('get-home-dir')` → `os.homedir()`; expose `electronAPI.homeDir()`; this is the one bridge addition allowed in 2B).
- `browserState.showHidden` from config `ui.show_hidden`; `loadDirectory` passes `show_hidden`; breadcrumb for `C:\` shows `C:` as the single crumb; `parent`/`is_root` from the response drive `navUp` (disabled at a root).
- Listing errors: 403 → banner "Access denied: <path>" with "Go back"; 404 → "Folder not found"; `truncated` → banner "Showing the first 10,000 entries".

- [ ] Steps: write the three loaders (`loadDrives`, `loadPins`, `applyDownloadsPath`) in `app.js` init after `checkBackend()`; sidebar-item menu cases; `show_hidden` plumbing; banners; verify; commit `feat(sidebar): real drives, pins with context menu, Downloads path, hidden-file and root handling`.

---

### Task 3: Selection model, keyboard navigation, sort, status bar

**Files:**
- Modify: `frontend/src/browser.js`, `frontend/src/app.js` (keydown handler delegates to browser when the Browser screen is active and no input is focused)

**Interfaces:**
```js
const browserState = { path: null, entries: [], sort: { key: 'name', dir: 'asc' }, selection: new Set(), anchor: null, focus: null, showHidden: false, parent: null, isRoot: false };
function getSelectedPaths() { return [...browserState.selection]; }
function selectRow(path, { ctrl = false, shift = false } = {})  // click semantics; updates classes, anchor, focus, inspector, status bar
function selectAll(); function clearSelection();
function moveFocus(delta | 'home' | 'end', { shift })            // ↑ ↓ Home End
function openFocused()                                           // Enter: folder → loadDirectory; file → electronAPI.openPath
function applySort(key, dir); function sortedEntries()           // name (folders first, natural, case-insensitive), size, modified
function updateStatusBar()                                       // "#status-count": "N items"; "#status-selected": "Nothing selected" | "1 selected" | "N selected · <total size>"
```
- Row click handling replaces `data-action="navigate-path"` on rows: single click selects; double-click (or Enter) opens; `ui.click_mode === 'single'` opens folders on single click.
- Marquee sets `browserState.selection` from intersecting rows; `Ctrl+A` selects all.
- Column header clicks call `applySort` (replace the `INTEGRATION` comment in `initColumnSort`); sort persists per session in `sessionStorage['fp-sort']`.
- Keyboard (Browser screen, no focused input): ↑ ↓ Home End (+Shift extends), Enter, Backspace and Alt+↑ (`navUp`), Alt+← / Alt+→ (history), F5 (`refreshDirectory`), Ctrl+A. F2/Delete/Ctrl+C/X/V/Z/Y are bound in Task 4.

- [ ] Steps: implement; verify; commit `feat(browser): selection model, keyboard navigation, client sort, status bar counts`.

---

### Task 4: File operations, undo/redo, conflicts, drag and drop, crash recovery

**Files:**
- Modify: `frontend/src/fileops.js`, `frontend/src/browser.js` (inline rename, drag/drop), `frontend/src/app.js` (dispatch cases, keyboard, `CONTEXT_MENUS` trimmed), `frontend/index.html` (conflict modal uses the existing `#modal-scrim` with extra buttons: add a hidden `#modal-extra-actions` row)

**Interfaces (`fileops.js`):**
```js
const fileops = {
  clipboard: { mode: null, paths: [] },          // 'copy' | 'cut'
  undoStack: [], redoStack: [],                  // batch ids
  async run(label, fn) {                          // fn: () => Promise<result with batch_id/ops/conflicts/skipped/errors>
    try {
      const res = await fn();
      if (res && res.batch_id && res.ops && res.ops.length) { this.undoStack.push(res.batch_id); this.redoStack.length = 0; }
      if (res && res.errors && res.errors.length) showToast(`${label}: ${res.errors[0].error}`, 'error');
      if (res && res.conflicts && res.conflicts.length) return this.resolveConflicts(label, res, fn);
      if (res && res.ops && res.ops.length) showSnackbar(`${label} (${res.ops.length})`, 'Undo', () => this.undoBatch(res.batch_id));
      await refreshDirectory();
      return res;
    } catch (err) { showToast(`${label} failed: ${formatApiError(err)}`, 'error'); throw err; }
  },
  async undoLast() { const id = this.undoStack.pop(); if (!id) return; await this.undoBatch(id, { fromStack: true }); },
  async undoBatch(id, { fromStack = false } = {}) {
    try { const res = await API.post(`/operations/batch/${id}/undo`); if (res.batch_id) this.redoStack.push(res.batch_id);
      if (!fromStack) this.undoStack = this.undoStack.filter(b => b !== id);
      if (res.errors.length) showToast(`Undo: ${res.errors[0].error}`, 'error'); else showSnackbar('Undone', null, null);
      await refreshDirectory(); } catch (err) { showToast(`Undo failed: ${formatApiError(err)}`, 'error'); }
  },
  async redoLast() { const id = this.redoStack.pop(); if (!id) return;
    try { const res = await API.post(`/operations/batch/${id}/undo`); if (res.batch_id) this.undoStack.push(res.batch_id); await refreshDirectory(); }
    catch (err) { showToast(`Redo failed: ${formatApiError(err)}`, 'error'); } },
  copySelection() { this.clipboard = { mode: 'copy', paths: getSelectedPaths() }; },
  cutSelection()  { this.clipboard = { mode: 'cut',  paths: getSelectedPaths() }; },
  async pasteInto(dir) { const { mode, paths } = this.clipboard; if (!mode || !paths.length) return;
    const route = mode === 'cut' ? '/fs/move' : '/fs/copy';
    await this.run(mode === 'cut' ? 'Moved' : 'Copied', () => API.post(route, { sources: paths, dest: dir, on_conflict: 'fail' }));
    if (mode === 'cut') this.clipboard = { mode: null, paths: [] }; },
  async trashSelection() { const paths = getSelectedPaths(); if (!paths.length) return; await this.run('Deleted', () => API.post('/fs/trash', { paths })); },
  async newFolder(dir) { await this.run('Created folder', () => API.post('/fs/mkdir', { dir, name: 'New folder' })); },
  async newFile(dir)   { await this.run('Created file',   () => API.post('/fs/touch', { dir, name: 'New file.txt' })); },
  async rename(path, newName) { return this.run('Renamed', () => API.post('/fs/rename', { path, new_name: newName })); },
  async moveTo(paths, dir, copy = false) { await this.run(copy ? 'Copied' : 'Moved', () => API.post(copy ? '/fs/copy' : '/fs/move', { sources: paths, dest: dir, on_conflict: 'fail' })); },
  resolveConflicts(label, res, fn) { /* openModal('warn', {title: `${res.conflicts.length} item(s) already exist`, body: names, extra buttons Replace / Skip / Keep both / Cancel}); on choice re-run fn with on_conflict = 'replace'|'skip'|'keep-both' for the conflicting sources only */ },
};
```
- `newFolder`/`newFile` use `keep-both`-style unique names client-side: if the name exists in `browserState.entries`, append ` (2)`, ` (3)`; after creation, select the new row and start inline rename.
- Inline rename (`browser.js`): `startInlineRename(path)` swaps `.fp-row__name` for an `<input class="fp-input fp-row__rename">` prefilled (extension unselected), Enter commits via `fileops.rename`, Esc cancels, blur commits; client-side name validation mirrors the backend rules and shows the error as a toast.
- Drag and drop: rows `draggable="true"`; `dragstart` sets `text/plain` to the selected paths JSON; folder rows and sidebar folder/pin items accept drops (`fp-row--drag-target` class on dragover) → `fileops.moveTo(paths, folder, e.ctrlKey)`.
- Context menu wiring (`app.js` switch): `cm-open` (folder → navigate; file → `electronAPI.openPath`, toast on non-empty error string), `cm-open-with`, `cm-open-new-tab` (open a browser tab at the folder or the file's parent), `cm-reveal-explorer` (`showItemInFolder`), `cm-cut`, `cm-copy`, `cm-paste` / `cm-paste-here`, `cm-rename`, `cm-delete`, `cm-new-folder`, `cm-new-file`, `cm-refresh`, `cm-favorite` (`POST /favorites`), `cm-pin-sidebar` (`POST /pins` then `loadPins()`), `cm-index-folder` (new item on the folder menu: "Index for search" → `POST /index`, toast), `cm-properties` (`openModal` with kind/size/modified/created/hash from `GET /file`), `cm-toggle-hidden` (flips `ui.show_hidden` via settings). Remove from `CONTEXT_MENUS`: `cm-reveal-browser` (file menu; keep for Home rows), `cm-reclassify`, `cm-reclassify-folder`, `cm-compress`, `cm-open-new-window`, `cm-group-type`, `cm-group-none`, `cm-view-list`/`cm-view-grid` stay but call `setViewMode`, `cm-sort-name`/`cm-sort-modified` call `applySort`. Add every wired action to `IN_SCOPE_ACTIONS`. The context-menu target row becomes part of the selection if it was not (right-click on an unselected row selects it alone).
- Keyboard: F2 → rename focused; Delete → `trashSelection`; Ctrl+C/X/V; Ctrl+Z → `fileops.undoLast`; Ctrl+Y and Ctrl+Shift+Z → `redoLast`.
- Crash recovery: at init, `GET /operations/pending`; if non-empty, `openModal('warn', { title: 'Recovered operations', body: <one line per row: op type, source → dest, resolution>, confirmLabel: 'OK' })`.
- Status-bar hint while locked: `/health.write_unlocked === false` → append "writes: sandbox" to `#status-selected`'s right (existing kbd-hints area) with `title` explaining `WRITE_UNLOCKED`.

- [ ] Steps: implement fileops → rename → drag/drop → menus/keyboard → crash modal → lock hint; verify (writes only in `_gen`); commit `feat(fileops): cut/copy/paste/rename/trash/new with undo, redo, conflicts, drag and drop, crash recovery`.

---

### Task 5: Inspector

**Files:**
- Modify: `frontend/src/inspector.js`, `frontend/index.html` (tags pane gains `<input class="fp-input" id="inspector-tag-input" placeholder="Add tag…">` with a `<datalist id="inspector-tag-suggestions">`; history pane gains `<div id="inspector-history"></div>`; preview container `#inspector-preview` gains `<img>`/`<pre>` children on demand), `frontend/src/app.js` (dispatch: `inspector-open`, `inspector-reveal`, `inspector-remove-tag`, `inspector-undo-op`)

**Interfaces:**
```js
async function showInspectorFor(path)     // GET /file → meta rows (Kind, Size, Modified, Created, Hash 'xxh64:abcdef12…1234' title=full) + tags chips; GET /preview → <img src=blob> (fetch as blob) | <pre> text (+ "truncated, N KB total" footer) | "No preview"; GET /files/history → timeline rows with an Undo button when executed && !undone && !error && !op_type.endsWith(':final')
async function showInspectorMulti(paths)  // count, total size from browserState.entries, tag union from GET /file per path (cap 50) with shared tags full-opacity and partial ones at .5
```
- Tags: Enter in the input → `POST /files/{id}/tags {name}`; typing → `GET /tags?q&limit=10` into the datalist; chip `×` → `DELETE /files/{id}/tags/{tag_id}`. Both refresh the chip list; both are undoable via History (they are logged ops).
- Selection → inspector: `selectRow` calls `showInspectorFor` (single) / `showInspectorMulti` (>1) / `updateInspector('none')` (0) — debounce 120 ms.
- Actions row: Open → `openPath`; Reveal → `showItemInFolder`.

- [ ] Steps: implement; verify; commit `feat(inspector): real metadata, preview, tags, history with undo, multi-select aggregate`.

---

### Task 6: Home — Recent and Favorites; palette search

**Files:**
- Modify: `frontend/src/home.js`, `frontend/index.html` (Recent pane and Favorites pane bodies become empty containers `#home-recent` and `#home-favorites` rendered at runtime; keep the section/row markup as a template string in `home.js`), `frontend/src/app.js` (palette search wiring, dispatch: `open-recent-file`, `open-file`, `reveal-file`, `copy-path`, `favorite-reorder` drag handlers, `palette-open-file`, `palette-open-folder`)

**Interfaces:**
- `loadRecent()` → `GET /recent?limit=200` → sections per group in payload order; row: icon by ext, name, parent path, time label per ledger rules (today/yesterday `HH:mm`, this week weekday, month buckets `Mon D`, years `Mon D`, ancient `in YYYY`), hover actions Open (`openPath` + `POST /recent {path, action:'opened'}`), Reveal in Browser (`switchScreen('browser')` + `loadDirectory(parent)` + `selectRow(path)`), Copy path (`clipboardWriteText`). Empty state: the existing `fp-empty` pattern with "No recent files yet".
- Every `loadDirectory` of a folder and every `openPath` from the Browser records `POST /recent` (`'opened'`) for files; folders are not recorded.
- `loadFavorites()` → `GET /favorites` → rows with the star; `unfavoriteFile` now fires `DELETE /favorites?path=` on the 200 ms timer and re-adds via `POST /favorites {path}` + reorder on Undo (ledger A.2.2 option 2); drag reorder → `POST /favorites/reorder {paths}`.
- Palette search mode: input debounced 150 ms → `GET /search?q&limit=30` → items `palette-open-file` (opens the parent folder in the Browser and selects the row) / `palette-open-folder`; keyboard ↑/↓/Enter; empty state "No matches in the index — index folders from the sidebar" when the index is empty.

- [ ] Steps: implement; verify; commit `feat(home,palette): real Recent and Favorites, hover actions, reorder; palette search over the index`.

---

### Task 7: Settings persistence, Data pane, placeholder banners, empty/error states

**Files:**
- Modify: `frontend/src/settings.js`, `frontend/index.html` (Data pane: add rows "Empty FilePlus trash" button and "Writes: sandbox / unlocked" read-only line; a reusable `<div class="fp-banner fp-banner--planned">` template inserted at the top of each placeholder screen), `frontend/src/app.js` (`STUB_SCREENS` → banner instead of toast; dispatch `settings-toggle`, `settings-empty-trash`), `frontend/src/styles.css` (only if `fp-banner--planned` needs a two-line rule reusing existing tokens)

**Interfaces:**
- `loadConfig()` at init → `window.__fpConfig`; `saveSetting(key, value)` → `POST /config`; keys: `ui.theme` (mirror of `applyTheme`), `ui.density`, `ui.accent_hex`, `ui.notifications`, `ui.show_extensions`, `ui.show_hidden`, `ui.click_mode`, `paths.downloads`. localStorage stays the fast-paint cache; config wins on load when both exist.
- `show_extensions` false → `.fp-row__name` renders the stem for files (tooltip shows the full name).
- Data pane: "Empty FilePlus trash" → `openModal('danger', { confirmWord: 'EMPTY', onConfirm: () => API.post('/fs/trash/empty') })` then toast "Sent N batch folders to the Recycle Bin"; "Writes" line from `/health.write_unlocked`.
- Placeholder banners: File Tree, Scan (all three), Review Bin, Everything Folder get "Not built yet — planned for Stage 4" / "Stage 3" text; `STUB_SCREENS` map now holds the stage number; the toast on entry is removed; the placeholder body gets `style="opacity:.5;pointer-events:none"` via a class.
- Browser empty folder and error states already exist (`renderEmptyFolder`, `showErrorBanner`); make the error banner's "Go back" call `navBack()` and add a "Retry" action.

- [ ] Steps: implement; verify; commit `feat(settings): persisted personalization via /config, Data pane trash + write-lock status, planned-stage banners`.

---

### Task 8: End-to-end smoke, gates, docs, run summary

**Files:**
- Modify: `frontend/test/smoke.spec.js`, `CLAUDE.md` (frontend traps: module list and load order; delete the `actions.js` bullet), `docs/backend-integration.md` (mark §A.1–A.3, A.10, A.12.0–1, cross-cutting §17 items done or superseded with one line each — no rewrite), `docs/superpowers/runs/<date>-stage-2b.md`

**Smoke additions (after the dark screen loop, before the light pass):**
```js
    // --- Explorer e2e in the generated sandbox ---
    const gen = await page.evaluate(() => `${window.__fpSandboxRoot || ''}`);
```
Instead of a global, navigate via the API: `const root = (await (await fetch(`${API}/fs/list/root`)).json()).path;` then in the page `await page.evaluate((p) => loadDirectory(p), root + '\\_gen\\Documents');` wait for `.fp-row` count ≥ 10; click the row named `doc-00.txt`; expect `#inspector` to have class `inspector--open` and `#inspector-filename` text `doc-00.txt`; screenshot `browser-selected.png`; right-click the row → expect `#context-menu` visible → screenshot `context-menu.png` → press Escape; press `F2` → type `renamed-by-smoke.txt` → Enter → wait for a row named `renamed-by-smoke.txt` and no row `doc-00.txt`; press `Control+z` → wait for `doc-00.txt` to return; assert `GET /operations?limit=2` shows a `rename` row with `undone == 1` and an inverse with `undo_of` set. Keep zero console errors.
- Gates: `ls frontend/src/actions.js` must fail; `grep -rn "stub(" frontend/src` → 0; `grep -c "showToast(STUB_SCREENS" frontend/src/app.js` → 0; every `cm-*` action present in `CONTEXT_MENUS` has a `case` in the switch (write a 10-line node script that extracts both sets and diffs them; run it in the report).
- Run summary: what landed, skipped, rulings (supplied at dispatch), known debts, "How to review" (switch, verify, `npm start`, walk the graduation steps of spec §10 in the sandbox, then set `WRITE_UNLOCKED=true` at your own pace), merge in two commands.

- [ ] Steps: implement; verify (15+ screenshots); commit `test(smoke): explorer e2e rename+undo; docs: Stage 2B summary and ledger updates`.

---

## Self-review against the spec

- **§6 coverage:** sidebar → T2; Browser + selection + keyboard → T3 (+T2 for roots/hidden); file ops, inline rename, drag/drop, undo/redo, conflicts, crash modal, lock hint → T4; Inspector → T5; Home + palette → T6; Settings, Data pane, banners, empty/error states → T7. **§7:** T1. **§8:** T8 (smoke e2e, gates). **§10** instructions → T8 summary.
- **Placeholders:** none; `<date>` filled at execution.
- **Interface consistency:** `API`/`ApiError`/`formatApiError` (T1) used by T2–T7; `browserState`/`getSelectedPaths`/`refreshDirectory`/`selectRow`/`loadDirectory` (T1/T3) used by T4–T6 and the smoke test; `fileops.run/undoLast/redoLast/rename/...` (T4) used by T5's history Undo (per-op: `POST /operations/{id}/undo` then `refreshDirectory`) and by the keyboard; `showInspectorFor/Multi` (T5) called from `selectRow` (T3 leaves a hook `onSelectionChanged` that T5 implements); `loadPins` (T2) called after `cm-pin-sidebar` (T4); `saveSetting` (T7) used by `cm-toggle-hidden` (T4) — T4 may call `API.post('/config', …)` directly if T7 has not landed yet, and T7 replaces it. Bridge additions: only `homeDir()` (T2).
