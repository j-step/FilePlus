# FilePlus UI Re-Pass — Phase 2 (System Pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the design-system layer in `frontend/src/styles.css` to authoritatively match `docs/UI-SPEC.md` §A.0, `docs/design-tokens.md` §§1–8, and `DESIGN.md`. Provides the consistent foundation that Phase 3 per-screen polish builds on.

**Architecture:** One CSS file (`frontend/src/styles.css`) — single source of truth for all visual styles. Tokens block at top (CSS custom properties with `--accent-custom` user-override hook). Then typography utility classes. Then atomic component classes (`fp-*`), one family per task. Each component class defines all required visual states inline (default / hover / active / selected / disabled / error / focus where applicable). No hardcoded hex outside the tokens block.

**Tech Stack:** Vanilla CSS (no preprocessor), CSS custom properties, Inter + JetBrains Mono webfonts, Lucide SVG icons (used by HTML, not CSS).

**Source spec:** [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](../specs/2026-04-25-fileplus-ui-re-pass-design.md) §5

**Base SHA:** `aabcc2c` (sidebar fix is the most recent commit before Phase 2 starts)

---

## Critical conventions

These apply to every task. Do not re-state in each task.

- **One file changed per commit:** `frontend/src/styles.css`. Other files (HTML, JS) are out of scope for Phase 2.
- **No hardcoded color hex values outside the `:root` tokens block.** Every component must read `var(--token-name)`. Allowed exceptions (per `docs/UI-REFINEMENT-REPORT.md` I7): `var(--text-on-color, #fff)` for text on chip/badge/button colored backgrounds, brand-mark `border-radius: 3px` exception.
- **Use existing tokens where they exist.** Don't invent new tokens unless UI-SPEC explicitly requires one (e.g., `--accent-custom` is a new token added in this phase).
- **Preserve existing class names** wherever they already match UI-SPEC. Don't rename classes for cosmetic reasons; that breaks the HTML.
- **State coverage is mandatory.** Every interactive component defines at least: `default`, `:hover`, `:active` (or `--active`/`--selected` modifier), `:disabled`, and `:focus-visible`. Error state if applicable.
- **The Two-Font Rule.** Inter for UI text, JetBrains Mono (or `t-data` class) for paths, sizes, hashes, timestamps, counts, keyboard shortcuts. Components handling data values must use the mono font stack.
- **Convex-Concave Rule.** Buttons, chips, cards, badges = convex (top highlight + drop shadow). Inputs = concave (inset recess, no highlight). Never mix on the same element.
- **Wash-Not-Solid Rule.** Semantic + accent colors in content areas use wash variants (10–18% alpha) with matching edge variants. Never solid accent/semantic backgrounds in lists/rows.
- **Reduced motion strict.** Every motion-using component must collapse to instant under `@media (prefers-reduced-motion: reduce)`. Sole exception: live-data sparkline (Scan Progress).

---

## Task structure

Each task follows the pattern:

1. Read the relevant UI-SPEC sections + design-tokens.md sections + current styles.css for the component
2. Identify what already exists vs. what needs adding/refactoring
3. Apply Edit (or Write block) to update styles.css
4. Verify by grepping for class definitions, state coverage, token usage
5. Manual visual check is deferred to Phase 3 — Phase 2 acceptance is structural (classes + tokens + states)
6. Commit with descriptive message

---

## TASK 1 — Audit existing styles.css

**Files:**
- Read: `frontend/src/styles.css`
- Read: `docs/design-tokens.md`
- Read: `DESIGN.md`
- Read: `docs/UI-SPEC.md` (§A.0 + relevant sections)
- Create: `docs/UI-AUDIT-2026-04-25.md` (output document for downstream tasks)

The first task is an audit pass. The 4227-line `styles.css` may already contain most of what we need; the audit identifies what stays, what needs refactoring, and what's missing.

- [ ] **Step 1: Read styles.css end-to-end**

