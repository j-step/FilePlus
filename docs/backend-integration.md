# FilePlus — Backend Integration Checklist

**Purpose.** A running ledger of every backend feature the frontend needs in order to function. Each item describes what the static UI demo currently does NOT do and how the integration should bind it. Organised by screen so the implementation pass can pick up screen-by-screen.

**Status.** Living document. Append items as they surface during polish; mark items resolved with a date when implemented. Order within a screen follows priority — top items block more functionality than bottom ones.

**Conventions.**
- "INTEGRATION:" comments in source code mirror items in this doc.
- API paths are proposals — confirm against [backend/api.py](../backend/api.py) before implementing.
- Every file write goes through [`operations_log.log_operation()`](../backend/operations_log.py) BEFORE the action (see [CLAUDE.md](../CLAUDE.md)).
- Frontend uses `fetch()` only; never direct Node fs APIs.
- **API URL prefix decision — decided 2026-09-10 (Stage 0): NO `/api/` prefix.** All routes are registered bare (`/health`, `/files`, `/scan`, `/fs/list`, …); stub strings and INTEGRATION comments were aligned in Stage 0.

---

## A.1 Global chrome (titlebar / tabbar / sidebar / toolbar / statusbar)

_Polish complete; integration items pending._

**Done in 2C (2026-09-13).** Real per-tab state (`{id, screen, label, path, history, view, scrollTop,
selection}`, Task 7); This PC section replaces Tree with `GET /known-folders` backing Quick Access
(Desktop/Downloads/Screenshots, removable, Task 9); refresh button beside the breadcrumb, one-click
theme toggle, inspector-is-a-switch, deselect-anywhere (Task 8); Ctrl+wheel `--list-scale` plus View
and Sort toolbar menus (Task 10). See `docs/superpowers/runs/2026-09-13-stage-2c.md`.

