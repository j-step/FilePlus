# FilePlus UI Re-Pass — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the documentation foundation and the navigation prerequisites that the per-screen Impeccable polish sessions depend on. Brings the spec to canonical form, repoints the app to the in-repo sandbox, and adds the read-only `/fs/list` endpoint + Browser-screen wiring needed for Phase 2 (system pass) and Phase 3 (per-screen polish) to start cleanly.

**Architecture:** Two-part plan. Part A produces a single canonical `docs/UI-SPEC.md`, archives the deprecated `finalization-spec.md`, and patches `PRODUCT.md`/`DESIGN.md`/`UI-REFINEMENT-REPORT.md` to match the decisions in `docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md`. Part B adds a `GET /fs/list` FastAPI endpoint, wires the Electron Browser screen to navigate via that endpoint, and repoints the sandbox to the in-repo `c:\Dev\FilePlus\FilePlusTestSandbox`. Part C is a handoff describing how to invoke the Impeccable system pass and the 14 per-screen polish sessions afterwards.

**Tech Stack:** Python 3.11+ / FastAPI / aiosqlite / pytest / Electron / vanilla HTML+JS+CSS / superpowers:impeccable for live UI iteration.

**Source spec:** [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](../specs/2026-04-25-fileplus-ui-re-pass-design.md)

---

## PART A — Documentation consolidation

### Task A1: Bootstrap UI-SPEC.md from design-brief.md

**Files:**
- Create: `docs/UI-SPEC.md`
- Read: `docs/design-brief.md`

The new canonical spec file starts as a copy of the existing design brief; subsequent tasks fold in every adjudicated decision.

- [ ] **Step 1: Copy `docs/design-brief.md` to `docs/UI-SPEC.md` byte-for-byte (no edits yet)**

```bash
cp docs/design-brief.md docs/UI-SPEC.md
```

- [ ] **Step 2: Replace the file's existing top-line title and intro paragraph**

Use `Edit` on `docs/UI-SPEC.md`. The exact `old_string` is the first ten lines copied from design-brief.md (the heading + the two intro paragraphs + the "Two halves" preamble + the blank line before `---`):

```
# FilePlus — Final UI Design Brief & Claude Code Implementation Plan

This document is the source of truth for the FilePlus v1 UI. It supersedes earlier specs.

This revision aligns all visual styling (colors, typography, shapes, motion, chrome) to the FilePlus Design Tokens v2 spec. Features, screens, and interactions are unchanged. Style references throughout have been updated to match the final design system.

Two halves:
- **Part A:** The complete UI design brief (every screen, every button, every panel)
- **Part B:** Claude Code prompt sequence to implement everything
```

The exact `new_string`:

```
# FilePlus — UI Specification (canonical)

**Status:** Canonical source of truth.
**Date last updated:** 2026-04-25.
**Supersedes:** `docs/design-brief.md` (kept in place; see history). `docs/finalization-spec.md` (archived to `docs/archive/finalization-spec-v0.md`).
**Decision register:** [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md) §2.
**Tokens:** [docs/design-tokens.md](design-tokens.md).

This document describes every screen, surface, overlay, and component in FilePlus v1. It is the only doc Impeccable sessions audit against.
```

- [ ] **Step 3: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): bootstrap canonical UI-SPEC.md from design-brief"
```

---

### Task A2: Rewrite `Cmd` → `Ctrl` throughout UI-SPEC.md

**Files:**
- Modify: `docs/UI-SPEC.md`

FilePlus is Windows-only. Every keyboard shortcut written as `Cmd` (or `⌘`) needs to become `Ctrl`.

- [ ] **Step 1: Find every Cmd reference**

Run: `grep -nE "Cmd|⌘" docs/UI-SPEC.md`
Expected: list of every line that mentions `Cmd` or the `⌘` glyph (search shortcuts, Settings shortcuts pane, command palette hints, etc.).

- [ ] **Step 2: Replace `Cmd` with `Ctrl` and `⌘` with `Ctrl`**

Use Edit with `replace_all: true` on `docs/UI-SPEC.md`:
- `Cmd` → `Ctrl`
- `⌘` → `Ctrl`

(The doc has no Mac-specific instructions that would break — every `Cmd` is a keyboard hint, all of which should now be `Ctrl`.)

- [ ] **Step 3: Verify no Cmd references remain**

Run: `grep -nE "Cmd|⌘" docs/UI-SPEC.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): convert all Cmd/⌘ shortcuts to Ctrl"
```

---

### Task A3: Apply decision A (accent: default amber + custom hex override)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.0)

§A.0 currently says "Single accent: amber `#E8965E`. No gradient. The same amber is used in light and dark mode for identity consistency." Update it to reflect the A3 decision: default amber, user-overridable.

- [ ] **Step 1: Find and replace the amber paragraph in §A.0**

In `docs/UI-SPEC.md`, find this exact block:

```
- Single accent: amber `#E8965E`. No gradient. The same amber is used in light and dark mode for identity consistency.
```

Replace with:

```
- Single accent: defaults to amber `#E8965E`. No gradient. The active accent value is read from a `--accent` CSS custom property; users may override it with a custom hex via Settings → Personalization (see §A.12.1). The same active accent value is used in both light and dark mode for identity consistency. Brand identity is the design language as a whole, not a single locked color.
```

- [ ] **Step 2: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.0 accent — default amber with custom hex override"
```

---

### Task A4: Apply decision A to Settings → Personalization (§A.12.1)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.12.1)

§A.12.1 currently lists "Accent palette: lavender / indigo / violet / sky / mix (segmented control)" — directly contradicts §A.0. Replace with the A3 design.

- [ ] **Step 1: Find and replace the accent palette line**

In `docs/UI-SPEC.md`, find this exact line in §A.12.1:

```
- Accent palette: lavender / indigo / violet / sky / mix (segmented control)
```

Replace with:

```
- Accent color: default amber + custom hex input. Row layout: a 24×24 swatch (current `--accent` value) + an Inter 500 hex input field (concave chrome, accepts `#RRGGBB` or `#RGB`) + a "Reset to default" ghost button. On valid hex input, `--accent-custom` is written to localStorage and applied immediately to `--accent`. Invalid input shows the inline error pattern (`fp-field-error`) below the field; the swatch does not update until the input is valid.
```

- [ ] **Step 2: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.12.1 accent — replace palette with hex override row"
```

