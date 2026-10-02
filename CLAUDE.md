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
  `WRITE_UNLOCKED=true` (`dev` is the default; `dev`/`test` never write outside the root); Windows system roots are never
  writable; the app directory is never writable except the sandbox inside it (`ProtectedPathError`).
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
`artifacts/logs/`; teardown stops the backend and deletes the folder. Single commands:
`py -3 -m pytest -q`, `cd frontend && npm run test:smoke` (fast) / `npm run test:e2e` (everything).
`py -3 scripts/gen_sandbox.py` rebuilds the dev app's own `FilePlusTestSandbox/_gen` (tests never read it).
A Stop hook (`.claude/settings.json` → `scripts/verify.py`) runs pytest + the smoke whenever code
files are uncommitted and blocks the turn on failure.

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
  `frontend/src/{api,filetypes,icons-sprite}.js`, then `frontend/iconCache.js` (dual-mode: also a
  CommonJS module required by `frontend/main.js` and by node-run tests, so the renderer's request
  key and the main process's cache key are one piece of code, not two hand-kept twins), then
  `frontend/src/{icons,fileops,browser,dragdrop,search,inspector,home,
  settings,properties,app}.js` — each can call anything defined earlier at its own top level;
  anything from a later file is only safe to reference from inside a function that runs after
  `DOMContentLoaded`. `actions.js` is gone (Stage 2B deleted it): click dispatch is the `switch` in
  `app.js` (`document.addEventListener('click', …)`) plus the `IN_SCOPE_ACTIONS` set (marks an
  action as a deliberate silent no-op instead of the "not yet implemented" stub toast) — there is
  no registry.
- `filetypes.js` and `icons-sprite.js` are generated, not hand-edited: `filetypes.js` from
  `backend/filetypes.py` via `scripts/build_filetypes.py`; `icons-sprite.js` (the Fluent chrome
  sprite) via `scripts/build_icons.js`. `verify.ps1`'s frontend-gates stage runs `check_menu_cases.js`
  (every `cm-*` action has a switch case), `check_icons.js` (sprite references resolve — symbol/
  family counts, no raw `<svg>` outside the sprite) and a real parity gate for `filetypes.js` only
  (rebuilds to `artifacts/`, SHA256-compares, logged as `check_filetypes_parity: ok`); `contrast_check.py`
  (stage 3/6) is a separate gate. `icons-sprite.js` has no parity gate — `verify.ps1` never runs
  `build_icons.js`, so a hand edit that keeps references resolving still passes `check_icons.js`.
- Bridge methods added in Stage 2C live on `window.electronAPI` (`preload.js`):
  `fileIcon`, `thumbnail`, `showProperties`, `openWithDialog`, `apiPort` — `icons.js` calls the
  first two, `properties.js` the native-dialog pair, `api.js` reads the port so the renderer and
  `verify.ps1`'s `FILEPLUS_PORT=9877` agree.
- Windows-mode icons have two sources and one sizing contract (`docs/superpowers/specs/
  2026-09-14-stage-2c-pass-2-icon-design.md`): `POST /shell/icons` (backend `winshell.shell_image`,
  Explorer-exact at any px) first, `electronAPI.fileIcons` (Chromium `app.getFileIcon`) as the
  fallback — the fallback is never asked for directories, extension-less files, `.lnk` or `.url`.
  Every request carries physical px (`fpDevicePx`); the `<img>` is pinned to `px / dpr`; keys end in
  px, so zoom / DPI / `--list-scale` changes re-resolve (`fpInvalidateLazyIcons`), never resample.
  `fpShellIconRoute('live'|'absent'|'unknown')` is fed from `/health`'s `shell_icons` flag — do not
  probe the route with a request that can 404 (Chromium logs it as a console error even when caught,
  and the smoke's zero-console-errors gate fails).
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

Stage 2C (playtest pass 1) is landed — see `docs/superpowers/runs/2026-09-13-stage-2c.md` for the run
summary (real tabs, file-type taxonomy and custom icon family with a Windows-icon option, live +
This-PC search, Properties panel with native-dialog option, pointer-based drag and drop, This PC /
Quick Access sidebar, View/Sort menus, Ask File+ popout shell). Earlier: `docs/superpowers/runs/
2026-09-11-stage-2b.md` (frontend wiring) and `2026-09-11-stage-2a.md` (backend core). Canonical docs:
`PRODUCT.md`, `docs/UI-SPEC.md` (behaviour; style superseded), `docs/backend-integration.md` (wiring
ledger), `docs/fileplus-feature-list.md` (backlog). Everything else is under `docs/archive/`.

The sandbox default is `FILEPLUS_APP_DIR/FilePlusTestSandbox` (`backend/config.py`), so each git
worktree gets its own empty sandbox with no cross-worktree collisions; `.env` can override it via
`FILEPLUS_ROOT` (or its older name `FILEPLUS_SANDBOX_PATH` -- one setting, two names; setting both to
different folders stops the backend from starting).

## Git and GitHub are Claude's job

JJ does not use git, VS Code's Source Control panel or GitHub, and does not want to. All of it —
branches, staging, commits, merges, pushes, keeping the working tree clean — is Claude's
responsibility. Never ask JJ to run a git command or click anything in Source Control; if an action
is blocked (e.g. a push the permission check refuses), say plainly what is needed in one step.

- `C:\Dev\FilePlus` also holds JJ's personal files that are not part of FilePlus: `Servers/`
  (~140,000 files of game-server worlds), `SETUP_PROMPT.md`, the
  `FilePlus Playtest Feedback*.md` notes. They are ignored through `.git/info/exclude` (local only,
  never committed). Never delete, move, stage or commit them.
- Stage files by name (`git add -- <path>`), never `git add -A`, `git add .` or `git commit -a`, and
  check `git diff --cached --name-only` before every commit.
- Avoid `git checkout`/`git switch` in this folder: switching branches deletes files that are tracked
  on one branch and not the other. Use a worktree (`.worktrees/`) for other branches.
- After any git work, `git status` here should be empty. If VS Code shows thousands of changes,
  something stopped being ignored — fix the ignore rules; don't stage anything.

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
