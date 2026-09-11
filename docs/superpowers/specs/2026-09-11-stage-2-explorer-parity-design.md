# Stage 2 — Explorer Parity — Design Spec

**Date:** 2026-09-11
**Status:** Approved decisions (roadmap D1, D2, plus S2-1..S2-6 below). Author chose to run Stage 2 end to end (spec → two plans → two runs → one review). This spec is the binding contract for both runs.
**Parent:** `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` §5 "Stage 2", §9.
**Inputs:** `docs/backend-integration.md` §A.1–A.3, A.10, A.12.0, Cross-cutting §17 (the April wiring ledger; this spec supersedes it where they differ).

---

## 1. Goal

The author uses FilePlus instead of Windows Explorer, every day, for browsing and ordinary file operations. Done when: a week of daily use without falling back to Explorer for browse / open / rename / move / copy / delete; `verify` green; every write in `operations_log`; every write undoable.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| S2-1 | `actions.js` | **Deleted.** The `switch` in `app.js` stays the single dispatcher. Helpers that are still used move into focused modules (§7). |
| S2-2 | Settings storage | **SQLite `config` table via the API.** Theme, density, accent keep a `localStorage` fast-paint cache; the table is canonical. |
| S2-3 | Listing model | **Live listing for browsing** (`/fs/list` reads the disk); **the index** (`files` table) serves search, tags and history. Not unified. |
| S2-4 | Delete | **FilePlus trash, emptied to the Recycle Bin.** Delete moves the item to a hidden `.FilePlusTrash` folder on the same volume (fast, atomic, undoable). "Empty FilePlus trash" sends its contents to the Windows Recycle Bin via `send2trash`. **The app never hard-deletes.** There is no permanent-delete action in Stage 2. |
| S2-5 | Search | **On-demand quick index** (no hashing) of folder trees chosen from the sidebar; Ctrl+K searches the index by name/path. Whole-drive scans and dedupe stay in Stage 4. |
| S2-6 | Default folder handler | Deferred (not needed for daily use; the author launches FilePlus directly). |
| D2 | Write guard | `path_guard(path, mode)`: reads anywhere; writes inside `FILEPLUS_SANDBOX_PATH` until `WRITE_UNLOCKED=true`; Windows system roots are never writable. `SAFETY_MODE` is retired. |

## 3. Safety architecture

### 3.1 `path_guard(path, mode='read') -> Path`
- `mode='read'`: resolve and return. No restriction (browsing real drives is the point).
- `mode='write'`:
  1. If the resolved path is under any `PROTECTED_WRITE_ROOTS` entry (`%SystemRoot%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%ProgramData%`, and the FilePlus repo/app directory itself) → raise `ProtectedPathError` **always**, even when unlocked.
  2. If `WRITE_UNLOCKED` is false and the path is not under `FILEPLUS_SANDBOX_PATH` → raise `OutOfSandboxError`.
  3. Return the resolved path.
- Every mutating function in `mover.py` calls `path_guard(x, 'write')` on every source **and** destination before logging. `GET /fs/list` and the indexer use `'read'`.
- `WRITE_UNLOCKED` comes from `.env` (default `false`). The API reports it in `/health`; the frontend shows a status-bar hint "writes: sandbox" while locked and surfaces the 403 message on any refused write.

