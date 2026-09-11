# FilePlus Roadmap — Design Spec

**Date:** 2026-09-10
**Status:** Approved by author (JJ Texeira) in brainstorm session, 2026-09-10. Canonical roadmap. Supersedes `PLAN.md` phase ordering and `docs/task-list.md`.
**Scope:** How FilePlus gets from "polished mockup with an indexer" to a daily-driver explorer the author actually uses, then to the full AI-organising product. Each stage below gets its own brainstorm → spec → plan → autonomous run cycle. This document is the contract between those cycles.

---

## 1. What FilePlus is

A Windows Explorer replacement where new files land in one inbox, the AI proposes where each one belongs, the user approves with one click, and every move the app ever makes is logged and undoable.

**User:** the author, daily driver, open all day. A few friends later. Job to be done: "get to the right file, or let the AI sort it, and get out."

**Three pillars, in order of daily value:**

1. **Browse.** Fast, dense, tabbed explorer: sidebar, breadcrumbs, list/grid views, Inspector pane (preview / tags / history), Ctrl+K palette.
2. **Sort.** The Everything Folder inbox. Browsers download into it; a watcher sees each file; rules engine then LLM classifies it; low-confidence files go to the Review Bin for approve / redirect / leave. Overrides are training signals. Tray popout shows the queue.
3. **Overhaul.** The big scan: index all drives, dedupe, cleanup suggestions, then a proposed folder tree the user edits before executing. Snapshots + Time Machine restore any prior state.

**Supporting:** system/AI/user tags, tag canvas, smart folders (saved queries), natural-language command bar, per-op and per-batch undo.

**Non-negotiable safety rules** (unchanged from `CLAUDE.md`): nothing moves without approval; every operation is logged before it executes; path guard stays on until validated; deletes go to Recycle Bin or staging, never straight to gone.

**Personality:** tool, not toy. Dense, legible, satisfying. AI is silent infrastructure. Nobody should notice the design.

---

## 2. State of the repo on 2026-09-10

122 commits, all between 2026-04-23 and 2026-04-27. Nothing since.

| Layer | Real | Stub / mockup |
|---|---|---|
| Backend (~900 LoC real) | `config.py` (+ `path_guard`), `database.py` (schema v2, migrations), `hasher.py`, `indexer.py`, `api.py` (7 endpoints: `/health`, `/files`, `/files/{id}`, `/fs/list`, `/fs/list/root`, `POST /scan`, `/tags`) | `tagger.py`, `classifier.py`, `watcher.py`, `mover.py`, `operations_log.py`, `snapshotter.py` — all `pass` |
| Frontend (~11.5k LoC) | Shell chrome, tabs, sidebar, nav history, theme/zoom/density/accent settings in localStorage, Browser list rendered from `/fs/list`, Home Favorites unfavorite | 9 of 10 screens show placeholder data; ~130 of 177 `data-action` values hit a stub toast; 74 `INTEGRATION:` comments |
| Tests | 30 passing (18 indexer/hasher/config, 7 API fs, 5 placeholders) | No frontend tests, no smoke test |
| Docs (~8k lines) | `PRODUCT.md`, `docs/UI-SPEC.md`, `docs/backend-integration.md` (1096-line per-screen wiring ledger) | `docs/design-brief.md` (superseded), `docs/design-tokens.md`, `DESIGN.md`, `DESIGN.json`, `PLAN.md`, `docs/task-list.md`, two audit/refinement reports — overlapping and partly stale |
| Working tree | — | ~1,600 lines uncommitted from the 2026-04-27 code-cleanup plan (9 files + 2 new: `tray/tray.js`, `setup/setup.js`) |

**Diagnosis.** The April work optimised chrome pixels on a static mockup. The app cannot yet do the one thing it exists for: no file has ever been classified, moved, or undone. The doc-to-code ratio is roughly 9:1.

---