Read `frontend/src/styles.css` in full (it's ~4227 lines, may need multiple Read calls with offset). Identify the sections present (likely: tokens, base, typography, components by family, screen-specific overrides).

- [ ] **Step 2: Read design-tokens.md and DESIGN.md**

Read `docs/design-tokens.md` (2063 lines) for the token spec. Read `DESIGN.md` for the design system source. Cross-reference token names: which exist in styles.css? Which are missing? Which have wrong values?

- [ ] **Step 3: Catalog existing component classes**

Run:
```bash
grep -nE "^\.fp-[a-z]" frontend/src/styles.css | head -200
```
Build a list of every `fp-*` class definition currently in the file. Note which families are present (button, chip, input, etc.) and which states each defines.

- [ ] **Step 4: Write the audit report**

Create `docs/UI-AUDIT-2026-04-25.md` with these sections:
- **Token coverage**: table of expected tokens (from design-tokens.md + DESIGN.md) vs. present-in-styles.css. Mark each as `present-correct`, `present-wrong-value`, or `missing`.
- **Component coverage**: table of expected components (from this plan's task list, S4–S23) vs. present-in-styles.css. Mark each as `present-complete`, `present-partial-missing-states`, or `missing`.
- **Hardcoded hex audit**: list every line in styles.css that uses a hex color outside the tokens block. Flag any that should be replaced with token references in subsequent tasks.
- **Section markers**: list the line numbers of major section comment headers (e.g., `/* === Tokens === */`, `/* === Components === */`).

This audit is a working document — Phase 2 tasks reference it but it doesn't need to be polished. Write it to `docs/`.

- [ ] **Step 5: Commit**

```bash
git add docs/UI-AUDIT-2026-04-25.md
git commit -m "docs: audit existing styles.css against UI-SPEC tokens and components"
```

---

## TASK 2 — Reset design-tokens block in styles.css

**Files:**
- Modify: `frontend/src/styles.css` (the `:root` tokens block, near the top of the file)

Authoritative source for tokens: `DESIGN.md` frontmatter + `docs/design-tokens.md` §§1–8.

The tokens block must define these CSS custom properties (full list — copy these definitions verbatim if not present):

```css
:root {
  /* === Surfaces (dark mode default) === */
  --bg-backdrop: #181522;
  --bg-chrome: #1F1B27;
  --bg-content: #25202D;
  --bg-raised: #312A38;
  --bg-pressed: #3B3344;

  /* === Accent (default amber, runtime-overridable) === */
  --accent-custom: ;  /* Empty default; user override via Settings → Personalization */
  --accent: var(--accent-custom, #E8965E);
  --accent-hover: #F0A574;
  --accent-press: #D88248;
  --accent-wash: rgba(232, 150, 94, 0.10);
  --accent-wash-strong: rgba(232, 150, 94, 0.18);
  --accent-edge: rgba(232, 150, 94, 0.40);
  --accent-edge-strong: rgba(232, 150, 94, 0.60);
  --accent-glow: rgba(232, 150, 94, 0.20);

  /* === Text === */
  --text-primary: #F2EDE8;
  --text-secondary: #A39BAE;
  --text-tertiary: #6B6478;
  --text-on-accent: #1A1015;
  --text-on-color: #fff;  /* For text on colored chips/badges */

  /* === Semantic === */
  --good: #7DC494;
  --good-wash: rgba(125, 196, 148, 0.10);
  --good-edge: rgba(125, 196, 148, 0.40);
  --bad: #E08A86;
  --bad-wash: rgba(224, 138, 134, 0.10);
  --bad-edge: rgba(224, 138, 134, 0.40);
  --warn: #E8C56B;
  --warn-wash: rgba(232, 197, 107, 0.10);
  --warn-edge: rgba(232, 197, 107, 0.40);

  /* === Borders === */
  --border-hairline: rgba(255, 255, 255, 0.04);
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-mid: rgba(255, 255, 255, 0.12);
  --border-strong: rgba(255, 255, 255, 0.18);

  /* === Highlights / depth === */
  --highlight-top: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --highlight-top-strong: inset 0 1px 0 rgba(255, 255, 255, 0.10);
  --inset-recess: inset 0 1px 2px rgba(0, 0, 0, 0.30);
  --inset-recess-strong: inset 0 2px 4px rgba(0, 0, 0, 0.40);

  /* === Shadows === */
  --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(0, 0, 0, 0.15);
  --shadow-card: 0 2px 6px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.20);
  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.40), 0 2px 6px rgba(0, 0, 0, 0.25);
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35);
  --shadow-window: 0 24px 64px rgba(0, 0, 0, 0.65);

  /* === Radius === */
  --r-chip: 4px;
  --r-icon-btn: 5px;
  --r-button: 6px;
  --r-card: 8px;
  --r-modal: 10px;
  --r-window: 10px;
  --r-tray: 12px;
  --r-pill: 9999px;

  /* === Spacing === */
  --sp-2: 2px;
  --sp-4: 4px;
  --sp-6: 6px;
  --sp-8: 8px;
  --sp-10: 10px;
  --sp-12: 12px;
  --sp-14: 14px;
  --sp-16: 16px;
  --sp-20: 20px;
  --sp-24: 24px;
  --sp-32: 32px;
  --sp-40: 40px;
  --sp-48: 48px;
  --sp-64: 64px;

  /* === Motion === */
  --dur-flash: 50ms;
  --dur-fast: 80ms;
  --dur-slide: 180ms;
  --ease-snap: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* === Fonts === */
  --font-ui: 'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Geist Mono', ui-monospace, 'SF Mono', Consolas, monospace;
}

/* Light mode — warm cream ramp */
[data-theme="light"] {
  --bg-backdrop: #F5F1EC;
  --bg-chrome: #EDE8E1;
  --bg-content: #F8F4EF;
  --bg-raised: #FFFFFF;
  --bg-pressed: #E8E2DA;
  --text-primary: #1F1A22;
  --text-secondary: #5D5466;
  --text-tertiary: #9A93A4;
  /* Accent stays amber in both modes per UI-SPEC §A.0 */
  /* Borders/highlights need to be darkened — use rgba black */
  --border-hairline: rgba(0, 0, 0, 0.06);
  --border-subtle: rgba(0, 0, 0, 0.10);
  --border-mid: rgba(0, 0, 0, 0.15);
  --border-strong: rgba(0, 0, 0, 0.22);
  --highlight-top: inset 0 1px 0 rgba(255, 255, 255, 0.60);
  --highlight-top-strong: inset 0 1px 0 rgba(255, 255, 255, 0.80);
}
```

- [ ] **Step 1: Locate the existing tokens block**

Run:
```bash
grep -nE "^:root|--bg-backdrop|--accent" frontend/src/styles.css | head -20
```

Identify the line range of the existing `:root { … }` block.

- [ ] **Step 2: Replace the existing tokens block**

Use `Edit` to replace the existing `:root { ... }` block with the full token block above (and the `[data-theme="light"]` block immediately after it).

If the file has split tokens across multiple `:root` blocks, consolidate into one. If `[data-theme="light"]` exists elsewhere, replace it with the version above.

- [ ] **Step 3: Verify**

```bash
grep -c "^  --" frontend/src/styles.css   # token count
grep -n "^:root" frontend/src/styles.css   # exactly one :root block
grep -n "data-theme=\"light\"" frontend/src/styles.css   # exactly one light-mode block
```

The token count should be approximately 60+ (5 surfaces + 9 accent + 5 text + 9 semantic + 4 border + 4 highlight + 5 shadow + 8 radius + 13 spacing + 5 motion + 2 fonts ≈ 69 tokens).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(tokens): reset :root design tokens to canonical values from DESIGN.md"
```

---

## TASK 3 — Typography utility classes

**Files:**
- Modify: `frontend/src/styles.css`

Define 9 type-role utility classes per `docs/UI-SPEC.md` §A.0. These wrap the values declared in `DESIGN.md` frontmatter.

Insert this block immediately after the tokens block (and after any base reset / `body` rule):

```css
/* === Typography utility classes === */
.t-display {
  font-family: var(--font-ui);
  font-size: 28px;
  font-weight: 700;
  line-height: 34px;
  letter-spacing: -0.020em;
}
.t-headline {
  font-family: var(--font-ui);
  font-size: 22px;
  font-weight: 600;
  line-height: 30px;
  letter-spacing: -0.015em;
}
.t-title {
  font-family: var(--font-ui);
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  letter-spacing: -0.010em;
}
.t-title-sm {
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: -0.010em;
}
.t-body {
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  letter-spacing: -0.005em;
}
.t-label {
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  letter-spacing: -0.005em;
}
.t-caption {
  font-family: var(--font-ui);
  font-size: 11px;
  font-weight: 400;
  line-height: 16px;
  letter-spacing: -0.005em;
}
.t-micro {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 500;
  line-height: 14px;
  letter-spacing: 0.060em;
  text-transform: uppercase;
}
.t-data {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0;
}

/* Compatibility: existing code may still reference these CSS-var names */
:root {
  --t-display: 700 28px/34px var(--font-ui);
  --t-headline: 600 22px/30px var(--font-ui);
  --t-title: 600 18px/26px var(--font-ui);
  --t-title-sm: 600 16px/22px var(--font-ui);
  --t-body: 500 13px/20px var(--font-ui);
  --t-label: 500 12px/18px var(--font-ui);
  --t-caption: 400 11px/16px var(--font-ui);
  --t-micro: 500 10px/14px var(--font-ui);
  --t-data: 500 11px/16px var(--font-mono);
  --t-compact: 400 11px/16px var(--font-mono);
  --t-small: 400 11px/16px var(--font-ui);
}
```

The compatibility var block at the end is for backward compat — existing HTML/JS may use `var(--t-body)` etc.

- [ ] **Step 1: Locate where typography lives currently**

```bash
grep -nE "^\.t-|--t-body|--t-display" frontend/src/styles.css | head -20
```

Identify the existing typography section if any.

- [ ] **Step 2: Apply the typography block**

Use `Edit` to replace the existing typography section with the new block. If no typography section exists, insert immediately after the tokens block.

- [ ] **Step 3: Verify**

```bash
grep -nE "^\.t-(display|headline|title|title-sm|body|label|caption|micro|data) \{" frontend/src/styles.css
```

Should return exactly 9 matches.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(typography): 9 type role utility classes per UI-SPEC §A.0"
```

---

## TASK 4 — fp-button family

**Files:**
- Modify: `frontend/src/styles.css`

Per `docs/UI-SPEC.md` §A.1.4, A.10, A.11, A.12 and `DESIGN.md` §5 Buttons:

Required modifiers: `--primary`, `--secondary`, `--ghost`, `--icon`, `--large`, `--small`, `--danger`.

States per modifier: default, `:hover`, `:active`, `:disabled`, `:focus-visible`.

Reference styling (from `DESIGN.md` §5):
- All buttons: 6px radius, transition `transform var(--dur-flash) var(--ease-snap)`, `:active` does `transform: translateY(1px)`.
- Primary: `--accent` background, `--text-on-accent` text, `--highlight-top` inset, `--shadow-raised`. Hover: `--accent-hover`. Active: `--accent-press` + pressed shadow.
- Secondary: `--bg-raised` background, `--text-primary` text, 1px `--border-subtle` border, `--shadow-raised`. Hover: `--bg-pressed`.
- Ghost: transparent, `--text-secondary` text, no border, no shadow. Hover: `--bg-raised` + `--highlight-top`.
- Icon: 28×28 square, 5px radius (`--r-icon-btn`), transparent, `--text-secondary`. Hover: `--bg-raised` + `--highlight-top`. Active: `translateY(1px)`.
- Large: 36px height, 16px horizontal padding (used for primary CTAs in overlays).
- Small: 24px height, 8px horizontal padding.
- Danger: 1px `--bad-edge` border, `--bad` text, hover `--bad-wash` background. (Combine with `--secondary` or `--ghost`.)

Insert this block in the components section of styles.css (after typography, before existing component definitions or replacing the existing button block):

```css
/* === fp-button === */
.fp-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: var(--r-button);
  font: var(--t-body);
  cursor: pointer;
  user-select: none;
  transition: transform var(--dur-flash) var(--ease-snap),
              background-color var(--dur-flash) var(--ease-snap),
              box-shadow var(--dur-flash) var(--ease-snap);
}
.fp-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-glow);
}
.fp-button:disabled,
.fp-button[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
.fp-button:active {
  transform: translateY(1px);
}

.fp-button--primary {
  background: var(--accent);
  color: var(--text-on-accent);
  box-shadow: var(--highlight-top), var(--shadow-raised);
}
.fp-button--primary:hover {
  background: var(--accent-hover);
}
.fp-button--primary:active {
  background: var(--accent-press);
  box-shadow: var(--inset-recess);
}

.fp-button--secondary {
  background: var(--bg-raised);
  color: var(--text-primary);
  border-color: var(--border-subtle);
  box-shadow: var(--highlight-top), var(--shadow-raised);
}
.fp-button--secondary:hover {
  background: var(--bg-pressed);
}
.fp-button--secondary:active {
  box-shadow: var(--inset-recess);
}

.fp-button--ghost {
  background: transparent;
  color: var(--text-secondary);
  padding: 0 10px;
}
.fp-button--ghost:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--highlight-top);
}

.fp-button--icon,
.fp-icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--r-icon-btn);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color var(--dur-flash) var(--ease-snap),
              transform var(--dur-flash) var(--ease-snap);
}
.fp-button--icon:hover,
.fp-icon-btn:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--highlight-top);
}
.fp-button--icon:active,
.fp-icon-btn:active {
  transform: translateY(1px);
}
.fp-button--icon:focus-visible,
.fp-icon-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.fp-button--large {
  height: 36px;
  padding: 0 16px;
  font-size: 14px;
}
.fp-button--small {
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
}

.fp-button--danger {
  border-color: var(--bad-edge);
  color: var(--bad);
  background: transparent;
}
.fp-button--danger:hover {
  background: var(--bad-wash);
}
```

- [ ] **Step 1: Locate existing fp-button rules**

```bash
grep -nE "^\.fp-button|^\.fp-icon-btn" frontend/src/styles.css | head -20
```

- [ ] **Step 2: Replace the existing button block(s) with the new block above**

If multiple existing button-related blocks exist, consolidate them. The `.fp-icon-btn` legacy alias is preserved (mapped to the same styles as `.fp-button--icon`) so existing HTML keeps working.

- [ ] **Step 3: Verify state coverage**

```bash
grep -nE "^\.fp-button(--[a-z]+)?(:hover|:active|:disabled|:focus-visible|\[disabled\])?" frontend/src/styles.css | wc -l
```

Should return at least 20 lines (covering 7 modifiers × ~3 states each).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(button): rebuild fp-button family with all modifiers and states"
```

---

## TASK 5 — fp-chip family

**Files:**
- Modify: `frontend/src/styles.css`

Per `docs/UI-SPEC.md` §A.1.3 (sidebar tags), §A.3.1 (poker-chip stack), §A.10 (chip component spec), `DESIGN.md` §5 Chips.

Required modifiers: `--active`, `--good`, `--warn`, `--bad`. State via background wash and edge tint, never solid. 4px radius (`--r-chip`), 20px height, 6px horizontal padding, JetBrains Mono 11px.

```css
/* === fp-chip === */
.fp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 6px;
  background: var(--bg-raised);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-chip);
  font: var(--t-data);
  user-select: none;
  white-space: nowrap;
}
.fp-chip--active {
  background: var(--accent-wash);
  color: var(--text-primary);
  border-color: var(--accent-edge);
}
.fp-chip--good {
  background: var(--good-wash);
  color: var(--good);
  border-color: var(--good-edge);
}
.fp-chip--warn {
  background: var(--warn-wash);
  color: var(--warn);
  border-color: var(--warn-edge);
}
.fp-chip--bad {
  background: var(--bad-wash);
  color: var(--bad);
  border-color: var(--bad-edge);
}
```

- [ ] **Step 1: Locate existing chip rules**

```bash
grep -nE "^\.fp-chip" frontend/src/styles.css | head -10
```

- [ ] **Step 2: Replace with the block above**

- [ ] **Step 3: Verify**

```bash
grep -nE "^\.fp-chip(--[a-z]+)?" frontend/src/styles.css
```

Should return 5 matches (base + 4 modifiers).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(chip): rebuild fp-chip family with semantic modifiers"
```

