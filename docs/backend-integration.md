# FilePlus — Backend Integration Checklist

**Purpose.** A running ledger of runtime / backend wiring work surfaced during the per-screen polish phase. Each item describes what the static UI demo currently does NOT do and how the integration should bind it. Organized by screen so the implementation pass can pick up screen-by-screen.

**Status.** Living document. Append items as they surface during polish; mark items resolved with a date when implemented. Order within a screen follows priority — top items block more functionality than bottom ones.

**Conventions.**
- "INTEGRATION:" comments in source code mirror items in this doc.
- API paths are proposals — confirm against `backend/api.py` before implementing.
- Every file write goes through `operations_log.log_operation()` BEFORE the action (see `CLAUDE.md`).
- Frontend uses `fetch()` only; never direct Node fs APIs.

---

## A.1 Global chrome (titlebar / tabbar / sidebar / toolbar / statusbar)

_Polish complete; integration items pending._

### 1. Sidebar drive bar fill
**What.** Drive cards in `#sb-tree` show a `.fp-sidebar__drive-bar__fill` with hardcoded `width: 25%` / `41%`. Should reflect actual disk usage.

**How.**
- New endpoint `GET /api/drives` returning `[{ letter, label, total_bytes, free_bytes, ai_managed }]`.
- Update `width` attribute per drive on app start and on filesystem change events from `watcher.py`.
- Cache in `localStorage['fp-drives-snapshot']` keyed by drive letter so the sidebar paints with last-known values before the request resolves.
- The `.fp-sidebar__drive-ai-dot` shows only when `ai_managed === true`.

### 2. Sidebar tag list
**What.** Tags in `#sb-tags` are static (work / photos / docs / code with hardcoded counts).

**How.**
- New endpoint `GET /api/tags?limit=20&order=count` returning `[{ name, count }]`.
- Re-fetch on tag-canvas commit and on file rename / move events.
- Counts use the same `(opacity:.6;font-size:10px)` mono style — keep the sub-numbers token-clean.

### 3. Backend status dot
**What.** The header dot reflects `checkBackend()` result (already wired); confirm endpoint contract.

**How.**
- `GET /health` → `{ ok: bool, scan_running: bool, ai_status: 'ready'|'loading'|'offline' }`. Three states must drive three colors (green / amber / red) on the dot.

---

## A.2 Home (Recent / Favorites / Shared)

### A.2.1 Recent

#### 1. Time-bucket grouping (`GET /api/recent`)
**What.** The Recent pane currently ships static placeholder rows in 10 hardcoded sections (Today, Yesterday, This week, Earlier this month, Last month, Earlier this year, 2025, 2024, 2023, A long time ago). Real data must drive the layout, including hiding empty groups and computing the year-section labels at runtime.

**How.**
- Endpoint: `GET /api/recent?limit=200` returning `{ groups: [{ key, label, files: [...] }] }` ordered most-recent-first.
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
- File entry shape: `{ path, name, ext, size, mtime, atime, action: 'opened'|'modified'|'viewed', action_at, tags: [...], thumb_url? }`.
- Frontend renders one `.home-section` per group in payload order; first non-empty group naturally lands at the top.
- Re-run `pruneEmptyHomeSections()` after each fetch (it currently only runs on `DOMContentLoaded`).
- Cache the response in `sessionStorage['fp-recent']` (TTL 5 min) so re-entering the Home screen paints instantly.

#### 2. Time labels in `.fp-row__recent-time`
**What.** Each row shows a relative-time label like `opened 11:20`, `modified Apr 12`, `opened in 2019`. Format is bucket-dependent.

**How.**
- Today / Yesterday: `{action} {HH:mm}` (24-hour, locale-aware).
- This week: `{action} {weekday}` (e.g. `viewed Tuesday`).
- Earlier this month / Last month / Earlier this year: `{action} {Mon} {D}` (no year).
- Year-N sections: `{action} {Mon} {D}` (year is implicit in the section label).
- Ancient: `{action} in {YYYY}` (full year, no month).
- Frontend formats client-side from the file entry's `action` + `action_at` ISO timestamp; do not pre-format on the server.

#### 3. Per-row hover actions
**What.** Each Recent row has three hover-revealed buttons: Open, Reveal in Browser, Copy path. All currently hit the default action stub.