## 3. Decisions made 2026-09-10

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | v1 minimum before daily use | **Explorer parity first.** Real drives, tabs, search, open/rename/move/delete with undo. AI sorting second. | Stage 2 is the explorer; Everything Folder moves to Stage 3. |
| D2 | Sandbox graduation | **Split guard: read real, write sandboxed.** Browse/search real drives from day one. Writes locked to sandbox until ops-log + undo tests pass; then a single config flag unlocks writes. | `path_guard()` gains a mode parameter (`read` / `write`). New flag `WRITE_UNLOCKED`. |
| D3 | Autonomous run review | **Branch per stage, commit per task, review at end.** | Each stage runs in a worktree; run ends with summary + screenshots; author reviews once, merges. |
| D4 | AI tier order | **Decide in Stage 3 brainstorm** after measuring against an eval set. Provider interface built so either order works. | No Ollama assumption baked into code. |
| D5 | Redesign timing | **Redesign first, then build.** Author will not live with the current design. | Stage 1 is the redesign. Bounded by D6. |
| D6 | Redesign budget | **One system pass, then stop.** Tokens + all shared components + chrome/Home/Browser, one run, one review. Corrections queue for later stages. | Guardrail against repeating April. Placeholder screens get restyled when they become real. |
| D7 | Redesign dislikes | Purple/amber palette, tactile chrome (bevels/glows/convex), Inter + JetBrains Mono. **Density and sizing stay.** | Layout, row heights, bar heights, spacing scale unchanged. |
| D8 | Redesign direction | **Windows 11 native × utilitarian dev tool.** Neutral greys, hairline borders, flat surfaces, system accent. Light + dark. Three boards were mocked on a design canvas (A Fluent, B Terminal, C Blend); **author chose C with A's typeface: Segoe UI Variable throughout, tabular figures for data, no monospace face.** Token values are in the canvas's board C token sheet (dark: win `#1c1d20`, content `#232428`, raised `#2b2c31`, border `#2f3136`, text `#e7e8ea` / `#a0a3aa` / `#74777f`, accent `#4cc2ff`; light: win `#f4f4f5`, content `#ffffff`, raised `#ebebed`, border `#e2e2e5`, text `#1d1e21` / `#5f6168` / `#8e9097`, accent `#0067c0`). | Direction settled 2026-09-10. Stage 1 spec refines exact values and component states from board C. |
| D9 | Stack | **Keep Electron + Python FastAPI.** | Changing it would cost a stage on its own. |
| D10 | Working rule "one fix at a time, reload, verify" | **Retired.** It was right for pixel polish; it is the opposite of what autonomous runs need. | Memory + CLAUDE.md updated. |

---

## 4. Principles for this roadmap

1. **Make it work before making it perfect** — with the single, bounded exception of Stage 1 (D5/D6).
2. **Verification is the product of Stage 0.** Long autonomous runs are only as good as the loop that tells them they are done. Tests, smoke tests, screenshots.
3. **Models will change under us.** Model IDs live in config, never in code. Every LLM call goes through one provider interface with structured, versioned contracts. A labeled eval set makes a model swap measurable in minutes.
4. **The filesystem is reality; the DB adapts.** Unchanged.
5. **Placeholders are debt, not progress.** A screen with fake data does not count as built. Stage 2 onward wires real data or leaves the screen out.
6. **One canonical doc per concern.** See §8.

---

## 5. Stages

Each stage: brainstorm → spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → autonomous run in a worktree branch → author review → merge.

### Stage 0 — Reset and harness

**Goal:** a clean tree and a verification loop good enough that an autonomous run can self-certify.

**Scope in:**
- Review and commit the 2026-04-27 cleanup work (9 modified + 2 new files). Split into logical commits if practical.
- Docs consolidation per §8. Rewrite `CLAUDE.md` for the new working mode (short: stack, safety rules, conventions, pointer to this spec, run protocol).
- Retire the one-fix-at-a-time rule in memory and docs (D10).
- **Test harness:**
  - Backend: pytest layer for every endpoint (`httpx.AsyncClient` against the FastAPI app), fixtures already in `tests/conftest.py`.
  - Sandbox fixture generator: a script that populates `FilePlusTestSandbox/` with a deterministic, varied file set (images, PDFs, text, code, duplicates, a >100 MB sparse file, hidden files, deep nesting, unicode names).
  - Electron smoke test: Playwright-for-Electron launches the app against a running backend, visits every screen, asserts no console errors, screenshots each screen to `artifacts/screenshots/`. This is the "did the UI break" gate for every later run.
  - One command runs everything (`scripts/verify.ps1`).