---

## TASK 6 — fp-input

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.1.4 (search field), §A.12.1 (form inputs), `DESIGN.md` §5 Inputs.

Concave chrome. 6px radius (`--r-button`), 30px height, `--bg-content` background flush with surrounding chrome, 1px `--border-subtle`, `--inset-recess` shadow. Focus: `--accent-edge` border + `--inset-recess-strong` + 3px `--accent-glow` ring.

```css
/* === fp-input === */
.fp-input {
  display: block;
  width: 100%;
  height: 30px;
  padding: 0 12px;
  background: var(--bg-content);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-button);
  box-shadow: var(--inset-recess);
  font: var(--t-body);
  transition: border-color var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out);
}
.fp-input::placeholder {
  color: var(--text-tertiary);
}
.fp-input:focus,
.fp-input:focus-visible {
  outline: none;
  border-color: var(--accent-edge);
  box-shadow: var(--inset-recess-strong),
              0 0 0 3px var(--accent-glow);
}
.fp-input:disabled,
.fp-input[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.fp-input--invalid,
.fp-input[aria-invalid="true"] {
  border-color: var(--bad);
  box-shadow: var(--inset-recess), 0 0 0 3px var(--bad-wash);
}
.fp-field-error {
  display: block;
  margin-top: 4px;
  color: var(--bad);
  font: var(--t-caption);
}
```