### 3.2 Trash
- Trash root for a path: `<sandbox>\.FilePlusTrash\` when the path is inside the sandbox; otherwise `<volume root>\.FilePlusTrash\` (created on first use with the Windows hidden attribute). Same volume ⇒ trashing is a rename.
- Layout: `<trash root>\<batch_id>\<original name>`; a `manifest.json` per batch records original paths and timestamps.
- `POST /fs/trash/empty` sends every batch folder in every known trash root to the Recycle Bin with `send2trash` and logs `trash-empty:final`. Manual only in Stage 2 (no auto-purge).
- `.FilePlusTrash` is skipped by the indexer and hidden in listings unless "show hidden".

### 3.3 Operations log and undo
- Table `operations_log` gains `error TEXT` and `undo_of INTEGER` (schema v3). Statuses derive from `executed`/`undone`/`error`.
- Protocol for every mutation: `path_guard` → `log_operation(executed=0)` → perform → `mark_executed`; on exception `mark_error(op_id, message)` and re-raise. Cross-volume moves copy, verify size (and hash for files ≤ 1 GB), then remove the source.
- **Undo** creates a new logged forward operation that inverts the original (`undo_of=<id>`) and marks the original `undone=1`. **Redo** is undoing that inverse. Inverses: move → move back; rename → rename back; trash → restore to original path (conflict ⇒ keep-both); copy → trash the copy; mkdir/touch → trash. Batch undo processes a batch's ops newest-first as one new batch.
- **Crash recovery**: on API startup `reconcile_pending()` inspects rows with `executed=0` and `error IS NULL`: dest exists and source missing ⇒ mark executed; source exists and dest missing ⇒ mark error "not started"; otherwise error "ambiguous". `GET /operations/pending` returns what was reconciled; the frontend shows a modal listing it on launch when non-empty.
- Op types: `move`, `rename`, `trash`, `restore`, `copy`, `mkdir`, `touch`, `trash-empty:final`, `config-change`, `tag-add`, `tag-remove`, `favorite-add`, `favorite-remove`, `pin-add`, `pin-remove`.

### 3.4 Name and conflict rules
- Valid names: non-empty, no `\ / : * ? " < > |`, no control chars, not `.`/`..`, no trailing dot or space, not a reserved device name (`CON, PRN, AUX, NUL, COM1–9, LPT1–9`).
- Conflict policy for move/copy/restore: `fail` (default; report in `conflicts[]`), `replace` (trash the existing target first, logged), `keep-both` (`name (2).ext`, `(3)`, …), `skip`.
- Moving a folder into itself or its descendants is refused. Free space is checked before copies and cross-volume moves (refuse if `< size + 100 MB`).

## 4. API surface (all new unless noted)

| Route | Purpose |
|---|---|
| `GET /health` | + `db_ok`, `write_unlocked`, `pending_ops`, `index_running` |
| `GET /drives` | fixed volumes: `{letter, label, mount, total_bytes, free_bytes, used_bytes}` (psutil + `GetVolumeInformationW`) |
| `GET /fs/list?path&show_hidden` (changed) | reads anywhere; skips `.FilePlusTrash` unless shown; runs in a thread; returns `{path, parent, is_root, entries[...]}`; permission errors on children become entries with `error`; a refused root is 403 with a message |
| `POST /fs/mkdir {dir, name}` · `POST /fs/touch {dir, name}` · `POST /fs/rename {path, new_name}` · `POST /fs/move {sources[], dest, on_conflict}` · `POST /fs/copy {sources[], dest, on_conflict}` · `POST /fs/trash {paths[]}` · `POST /fs/trash/empty` | mutations; each returns `{batch_id, ops[], conflicts[], errors[]}`; 403 `OutOfSandboxError`/`ProtectedPathError` with the message; 409 for name/conflict rule violations |
| `GET /operations?limit&offset&path` · `POST /operations/{id}/undo` · `POST /operations/batch/{batch_id}/undo` · `GET /operations/pending` | log and undo |
| `GET /file?path` | full record for one path (indexes it on demand, with hash) + tags |
| `GET /preview?path` | image ⇒ bytes (`FileResponse`, ≤ 25 MB, `png jpg jpeg gif webp bmp svg ico`); text-like ⇒ `{kind:'text', content(≤ 4 KB), truncated, total_size}`; else `{kind:'binary', size}` |
| `GET /files/{id}/tags` · `POST /files/{id}/tags {name}` · `DELETE /files/{id}/tags/{tag_id}` · `GET /tags?q&limit` | tag CRUD (`tagger.apply_tags/get_tags/remove_tag`; `auto_tag` stays Stage 3) |
| `GET /files/history?path` | ops where source or dest equals the path, newest first, limit 50 |
| `GET /search?q&limit` | `files` table, `filename LIKE` or `path LIKE`, ordered by filename |
| `POST /index {path}` · `GET /index/status` | quick index (no hashing) of a tree as a background task; skips hidden, `.FilePlusTrash`, protected roots; `scan_directory(root, hash=False)` |
| `GET /config` · `GET/POST/DELETE /config/{key}` | key/value store (JSON values), each write logged as `config-change` |
| `GET /recent?limit` · `POST /recent {path, action}` | `recent_actions(id, path, action, ts)` capped at 1,000 rows; response grouped into the ledger's time buckets |
| `GET/POST/DELETE /favorites` · `POST /favorites/reorder` | `favorites(id, path, position, created)` |
| `GET/POST/PATCH/DELETE /pins` · `POST /pins/reorder` | `pinned_folders(id, path, label, position, created)` |

