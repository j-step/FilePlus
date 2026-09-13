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
  `FILEPLUS_SANDBOX_PATH` until `WRITE_UNLOCKED=true` in `.env`; Windows system roots are never
  writable; the app directory is never writable except the sandbox inside it (`ProtectedPathError`).
- Delete is a same-volume move into `.FilePlusTrash`; `POST /fs/trash/empty` sends it to the Recycle
  Bin. The app never hard-deletes. Every mutation: guard → log (`executed=0`) → act → mark; undo is a
  logged inverse (`undo_of`).

## Verify before every commit

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify.ps1
```
Runs pytest, starts the backend, runs the Electron smoke test (every screen, zero console errors,
screenshots to `artifacts/screenshots/`), stops the backend. Red means stop and fix; never commit on red.
Fixtures: `py -3 scripts/gen_sandbox.py` rebuilds `FilePlusTestSandbox/_gen`.

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
- API routes have NO `/api/` prefix.
- Model IDs and AI tier order live in config only (spec §7); no model string in any `.py` outside
  `config.py` defaults.
- Placeholders are debt: a screen with fake data is not built. Wire real data or hide the screen.

## Frontend traps (load-bearing, learned the hard way)

- Frontend modules (globals, no build step, no modules) load in this order —
  `frontend/src/{api,fileops,browser,inspector,home,settings,app}.js` — each can call
  anything defined earlier at its own top level; anything from a later file is only safe to
  reference from inside a function that runs after `DOMContentLoaded`. `actions.js` is gone
  (Stage 2B deleted it): click dispatch is the `switch` in `app.js`
  (`document.addEventListener('click', …)`) plus the `IN_SCOPE_ACTIONS` set (marks an action as a
  deliberate silent no-op instead of the "not yet implemented" stub toast) — there is no registry.
- `showSnackbar`/`showToast` are defined once, in `app.js`. Signature: `showSnackbar(msg, 'Undo', fn)`.
- Snackbars/toasts are gated by `localStorage['fp-notifications-enabled']` (default off). Only
  `showToast(msg, 'error')` bypasses. No other exceptions.
- Tab close affordance is `<span role="button">`, never a nested `<button>`. Per-tab screen state lives
  on `data-tab-screen`; `switchScreen(id)` mutates the active tab, `switchToTab(tab)` activates another.
- Elevation is flat: borders (`--border-*`) do the work, overlays get one soft shadow
  (`--shadow-popover`/`--shadow-modal`), nothing else casts or insets. Repeating treatments become
  tokens in `:root`; accent-derived colours use `color-mix(... var(--accent) ...)`, never hardcoded
  rgba. Style spec: `docs/superpowers/specs/2026-09-10-stage-1-redesign-design.md` §3–§4.

## Current state

Stage 2B (frontend) is landed — see `docs/superpowers/runs/2026-09-11-stage-2b.md` for the run summary
(every screen wired to the backend, file ops/undo/redo/conflicts, Inspector, Home, palette search,
settings, Data pane, API token auth) and `docs/superpowers/runs/2026-09-11-stage-2a.md` for the backend
core it builds on. Canonical docs: `PRODUCT.md`, `docs/UI-SPEC.md` (behaviour; style superseded),
`docs/backend-integration.md` (wiring ledger), `docs/fileplus-feature-list.md` (backlog). Everything
else is under `docs/archive/`.

The sandbox default is `FILEPLUS_APP_DIR/FilePlusTestSandbox` (`backend/config.py`), so each git
worktree gets its own empty sandbox with no cross-worktree collisions; `.env` can override it via
`FILEPLUS_SANDBOX_PATH`.