---

### Task A5: Apply decision B (drop File Tree Comparison mode)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.4)

UI-SPEC currently describes three canvas modes: Live, Snapshot view, Proposal review. There's no Comparison mode in design-brief, but `finalization-spec.md` had one — make sure the UI-SPEC says explicitly that Comparison is not in v1, so future readers don't reintroduce it.

- [ ] **Step 1: Add a "v1 scope note" to §A.4 introduction**

Find the §A.4 heading line in `docs/UI-SPEC.md`:

```
## A.4 Screen 3 — File Tree (canvas)
```

Add this paragraph immediately after the heading (before the existing "Three modes with banners" line):

```
**Scope note (v1):** This screen has exactly three modes — Live, Snapshot view, Proposal review. Snapshot-to-snapshot side-by-side comparison ("Comparison mode") is explicitly out of scope for v1; it is approximated by switching between snapshots in the right rail.

```

- [ ] **Step 2: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.4 scope note — Comparison mode dropped from v1"
```

---

### Task A6: Apply decision C (Ctrl+T = New tab; Ctrl+Shift+F = File Tree)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.12.9)

Two `Ctrl+T` bindings exist in the Shortcuts pane. Resolve.

- [ ] **Step 1: Find the Shortcuts default bindings list in §A.12.9**

Locate this block in `docs/UI-SPEC.md`:

```
- Open File Tree: Ctrl+T
- Toggle inspector: Ctrl+I
```

(Note: After Task A2, all `Cmd` are now `Ctrl`. If grep shows the exact match above, proceed.)

- [ ] **Step 2: Replace the File Tree binding line**

Replace:

```
- Open File Tree: Ctrl+T
```

With:

```
- Open File Tree: Ctrl+Shift+F
```

- [ ] **Step 3: Verify the New Tab line still exists**

Run: `grep -n "New tab: Ctrl+T" docs/UI-SPEC.md`
Expected: one match (the line `- New tab: Ctrl+T` in the same Shortcuts list).

- [ ] **Step 4: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.12.9 — Ctrl+T = New tab; File Tree moves to Ctrl+Shift+F"
```

---

### Task A7: Apply decision D (Ctrl+Num Navigation modes + Quick Slots subsection)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.12.9)

The Shortcuts pane needs a new "Quick Slots" subsection and a mode setting. View-mode toggle moves off `Ctrl+1/2`.

- [ ] **Step 1: Find the line in §A.12.9 that lists view mode cycle**

Locate:

```
- View mode cycle: Ctrl+1/2
```

- [ ] **Step 2: Replace with the new view-mode bindings**

Replace:

```
- View mode cycle: Ctrl+1/2
```

With:

```
- View mode → List: Ctrl+Shift+L
- View mode → Grid: Ctrl+Shift+G
```

- [ ] **Step 3: Find the lines that bind Ctrl+1 = Home and Ctrl+2 = Browser**

Locate these two lines in §A.12.9:

```
- Switch to Home: Ctrl+1
- Switch to Browser: Ctrl+2
```

- [ ] **Step 4: Replace those two lines with a pointer to the new Quick Slots subsection**

Replace those two lines with:

```
- Ctrl+0 through Ctrl+9: governed by the **Quick Slots** subsection below (programmable when in Pages mode; fixed when in Default mode; tab-jump when in Tabs mode).
```

- [ ] **Step 5: Append the Quick Slots subsection at the end of §A.12.9**

After the keybinding list ends and before the `---` separator that begins §A.12.10, insert this subsection:

```markdown

#### Quick Slots — Ctrl+Num Navigation

The number-row keys (`Ctrl+0` through `Ctrl+9`) operate in one of three user-selectable modes. The mode is exposed as a segmented control at the top of the Quick Slots subsection in Settings → Account → Shortcuts.

- **Tabs.** `Ctrl+1`–`Ctrl+9` jumps to that tab position in the current explorer (Chrome behavior). `Ctrl+0` is unbound.
- **Pages** *(default mode)*. Programmable slots: 10 slots (`Ctrl+0` through `Ctrl+9`). Each slot can hold one target — a screen-id OR an absolute folder path. While focused on a screen or in a folder, pressing an *unbound* `Ctrl+N` binds that slot to "open here." Pressing a *bound* `Ctrl+N` jumps to the target. Slots are managed in this subsection.
- **Default.** Fixed screen mapping, non-programmable. `Ctrl+1` = Home, `Ctrl+2` = Browser, `Ctrl+3` = File Tree, `Ctrl+4` = Review Bin, `Ctrl+5` = Everything Folder. `Ctrl+6`–`Ctrl+9` and `Ctrl+0` are unassigned.

**Subsection layout (when mode = Pages):**
- Mode segmented control at top: Tabs | **Pages** | Default
- Helper line in `t-small` Inter 400 `text-tertiary`: "Press an unbound `Ctrl+N` while focused on any screen or folder to bind that slot to it."
- 10 slot rows, one per number key (0 through 9). Each row:
  - 28×28 kbd pill on the left showing `Ctrl+N` (per Settings shortcuts kbd pill spec)
  - Current binding display in the middle: either the screen name (in `t-body` Inter 500), the folder path (in `t-data` JetBrains Mono 400, ellipsized middle), or `[unbound]` in `t-body text-tertiary` italic
  - Right side: 24×24 ghost icon button for unbind (14×14 Lucide `x`) — disabled if slot is unbound
- After unbind, the slot row shows `[unbound] — press Ctrl+N anywhere to assign`.

**Subsection layout (when mode = Tabs or Default):** Mode segmented control at top + a single `t-body text-secondary` paragraph describing the binding behavior in that mode. No editable slot rows.

**Out-of-the-box defaults:** Mode = `Pages`. `Ctrl+1` pre-bound to Home, `Ctrl+2` pre-bound to Browser. All other slots unbound. The user may unbind the pre-bound slots; rebinding requires unbind first (so a key cannot be silently overwritten by being on a new screen).

```

- [ ] **Step 6: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.12.9 — Quick Slots / Ctrl+Num Navigation modes"
```

---

### Task A8: Apply decision F (Downloads Folder uses Browser screen, no bespoke screen)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.1.3)

The sidebar Quick Access section already lists Downloads. Make it explicit in the spec that clicking Downloads opens the Browser screen pointed at the Downloads path.

- [ ] **Step 1: Find the Quick Access section in §A.1.3**

Locate this block in `docs/UI-SPEC.md`:

```
- **Quick Access section:**
  - Home
  - Review Bin (count badge with `accent-wash` background and `accent-edge` border if non-zero)
  - User-pinned folders (drag to reorder)