- [ ] **Step 1: Locate existing input rules** — `grep -nE "^\.fp-input|^\.fp-field-error" frontend/src/styles.css`

- [ ] **Step 2: Replace with block above**

- [ ] **Step 3: Verify** — `grep -nE "^\.fp-input(--[a-z]+)?(:hover|:focus|:focus-visible|:disabled|\[disabled\]|\[aria-invalid)?" frontend/src/styles.css | wc -l` — should return ≥ 5 lines.

- [ ] **Step 4: Commit** — `git commit -m "feat(input): rebuild fp-input with concave chrome and focus ring"`

---

## TASK 7 — fp-kbd-pill

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.1.4 toolbar search hint, §A.11.1 command palette footer, §A.12.9 shortcuts pane.

```css
/* === fp-kbd-pill === */
.fp-kbd-pill {
  display: inline-flex;
  align-items: center;
  height: 16px;
  min-width: 16px;
  padding: 0 4px;
  background: var(--bg-raised);
  color: var(--text-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font: 500 10px/16px var(--font-mono);
  letter-spacing: 0;
  user-select: none;
}
```

- [ ] Locate existing — `grep -n "fp-kbd-pill\|kbd-pill\|fp-kbd" frontend/src/styles.css`. Replace with block above. Commit: `feat(kbd): rebuild fp-kbd-pill for keyboard shortcut hints`.

---

## TASK 8 — fp-segmented + fp-segmented__option

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.1.4 (view toggle), §A.5.2 (segmented controls in scan config), §A.12.1 (theme/density segmented).

Concave container with convex active pill that slides between segments at `--dur-slide`.