**How.**
- `data-action="open-file"` — call `electronAPI.openPath(path)` (preload exposes `shell.openPath`).
- `data-action="reveal-file"` — call `switchScreen('browser')`, then `loadDirectory(parentDir(path))`, then scroll-into-view + select the row whose `data-path === path`.
- `data-action="copy-path"` — already wired in [actions.js:115](../frontend/src/actions.js#L115). Confirm it picks up the closest `[data-path]` for Recent rows specifically (Recent rows DO have `data-path`, so it should — verify only).

#### 4. Selected-row state
**What.** The first Today row is hardcoded with `fp-row--selected aria-selected="true"` to demonstrate the visual. Real selection is runtime.

**How.**
- Remove the hardcoded `fp-row--selected aria-selected="true"` once `/api/recent` lands.
- Click handler: toggle `.fp-row--selected` + `aria-selected` on clicked row, exclusive within `.home-pane[data-pane="recent"]`. Persist last selection to `sessionStorage['fp-recent-selected-path']` and restore on Home re-entry.
- Keyboard: arrow keys move selection across rows, respecting section boundaries (i.e. Down at the last row of Today → first row of Yesterday).

### A.2.2 Favorites

#### 1. Favorites list (`GET /api/favorites`)
**What.** Favorites pane ships one static row. Real list comes from a user-curated collection.

**How.**
- Endpoint: `GET /api/favorites` → `{ files: [...] }` in user-defined manual order. Same file shape as `/api/recent` plus a `position` integer.
- Reorder: `POST /api/favorites/reorder { order: [path1, path2, ...] }` — replaces the order list.
- Add: covered by context-menu "Add to favorites" → `POST /api/favorites { path }`.
- Cache: `localStorage['fp-favorites']` so the pane paints last-known state instantly on cold start. Re-fetch on every Favorites tab activation, diff against cache, animate inserts/removes.

#### 2. Unfavorite-star click (currently silent stub)
**What.** Clicking the filled accent star on a Favorites row should: animate fill→empty, fade the row, remove after 200ms, post the deletion. Today the click hits the default action stub at [actions.js:117](../frontend/src/actions.js#L117); notifications are gated off so nothing visibly happens.

**How.**
- Replace the stub at [actions.js:117](../frontend/src/actions.js#L117) with a real handler.
- On click (synchronous):
  1. Swap the SVG `fill` from `var(--accent)` to `none` (and `stroke` opacity to 0.4) to show the empty-star state.
  2. Add `.fp-row--unfavoriting` to the row — CSS transition on `opacity` from 1 → 0 over 180ms, plus `pointer-events: none`.
  3. After 200ms (`setTimeout`), remove the row from the DOM.
- Backend call: `DELETE /api/favorites?path={encoded}` — fired in parallel with the animation (optimistic UI).
- On error: cancel the removal, restore the star, fire an error toast (errors bypass the notifications gate per `feedback_one_fix_at_a_time` notes).
- New CSS: `.fp-row--unfavoriting { opacity: 0; pointer-events: none; transition: opacity var(--dur-slide) var(--ease-out); }` — token-clean.

#### 3. Drag-to-reorder
**What.** Spec calls for manual order with drag handles. Not yet wired.

**How.**
- HTML5 drag API on `.fp-row` inside `.home-pane[data-pane="favorites"]`. `draggable="true"` on rows; insertion indicator (1px accent line between rows) on `dragover`.
- On `drop`: compute new order array (in DOM order), call `POST /api/favorites/reorder`. Optimistic — rebuild order array from the live DOM, send to server, reconcile with server response.
- Keyboard alternative: `Alt+↑` / `Alt+↓` on selected favorite row.

### A.2.3 Shared
v2 only. Tab is permanently `disabled`. No backend integration in v1.

---

## A.3 Browser
_(Polish not yet started. Add items here when Screen 3 begins.)_

## A.4 File Tree canvas
_(Pending.)_

## A.5 Scan
_(Pending.)_

## A.6 Review Bin
_(Pending.)_

## A.7 Everything Folder
_(Pending.)_

## A.12 Settings
_(Pending.)_

## A.10 Context menus
_(Pending.)_

## A.11 First-run setup
_(Pending.)_

## A.13 Tray popout
_(Pending.)_

---

## Cross-cutting

### 1. Notifications gate
**What.** Toasts/snackbars are gated on `localStorage['fp-notifications-enabled']` (default OFF). Errors bypass the gate. Several stub action handlers fire `showToast(...)` which is silent under the default settings — this is masking unwired actions during polish.

**How.**
- Once the per-screen polish phase finishes, audit `actions.js` for stub registrations and either implement them or remove the registration (so the action becomes a no-op rather than an invisible toast).

### 2. Operations log
**What.** Every filesystem-touching operation must call `operations_log.log_operation()` BEFORE execution, per `CLAUDE.md`'s hard safety principle. Not yet wired in the renderer.

**How.**
- Wrap all paths that hit `/api/move`, `/api/rename`, `/api/delete`, etc. with a pre-flight log entry (server-side); the renderer fires the request and displays the operations-log id in any error toast for traceability.

### 3. Tab-screen state per-tab
**What.** Each `.fp-tab` carries `data-tab-screen`; `switchScreen(id, label)` mutates the active tab's state. Backend has no role yet, but the integration pass should persist tab state to the operations log for crash recovery (see `A.10` crash-recovery modal scaffolding in `index.html`).

**How.**
- New endpoint `POST /api/session/snapshot` body `{ tabs: [{ id, screen, label, path? }], active }`. Auto-snapshot on tab change (debounced 1s).
- `GET /api/session/last` on app launch — feeds the crash-recovery modal.
