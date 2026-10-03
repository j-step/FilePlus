# Stage 2D addendum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One header bar (identity card + tabs + caption buttons), search that shrinks further and pushes instead of covering, a consistent modal blur, the This PC half-way-down bug fixed, and a deep pass of quick subtle animations behind a Settings switch.

**Architecture:** Plain-JS renderer and CSS. There is one motion gate, `html[data-motion]`, driven by `ui.animations`, with duration/easing tokens and one z-index token scale. JS animations use the Web Animations API through one helper that checks the gate and is always cancellable.

**Tech Stack:** Electron 41, plain JS globals, CSS tokens, `@playwright/test` via `frontend/test/harness/app.js`.

**Spec:** `docs/superpowers/specs/2026-10-03-stage-2d-addendum-design.md`. Every task cites its section; read it first. The parent spec `2026-10-01-stage-2d-playtest-2-design.md` and CLAUDE.md still bind.

## Global Constraints

- CLAUDE.md is binding: safety rules, load order, tokens only, no hardcoded paths, `showToast` / `showSnackbar` only from app.js, sprite only through `scripts/build_icons.js`.
- Commit hygiene: stage files by name only and check `git diff --cached --name-only`. Never use `git add -A` / `.` / `commit -a`. End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` must be green before each commit, and only one verify may run at a time.
- No `waitForTimeout` in tests (there are 0). Use test hooks (`__fpInitDone`, `__fpRenderCount`, `__fpLoadPending`, `__fpInspectorPending`, `__fpIconsIdle()`, `__fpStubHits`) and `expect.poll`. The renderer.log console-error gate applies.
- Motion rules: spec §5.1, rules 1–6.
- Stage 2D behaviours must not regress:
  - single render per navigation, with no icon flash;
  - `patchDirectory` keeps DOM nodes;
  - screen-px panels under `--app-zoom`;
  - the chrome mouse-focus model;
  - the toolbar collapse order and the current crumb never faded;
  - the drive tab label is the letter only.

## Review Focus

1. Rapid input during animations: double-click "+", spam Ctrl+W, arrow-hold, a fast Ctrl+wheel. The state must be correct immediately and nothing may queue up.
2. The Animations switch turned off mid-animation: everything snaps to its final state.
3. Big folders (5k–10k rows): no per-row animation and no frame drops on navigation.
4. Header bar at an 800 px window width, at 150% zoom, maximized, and with a long device name.
5. Modal open over Mica in light and dark themes: nothing stays sharp.

---

### Task 1: Motion infrastructure and the Animations switch (spec §5.1, §5.3 harness)

**Files:** `frontend/src/styles.css` (`:root` motion tokens; `html[data-motion="off"]` global zeroing; convert every `@media (prefers-reduced-motion…)` to the gate), `frontend/src/app.js` (apply `data-motion` from `ui.animations` at startup before first paint and on change; a `fpAnimate(el, keyframes, opts)` helper that returns null when motion is off and cancels prior animations on the same element/key; `fpMotionOn()`), `frontend/src/settings.js` + `frontend/index.html` (Personalization › "Animations" toggle, default on), every JS-driven ease (zoom `zoomTo` in preload/app.js, refresh spin/dip, the search width transition) reads `fpMotionOn()`, `frontend/test/harness/app.js` (`launchApp({motion=false})`, default off, applied deterministically before tests act), `scripts/check_motion.js` (new gate run by verify.ps1 frontend-gates: no literal `transition`/`animation` durations or easings outside tokens in styles.css; every `@keyframes` used only under the gate), tests `frontend/test/stage2d-motion.spec.js` (switch on/off, getAnimations empty when off, tokens ≤ 200 ms).
**Produces:** `fpMotionOn(): boolean`, `fpAnimate(el, keyframes, {duration:'fast'|'base'|'slow'|'instant'|ms, easing:'out'|'in'|'standard', key?}) → Animation|null`, `fpMotionChanged` event on document, tokens `--motion-instant/fast/base/slow`, `--ease-out/in/standard`.
- [ ] Failing tests → implement → verify → commit `feat(motion): animation switch, motion tokens, one motion gate (addendum §5.1)`.

### Task 2: This PC drops half-way down (spec §4)

**Files:** `frontend/src/thispc.js`, `frontend/src/browser.js` (`setThisPcShown`, view DOM state), `frontend/src/styles.css`; test in `frontend/test/stage2d-thispc.spec.js`.
- [ ] Reproduce with a failing test (icons@96, long folder, scrolled → This PC; every view → This PC; This PC → icon view) → root cause → fix → verify → commit `fix(thispc): drive cards always start at the top after an icon view (addendum §4)`.

### Task 3: One z-index scale and a consistent modal blur (spec §3)

**Files:** `frontend/src/styles.css` (`--z-*` scale, every literal z-index moved onto it, scrim layer), `frontend/index.html` / `frontend/src/app.js` / `properties.js` / `search.js` (scrim placement at body level), tests in a new `frontend/test/stage2d-addendum.spec.js` (open each scrimmed surface; `elementFromPoint` at sidebar text, header bar, overlay thumb, status bar returns the scrim; the scrim's computed `backdrop-filter` (or the dim fallback) applies to the whole window). Screenshots dark and light with Mica on (flattened capture is fine).
- [ ] Failing test → fix → LOOK at screenshots → verify → commit `fix(layers): one z-index scale; the modal scrim blurs the whole window evenly (addendum §3)`.

### Task 4: One header bar (spec §1)

**Files:** `frontend/index.html` (title bar + tab bar → one bar; identity card moved out of the sidebar; collapse toggle moved into the sidebar top row), `frontend/src/styles.css`, `frontend/src/app.js` (tab strip, `layoutToolbar`-style sizing of the card region from `--sidebar-w-screen`, device-name rename, maximize glyph, caption buttons), `frontend/main.js` / `preload.js` only if `titleBarOverlay` is chosen, tests in `stage2d-addendum.spec.js` + updates to specs that reference the old title bar / tab row / sidebar card (grep `fp-titlebar`, `tabbar`, `sidebar-brand`, device-name tests, `#btn-close`, window controls).
- [ ] Failing tests (single bar: tabs and caption buttons share one row; old small logo/title gone; card width = sidebar width expanded, natural when collapsed, never hidden; card visible in rail mode; drag region exists; rename still works; tabs overflow/drag/focus intact; 800 px + 150% no clipping) → implement → LOOK at screenshots (expanded, collapsed, maximized, light, dark, 800 px, 150%) → verify → commit `feat(chrome): one header bar — identity card, tabs and caption buttons together (addendum §1)`.