```css
/* === fp-segmented === */
.fp-segmented {
  display: inline-flex;
  position: relative;
  height: 30px;
  padding: 2px;
  background: var(--bg-content);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-button);
  box-shadow: var(--inset-recess);
}
.fp-segmented__option,
.fp-segmented__opt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 12px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--r-button);
  font: var(--t-body);
  cursor: pointer;
  position: relative;
  z-index: 1;
  transition: color var(--dur-fast) var(--ease-out);
  user-select: none;
}
.fp-segmented__option:hover,
.fp-segmented__opt:hover {
  color: var(--text-primary);
}
.fp-segmented__option--active,
.fp-segmented__option.active,
.fp-segmented__opt--active,
.fp-segmented__opt.active {
  background: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--highlight-top), var(--shadow-raised);
  transition: background-color var(--dur-slide) var(--ease-out),
              color var(--dur-fast) var(--ease-out);
}
.fp-segmented__option:focus-visible,
.fp-segmented__opt:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-glow);
}
```

- [ ] Locate existing — `grep -n "fp-segmented" frontend/src/styles.css`. Replace. Commit: `feat(segmented): rebuild fp-segmented control with sliding active pill`.

---

## TASK 9 — fp-toggle

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.12.1 toggles, `DESIGN.md` Section 21 form controls. 32×18 track with `--inset-recess` off state, `--accent` on state, 14×14 thumb.

```css
/* === fp-toggle === */
.fp-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}
.fp-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.fp-toggle__track {
  position: absolute;
  inset: 0;
  background: var(--bg-pressed);
  border-radius: var(--r-pill);
  box-shadow: var(--inset-recess);
  transition: background-color var(--dur-fast) var(--ease-out);
}
.fp-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--text-primary);
  border-radius: var(--r-pill);
  box-shadow: var(--shadow-raised);
  transition: transform var(--dur-slide) var(--ease-out),
              background-color var(--dur-fast) var(--ease-out);
}
.fp-toggle input:checked ~ .fp-toggle__track {
  background: var(--accent);
}
.fp-toggle input:checked ~ .fp-toggle__thumb {
  transform: translateX(14px);
  background: var(--text-on-accent);
}
.fp-toggle input:focus-visible ~ .fp-toggle__track {
  box-shadow: var(--inset-recess), 0 0 0 3px var(--accent-glow);
}
.fp-toggle input:disabled ~ .fp-toggle__track,
.fp-toggle input:disabled ~ .fp-toggle__thumb {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] Locate, replace, commit: `feat(toggle): rebuild fp-toggle switch with track + thumb`.

---

## TASK 10 — fp-slider

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.12.1 (inspector default width slider), `DESIGN.md` Section 21.

4px inset-recess track, accent fill, 14×14 thumb with shadow-raised.

```css
/* === fp-slider === */
.fp-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 14px;
  background: transparent;
  cursor: pointer;
}
.fp-slider::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--bg-pressed);
  border-radius: var(--r-pill);
  box-shadow: var(--inset-recess);
}
.fp-slider::-moz-range-track {
  height: 4px;
  background: var(--bg-pressed);
  border-radius: var(--r-pill);
  box-shadow: var(--inset-recess);
}
.fp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  background: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-pill);
  box-shadow: var(--shadow-raised);
  cursor: pointer;
}
.fp-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-pill);
  box-shadow: var(--shadow-raised);
  cursor: pointer;
}
.fp-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: var(--shadow-raised), 0 0 0 3px var(--accent-glow);
}
.fp-slider:focus-visible::-moz-range-thumb {
  box-shadow: var(--shadow-raised), 0 0 0 3px var(--accent-glow);
}
.fp-slider:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] Locate, replace, commit: `feat(slider): rebuild fp-slider with inset-recess track and shadowed thumb`.

---

## TASK 11 — fp-radio + fp-checkbox

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.7.1 (dedup radios), §A.12.6 (radio groups), `DESIGN.md` Section 21.

```css
/* === fp-radio === */
.fp-radio {
  position: relative;
  display: inline-block;
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}
.fp-radio input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.fp-radio__mark {
  position: absolute;
  inset: 0;
  background: var(--bg-content);
  border: 1px solid var(--border-mid);
  border-radius: var(--r-pill);
  box-shadow: var(--inset-recess);
  transition: border-color var(--dur-fast) var(--ease-out);
}
.fp-radio__mark::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  background: var(--accent);
  border-radius: var(--r-pill);
  transform: scale(0);
  transition: transform var(--dur-fast) var(--ease-out);
}
.fp-radio input:checked ~ .fp-radio__mark {
  border-color: var(--accent-edge);
}
.fp-radio input:checked ~ .fp-radio__mark::after {
  transform: scale(1);
}
.fp-radio input:focus-visible ~ .fp-radio__mark {
  box-shadow: var(--inset-recess), 0 0 0 3px var(--accent-glow);
}

/* === fp-checkbox === */
.fp-checkbox {
  position: relative;
  display: inline-block;
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
}
.fp-checkbox input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.fp-checkbox__mark {
  position: absolute;
  inset: 0;
  background: var(--bg-content);
  border: 1px solid var(--border-mid);
  border-radius: 3px;
  box-shadow: var(--inset-recess);
  transition: background-color var(--dur-fast) var(--ease-out),
              border-color var(--dur-fast) var(--ease-out);
}
.fp-checkbox__mark::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 5px;
  width: 4px;
  height: 8px;
  border: solid var(--text-on-accent);
  border-width: 0 2px 2px 0;
  transform: scale(0) rotate(45deg);
  transition: transform var(--dur-fast) var(--ease-snap);
}
.fp-checkbox input:checked ~ .fp-checkbox__mark {
  background: var(--accent);
  border-color: var(--accent);
}
.fp-checkbox input:checked ~ .fp-checkbox__mark::after {
  transform: scale(1) rotate(45deg);
}
.fp-checkbox input:focus-visible ~ .fp-checkbox__mark {
  box-shadow: var(--inset-recess), 0 0 0 3px var(--accent-glow);
}
```

- [ ] Locate, replace, commit: `feat(form): rebuild fp-radio and fp-checkbox controls`.

---

## TASK 12 — fp-row (file row)

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.2.1, §A.3.1, §A.8.2, §A.9.2, `DESIGN.md` §5 File Row.