- Fix the `/api/` prefix decision everywhere (no prefix wins, per `docs/backend-integration.md` cross-cutting #4).

**Scope out:** any feature work, any restyle, any backend module beyond tests.

**Done when:** `verify` passes green on a fresh clone with one command; CLAUDE.md is under ~100 lines and accurate; `docs/` has one canonical file per concern and an `archive/` for the rest.

**Run shape:** one run, small.

### Stage 1 — Redesign (one system pass)

**Goal:** the app looks like something the author wants to open, per D7/D8, without touching layout or behaviour.

**Pre-work (done 2026-09-10):** design canvas with three rendered directions of the Browser screen; author chose board C with Segoe UI Variable throughout (D8). Stage 1 spec starts from board C's token sheet.

**Scope in:**
- New token set in `styles.css` `:root` (light + dark): neutral grey surface ramp, hairline border token, flat elevation model (borders + at most one subtle shadow for overlays), system-accent default with the existing `--accent-custom` override preserved, Segoe UI Variable (with fallback stack) for every role; data columns use `font-variant-numeric: tabular-nums`. The `--font-mono` token and JetBrains Mono are removed.
- Every shared `fp-*` component restyled: buttons, inputs, chips, badges, rows, sidebar items, tabs, segmented, toggle, slider, modal, popover, snackbar, toast, kbd pill, state dot, breadcrumb.
- Chrome (titlebar, tab bar, sidebar, toolbar, status bar), Home, Browser restyled.
- Remove the bevel/glow/convex/concave token families and the lightsaber glow feature. Remove `prefers-reduced-motion` exceptions that only existed for glow.
- Retire `DESIGN.md` / `DESIGN.json` per §8 and let `styles.css` be the token source.

**Scope out:** any layout change, any sizing change (D7), any placeholder screen beyond making sure it does not look broken with the new tokens, any new component, any behaviour change. Pixel iteration after the single review.

**Done when:** smoke test screenshots of chrome/Home/Browser match the approved direction; old token families are gone from `styles.css`; light and dark both pass a contrast check; author reviews once.

**Run shape:** one run. Uses the `impeccable` skill for the component pass.

### Stage 2 — Explorer parity

**Goal:** the author uses FilePlus instead of Explorer, every day, for browsing and ordinary file operations.

**Order inside the stage matters — safety first:**

1. **`path_guard(path, mode)`** with `read` (allowed anywhere) and `write` (sandbox-only until `WRITE_UNLOCKED=true`). Tests.
2. **`operations_log.py`**: `log_operation` (pre-execution row), `mark_executed`, `undo_operation`, `undo_batch`, crash-recovery scan for `executed=0` rows on startup. Tests.
3. **`mover.py`**: `move_file`, `rename`, `copy`, `delete_to_recycle` (via `send2trash` or the Shell API), `batch_*`, name-conflict policy (replace / skip / keep-both / cancel), disk-space check. Cross-volume move = copy + verify hash + remove. Tests against the sandbox.
4. **API**: `/fs/*` write endpoints, `/operations`, `/undo/*`, `/drives`, `/search`, `/files/{id}/preview`, `/config` (SQLite-backed settings table), `/recent`, `/pins`.
5. **Frontend wiring** (real data or nothing): drives in sidebar, Browser on real drives, Inspector Preview/Tags/History, context menus (file / folder / empty), rename (F2), delete (Recycle Bin), drag-and-drop move, copy/paste, multi-select, column sort, search (palette search mode), Home Recent from `recent_actions`, pinned folders, Settings persistence, Ctrl+Z undo, crash-recovery modal. `shell.openPath` / `showItemInFolder` via IPC.
6. **Retire `actions.js` dead dispatch** — either wire `ACTION_MAP` for real or delete it and keep the `app.js` switch as the single dispatcher. (Decide in Stage 2 brainstorm.)
7. **Graduation:** with tests green and the author having exercised writes in the sandbox, flip `WRITE_UNLOCKED`. Recycle Bin for deletes is the second safety net.

**Scope out:** any LLM call, Everything Folder, Review Bin, scan pipeline, snapshots, tag canvas, tray, onboarding. Screens for those stay hidden or clearly marked "not built" — no placeholder data.

**Done when:** author has used FilePlus as the default explorer for a week without falling back to Explorer for a browse/move/rename/delete task; `verify` green; every write in `operations_log`.

**Run shape:** one brainstorm; one or two runs (backend safety core, then frontend wiring).

### Stage 3 — AI layer and the Everything Folder

**Goal:** the Sort pillar works end to end, and swapping the model is a config change.

**Scope in:**
- `backend/providers/`: `Provider` protocol with `classify(files, context) -> list[Classification]`, `propose_tree(...)`, `chat(...)`. Implementations: `anthropic`, `ollama`, `openai_compatible`. Structured outputs (JSON schema), batching, retries, per-call cost + latency log to a `llm_calls` table. Model IDs and tier order in config only.
- **Eval set:** ~100 labeled sandbox files (`tests/eval/labels.json`) + `scripts/eval.py` that reports accuracy / cost / latency per provider+model. This is how D4 gets decided.
- `tagger.py` (deterministic system tags), rules engine, `classifier.py` orchestrating rules → tier 1 → tier 2 with confidence thresholds, `training_signals` write on override.
- `watcher.py` on the Everything Folder; approvals queue; Review Bin screen with real data; tray popout; status-bar count.
- Prompt caching for the shared system prompt; batching of low-confidence files.

**Scope out:** big scan, tree proposal, snapshots, palette chat.

**Done when:** a file dropped in the Everything Folder appears in the Review Bin with a proposal within seconds; approve moves it via `mover.py`; eval script runs against two providers and prints a table.

### Stage 4 — Overhaul

Big scan orchestrator with progress stream, dedupe + cleanup tabs, `propose_tree` via provider, tree editor UI (proposal mode on the File Tree canvas), `snapshotter.py` + restore, palette chat mode with "send to Review Bin", smart folders, tag canvas. Brainstorm decides sub-ordering.

### Stage 5 — Packaging

PyInstaller backend + electron-builder NSIS; main process spawns backend and waits on `/health`; first-run setup window; clean-VM test. Unchanged from the archived `PLAN.md` Phase 11.

---

## 6. Working protocol for autonomous runs

1. **Brainstorm** (author + Claude, `superpowers:brainstorming`) → stage spec committed.
2. **Plan** (`superpowers:writing-plans`) → task list with per-task test criteria committed.
3. **Run** in a worktree branch `stage/<n>-<slug>` (`superpowers:using-git-worktrees`). Executes via `superpowers:subagent-driven-development` or `executing-plans`. TDD for backend tasks.
4. **Per task:** implement → `verify` green → commit with conventional message. Never proceed on red.
5. **Run ends with:** `docs/superpowers/runs/<date>-stage-<n>.md` summary (what landed, what was skipped and why, open questions) + screenshot set from the smoke test.
6. **Stop conditions:** a destructive action outside the spec; a spec ambiguity that changes the design; `verify` red after two fix attempts on the same task.
7. **Author reviews** the summary and the running app once, requests corrections as a batched list (a second short run) or merges.
8. **Merge** to `master` via `superpowers:finishing-a-development-branch`.

The author's memory rule "one fix, reload, verify" is retired for build stages (D10). It may return, explicitly, for a future polish stage.

---

## 7. Model-churn requirements (apply from Stage 3 onward)

- No model ID string in any `.py` outside `config.py` defaults.
- Every provider call returns a typed, versioned result; prompts live in `backend/providers/prompts/` with a version suffix.
- `llm_calls` table logs provider, model, tokens in/out, cost estimate, latency, purpose.
- `scripts/eval.py` is the acceptance test for any model change.
- Tier order (for example `AI_TIERS=rules,anthropic:<model>,ollama:<model>`) is a config list, so re-ordering or dropping a tier needs no code change.
- Cloud spend cap is opt-in (per 2026-04-24 decision), but the cost log always runs.

---

## 8. Docs consolidation (executed in Stage 0)

| Keep as canonical | Concern |
|---|---|
| `CLAUDE.md` (rewritten, ≤100 lines) | Rules, stack, conventions, pointer to roadmap |
| `PRODUCT.md` | Product purpose, personality, principles |
| `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` (this file) | Roadmap and decisions |
| `docs/fileplus-feature-list.md` | Full long-term feature inventory (the backlog) |
| `docs/UI-SPEC.md` | Screen-by-screen UI behaviour spec (layout is fine — keep; strip style language that Stage 1 replaces) |
| `docs/backend-integration.md` | Per-screen wiring ledger; Stage 2/3 plans draw from it |
| `frontend/src/styles.css` `:root` | The single token source after Stage 1 |

| Archive to `docs/archive/` | Why |
|---|---|
| `PLAN.md` | Phase ordering superseded by this spec |
| `docs/task-list.md` | Superseded by stage plans |
| `docs/design-brief.md` | Already marked superseded |
| `docs/design-tokens.md`, `DESIGN.md`, `DESIGN.json` | Describe the design Stage 1 replaces |
| `docs/UI-AUDIT-2026-04-25.md`, `docs/UI-REFINEMENT-REPORT.md` | Historical |
| `fileplus-manual.pdf` | Original seed document |

---

## 9. Deferred to stage brainstorms

- **Stage 1:** component state details (hover, pressed, focus, disabled) for board C, whether Mica-style translucency is used (Electron `backgroundMaterial`), accent = Windows system accent by default or fixed blue.
- **Stage 2:** `actions.js` fate; Settings storage (SQLite config table vs electron-store); whether `/files` (index) and `/fs/list` (live) stay separate or unify; default-folder-handler registration timing.
- **Stage 3:** tier order (D4); whether Ollama ships at all in v1; eval set composition; confidence thresholds.
- **Stage 4:** tree editor as canvas vs two-pane list; snapshot retention.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Stage 1 becomes April again | D6 hard budget; no pixel iteration after the single review; layout frozen. |
| Autonomous run drifts from spec | Stop conditions in §6; per-task commits make drift visible and reversible. |
| Write unlock on real disk hits a bug | D2 split guard, Recycle Bin, ops log with crash recovery, hash-verified cross-volume moves, disk-space check. |
| Model deprecation mid-project | §7: config-only IDs, eval script, provider interface. |
| Smoke test flakiness blocks runs | Screenshots are informational; the gate is "no console errors + every screen renders". |
| Electron + Python two-process packaging pain | Deferred to Stage 5; not on the daily-driver path. |
