# FilePlus UI Re-Pass — Design Spec

**Date:** 2026-04-25
**Author:** Justin (with Claude as scribe)
**Status:** Approved
**Supersedes (in part):** `docs/finalization-spec.md` (full archive)
**Source of truth going forward:** `docs/UI-SPEC.md` (created as a deliverable of this spec)

---

## 1. Why this spec exists

The FilePlus UI scaffolds have been built across multiple design passes. Today, every screen exists as HTML stubs but visual fidelity does not match the canonical design language. Three documents describe the UI in conflicting ways:

- `docs/design-brief.md` — the most recent and most thorough; explicitly self-declares as "the source of truth" and "supersedes earlier specs."
- `docs/finalization-spec.md` — older; describes a different aesthetic (violet/lavender/blue liquid-glass, Geist fonts) that was abandoned.
- `PRODUCT.md` — author-facing brand doc that contains lines that contradict both of the above (notably: "the single accent color must be swappable at runtime").

Additionally, `design-brief.md` contains internal contradictions (e.g. A.0 says "amber locked, identity consistency" while A.12.1 lists a swappable palette of lavender/indigo/violet/sky/mix).

This spec consolidates every contradiction into a single coherent decision set, reorganizes the documentation, and defines a two-phase workflow to bring the implementation up to that consolidated language using the `impeccable` skill.

---

## 2. Decision register

These decisions resolve every adjudicable contradiction surfaced during brainstorming. Each was confirmed by the author. They are captured here so the same questions are not re-litigated downstream.

### Q1 — Canonical spec
`design-brief.md` is canonical. Mine `finalization-spec.md` for any unique content, then archive it.

### A — Accent color identity (option A3)
**Default amber `#E8965E` ships out of the box. Custom hex override available in Settings → Personalization.** Brand identity is the design language as a whole, not a single locked color. Implementation: every accent-using component reads from a `--accent` CSS custom property. `--accent-custom` user override slot is added to the cascade. Light and dark modes use the same active accent value.

### B — File Tree "Comparison mode" (option B1)
**Dropped from v1. No v2-defer note.** The canvas has three modes only: Live / Snapshot view / Proposal review. Snapshot-to-snapshot comparison can be approximated by switching between snapshots in the right rail.

### C — `Ctrl+T` collision (option C1, with author's pick for File Tree key)
- `Ctrl+T` = **New tab** (matches every browser and file manager).
- `Ctrl+Shift+F` = **Open File Tree.**

### D — `Ctrl+1`–`Ctrl+9` collision and the new programmable-slot system
The original `Ctrl+1` = Home / `Ctrl+2` = Browser bindings collided with the spec's view-mode toggle on the same keys. Resolved by introducing a **`Ctrl+Num Navigation` mode setting** with three modes:

- **Tabs.** `Ctrl+1`–`Ctrl+9` jumps to that tab position (Chrome behavior).
- **Pages.** Programmable slots: `Ctrl+0` through `Ctrl+9` (10 slots). Each slot can hold one target — a screen-id OR an absolute folder path. While focused on a screen or in a folder, pressing an *unbound* `Ctrl+N` binds that slot to "open here." Pressing a *bound* `Ctrl+N` jumps to the target. Slots are managed in Settings → Account → Shortcuts → Quick Slots, where each slot shows its current binding (or `[unbound] — press Ctrl+N anywhere to assign`) and an unbind button. Rebinding requires clearing first.
- **Default.** Fixed screen mapping, non-programmable: `Ctrl+1` = Home, `Ctrl+2` = Browser, `Ctrl+3` = File Tree, `Ctrl+4` = Review Bin, `Ctrl+5` = Everything Folder, `Ctrl+6`–`Ctrl+9` unassigned.

The view-mode toggle moves off the number keys: `Ctrl+Shift+L` = List, `Ctrl+Shift+G` = Grid.

**Out-of-the-box default for the new setting:** `Pages` mode, with `Ctrl+1` and `Ctrl+2` pre-bound to Home and Browser (helpful starting state, user can clear).

### E — Inspector default state on Browser screen
**Closed by default.** First file-click in the session opens it (jump-cut, no slide). Persists across selections until manually closed. Does NOT auto-reopen on app restart.

### F — Downloads Folder — own screen or Settings only?
**Sidebar Quick Access entry that opens the Browser screen pointed at the Downloads path.** No bespoke "Downloads screen." Settings A.12.4 controls path, auto-purge, and excluded file types only.