Flat at rest. State communicated through fill, never shadows or side borders. 26px default height.

```css
/* === fp-row === */
.fp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-button);
  cursor: pointer;
  user-select: none;
  position: relative;
  transition: background-color var(--dur-flash) var(--ease-snap);
}
.fp-row:hover {
  background: var(--bg-raised);
  box-shadow: var(--highlight-top);
}
.fp-row--selected,
.fp-row.fp-row--selected {
  background: var(--accent-wash);
  border-color: var(--accent-edge);
}
.fp-row--selected::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 2px;
}
.fp-row--active {
  background: var(--bg-pressed);
}
.fp-row--drag-target {
  background: var(--accent-wash-strong);
  border-color: var(--accent-edge-strong);
}
.fp-row--ai-filed {
  animation: fp-row-ai-fade 1.7s ease-out;
}
@keyframes fp-row-ai-fade {
  0%   { background: var(--accent-wash); border-color: var(--accent-edge); }
  100% { background: transparent; border-color: transparent; }
}
.fp-row--vanished {
  text-decoration: line-through;
  opacity: 0.6;
}
.fp-row--folder .fp-row__icon {
  color: var(--accent);
}
.fp-row__icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
}
.fp-row__name {
  flex: 1;
  font: var(--t-body);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-row__size,
.fp-row__modified {
  flex-shrink: 0;
  font: var(--t-data);
  color: var(--text-secondary);
}
.fp-row__size { min-width: 72px; text-align: right; }
.fp-row__modified { min-width: 88px; text-align: right; }
.fp-row__tags {
  flex-shrink: 0;
  min-width: 120px;
  display: flex;
  gap: 4px;
}

/* Compact density (22px) */
[data-density="compact"] .fp-row { height: 22px; }
/* Comfortable density (32px) */
[data-density="comfortable"] .fp-row { height: 32px; }
```

- [ ] Locate existing — `grep -nE "^\.fp-row" frontend/src/styles.css | head -10`. Replace with block above. Commit: `feat(row): rebuild fp-row with all states and density variants`.

---

## TASK 13 — fp-sidebar__item with floating amber pill

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.1.3, `DESIGN.md` §5 Navigation. 28px tall, 6px radius, floating 2px amber pill on active item that slides between items at `--dur-slide`.

```css
/* === fp-sidebar__item === */
.fp-sidebar__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  border-radius: var(--r-button);
  font: var(--t-body);
  cursor: pointer;
  position: relative;
  text-align: left;
  user-select: none;
  transition: background-color var(--dur-flash) var(--ease-snap),
              color var(--dur-flash) var(--ease-snap);
}
.fp-sidebar__item__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-sidebar__item:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
  box-shadow: var(--highlight-top);
}
.fp-sidebar__item--active,
.fp-sidebar__item.active {
  background: var(--bg-pressed);
  color: var(--text-primary);
  font-weight: 600;
  box-shadow: var(--highlight-top);
}
.fp-sidebar__item--active::before,
.fp-sidebar__item.active::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--accent);
  border-radius: 2px;
}
.fp-sidebar__item--active svg,
.fp-sidebar__item.active svg {
  color: var(--accent);
}
.fp-sidebar__item:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-glow);
}
```

- [ ] Locate, replace, commit: `feat(sidebar): rebuild fp-sidebar__item with floating amber pill on active`.

---

## TASK 14 — fp-card

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.5.2, §A.7.2, §A.12 (settings cards), `DESIGN.md` §5 Cards.

8px radius, raised bg, border-subtle, highlight-top, shadow-card. 16px internal padding.

```css
/* === fp-card === */
.fp-card {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  box-shadow: var(--highlight-top), var(--shadow-card);
  padding: 16px;
}
.fp-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.fp-card__title {
  font: var(--t-title-sm);
  color: var(--text-primary);
}
.fp-card__body {
  font: var(--t-body);
  color: var(--text-secondary);
}
```

- [ ] Locate, replace, commit: `feat(card): rebuild fp-card container with header/body conventions`.

---

## TASK 15 — fp-popover (base) + fp-context-menu + fp-tooltip + fp-dropdown

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.10 (context menus), `DESIGN.md` Section 26 (tooltip), Section 27 (context menu).

`fp-popover` is the chrome base. Specific types extend it with their item/spacing conventions.

```css
/* === fp-popover (base chrome) === */
.fp-popover {
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  box-shadow: var(--highlight-top), var(--shadow-popover);
  padding: 4px;
  min-width: 180px;
  z-index: 200;
}

/* === fp-context-menu === */
.fp-context-menu {
  /* extends fp-popover */
}
.fp-context-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-icon-btn);
  font: var(--t-body);
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}
.fp-context-menu__item__icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--text-secondary);
}
.fp-context-menu__item__kbd {
  margin-left: auto;
  font: 500 11px/16px var(--font-mono);
  color: var(--text-tertiary);
}
.fp-context-menu__item:hover {
  background: var(--accent-wash);
  color: var(--accent);
}
.fp-context-menu__item:hover .fp-context-menu__item__icon {
  color: var(--accent);
}
.fp-context-menu__item--danger {
  color: var(--bad);
}
.fp-context-menu__item--danger:hover {
  background: var(--bad-wash);
  color: var(--bad);
}
.fp-context-menu__sep,
.fp-context-menu__separator {
  height: 1px;
  margin: 4px 0;
  background: var(--border-subtle);
}

/* === fp-tooltip === */
.fp-tooltip {
  display: inline-block;
  padding: 6px 10px;
  background: var(--bg-raised);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-icon-btn);
  box-shadow: var(--highlight-top), var(--shadow-popover);
  font: var(--t-caption);
  pointer-events: none;
  white-space: nowrap;
  z-index: 200;
}

/* === fp-dropdown === */
.fp-dropdown {
  /* extends fp-popover; uses fp-context-menu__item for entries */
}
```