```

- [ ] **Step 2: Insert a Downloads entry above the pinned folders line**

Replace the block above with:

```
- **Quick Access section:**
  - Home
  - Review Bin (count badge with `accent-wash` background and `accent-edge` border if non-zero)
  - Downloads (opens the Browser screen pointed at the configured Downloads Folder path; see §A.12.4. No bespoke "Downloads screen" exists.)
  - User-pinned folders (drag to reorder)
```

- [ ] **Step 3: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.1.3 — Downloads Quick Access entry uses Browser screen"
```

---

### Task A9: Apply decision G (drop sparkles icon from Proposal-review banner)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.4)

Per decision G, AI-personality iconography (sparkles) is removed; AI-delta cues (good-edge "new", bad-edge strikethrough, warn-edge moves) stay.

- [ ] **Step 1: Find the Proposal review banner description in §A.4**

Locate this exact line in `docs/UI-SPEC.md`:

```
- **Proposal review mode**: `accent-wash` background, `accent-edge` border-bottom, 14×14 Lucide `sparkles` icon in `accent`, `t-body` Inter 500 `accent` text: "Reviewing AI proposal · changes you make update it" with "Execute" primary button right-aligned
```

- [ ] **Step 2: Replace with the de-personalitied version**

Replace with:

```
- **Proposal review mode**: `accent-wash` background, `accent-edge` border-bottom, 14×14 Lucide `wand-2` icon in `accent`, `t-body` Inter 500 `accent` text: "Reviewing proposed changes · changes you make update the proposal" with "Execute" primary button right-aligned. (No sparkles iconography or AI-personality language anywhere on the banner.)
```

- [ ] **Step 3: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.4 — drop sparkles from Proposal review banner"
```

---

### Task A10: Apply decision H (strict prefers-reduced-motion)

**Files:**
- Modify: `docs/UI-SPEC.md` (Section 16 / motion principles, search for "reduced-motion" and "prefers-reduced-motion")

- [ ] **Step 1: Find the prefers-reduced-motion reference**

Run: `grep -nE "prefers-reduced-motion|reduced motion" docs/UI-SPEC.md`
Expected: find the line(s) describing the policy. Most likely in a motion section near the top of the spec or in §A.0.

- [ ] **Step 2: Replace whatever clause is there with the strict policy**

Find the existing clause (the design-brief originally said "prefers-reduced-motion: reduce collapses animations to 0.01ms except AI-filed border, badge pulse, live data") and replace with:

```
**Reduced motion (`prefers-reduced-motion: reduce`):** Strictly applied. All animation collapses to instant EXCEPT the live-data sparkline on the Scan Progress screen (sparkline = data, not decoration). Specifically disabled under reduced-motion: tab-underline slide, sidebar active-pill slide, snackbar progress bar, drop-target scale, AI-just-filed border pulse, badge pulses, segmented-control active-pill slide, modal/popover open transitions.
```

- [ ] **Step 3: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): strict prefers-reduced-motion policy"
```

---

### Task A11: Apply decision I (drop Brave + Arc from browser redirect support)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.12.3 and §A.13 step 4)

Memory says Chrome/Firefox/Edge only.

- [ ] **Step 1: Find browser redirect lines in §A.12.3**

Run: `grep -nE "Brave|Arc" docs/UI-SPEC.md`
Expected: at least two matches — one in §A.12.3 (Everything Folder browser redirect toggles) and one in §A.13 (first-run setup step 4).

- [ ] **Step 2: Update the §A.12.3 line**

Find the exact line:

```
- Browser download redirect: per-browser toggles (Chrome, Firefox, Edge, Brave, Arc) — each toggle row with 16×16 browser icon
```

Replace with:

```
- Browser download redirect: per-browser toggles (Chrome, Firefox, Edge — Brave and Arc deferred to a later version) — each toggle row with 16×16 browser icon
```

- [ ] **Step 3: Verify §A.13 doesn't enumerate Brave/Arc**

Run: `grep -nE "Brave|Arc" docs/UI-SPEC.md`
Expected: exactly one match — the new explanatory mention from Step 2 ("Brave and Arc deferred to a later version"). The §A.13 first-run setup section describes the per-browser toggle sublist generically without naming browsers, so no edit is needed there. If grep returns any other functional reference to Brave or Arc that implies they're supported, edit those lines to remove the names.

- [ ] **Step 4: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): drop Brave + Arc from v1 browser redirect support"
```

---

### Task A12: Apply decision E (Inspector default state language)

**Files:**
- Modify: `docs/UI-SPEC.md` (§A.3.2)

Make Inspector default-state language explicit and unambiguous.

- [ ] **Step 1: Find the Inspector behavior section in §A.3.2**

Locate this block:

```
Behavior:
- Opens on first file click (jump-cut, no slide animation)
- Stays open across selections until manually closed
- Push-style: file list shrinks to accommodate
```

- [ ] **Step 2: Replace with the explicit version**

Replace with:

```
Behavior:
- **Closed by default** when the Browser screen first mounts. The Inspector toggle button in the toolbar is in its default (off) state.
- **Opens on first file-click in the session** (jump-cut, no slide animation).
- Stays open across selections until manually closed via the toolbar toggle or the inspector header `x` button.
- Does **not** auto-reopen on app restart — the open/closed state is per-session, not persisted.
- Push-style: file list shrinks to accommodate.
```

- [ ] **Step 3: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): A.3.2 — Inspector default state language is explicit"
```

---

### Task A13: Delete Part B (the 16 Claude Code prompts) from UI-SPEC.md

**Files:**
- Modify: `docs/UI-SPEC.md` (Part B)

Per the design spec, Part B is superseded by the Phase 2/3 handoff in this plan. UI-SPEC.md is a pure design reference; it should not contain implementation prompts.

- [ ] **Step 1: Find the Part B start marker**

Run: `grep -n "PART B" docs/UI-SPEC.md`
Expected: one match (the `# PART B — Claude Code Implementation Prompt Sequence` line, originally at line 932 of design-brief.md).

- [ ] **Step 2: Delete from the `# PART B …` line through the end of the file, leaving the `## A.17` content intact**

