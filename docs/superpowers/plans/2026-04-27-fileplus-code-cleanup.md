# FilePlus Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the contradictions, dead-weight comments, and small bugs surfaced by the code review **without touching backend implementation or changing any UI feature/behavior**. Output is a cleaner, more consistent codebase ready for the backend wiring phase.

**Architecture:** All work is frontend / docs / config only. No `backend/*.py` is modified. No new features are added; no existing features are changed in behavior. Each task is self-contained, gets its own commit, and can be verified by visual inspection plus `npm start` smoke-tests.

**Tech Stack:** Plain HTML / CSS / JS (Electron renderer). No framework. No build step.

**Out of scope (explicit):**
- Anything under [backend/](../../backend/) — no schema migrations, no new endpoints, no async refactors, no SQLite indexes.
- Implementing stub actions in [actions.js](../../frontend/src/actions.js) (only their *labels* and *endpoint strings* are touched, never their behavior).
- Restructuring the action-dispatch architecture (the dual switch in [app.js](../../frontend/src/app.js) plus map in [actions.js](../../frontend/src/actions.js) is left alone — risk of breaking dispatch outweighs the cleanup gain right now).
- CSS class-name renames (cosmetic only; touching styles.css risks visual regressions).
- Archiving or merging any of the four design docs (DESIGN.json, DESIGN.md, design-tokens.md, design-brief.md) — handle in a dedicated session.

---

## File Structure

| File | Responsibility | Touched in tasks |
|---|---|---|
| `frontend/src/actions.js` | URL-prefix sweep on stub endpoint strings; refresh stale "in-scope" comment block | T1 |
| `frontend/index.html` | URL-prefix sweep on `<!-- INTEGRATION -->` comments; remove dead Ollama CSP entry | T2 |
| `frontend/tray/index.html` | Move inline `<script>` to `tray.js` so CSP `script-src 'self'` doesn't block it | T3 |
| `frontend/tray/tray.js` (new) | Holds the moved tray script | T3 |
| `frontend/setup/index.html` | Move inline `<script>` to `setup.js` so CSP doesn't block it | T4 |
| `frontend/setup/setup.js` (new) | Holds the moved setup script | T4 |
| `frontend/main.js` | Remove duplicate `ipcMain` re-import inside `app.whenReady()` | T5 |
| `frontend/src/app.js` | Capture `setInterval` id; clear it on `beforeunload` to fix hot-reload leak | T6 |
| `CLAUDE.md` | Update "Current State" / "Next Task" so they match real repo state | T7 |
| `docs/fileplus-feature-list.md` (moved) | Move from repo root into `docs/` per docs convention | T8 |

---

## Task 1: URL-prefix sweep + stale comment in actions.js

**Files:**
- Modify: `frontend/src/actions.js` (134 occurrences of `/api/` in stub endpoint strings; comment block at lines 63-74)

**Why:** The repo has two URL conventions. Real fetches in [app.js](../../frontend/src/app.js) use NO `/api/` prefix (`/scan`, `/fs/list`, `/health`); stub endpoint *strings* in `actions.js` (and HTML comments — handled in T2) use `/api/`. The strings in `actions.js` are descriptive only — the `stub()` helper logs them but never fetches them — so the rewrite is purely cosmetic and risk-free. The decision (no-prefix wins) was recorded in [docs/backend-integration.md](../../backend-integration.md) Cross-cutting #4.