- [ ] Locate, replace, commit: `feat(popover): rebuild fp-popover base with context menu, tooltip, dropdown variants`.

---

## TASK 16 — fp-modal

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.11.1 (command palette), §A.11.3 (confirmation modals), `DESIGN.md` §5 Command Palette.

10px radius, raised bg, shadow-modal. Backdrop blur on the scrim.

```css
/* === fp-modal === */
.fp-modal-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fp-modal-scrim-in var(--dur-fast) var(--ease-out);
}
@keyframes fp-modal-scrim-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.fp-modal {
  background: var(--bg-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--r-modal);
  box-shadow: var(--highlight-top), var(--shadow-modal);
  padding: 24px;
  min-width: 320px;
  max-width: 640px;
  animation: fp-modal-in var(--dur-slide) var(--ease-out);
}
@keyframes fp-modal-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fp-modal__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.fp-modal__title {
  font: var(--t-headline);
  color: var(--text-primary);
}
.fp-modal__body {
  font: var(--t-body);
  color: var(--text-secondary);
  margin-bottom: 16px;
}
.fp-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
```

- [ ] Locate, replace, commit: `feat(modal): rebuild fp-modal with backdrop scrim and slide-in animation`.

---

## TASK 17 — fp-snackbar + fp-toast

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.11.4, `DESIGN.md` Section 30.

Snackbar bottom-center with accent-edge border + 5s progress bar. Toast bottom-right with border variants.

```css
/* === fp-snackbar === */
.fp-snackbar {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  min-width: 320px;
  max-width: 480px;
  background: var(--bg-raised);
  border: 1px solid var(--accent-edge);
  border-radius: var(--r-card);
  box-shadow: var(--highlight-top), var(--shadow-popover);
  font: var(--t-body);
  color: var(--text-primary);
  z-index: 1100;
  overflow: hidden;
}
.fp-snackbar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  height: 4px;
  width: 100%;
  background: var(--accent);
  transform-origin: left;
  animation: fp-snackbar-progress 5s linear forwards;
}
@keyframes fp-snackbar-progress {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
.fp-snackbar__undo {
  margin-left: auto;
  background: transparent;
  color: var(--accent);
  border: none;
  font: var(--t-body);
  cursor: pointer;
  padding: 0 8px;
}

/* === fp-toast === */
.fp-toast-stack {
  position: fixed;
  bottom: 16px;
  right: 16px;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  z-index: 1100;
}
.fp-toast {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  min-width: 320px;
  max-width: 360px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  box-shadow: var(--highlight-top), var(--shadow-popover);
  font: var(--t-body);
  color: var(--text-primary);
}
.fp-toast--accent { border-color: var(--accent-edge); }
.fp-toast--good { border-color: var(--good-edge); }
.fp-toast--warn { border-color: var(--warn-edge); }
.fp-toast--bad { border-color: var(--bad-edge); }
.fp-toast__dismiss {
  margin-left: auto;
  background: transparent;
  color: var(--text-tertiary);
  border: none;
  cursor: pointer;
  font: var(--t-body);
}
```

- [ ] Locate, replace, commit: `feat(toast): rebuild fp-snackbar and fp-toast with progress bar and variants`.

---

## TASK 18 — fp-badge

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` (badges throughout — count badges in sidebar, tab close badges, etc.), `DESIGN.md` Approvals Pill.

```css
/* === fp-badge === */
.fp-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  min-width: 18px;
  padding: 0 6px;
  background: var(--accent);
  color: var(--text-on-accent);
  border-radius: var(--r-pill);
  font: 500 11px/16px var(--font-mono);
  letter-spacing: 0;
  user-select: none;
}
.fp-badge--accent {
  background: var(--accent);
  color: var(--text-on-accent);
}
.fp-badge--good {
  background: var(--good-wash);
  color: var(--good);
  border: 1px solid var(--good-edge);
}
.fp-badge--warn {
  background: var(--warn-wash);
  color: var(--warn);
  border: 1px solid var(--warn-edge);
}
.fp-badge--bad {
  background: var(--bad-wash);
  color: var(--bad);
  border: 1px solid var(--bad-edge);
}
```

- [ ] Locate, replace, commit: `feat(badge): rebuild fp-badge with semantic variants`.

---

## TASK 19 — fp-state-dot

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.9.2 (Everything Folder state dots), §A.14.3 (Tray state dots).

6px filled circle, semantic colors. Used everywhere file/process state is shown.

```css
/* === fp-state-dot === */
.fp-state-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: var(--r-pill);
  flex-shrink: 0;
}
.fp-state-dot--neutral { background: var(--text-tertiary); }
.fp-state-dot--accent  { background: var(--accent); }
.fp-state-dot--good    { background: var(--good); }
.fp-state-dot--warn    { background: var(--warn); }
.fp-state-dot--bad     { background: var(--bad); }
```

- [ ] Locate, replace, commit: `feat(state-dot): add fp-state-dot semantic indicator`.

---

## TASK 20 — fp-breadcrumb-sep

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.1.4 toolbar breadcrumb. Middot `·` separator only — never `>` or `/`.

```css
/* === fp-breadcrumb === */
.fp-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  font: var(--t-body);
  color: var(--text-secondary);
}
.fp-breadcrumb__crumb {
  background: transparent;
  color: var(--text-secondary);
  border: none;
  padding: 4px 6px;
  border-radius: var(--r-icon-btn);
  cursor: pointer;
  font: var(--t-body);
  user-select: none;
}
.fp-breadcrumb__crumb:hover {
  background: var(--bg-raised);
  color: var(--text-primary);
}
.fp-breadcrumb__crumb--current {
  color: var(--text-primary);
  font-weight: 500;
}
.fp-breadcrumb__sep,
.fp-breadcrumb-sep {
  color: var(--text-tertiary);
  font-size: 11px;
  user-select: none;
}
```

- [ ] Locate, replace, commit: `feat(breadcrumb): rebuild fp-breadcrumb with middot separator`.

---

## TASK 21 — fp-tab-underline (sliding indicator)

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.1.2 tab bar, §A.2 home sub-tabs, §A.3.2 inspector tabs, §A.7 scan results tabs.

The underline is a 2px accent bar that slides between active tabs at `--dur-slide`.

```css
/* === fp-tabs === */
.fp-tabs {
  position: relative;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border-hairline);
}
.fp-tabs__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  height: 44px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  font: var(--t-body);
  cursor: pointer;
  user-select: none;
  transition: color var(--dur-fast) var(--ease-out);
}
.fp-tabs__item:hover {
  color: var(--text-primary);
}
.fp-tabs__item--active,
.fp-tabs__item.active {
  color: var(--text-primary);
  font-weight: 600;
}
.fp-tabs__item:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 3px var(--accent-glow);
}
.fp-tabs__indicator {
  position: absolute;
  bottom: -1px;
  left: 0;
  height: 2px;
  width: 0;
  background: var(--accent);
  border-radius: 2px;
  transition: left var(--dur-slide) var(--ease-out),
              width var(--dur-slide) var(--ease-out);
  pointer-events: none;
}