Open `docs/UI-SPEC.md` in an editor. Find the `# PART B` heading (and any preceding `---` separator that introduces it). Delete everything from that separator/heading to the end of the file.

After deletion, the last line of the file should be the final paragraph of `## A.17 Edge cases that need decisions` (the line ending in "...with `accent` progress bar that fades after completion.").

- [ ] **Step 3: Verify Part A content is intact**

Run: `grep -nE "^## A\." docs/UI-SPEC.md | wc -l`
Expected: `17` (one match per A.0–A.17 section heading).

Run: `grep -n "PART B" docs/UI-SPEC.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/UI-SPEC.md
git commit -m "docs(ui-spec): drop Part B prompt sequence; UI-SPEC is design reference only"
```

---

### Task A14: Patch PRODUCT.md accent paragraph

**Files:**
- Modify: `PRODUCT.md` (Accessibility & Inclusion section)

PRODUCT.md currently says "the single accent color must be swappable at runtime so the user can pick any hue against the deep purple base" — this directly contradicts the brand language elsewhere. Update to the A3 wording.

- [ ] **Step 1: Find the accent line in PRODUCT.md**

Run: `grep -n "swappable" PRODUCT.md`
Expected: one match in the "Accessibility & Inclusion" section.

- [ ] **Step 2: Replace the line**

Find this exact line in `PRODUCT.md`:

```
- Accent color customization: the single accent color must be swappable at runtime so the user can pick any hue against the deep purple base
```

Replace with:

```
- Accent color customization: the active accent value is read from a CSS custom property and ships as the brand amber by default. Power users may override it with a custom hex via Settings → Personalization. Brand identity is the design language as a whole — chrome treatment, type system, motion vocabulary, and sparing accent use — not a single locked color.
```

- [ ] **Step 3: Commit**

```bash
git add PRODUCT.md
git commit -m "docs(product): accent customization wording matches UI-SPEC §A.0/§A.12.1"
```

---

### Task A15: Patch DESIGN.md to add `--accent-custom` token

**Files:**
- Modify: `DESIGN.md` (frontmatter `colors:` block + body §2)

The new `--accent-custom` CSS var hook needs to be reflected in the design system source-of-truth.

- [ ] **Step 1: Add the `accent-custom` line to the frontmatter colors block**

Find this exact line in `DESIGN.md` (in the YAML frontmatter):

```
  accent: "#E8965E"
```

Replace with:

```
  accent: "#E8965E"
  accent-custom: ""  # User override via Settings → Personalization. Empty string means "use default amber."
```

- [ ] **Step 2: Add an explanatory paragraph in §2 (Colors)**

Find the §2 "### Primary" heading. Immediately after the `**Burnt Amber** (`#E8965E`)...` bullet, add a new bullet:

