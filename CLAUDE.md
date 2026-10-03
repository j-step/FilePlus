# FilePlus — Claude Code Reference

Windows desktop app: an AI-driven replacement for Windows Explorer. Files land in one inbox, the AI
proposes where they belong, the user approves, every move is logged and undoable.

**Read first:** `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` (roadmap, decisions D1–D10,
run protocol). Check which stage is active in `docs/superpowers/runs/` before doing anything.

## Stack

Backend Python 3.14 (`py -3`) · FastAPI on `localhost:9876` · aiosqlite/SQLite WAL · xxhash · watchdog.
Frontend Electron 41, plain HTML/CSS/JS, no framework, no build step. Tests: pytest (asyncio auto) and
`@playwright/test` driving Electron. `FILEPLUS_PORT` overrides 9876; verify uses 9877.

## Hard safety rules (non-negotiable)

- Nothing moves, renames or deletes without explicit user approval.
- Every file operation is written to `operations_log` BEFORE it executes.
- `path_guard(path, mode)` gates every filesystem touch: reads anywhere; writes inside
  `FILEPLUS_SANDBOX_PATH` (alias `FILEPLUS_ROOT`) unless `FILEPLUS_ENV=prod` *and*
  `WRITE_UNLOCKED=true` (`dev` is the default; `dev`/`test` never write outside the root); Windows
  system roots are never writable; the app directory is never writable except the sandbox inside it
  (`ProtectedPathError`).
  Mutations take their operand from `guard_operand(path, mode)`: same containment decisions on the
  resolved path, but a junction/symlink is acted on as the link, never as its target.
- Every route except `/health` requires `X-FilePlus-Token`: the backend mints one at startup into
  `<app dir>/.fileplus-token` (git-ignored) when `FILEPLUS_API_TOKEN` is unset, and CORS allows only
  the Electron renderer's `file://` origin (`"null"`).
- Delete is a same-volume move into `.FilePlusTrash`; `POST /fs/trash/empty` sends it to the Recycle
  Bin. The app never hard-deletes. Every mutation: guard → log (`executed=0`) → act → mark; undo is a
  logged inverse (`undo_of`).