### Task 5: Search shrinks further, keeps its grey when collapsed, pushes when expanded (spec §2)

**Files:** `frontend/src/app.js` (`layoutToolbar` min 120 px, collapsed-expand mode in-flow), `frontend/src/search.js`, `frontend/src/styles.css`; tests in `stage2d-toolbar.spec.js` (update invariants: search ≥ 120 or collapsed; collapsed magnifier has the field fill; expanding from collapsed keeps breadcrumb rect left of the bar with no overlap (search rect ∩ breadcrumb rect = ∅), current crumb still readable/ellipsized; animation ≤ 140 ms when motion on, instant when off).
- [ ] Failing tests → implement → LOOK at screenshots → verify → commit `feat(search): shrinks to 120 px before folding; collapsed button keeps the field fill; expanding pushes the path (addendum §2)`.

### Task 6: Motion pass — chrome (spec §5.2 rows Tabs, Screens, Inspector, Sidebar, Menus/popovers, Dialogs, Notices, Buttons/toggles, Window, Settings, Ask File+)

**Files:** styles.css, app.js, inspector.js, settings.js, properties.js, search.js (dropdown), tests in `stage2d-motion.spec.js` (each listed interaction: animation runs when on (getAnimations or transition non-zero), duration ≤ token, input not delayed (act immediately after), nothing when off).
- [ ] Implement area by area → verify → commit `feat(motion): tabs, screens, panels, menus, dialogs, notices, controls (addendum §5.2 chrome)`.

### Task 7: Motion pass — content (spec §5.2 rows Folder navigation, Breadcrumb, Rows & selection, New/Removed items, Rename, Cut/copy, Drag & drop, Views & sort, Search, This PC, Home)

**Files:** browser.js (navigation enter animation after the single render; FILP for sort ≤ 30 visible rows; exit ghosts for removed rows), dragdrop.js, home.js, thispc.js, search.js, styles.css; tests in `stage2d-motion.spec.js` (navigation direction; icons painted in frame 1 still settled with motion on; delete: DOM/selection updated in the same task, ghost has `pointer-events:none` and is gone ≤ 200 ms; >30 rows → no per-row animations; arrow-hold and Ctrl+wheel steps start no per-row animations; 5k-row folder navigation stays within the Stage 2D bounds with motion on).
- [ ] Implement → verify → commit `feat(motion): navigation, rows, selection, drag, views, search, This PC, Home (addendum §5.2 content)`.

### Task 8: Final review, QA, docs, merge, push

- [ ] Final whole-branch review of the addendum range (most capable model) + qa agent run in parallel → one fix wave → scoped re-review.
- [ ] Docs: CLAUDE.md (header bar, motion gate/tokens/helper, z-index scale, harness motion flag, reduced-motion no longer used), UI-SPEC, run doc addendum section with rulings + feel-check items.
- [ ] Merge: `setup/dev-harness` (2 docs commits) and `stage/2d-playtest-2` into master (resolve CLAUDE.md), verify on master green, main checkout on master and `git status` empty, push master to origin.