### G — AI visibility in chrome
**Visual cues for deltas/results stay; AI personality iconography goes.**
- Keep: `good-edge` "new" badges on AI-suggested folder additions, `bad-edge` strikethrough for AI-suggested removals, `warn-edge` arrows for AI-suggested moves.
- Drop: `sparkles` Lucide icon in the Proposal-review banner. Replace with a neutral indicator (text label only, or `wand` icon if needed).
- Keep: chat interface in Scan Configuration (it's user-initiated, not AI-foregrounded).

### H — `prefers-reduced-motion` strictness
**Strict.** Under reduced-motion, all animation collapses to instant EXCEPT the live-data sparkline on the Scan Progress screen (sparkline = data, not decoration). The "AI-just-filed border pulse," badge pulses, drop-target scale, snackbar progress bar, and tab-underline slide all disable.

### I — Browser redirect support
**Chrome, Firefox, Edge only.** Brave and Arc removed. Both spec docs updated.

### J — Sandbox repointing
`backend/config.py` default and `.env.example` both updated to `c:\Dev\FilePlus\FilePlusTestSandbox` (the in-repo sandbox). `SAFETY_MODE` stays `true`. No content changes inside the sandbox.

### K — Folder navigation scope (read-only minimum)
A new `GET /fs/list?path=...` endpoint returns a directory listing distinct from `GET /files`. Browser screen uses it when navigating outside the indexed DB. Click folder navigates in; breadcrumb + back/forward/up wired through. **No** writes — no rename, move, delete, paste, drag-reparent, or scan-trigger from navigation. `path_guard` enforced on every call.

### L — Workflow lane (L2 → L1 hybrid)
**System rebuild first, then per-screen polish with live Impeccable preview.** See §5 and §6.

---

## 3. Documentation deliverables

| File | Action | Notes |
|---|---|---|
| `docs/UI-SPEC.md` | **Create** | New canonical source. Built from `design-brief.md` as the base, with all decisions §2 folded in. All `Cmd` references rewritten to `Ctrl`. Cross-references `docs/design-tokens.md`. Part B (the 16 Claude Code prompts) is deleted — superseded by §6 below. |
| `docs/finalization-spec.md` | **Archive** | Create `docs/archive/` if missing. Move file to `docs/archive/finalization-spec-v0.md`. Add header note: *"Superseded by docs/UI-SPEC.md on 2026-04-25. Kept for history."* |
| `PRODUCT.md` | **Patch** | Replace the "single accent color must be swappable" line with the A3 wording. Other sections unchanged. |
| `DESIGN.md` | **Patch** | Add `--accent-custom` CSS var to the design-tokens frontmatter and the colors section. |
| `docs/UI-REFINEMENT-REPORT.md` | **Append** | Add a "Resolutions (2026-04-25)" section. Each previously-open question (Q1–Q11 in that doc) gets a one-liner pointing to its decision letter in §2 here. |

The newly-created `docs/UI-SPEC.md` is what every Impeccable session in §6 audits against. Treat it as authoritative; if §6 turns up a need to change the spec, change `docs/UI-SPEC.md` and re-audit, do not let drift accumulate.

---

## 4. Pre-requisite implementation work

Three tasks must complete before Phase 2 (per-screen polish) can begin. They are sized small enough to run as one implementation sub-plan.

### 4.1 Sandbox repoint
Update `backend/config.py:13` default value:
```python
FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", r"c:\Dev\FilePlus\FilePlusTestSandbox"))
```
Update `.env.example` to mirror. Run existing tests to confirm `path_guard()` still passes.

### 4.2 `GET /fs/list` endpoint
- Path: `GET /fs/list?path=<absolute-windows-path>` (absolute paths only — `path_guard()` operates on resolved absolute paths and rejects anything outside the sandbox).
- Behavior: returns JSON `{path, entries: [{name, is_dir, size, modified, ext, is_hidden}]}` for the requested directory. Calls `path_guard()` first. Returns 404 if path doesn't exist or isn't a directory; returns 403 (`OutOfSandboxError`) if guard rejects.
- A second convenience endpoint `GET /fs/list/root` returns the sandbox root listing without requiring the client to know the absolute path. Useful for first-load and back-to-root navigation.
- Distinct from `GET /files`: `/files` queries the indexed DB; `/fs/list` does a live `os.scandir()`.
- Read-only — no POST/PUT/DELETE counterpart. Hidden files included with an `is_hidden` flag (UI decides whether to show based on the Settings toggle).

### 4.3 Browser screen wired to `/fs/list`
- On screen mount, fetch `/fs/list?path=<sandbox-root>` and render the two top-level entries (`C_Drive`, `D_Drive`).
- Click a folder → fetch `/fs/list?path=<that-folder>` → re-render. Update breadcrumb + address bar + tab title.
- Back/forward/up nav: maintain client-side history stack; up = parent path; back/forward walk the stack.
- Files render with their extension-mapped icon; folders render with the folder icon. No tag chips, no AI cues, no inspector data — those are wired later from the indexed DB.
- Empty folders show the empty-state pattern (per UI-SPEC §A.15).
- Sandbox-root shows just the two drive folders, no breadcrumb above them.

**Acceptance:** launching the app, clicking through `C_Drive → Program Files → 7-Zip` and back should work without errors, with breadcrumb and address bar updating correctly. No file operations work — clicking a file logs to console, no toast (file actions are intentionally untouched in this work).

---

## 5. Phase 1 — System pass

**One Impeccable session.** Scope: design-system layer only. No screen-specific work in this phase.

### 5.1 Tokens
Reset the design-tokens layer in `frontend/src/styles.css` (or extract to a new `frontend/src/design-tokens.css` if cleaner). Authoritative source: `docs/design-tokens.md` Sections 1–8.

- Light-mode overrides under `[data-theme="light"]`.
- Add `--accent-custom` var hook for A3. Cascade: `--accent: var(--accent-custom, #E8965E);`.
- Define every accent-derived var (`--accent-wash`, `--accent-edge`, `--accent-glow`, etc.) as `rgba()` using the `--accent` value, so changing `--accent-custom` propagates.

### 5.2 Typography
- Inter (400/500/600/700) + JetBrains Mono (400/500) loaded from local files or Google Fonts (per existing setup).
- All 9 type roles defined as utility classes (`t-display`, `t-headline`, `t-title`, `t-title-sm`, `t-body`, `t-label`, `t-caption`, `t-micro`, `t-data`) with sizes/weights/line-heights/letter-spacing per UI-SPEC §A.0 and `DESIGN.md` typography frontmatter.
- The Two-Font Rule audit: any element rendering data (paths, sizes, hashes, timestamps, counts, shortcuts) uses `t-data` (Mono); all other text uses Inter classes.

### 5.3 Atomic components
One CSS class per component, all visual states defined inline (default / hover / active / selected / disabled / error / focus where applicable):

- `fp-button` with modifiers: `--primary`, `--secondary`, `--ghost`, `--icon`, `--large`, `--small`, `--danger`
- `fp-chip` with modifiers: `--active`, `--good`, `--warn`, `--bad`
- `fp-input` (concave chrome, focus ring per spec)
- `fp-kbd-pill` (used in toolbar search hint, command palette footer, shortcuts pane)
- `fp-segmented` + `fp-segmented__option` (sliding active pill)
- `fp-toggle` (32×18 track, 14×14 thumb)
- `fp-slider` (4px inset-recess track, accent fill, 14×14 thumb with shadow-raised)
- `fp-radio`, `fp-checkbox`
- `fp-row` (file row — flat at rest, hover → bg-raised, selected → accent-wash + 2px accent left bar)
- `fp-sidebar__item` (28px tall, 6px radius, hover/active states, floating 2px amber pill on active)
- `fp-card` (8px radius, raised bg, border-subtle, highlight-top, shadow-card)
- `fp-popover` — base chrome class (8px radius, raised bg, border-subtle, highlight-top, shadow-popover). `fp-context-menu`, `fp-tooltip`, and `fp-dropdown` extend it with their type-specific spacing and item layouts.
- `fp-modal` (10px radius, shadow-modal, backdrop-blur — distinct chrome family from popover, not an extension)
- `fp-snackbar` (bottom-center, accent-edge, 5s progress bar)
- `fp-toast` (bottom-right, border variants by type)
- `fp-badge` (4px radius, accent or semantic wash)
- `fp-state-dot` (6px filled circle, semantic colors per UI-SPEC §A.9.2)
- `fp-breadcrumb-sep` (`·` middot, never `>` or `/`)
- `fp-tab-underline` (2px accent underline, slides between tabs at `dur-slide`)
- `fp-drag-handle` (4px wide hit area, accent on hover)
- `fp-marquee` (accent-wash-strong fill, 1px accent-edge border, 4px radius)

### 5.4 Acceptance gate (Phase 1)
- Section 41 audit (from `docs/design-tokens.md`) on the system layer. Every checklist item passes or has a documented exception (per existing convention in `docs/UI-REFINEMENT-REPORT.md`).
- Commits grouped by family: tokens → typography → 3 component-family commits.

---

## 6. Phase 2 — Per-screen polish

Sessions run in this order. **One screen per Impeccable session, not batched.** Each session: launch live preview server (port assigned at startup, written to `.impeccable-live.json`) → iterate live with the author watching browser updates → run Section 41 audit → author signs off → commit → push live preview to a "waiting" screen → screenshot final state for record.

| # | Screen / surface | UI-SPEC § |
|---|---|---|
| 1 | Global chrome (titlebar, tab bar, sidebar, toolbar, status bar) | A.1 |
| 2 | Home (Recent / Favorites / Shared) | A.2 |
| 3 | Browser (list, grid, inspector, tag chip stack) — consumes §4 work | A.3 |
| 4 | File Tree canvas (live + snapshot view + proposal-review modes) | A.4 |
| 5 | Scan (config + progress + results) | A.5–A.7 |
| 6 | Review Bin | A.8 |
| 7 | Everything Folder | A.9 |
| 8 | Settings (all 11 panes including Quick Slots subsection per D) | A.12 |
| 9 | Overlays (command palette, tag canvas, modals, snackbars/toasts) | A.11 |
| 10 | Context menus (5 variants) | A.10 |
| 11 | First-run setup (7 steps, separate window) | A.13 |
| 12 | Tray popout (separate window) | A.14 |
| 13 | Empty + error states pass across all screens | A.15–A.16 |
| 14 | Edge cases pass | A.17 |

---

## 7. Risk + sequencing notes

- **Chrome (#1) must precede every other screen.** The sidebar, toolbar, and status bar are reused everywhere; later screens cannot be polished against a moving chrome target.
- **Browser polish (#3) depends on §4 work.** If `/fs/list` is not ready, polish would happen against an empty state. Hard sequence: §3 → §4 → §5 → §6.1 → §6.3.
- **Settings polish (#8) should follow the Quick Slots system being captured in `docs/UI-SPEC.md`.** The new Settings → Account → Shortcuts → Quick Slots subsection has nowhere to land otherwise. Spec write happens in §3 (deliverables) before any Phase 2 work, so this resolves naturally.
- **AI delta cues (G decision)** require the canvas pass (#4) to drop the `sparkles` icon from the Proposal-review banner. Flag during the canvas session.
- **Custom hex accent (A decision)** affects every screen because every accent-using component must read `--accent` from CSS var (not hardcoded hex). Phase 1 handles this once in tokens; per-screen sessions inherit free.
- **`docs/UI-SPEC.md` is mutable.** If a screen session surfaces a real problem with the spec, edit the spec and re-audit, do not let implementation drift create a hidden divergence.

---

## 8. Out of scope (explicit non-goals)

- Real backend wiring beyond `/fs/list`. No real classifier, watcher, mover, snapshotter, or AI calls in this work.
- Real data in non-Browser screens. Review Bin, Scan, Everything Folder, Tag Canvas, Command Palette stay visually stubbed (they will display realistic dummy content authored in HTML, not live data).
- Functional logic for Command Palette search/chat (visual only).
- Settings persistence beyond what already lives in `localStorage` (theme, density, accent).
- Any user-data-touching action — rename, move, delete, paste, drag-reparent. All UI present and visible in the polished screens, all wired only to stub toasts / console logs.
- Section 41 audit is the only acceptance gate per pass. No automated visual regression tests are added.
- Backend test coverage beyond what already exists (18/18 passing).

---

## 9. Definition of done

The work described by this spec is done when:

1. `docs/UI-SPEC.md` exists, is internally consistent, contains every decision in §2, and has been read end-to-end by the author.
2. `docs/finalization-spec.md` is moved to `docs/archive/`.
3. `PRODUCT.md` and `DESIGN.md` patches are applied.
4. `backend/config.py` and `.env.example` point at the in-repo sandbox; existing tests pass.
5. `GET /fs/list` is implemented and returns correct results for the sandbox root and a few nested folders.
6. The Browser screen, when launched, navigates the sandbox via `/fs/list` end-to-end (root → drive → subfolder → up).
7. Phase 1 (system pass) is committed; Section 41 audit passes on the system layer.
8. All 14 Phase 2 sessions are committed; each commit's audit log is in `docs/UI-REFINEMENT-REPORT.md` (or its successor).
9. The author has manually walked every polished screen in a running Electron build and confirmed visual fidelity matches `docs/UI-SPEC.md`.

The implementation plan that follows from this spec will break each of the above into ordered, testable steps.