## Verify before every commit

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```
Runs pytest, the contrast and frontend gates, then every Electron test (every screen, zero console
errors, screenshots to `artifacts/screenshots/`). Red means stop and fix; never commit on red.
The Electron tests are self-contained (`frontend/test/harness/`): global setup builds a fresh fixture
copy in a temp folder, starts the backend on 9877 with `FILEPLUS_ENV=test` and `FILEPLUS_ROOT` pointing
at it, gives Electron a throwaway profile (`FILEPLUS_USER_DATA_DIR`) and writes logs to
`artifacts/logs/`; teardown stops the backend and deletes the folder. Global setup also empties
`artifacts/screenshots/`, so after a single-file run only that file's screenshots are there. `shot()`
flattens Mica for the capture (Mica's transparent regions used to save as a white sidebar). A few
tests read the real `C:\` / Desktop (read-only; This PC, drive crumbs, Quick Access): their
screenshots differ from machine to machine. Single commands:
`py -3 -m pytest -q`, `cd frontend && npm run test:smoke` (fast) / `npm run test:e2e` (everything).
`py -3 scripts/gen_sandbox.py` rebuilds the dev app's own `FilePlusTestSandbox/_gen` (tests never read it).
A Stop hook (`.claude/settings.json` → `scripts/verify.py`) runs pytest + the smoke whenever code
files are uncommitted and blocks the turn on failure.

Electron test rules: launch through `launchApp()` (`frontend/test/harness/app.js`), which waits for
`window.__fpInitDone` (startup has applied config, known folders, drives, pins and tags) and resets
the zoom to 100 % unless `keepZoom`. Assert `errors` after `await app.close()`: it then adds every
ERROR line main.js wrote to `renderer.log`, including errors Playwright never sees (a ResizeObserver
loop). No `waitForTimeout` may gate an assertion (the suite has none); wait on the app's signals —
`__fpRenderCount`, `__fpLoadPending`, `__fpInspectorPending`, `__fpIconsIdle()`, `__fpZoomBusy`,
`__fpStubHits` — or `expect.poll`. Animations follow only Settings › "Animations" (`ui.animations`)
through `html[data-motion]` — `prefers-reduced-motion` gates nothing; JS motion uses `fpMotionOn()` /
`fpAnimate()` and CSS the `--motion-*` / `--ease-*` tokens (`scripts/check_motion.js` enforces it).
Tests default to motion off (`launchApp()` passes `--fp-motion=off`; `launchApp({motion: true})` turns it
on, `{motion: null}` follows the saved setting); `waitReady` also waits for `html.fp-booting` to lift.
Whole-window screenshots use the harness's `windowShot(app, page, name)` (capturePage: header bar and app
zoom as on screen — `page.screenshot` crops a zoomed page); call `parkPointer(page)` first so the shot
shows no leftover hover.

## Working protocol (spec §6)

Brainstorm → stage spec → task plan → one autonomous run on `stage/<n>-<slug>` → author reviews once →
merge. Per task: implement, verify green, commit. Stop only for a destructive action outside the spec,
a spec ambiguity that changes design, or verify red after two fixes. Runs end with
`docs/superpowers/runs/<date>-stage-<n>.md`. Do NOT pause after each change for a visual check; the
April "one fix at a time" rule is retired (D10).

## Coding conventions

- All paths come from `backend/config.py`; never hardcode one.
- Backend is async everywhere (`async def`, `aiosqlite`, `aiohttp`). No global DB connection.
- Frontend talks to the backend with `fetch()` only; the renderer never touches Node fs.
- API routes have NO `/api/` prefix. Dates on the wire are epoch seconds (listings, search, `/file`).
- Model IDs and AI tier order live in config only (spec §7); no model string in any `.py` outside
  `config.py` defaults.
- Placeholders are debt: a screen with fake data is not built. Wire real data or hide the screen.

## Frontend traps (load-bearing, learned the hard way)

- Frontend modules (globals, no build step, no modules) load in this order —
  `frontend/src/{api,filetypes,icons-sprite}.js`, then `frontend/iconCache.js` (dual-mode: also a
  CommonJS module required by `frontend/main.js` and by node-run tests, so the renderer's request
  key and the main process's cache key are one piece of code, not two hand-kept twins), then
  `frontend/src/{overlayscroll,icons,fileops,browser,thispc,dragdrop,search,inspector,home,settings,
  properties,app}.js` — each can call anything defined earlier at its own top level; anything from a
  later file is only safe to reference from inside a function that runs after `DOMContentLoaded`.
  `actions.js` is gone (Stage 2B deleted it; verify fails if it reappears): click dispatch is the
  `switch` in `app.js` (`document.addEventListener('click', …)`) plus the `IN_SCOPE_ACTIONS` set: an
  action a listener of its own handles (so the switch leaves it alone), or one that is deliberately
  inert on a click — some have no case at all (`settings-set-accent-hex` applies on input/Enter), some
  a case that is a silent no-op.
  The switch's default branch is the "not yet implemented" stub; it counts `window.__fpStubHits`,
  which tests assert stays 0.
- `filetypes.js` and `icons-sprite.js` are generated, not hand-edited: `filetypes.js` from
  `backend/filetypes.py` via `scripts/build_filetypes.py`; `icons-sprite.js` (the Fluent chrome
  sprite; Stage 2D added `fp-this-pc` and `fp-window-restore`, the addendum `fp-more-horizontal`) via
  `scripts/build_icons.js`.
  `verify.ps1`'s frontend-gates stage (3/4) runs `check_menu_cases.js` (every `cm-*` action has a
  switch case; every `data-action` in `index.html` and in `src/*.js` templates has a case or is in
  `IN_SCOPE_ACTIONS` — no exemptions), `check_motion.js` (every duration/easing in `styles.css` is a
  `--motion-*` / `--ease-*` token, 200 ms ceiling; `--timer-*` only where its `TIMER_ALLOW` list says;
  every animation under the `html[data-motion]` gate; no `prefers-reduced-motion` anywhere; JS animates
  only through `fpAnimate`), `check_layers.js` (one `--z-*` scale on `:root`, in order; every z-index in
  `styles.css` on it; none in `index.html` or the JS), `check_icons.js` (sprite references resolve, including
  `icons.js`'s `FP_DYNAMIC_ICON_SYMBOLS` for names passed as variables — symbol/family counts, no raw
  `<svg>` outside the sprite) and a real parity gate for `filetypes.js` only (rebuilds to
  `artifacts/` and compares the text with line endings normalised, logged as
  `check_filetypes_parity: ok`); `contrast_check.py` (stage 2/4) is a separate gate. `icons-sprite.js`
  has no parity gate — `verify.ps1` never runs `build_icons.js`, so a hand edit that keeps references
  resolving still passes `check_icons.js`.
- No control ships that does nothing (Stage 2D ruling, "placeholders are debt"). The unbuilt screens
  (File Tree, Scan, Review Bin, Everything Folder) with their sidebar entries, palette commands and
  Ctrl+Shift+R, six Settings panes (Everything Folder, Downloads Folder, Organization Engine, AI
  Configuration, Custom File Types, Privacy), Home's Shared tab and the palette's chat mode are out
  of the DOM; their markup is in `docs/archive/2026-10-02-unbuilt-screens-markup.html`. The stage
  that builds one puts it back with a `case` per `data-action` and restores its entry points.
  `switchScreen(id)` ignores a screen that is not in the DOM. Owner-approved shells stay: the Ask
  File+ popout and the Tag Canvas Stage-3 banner.
- Bridge methods live on `window.electronAPI` (`preload.js`). Stage 2C: `fileIcon`/`fileIcons`,
  `thumbnail`, `showProperties`, `openWithDialog`, `apiPort`. Stage 2D: `zoomTo(factor, ease)`,
  `zoomSteps`, `getZoom`, `isMaximized` + `onMaximizedChange` (main sends `win-maximized` on
  maximize/unmaximize/restore), `appInfo`, `openLogDir`, `clearIconCaches`. Callers: `icons.js`
  (`fileIcons`, `thumbnail`); `properties.js`, `thispc.js` and app.js's `props-advanced` case
  (`showProperties`); app.js's `cm-open-with` / `props-open-with` cases and `inspector.js`
  (`openWithDialog`); `api.js` reads the port so the renderer and `verify.ps1`'s
  `FILEPLUS_PORT=9877` agree; `app.js` (zoom, maximize); `settings.js` (About, Data).
- Electron's default menu is removed (`Menu.setApplicationMenu(null)`), so every shortcut is the
  renderer's: Ctrl+R / F5 / the Refresh button call `refreshAll()` (in-place re-list; it never
  reloads the page), Ctrl+W closes a tab, Ctrl+= / Ctrl+- / Ctrl+0 zoom. F12 opens DevTools only when
  `FILEPLUS_ENV` is not `prod`. `will-navigate` away from `index.html` and `window.open` are refused.
- App zoom: `zoomStep` → `electronAPI.zoomTo` eases each step over 70 ms through main's
  `webContents.setZoomFactor` (not `webFrame`, whose zoom is never persisted). The renderer
  publishes the factor as `--app-zoom`; sidebar, inspector and rail widths are screen px
  (`calc(var(--sidebar-w-screen) / var(--app-zoom))`, saved as `ui.sidebar_w` / `ui.inspector_w`),
  so their contents grow and their width does not. Never size a panel in plain CSS px and never set
  CSS `zoom`. Ctrl+wheel never changes the zoom factor.
- File-list views: `browserState.view` is `content | tiles | details | list | small | icons` and
  `browserState.iconSize` is 48–256 for `icons`. Change them only through `setView` / `stepView` /
  `applyViewChoice` (browser.js), which write `data-view`, `--icon-size` and `--cell-w` on
  `#list-scroll` (`--list-scale` no longer exists). A size step inside `icons` only changes CSS
  variables; a view change renders once from the in-memory entries and never re-fetches. Each
  folder's view is remembered in `ui.folder_views`, saved only as deltas through `POST
  /config/merge`. One render per navigation (`__fpRenderCount`); a refresh or a revalidated tab is
  patched row by row (`patchDirectory`), and unchanged rows keep their DOM nodes.
- Selection follows operations: `fileops.followOps` (run, undo, redo) calls `followSelectionOps`, so
  a renamed or moved item stays selected under its new path and a trashed one leaves the selection
  the moment the operation answers; `selectLandedOps` selects what a paste or undo landed; each tab
  remembers per folder the scroll and selection that Back / Forward restore. The inspector shows an
  emptied selection at once and never fetches `GET /file` for a path that is gone.
- Windows-mode icons have two sources and one sizing contract (`docs/superpowers/specs/
  2026-09-14-stage-2c-pass-2-icon-design.md`, amended by the Stage 2D spec §4): `POST /shell/icons`
  (backend `winshell.shell_image`, Explorer-exact at any px) first, `electronAPI.fileIcons` (Chromium
  `app.getFileIcon`) as the fallback — never asked for directories, extension-less files, `.lnk` or
  `.url`. Requests carry physical px snapped up to a bucket (`fpDevicePx` → `fpIconBucket`: 16, 20,
  24, 32, 40, 48, 64, 96, 128, 192, 256); the `<img>` is CSS-sized to its logical box (`--icon-size`
  or `.fp-icon--N`), never pinned; keys end in px, so zoom / DPI / view-size changes re-resolve
  (`fpInvalidateLazyIcons`, debounced 120 ms) and a new bitmap swaps in only after `decode()`. A
  cache hit is painted settled in the markup (`fpCachedIconImg`); a folder paints the learned
  generic first; any other miss is an empty fixed-size slot — the FilePlus sprite only after both
  tiers fail. `fpShellIconRoute('live'|'absent'|'unknown')` is fed from `/health`'s `shell_icons`
  flag — do not probe the route with a request that can 404 (Chromium logs it as a console error
  even when caught, and the zero-console-errors gate fails).
- `thispc:` (`THISPC`, browser.js; `thisPcActive()`) is the This PC page's path. It lives in tab
  history like a folder, but it must never reach the backend: every path consumer checks it.
- `#toolbar[data-search="full"|"collapsed"]` (it replaced `data-narrow`) is set only by
  `layoutToolbar()` (app.js) from measured widths, never a fixed constant: the search box shrinks (280
  → 120), then folds to its magnifier, and only then does the left-anchored path overflow
  (`#breadcrumb-wrap.is-overflowing`; the current crumb — or the search header — never under the fade:
  `.is-tight` ellipsizes it to `--crumb-current-max`). Opened while collapsed, the bar grows in flow and
  pushes the path (`setSearchSlotWidth`, an `fpAnimate` width ease). When even the magnifier leaves the
  current crumb under its ~56 px floor, the `[data-fold="1".."4"]` buttons (theme, Refresh, Inspector,
  View/Sort) move into the "…" (See more, `#btn-toolbar-more`) menu — no button ever just vanishes. The
  toolbar's buttons never flex-shrink: `layoutToolbar` measures them as the row's fixed part (a squeezed
  button once starved the path). The search placeholder is shortened with "…" by `fitSearchPlaceholder`
  (the whole text stays in `data-placeholder`, which the width math reads).
- Mouse presses on toolbar, tab-strip and sidebar controls hand keyboard focus back to where it was
  (`initChromeMouseFocus`, Explorer's model), so Enter after a click opens the focused row.
- Panels (sidebar, inspector, Properties, Settings, the inspector's text preview) scroll with
  `fpOverlayScroll(el)` (overlayscroll.js; attached in app.js's `initOverlayScrollbars`): no native
  bar, no layout width, `is-scroll-top` / `is-scroll-bottom` fade cues. A tall context menu reuses
  the fade cue with its native bar hidden. The file list keeps its native scrollbar.
- `showSnackbar`/`showToast` are defined once, in `app.js`. Signature: `showSnackbar(msg, 'Undo', fn)`.
- Snackbars/toasts are gated by `localStorage['fp-notifications-enabled']` (default off). Only
  `showToast(msg, 'error')` bypasses. No other exceptions. Error toasts leave after 8 s (paused
  while hovered or focused); at most 3 notices show per stack.
- Per-tab state lives in JS tab records (`createTab()`, app.js: `{id, screen, label, path, history,
  historyIndex, view, iconSize, scrollTop, scrollLeft, selection, search, listing, stale}`); the DOM
  carries only `data-tab-id`. `switchScreen(id)` mutates the active tab's record; `activateTab(id)`
  saves the outgoing tab and paints the incoming one from its cached `listing`, then revalidates.
  The tab close affordance is `<span role="button">`, never a nested `<button>`.
- Elevation is flat: borders (`--border-*`) do the work, overlays get one soft shadow
  (`--shadow-popover`/`--shadow-modal`), nothing else casts or insets. Repeating treatments become
  tokens in `:root`; accent-derived colours use `color-mix(... var(--accent) ...)`, never hardcoded
  rgba. Stacking uses the one `--z-*` scale on `:root` (base → local → raised → overlay-scroll →
  marquee → panel-exit → header → sidebar-resize → popover → dropdown → menu → drag → scrim → modal →
  notice; `check_layers.js`); every caps section header uses `--t-section` /
  `--track-section`. Stage 2D token families: `--sidebar-*`, `--oscroll-*`, `--view-*`, `--drive-*`,
  `--clip-cut-opacity` / `--clip-badge-size`, `--bad-wash-solid` (opaque error toast),
  `--motion-*` / `--ease-*` / `--timer-*` (motion and timers), `--notice-bottom`, `--menu-edge`; addendum:
  `--h-header` / `--w-caption` / `--header-*` / `--identity-*` (header bar), `--tab-*` / `--tabbar-*`
  (tab strip), `--row-star-size`. Style spec:
  `docs/superpowers/specs/2026-09-10-stage-1-redesign-design.md` §3–§4.
- Header bar (addendum §1): one top row, `#header` (`--z-header`, 44 screen px at any zoom) =
  `#identity` (logo + `#device-name`, double-click rename; sidebar-wide while expanded,
  `.fp-header--rail` natural width over the rail) | `#tabbar` (scrolls under `.fp-tabbar--overflow`'s
  fade, watched by a ResizeObserver that also keeps the active tab in view) | `#btn-new-tab` (outside the
  strip, always on screen) | `.fp-header__drag` | caption buttons (`#btn-minimize` / `#btn-maximize` /
  `#btn-close`, page buttons, not `titleBarOverlay`). There is no title bar, no separate tab row and no
  sidebar card; the collapse toggle (`#btn-sidebar-collapse`) is in the sidebar's top row. Tabs are
  `flex: 1 1 0; max-width: max-content` (title-wide up to `--tab-max-w`, equal shares when crowded, down
  to `--tab-min-w`). Every control in the bar is `-webkit-app-region: no-drag`.
- Motion (addendum §5): the only switch is Settings › Animations (`ui.animations`) → `html[data-motion=
  "on"|"off"]` (`fpSetMotion`; decided at app.js's first line from `--fp-motion` or the localStorage
  mirror, so nothing animates before it is known). `styles.css`'s gate gives anything not `"on"` no
  animation and no transition. JS asks `fpMotionOn()` and animates only through `fpAnimate(el,
  keyframes, {duration, easing, key})` (one per element+key; returns null when off); exits go through
  `fpPlayExit` (the element is already closed: inert, `pointer-events:none`, a `*--closing` class while
  it fades) / `fpCancelExit`; `fpAfter(anim, fn)` runs `fn` on finish or cancel (at once with none);
  `fpCancelAnimation(el, key)`. State, DOM and focus change first; an animation never gates the next
  input. Never use `prefers-reduced-motion`, `style.transition` or a raw `.animate()`. Durations are
  `--motion-instant/fast/base/slow` (60/100/140/200 ms ceiling) and `--ease-*`; `--timer-*` are timers,
  not motion. `html.fp-key-repeat` (a held key) zeroes transitions and makes `fpAnimate` instant;
  `html.fp-heavy-list` (a listing over 300 rows, `syncHeavyList`) and the 30-row cap keep big lists from
  animating per row; `html.fp-booting` (lifted two frames after the saved settings apply,
  `fpEndBoot`, also from a `finally` around startup) keeps launch from easing into the saved state. `.fp-pressed` is the press state kept by
  hand on chrome buttons (the mouse-focus model drops `:active`).
- Decide "is it open?" from state, never from visibility (a closing panel or scrim is still painted
  while it fades): `setInspectorOpen` / `setThisPcOpen` (`{animate}` option), `anyScrimOpen()`,
  `fpExiting(el)`.
- Scrims: every `.fp-scrim` is shown and hidden only through `fpSetScrim(el, open)` (browser.js), never
  a `display` toggle: it keeps display and `aria-hidden` in step and mirrors the open count onto
  `html[data-scrim-open]`, which `anyScrimOpen()` and the Mica backing read (under an open scrim the
  window gets its solid chrome, so the blur has paint everywhere). Scrims are children of `<body>` on
  `--z-scrim`; toasts are above, the drag badge below.
- A path that is gone is not an error: `GET /file` answers 200 `{exists: false, path}` and `GET
  /preview` `{kind: "missing", exists: false}` (`path_guard` still runs first). Check `exists === false`;
  never rely on a 404 there (Chromium logs a failed fetch as a console error).

## Current state

Stage 2D (playtest pass 2) and its addendum are done on `stage/2d-playtest-2` — run summary
`docs/superpowers/runs/2026-10-01-stage-2d.md` (Explorer view ladder, flash-free icons, app zoom with
fixed panel widths, in-place refresh, This PC page, toolbar collapse order, menu flyouts, sidebar
polish, unbuilt screens hidden; addendum 2026-10-03: one header bar, search that pushes the path,
one even modal blur, the This PC drop fix, a motion pass under Settings › Animations). Earlier: `docs/superpowers/runs/2026-09-13-stage-2c.md`
(playtest pass 1), `2026-09-11-stage-2b.md` (frontend wiring) and `2026-09-11-stage-2a.md` (backend
core). Canonical docs: `PRODUCT.md`, `docs/UI-SPEC.md` (behaviour; style superseded; Stage 2D notes
inline), `docs/backend-integration.md` (wiring ledger), `docs/fileplus-feature-list.md` (backlog).
Everything else is under `docs/archive/`.

The sandbox default is `FILEPLUS_APP_DIR/FilePlusTestSandbox` (`backend/config.py`), so each git
worktree gets its own empty sandbox with no cross-worktree collisions; `.env` can override it via
`FILEPLUS_ROOT` (or its older name `FILEPLUS_SANDBOX_PATH` -- one setting, two names; setting both to
different folders stops the backend from starting).

## Development workflow

JJ (the owner) is not a programmer. The harness tests, reviews and verifies the work; JJ only
approves acceptance criteria and does the final feel check. `/feature <description>` and
`/bug <description>` (`.claude/skills/`) run the whole loop; `WORKFLOW.md` is JJ's cheat sheet.

- Every change must leave all tests passing. The Stop hook (`scripts/verify.py`) enforces this for
  pytest + the Electron smoke; `scripts/verify.ps1` is the full gate before every commit.
- New behaviour requires a test. A bug fix starts with a failing test that reproduces the bug.
- Never hardcode filesystem paths (they come from `backend/config.py` / `FILEPLUS_*` env vars). All
  file operations go through the safety guard (`backend/mover.py` → `config.path_guard` /
  `guard_operand`); `FILEPLUS_ENV` is `dev` by default and only `prod` can ever write outside
  `FILEPLUS_ROOT`.
- Check the logs before guessing at a cause: `logs/` for dev runs, `artifacts/logs/` for test runs
  (`backend.log`, `main.log`, `renderer.log`). `py -3 scripts/clear_logs.py` empties them.
- For UI work, take Playwright screenshots (`shot()` in `frontend/test/harness/app.js`) and look at
  them before saying the work is done. The `qa` subagent does this for the whole suite; the
  `reviewer` subagent checks the diff against this file, the specs and the design tokens.
- Work in thin slices: one small, testable behaviour at a time, committed before the next.
- Commit after every working state. Branch per feature (`feature/<slug>`, `fix/<slug>`).
- Three failed attempts on the same approach means revert to the last commit and rethink, not
  patch again — write the diagnosis down and propose a different approach first.
- Explain things to JJ in plain English. He is not a programmer.