The "in-scope actions" comment block at [actions.js:63-74](../../frontend/src/actions.js#L63) is also stale — it lists `settings-set-accent`, `settings-set-font-scale`, `settings-reset-shortcuts` as in-scope, but those names don't exist anywhere; the real action names are `settings-set-accent-hex`, `settings-rebind`, etc. Refresh the list to match what app.js actually handles.

- [ ] **Step 1: Audit current state**

Run: `grep -c "/api/" c:/Dev/FilePlus/frontend/src/actions.js`
Expected: `134`

- [ ] **Step 2: Replace `/api/` → `/` in actions.js**

Use one global replace inside the file. The strings being replaced are values inside the `endpoint:` field of the `ACTIONS` map plus a few in the file's leading comment block, e.g.:

```js
// Before:
'open-recent-file': { endpoint: 'GET /api/recent/:id', fn: () => stub('open-recent-file', '/api/recent/:id') },

// After:
'open-recent-file': { endpoint: 'GET /recent/:id', fn: () => stub('open-recent-file', '/recent/:id') },
```

Apply via the Edit tool with `replace_all: true` on the literal `/api/` → `/`. There are no `/api/` occurrences in this file outside of stub endpoint strings, so a literal replace is safe. Re-run the count to confirm zero remain.

- [ ] **Step 3: Refresh the "in-scope actions" comment block**

Replace the comment at [actions.js:63-74](../../frontend/src/actions.js#L63):

```js
/**
 * Actions already handled in app.js (in-scope, real implementations):
 *   navigate-screen, navigate-path, navigate-crumb, switch-tab, close-tab, new-tab,
 *   toggle-sidebar, toggle-inspector, toggle-theme, set-view-mode,
 *   focus-search, filter-by-tag, open-tag-canvas, close-tag-canvas,
 *   tag-canvas-select, nav-back, nav-forward, nav-up,
 *   open-review-bin, switch-home-tab, switch-inspector-tab,
 *   open-palette, close-palette, palette-set-mode,
 *   modal-cancel, modal-confirm, modal-confirm-type,
 *   ef-filter, ef-sort, ef-toggle-pause-ai, ef-toggle-moving-card,
 *   scan-config-switch-mode,
 *   settings-nav, settings-set-theme, settings-set-density,
 *   settings-set-accent-hex, settings-reset-accent, settings-set-accent-glow,
 *   settings-set-show-notifications, settings-set-tab-style, settings-set-click-mode
 *
 * All others below are stubs awaiting backend implementation.
 */
```

The agent should diff against the current block and only adjust to match. Do not invent action names — confirm each listed name is actually handled in [app.js:1536-1729](../../frontend/src/app.js#L1536) (the giant switch).

- [ ] **Step 4: Verify**

Run: `grep -c "/api/" c:/Dev/FilePlus/frontend/src/actions.js`
Expected: `0`

Run: `grep -n "API_BASE" c:/Dev/FilePlus/frontend/src/actions.js`
Expected: still mentions `API_BASE` in the comment header and `apiFetch()`. The change only affects path strings, not the constant.

- [ ] **Step 5: Smoke-test**

Run: `cd c:/Dev/FilePlus/frontend && npm start`
Click around: Home tabs, sidebar items, click a few `cm-*` actions. Stub toasts should still log to the DevTools console with the new (no-prefix) endpoint names. Nothing should crash.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/actions.js
git commit -m "refactor(actions): drop /api prefix; refresh in-scope action list

The api.py implementation registers routes without an /api prefix
(/health, /files, /scan, /fs/list, ...). Stub endpoint strings in
actions.js carried the /api prefix from an earlier convention; aligned
to no-prefix per docs/backend-integration.md Cross-cutting #4. Strings
are descriptive only (stub() logs them; never fetched) — pure cleanup."
```

---

## Task 2: URL-prefix sweep + dead Ollama CSP entry in index.html

**Files:**
- Modify: `frontend/index.html` (52 `/api/` occurrences in `<!-- INTEGRATION: ... -->` comments; CSP at line 7)

**Why:** Same convention sweep as T1 but in HTML comments. Plus the CSP `connect-src` allows `http://localhost:11434` (Ollama) — the Electron renderer never talks to Ollama directly; only [backend/classifier.py](../../backend/classifier.py) does. The CSP entry is dead.

- [ ] **Step 1: Audit current state**

Run: `grep -c "/api/" c:/Dev/FilePlus/frontend/index.html`
Expected: `52`

Read [frontend/index.html:6-7](../../frontend/index.html#L6) to confirm CSP form.

- [ ] **Step 2: Replace `/api/` → `/` in index.html**

Use Edit with `replace_all: true` on the literal string `/api/` → `/`. The HTML has no `/api/` occurrences outside of comment strings (verified by reading the file structure), so a literal replace is safe. All 52 hits are in `<!-- INTEGRATION: GET /api/... -->` comments which the browser ignores anyway.

- [ ] **Step 3: Remove the Ollama entry from CSP**

Replace the CSP meta tag content (line 7):

```html
<!-- Before: -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:9876 http://localhost:9876 http://localhost:11434; style-src 'self' 'unsafe-inline';" />

<!-- After: -->
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:9876 http://localhost:9876; style-src 'self' 'unsafe-inline';" />
```

- [ ] **Step 4: Verify**

Run: `grep -c "/api/" c:/Dev/FilePlus/frontend/index.html`
Expected: `0`

Run: `grep -c "11434" c:/Dev/FilePlus/frontend/index.html`
Expected: `0`

- [ ] **Step 5: Smoke-test**

Run: `cd c:/Dev/FilePlus/frontend && npm start`
The window opens; backend status dot is green (assumes `python -m backend.api` is up); navigation works. No CSP-violation errors in the DevTools console (F12 → Console).

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html
git commit -m "refactor(html): drop /api prefix in INTEGRATION comments; remove dead Ollama CSP entry

INTEGRATION comments documented future endpoints with the /api prefix;
backend uses no prefix. Aligned per docs/backend-integration.md.
CSP connect-src listed http://localhost:11434 but the renderer never
talks to Ollama directly (only backend/classifier.py does), so the
entry was dead surface area."
```

---

## Task 3: Move tray inline script to external file

**Files:**
- Create: `frontend/tray/tray.js`
- Modify: `frontend/tray/index.html` (lines 6 CSP, 574-657 inline script)

**Why:** [tray/index.html:7](../../frontend/tray/index.html#L7) declares `script-src 'self'` (no `'unsafe-inline'`). [tray/index.html:574-657](../../frontend/tray/index.html#L574) is an inline `<script>`. Browsers refuse to execute it; the entire tray window is non-functional. Moving the script to an external file is a pure refactor — no behavior change, only "make the existing code actually run."

This is the most behavior-affecting task in the plan but is genuinely a bug fix: the tray's intended behavior is what the inline script encodes; CSP just prevents it. After this task the tray is exactly what the existing code says it should be — no new features.

The renderer also has 5 `/api/` occurrences in INTEGRATION comments; sweep them too in this same task to keep the file's commit history coherent.

- [ ] **Step 1: Read the existing inline script**

Read [tray/index.html:574-657](../../frontend/tray/index.html#L574). The script body is the lines between `<script>` and `</script>`, exclusive.

- [ ] **Step 2: Create `frontend/tray/tray.js`**

Write a new file at `frontend/tray/tray.js` containing the existing script body verbatim, preserving indentation. Do not modify the JS at all.

- [ ] **Step 3: Replace the inline `<script>` with an external reference in `tray/index.html`**

Replace the entire `<script>...</script>` block (lines 574-657) with:

```html
<script src="tray.js"></script>
```

- [ ] **Step 4: URL-prefix sweep on tray INTEGRATION comments**

Use Edit with `replace_all: true` on the literal string `/api/` → `/` in `frontend/tray/index.html`. 5 hits, all in `<!-- INTEGRATION: ... -->` comments.

- [ ] **Step 5: Verify file structure**

Run: `ls c:/Dev/FilePlus/frontend/tray/`
Expected: contains `index.html` and `tray.js`.

Run: `grep -c "/api/" c:/Dev/FilePlus/frontend/tray/index.html`
Expected: `0`

Run: `grep -c "<script" c:/Dev/FilePlus/frontend/tray/index.html`
Expected: `1`  (just the external `<script src="tray.js">` reference)

- [ ] **Step 6: Smoke-test**

The tray window is normally opened via the Electron tray icon. If a tray icon launcher isn't wired, open `tray/index.html` directly via DevTools `loadFile`, or temporarily route `main.js` to load it. Confirm:
- Page renders (no CSP violation in console)
- Tab switching between Recent / Favorites toggles the `active` class
- Clicking a `.tray-row` adds `selected` class
- Right-clicking a row shows the context menu

If the tray launcher isn't yet wired, mark this as "verified by file inspection" and note in the commit that runtime verification is pending the tray-launcher work.

- [ ] **Step 7: Commit**

```bash
git add frontend/tray/index.html frontend/tray/tray.js
git commit -m "fix(tray): move inline script to tray.js so CSP doesn't block it

CSP in tray/index.html declares script-src 'self' (no 'unsafe-inline'),
which silently blocks the inline script that encodes the tray's tab
switching, row selection, and context menu. Pure refactor: script body
moved verbatim to tray.js, referenced via <script src>. Behavior is now
what the existing code always intended.

Also swept /api/ -> / in INTEGRATION comments per the no-prefix
convention."
```

---

## Task 4: Move setup inline script to external file

**Files:**
- Create: `frontend/setup/setup.js`
- Modify: `frontend/setup/index.html` (CSP at line 6/7; inline script at lines 899-1033)

**Why:** Same issue as Task 3. [setup/index.html:7](../../frontend/setup/index.html#L7) is `script-src 'self'`; lines 899-1033 are an inline `<script>` block that the CSP blocks.

The setup window has 1 `/api/` occurrence — sweep it for consistency.

- [ ] **Step 1: Read the inline script**

Read [setup/index.html:899-1033](../../frontend/setup/index.html#L899).

- [ ] **Step 2: Create `frontend/setup/setup.js`**

Verbatim move of the script body. No JS changes.

- [ ] **Step 3: Replace the inline block with an external reference**

```html
<script src="setup.js"></script>
```

- [ ] **Step 4: Sweep `/api/` → `/` (1 occurrence)**

Edit with `replace_all: true`.

- [ ] **Step 5: Verify**

Run: `ls c:/Dev/FilePlus/frontend/setup/`
Expected: contains `index.html` and `setup.js`.

Run: `grep -c "/api/" c:/Dev/FilePlus/frontend/setup/index.html`
Expected: `0`

Run: `grep -c "<script" c:/Dev/FilePlus/frontend/setup/index.html`
Expected: `1`

- [ ] **Step 6: Smoke-test (best-effort)**

The setup window is normally only opened on first run. If it isn't wired into a launcher yet, verify by file inspection. If you can launch it via Electron, confirm the chat panel renders, mode toggles work, and no CSP-violation errors appear in the DevTools console.

- [ ] **Step 7: Commit**

```bash
git add frontend/setup/index.html frontend/setup/setup.js
git commit -m "fix(setup): move inline script to setup.js so CSP doesn't block it

Same root cause as the tray fix: CSP declares script-src 'self' but the
file ships an inline <script>. Refactor only — script moved verbatim
into setup.js. Also swept /api/ -> / in the one INTEGRATION comment."
```

---

## Task 5: Remove duplicate `ipcMain` import in main.js

**Files:**
- Modify: `frontend/main.js` (lines 7 and 40)

**Why:** [main.js:7](../../frontend/main.js#L7) imports `ipcMain` at module scope:

```js
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
```

Then [main.js:40](../../frontend/main.js#L40) re-imports it inside `app.whenReady()`:

```js
const { ipcMain } = require('electron');
```

The inner one shadows but uses the same module — purely redundant. Pure cleanup.

- [ ] **Step 1: Confirm both imports**

Read [main.js:1-50](../../frontend/main.js#L1).

- [ ] **Step 2: Remove the inner re-import**

Delete the line at [main.js:40](../../frontend/main.js#L40):

```js
const { ipcMain } = require('electron');
```

The outer import at line 7 already provides `ipcMain` in scope.

- [ ] **Step 3: Verify**

Run: `grep -nc "ipcMain" c:/Dev/FilePlus/frontend/main.js`
Expected: 1 import + N usages (currently 9 usages of `ipcMain.on`, so `grep -c` should drop from 11 to 10).

Or grep for the `require('electron')` calls: should be exactly 1.

- [ ] **Step 4: Smoke-test**

`npm start` from `frontend/`. Window opens, min/max/close buttons work, F12 toggles DevTools, Ctrl+= zooms. No JS errors in the main-process log.

- [ ] **Step 5: Commit**

```bash
git add frontend/main.js
git commit -m "refactor(main): drop duplicate ipcMain re-import

ipcMain was already destructured from 'electron' at the top of the
file; re-importing it inside app.whenReady() was a no-op shadow."
```

---

## Task 6: Clear setInterval on `beforeunload` in app.js

**Files:**
- Modify: `frontend/src/app.js` (around line 1975)

**Why:** [app.js:1975](../../frontend/src/app.js#L1975) starts a 30-second `checkBackend` poll without storing the interval id. On hot-reload (the user manually F5s during dev — see [docs/task-list.md](../../task-list.md)), each reload starts a new interval; the old one keeps running attached to the page that's already gone, leaking timers and doubling the poll rate per reload. Storing the id and clearing it on `beforeunload` fixes the leak with no behavior change.

- [ ] **Step 1: Read context around line 1975**

Read [app.js:1970-1985](../../frontend/src/app.js#L1970) to see the full DOMContentLoaded block.

- [ ] **Step 2: Capture the interval id and add cleanup**

Find:
```js
setInterval(checkBackend, 30_000);
```

Replace with:
```js
const _backendPollId = setInterval(checkBackend, 30_000);
window.addEventListener('beforeunload', () => clearInterval(_backendPollId), { once: true });
```

The `{ once: true }` ensures the listener removes itself after firing.

- [ ] **Step 3: Verify**

Run: `grep -nE "setInterval|clearInterval" c:/Dev/FilePlus/frontend/src/app.js`
Expected: shows exactly the new pair plus the existing usage line.

- [ ] **Step 4: Smoke-test**

`npm start`, open DevTools (F12) → Console. Watch for the periodic /health fetches. Reload the page (Ctrl+R). No "fetch already in progress" warnings; no doubled polling rate after reload.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app.js
git commit -m "fix(app): clear backend-health setInterval on beforeunload

Previously the 30s poller kept firing after page reload (timer still
attached to the unloaded page). Capture the id and clear it via a
beforeunload listener so hot-reloads don't leak timers."
```

---

## Task 7: Update CLAUDE.md to reflect real repo state

**Files:**
- Modify: `CLAUDE.md` (the "Current State" and "Next Task" sections at the bottom)

**Why:** [CLAUDE.md:74-76](../../CLAUDE.md#L74) says:

```
## Current State
Phase 1 complete: hasher, indexer, database schema implemented and tested (18/18 passing).

## Next Task
Phase 2 per PLAN.md: tagger.py (metadata extraction via Pillow / mutagen / python-magic-bin).
```

But Phase 3 (FastAPI backend skeleton, `/health`, `/files`, `/scan`, `/fs/list`) was started before Phase 2. [docs/task-list.md](../../task-list.md) confirms this. CLAUDE.md is misleading for the next agent.

- [ ] **Step 1: Read existing CLAUDE.md tail**

Read [CLAUDE.md:70-80](../../CLAUDE.md#L70).

- [ ] **Step 2: Replace the "Current State" / "Next Task" sections**

```markdown
## Current State

- **Backend:** Phase 1 complete (hasher, indexer, database schema; 18/18 tests passing). Phase 3 partially done — `backend/api.py` ships `/health`, `/files`, `/files/{id}`, `/fs/list`, `/fs/list/root`, `/scan`, `/tags`. Phase 2 modules (`tagger.py`, `classifier.py`) are still stubs.
- **Frontend:** Global chrome polished (titlebar, tab bar, sidebar, toolbar, status bar). Home + Browser screens partially live. All other screens are HTML stubs with placeholder data.
- **Integration:** `POST /scan` calls the indexer and returns count; `GET /files` and `GET /fs/list` are wired. Inspector opens on row click but most fields are placeholders.
- **Tests:** 18/18 passing (indexer + hasher + config). No tests for API or frontend yet.

## Next Task

Two reasonable orderings exist:
1. **Finish Phase 2** (`tagger.py` then `classifier.py`) so the scan pipeline produces real categories and tags. Recommended if the next visible feature is real Inspector tags or the Review Bin.
2. **Implement `operations_log.py` + `mover.py`** (Phase 10) so any file-touching action — drag-drop, right-click rename/delete, snapshot restore — is safe and undoable. Recommended if the next visible feature involves moving files.

See [docs/backend-integration.md](docs/backend-integration.md) for the full per-screen backend feature list and [PLAN.md](PLAN.md) for phase definitions.
```

- [ ] **Step 3: Verify**

Read [CLAUDE.md:70-100](../../CLAUDE.md#L70). The new wording should be accurate against the real state of [backend/](../../backend/).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): correct Current State / Next Task to match repo

Phase 3 was started before Phase 2; api.py exists as a partial Phase 3
implementation. Updated CLAUDE.md so the next agent sees an accurate
picture of what's wired vs. stubbed."
```

---

## Task 8: Move `fileplus-feature-list.md` into `docs/`

**Files:**
- Move: `fileplus-feature-list.md` → `docs/fileplus-feature-list.md`

**Why:** The file is at the repo root, but every other long-form spec lives in `docs/`. No file in the repo references it (verified via grep). A pure `git mv` keeps history.

- [ ] **Step 1: Verify nothing references the file**

Run: `grep -rn "fileplus-feature-list" c:/Dev/FilePlus/ --include="*.md" --include="*.py" --include="*.js" --include="*.html" 2>/dev/null`
Expected: no matches (the file's own filename excluded).

If matches appear (e.g. in CLAUDE.md or a build script), update them to `docs/fileplus-feature-list.md` in the same commit.

- [ ] **Step 2: Move the file**

Run: `git mv c:/Dev/FilePlus/fileplus-feature-list.md c:/Dev/FilePlus/docs/fileplus-feature-list.md`

- [ ] **Step 3: Verify**

Run: `ls c:/Dev/FilePlus/fileplus-feature-list.md 2>/dev/null && echo "STILL AT ROOT" || echo "MOVED OK"`
Expected: `MOVED OK`

Run: `ls c:/Dev/FilePlus/docs/fileplus-feature-list.md && echo OK`
Expected: file listed + `OK`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: move fileplus-feature-list.md into docs/

All other long-form specs live in docs/; the root-level location was
inconsistent. Pure git mv — no file references this path."
```

---

## Self-Review

**Spec coverage:**
- Contradictions § 1.1 (URL prefix) — Tasks 1, 2 (and the doc was already updated in the previous turn).
- Contradictions § 1.2 (schema migration silent except) — **out of scope** (backend code).
- Contradictions § 1.3 (PLAN.md vs reality) — Task 7 (CLAUDE.md fix).
- Contradictions § 1.4 (tray CSP) — Task 3.
- Contradictions § 1.5 (stale in-scope comment block) — Task 1 step 3.
- Contradictions § 1.6 (docs use `/api/` prefix) — Task 2 + previously rewritten doc.
- Contradictions § 1.7-1.8 (STUB_SCREENS classification) — **deliberately deferred**: fixing requires deciding whether to surface or remove the stub toast, which is a behavior call the user should make.
- Optimization § 2.1-2.10 — all backend; **out of scope**.
- Optimization § 2.8 (setInterval cleanup) — Task 6.
- Optimization § 2.11 (giant switch) — **deferred**: too risky to refactor dispatch in this pass.
- Better-implementation § 3.1-3.7, 3.10-3.11, 3.15-3.16 — all backend or backend-adjacent; **out of scope**.
- Better-implementation § 3.8-3.9 (docs reorg) — Task 8 covers the smaller piece (feature-list move). The 4-design-doc consolidation is **deferred**: it requires content judgement on what's canonical.
- Better-implementation § 3.13 (hardcoded background colour in main.js) — **deferred**: requires either a token sync mechanism or a small constants module; risk of bikeshedding outweighs cleanup gain.
- Tray inline script (separate from contradiction list, surfaced in cross-cutting) — Task 3.
- Setup inline script — Task 4 (parallels Task 3).
- Duplicate ipcMain import — Task 5.

**Placeholder scan:** No "TBD"/"TODO"/"add validation" patterns. Every step lists exact files, exact commands, expected output.

**Type consistency:** No types or function names introduced; all changes are to comment strings, file moves, and one `setInterval` capture. The single new identifier (`_backendPollId`) is used only in the same task.

**Risk gates:**
- Tasks 1, 2, 7, 8: zero behavior risk (comments / docs / file moves).
- Tasks 3, 4: behavior risk is the *opposite* of normal — these tasks make code that is currently dead start running. Mitigated by file-by-file verbatim moves (no JS edits).
- Task 5: removing a redundant import — zero risk.
- Task 6: adding a cleanup listener — zero risk, only fires on unload.

---

## Execution Order

T1, T2, T7 are independent and parallel-safe.
T3, T4 are independent and parallel-safe.
T5, T6 are independent and parallel-safe.
T8 is independent and parallel-safe.

All eight tasks can be dispatched in parallel. There are no shared files between tasks (T1 = actions.js only; T2 = index.html only; T3 = tray/* only; T4 = setup/* only; T5 = main.js only; T6 = app.js only; T7 = CLAUDE.md only; T8 = fileplus-feature-list.md move).