Existing `POST /scan` gains `hash: bool = true`; reads are no longer confined to the sandbox (the earlier 403 test is replaced by an "indexes outside sandbox" test). `GET /files` gains `?limit&offset`.

## 5. Electron bridge (preload)

`openPath(path)`, `showItemInFolder(path)`, `openWith(path)` (spawns `rundll32.exe shell32.dll,OpenAs_RunDLL <path>`), `pickFolder(defaultPath) -> string|null` (`dialog.showOpenDialog`), `clipboardWriteText(text)`. Main validates every argument is a string; nothing else is exposed.

## 6. Frontend behaviour

- **Sidebar:** drives from `/drives` (replace the hardcoded C/D entries); pins from `/pins` with a context menu (open in new tab, unpin, rename label, reorder by drag); Downloads stays a fixed Quick Access entry (path from config `paths.downloads`, default `%USERPROFILE%\Downloads`).
- **Browser:** live listing of any path incl. drive roots (`C:\`); breadcrumb from the real path; back/forward/up; sort by name/size/modified (client); show-hidden and show-extensions honour config; empty-folder and error states (refused root ⇒ error banner with "Go back").
- **Selection:** click, Ctrl+click, Shift+click, marquee, Ctrl+A; keyboard ↑/↓/Home/End, Enter opens (folder ⇒ navigate; file ⇒ `openPath`), Backspace/Alt+↑ up, Alt+←/→ history, F2 rename, Delete trash, F5 refresh, Ctrl+C/X/V, Ctrl+Z/Ctrl+Y.
- **File ops:** context menus (file / folder / empty area / sidebar item / tab) wired for: Open, Open with…, Open in new tab, Show in Windows Explorer, Cut, Copy, Paste, Rename, Delete, New folder, New file, Refresh, Add to Favorites, Pin to sidebar, Index for search (folders), Properties (modal from `/file`), Show hidden files. Not in Stage 2 (removed from the menus): Reclassify, Compress, Open in new window, Reveal in Browser (Home rows only), Group by.
- **Inline rename** (F2 / context menu): input replaces the name cell; Enter commits via `/fs/rename`, Esc cancels; name rules validated client-side too.
- **Drag and drop** onto a folder row or a sidebar folder/pin ⇒ `/fs/move`; Ctrl held ⇒ copy. Conflict ⇒ modal Replace / Skip / Keep both / Cancel (applies to all remaining).
- **Undo/redo:** a session stack of batch ids; Ctrl+Z undoes the last batch via the API and pushes to the redo stack; Ctrl+Y redoes. Every mutation shows a snackbar with Undo (gated by the notifications setting; errors bypass). History tab and Home rows show "Undo" where the op is still undoable.
- **Inspector:** meta from `/file` (kind, size, modified, created, hash truncated with full hash in `title`), preview from `/preview` (image or text or "no preview"), Tags tab with add (autocomplete from `/tags?q`) and remove, History tab from `/files/history`, multi-select aggregate (count, total size, tag union computed client-side from `/file` of each selected row, capped at 50).
- **Home:** Recent from `/recent` with hover actions (open, reveal in Browser, copy path); Favorites from `/favorites` with unfavorite + undo (existing visual) and drag reorder.
- **Palette:** search mode hits `/search`; results open the containing folder with the row selected. Chat mode stays a placeholder (Stage 3).
- **Settings:** Personalization toggles persist through `/config` keys `ui.theme`, `ui.density`, `ui.accent_hex`, `ui.notifications`, `ui.show_extensions`, `ui.show_hidden`, `ui.click_mode`; a **Data** pane action "Empty FilePlus trash" (typed confirmation "EMPTY") and a read-only "Writes: sandbox / unlocked" line explaining `WRITE_UNLOCKED`. Other panes keep their markup but show a "Planned for Stage N" banner on entry.
- **Placeholder screens** (File Tree, Scan, Review Bin, Everything Folder): a neutral in-screen banner "Not built yet — planned for Stage 3/4" replaces the toast; the placeholder markup beneath is dimmed.
- **Startup:** crash-recovery modal when `/operations/pending` is non-empty; status bar shows item count, selection count/size, "writes: sandbox" while locked, backend state.

## 7. Frontend structure (S2-1)

`app.js` keeps shell, tabs, screens, dispatch and settings; new classic-script modules loaded before it, all globals, no build step: `src/api.js` (fetch wrappers with error toasts), `src/browser.js` (listing, navigation, selection, sort, rename, drag/drop), `src/fileops.js` (clipboard intent, mutations, undo/redo stacks, snackbars, conflict modal), `src/inspector.js`, `src/home.js`, `src/settings.js` (config sync). `actions.js` is deleted; its one live helper (`unfavoriteFile`) moves to `home.js`.

## 8. Verification

- Backend: pytest on a temp sandbox for every mover path (move same/cross volume simulated by two tmp dirs, rename, trash, restore, copy, mkdir, touch, conflicts ×4, folder-into-itself, protected root, sandbox lock, disk-space refusal via monkeypatch), every undo/redo round trip, crash-recovery reconciliation, every new endpoint's contract. `WRITE_UNLOCKED` is false in tests.
- Smoke test additions: navigate into `FilePlusTestSandbox\_gen` (regenerated by `verify.ps1` before the smoke run), select a row, screenshot with the Inspector open; open a context menu and screenshot; **rename a file through the UI and undo it with Ctrl+Z**, asserting the row text both times; `settings-light` still captured.
- `verify.ps1` runs `py -3 scripts/gen_sandbox.py` before starting the backend.
- Gates: `actions.js` absent; no `stub(` calls remain; `STUB_SCREENS` toast replaced by banners; every `cm-*` action in the menus has a `case`.

## 9. Two plans, two runs

- **Plan 2A — backend safety core and API** (`docs/superpowers/plans/2026-09-11-stage-2a-backend-core.md`): config, schema v3, operations log, mover, undo, all routes in §4, Electron bridge, startup reconcile. Reviewed and merged before 2B starts.
- **Plan 2B — frontend wiring** (`docs/superpowers/plans/2026-09-11-stage-2b-frontend.md`): §6–§7 against the merged 2A API, smoke e2e, docs, graduation instructions.

## 10. Graduation (author, after 2B)

1. Use the app against `FilePlusTestSandbox` for a session: move, rename, delete, undo, empty trash.
2. Set `WRITE_UNLOCKED=true` in `.env`, restart the backend. Real-drive writes now go through the same logged, undoable path; system roots stay protected.
3. Index Downloads, Documents and project folders from the sidebar for search.

## 11. Out of scope

AI of any kind; Everything Folder watcher; Review Bin; big scan, dedupe, tree proposals, snapshots; tag canvas; tray; onboarding; permanent delete; Windows default-handler registration; column view; thumbnails beyond image preview; PDF/audio/video previews.

## 12. Risks

| Risk | Mitigation |
|---|---|
| A bug wipes files | No hard delete exists; every write is logged first and undoable; trash is on the same volume; system roots protected; sandbox lock until the author flips it. |
| Listing huge or slow folders (`C:\Windows`) | Listing runs in a thread; permission errors per entry; 10,000-entry cap with a "showing first N" banner. |
| Cross-volume move interrupted | Copy-verify-remove order; a crash leaves both copies and a pending op that reconciliation reports. |
| Path oddities (long paths, junctions, reserved names) | `\\?\` prefix for > 240 chars in mover; junctions are listed but never followed by the indexer; name rules in §3.4. |
| Frontend split breaks load order | Modules are classic scripts, loaded in a fixed order in `index.html`; the smoke test's zero-console-error gate catches missing globals. |