```
- **Custom accent override** (`--accent-custom`): user-set CSS custom property exposed in Settings → Personalization. When set to a valid hex, the entire accent ramp (`--accent`, `--accent-wash`, `--accent-edge`, `--accent-glow`, etc.) re-resolves to use the custom value. When empty, all accent vars default to the brand amber. Implementation: every accent-derived var defines its base color via `var(--accent-custom, #E8965E)`.
```

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "docs(design): add --accent-custom user-override token"
```

---

### Task A16: Append "Resolutions (2026-04-25)" section to UI-REFINEMENT-REPORT.md

**Files:**
- Modify: `docs/UI-REFINEMENT-REPORT.md`

Each previously-open question in that doc gets a one-liner pointing to its resolution.

- [ ] **Step 1: Append the Resolutions section to the end of the file**

Open `docs/UI-REFINEMENT-REPORT.md`. Append at the very bottom (after the existing "*End of testing checklist...*" line):

```markdown

---

## Resolutions (2026-04-25)

The open questions Q1–Q11 in this document were adjudicated during the brainstorming session that produced [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md). Each is resolved as follows:

| # | Resolution | Source |
|---|---|---|
| Q1 | Tabs for non-folder screens (Home, Review Bin, etc.) show the screen name. Confirmed implementation behavior. | Spec §2 (auto-resolved by Q1=A canonical pick) |
| Q2 | Pinned folder overflow not addressed in v1; max 5 visible, no "show more" link. Defer to v1.1. | Out of scope for this work |
| Q3 | Top tags shown: 5–8. Confirmed implementation behavior. | Spec §2 (auto-resolved) |
| Q4 | Inspector starts closed; first file-click in session opens it; persists across selections; does not auto-reopen on app restart. | Spec §2, decision E |
| Q5 | Default canvas expansion: 3 levels per drive branch. Confirmed implementation behavior. | Spec §2 (auto-resolved) |
| Q6 | Conversational scan-config opening prompt is hardcoded as specified. Confirmed implementation behavior. | Spec §2 (auto-resolved) |
| Q7 | Reorganization tab CTA navigates to File Tree canvas + enters proposal-review mode simultaneously. Confirmed. | Spec §2 (auto-resolved) |
| Q8 | Review Bin is a logically distinct screen with its own layout, backed by Everything Folder data via filter. Confirmed. | Spec §2 (auto-resolved) |
| Q9 | "Currently moving" card defaults to expanded with stub "Moving 2 of 2 files." Confirmed. | Spec §2 (auto-resolved) |
| Q10 | Accent customization: default amber + custom hex override (not a fixed palette). Personalization pane shows hex input + swatch + reset. | Spec §2, decision A (option A3) |
| Q11 | Tray auto-dismiss via Electron window blur event. Confirmed implementation behavior. | Spec §2 (auto-resolved) |

All v1 contradictions captured in this report are now closed. Future contradiction reports go in a fresh report doc.
```

- [ ] **Step 2: Commit**

```bash
git add docs/UI-REFINEMENT-REPORT.md
git commit -m "docs(ui-refinement): append Resolutions section closing Q1–Q11"
```

---

### Task A17: Archive `finalization-spec.md`

**Files:**
- Create: `docs/archive/`
- Move: `docs/finalization-spec.md` → `docs/archive/finalization-spec-v0.md`
- Modify: archived file (header note)

- [ ] **Step 1: Create the archive directory and move the file**

```bash
mkdir -p docs/archive
git mv docs/finalization-spec.md docs/archive/finalization-spec-v0.md
```

- [ ] **Step 2: Add a "Superseded" header note to the moved file**

Open `docs/archive/finalization-spec-v0.md`. The current first line is:

```
# FilePlus — Screen-by-Screen Finalization Spec
```

Replace lines 1–3 (the H1 + the description line + the blank line) with:

```
# FilePlus — Screen-by-Screen Finalization Spec (ARCHIVED)

> **Superseded by `docs/UI-SPEC.md` on 2026-04-25.** Kept for history. Do not consult for design decisions; consult `docs/UI-SPEC.md`. The aesthetic described below (violet/lavender/blue liquid-glass, Geist fonts) was abandoned in favor of the Burnt Amber Workshop direction documented in DESIGN.md and UI-SPEC.md.

```

- [ ] **Step 3: Verify finalization-spec.md is no longer in docs/**

Run: `ls docs/finalization-spec.md`
Expected: error "No such file or directory" (or equivalent on the platform).

Run: `ls docs/archive/`
Expected: `finalization-spec-v0.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/archive/finalization-spec-v0.md
git commit -m "docs(archive): move finalization-spec.md to docs/archive/ as v0"
```

---

## PART B — Pre-requisite implementation

### Task B1: Repoint sandbox to in-repo `FilePlusTestSandbox`

**Files:**
- Modify: `backend/config.py:13`
- Modify: `.env.example:6`

- [ ] **Step 1: Edit the default in `backend/config.py`**

Find this exact line in `backend/config.py`:

```python
FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", r"C:\FilePlusTestSandbox"))
```

Replace with:

```python
FILEPLUS_SANDBOX_PATH = Path(os.getenv("FILEPLUS_SANDBOX_PATH", r"c:\Dev\FilePlus\FilePlusTestSandbox"))
```

- [ ] **Step 2: Edit `.env.example` to mirror**

Find this exact line in `.env.example`:

```
FILEPLUS_SANDBOX_PATH=C:\FilePlusTestSandbox
```

Replace with:

```
FILEPLUS_SANDBOX_PATH=c:\Dev\FilePlus\FilePlusTestSandbox
```

- [ ] **Step 3: Run the existing test suite to verify nothing broke**

Run: `pytest tests/ -v`
Expected: all 18 previously-passing tests still pass. (Tests use `monkeypatch` on `FILEPLUS_SANDBOX_PATH` per `conftest.py`, so the default change should be invisible to them — but run anyway to confirm.)

- [ ] **Step 4: Commit**

```bash
git add backend/config.py .env.example
git commit -m "feat(config): repoint sandbox default to in-repo FilePlusTestSandbox"
```

---

### Task B2: Failing test for `GET /fs/list` endpoint

**Files:**
- Create: `tests/test_api_fs.py`

Use TDD — write the failing test before the endpoint exists.

- [ ] **Step 1: Create the test file**

```python
# tests/test_api_fs.py
"""Tests for the read-only /fs/list directory listing endpoint."""
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

import backend.config as _config


@pytest.fixture
def client(sandbox):
    """FastAPI TestClient with sandbox fixture applied so path_guard works."""
    from backend.api import app
    return TestClient(app)


def test_fs_list_returns_directory_entries(client, sandbox):
    """GET /fs/list?path=<sandbox> returns the entries inside it."""
    (sandbox / "alpha.txt").write_text("a")
    (sandbox / "beta.md").write_text("b")
    sub = sandbox / "subdir"
    sub.mkdir()
    (sub / "inner.txt").write_text("c")

    r = client.get(f"/fs/list?path={sandbox}")
    assert r.status_code == 200
    data = r.json()

    assert data["path"] == str(sandbox.resolve())
    names = {e["name"] for e in data["entries"]}
    assert names == {"alpha.txt", "beta.md", "subdir"}
    types = {e["name"]: e["is_dir"] for e in data["entries"]}
    assert types == {"alpha.txt": False, "beta.md": False, "subdir": True}


def test_fs_list_includes_size_modified_ext(client, sandbox):
    """Entries include size, modified (epoch float), and ext (lowercase, with leading dot)."""
    f = sandbox / "doc.PDF"
    f.write_text("hello")

    r = client.get(f"/fs/list?path={sandbox}")
    entry = next(e for e in r.json()["entries"] if e["name"] == "doc.PDF")
    assert entry["size"] == 5
    assert isinstance(entry["modified"], float)
    assert entry["ext"] == ".pdf"
    assert entry["is_dir"] is False
    assert entry["is_hidden"] is False


def test_fs_list_directory_entry_has_no_ext(client, sandbox):
    """Directory entries have ext == '' (empty string)."""
    (sandbox / "myfolder").mkdir()
    r = client.get(f"/fs/list?path={sandbox}")
    folder = next(e for e in r.json()["entries"] if e["name"] == "myfolder")
    assert folder["ext"] == ""
    assert folder["is_dir"] is True


def test_fs_list_404_when_path_does_not_exist(client, sandbox):
    bogus = sandbox / "does-not-exist"
    r = client.get(f"/fs/list?path={bogus}")
    assert r.status_code == 404


def test_fs_list_404_when_path_is_file_not_dir(client, sandbox):
    f = sandbox / "file.txt"
    f.write_text("x")
    r = client.get(f"/fs/list?path={f}")
    assert r.status_code == 404


def test_fs_list_403_when_path_outside_sandbox(client, sandbox, tmp_path):
    """Path outside the sandbox is rejected by path_guard."""
    outside = tmp_path / "outside"
    outside.mkdir()
    r = client.get(f"/fs/list?path={outside}")
    assert r.status_code == 403


def test_fs_list_root_returns_sandbox_root(client, sandbox):
    """GET /fs/list/root returns the sandbox root listing without a path arg."""
    (sandbox / "x.txt").write_text("x")
    r = client.get("/fs/list/root")
    assert r.status_code == 200
    data = r.json()
    assert data["path"] == str(sandbox.resolve())
    assert any(e["name"] == "x.txt" for e in data["entries"])
```

Write this content to `tests/test_api_fs.py`.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pytest tests/test_api_fs.py -v`
Expected: all 7 tests FAIL with 404s or attribute errors (the endpoint does not exist yet — FastAPI will return 404 for the unknown route).

- [ ] **Step 3: Commit (red)**

```bash
git add tests/test_api_fs.py
git commit -m "test(api): failing tests for /fs/list and /fs/list/root"
```

---

### Task B3: Implement `GET /fs/list` and `GET /fs/list/root`

**Files:**
- Modify: `backend/api.py` (insert new endpoint block after the existing `/files/{file_id}` route)

- [ ] **Step 1: Add necessary imports near the top of `backend/api.py`**

Find this exact line near the top of `backend/api.py`:

```python
from fastapi import FastAPI, Query
```

Replace with:

```python
from fastapi import FastAPI, HTTPException, Query
```

(adds `HTTPException`).

Find:

```python
import backend.config as _config
from backend.database import init_db
from backend.indexer import scan_directory, remove_stale_entries
```

Replace with:

```python
import os
import backend.config as _config
from backend.config import OutOfSandboxError, path_guard
from backend.database import init_db
from backend.indexer import scan_directory, remove_stale_entries
```

(adds `os` and pulls in `OutOfSandboxError` + `path_guard`).

- [ ] **Step 2: Insert the `/fs/list` endpoint block**

Find this exact comment header in `backend/api.py`:

```python
# ---------------------------------------------------------------------------
# Scan endpoint
# ---------------------------------------------------------------------------
```

Insert this block immediately ABOVE that comment header:

```python
# ---------------------------------------------------------------------------
# Filesystem listing (read-only) — /fs/list
# ---------------------------------------------------------------------------

def _scandir_entries(directory: Path) -> list[dict]:
    """Return a list of entry dicts for the given directory.

    Each entry includes name, is_dir, size, modified (epoch float),
    ext (lowercased, with leading dot, empty for directories),
    and is_hidden (Windows hidden attribute or leading dot).
    """
    entries: list[dict] = []
    for de in os.scandir(directory):
        try:
            stat = de.stat(follow_symlinks=False)
        except (PermissionError, FileNotFoundError):
            continue
        is_dir = de.is_dir(follow_symlinks=False)
        ext = "" if is_dir else os.path.splitext(de.name)[1].lower()
        is_hidden = de.name.startswith(".")
        if os.name == "nt":
            try:
                attrs = stat.st_file_attributes  # type: ignore[attr-defined]
                is_hidden = is_hidden or bool(attrs & 0x2)  # FILE_ATTRIBUTE_HIDDEN
            except (AttributeError, OSError):
                pass
        entries.append({
            "name": de.name,
            "is_dir": is_dir,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "ext": ext,
            "is_hidden": is_hidden,
        })
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return entries


@app.get("/fs/list")
async def fs_list(path: str = Query(..., description="Absolute path of directory to list")):
    """Return a directory listing for the given absolute path.

    Returns 404 if the path doesn't exist or isn't a directory.
    Returns 403 if path_guard rejects the path (outside sandbox).
    """
    try:
        resolved = path_guard(Path(path))
    except OutOfSandboxError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=404, detail=f"Not a directory: {path}")
    return {"path": str(resolved), "entries": _scandir_entries(resolved)}


@app.get("/fs/list/root")
async def fs_list_root():
    """Return the sandbox root listing without requiring a path argument."""
    root = _config.FILEPLUS_SANDBOX_PATH.resolve()
    if not root.exists() or not root.is_dir():
        raise HTTPException(status_code=404, detail=f"Sandbox root missing: {root}")
    return {"path": str(root), "entries": _scandir_entries(root)}


```

- [ ] **Step 3: Run the new tests to verify they pass**

Run: `pytest tests/test_api_fs.py -v`
Expected: all 7 tests PASS.

- [ ] **Step 4: Run the full test suite to verify nothing else broke**

Run: `pytest tests/ -v`
Expected: all original 18 tests + 7 new tests = 25 PASS.

- [ ] **Step 5: Commit (green)**

```bash
git add backend/api.py
git commit -m "feat(api): GET /fs/list and /fs/list/root for read-only directory navigation"
```

---

### Task B4: Frontend — `loadDirectory()` uses `/fs/list`

**Files:**
- Modify: `frontend/src/app.js`

The Browser screen has a `loadDirectory(path)` function and a `navigate-path` action wiring. Currently `loadDirectory` queries `/files` (the indexed DB) — change it to use `/fs/list`, falling back gracefully when the endpoint returns 404 or 403.

- [ ] **Step 1: Find the existing `loadDirectory` function**

Run: `grep -n "function loadDirectory\|async function loadDirectory" frontend/src/app.js`
Expected: one match.

Read the surrounding 30-50 lines to understand current behavior.

- [ ] **Step 2: Replace `loadDirectory` with the `/fs/list`-backed version**

Find the existing `loadDirectory` function (whatever its current body) and replace it with:

```javascript
// ── Folder navigation via /fs/list (read-only) ────────────────────────────────
// Maintains a client-side history stack for back/forward.
const navHistory = { stack: [], idx: -1 };

async function loadDirectory(absPath) {
  const url = absPath
    ? `${API_BASE}/fs/list?path=${encodeURIComponent(absPath)}`
    : `${API_BASE}/fs/list/root`;

  let data;
  try {
    const r = await fetch(url);
    if (r.status === 403) {
      showErrorBanner(`Path is outside the sandbox: ${absPath}`);
      return;
    }
    if (r.status === 404) {
      showErrorBanner(`Folder not found: ${absPath}`);
      return;
    }
    if (!r.ok) {
      showErrorBanner(`Failed to load folder (HTTP ${r.status}).`);
      return;
    }
    data = await r.json();
  } catch (err) {
    showErrorBanner(`Couldn't reach backend: ${err.message}`);
    return;
  }

  renderDirectory(data);
  pushHistory(data.path);
  updateBreadcrumb(data.path);
  updateAddressBar(data.path);
}

function pushHistory(path) {
  // If we navigated forward from a non-tail position, drop the forward stack.
  if (navHistory.idx < navHistory.stack.length - 1) {
    navHistory.stack = navHistory.stack.slice(0, navHistory.idx + 1);
  }
  if (navHistory.stack[navHistory.idx] !== path) {
    navHistory.stack.push(path);
    navHistory.idx = navHistory.stack.length - 1;
  }
  refreshNavButtons();
}

function navBack() {
  if (navHistory.idx <= 0) return;
  navHistory.idx -= 1;
  const path = navHistory.stack[navHistory.idx];
  fetchAndRender(path);
}

function navForward() {
  if (navHistory.idx >= navHistory.stack.length - 1) return;
  navHistory.idx += 1;
  const path = navHistory.stack[navHistory.idx];
  fetchAndRender(path);
}

function navUp() {
  const cur = navHistory.stack[navHistory.idx];
  if (!cur) return;
  // Compute parent: strip last path segment. Keep the drive-letter root intact.
  const parent = cur.replace(/[\\\/]+[^\\\/]+[\\\/]?$/, '') || cur;
  if (parent === cur) return; // Already at root.
  loadDirectory(parent);
}

async function fetchAndRender(path) {
  const r = await fetch(`${API_BASE}/fs/list?path=${encodeURIComponent(path)}`);
  if (!r.ok) { refreshNavButtons(); return; }
  const data = await r.json();
  renderDirectory(data);
  updateBreadcrumb(data.path);
  updateAddressBar(data.path);
  refreshNavButtons();
}

function refreshNavButtons() {
  const back = document.querySelector('[data-action="nav-back"]');
  const fwd  = document.querySelector('[data-action="nav-forward"]');
  if (back) back.disabled = navHistory.idx <= 0;
  if (fwd)  fwd.disabled  = navHistory.idx >= navHistory.stack.length - 1;
}

function renderDirectory(data) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  if (!data.entries || data.entries.length === 0) {
    listScroll.innerHTML = renderEmptyFolder();
    return;
  }

  listScroll.innerHTML = data.entries.map(entry => renderFsRow(entry, data.path)).join('');
}

function renderFsRow(entry, parentPath) {
  const childPath = parentPath.replace(/[\\\/]+$/, '') + '\\' + entry.name;
  const icon = entry.is_dir ? ICON_FOLDER : iconForExt(entry.ext);
  const sizeText = entry.is_dir ? '—' : formatSize(entry.size);
  const modifiedText = formatModified(entry.modified);
  return `<div class="fp-row${entry.is_dir ? ' fp-row--folder' : ''}" role="option"
            data-path="${escapeHtml(childPath)}"
            data-type="${entry.is_dir ? 'folder' : 'file'}">
    ${icon}
    <span class="fp-row__name">${escapeHtml(entry.name)}</span>
    <span class="fp-row__size mono">${sizeText}</span>
    <span class="fp-row__modified mono">${modifiedText}</span>
    <div class="fp-row__tags"></div>
  </div>`;
}

function renderEmptyFolder() {
  return `<div class="fp-empty-state" role="status" aria-live="polite">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
    </svg>
    <h3 class="t-title-sm">This folder is empty</h3>
    <p class="t-body" style="color: var(--text-secondary)">Drop files here or right-click to create new ones.</p>
  </div>`;
}

function iconForExt(ext) {
  const e = (ext || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'].includes(e)) return ICON_IMG;
  if (['.txt', '.md', '.json', '.yml', '.yaml', '.xml', '.html', '.css', '.js', '.ts', '.py'].includes(e)) return ICON_TXT;
  return ICON_FILE;
}

function updateAddressBar(path) {
  const addressEl = document.getElementById('address-bar-text') || document.querySelector('.fp-address-bar__text');
  if (addressEl) addressEl.textContent = path;
}

function updateBreadcrumb(path) {
  const crumb = document.getElementById('breadcrumb');
  if (!crumb) return;
  // Split on \ or /, drop empties. First part is drive letter (e.g. "C:") — keep with backslash for nav.
  const parts = path.split(/[\\\/]+/).filter(Boolean);
  let cumulative = '';
  const html = parts.map((part, i) => {
    cumulative = i === 0 ? part + '\\' : cumulative + part + '\\';
    const isLast = i === parts.length - 1;
    const cls = isLast ? 'fp-breadcrumb__crumb fp-breadcrumb__crumb--current' : 'fp-breadcrumb__crumb';
    return `<button class="${cls}" data-action="navigate-crumb" data-path="${escapeHtml(cumulative)}">${escapeHtml(part)}</button>`;
  }).join('<span class="fp-breadcrumb__sep">·</span>');
  crumb.innerHTML = html;
}

function showErrorBanner(message) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  listScroll.innerHTML = `<div class="fp-error-banner" role="alert">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span class="fp-body" style="color: var(--text-primary)">${escapeHtml(message)}</span>
  </div>`;
}

const ICON_FOLDER = `<svg class="fp-row__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1 4a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" fill="var(--accent)" opacity=".75" stroke="var(--accent-edge)" stroke-width="0.8"/></svg>`;
```

(If a `loadDirectory` function already exists, replace its body with the new version above. The supporting functions `pushHistory`, `navBack`, `navForward`, `navUp`, etc. are new; insert them in the same block.)

- [ ] **Step 3: Wire `nav-back`, `nav-forward`, `nav-up` action handlers**

Find the data-action `switch` block in app.js (around line 757). Add three cases:

Find:

```javascript
    case 'navigate-crumb':
```

(or the `case 'navigate-path':` block).

Insert these three cases immediately before the `case 'navigate-crumb':` line (or wherever closest in the switch):

```javascript
    case 'nav-back':
      navBack();
      break;
    case 'nav-forward':
      navForward();
      break;
    case 'nav-up':
      navUp();
      break;
```

- [ ] **Step 4: Update IN_SCOPE_ACTIONS to include nav verbs (already there, double-check)**

Run: `grep -n "'nav-back', 'nav-forward', 'nav-up'" frontend/src/app.js`
Expected: one match in the IN_SCOPE_ACTIONS Set. (No edit needed if present.)

- [ ] **Step 5: Wire folder-row click in Browser screen to navigate in**

Find the click handler that handles file row clicks. Locate it with:

```bash
grep -nE "e\.target\.closest\('\.fp-row'\)" frontend/src/app.js
```

Expected: one or more matches — pick the one inside a click event listener (most likely around line 1145 per prior exploration). Read 10 lines around the match to confirm it's the file-row click handler.

Then modify it so clicking a row with `data-type="folder"` calls `loadDirectory(row.dataset.path)`. Find this exact block:

```javascript
    const row = e.target.closest('.fp-row');
    if (!row) return;
    listScroll?.querySelectorAll('.fp-row').forEach(r => {
      r.classList.remove('fp-row--selected');
    });
    row.classList.add('fp-row--selected');
```

Replace with:

```javascript
    const row = e.target.closest('.fp-row');
    if (!row) return;
    // Folder click → navigate into it (read-only).
    if (row.dataset.type === 'folder' && row.dataset.path) {
      loadDirectory(row.dataset.path);
      return;
    }
    listScroll?.querySelectorAll('.fp-row').forEach(r => {
      r.classList.remove('fp-row--selected');
    });
    row.classList.add('fp-row--selected');
```

- [ ] **Step 6: Wire Browser screen mount to load sandbox root**

Find the function that switches to the Browser screen (likely `switchScreen` or a screen-init helper). At the END of `switchScreen`, append:

```javascript
  // When entering the Browser screen, load the sandbox root if we haven't already.
  if (id === 'browser' && navHistory.stack.length === 0) {
    loadDirectory(null); // null → calls /fs/list/root
  }
```

Place it just before the `sessionStorage.setItem(...)` line at the end of `switchScreen`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app.js
git commit -m "feat(browser): folder navigation via /fs/list with back/forward/up"
```

---

### Task B5: Manual smoke test — folder navigation works

**Files:** none (manual test)

- [ ] **Step 1: Start the backend**

Run in one terminal: `python -m backend.api`
Expected: uvicorn logs `Application startup complete.` and listens on `127.0.0.1:9876`.

- [ ] **Step 2: Verify the new endpoints respond**

Run in another terminal:
```bash
curl http://127.0.0.1:9876/fs/list/root
```
Expected: JSON with `path` ending in `FilePlusTestSandbox` and `entries` containing `C_Drive` and `D_Drive`.

```bash
curl "http://127.0.0.1:9876/fs/list?path=c:\\Dev\\FilePlus\\FilePlusTestSandbox\\C_Drive\\Program%20Files"
```
Expected: JSON listing of the Program Files folder (Discord, Git, Google, etc.).

- [ ] **Step 3: Launch Electron and walk the sandbox**

Run: `cd frontend && npm start`
Expected: Electron window opens. Click the Browser screen in the sidebar.

In the Browser screen, verify:
1. The list shows two folders: `C_Drive` and `D_Drive`.
2. Click `C_Drive` — the list updates to show its contents (Program Files, ProgramData, Users, Windows, etc.).
3. Click `Program Files` — the list updates to show subfolders.
4. Click `7-Zip` — list updates (probably empty or with one placeholder file).
5. The breadcrumb above the list shows `C_Drive · Program Files · 7-Zip` and each segment is clickable.
6. Click the breadcrumb `Program Files` segment — list jumps back to that level.
7. Click the toolbar back arrow — list returns to the previous folder. Forward arrow re-advances.
8. Click the up arrow — list goes one level up (to the parent).
9. Open DevTools (F12) — Console shows no JS errors during any of the above steps.

- [ ] **Step 4: Document the smoke-test result**

If everything works, this task is complete; no commit (it's a manual test). If anything fails, fix the underlying issue in B1–B4 (re-running the failing step) before proceeding.

---

## PART C — Handoff to Impeccable phases

Phases 2 and 3 of the design spec are interactive Impeccable sessions, not test-driven code. They are deliberately scoped OUTSIDE this plan. Each is invoked when ready.

### Phase 2 — System pass (one Impeccable session)

When this plan's Parts A and B are merged:

1. Verify the live preview infrastructure is alive: check `c:\Dev\FilePlus\.impeccable-live.json` exists with a valid `pid` and `port`. If the server is down, restart it with the impeccable skill's live-server start command.
2. Invoke the `impeccable` skill against the design system layer with this scope: "Reset frontend/src/styles.css design-tokens layer to authoritatively match docs/design-tokens.md Sections 1-8 and DESIGN.md frontmatter. Add the --accent-custom var hook. Define every accent-derived var as rgba() referencing --accent. Build the typography scale (9 type roles per UI-SPEC §A.0). Build atomic component classes per design spec §5.3. Acceptance gate: Section 41 audit passes on the system layer. Commit grouped by family: tokens → typography → component-family-1 → component-family-2 → component-family-3."
3. The Impeccable session interacts with the user live; the user signs off when the system layer matches.

### Phase 3 — Per-screen polish (14 Impeccable sessions)

Sessions in this order, ONE screen per session, never batched:

| # | Screen | UI-SPEC § | Notes |
|---|---|---|---|
| 1 | Global chrome (titlebar, tab bar, sidebar, toolbar, status bar) | A.1 | Must precede everything else (chrome is reused everywhere). |
| 2 | Home (Recent / Favorites / Shared) | A.2 | |
| 3 | Browser (list, grid, inspector, tag chip stack) | A.3 | Consumes Part B work — verify smoke test still passes before starting. |
| 4 | File Tree canvas (live + snapshot view + proposal-review modes) | A.4 | Drop sparkles icon per decision G; comparison mode dropped per decision B. |
| 5 | Scan (config + progress + results) | A.5–A.7 | |
| 6 | Review Bin | A.8 | |
| 7 | Everything Folder | A.9 | |
| 8 | Settings (all 11 panes including new Quick Slots subsection) | A.12 | Quick Slots subsection lives in Account → Shortcuts. |
| 9 | Overlays (command palette, tag canvas, modals, snackbars/toasts) | A.11 | |
| 10 | Context menus (5 variants) | A.10 | |
| 11 | First-run setup (separate window) | A.13 | |
| 12 | Tray popout (separate window) | A.14 | |
| 13 | Empty + error states pass across all screens | A.15–A.16 | |
| 14 | Edge cases pass | A.17 | |

**Per-session protocol:**

1. Verify the impeccable live-preview server is running.
2. Invoke the `impeccable` skill scoped to ONE screen with: "Polish [screen name] in frontend/index.html (and related JS/CSS) to match UI-SPEC §[section]. Use the live preview for iteration. Audit Section 41 of design-tokens.md before declaring done. Append session results to docs/UI-REFINEMENT-REPORT.md or its successor."
3. Author watches live preview, calls out issues, signs off.
4. Commit with message: `ui(refine): [screen] match UI-SPEC §[section]`.
5. Push live preview to a "waiting" screen between sessions.
6. Capture a screenshot of the final state for record.

After all 14 sessions land, run a final integration audit:
- Verify every screen has been touched and committed.
- Run the Section 41 audit one more time across the whole app.
- Verify `data-action` coverage in `docs/UI-REFINEMENT-REPORT.md` is complete.
- Manually walk every screen in a running Electron build and confirm visual fidelity matches `docs/UI-SPEC.md`.

The work described by `docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md` §9 is then complete.