**Stage 2D (2026-10-02).** `--list-scale` is gone: Ctrl+wheel walks the Explorer view ladder, remembered
per folder in `ui.folder_views` (A.3 #7). The sidebar's This PC header opens a This PC page of drive
cards (`thispc:` sentinel, `frontend/src/thispc.js`); sidebar and inspector widths are screen px
(`ui.sidebar_w`, `ui.inspector_w`) so app zoom never narrows them. See
`docs/superpowers/runs/2026-10-01-stage-2d.md`.

### 1. Sidebar drive bar fill
**Done (Stage 2B, 2026-09-11).** `GET /drives` + real `.fp-sidebar__drive-bar__fill` width in `app.js`.

**Stage 2D (2026-10-01, Task 1).** `GET /drives` → `[{letter: "C:", mount, label, kind, fs, total_bytes,
free_bytes, used_bytes}]`. `kind` is `fixed | removable | network | cdrom`, `fs` the filesystem.
Removable, network and optical drives are included; a drive with no media (or access denied) is skipped.
Each drive is probed in its own thread with a 1.5 s timeout (`_DRIVE_PROBE_TIMEOUT_S`); a drive that
times out (a sleeping network share) is still listed, with an empty `label` and all three sizes
`null`, so every consumer must accept null sizes (the This PC card says "Unavailable"). The sidebar
list and the This PC page share one drive model and one formatter (`thispc.js`).

**What.** Drive cards in `#sb-tree` show a `.fp-sidebar__drive-bar__fill` with hardcoded `width: 25%` / `41%`. Should reflect actual disk usage.

**How.**
- New endpoint `GET /drives` returning `[{ letter, label, mount_path, total_bytes, free_bytes, used_bytes, ai_managed, online }]`.
- Implementation: use `psutil.disk_partitions()` + `psutil.disk_usage(mount)` (already pull `psutil` in via watchdog). On Windows, restrict to fixed drives (`opts: 'fixed'` in psutil).
- Update `width` attribute per drive on app start and on filesystem change events from [watcher.py](../backend/watcher.py).
- Cache in `localStorage['fp-drives-snapshot']` keyed by drive letter so the sidebar paints with last-known values before the request resolves.
- The `.fp-sidebar__drive-ai-dot` shows only when `ai_managed === true` (drive is configured for AI organising in Settings → Scan & Index).
- Endpoint should be cheap (~20 ms) so the renderer can re-poll every 60 s without a perf hit.

### 2. Sidebar tag list
**Done in 2C (2026-09-13).** `GET /tags` wired in Task 14. As built, the no-`q` listing returns every tag with its `count`, ordered by name, and the renderer ranks and cuts the top 8 by count (`loadSidebarTags` in app.js); `limit` only applies to the `q=` prefix search (the inspector's autocomplete). The `?limit=8&order=count` shape below was not built; clicking a chip opens a
This PC search scoped to `tag:<name>`; "View all" still opens the Stage 3 Tag Canvas placeholder. The
static demo markup the author flagged as "tags not implemented" was this list, not the tag store.

**What.** Tags in `#sb-tags` are static (work / photos / docs / code with hardcoded counts).

**How.**
- New endpoint `GET /tags?limit=8&order=count` returning `[{ id, name, color, count }]`.
- Re-fetch on tag-canvas commit and on file rename / move events.
- Counts use the same `(opacity:.6;font-size:10px)` mono style — keep the sub-numbers token-clean.
- Server-side, this is `SELECT t.id, t.name, t.color, COUNT(ft.tag_id) FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id GROUP BY t.id ORDER BY count DESC LIMIT ?`. Add an index on `file_tags(tag_id)` first (see Cross-cutting / Performance).

### 3. Backend status dot
**Superseded (Stage 2A, 2026-09-11).** `GET /health` actually returns `{db_ok, write_unlocked, pending_ops, index_running}` (since the dev harness, 2026-10-01, also `auth`, `shell_icons` and `env`; `write_unlocked` is the effective state, true only when `FILEPLUS_ENV=prod` AND `WRITE_UNLOCKED=true`), not the `scan_running`/`ai_status`/`watcher_running` shape proposed below; the dot maps against the real contract.

**What.** The header dot reflects `checkBackend()` result (already wired); confirm endpoint contract.

**How.**
- Extend `GET /health` to return `{ status: 'ok', version, scan_running: bool, ai_status: 'ready'|'loading'|'offline', watcher_running: bool, db_ok: bool }`.
- Frontend should map: all green → green dot. `scan_running` or `ai_status='loading'` → amber. `db_ok=false` or `ai_status='offline'` → red.
- Already polled every 30 s in [app.js:1975](../frontend/src/app.js#L1975).

### 4. Pinned folders (`GET /pins`)
**Done (Stage 2A/2B, 2026-09-11).** `pinned_folders` table + `GET/POST/PATCH/DELETE /pins` + `/pins/reorder`, wired in the sidebar.

**What.** Sidebar `#sb-pinned-folders` shows hardcoded entries (Downloads etc.).

**How.**
- New table `pinned_folders` (id, path, label, position, created). Or reuse `tags` with a sentinel `tag_group='pinned'`. The dedicated table is cleaner — separate concern.
- `GET /pins` → `[{ id, path, label, position }]` ordered by position.
- `POST /pins { path, label }`, `DELETE /pins/{id}`, `POST /pins/reorder { order: [id1, id2, ...] }`.
- These are user-curated; avoid auto-pinning anything.

### 5. Everything Folder error count
**What.** `#sb-everything-errors` (commented out in markup) is meant to badge the EF nav row when files are stuck.

**How.**
- `GET /ef/errors/count` → `{ count }`. Backed by `SELECT COUNT(*) FROM files WHERE status='error' AND path LIKE '<EF_PATH>%'`.
- Re-emit via the `GET /events` SSE stream (see cross-cutting) when watcher sets a file to error state.

### 6. Sidebar device name persistence
**What.** `#sb-device-name` is editable inline; currently writes only to `localStorage['fp-device-name']`.

**How.**
- Persist via `POST /config { key:'device.name', value:<string> }`. The localStorage entry can stay as a fast-paint cache, but the source of truth is the config table.
- See "A.12 Settings / 0. Config table" for the underlying schema.

---

## A.2 Home (Recent / Favorites / Shared)

### A.2.1 Recent

#### 1. Time-bucket grouping (`GET /recent`)
**Done (Stage 2B, 2026-09-11).** `recent_actions` table + `GET /recent`/`POST /recent`, grouped sections rendered in `home.js`.

**What.** The Recent pane currently ships static placeholder rows in 10 hardcoded sections (Today, Yesterday, This week, Earlier this month, Last month, Earlier this year, 2025, 2024, 2023, A long time ago). Real data must drive the layout, including hiding empty groups and computing the year-section labels at runtime.

**How.**
- Endpoint: `GET /recent?limit=200` returning `{ groups: [{ key, label, files: [...] }] }` ordered most-recent-first.
- Group keys (in render order):
  - `today`
  - `yesterday`
  - `this-week` (Mon→today, excluding today/yesterday; Mon-start week)
  - `earlier-this-month` (current calendar month, excluding this-week)
  - `last-month` (previous calendar month)
  - `earlier-this-year` (current year, excluding last-month and newer)
  - `year-{N}` — one per past year for the last 3 calendar years (`current_year - 1`, `current_year - 2`, `current_year - 3`); `label` is the year as a string (e.g. `"2025"`).
  - `ancient` — anything before `(current_year - 3)`; `label` is `"A long time ago"`.
- A group is omitted from the response (or returned with `files: []`) if empty. The frontend hides empty groups via `pruneEmptyHomeSections()` either way; preferred is for the server to omit them so the wire payload stays small.
- File entry shape: `{ id, path, name, ext, size, mtime, atime, action: 'opened'|'modified'|'viewed', action_at, tags: [...], thumb_url? }`.
- Source-of-truth for `action_at`: a new `recent_actions` table — `(id, file_id, action, ts)` with a 1000-row cap (rolling window). Populated by:
  - Frontend `data-action="open-file"` → `POST /recent/open { path }` server-side records the action
  - Watcher `on_modified` → records `'modified'`
  - Inspector tab open → records `'viewed'`
- Frontend renders one `.home-section` per group in payload order; first non-empty group naturally lands at the top.
- Re-run `pruneEmptyHomeSections()` after each fetch (it currently only runs on `DOMContentLoaded`).
- Cache the response in `sessionStorage['fp-recent']` (TTL 5 min) so re-entering the Home screen paints instantly.

#### 2. Time labels in `.fp-row__recent-time`
**Done (Stage 2B, 2026-09-11).** `formatRecentTime()` in `home.js` implements the bucket-dependent formats below.

**What.** Each row shows a relative-time label like `opened 11:20`, `modified Apr 12`, `opened in 2019`. Format is bucket-dependent.

**How.**
- Today / Yesterday: `{action} {HH:mm}` (24-hour, locale-aware).
- This week: `{action} {weekday}` (e.g. `viewed Tuesday`).
- Earlier this month / Last month / Earlier this year: `{action} {Mon} {D}` (no year).
- Year-N sections: `{action} {Mon} {D}` (year is implicit in the section label).
- Ancient: `{action} in {YYYY}` (full year, no month).
- Frontend formats client-side from the file entry's `action` + `action_at` ISO timestamp; do not pre-format on the server.

#### 3. Per-row hover actions
**Done (Stage 2B, 2026-09-11).** Open/Reveal/Copy path wired in `home.js` via `electronAPI`/`switchScreen`/clipboard, through `IN_SCOPE_ACTIONS`.

**What.** Each Recent row has three hover-revealed buttons: Open, Reveal in Browser, Copy path. All currently hit the default action stub.

**How.**
- `data-action="open-file"` — call `electronAPI.openPath(path)` (preload exposes `shell.openPath`). Backend additionally logs to `recent_actions` via fire-and-forget `POST /recent/open`.
- `data-action="reveal-file"` — call `switchScreen('browser')`, then `loadDirectory(parentDir(path))`, then scroll-into-view + select the row whose `data-path === path`.
- `data-action="copy-path"` — wired as `case 'copy-path'` in [app.js](../frontend/src/app.js)'s click switch (`actions.js` was deleted in Stage 2B). Confirm it picks up the closest `[data-path]` for Recent rows specifically (Recent rows DO have `data-path`, so it should — verify only).

#### 4. Selected-row state
**Done (Stage 2B, 2026-09-11).** Real click/keyboard selection in `home.js` (`homeKeydown` + row click handler), no hardcoded row.

**What.** The first Today row is hardcoded with `fp-row--selected aria-selected="true"` to demonstrate the visual. Real selection is runtime.

**How.**
- Remove the hardcoded `fp-row--selected aria-selected="true"` once `/recent` lands.
- Click handler: toggle `.fp-row--selected` + `aria-selected` on clicked row, exclusive within `.home-pane[data-pane="recent"]`. Persist last selection to `sessionStorage['fp-recent-selected-path']` and restore on Home re-entry.
- Keyboard: arrow keys move selection across rows, respecting section boundaries (i.e. Down at the last row of Today → first row of Yesterday).

#### 5. Recent thumbnails
**What.** Each Recent row that represents an image/video should show a small thumb instead of the generic icon.

**How.**
- `GET /thumb?path=<encoded>&size=24` → returns a 24×24 PNG, content-type `image/png`. Or `?size=64` for grid view.
- Generate from Pillow for images. For videos, defer to v2 (returns the generic icon in the meantime).
- Cache thumbs on disk: `<APP_DATA>/thumbs/<xxh64-of-path>-{size}.png`. Invalidate when `mtime` of source changes.
- Thumb URL on the file entry: `thumb_url: '/thumb?path=<encoded>&size=24'`. Frontend renders `<img>` on rows where this field is present.

### A.2.2 Favorites

#### 1. Favorites list (`GET /favorites`)
**Done (Stage 2A/2B, 2026-09-11).** `favorites` table + `GET/POST/DELETE /favorites` + `/favorites/reorder`, rendered in `home.js`.

**What.** Favorites pane ships one static row. Real list comes from a user-curated collection.

**How.**
- Endpoint: `GET /favorites` → `{ files: [...] }` in user-defined manual order. Same file shape as `/recent` plus a `position` integer.
- New table `favorites (id, file_id, position, created)`. Joining against `files` returns the file payload.
- Reorder: `POST /favorites/reorder { order: [path1, path2, ...] }` — replaces the order list.
- Add: `POST /favorites { path }`. If the path is not yet indexed, server-side calls `index_file(path)` first so a `file_id` exists.
- Cache: `localStorage['fp-favorites']` so the pane paints last-known state instantly on cold start. Re-fetch on every Favorites tab activation, diff against cache, animate inserts/removes.

#### 2. Unfavorite-star click — visual + undo wired; backend pending
**Done (Stage 2B/Task 8a, 2026-09-11).** Implements the doc's own "alternative shape": `DELETE /favorites` fires on the 200ms removal timer in `home.js`'s `unfavoriteFile()`; Undo re-adds via a server-side inverse op (Task 8a) at the captured order snapshot.

**What.** Click on the filled accent star: flips the star path to outline, fades the row over `var(--dur-slide)`, removes the row after 200ms, and surfaces an Undo snackbar that re-inserts the row at its original position with the filled star restored. Currently visual-only — no DELETE/POST is fired.

**Status.** Visual + undo behavior live in `unfavoriteFile()` in [home.js](../frontend/src/home.js), wired through the click switch in [app.js](../frontend/src/app.js) (case `'unfavorite-file'` calls `unfavoriteFile(btn)`; action is in `IN_SCOPE_ACTIONS`). CSS class `.fp-row--unfavoriting` lives in the Home block of `styles.css`. Snackbar respects the global notifications toggle — when notifications are off (default), the row removal still happens but the Undo affordance is silent. The integration pass should not bypass that gate.

**How — backend wiring.**
- On removal completion (after the 200ms timer fires AND the snackbar's 5.2s window has elapsed without an Undo click), fire `DELETE /favorites?path=<encoded>`. Defer the network call past the snackbar window so undo can race it without a roundtrip.
- Alternative shape: fire `DELETE` immediately on the 200ms timer, and on Undo fire `POST /favorites { path, position }` to re-add at the captured `position`. This is one extra round-trip but simpler — pick whichever fits the server-state model better.
- On error: cancel the removal (restore the row + star — handler already supports this via the same path the Undo callback uses), fire an error toast (errors bypass the notifications gate).
- The handler captures `parent`, `nextSibling`, and the original star-path attribute set at click time — re-use these in the error-recovery path.

#### 3. Drag-to-reorder
**Done (Stage 2B, 2026-09-11).** HTML5 drag + `POST /favorites/reorder`, wired in `home.js`.

**What.** Spec calls for manual order with drag handles. Not yet wired.

**How.**
- HTML5 drag API on `.fp-row` inside `.home-pane[data-pane="favorites"]`. `draggable="true"` on rows; insertion indicator (1px accent line between rows) on `dragover`.
- On `drop`: compute new order array (in DOM order), call `POST /favorites/reorder`. Optimistic — rebuild order array from the live DOM, send to server, reconcile with server response.
- Keyboard alternative: `Alt+↑` / `Alt+↓` on selected favorite row.

**Done in 2C (2026-09-13).** Favorited rows show an accent star (`favoritesSet`, loaded once, kept in
sync by every mutation) and the context-menu label flips Add/Remove (Task 11, spec §4.3).

### A.2.3 Shared
v2 only. **Removed in Stage 2D Task 12a (2026-10-02):** the permanently disabled tab and its empty pane are
gone (markup in `docs/archive/2026-10-02-unbuilt-screens-markup.html`). No backend integration in v1.

---

## A.3 Browser

### 1. Directory listing (already wired — verify)
**Done (Stage 2A/2B, 2026-09-11).** `show_hidden` query param, `asyncio.to_thread` scandir, and root/parent handling all landed.

**Stage 2D (2026-10-01, Task 1).** Every `/fs/list` and `/fs/list/root` entry also carries `created`
(`st_birthtime`, falling back to `st_ctime`) and `accessed` (`st_atime`), epoch seconds like
`modified`; an access-denied entry carries `0.0` for both. Live `/fs/search` results gain `accessed`;
index `/search` results carry `created` as epoch seconds and have no `accessed` (an index hit sorts
last on an Accessed sort and shows "—"). "This PC" is its own page now, so the
renderer no longer browses `/fs/list/root`; it only samples it for the generic-folder icon prewarm.

**What.** [app.js:1214](../frontend/src/app.js#L1214) `loadDirectory()` calls `GET /fs/list?path=<abs>` (or `/fs/list/root`). Implemented in [api.py:126](../backend/api.py#L126).

**How.** No new backend work. Hardening:
- Add `?show_hidden=true|false` query param so the renderer can honour the Settings → Personalization → "View hidden files" toggle without filtering client-side.
- Currently `_scandir_entries` is synchronous and runs on the event loop. Wrap with `asyncio.to_thread(...)` so a 50K-entry directory doesn't block /health requests during the listing (see Cross-cutting / Performance).
- Return `parent` (parent path) and `is_root` (true for sandbox root) so the renderer's nav-up logic doesn't have to compute it.

### 2. Inspector — single-file metadata (`GET /files/{id}/meta`)
**Done (Stage 2B, 2026-09-11).** Landed as `GET /file?path=` (not a `/files/{id}/meta` route); `inspector.js`'s `showInspectorFor()` populates size/modified/created/hash/tags from it.

**Stage 2D (2026-10-02, Task 12b).** `GET /file` and `GET /files/{id}` return `created` / `modified` as
epoch seconds (`_epoch_dates`), like every listing; they used to ship the index's ISO strings. `GET
/file` re-indexes a row whose size or mtime no longer matches the file (an edited file showed its old
size, date and hash) and still 404s for a path that is gone. `GET /recent` and `GET /favorites` entries
carry `exists`, so Home dims a moved or deleted item ("Moved or deleted") and never asks `/file` about it.
`DELETE /recent` → `{status: "cleared", removed}` empties the Recent list (Settings › Data).

**What.** Inspector shows hardcoded `18.7 KB`, `1 hr ago`, `Apr 22, 2026`, dash-for-hash. Real values must come from the backend.

**How.**
- Endpoint: `GET /files?path=<encoded>` (already exists but only matches by indexed `path`) — extend to return all DB fields plus computed extras: full row from `files`, list of tags joined from `file_tags + tags`, hash, category, confidence, `is_pinned`.
- If the path is not yet indexed, on-demand: server calls `index_file(path)` then returns the row. Renderer sees the full record either way.
- Renderer pseudocode: when row is selected, GET this and populate `#inspector-size`, `#inspector-modified`, `#inspector-created`, `#inspector-hash`, `#inspector-tags`.
- Hash display formatting: render as `xxh64:<first-8-of-hex>…<last-4>` (truncated, monospace) — full hash on hover via `title` attribute.

### 3. Inspector — Preview tab (`GET /preview`)
**Done for text/binary/too-large (Stage 2A/2B, 2026-09-11); image/pdf/audio/video/archive not built.** Bounded 4 KB text reads, `path_guard()` always.

**What.** Preview tab is a placeholder showing markdown rendered from a fake `design-brief.md`.

**How.**
- New endpoint `GET /preview?path=<encoded>` returning a polymorphic body keyed on type:
  - **image** (jpg/png/gif/webp/bmp/svg): redirect/stream the bytes with `Content-Type: image/*`. Renderer puts in `<img src>`.
  - **text/code** (md/txt/py/js/json/yaml/toml/csv/log/ini/xml/html/css/sh/ps1/c/cpp/h/rs/go/java/kt/swift/rb/php — see Settings → Custom Types for the editable list): return first 4 KB as `{ kind:'text', content, ext, total_size }`. Renderer puts in `<pre>` and shows `... (file truncated, 38 KB total)` footer.
  - **pdf**: extract the first page as image (Pillow + pdf2image / pypdf or a direct page render). Return `{ kind:'pdf', pages: 12, first_page_url: '/preview-pdf-page?path=…&page=0' }`.
  - **audio** (mp3/m4a/flac/ogg): return ID3 / mutagen metadata: `{ kind:'audio', title, artist, album, duration_s, bitrate }`. Renderer renders metadata + `<audio controls>` pointing to a streaming endpoint `GET /file-stream?path=<encoded>` (range requests required).
  - **video**: return `{ kind:'video', duration_s, width, height, codec }` from a frame extractor (ffmpeg-python). Same `/file-stream` for the playback element.
  - **archive** (zip/7z/tar.gz): return `{ kind:'archive', entries: [{name, size, is_dir}] }` capped at 200 entries.
  - **other**: `{ kind:'binary', size, hash }` only — renderer falls back to the metadata grid.
- Cache responses for 5 min keyed by `(path, mtime)` so flipping back to a file doesn't re-extract.
- Hard cap on payload: refuse files > 50 MB for text preview (return `{ kind:'too-large', size }`).
- Path safety: `path_guard()` always. `SAFETY_MODE` was replaced by `WRITE_UNLOCKED` + `path_guard(path, mode)` in Stage 2A (2026-09-11). Since the dev harness (2026-10-01) `FILEPLUS_ENV` (`dev` default, `test`, `prod`) gates it too: only `prod` honours `WRITE_UNLOCKED`, so dev and test runs can never write outside `FILEPLUS_ROOT` (alias `FILEPLUS_SANDBOX_PATH`).

### 4. Inspector — Tags tab (read/write)
**Done (Stage 2A/2B, 2026-09-11).** `GET/POST /files/{id}/tags`, `DELETE /files/{id}/tags/{tag_id}`, chip UI + autocomplete in `inspector.js`; add/remove undo inverses landed in Task 8a.

**What.** Tag chip list and "Add tag" input — currently dummy.

**How.**
- `GET /files/{id}/tags` → `[{ id, name, color, tag_group, tag_type }]`. Phase 2.
- `POST /files/{id}/tags { name }` — creates the tag if missing (`INSERT OR IGNORE`), then attaches; returns `[tag_id]`.
- `DELETE /files/{id}/tags/{tag_id}` — removes the link only (tag stays alive even if no files reference it; cleanup is a settings job, see A.12.13).
- Inspector chip behaviour: hover shows `×`; clicking `×` calls DELETE then animates the chip out.
- "Add tag" input does autocomplete from `GET /tags?q=<prefix>&limit=10`; Enter commits.

### 5. Inspector — History tab (`GET /files/{id}/history`)
**Done (Stage 2B, 2026-09-11).** Landed as `GET /files/history?path=`; rendered as a timeline with per-op Undo in `inspector.js`.

**What.** History tab placeholder — should show the operations log entries for this file.

**How.**
- `GET /files/{id}/history` → `[{ id, op_type, source_path, dest_path, timestamp, batch_id, reason, executed, undone }]` ordered newest-first, limit 50.
- Backend query: `SELECT * FROM operations_log WHERE source_path=? OR dest_path=? ORDER BY timestamp DESC LIMIT 50` (the file's current path; if it was moved, the log captured both ends).
- Rendered as a vertical timeline. Each entry has an "Undo" button that fires `POST /operations/{id}/undo` (requires Phase 10 mover work).

### 6. Inspector — multi-select aggregate
**Done (Stage 2B, 2026-09-11).** Client-side count/size sum and tag union both built in `inspector.js`'s `showInspectorMulti()`.

**What.** Multi-select shows count + total size + union of tags. Currently `data.totalSize || '—'` per the comment at [app.js:648](../frontend/src/app.js#L648) — never computed.

**How.**
- Pure client-side computation from already-loaded row data: sum of `size` across selected rows, formatted via `formatSize()`. No backend call needed for total size.
- Tag union: `GET /file?path=` per selected path (capped at 50), unioned client-side into a shared/partial-coverage count. Tags shared by all consulted files render at full opacity; partial-coverage tags render at 0.5 opacity.

### 7. List/grid sorting
**Done (Stage 2B, 2026-09-11).** Client-side `applySort()`/`initColumnSort()` in `browser.js`; deep-tree `order_by` not needed (no search-results tree yet).

**Done in 2C (2026-09-13).** Toolbar View (icon-size presets, List, Details, Show hidden/extensions,
Dynamic media view) and Sort (Name/Date/Type/Size, Asc/Desc) menus built on the context-menu component
(`ui.view_mode`, `ui.sort`, `ui.list_scale`, `ui.dynamic_media_view`, Task 10).

**Stage 2D (2026-10-01, Tasks 2 and 5).** Sort has a "Date…" flyout (created / modified / accessed);
the Details date column and Content view's date line follow it; `ui.sort` accepts the two new keys.
The view is one of `content | tiles | details | list | small | icons@48–256`, remembered per folder in
`ui.folder_views` (`{[normalised path]: {view, size, t}}`, the 500 most recent by `t`). The renderer
saves it only as deltas through `POST /config/merge` (A.12 #0). `ui.view_mode` and `ui.list_scale` are
deleted once by `migrateViewSettings` (guard key `ui.view_migrated_2d`); an unremembered folder opens in
Details, or Large icons when more than half of it is images/videos.

**What.** Column headers fire `data-action="sort-by"` but [app.js:569](../frontend/src/app.js#L569) is a stub.

**How.**
- Pure client-side. The current backend returns one directory's worth of entries — sort in JS by `name | size | mtime`. No backend work required for current-directory sort.
- For deep-tree sort (search results), add `?order_by=name|size|mtime&dir=asc|desc` to `GET /files`.

### 8. Drag-drop into folder (`POST /fs/move`)
**Done (Stage 2B, 2026-09-11).** `handleFsDrop()`/`dropViolation()` in `browser.js`; conflicts route to the Replace/Skip/Keep-both modal; snackbar Undo posts `/operations/batch/{id}/undo`.

**Superseded in 2C (2026-09-13).** HTML5 drag/drop replaced by an in-app pointer-event drag session
(`dragdrop.js`, Task 12) — Chromium cancels a native drag on right-click and gives no ghost control.
Same volume → Move, cross-volume → Copy (Ctrl/Shift override), a floating Move/Copy badge, and
spring-loaded folders (700 ms hover navigates in). Still ends in the same `fileops.moveTo(paths, dir,
copy)` → conflict modal → undo path. Native drag-out to other applications stays out of scope.

**What.** Dropping files onto a folder row should move them.

**How.**
- `POST /fs/move { sources: [path,...], dest: <folder-path> }` returning `{ batch_id, moved: [...], skipped: [...], conflicts: [...] }`. Goes through [mover.batch_move](../backend/mover.py) which logs every op via [operations_log](../backend/operations_log.py) BEFORE acting.
- Conflicts: if dest already has a file with the same name, mark it in `conflicts[]` instead of overwriting. Renderer opens the conflict modal (Replace / Skip / Keep both / Cancel).
- Snackbar on success: `"Moved 4 files. Undo"` — Undo posts `POST /operations/batch/{batch_id}/undo`.

### 9. Right-click context menu actions
**Done for the actions actually in v1's menus (Stage 2B/Task 8b, 2026-09-11).** `open/open-with/reveal-explorer/cut/copy/paste/rename/delete/new-file/new-folder/favorite/pin-sidebar/add-tag/properties` are wired in `app.js`'s switch (`scripts/check_menu_cases.js` gates regressions); `cm-permanent-delete`/`cm-reclassify`/`cm-compress` are not in any v1 menu — deferred. `actions.js` no longer exists (deleted this stage).

**Done in 2C (2026-09-13).** Items gain an optional `enabled(ctx)` predicate (Task 11, spec §4.2):
Open/Open with/Rename/Properties/Index-folder/Pin single-item rules, Copy path/Cut/Copy/Trash/
favorites/Add-tag any-count, Paste only with clipboard contents; disabled items render greyed via
`aria-disabled`. `cm-open-with` now opens the native Windows "Open with" dialog
through the `isSafeLocalPath`-gated `electronAPI.openWithDialog` (Task 4, same bridge
the Properties panel's Change… button uses) instead of the ungated legacy
`electronAPI.openWith`/`shell-open-with` IPC pair, which final review found still
wired to the menu item and has been removed (final fix wave, 2026-09-13).

**What (historical — superseded by the Done note above).** The `cm-*` actions were stubs in the old `actions.js` registry (deleted in Stage 2B); they are now `case`s in [app.js](../frontend/src/app.js)'s click switch.

| Action | Endpoint | Notes |
|---|---|---|
| `cm-open` | IPC `shell.openPath` | already deliverable via preload |
| `cm-open-with` | IPC native | `electronAPI.openWithDialog` → `isSafeLocalPath`-gated `open-with-dialog` handler in main.js |
| `cm-reveal-explorer` | IPC `shell.showItemInFolder` | one-line preload addition |
| `cm-copy` | client clipboard + state | tracks "copy" intent on selection |
| `cm-cut` | client clipboard + state | tracks "cut" intent — paste then moves |
| `cm-paste` | `POST /fs/copy` or `POST /fs/move` | depending on copy/cut intent |
| `cm-paste-here` | same | pastes into current folder |
| `cm-rename` | `POST /fs/rename { src, new_name }` | `path_guard` both; logs to operations_log |
| `cm-delete` | `POST /fs/trash { paths: [...] }` | uses `send2trash` (already a transitive dep of pillow? add explicitly to requirements.txt) — never `os.remove` |
| `cm-permanent-delete` | `POST /fs/delete { paths: [...] }` | requires a typed-confirmation modal (`DELETE` word) |
| `cm-add-tag` | `POST /files/{id}/tags` | reuses Inspector tag handler |
| `cm-reclassify` | `POST /files/{id}/classify` | runs the classifier pipeline again, queues result into approvals |
| `cm-favorite` | `POST /favorites { path }` | reuses A.2.2 |
| `cm-compress` | `POST /fs/compress { paths: [...], dest_zip }` | uses `zipfile`; logs as a single batch |
| `cm-new-file` | `POST /fs/touch { dir, name }` | empty file in current folder |
| `cm-new-folder` | `POST /fs/mkdir { dir, name }` | new directory |
| `cm-scan-folder` | `POST /scan { path }` | already wired |
| `cm-pin-to-sidebar` | `POST /pins { path }` | reuses A.1.4 |

All file-touching ops above MUST call `operations_log.log_operation(executed=0)` first, perform the action, then `mark_executed(op_id)`. On failure, leave `executed=0` so crash recovery picks it up.

### 10. Marquee multi-select aggregate
**Done (Stage 2B, 2026-09-11).** Client-side, same aggregate as A.3.6.

**What.** Marquee drag selects rows; multi-select aggregate at [app.js:618](../frontend/src/app.js#L618) is a stub.

**How.** Pure client-side aggregation from already-loaded rows. See A.3.6 for the inspector multi-select payload.

### 11. Live search (new in 2C)
**Done (2026-09-13).** `GET /fs/search` (current-location, bounded `os.scandir` walk with type/ext/
modified/size/tag/hidden/whole-word filters, budgeted at 4 s, capped at `limit`) and, for the "This PC"
scope chip, `/search` extended with the same filters over the SQLite index plus `GET /index/status` /
`GET /known-folders` / `GET /fs/peek` / `GET /filetypes` (`backend/filetypes.py`, mirrored to
`frontend/src/filetypes.js` by `scripts/build_filetypes.py`, gated in `verify.ps1`). Discord-style
filter chips and results-in-the-list live in `search.js` (Task 1, Task 2, Task 14; spec §8).

**Pass 2 (2026-09-15, api-contracts).** The two routes now read one typed `q` the same way: `GET
/search` splits it on whitespace and requires every word in the **filename** (LIKE wildcards in the
text escaped), exactly as `searcher.match_spans` does — it used to match the whole string as one
substring of filename *or* path, so the same text meant two different queries either side of the
`in:` chip. `GET /search` also returns a real `truncated` flag (it asks for one row past `limit`), and
excludes rows a mutation marked `status='trashed'`. `GET /index/status` gained `error`/`path`/`count`/
`started` so a background index that raised stops reporting as "finished". Every `mover` mutation now
reconciles the `files` table in the same call (`indexer.reindex_move` / `forget_rows_under`), so a
rename, move or delete done inside FilePlus no longer leaves This-PC search pointing at a dead path.

### 12. Properties panel and file icons (new in 2C)
**Done (2026-09-13).** `GET /fs/properties`, `GET /fs/properties/details` (shell property store,
`pywin32`, 503 when absent), `POST /fs/attributes` and `POST /fs/folder-type` (both logged + undoable)
back the FilePlus properties panel (`properties.js`, Task 3/Task 13); `ui.properties_mode=windows`
routes Properties/Alt+Enter to the native dialog instead (`electronAPI.showProperties`, Task 4). Icons:
`ui.icon_source` picks the FilePlus family set (`frontend/assets/icons/filetypes`, `icons.js`) or
Windows shell icons (`electronAPI.fileIcon`); thumbnails always come from
`electronAPI.thumbnail` (Task 4, Task 6).

**Pass 2 (2026-09-16, icons — `docs/superpowers/specs/2026-09-14-stage-2c-pass-2-icon-design.md`).**
Windows-mode icons come from **`POST /shell/icons`** (batch, ≤ 200 items, answers in order as
`{png: base64 | null, pending}`) and **`GET /shell/icon?path=&px=`** (one PNG, `Cache-Control:
private, max-age=3600`) — `backend/winshell.shell_image`, `IShellItemImageFactory::GetImage` at the
requested physical px on a 2-thread STA pool (`winshell.icon_executor()`), so a folder, a known
folder, a desktop.ini icon, a shortcut's target and an extension-less file all get exactly what
Explorer draws. Both are read-only (`path_guard "read"`), token-gated, and `/health` advertises them
as `shell_icons: true`; `checkBackend` (app.js) hands that flag to `fpShellIconRoute()` so an older
backend is never asked. `electronAPI.fileIcons` (Chromium's `app.getFileIcon`, read at its raw
physical rep) is the offline fallback — exact only at 16·S / 32·S (16/32/48 for exe/dll/ico), never
for directories, extension-less files, `.lnk` or `.url` (those fall to the sprite). Thumbnails stay on
`electronAPI.thumbnail` at physical px. Sizing contract everywhere: `px = clampPx(round(cssBox ×
devicePixelRatio))`, the bitmap is exactly `px × px`, the `<img>` is pinned to `px / dpr` CSS px;
zoom, monitor-DPI and `--list-scale` changes re-resolve every icon (`fpInvalidateLazyIcons`).
**Superseded in Stage 2D (2026-10-01, §4.3):** requests go out at `fpIconBucket(round(css × dpr))`
(16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256), the `<img>` is CSS-sized from `--icon-size` /
`.fp-icon--N` and the browser downsamples, and a re-resolved bitmap swaps in only after `decode()`.
`DELETE /shell/icons/cache` (→ `{cleared}`) empties the backend's shell-icon LRU (Settings › Data).
`GET /fs/peek` items carry `modified`; `/recent` and `/favorites` entries carry a real `is_dir`.

---

## A.4 File Tree canvas

**Hidden in Stage 2D Task 12a (2026-10-02).** The screen, its sidebar entry and its palette command are out of the DOM (no control may ship that does nothing); the mock-up markup is kept as reference in `docs/archive/2026-10-02-unbuilt-screens-markup.html`. The items below still describe what its stage must wire.

### 1. Live tree (`GET /tree/live`)
**What.** Canvas placeholder; `#ftree-canvas` shows nothing real.

**How.**
- `GET /tree/live?root=<path>&max_depth=5` → `{ root: { id, name, path, children: [...], file_count, total_size } }` recursively. Each node carries a stable `id` so the canvas can lay out and animate.
- Compute from the `files` table (since it's the source of truth for what's been seen). For folders without indexed children, return a stub child `{ kind:'unindexed', path }` so the renderer can show "Click to scan".
- `?max_depth=` defaults to 5; renderer can request deeper sub-trees on demand via `GET /tree/node/{id}/children`.
- Cache server-side keyed by `(root, max_depth, last_index_completed_at)`. Invalidate when any move/rename/scan completes.

### 2. Snapshots — list (`GET /snapshots`)
**What.** Right rail shows three hardcoded snapshot rows.

**How.**
- `GET /snapshots` → `[{ id, label, trigger, created, file_count, expires_at? }]` newest-first (excluding `tree_json` to keep the payload small).
- Implementation in [snapshotter.list_snapshots](../backend/snapshotter.py).
- The expiry `expires_at` is computed from Settings → Snapshots → "Auto-cleanup after" (e.g. proposal-review snapshots expire after 30 days). Manual / scan / pre-batch snapshots have no expiry.

### 3. Snapshots — create (`POST /snapshots`)
**What.** "New snapshot" button hits the default stub.

**How.**
- `POST /snapshots { label, trigger }` where `trigger ∈ {manual, pre-scan, pre-batch, pre-restore}`.
- Backend serialises the current tree state (`SELECT path, hash, modified FROM files`) to JSON and stores it.
- Returns `{ id, created }`. Renderer prepends to the snapshots rail with a slide-in animation.
- `POST /snapshots/{id}` (PATCH-equivalent) to rename the label; `DELETE /snapshots/{id}` to remove.

### 4. Snapshots — view (`GET /snapshots/{id}`)
**What.** Click a snapshot row to enter "Viewing snapshot from [date]" mode.

**How.**
- `GET /snapshots/{id}` → full snapshot incl. `tree_json`. Renderer rebuilds the canvas from this data; canvas state has a `mode` flag distinguishing live / snapshot / proposal.
- Diff against live: client-side computes adds / removes / moves vs the live tree (already loaded from `/tree/live`). Highlights via colour: `--bad` for removed, `--accent` for added, `--warn` for moved.
- "Where is it now?" lookup in snapshot mode: `GET /files?path=<old-path>` returns the current row (whose path is the new location).

### 5. Snapshots — restore (`POST /snapshots/{id}/restore`)
**What.** Restore confirmation modal with typed "RESTORE" input then revert the filesystem.

**How.**
- `POST /snapshots/{id}/restore` → 200 with `{ batch_id, moves: int }`.
- Backend [snapshotter.restore_snapshot](../backend/snapshotter.py) diffs snapshot vs current `files` rows, generates a list of moves/renames, wraps them in a single `batch_id` via [mover.batch_move](../backend/mover.py).
- Pre-restore step: automatically create a `pre-restore` snapshot of the current state so the user can undo the restore itself. Returns both `batch_id` and the new `pre_restore_snapshot_id`.
- Renderer shows snackbar `"Restored snapshot 'Before big cleanup' (47 moves). Undo"` — Undo calls `POST /operations/batch/{batch_id}/undo`.

### 6. Snapshots — comparison mode
**What.** Compare two snapshots side-by-side.

**How.**
- `POST /snapshots/compare { a_id, b_id }` → `{ added: [...], removed: [...], moved: [...], unchanged_count }`. Implementation in [snapshotter.compare_snapshots](../backend/snapshotter.py).
- This is a v1.5 / v2 feature — note in the doc but skip implementation until later.

### 7. Drag-to-reparent (proposal mode)
**What.** Dragging a folder node onto another in the canvas should enter proposal-review mode (not move yet).

**How.**
- Pure client-side first: build a proposal `{ moves: [{src, dest}, ...] }` from the visual rearrangement.
- `POST /proposals { moves: [...] }` stores the proposal in a new `proposals` table (id, created, moves_json, status: pending/executed/dismissed). Returns `{ proposal_id }`.
- Banner activates: "Reviewing proposal — execute or discard."
- `POST /proposals/{id}/execute` → calls [mover.batch_move](../backend/mover.py) for the proposal's moves; auto-creates a `pre-batch` snapshot first; returns `{ batch_id }`.
- `DELETE /proposals/{id}` to discard.
- Listing: `GET /proposals?status=pending` for any UI that wants to show pending proposals.

### 8. Inline rename (F2 → contenteditable → POST)
**What.** Press F2 on a node to rename in place.

**How.**
- Renderer handles the inline edit; on commit, `POST /fs/rename { src: <old-path>, new_name: <new-name> }`. Reuses the same endpoint as A.3.9's `cm-rename`.

### 9. Add folder / delete selected
**What.** Toolbar buttons.

**How.**
- `POST /fs/mkdir { dir, name }` for "Add folder".
- `POST /fs/trash { paths: [...] }` (trash, not permanent delete) for "Delete selected".

### 10. Hidden file toggle
**What.** Toolbar button that toggles visibility of hidden / system files in the tree.

**How.**
- Pure client-side filter when the data is already loaded — backend already returns `is_hidden` per entry. No backend work needed.

### 11. Jump-to list (left rail)
**What.** Flat list of visible nodes for quick navigation.

**How.**
- Pure client-side. Render names + indentation level from the in-memory tree.

---

## A.5 Scan

**Hidden in Stage 2D Task 12a (2026-10-02).** The screen, its sidebar entry and its palette command are out of the DOM (no control may ship that does nothing); the mock-up markup is kept as reference in `docs/archive/2026-10-02-unbuilt-screens-markup.html`. The items below still describe what its stage must wire.

### A.5.1 Scan Config

#### 1. Conversational mode (`POST /scan/chat`)
**What.** Chat interface where the AI asks the user about their workflow to derive scan settings.

**How.**
- `POST /scan/chat { session_id?, message }` — if `session_id` omitted, server creates a new session and returns it. Subsequent calls echo the same `session_id`.
- Server uses Anthropic SDK with prompt caching (system prompt is static; conversation deltas are user/assistant turns).
- Response shape: `{ session_id, reply: <string>, suggested_settings?: { ... }, done?: bool }`. When `done=true`, the AI has gathered enough to commit.
- New table `scan_chat_sessions` (id, created, last_active, session_json) — keep last 30 days, auto-cull older.
- After `done=true`, frontend calls `POST /scan/chat/{session_id}/commit` which writes the inferred settings to the `scan_config` config row.

#### 2. Structured form mode (`POST /scan/config`)
**What.** Form fields for paths, drives, exclusions, aggressiveness, complexity, priority extensions.

**How.**
- `GET /scan/config` returns the current saved config: `{ paths: [...], drives: ['C:\\','D:\\'], exclusions: ['node_modules','.git','__pycache__'], aggressiveness: 'moderate', complexity: 'balanced', priority_exts: ['.py','.md'], never_touch: [...] }`.
- `POST /scan/config { ... }` overwrites. Stored as a single JSON blob in the config table under key `scan.config`.
- All toggle/add/remove sub-actions (they were stubs in the deleted `actions.js`; the Scan config screen is now hidden, see the note above) collapse into this one POST — frontend rebuilds the full config object and sends it (simpler than per-field PATCH).

#### 3. Scan estimate (`GET /scan/estimate`)
**What.** "~12 min" hardcoded under the start button.

**How.**
- `GET /scan/estimate?paths=<comma-separated>` → `{ estimated_seconds, file_count, byte_count }`.
- Implementation: walk the requested paths with `os.walk` summing file counts; multiply by historical avg (samples from past scans recorded in a new `scan_runs` table). For first run, fall back to `~3 ms/file` heuristic.
- Run in `asyncio.to_thread` so the call doesn't block the event loop. Cache for 60 s keyed by paths.

#### 4. Use defaults (`POST /scan/config/defaults`)
**What.** "Skip configuration, use defaults" button.

**How.**
- Server-side default config: paths = entire indexed sandbox, exclusions = standard list, aggressiveness/complexity = `moderate`/`balanced`, priority_exts = inferred from existing files via `SELECT extension, COUNT(*) FROM files GROUP BY extension ORDER BY 2 DESC LIMIT 5`.
- `POST /scan/config/defaults` writes those defaults to `scan.config` and returns the result.

#### 5. Native folder picker (browse buttons)
**What.** "Browse" buttons next to path inputs.

**How.**
- IPC channel: `dialog.showOpenDialog({ properties: ['openDirectory'] })` exposed via preload as `electronAPI.pickDirectory()`. Returns the chosen path or `null`.
- All `settings-browse-*-path` and `scan-form-add-path` actions use this. No backend involvement.

### A.5.2 Scan Progress

#### 1. Live progress (`GET /scan/status` SSE)
**What.** Phase indicator (Index → Dedupe → Classify → Propose → Review), progress bar, current file, stats grid (rate, classified, remaining, ETA), throughput sparkline.

**How.**
- Convert `POST /scan` into a non-blocking trigger: it returns `{ scan_id }` immediately and runs the scan in a background task. Tracks progress in memory (not DB) keyed by `scan_id`.
- `GET /scan/status?id=<scan_id>` (SSE) streams `data:` events shaped like:
  ```json
  {"phase":"hashing","current_file":"D:\\\\Photos\\\\IMG_4821.jpg","done":74211,"total":215423,"rate_hz":847,"eta_s":480,"sparkline":[[ts,rate],...]}
  ```
- Phases: `indexing | hashing | classifying | proposing | reviewing | done | error`.
- Sparkline: rolling 60-sample window of files-per-second, sampled every 500 ms.
- On `done`, server emits a final event then closes the stream. Renderer clears the screen and navigates to scan-results.
- Single concurrent scan only — `POST /scan` returns 409 if `scan_running=true` (frontend shows toast "Scan already running").
- Persist scan summaries in `scan_runs` (id, started, ended, file_count, byte_count, duplicates_found, classified_count, status) for the estimate heuristic and Settings → Data stats.

#### 2. Pause / Stop / Tray
- `POST /scan/{id}/pause` — sets a pause flag the worker checks between files. `POST /scan/{id}/resume` to continue.
- `POST /scan/{id}/stop` — signals cancellation; the worker stops at the next safe boundary, leaves whatever was indexed in the DB.
- "Minimize to tray" is renderer-only (window.electronAPI.minimizeToTray) — backend doesn't know about it.

### A.5.3 Scan Results

#### 1. Duplicates (`GET /scan/duplicates`)
**What.** Group of duplicate files with reclaimable size; per-row "keep this copy" toggle.

**How.**
- `GET /scan/duplicates?scan_id=<id>` → `{ groups: [{ id, hash, count, total_size, reclaimable_size, files: [{ id, path, size, modified, ai_keep: bool }] }] }`.
- Backend query: `SELECT hash, COUNT(*), GROUP_CONCAT(path) FROM files WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1`. Hydrate each group with full file rows.
- AI selection of which copy to keep: in the classifier pass, score each duplicate by `(quality_signals)` — newest mtime, fewest "Copy of" / `(1)` markers, deepest folder match to category. Mark one `ai_keep=true` per group.

#### 2. Hardlink instead of delete
**What.** Toggle to keep duplicates as hardlinks.

**How.**
- `POST /dedup/execute { mode: 'delete'|'hardlink', selections: [{ group_id, keep_path, remove_paths: [...] }] }` returns `{ batch_id, removed: N, hardlinked: N, errors: [...] }`.
- Per group: keep `keep_path`, for each `remove_path`: log op, `os.remove`, then if `mode='hardlink'` call `os.link(keep_path, remove_path)`. NTFS hardlinks require source+dest on same volume; reject and report cross-volume cases.
- Logged via `operations_log` BEFORE each removal (so undo can re-create from the kept file's content if filesystem still has it — note: re-creation isn't possible without the original bytes, so undo of a delete-mode dedup only restores DB rows pointing to a missing file. Hardlink mode is fully reversible).

#### 3. Cleanup (`GET /scan/cleanup`)
**What.** Categorised junk-file list (temp, system junk, large unused).

**How.**
- `GET /scan/cleanup?scan_id=<id>` → `{ categories: [{ key, label, file_count, total_size, files: [{ id, path, size, last_accessed }] }] }`.
- Categories computed by rules:
  - **temp-files**: ext in `.tmp .temp .bak .log` OR path matches `*\Temp\*` / `*\AppData\Local\Temp\*`.
  - **system-junk**: ext in `.dmp .chk .old` OR path matches `*\$RECYCLE.BIN\*` / `Thumbs.db` / `.DS_Store`.
  - **large-unused**: size > 100 MB AND `atime` > 365 days ago.
- "Reclaim more…" reveals categories below the default threshold (e.g. files between 30-365 days unused).

#### 4. Cleanup execute (`POST /cleanup/execute`)
**What.** Execute the user-confirmed cleanup selections.

**How.**
- `POST /cleanup/execute { selections: [{ category, paths: [...] }] }` returns `{ batch_id, trashed: N, errors: [...] }`.
- Uses `send2trash` (Windows Recycle Bin, recoverable). Never `os.remove` for cleanup — user safety wins.
- Each path gets a `trash` op in `operations_log` before being trashed. Undo restores from the recycle bin (Windows-only; v2: cross-platform via a custom staging area).

#### 5. Reorganization (proposal handoff)
**What.** "Open File Tree to review proposed reorganization" CTA.

**How.**
- After scan done, the AI proposer (`backend/proposer.py`, new module — see "New backend modules") generates a proposed tree and stores it as a `proposals` row.
- The CTA navigates to the File Tree canvas and loads the proposal via `GET /proposals?status=pending&latest=true` — see A.4.7.

---

## A.6 Review Bin

**Hidden in Stage 2D Task 12a (2026-10-02).** The screen, its sidebar entry and its palette command are out of the DOM (no control may ship that does nothing); the mock-up markup is kept as reference in `docs/archive/2026-10-02-unbuilt-screens-markup.html`. The items below still describe what its stage must wire.

### 1. Listing (`GET /review-bin`)
**What.** Two-pane queue grouped by destination, with confidence bars.

**How.**
- `GET /review-bin?grouped=true` → `{ groups: [{ key, label, file_count, avg_confidence, files: [{ approval_id, file_id, path, name, ext, size, source, dest, confidence, ai_reason, action: 'move'|'rename'|'flag' }] }] }`.
- Group keys: the proposed destination directory, plus an `uncertain` synthetic group for confidence < 50%.
- Source: `SELECT * FROM approvals JOIN files ON approvals.file_id=files.id WHERE approvals.resolved=0`.
- `GET /review-bin/count` returns `{ count }` for the status bar / sidebar / tray badges (cheap COUNT(*) query).

### 2. Detail pane (`GET /review-bin/{approval_id}`)
**What.** Right pane shows AI rationale + similar past decisions.

**How.**
- `GET /review-bin/{approval_id}` → `{ approval, file, similar: [{ resolved_at, ai_suggestion, user_choice, file_context }] }`. Similar past decisions come from `SELECT * FROM training_signals WHERE file_context LIKE ? ORDER BY timestamp DESC LIMIT 5` — the `?` is a fuzzy match on the extension + parent-folder pattern of the current file.

### 3. Per-file actions (`POST` per row)
**What.** Approve / Reject / Modify-path / Snooze.

**How.**
- `POST /review-bin/{approval_id}/approve` — calls [mover.move_file](../backend/mover.py) with the approved dest, marks `resolved=1, resolution='approved'`, writes a `training_signals` row.
- `POST /review-bin/{approval_id}/reject` — marks `resolved=1, resolution='rejected'`, file stays in place, `training_signals` row.
- `PATCH /review-bin/{approval_id} { dest }` — updates `proposed_dest`, leaves `resolved=0`, used for "modify destination" inline edit.
- `POST /review-bin/{approval_id}/snooze { days }` — sets `resolved=0` plus a `snoozed_until` column (new — add to schema migration v3) so the UI hides it for `days`.

### 4. Group bulk actions
**What.** Approve-all / Reject-all per group.

**How.**
- `POST /review-bin/group/{group_key}/approve` → batches all approvals in that group through [mover.batch_move](../backend/mover.py); returns `{ batch_id, moved: N, errors: [...] }`. Snackbar "Approved 5 files. Undo" → undo via the batch_id.
- `POST /review-bin/group/{group_key}/reject` → marks all rejected.
- The `group_key` is the proposed destination path (URL-encoded) or the literal `uncertain`.

### 5. Empty / error states
**What.** "No files awaiting review" / backend offline.

**How.** Renderer detects `groups: []` and shows the empty-state SVG. Network error from the GET → "Couldn't connect to backend" banner with a "Retry" button (`data-action="retry-review-bin"` already exists).

---

## A.7 Everything Folder

**Hidden in Stage 2D Task 12a (2026-10-02).** The screen, its sidebar entry and its palette command are out of the DOM (no control may ship that does nothing); the mock-up markup is kept as reference in `docs/archive/2026-10-02-unbuilt-screens-markup.html`. The items below still describe what its stage must wire.

### 1. File list (`GET /ef/files`)
**What.** Filter (All/Unprocessed/Needs Review/Moving/Errors), sort, status dot per row, "currently moving" card.

**How.**
- `GET /ef/files?filter=all|unprocessed|needs-review|moving|errors&sort=name|landed|destination&dir=asc|desc&limit=200&offset=0` → `[{ id, path, name, landed_at, status, proposed_dest, error_msg? }]`.
- Status comes from `files.status` — extended enum: `indexed | classifying | needs-review | moving | settled | error`. Add the new states in a v3 migration if they aren't already representable.
- The Watcher updates status as files transition: `on_created → classifying → needs-review (if confidence < threshold) → moving → settled` or `error`.

### 2. Pause / resume AI (`POST /ai/pause`)
**What.** Header toggle that halts the classifier so the user can drop files in bulk.

**How.**
- `POST /ai/pause { paused: true|false }` — sets a global flag in the config table (`ai.paused`); the watcher and classifier read it on each loop iteration.
- `GET /ai/status` returns the flag plus the Ollama health for the AI Config settings pane.

### 3. EF path (`GET/POST /config/ef-path`)
**What.** Header subtitle shows the watched folder path.

**How.** Reuses the global config endpoints (see A.12.0). Key: `everything_folder.path`. Renderer reads on mount, updates after Settings change.

### 4. Currently moving card (live progress)
**What.** Card shows "Moving 1 of 3 files" with a progress bar.

**How.**
- Add to the `GET /events` SSE stream (cross-cutting): `data: {"event":"mover.progress","queue_len":3,"current_index":1,"current_file":"...","percent":62}`.
- The renderer subscribes once and updates the card live. No polling.

### 5. Error tooltip (per row)
**What.** Hovering an error-row dot shows the error message.

**How.** Already in the response shape (`error_msg`). Renderer puts it on `title=` attribute. No extra endpoint.

### 6. Retry / skip (per error row)
**What.** Right-click → Retry / Skip / Reveal in Explorer.

**How.**
- `POST /ef/files/{id}/retry` — re-runs classification + move for that file, clears the error. Sets `files.status='classifying'` again.
- `POST /ef/files/{id}/skip` — marks `files.status='settled'` (file stays in place; user has decided not to organise it).

---

## A.8 File Tree canvas

See A.4 above (the v1 design originally numbered this A.4; the doc reuses A.4 as the canvas section).

---

## A.9 Tag Canvas (overlay)

**Status (Stage 2C, 2026-09-13, D2C-3).** Stays a Stage 3 placeholder by decision, not oversight: the
overlay shows a "Not built yet — planned for Stage 3" banner over a dimmed mock body; its sidebar
entry and Close button still work. Inspector tag add/remove/undo (unrelated to this screen) works
today. A pill button "Ask File+" (sparkle icon, Ctrl+J) opens a static popout shell above Quick
Access — no model wired in this pass (Task 15, spec §9); none of A.9's routes below are implemented.

### 1. Tag tree (`GET /tags/tree`)
**What.** Left pane shows tags grouped by `tag_group` ("project:", "type:", "app:", ...).

**How.**
- `GET /tags/tree` → `[{ group, tags: [{ id, name, color, file_count }] }]`. Group is `tags.tag_group`.

### 2. Tag relationship graph (`GET /tags/graph`)
**What.** Right-pane SVG of co-occurrence relationships.

**How.**
- `GET /tags/graph?for=<tag_name>` → `{ nodes: [{ id, name, weight }], edges: [{ a, b, weight }] }` where weight is co-occurrence count.
- Backend query (heavy): `SELECT a.tag_id, b.tag_id, COUNT(DISTINCT a.file_id) FROM file_tags a JOIN file_tags b ON a.file_id=b.file_id AND a.tag_id<b.tag_id WHERE a.tag_id=? OR b.tag_id=? GROUP BY a.tag_id, b.tag_id`. Cache on disk for 5 min keyed by tag_id; invalidate on tag attach/detach.

### 3. Filter file grid by tag (`GET /files?tag=<name>`)
**What.** Bottom-right shows the files tagged with the selected tag.

**How.** `GET /files?tag=<name>&limit=12&offset=0`. Already partially implemented (the `tag` filter needs to be added; current list only filters by `path` and `q`).

### 4. Tag rename / merge / delete
**What.** Right-click a tag node in the canvas → rename / merge / delete.

**How.**
- `PATCH /tags/{id} { name?, color?, tag_group? }`.
- `POST /tags/merge { source_id, target_id }` — re-points all `file_tags.tag_id` entries from source to target, then deletes source. Logged as a special op in `operations_log` for undo.
- `DELETE /tags/{id}` — `ON DELETE CASCADE` on `file_tags` cleans the join. Logged for undo (undo restores tag and all `file_tags` rows captured before the delete).

---

## A.10 Context menus

**Status (Stage 2B, 2026-09-11).** File/folder/empty-area/sidebar-item menus done (see A.3.9); the Tab
menu's new-tab/close-tab are wired but duplicate/close-others/pin/rename-tab are not (no client-side
tab-state support built yet — `scripts/check_menu_cases.js` documents this as a known gap, not a
regression); the Tag chip context menu doesn't exist (no Tag Canvas screen yet).

**Status (Stage 2C, 2026-09-13).** Real tabs (Task 7) landed Duplicate tab and Close other tabs
(`cm-duplicate-tab`, `cm-close-other-tabs`); "Pin tab" and "Rename tab" were removed from the menu
rather than left as stubs (placeholders are debt — ruling). Applicability predicates added across
menus (see A.3.9). The Tag chip context menu remains unbuilt (Tag Canvas is still a Stage 3 banner).

Already covered in A.3.9 for browser context menus. Other variants:
- **Sidebar item context menu**: pin/unpin, rename, remove from sidebar — `POST /pins`, `DELETE /pins/{id}`, `PATCH /pins/{id} { label }`.
- **Tab context menu**: rename, move-left/right, close, close-others, close-right — purely client-side state, no backend.
- **Empty-area context menu** (right-click on blank space in browser): New file, New folder, Paste, Refresh.
- **Tag chip context menu**: navigate to tag canvas, filter by tag, rename, delete.

All menus are dynamically built in [app.js](../frontend/src/app.js) from a `CONTEXT_MENUS` map. The menu HTML doesn't need backend; only the actions inside do (and they reuse the endpoints elsewhere in this doc).

---

## A.11 First-run setup wizard

### 1. Setup detection
**What.** First launch of the app should open the setup window instead of the main window.

**How.**
- Add a `setup_complete` config row (boolean). [main.js](../frontend/main.js) on app-ready calls `GET /config?key=setup_complete`. If `false` or missing, opens `setup/index.html`. After completion, opens main and writes `setup_complete=true`.

### 2. Step 1 — welcome
No backend. Pure UI.

### 3. Step 2 — Everything Folder picker (`POST /config/ef-path`)
**What.** User picks where the Everything Folder lives.

**How.** `POST /config { key:'everything_folder.path', value:<path> }`. Validate the path is writable + creatable. If it doesn't exist, server creates it.

### 4. Step 3 — browser redirects
**What.** Toggles for Chrome / Firefox / Edge: redirect downloads to the Everything Folder.

**How.**
- Chrome / Edge: write to the user's Chrome `Local State` JSON to set `download.default_directory`. Risky and brittle — recommend instead launching the browser with `--download-bucket` flag set, or using the Native Messaging API.
- Honestly, this is a complex sub-project. v1 should just store the toggle state in the config and surface a one-liner showing the user how to manually point their browser. v1.5 implements the actual redirect.
- Endpoints: `POST /config { key:'browser_redirect.chrome', value:true|false }`, etc.

### 5. Step 4 — conversational scan config
**What.** Same chat flow as A.5.1.1.

**How.** Reuses `POST /scan/chat`. The `done=true` reply commits the inferred config.

### 6. Step 5 — AI setup
**What.** Probe Ollama, optionally set Anthropic API key.

**How.**
- `GET /ai/health/ollama` → `{ ok: bool, version, model_present: bool, current_model: string }`. Implementation: HTTP GET to `{OLLAMA_HOST}/api/tags`, check for the configured model.
- `POST /config { key:'ai.anthropic_api_key', value:<key> }`. Encrypt at rest using Windows DPAPI (via `cryptography` package, `Fernet` keyed off a machine-bound secret). If the user pastes an obvious dummy value, validate by making a test `messages` call with `max_tokens=1`.
- `POST /config { key:'setup_complete', value:true }` at the very end, then renderer calls `electronAPI.openMain()` + `closeSetup()`.

---

## A.12 Settings

**Stage 2D Task 12a (2026-10-02).** Settings shows only panes that do something today: Personalization,
Scan & Index, Shortcuts, Data, About. The Everything Folder, Downloads Folder, Organization Engine, AI
Configuration, Custom File Types and Privacy panes (§3–§8 below) are out of the DOM — markup in
`docs/archive/2026-10-02-unbuilt-screens-markup.html` — and come back with the stage that wires them.
Shortcuts is a read-only list of the real keys (rebinding, §9, is not built). Data has Empty FilePlus
trash, the write mode, **Clear Recent** (`DELETE /recent` → `{status, removed}`), **Clear icon and
thumbnail cache** (renderer LRUs `fpClearIconCaches`, main-process LRUs `electronAPI.clearIconCaches`,
backend shell-icon LRU `DELETE /shell/icons/cache` → `{cleared}`) and **Open logs folder**
(`electronAPI.openLogDir` → `shell.openPath(FILEPLUS_LOG_DIR or <repo>/logs)`); the §10 stats/export/
import/reset items are not built. About shows real values: `electronAPI.appInfo()` (app version from
package.json, Electron/Chromium/Node versions, log folder) and `/health` (backend version, env, write
mode); §11's `GET /version` was not needed.

### 0. Generic config endpoints (foundation)
**Done (Stage 2A/2B, 2026-09-11).** `config` table + `GET/GET-by-key/POST/DELETE /config`, `window.__fpConfig` cache, `config-change` op-log audit trail; `secure.*` encryption-at-rest not built (no AI settings pane yet).

**Stage 2D (2026-10-02, Task 12b).** `POST /config/merge {key, value, max_keys?}` → `{key, count}`
merges an object delta into the object stored at `key` (a missing or non-object value starts empty).
An entry already stored with a newer numeric `t` is kept, so deltas commute; with `max_keys` the
oldest entries by `t` are dropped. The patch is logged before the write, and the read-modify-write
runs in one `BEGIN IMMEDIATE` transaction. `ui.folder_views` is saved only through it (the window-close
keepalive fetch is capped at 64 KB). `saveSetting()` keeps one `POST /config` per key in flight; values
set meanwhile collapse into the newest.

**What.** The vast majority of Settings actions (once stubs in the deleted `actions.js`; now `case`s in app.js's click switch) collapse into a single key/value config layer.

**How.**
- New table: `config (key TEXT PRIMARY KEY, value TEXT, updated TEXT)`. Values stored as JSON-encoded strings so any type is representable.
- Endpoints:
  - `GET /config` → `{ key1: value1, key2: value2, ... }` (everything).
  - `GET /config/{key}` → `{ key, value }`.
  - `POST /config { key, value }` — upsert.
  - `DELETE /config/{key}`.
- Frontend on app boot fetches `GET /config`, caches in `window.__fpConfig`, and re-fetches whenever Settings is opened. Each settings widget reads/writes via these endpoints.
- Encrypt sensitive keys at rest (`ai.anthropic_api_key`). Prefix conventionally encrypted keys with `secure.` so the read path knows to decrypt.
- Audit: every config write logs to `operations_log` with `op_type='config-change'`, source = key, dest = redacted-or-value, so undo can roll back a settings change.

### 1. Personalization pane
**Done (Stage 2B/Task 7, 2026-09-11).** Theme/density/accent/show-notifications/show-extensions/show-hidden/click-mode persisted via `saveSetting()` -> `POST /config`; localStorage stays the fast-paint cache. Glow/inspector-width/tab-style config keys not built (no corresponding UI controls yet).

- Theme / density / accent / glow / show-notifications / inspector-width / show-extensions / show-hidden / click-mode / tab-style — all single config keys (`ui.theme`, `ui.density`, etc.). Keep localStorage as fast-paint cache; canonical state in config table.
- Reset accent button: `DELETE /config/ui.accent_hex`.

**Done in 2C (2026-09-13).** New keys, all via the same `saveSetting()` -> `POST /config` path:
`ui.inspector_open, ui.sidebar_thispc_open, ui.quick_access_hidden, ui.list_scale, ui.view_mode,
ui.sort, ui.dynamic_media_view, ui.backspace_deletes, ui.properties_mode, ui.icon_source`. "Spacious"
density got its missing CSS rule (Task 8, spec §3.14); "Backspace deletes" lives under Personalization
› Keyboard (Task 9); the known-folders checkboxes for Quick Access restoration live here too.

**Stage 2D (2026-10-02).** New keys: `ui.folder_views` (merge-only, see #0), `ui.view_migrated_2d`,
`ui.sidebar_w` and `ui.inspector_w` (screen px; the old `ui.inspector_width` is read only when
`ui.inspector_w` is unset — the inspector width is now built and persisted), `ui.thispc_view`
(`tiles | details`). `ui.list_scale` and `ui.view_mode` are deleted by the one-time migration.

### 2. Scan & Index pane
**Done in 2C (2026-09-13).** Real data replaces the placeholder: `GET /index/status` (indexed roots,
file counts, last-run time), Re-index and Remove-from-index buttons per root. The folder context-menu
item is relabelled "Index for This PC search" (Task 1, Task 14; spec §8.7).

**Pass 2 (2026-09-15).** `DELETE /index` drops every `files` row under the root (whether or not the
file still exists) instead of running the stale sweep, which only ever deleted rows whose path had
vanished — so "Remove" now really does what the confirm modal promises, and `removed` is the real
count. The pane also shows `GET /index/status`'s `error` when the last background index failed.

- Indexed drives: `config['scan.indexed_drives']` JSON array. Add/remove via POST.
- Ignore patterns: `config['scan.ignore_patterns']` JSON array.
- Content analysis toggle: `config['scan.content_analysis']`.
- Re-scan schedule: `config['scan.schedule']` enum `manual|daily|weekly`. When `daily|weekly`, FastAPI startup schedules a background `asyncio` task that triggers `POST /scan` at the configured cadence.
- "Run new scan" navigates to scan-config; no backend call.

### 3. Everything Folder pane
- `config['everything_folder.path']`, `config['everything_folder.confidence_threshold']`, `config['everything_folder.review_timeout_days']`, `config['everything_folder.excluded_exts']`, `config['everything_folder.notify_mode']`, `config['everything_folder.stuck_threshold_hours']`.
- Browser redirect toggles: `config['browser_redirect.chrome'|'firefox'|'edge']`.
- When path changes, the watcher must restart against the new path: `POST /watcher/restart` returns `{ status: 'running'|'failed', error? }`.

### 4. Downloads Folder pane
- `config['downloads.path']`, `config['downloads.purge_after_days']`, `config['downloads.purge_action']` (`recycle|hard-delete`), `config['downloads.excluded_exts']`.
- A daily-scheduled task purges old downloads per these settings via `send2trash` (recycle) or `os.remove` (hard-delete; gated by typed-confirmation modal in the UI).

### 5. Organization Engine pane
- `config['organize.autonomy']` (`passive|suggest|proactive`), `config['organize.batch_size']`, `config['organize.review_threshold']`, `config['organize.propose_rename']`, `config['organize.propose_delete_dupes']`.
- `passive`: AI never proposes anything proactively. `suggest`: AI sends to Review Bin. `proactive`: AI auto-moves above the confidence threshold.
- These flags are read by [classifier.classify](../backend/classifier.py) and [watcher.FilePlusEventHandler](../backend/watcher.py) on each event.

### 6. AI Configuration pane
- Ollama:
  - `GET /ai/health/ollama` → `{ ok, version, models_available: [...], current_model }`.
  - `config['ai.ollama.model']` — selected model.
  - `POST /ai/test { sample_path }` runs a one-off classification on a sample file; returns `{ category, confidence, source, latency_ms }`.
- Cloud (Anthropic):
  - `config['ai.cloud_enabled']`, `config['secure.anthropic_api_key']` (encrypted), `config['ai.claude_model']`, `config['ai.temperature']`, `config['ai.token_cap_per_call']`, `config['ai.cost_cap_usd']`.
  - Cost tracking table: `ai_calls (id, ts, model, input_tokens, output_tokens, cost_usd)`. Rolled up via `GET /ai/stats` → `{ today_cost_usd, week_cost_usd, total_calls, avg_latency_ms }`.
  - `POST /ai/stats/reset` — truncates `ai_calls`.

### 7. Custom File Types pane
- `GET /custom-types` → `[{ id, name, exts: [...], category, color }]`.
- `POST /custom-types { name, exts, category, color }` and `DELETE /custom-types/{id}`.
- These rows are read by the tagger to decide system tags for non-standard extensions.

### 8. Privacy pane
- `config['privacy.send_telemetry']`, `config['privacy.crash_reports']`, etc. — Currently no telemetry is collected; these are placeholders. v1: render the UI but treat as no-ops until v2 actually wires telemetry.

### 9. Shortcuts pane
**Stage 2D (2026-10-02, Task 12a).** Built as a read-only list of the keys the app really handles; no backend. Rebinding (below) is not built.

- `GET /config/shortcuts` → `[{ action, default_keys, current_keys }]`.
- `POST /config/shortcuts { action, keys }` — validate no duplicate binding; rebind globally on next app start (or hot-rebind via IPC).
- `POST /config/shortcuts/reset` — restores defaults.

### 10. Data pane (storage stats / export / import)
**Stage 2D (2026-10-02, Task 12a).** Shows only what works: Empty FilePlus trash, the write mode, Clear Recent, Clear icon and thumbnail cache, Open logs folder (see the A.12 note). Nothing below is built.

- `GET /data/stats` → `{ db_size_bytes, files_indexed, total_indexed_bytes, snapshot_count, snapshot_size_bytes, ai_calls_count, ai_calls_cost_usd }`.
- `GET /db/export` → streams the SQLite file as a download (`Content-Type: application/octet-stream`).
- `POST /db/import` — uploads a .db file; backend validates schema_version, swaps in atomically (rename old to .db.bak), restarts watcher.
- `GET /diagnostics/export` — bundles last 7 days of operations_log + recent crash logs + config (with secrets redacted) into a zip.
- `DELETE /tags/ai-generated` — wipes all tags where `tag_type='ai'`, keeping system + user tags. Logged as a single batch op for undo.
- `POST /reset { scope: 'organization'|'snapshots'|'defaults' }`:
  - `organization`: clears `approvals`, `proposals`, `training_signals`.
  - `snapshots`: clears `snapshots`. Also frees disk if any tree_jsons are huge.
  - `defaults`: truncates `config`, leaves all file/tag/operation data.

### 11. About pane
**Stage 2D (2026-10-02, Task 12a).** Built without `GET /version`: `electronAPI.appInfo()` (app version, Electron/Chromium/Node, log folder) plus `/health` (`version`, `env`, `write_unlocked`).

- `GET /version` → `{ app_version, schema_version, python_version, sqlite_version }`.
- "Open licenses" — opens a static HTML page bundled with the app; no backend.

---

## A.13 Tray popout

### 1. Tray content (Recent / Favorites switching)
**What.** [tray/index.html:434](../frontend/tray/index.html#L434) has hardcoded rows. Switching tabs is a stub.

**How.** Reuses `GET /recent?limit=10` and `GET /favorites?limit=10`. The tray is a smaller window; cap row count.

### 2. Active download block (`GET /downloads/active`)
**What.** Header card showing an in-progress download.

**How.**
- `GET /downloads/active` → `[{ id, path, name, size_total, size_done, started_at, source_url? }]`.
- Source: a new `downloads` table populated by either (a) the browser-redirect integration (v2) or (b) watcher detecting `.crdownload` / `.part` / `.tmp` files in the Downloads folder. Currently watcher already filters those out; un-filter them so they show up as `status='downloading'`.
- `POST /downloads/{id}/cancel` — deletes the partial file + DB row, logs op.

### 3. Currently moving card (`GET /events` SSE)
**What.** Live progress card during AI moves.

**How.** Same SSE stream as A.7.4.

### 4. Tray-specific actions
- `tray-open-file` / `tray-reveal-in-app` / `tray-reveal-in-explorer` / `tray-copy-path` / `tray-add-favorite` / `tray-remove-from-list` — reuse the same endpoints as the main-window equivalents.

### 5. **Bug: inline `<script>` violates CSP**
**What.** [tray/index.html:574](../frontend/tray/index.html#L574) has an inline `<script>` block. The CSP at [tray/index.html:7](../frontend/tray/index.html#L7) is `script-src 'self'` — no `'unsafe-inline'`. The script is blocked at runtime; tray actions don't work.

**How.** Move the inline script to a new `frontend/tray/tray.js` file and reference via `<script src="tray.js"></script>`. Not a backend item, but flag here because the entire tray window is dead until this is fixed and there is no point integrating endpoints into a window whose script never runs.

---

## A.14 Command Palette

### 1. Search mode (`GET /search?q=`)
**What.** Type a query → list of files / folders / tags / commands.

**How.**
- `GET /search?q=<query>&limit=30` → `{ files: [...], folders: [...], tags: [...], commands: [] }`.
- Files: `SELECT * FROM files WHERE filename LIKE '%q%' OR path LIKE '%q%' OR category=q ORDER BY (filename = q) DESC, length(filename) ASC LIMIT 10`. Add an FTS5 virtual table over filename+path+category for fuzzier matching once SQLite FTS is wired.
- Folders: derived from the distinct dirnames of `files.path`.
- Tags: `SELECT * FROM tags WHERE name LIKE '%q%' LIMIT 5`.
- Commands: a static frontend list (no backend); merged client-side.
- Frontend infers query mode from the leading char: `>` = commands only, `#` = tags only, `/` = paths only, otherwise = files+folders+tags+commands.

**Superseded in 2C (2026-09-13).** The palette's file-search mode is replaced by one command
("Search files for '<text>'") that hands the text to the toolbar search (`GET /fs/search`) — one
search code path instead of two (Task 14, spec §8.5). Command/tag palette modes are unaffected.

### 2. Chat mode (`POST /palette/chat`)
**Hidden in Stage 2D Task 12a (2026-10-02):** the Search/Chat toggle and the chat pane (with its three
plan buttons) are out of the DOM until this is built; markup in the archive file named under A.4.

**What.** "Plan something with the AI."

**How.**
- `POST /palette/chat { session_id?, message, context? }` — server uses Anthropic SDK with prompt caching. Context includes recent files (`/recent?limit=20`), current directory, current screen.
- Streamed response: SSE with `data: { delta: '...' }` events terminating in `{ done: true, plan: { moves, tags, deletes, ... } }`.
- `POST /palette/chat/{session_id}/send-to-review-bin` — converts the structured plan into `approvals` rows that flow into Review Bin.
- `POST /palette/chat/{session_id}/approve-all` — applies the plan immediately (typed confirmation modal first; goes through mover.batch_move).

---

## Cross-cutting

### 1. Notifications gate
**What.** Toasts/snackbars are gated on `localStorage['fp-notifications-enabled']` (default OFF). Errors bypass the gate. Several stub action handlers fire `showToast(...)` which is silent under the default settings — this is masking unwired actions during polish.

**How.**
- **Done (Stage 2D, 2026-10-02).** `actions.js` is gone (Stage 2B). `scripts/check_menu_cases.js` now fails verify on any `data-action` without a `case` or an `IN_SCOPE_ACTIONS` entry, with no exemptions, and the unbuilt screens' controls left the DOM (Task 12a), so no control falls into the silent stub. The switch's default branch counts hits in `window.__fpStubHits` (a test asserts 0 after clicking every visible control).

### 2. Operations log
**Done (Stage 2A, 2026-09-11).** `backend/operations_log.py` is real: `log_operation` (inserts `executed=0` before the act), `mark_executed`, `mark_error`, `mark_undone`, `list_operations`, `list_batch`, `pending_operations` and `reconcile_pending` (run in the API lifespan on every startup, feeding `GET /operations/pending` and the crash-recovery notice). Undo is a logged inverse (`undo_of`) through `POST /operations/{id}/undo` and `POST /operations/batch/{batch_id}/undo`. Still a proposal: the `payload` / `redo_of` / `undone_at` schema below. The text that follows is the original plan.

**What.** Every filesystem-touching operation must call `operations_log.log_operation()` BEFORE execution, per [CLAUDE.md](../CLAUDE.md)'s hard safety principle. Currently [operations_log.py](../backend/operations_log.py) is all stubs.

**How.**
- Implement [operations_log](../backend/operations_log.py) per Phase 10 spec in [PLAN.md](archive/PLAN.md):
  - `log_operation(op_type, source_path, dest_path, batch_id, reason) -> int` inserts with `executed=0`.
  - `mark_executed(op_id)` sets `executed=1`.
  - `undo_operation(op_id)` reverses (move dest→src etc.) and sets `undone=1`.
  - `undo_batch(batch_id)` undoes in LIFO order.
- Wrap all paths that hit `/fs/move`, `/fs/rename`, `/fs/trash`, `/fs/delete`, etc. with a pre-flight log entry (server-side); the renderer fires the request and displays the operations-log id in any error toast for traceability.
- New endpoints: `GET /operations?limit=50&before_id=<id>` (paginated), `GET /operations/{id}`, `POST /operations/{id}/undo`, `POST /operations/batch/{batch_id}/undo`.
- Crash recovery on app startup: `SELECT * FROM operations_log WHERE executed=0` — if rows exist, surface a modal offering "complete the pending operations" or "undo (revert the partial state)".

### 3. Tab/session state per-tab
**What.** Per-tab state lives in JS tab records (`createTab()` in app.js: `{id, screen, label, path, history, historyIndex, view, iconSize, scrollTop, scrollLeft, selection, search, listing, stale}`); the DOM carries only `data-tab-id`. `switchScreen(id, labelOverride)` mutates the active tab's record and `activateTab(id)` saves the outgoing tab and paints the incoming one (from its cached `listing`, then revalidates — Stage 2D §4.2). Backend has no role yet.

**How.**
- New endpoint `POST /session/snapshot` body `{ tabs: [{ id, screen, label, path? }], active }`. Auto-snapshot on tab change (debounced 1s). Stored as a single config row `ui.session`.
- `GET /session/last` on app launch — feeds the crash-recovery modal so reopened tabs come back with their last screens.

### 4. URL prefix consistency
**Decided 2026-09-10 (Stage 0): NO `/api/` prefix.** All routes are registered bare; stub strings and INTEGRATION comments were aligned in Stage 0.

### 5. CORS hardening
**What.** [api.py:34](../backend/api.py#L34) sets `allow_origins=["*"]`. Overly permissive for a localhost-only Electron app.

**How.**
- Set `allow_origins=["http://localhost", "http://127.0.0.1", "file://"]` (Electron loads from `file://` so the Origin header is `null` — but with `allow_origin_regex='^(file://|http://localhost.*|http://127\\.0\\.0\\.1.*|null)$'` you cover all paths). Or, since the Electron renderer doesn't enforce CORS for `file://` origins anyway, simply drop the `*` to a denylist when you ship — for now `*` is acceptable in dev but log a TODO.

### 6. Performance — DB indexes
**What.** Schema has only the implicit primary-key indexes plus `files.path UNIQUE`. Many queries lack indexes.

**How.** Add in a v3 migration:
```sql
CREATE INDEX idx_files_hash         ON files(hash);          -- duplicate detection
CREATE INDEX idx_files_category     ON files(category);      -- category filters
CREATE INDEX idx_files_status       ON files(status);        -- EF list filters
CREATE INDEX idx_files_modified     ON files(modified);      -- recent / sort by mtime
CREATE INDEX idx_files_extension    ON files(extension);     -- ext-based queries
CREATE INDEX idx_file_tags_file     ON file_tags(file_id);   -- inspector tags
CREATE INDEX idx_file_tags_tag      ON file_tags(tag_id);    -- tag → files
CREATE INDEX idx_oplog_batch        ON operations_log(batch_id);
CREATE INDEX idx_oplog_executed     ON operations_log(executed) WHERE executed = 0;
CREATE INDEX idx_oplog_timestamp    ON operations_log(timestamp);
CREATE INDEX idx_oplog_paths        ON operations_log(source_path, dest_path);
CREATE INDEX idx_approvals_resolved ON approvals(resolved) WHERE resolved = 0;
CREATE INDEX idx_approvals_file     ON approvals(file_id);
```
For a 200K-file index, these turn `GET /review-bin/count` from a full scan to a partial-index lookup (~1 ms).

### 7. Performance — async-safe scans
**What.** [indexer.scan_directory](../backend/indexer.py) wraps `os.walk`/`hash_file` inside an async function but calls them synchronously. The event loop blocks for the entire scan; `/health` and other endpoints time out during a 200 K-file walk.

**How.**
- Wrap walk + hash + stat work in `await asyncio.to_thread(...)`. Per-file granularity is too chatty; bulk every 500 files into a single thread call.
- Or run scans in a `concurrent.futures.ProcessPoolExecutor` so they don't share the GIL with the API. Single worker is enough.
- Add `await asyncio.sleep(0)` between batches so the event loop yields.
- Same fix needed in [api._scandir_entries](../backend/api.py#L92).

### 8. Performance — cheap hash for large files
**What.** [hasher.hash_file](../backend/hasher.py) reads the entire file. For a 4 GB video this is a multi-second I/O hog and yields a hash you'll rarely use for dedup (videos are rarely byte-identical duplicates anyway).

**How.**
- For files > 100 MB, compute a "signature hash" from `(size, first 64 KB, last 64 KB, middle 64 KB)`. Store in the same column with a `sig:` prefix so the dedup query knows it's a partial hash. Files with matching signatures get a full hash on demand for confirmation.
- For files < 100 MB, full hash as today.
- Memoise on `(path, mtime, size)` — if mtime hasn't changed, no need to re-hash on subsequent scans (the existing upsert already skips by path, but `index_file` always re-hashes; gate on `WHERE files.path=? AND files.modified=? AND files.size=?` first, return the cached hash).

### 9. Pagination on `/files`
**Partly done (pass 2, 2026-09-15).** `GET /files` no longer returns ALL rows: `limit` defaults to 200 and is
capped at 1000 (`?limit=&offset=`), so a bare call can never serialise the whole table. Still open:
`order_by=name|size|mtime&dir=asc|desc`, and infinite scroll in the renderer (no renderer calls this route yet).

### 10. SSE event bus
**What.** Watcher events, mover progress, scan progress, approvals updates — all currently demand polling.

**How.**
- Single `GET /events` SSE stream that emits typed events: `{event: 'file.indexed' | 'file.classified' | 'file.moved' | 'mover.progress' | 'scan.phase' | 'approval.queued' | 'approval.resolved' | 'config.changed', payload: {...}}`.
- Backend uses `asyncio.Queue` per connected client; modules `await event_bus.publish(...)` from anywhere.
- Renderer connects on app boot, dispatches events into the existing screen update functions. No more 30-second polls for `/health` (still want it as a heartbeat) or `/review-bin/count`.

### 11. Schema-migration safety
**What.** [database._run_migrations](../backend/database.py#L137) silently swallows `Exception` on each `ALTER TABLE`. A real SQL bug in a future migration is invisible. Also, the v1→v2 ALTERs all target columns that the `CREATE TABLE IF NOT EXISTS` statements already define — so on a fresh DB, every ALTER throws and the catch hides it. Wasted work and worse, masks real errors.

**How.**
- Inspect `PRAGMA table_info(<table>)` before issuing `ALTER TABLE`. Only run if the column is missing.
- Catch only `aiosqlite.OperationalError` matching "duplicate column", not bare `Exception`. Re-raise everything else.
- Better: store the schema version BEFORE the column was added in the migration block, and run the ALTER only when actually upgrading from a pre-column version.

### 12. Backup before migration
**What.** Migrations modify the DB in place. A failed migration could corrupt user data.

**How.** In [init_db](../backend/database.py#L159), before applying migrations, copy the DB file to `<db>.pre-vN.bak`. If migration succeeds, optionally cull older backups (keep last 3).

### 13. Long-running scan as background task
**What.** [POST /scan](../backend/api.py#L159) runs synchronously inside the request; client times out at 60 s.

**How.** See A.5.2.1: convert to a background task tracked by `scan_id`, expose progress via SSE, return immediately.

### 14. Tests — most are placeholders
**Superseded (Stage 2A onward).** Every backend module that exists has real pytest coverage (493 passed + 3 strict xfail at the end of Stage 2D); `scripts/verify.ps1` runs it before every commit. The modules for unbuilt features (classifier, snapshotter, proposer) are still to come.

**What (original).** [tests/](../tests/) has files for classifier/mover/operations_log/snapshotter/tagger but the modules they test are stubs.

**How.** As each backend module lands, write tests against it. CI gate (when packaging starts) should require `pytest` green. No CI work needed for v1 personal use; add when distributing.

### 15. Health endpoint extension
**Superseded.** `/health` returns `{status, version, db_ok, write_unlocked, env, pending_ops, index_running, auth, shell_icons}` (see A.1 #3); the AI/scan fields below wait for their stages.

**What (original).** `/health` returned `{status, version}` only.

**How.** Extend per A.1.3: add `scan_running`, `ai_status`, `watcher_running`, `db_ok`, `disk_free_gb_app_data`, `pending_approvals`. Renderer's status dot can then map a single fetch to multiple indicators.

### 16. New backend modules (not in current repo)
The following modules are referenced repeatedly in this doc but don't yet exist; create as part of the backend implementation pass:
- `backend/proposer.py` — generates the AI reorganization proposal after a scan (uses classifier outputs + folder-fit scoring).
- `backend/scanner.py` — orchestrates the multi-phase scan pipeline (index → hash → dedup → classify → propose). Currently the orchestration logic is implicit in [api.trigger_scan](../backend/api.py#L160).
- `backend/event_bus.py` — pub/sub primitive for the SSE stream (cross-cutting #10).
- `backend/preview.py` — the polymorphic preview generator (A.3.3).
- `backend/thumbs.py` — thumbnail cache (A.2.1.5).
- `backend/encryption.py` — DPAPI wrapper for `secure.*` config keys (A.11.6).
- `backend/cost_tracker.py` — Anthropic call accounting (A.12.6).

### 17. Global undo / redo (Ctrl+Z / Ctrl+Shift+Z)

**Done for Browser file ops + tag/favorite/pin (Stage 2A/2B/Task 8a, 2026-09-11); superseded design for
the rest.** Move/rename/trash/copy/touch/mkdir undo via `POST /operations/batch/{batch_id}/undo`
(single-op routes mint a batch id so Ctrl+Z always targets a batch, not the `payload`/`redo_of`/
`undone_at` schema drafted below); tag add/remove and favorite/pin add/remove/reorder/rename got
server-side inverses in Task 8a. Redo replays the same batch-undo route on the inverse batch. Review
Bin / Tag canvas / File Tree canvas / Scan results / Everything Folder rows are all unbuilt (those
screens don't exist yet) — not attempted this stage.

**What.** Any action that affects a file or folder must be reversible via Ctrl+Z, and a reversed action must be replayable via Ctrl+Shift+Z. Scope is the full set of file/folder operations the app exposes — not just filesystem writes — so the user has one mental model: "if I just did something, I can take it back, and I can put it back."

**Actions in scope (must be undoable):**

| Surface | Operation | Forward op | Reverse |
|---|---|---|---|
| Browser / context menu / drag-drop | Move | `POST /fs/move` | move dest → src |
| Browser / context menu / F2 | Rename | `POST /fs/rename` | rename back to old name |
| Browser / context menu | Trash (soft delete) | `POST /fs/trash` | restore from recycle bin |
| Browser / context menu | Permanent delete | `POST /fs/delete` | **cannot undo** — show typed-confirmation modal, no entry on the undo stack |
| Browser / context menu | Copy / paste | `POST /fs/copy` | trash the copies (still recoverable) |
| Browser / context menu | Compress | `POST /fs/compress` | trash the .zip; originals already untouched |
| Browser / context menu | Touch (new file) | `POST /fs/touch` | trash the new file |
| Browser / context menu | Mkdir (new folder) | `POST /fs/mkdir` | trash the new folder |
| Browser / context menu | Add tag | `POST /files/{id}/tags` | DELETE the tag attachment |
| Browser / inspector | Remove tag | `DELETE /files/{id}/tags/{tag_id}` | re-attach tag |
| Home / context menu | Favorite | `POST /favorites` | DELETE favorite |
| Home / star button | Unfavorite | `DELETE /favorites/{path}` | re-add at same position |
| Home / favorites drag | Reorder favorites | `POST /favorites/reorder` | restore previous order |
| Sidebar / context menu | Pin folder | `POST /pins` | DELETE pin |
| Sidebar / context menu | Unpin folder | `DELETE /pins/{id}` | re-create pin at same position |
| Sidebar / context menu | Rename pin label | `PATCH /pins/{id}` | restore old label |
| Review Bin | Approve (file is moved) | `POST /review-bin/{id}/approve` | reverse the move + reset approval to `resolved=0` |
| Review Bin | Reject | `POST /review-bin/{id}/reject` | reset approval to `resolved=0` |
| Review Bin | Modify destination | `PATCH /review-bin/{id}` | restore previous proposed_dest |
| Review Bin | Snooze | `POST /review-bin/{id}/snooze` | clear snoozed_until |
| Review Bin / Browser | Group bulk approve / reject | batch | undo whole batch as one Ctrl+Z |
| Tag canvas | Tag rename | `PATCH /tags/{id}` | restore old name |
| Tag canvas | Tag merge | `POST /tags/merge` | re-split (recreate source tag, re-point file_tags rows captured at merge time) |
| Tag canvas | Tag delete | `DELETE /tags/{id}` | recreate tag + restore file_tags rows |
| File Tree canvas | Drag-to-reparent (after execute) | proposal batch | undo whole batch |
| File Tree canvas / right-rail | Snapshot create | `POST /snapshots` | DELETE snapshot |
| File Tree canvas | Snapshot restore | `POST /snapshots/{id}/restore` | undo the move batch the restore generated |
| Scan results | Dedup execute (hardlink mode) | `POST /dedup/execute` | `os.unlink` the hardlinks |
| Scan results | Dedup execute (delete mode) | `POST /dedup/execute` | **cannot undo** — bytes gone; gated by typed-confirmation |
| Scan results | Cleanup execute | `POST /cleanup/execute` | restore from recycle bin |
| Everything Folder | Auto-move (watcher classifier) | `mover.move_file` | reverse move |
| Everything Folder | Manual override | move/skip/retry | reverse move; un-skip is a flag flip |

**Actions NOT undoable (one-way; show typed-confirmation modal instead):**
- Permanent delete (`POST /fs/delete`)
- Dedup execute in `delete` mode (the byte content is gone)
- DB import (`POST /db/import`) — replaces the whole DB; a pre-import backup file is the recovery path, not the undo stack
- Reset operations (`POST /reset` for organization / snapshots / defaults)

These actions log to operations_log with `op_type` ending in `:final` (e.g. `delete:final`) so the renderer can detect "this op is on the log but is not undoable" and either skip it on the undo stack or surface it as a tombstone.

**How.**

#### Backend

This builds directly on Cross-cutting #2 (Operations log). Schema additions to `operations_log` (v3 migration):

```sql
ALTER TABLE operations_log ADD COLUMN payload TEXT;       -- JSON: full reversal data (old name, old position, captured tag_ids, etc.)
ALTER TABLE operations_log ADD COLUMN redo_of INTEGER;    -- nullable; if set, points to the original op this row redoes
ALTER TABLE operations_log ADD COLUMN undone_at TEXT;     -- ISO timestamp when undone=1 was set; clears on redo
```

The `payload` column is the missing piece that makes non-filesystem ops reversible. Today the table only has `source_path` / `dest_path`; that's enough for moves and renames but not for "remove tag" (need the tag_id to restore) or "reorder favorites" (need the prior order). Every `log_operation()` call carries a `payload: dict` argument now; the function serialises to JSON.

Per-op handlers (in [`backend/operations_log.py`](../backend/operations_log.py)):
```python
async def undo_operation(op_id: int) -> None:
    """Reverse a single op by dispatching on op_type."""
    row = await get_op(op_id)
    if row['undone']: raise AlreadyUndone
    handler = UNDO_HANDLERS[row['op_type']]   # dict of op_type -> async fn
    await handler(row)
    await mark_undone(op_id)

UNDO_HANDLERS = {
    'move':            _undo_move,        # uses source_path, dest_path
    'rename':          _undo_rename,      # uses payload['old_name']
    'trash':           _undo_trash,       # restore from recycle bin (winshell or PowerShell Shell.Application)
    'tag.attach':      _undo_tag_attach,  # DELETE file_tags row
    'tag.detach':      _undo_tag_detach,  # re-INSERT file_tags row from payload
    'favorite.add':    _undo_fav_add,     # DELETE favorite
    'favorite.remove': _undo_fav_remove,  # re-INSERT at payload['position']
    'favorite.reorder':_undo_fav_reorder, # restore payload['old_order']
    'pin.add':         _undo_pin_add,
    'pin.remove':      _undo_pin_remove,
    'pin.rename':      _undo_pin_rename,
    'tag.rename':      _undo_tag_rename,
    'tag.merge':       _undo_tag_merge,   # recreate tag + payload['file_tags_captured']
    'tag.delete':      _undo_tag_delete,
    'snapshot.create': _undo_snapshot_create,
    'snapshot.restore':_undo_snapshot_restore,  # undo_batch on payload['restore_batch_id']
    'approval.approve':_undo_approval_approve,  # undo move + reset approval
    'approval.reject': _undo_approval_reject,
    'config-change':   _undo_config_change,     # already in #2
    # batches handled separately via undo_batch(batch_id)
}
```

A mirror `REDO_HANDLERS` map re-applies each op_type from the captured payload — for most ops, redo === re-doing the original API call, so the redo handler just calls into the same forward function with the original request shape (also stashed in `payload['request']`).

New endpoints:
- `POST /undo` — pops the *current session's* undo stack and reverses the top op. Returns `{ undone_op_id, op_type, summary }`. 404 if the stack is empty.
- `POST /redo` — pops the redo stack and re-applies. Returns `{ redone_op_id, op_type, summary }`.
- `POST /undo/{op_id}` — explicit single-op undo (used by Inspector → History tab).
- `POST /undo/batch/{batch_id}` — batch undo (already in #2).
- `GET /undo/stack` → `{ undo: [{ op_id, op_type, summary, ts }], redo: [...] }` for the Settings → Data → "Recent activity" pane and for crash recovery.

**Stack semantics (server-side):**
- A single in-memory stack pair (`undo_stack`, `redo_stack`) of op_ids, scoped per app session (single user, single app instance, so global is fine for v1).
- On every successful `mark_executed(op_id)` for an undoable op, push to `undo_stack` and clear `redo_stack`.
- On `undo`: pop `undo_stack` → call `undo_operation` → push to `redo_stack`.
- On `redo`: pop `redo_stack` → call `redo_operation` → push to `undo_stack`.
- On any new forward op: push to `undo_stack`, clear `redo_stack` (standard text-editor semantics).
- On app restart: rebuild `undo_stack` from `SELECT id FROM operations_log WHERE undone=0 AND op_type NOT LIKE '%:final' ORDER BY id DESC LIMIT 50`. Don't restore the redo stack — it's session-scoped (otherwise the user could redo something across an app restart, which is surprising). Cap at 50 entries to bound memory; older log rows are still on disk and accessible via `POST /undo/{op_id}`.

**Single-instance lock:** the undo stack is global per app instance. If the user runs two FilePlus instances against the same DB, the stacks would diverge — block multi-instance at the Electron layer with `app.requestSingleInstanceLock()` (already in docs/archive/PLAN.md §10), full stop.

**Atomicity:** every undo/redo handler must itself log a new op (with `redo_of` pointing back to the original) — i.e. undoing a move logs a *new* `move` op (in reverse) plus updates the original row's `undone=1`. This way the operations_log remains an append-only audit trail and the Inspector → History tab shows undos as their own entries with a "(undo)" badge.

#### Frontend

- New file: `frontend/src/undo.js`. Two functions:
  ```js
  async function performUndo() {
    const r = await fetch(`${API_BASE}/undo`, { method: 'POST' });
    if (r.status === 404) { showToast('Nothing to undo', 'default'); return; }
    if (!r.ok) { showToast(`Undo failed: HTTP ${r.status}`, 'error'); return; }
    const { op_type, summary } = await r.json();
    showSnackbar(`Undid: ${summary}`, 'Redo', performRedo);
    // Refresh whatever surface this op affected. Crude approach: fire a custom event
    // and have each screen module re-fetch its data on receiving it.
    window.dispatchEvent(new CustomEvent('fp:undo-redo'));
  }
  async function performRedo() { /* mirror */ }
  ```
- Keyboard hook in [app.js](../frontend/src/app.js) global keydown listener (line 1901):
  ```js
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !isInTextField(e.target)) {
    e.preventDefault();
    performUndo();
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z' && !isInTextField(e.target)) {
    e.preventDefault();
    performRedo();
  }
  // Also bind Ctrl+Y as a redo alias (Windows convention) — preventDefault, performRedo()
  ```
  `isInTextField()` returns true for `INPUT`, `TEXTAREA`, and `[contenteditable]` so undo doesn't hijack typing.
- The `fp:undo-redo` event handler in each screen module re-fetches that screen's data (Recent re-pulls `/recent`, Browser re-pulls `/fs/list`, Review Bin re-pulls `/review-bin`, etc.). More aggressive than diffing but the simplest correct approach for v1.
- Toast / snackbar UX: undo always surfaces a snackbar with "Redo" button; redo surfaces one with "Undo". Errors bypass the notifications gate.
- Status bar / tray badge: optional v1.5 — show a tiny "↶ N" pill when the undo stack has entries, click to open the History tab in Inspector.

#### Test plan
- Unit test for each `UNDO_HANDLERS` entry: forward op → undo → assert state matches pre-forward.
- Round-trip test: forward → undo → redo → assert state matches post-forward.
- Stack test: 5 forward ops → 3 undos → 2 redos → 1 forward → assert redo stack is empty.
- Crash test: 5 forward ops, 2 undos, kill the app mid-flight, restart, assert undo stack rebuilt to the 3 still-not-undone ops.
- "One-way" test: forward `delete:final` → assert it's NOT pushed to the undo stack; assert `POST /undo` skips it and undoes the prior op instead.
- Integration test: from the renderer, Ctrl+Z fires `POST /undo`, snackbar appears, Ctrl+Shift+Z reverses, the affected screen re-renders.

---

## Out of scope for v1 (deferred to v2)

- Cross-platform support (macOS, Linux). v1 is Windows-only.
- Telemetry / crash reports. Stubbed in Settings → Privacy but no backend.
- Browser download redirect implementation. v1 stores the toggle but does not redirect.
- Tag-co-occurrence graph beyond a single hop.
- Snapshot comparison mode (A.4.6).
- Cloud sync of config / favorites.
- Multi-user / per-user profiles.
- Native installer / packaging — manual install for v1.