/* === fp-tab-underline (legacy alias) === */
.fp-tab-underline {
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
  transition: left var(--dur-slide) var(--ease-out),
              width var(--dur-slide) var(--ease-out);
}

/* Top-level explorer tabs (A.1.2) */
.fp-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  background: var(--bg-chrome);
  color: var(--text-secondary);
  border: none;
  border-right: 1px solid var(--border-hairline);
  font: var(--t-body);
  cursor: pointer;
  position: relative;
  user-select: none;
}
.fp-tab--active,
.fp-tab.fp-tab--active {
  background: var(--bg-content);
  color: var(--text-primary);
}
.fp-tab--active::after,
.fp-tab.fp-tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
}
```

- [ ] Locate, replace, commit: `feat(tabs): rebuild fp-tabs with sliding underline indicator and tab bar`.

---

## TASK 22 — fp-drag-handle

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.3.2 inspector resize handle.

4px wide hit area, accent on hover.

```css
/* === fp-drag-handle === */
.fp-drag-handle {
  width: 4px;
  cursor: ew-resize;
  background: transparent;
  flex-shrink: 0;
  transition: background-color var(--dur-fast) var(--ease-out);
}
.fp-drag-handle:hover,
.fp-drag-handle--active {
  background: var(--accent);
}
.fp-drag-handle--horizontal {
  width: 100%;
  height: 4px;
  cursor: ns-resize;
}
```

- [ ] Locate, replace, commit: `feat(drag-handle): add fp-drag-handle for resizable panes`.

---

## TASK 23 — fp-marquee (rectangular multi-select)

**Files:** Modify `frontend/src/styles.css`.

Per `docs/UI-SPEC.md` §A.3.1 marquee selection.

```css
/* === fp-marquee === */
.fp-marquee {
  position: absolute;
  background: var(--accent-wash-strong);
  border: 1px solid var(--accent-edge);
  border-radius: var(--r-chip);
  pointer-events: none;
  z-index: 50;
}
```

- [ ] Locate, replace, commit: `feat(marquee): add fp-marquee rectangular multi-select indicator`.

---

## TASK 24 — Reduced motion + Section 41 audit + final commit

**Files:** Modify `frontend/src/styles.css`. Update `docs/UI-REFINEMENT-REPORT.md` with Phase 2 audit results.

### Step 1: Add the strict reduced-motion block at the bottom of styles.css

```css
/* === prefers-reduced-motion: strict policy per UI-SPEC §A.0 === */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* Sole exception: live-data sparkline on Scan Progress */
  .fp-sparkline,
  .fp-sparkline * {
    animation-duration: revert !important;
    transition-duration: revert !important;
  }
}
```

### Step 2: Run the Section 41 audit

`docs/design-tokens.md` Section 41 has the audit checklist. Read it. For each item, verify against the current `frontend/src/styles.css`. Flag any failures.

The audit covers:
- Token presence (every token from §1–8 exists in `:root`)
- Two-Font Rule (mono used for data, Inter for UI)
- Convex-Concave Rule (no inputs with shadow-raised, no buttons with inset-recess)
- Wash-Not-Solid Rule (no solid accent in row backgrounds)
- One Amber Rule (accent on ≤10% of any surface — visual check, manual)
- Reduced motion respect (every animation has reduced-motion fallback)
- State coverage (every interactive component has hover/active/disabled/focus-visible)
- No hardcoded hex outside `:root` (with documented exceptions)

### Step 3: Update `docs/UI-REFINEMENT-REPORT.md` with a new section

Append a "Phase 2 System Pass — Audit Results (2026-04-25)" section with:
- A summary table: each Section 41 item → pass/fail/exception
- Any deviations from spec, with justification
- A list of token + component classes added/refactored in Phase 2
- Confirmation that prefers-reduced-motion is wired

### Step 4: Final commit

```bash
git add frontend/src/styles.css docs/UI-REFINEMENT-REPORT.md
git commit -m "feat(motion): strict prefers-reduced-motion + Phase 2 system pass audit complete"
```

---

## Definition of done (Phase 2)

The system pass is done when:

1. All 24 tasks above are committed.
2. `frontend/src/styles.css` has a single canonical `:root` tokens block matching `DESIGN.md` and `docs/design-tokens.md` §§1–8.
3. `--accent-custom` user-override hook is wired and the entire accent ramp re-resolves through it.
4. All 9 typography utility classes are defined.
5. All 22 component classes (fp-button through fp-marquee) are defined with all required visual states.
6. `prefers-reduced-motion: reduce` collapses motion to instant except the live-data sparkline.
7. Section 41 audit passes (or each failure has a documented exception in `docs/UI-REFINEMENT-REPORT.md`).
8. The Electron app launches without CSS errors (no missing-token warnings in DevTools).

After these are complete, Phase 3 (per-screen polish) can begin — see `docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md` §6 for the per-screen build order.
