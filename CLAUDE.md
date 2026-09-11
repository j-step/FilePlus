# FilePlus — Claude Code Reference

Windows desktop app: an AI-driven replacement for Windows Explorer. Files land in one inbox, the AI
proposes where they belong, the user approves, every move is logged and undoable.

**Read first:** `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` (roadmap, decisions D1–D10,
run protocol). Check which stage is active in `docs/superpowers/runs/` before doing anything.

## Stack

Backend Python 3.14 (`py -3`) · FastAPI on `localhost:9876` · aiosqlite/SQLite WAL · xxhash · watchdog.
Frontend Electron 41, plain HTML/CSS/JS, no framework, no build step. Tests: pytest (asyncio auto) and
`@playwright/test` driving Electron.

## Hard safety rules (non-negotiable)

- Nothing moves, renames or deletes without explicit user approval.
- Every file operation is written to `operations_log` BEFORE it executes.
- `path_guard()` gates every filesystem touch. Today `SAFETY_MODE=true` (`backend/config.py`) confines
  both reads and writes to `FILEPLUS_SANDBOX_PATH`.
- Stage 2 introduces decision D2: reads may span real drives, writes stay sandboxed until
  `WRITE_UNLOCKED=true`. Neither the read/write split nor `WRITE_UNLOCKED` exists yet.
- Deletes go to the Recycle Bin or a staging area, never straight to gone.

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

- Click dispatch is the `switch` in `frontend/src/app.js` (`document.addEventListener('click', …)`).
  `actions.js` defines an `ACTIONS` registry that nothing iterates or dispatches through; helpers there are
  fine, the registry itself is dead. Stage 2 decides its fate.
- `index.html` loads `actions.js` before `app.js`; both define `showSnackbar`/`showToast` and the later
  (app.js) binding wins. Use app.js's signature `showSnackbar(msg, 'Undo', fn)`.
- Snackbars/toasts are gated by `localStorage['fp-notifications-enabled']` (default off). Only
  `showToast(msg, 'error')` bypasses. No other exceptions.
- Tab close affordance is `<span role="button">`, never a nested `<button>`. Per-tab screen state lives
  on `data-tab-screen`; `switchScreen(id)` mutates the active tab, `switchToTab(tab)` activates another.
- Repeating visual treatments become tokens in `:root` of `styles.css`; accent-derived colours use
  `color-mix(... var(--accent) ...)`, never hardcoded rgba.

## Current state

See `docs/superpowers/runs/` for the latest run summary and the roadmap spec §2 for the baseline
inventory. Canonical docs: `PRODUCT.md`, `docs/UI-SPEC.md` (behaviour; style superseded),
`docs/backend-integration.md` (wiring ledger), `docs/fileplus-feature-list.md` (backlog).
Everything else is under `docs/archive/`.
