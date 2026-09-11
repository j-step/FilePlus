# Stage 1 — Redesign (one system pass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin FilePlus to board C (neutral greys, hairline borders, flat surfaces, fixed blue accent, Segoe UI Variable) in one pass, add system-theme following and Mica behind the sidebar and titlebar, and remove the glow feature — with no layout, sizing or density change.

**Architecture:** Token-first. Task 1 rewrites the `:root` / `[data-theme="light"]` token values so the whole app retints and flattens at once (bevel tokens become `none`). Tasks 2–5 then delete the dead effect references, remove the glow feature, and bring each component family onto the spec's treatment table. Tasks 6–7 add the theme-mode and Mica plumbing across `main.js` / `preload.js` / `app.js`. Task 8 enforces grep gates, updates docs and writes the run summary. Every task ends with `verify` green.

**Tech Stack:** Plain CSS/HTML/JS in `frontend/`, Electron 41 (`BrowserWindow.backgroundMaterial`, `nativeTheme`), Python 3.14 (`py -3`) for the contrast checker, Playwright smoke test, PowerShell 5.1 `scripts/verify.ps1`.

**Spec:** `docs/superpowers/specs/2026-09-10-stage-1-redesign-design.md` (§3 tokens, §4 component model, §5 plumbing, §6 gates). Parent: roadmap spec §5 Stage 1, D6–D8.

## Global Constraints

- **Layout, sizing, spacing and density do not change** (roadmap D7): no edit to any `width`, `height`, `padding`, `margin`, `gap`, `font-size`, `line-height`, `--h-*`, `--w-*`, `--s-*`, `--row-*`, `--t-*` value. Radii and weights are the only dimensional-looking values that change, and only to the spec §3.4 values.
- Token **names** stay; only values change. New tokens allowed: `--font-data`, and the attributes `data-theme-mode`, `data-mica`.
- No behaviour change except: theme mode `system`, toolbar toggle cycle, glow feature removal. No placeholder screen gets wired.
- Work happens in the worktree `C:\Dev\FilePlus\.worktrees\stage-1-redesign` on branch `stage/1-redesign` (created by the controller). `frontend/node_modules` must exist there (`npm ci` once). Run all commands from the worktree root unless stated.
- Verify gate, from the worktree root: `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` — expected tail `48 passed` (plus contrast tests from Task 1 onward), `2 passed`, `verify: all green`. Green before every commit.
- Python is `py -3`. PowerShell 5.1 syntax in `.ps1` (no `&&`, `||`, ternary, `??`); `.ps1` files stay ASCII.
- Commit with `git -c core.safecrlf=false commit`; every message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (the trailer names the directing session; do not substitute another model name; if unwilling, omit the trailer and say so).
- Look at the screenshots `verify` writes to `artifacts/screenshots/` after every task; a screen that renders blank or with unreadable text is a failed task even if the smoke test is green.

---

## File Structure

| Path | Responsibility | Tasks |
|---|---|---|
| `frontend/src/styles.css` `:root` + `[data-theme="light"]` (lines 15–228 today) | The token set | 1 |
| `scripts/contrast_check.py`, `tests/test_contrast_check.py`, `scripts/verify.ps1` | Contrast gate | 1 |
| `frontend/src/styles.css` (glow blocks), `frontend/index.html` (glow toggle), `frontend/src/app.js` (glow functions) | Glow removal | 2 |
| `frontend/src/styles.css` (all rules) | Flatten sweep: dead effect refs, gradients, hardcoded bevels, font-mono → font-data, amber literals | 3 |
| `frontend/src/styles.css` control families | Component treatment: buttons, inputs, segmented, toggle/checkbox/radio/slider, chips/badges/pills, kbd, state dot | 4 |
| `frontend/src/styles.css` chrome + list families | Component treatment: sidebar, tabs, rows, list header, breadcrumb, inspector, statusbar, titlebar/toolbar seams, popovers/menus/palette/modal/toast/snackbar/banners/empty states | 5 |
| `frontend/src/app.js` (`applyTheme`, `toggleTheme`, `restoreSettings`), `frontend/main.js`, `frontend/preload.js`, `frontend/test/smoke.spec.js` | Theme mode + light screenshots | 6 |
| `frontend/main.js`, `frontend/preload.js`, `frontend/src/app.js`, `frontend/src/styles.css` | Mica | 7 |
| `CLAUDE.md`, `docs/UI-SPEC.md`, `docs/superpowers/runs/2026-09-1x-stage-1.md` | Gates, docs, summary | 8 |

---

### Task 1: Token set and contrast gate

**Files:**
- Modify: `frontend/src/styles.css` lines 15–228 (the `:root` and `[data-theme="light"]` blocks) and lines 256–260 (`code, kbd, pre, .mono`)
- Create: `scripts/contrast_check.py`, `tests/test_contrast_check.py`
- Modify: `scripts/verify.ps1` (add the contrast stage after pytest)

**Interfaces:**
- Consumes: nothing.
- Produces: the token values every later task styles against; `scripts/contrast_check.py <css-path>` exits 0/1; `--font-data`.

- [ ] **Step 1: Write the failing contrast-check test**

```python
# tests/test_contrast_check.py
"""contrast_check parses token blocks and enforces the Stage 1 floors."""
import pytest
from scripts.contrast_check import parse_blocks, contrast, check, FLOORS

FIXTURE = """
:root {
  --bg-content: #232428;
  --bg-chrome: #1C1D20;
  --bg-raised: #2B2C31;
  --text-primary: #E7E8EA;
  --text-secondary: #A0A3AA;
  --text-tertiary: #74777F;
  --accent: var(--accent-custom, #4CC2FF);
  --text-on-accent: #062033;
}
[data-theme="light"] {
  --bg-content: #FFFFFF;
  --bg-chrome: #F4F4F5;
  --bg-raised: #EBEBED;
  --text-primary: #1D1E21;
  --text-secondary: #5F6168;
  --text-tertiary: #8E9097;
  --accent: var(--accent-custom, #0067C0);
  --text-on-accent: #FFFFFF;
}
"""


def test_parse_blocks_reads_both_themes_and_unwraps_var_fallback():
    dark, light = parse_blocks(FIXTURE)
    assert dark["--bg-content"] == "#232428"
    assert light["--bg-content"] == "#FFFFFF"
    assert dark["--accent"] == "#4CC2FF"        # fallback inside var() is used
    assert light["--accent"] == "#0067C0"


def test_contrast_matches_known_values():
    assert round(contrast("#FFFFFF", "#000000"), 1) == 21.0
    assert round(contrast("#E7E8EA", "#232428"), 1) >= 12.0


def test_check_passes_on_spec_tokens():
    failures = check(FIXTURE)
    assert failures == []


def test_check_fails_when_tertiary_is_too_dim():
    bad = FIXTURE.replace("--text-tertiary: #74777F;", "--text-tertiary: #4A4C52;")
    failures = check(bad)
    assert any("--text-tertiary" in f and "--bg-content" in f for f in failures)


def test_floors_cover_every_spec_pair():
    names = {(fg, bg) for fg, bg, _ in FLOORS}
    assert ("--text-primary", "--bg-content") in names
    assert ("--text-secondary", "--bg-chrome") in names
    assert ("--text-tertiary", "--bg-raised") in names
    assert ("--text-on-accent", "--accent") in names
```

- [ ] **Step 2: Run it to see the import failure**

Run: `py -3 -m pytest tests/test_contrast_check.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.contrast_check'`.

- [ ] **Step 3: Write the checker**

```python
# scripts/contrast_check.py
"""WCAG contrast gate for the FilePlus token set.

Usage:  py -3 scripts/contrast_check.py frontend/src/styles.css
Exit 0 when every pair in FLOORS meets its ratio in both the dark (:root)
and light ([data-theme="light"]) blocks; exit 1 and print the misses otherwise.
Only literal hex values are evaluated; `var(--x, #hex)` uses the fallback hex;
color-mix() and bare var() are skipped.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# (foreground token, background token, minimum ratio) — spec §3.2
FLOORS = [
    ("--text-primary", "--bg-content", 7.0),
    ("--text-secondary", "--bg-content", 4.5),
    ("--text-secondary", "--bg-chrome", 4.5),
    ("--text-tertiary", "--bg-content", 3.0),
    ("--text-tertiary", "--bg-chrome", 3.0),
    ("--text-tertiary", "--bg-raised", 3.0),
    ("--text-on-accent", "--accent", 4.5),
]

_HEX = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b")
_DECL = re.compile(r"(--[a-z0-9-]+)\s*:\s*([^;]+);")


def _block(css: str, selector: str) -> str:
    start = css.index(selector)
    open_brace = css.index("{", start)
    depth, i = 0, open_brace
    while i < len(css):
        if css[i] == "{":
            depth += 1
        elif css[i] == "}":
            depth -= 1
            if depth == 0:
                return css[open_brace + 1:i]
        i += 1
    raise ValueError(f"unterminated block for {selector}")


def _hex_of(value: str) -> str | None:
    m = _HEX.search(value)
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.upper()


def parse_blocks(css: str) -> tuple[dict[str, str], dict[str, str]]:
    """Return (dark, light) maps of token -> #RRGGBB for hex-valued tokens."""
    out = []
    for selector in (":root", '[data-theme="light"]'):
        tokens: dict[str, str] = {}
        for name, value in _DECL.findall(_block(css, selector)):
            h = _hex_of(value)
            if h:
                tokens[name] = h
        out.append(tokens)
    dark, light = out
    # light inherits anything it does not redefine
    merged_light = {**dark, **light}
    return dark, merged_light


def _lum(hex_color: str) -> float:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))

    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(fg: str, bg: str) -> float:
    l1, l2 = sorted((_lum(fg), _lum(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def check(css: str) -> list[str]:
    failures: list[str] = []
    for theme, tokens in zip(("dark", "light"), parse_blocks(css)):
        for fg, bg, floor in FLOORS:
            if fg not in tokens or bg not in tokens:
                failures.append(f"{theme}: {fg} or {bg} has no literal hex value")
                continue
            ratio = contrast(tokens[fg], tokens[bg])
            if ratio < floor:
                failures.append(
                    f"{theme}: {fg} {tokens[fg]} on {bg} {tokens[bg]} = {ratio:.2f}:1 (floor {floor}:1)"
                )
    return failures


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    css = Path(argv[1]).read_text(encoding="utf-8")
    failures = check(css)
    if failures:
        print("contrast_check: FAIL")
        for f in failures:
            print("  " + f)
        return 1
    print("contrast_check: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run the checker tests**

Run: `py -3 -m pytest tests/test_contrast_check.py -q` → Expected `5 passed`.

- [ ] **Step 5: Rewrite the token blocks**

Replace everything from the line `:root {` (line 15) through the closing `}` of the `[data-theme="light"]` block (line 228) with the following. Keep the file header comment above it but change its personality lines to: `Personality: Tool, not toy. Neutral greys, hairline borders, flat surfaces, one fixed blue accent. Segoe UI Variable throughout. Motion confirms causality, never decorates.` and the fonts comment to `Fonts: Segoe UI Variable (system). No webfonts, no monospace face; data uses tabular figures.`

```css
:root {
  /* ---------- Surfaces (neutral ramp, board C) ---------- */
  --bg-backdrop: #1C1D20;
  --bg-chrome:   #1C1D20;
  --bg-content:  #232428;
  --bg-raised:   #2B2C31;
  --bg-pressed:  #33353B;

  /* ---------- Accent (fixed blue; --accent-custom overrides) ---------- */
  --accent-custom: ;
  --accent:             var(--accent-custom, #4CC2FF);
  --accent-hover:       #6DCFFF;
  --accent-press:       #2FB3F5;
  --accent-wash:        color-mix(in srgb, var(--accent) 12%, transparent);
  --accent-wash-strong: color-mix(in srgb, var(--accent) 20%, transparent);
  --accent-edge:        color-mix(in srgb, var(--accent) 40%, transparent);
  --accent-edge-strong: color-mix(in srgb, var(--accent) 55%, transparent);

  /* ---------- Text ---------- */
  --text-primary:   #E7E8EA;
  --text-secondary: #A0A3AA;
  --text-tertiary:  #74777F;
  --text-on-accent: #062033;
  --text-on-good:   #0B2A14;
  --text-on-bad:    #2B0A0A;

  /* ---------- Semantic ---------- */
  --good:      #7DD48F;
  --good-wash: color-mix(in srgb, var(--good) 10%, transparent);
  --good-edge: color-mix(in srgb, var(--good) 40%, transparent);
  --bad:       #EF8A8A;
  --bad-wash:  color-mix(in srgb, var(--bad) 10%, transparent);
  --bad-edge:  color-mix(in srgb, var(--bad) 40%, transparent);
  --warn:      #E6C465;
  --warn-rgb:  230 196 101;
  --warn-wash: color-mix(in srgb, var(--warn) 10%, transparent);
  --warn-edge: color-mix(in srgb, var(--warn) 40%, transparent);

  /* ---------- Borders (solid, so they read the same over Mica) ---------- */
  --border-hairline: #2F3136;
  --border-subtle:   #35373D;
  --border-mid:      #3C3E45;
  --border-strong:   #4A4D55;

  /* ---------- Elevation: flat. Borders do the work; overlays get one soft shadow ---------- */
  --highlight-top:        none;
  --highlight-top-strong: none;
  --depth-bottom:         none;
  --inset-recess:         none;
  --inset-recess-strong:  none;
  --pressed-shadow:       none;
  --shadow-raised:  0 0 0 1px var(--border-subtle);
  --shadow-card:    0 0 0 1px var(--border-subtle);
  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.30);
  --shadow-modal:   0 16px 48px rgba(0, 0, 0, 0.40);
  --shadow-window:  none;

  /* ---------- Fonts ---------- */
  --font-ui:   'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
  --font-data: var(--font-ui);

  /* Size / line-height pairs (unchanged) */
  --t-micro:      10px/14px;
  --t-small:      11px/16px;
  --t-compact:    12px/18px;
  --t-body:       13px/20px;
  --t-read:       14px/22px;
  --t-title-sm:   16px/22px;
  --t-title:      18px/26px;
  --t-display-sm: 22px/30px;
  --t-display:    28px/34px;

  --track-body:    0;
  --track-button:  0;
  --track-display: 0;
  --track-hero:    0;
  --track-caps:    0.06em;
  --track-mono:    0;
  --track-heading: 0;

  /* ---------- Spacing (2px base, unchanged) ---------- */
  --s-2: 2px;  --s-4: 4px;   --s-6: 6px;   --s-8: 8px;   --s-10: 10px;
  --s-12: 12px; --s-14: 14px; --s-16: 16px; --s-20: 20px; --s-24: 24px;
  --s-32: 32px; --s-40: 40px; --s-48: 48px; --s-64: 64px;

  /* ---------- Radii ---------- */
  --r-sm:       3px;
  --r-chip:     3px;
  --r-icon-btn: 4px;
  --r-button:   4px;
  --r-card:     6px;
  --r-modal:    8px;
  --r-window:   8px;
  --r-tray:     8px;
  --r-pill:     999px;

  /* ---------- Motion (unchanged) ---------- */
  --dur-flash:      60ms;
  --dur-press-down: 50ms;
  --dur-press-up:   80ms;
  --dur-fast:       120ms;
  --dur-slide:      180ms;
  --dur-pulse:      400ms;
  --dur-info:       1500ms;

  --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
  --ease-snap: cubic-bezier(0.4, 0.0, 0.2, 1);
  --ease-ui:   cubic-bezier(0.4, 0, 0.2, 1);

  /* ---------- Density (unchanged) ---------- */
  --row-compact:     22px;
  --row-default:     26px;
  --row-comfortable: 32px;
  --row-height:      var(--row-default);

  --sidebar-item-h:  28px;

  /* ---------- Component dimensions (unchanged) ---------- */
  --h-titlebar:     32px;
  --h-toolbar:      48px;
  --h-statusbar:    24px;
  --h-button:       28px;
  --h-button-lg:    36px;
  --h-button-sm:    24px;
  --h-input:        30px;
  --h-chip:         20px;
  --h-pill:         20px;
  --h-badge:        18px;
  --h-approvals:    30px;

  --w-sidebar:           240px;
  --w-sidebar-collapsed: 52px;
}

[data-theme="light"] {
  --bg-backdrop: #F4F4F5;
  --bg-chrome:   #F4F4F5;
  --bg-content:  #FFFFFF;
  --bg-raised:   #EBEBED;
  --bg-pressed:  #E0E0E3;

  --accent:             var(--accent-custom, #0067C0);
  --accent-hover:       #0A74D1;
  --accent-press:       #005AA8;
  --accent-wash:        color-mix(in srgb, var(--accent) 10%, transparent);
  --accent-wash-strong: color-mix(in srgb, var(--accent) 16%, transparent);

  --text-primary:   #1D1E21;
  --text-secondary: #5F6168;
  --text-tertiary:  #8E9097;
  --text-on-accent: #FFFFFF;
  --text-on-good:   #FFFFFF;
  --text-on-bad:    #FFFFFF;

  --good: #218A3A;
  --bad:  #C73B3B;
  --warn: #946200;
  --warn-rgb: 148 98 0;

  --border-hairline: #E2E2E5;
  --border-subtle:   #D8D9DD;
  --border-mid:      #CFD0D4;
  --border-strong:   #BFC0C5;

  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.14);
  --shadow-modal:   0 16px 48px rgba(0, 0, 0, 0.20);
}
```

Then, in the base rules just below: change `html, body { … font-weight: 500; … }` to `font-weight: 400;` and change `code, kbd, pre, .mono { font-family: var(--font-mono); letter-spacing: var(--track-mono); }` to `code, kbd, pre, .mono { font-family: var(--font-data); font-variant-numeric: tabular-nums; letter-spacing: 0; }`.

- [ ] **Step 6: Run the checker against the real stylesheet**

Run: `py -3 scripts/contrast_check.py frontend/src/styles.css` → Expected `contrast_check: ok`, exit 0.

- [ ] **Step 7: Hook the checker into verify**

In `scripts/verify.ps1`, immediately after the pytest stage's `if ($LASTEXITCODE -ne 0) { ... exit 1 }` add:

```powershell
Write-Host '== contrast ==' -ForegroundColor Cyan
py -3 scripts/contrast_check.py frontend/src/styles.css
if ($LASTEXITCODE -ne 0) { Write-Host 'contrast check failed' -ForegroundColor Red; exit 1 }
```
Renumber the stage headers to `1/4`, `2/4`, `3/4`, `4/4`.

- [ ] **Step 8: Verify, look, commit**

Run verify (expect `53 passed`, `contrast_check: ok`, `2 passed`, all green). Open `artifacts/screenshots/home.png` and `browser.png`: surfaces must be neutral grey, accent blue, text legible; some controls may still show stray bevels (fixed in Tasks 3–5). If any screen is unreadable, stop and report.

```bash
git add frontend/src/styles.css scripts/contrast_check.py tests/test_contrast_check.py scripts/verify.ps1
git -c core.safecrlf=false commit -m "style(tokens): board C token set — neutral greys, fixed blue accent, Segoe UI Variable, flat elevation; add contrast gate

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Remove the glow feature

**Files:**
- Modify: `frontend/src/styles.css` (every rule referencing `glow`, the `[data-accent-glow]` blocks, the glow lines inside `@media (prefers-reduced-motion: reduce)` near line 5345)
- Modify: `frontend/index.html` (the accent-glow toggle around line 2275, the `#E8965E` placeholder)
- Modify: `frontend/src/app.js` (`applyAccentGlow`, its call in `restoreSettings`, the `change` handler branch near line 1774, the `IN_SCOPE_ACTIONS` entry `settings-set-accent-glow`, `DEFAULT_ACCENT`, the hex error message text)

**Interfaces:**
- Consumes: Task 1 token set (glow tokens are already gone from `:root`).
- Produces: zero `glow` references in the three frontend files.

- [ ] **Step 1: Measure**

Run (from worktree root): `grep -c "glow" frontend/src/styles.css frontend/index.html frontend/src/app.js`
Expected: styles.css ≈ 129, index.html ≥ 1, app.js ≥ 8. Record the numbers in your report.

- [ ] **Step 2: styles.css**

Delete every rule block whose selector contains `[data-accent-glow]` (38 selectors). For every remaining declaration that references a glow token (`var(--glow-…)`, `var(--accent-glow…)`, `var(--accent-core)`), remove that declaration; if the declaration is a `box-shadow`/`filter` list that also contains non-glow values, keep the non-glow values. Delete the `--glow-*: none;` lines inside the reduced-motion media block; if that block becomes empty, delete the block. Delete the "Glow design tokens" comment paragraphs if any remain.

- [ ] **Step 3: index.html**

Remove the settings row containing `<input type="checkbox" id="settings-accent-glow" …>` (the whole `label`/row element that wraps it, so no orphaned label text remains). Change the accent hex placeholder `e.g. #E8965E` to `e.g. #4CC2FF`.

- [ ] **Step 4: app.js**

Delete `applyAccentGlow()`; delete the `savedGlow` lines in `restoreSettings()` and replace them with `localStorage.removeItem('fp-accent-glow');` (one-time purge, comment `// Stage 1: glow feature removed`). Delete the `settings-set-accent-glow` branch in the `change` listener and its entry in `IN_SCOPE_ACTIONS`. Set `const DEFAULT_ACCENT = '#4CC2FF';` and change the error text to `Enter a valid hex color (e.g. #4CC2FF or #abc).`

- [ ] **Step 5: Gate and verify**

Run: `grep -c "glow" frontend/src/styles.css frontend/index.html frontend/src/app.js` → Expected `0` for all three (grep prints `0` with exit 1; that is the pass condition).
Run: `grep -c "E8965E" frontend/index.html frontend/src/app.js` → Expected `0`, `0`.
Run verify → all green. Check `settings.png`: the Personalization pane has no glow row and no blank gap where it was.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles.css frontend/index.html frontend/src/app.js
git -c core.safecrlf=false commit -m "style: remove the accent glow feature (tokens, rules, settings toggle, handlers)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Flatten sweep

**Files:**
- Modify: `frontend/src/styles.css` (whole file, outside the token block)

**Interfaces:**
- Consumes: Task 1 (`--font-data`, effect tokens = `none`).
- Produces: zero references to the dead effect tokens, gradients, hardcoded bevels, amber literals and `--font-mono`.

- [ ] **Step 1: Measure**

Run and record:
```bash
grep -c "var(--highlight-top" frontend/src/styles.css      # ≈49
grep -c "var(--inset-recess" frontend/src/styles.css       # ≈28
grep -c "var(--depth-bottom)" frontend/src/styles.css      # ≈1
grep -c "var(--pressed-shadow)" frontend/src/styles.css    # ≈4
grep -c "linear-gradient(" frontend/src/styles.css         # ≈16
grep -c "inset 0 1px 0 rgba" frontend/src/styles.css       # ≈5
grep -c "var(--font-mono)" frontend/src/styles.css         # ≈38
grep -ci "E8965E\|F0A574\|D88248\|rgba(232, 150, 94" frontend/src/styles.css  # ≈8
```

- [ ] **Step 2: Apply the rules**

Work through the file top to bottom, one rule at a time:
1. `box-shadow` lists: remove every `var(--highlight-top…)`, `var(--inset-recess…)`, `var(--depth-bottom)`, `var(--pressed-shadow)` item and every hardcoded `inset 0 1px 0 rgba(...)` / `inset 0 -1px 0 rgba(...)` item. If the list becomes empty, delete the declaration (do not write `box-shadow: none` unless it overrides an inherited shadow). Keep `var(--shadow-raised)`, `var(--shadow-card)`, `var(--shadow-popover)`, `var(--shadow-modal)` items as they are.
2. `background: linear-gradient(...)` used for shading a control → replace with the flat fill the gradient was approximating: chrome/controls → `var(--bg-raised)`; pressed → `var(--bg-pressed)`; accent buttons → `var(--accent)`. Gradients that are masks or fades for scroll edges (`mask-image`, `-webkit-mask-image`, the breadcrumb "cave" fade, the tab-overflow fade) are **kept**; list each kept one in your report with its line.
3. `var(--font-mono)` → `var(--font-data)` everywhere; where the rule does not already inherit tabular figures, add `font-variant-numeric: tabular-nums;`.
4. Amber literals: `#E8965E` → `var(--accent)`; `#F0A574` → `var(--accent-hover)`; `#D88248` → `var(--accent-press)`; `rgba(232, 150, 94, 0.10)` → `var(--accent-wash)`; `…0.18)` → `var(--accent-wash-strong)`; `…0.40)` → `var(--accent-edge)`; `…0.55)` → `var(--accent-edge-strong)`; any other alpha → the nearest of those four (say which in the report).
5. `filter: drop-shadow(...)` chains that imitate bevels or halos (not the ones that draw a real overlay shadow) → delete.
6. Do not touch any dimensional property (Global Constraints).

- [ ] **Step 3: Gate**

Every count from Step 1 must now be `0` except `linear-gradient(` which may equal the number of kept mask/fade gradients you listed. Run verify → all green. Compare `home.png` / `browser.png` / `settings.png` to the previous task's screenshots: controls flat, no bright top edges, no dark inner recesses.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git -c core.safecrlf=false commit -m "style: flatten sweep — drop bevel/recess chains, shading gradients, amber literals; font-mono -> font-data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Component treatment — controls

**Files:**
- Modify: `frontend/src/styles.css` — the blocks for `.fp-btn` / `.fp-button*` / `.fp-icon-btn` / `.fp-circle-btn`, `.fp-input` / `.fp-search` / `.fp-select`, `.fp-segmented*`, `.fp-toggle*`, `.fp-checkbox*`, `.fp-radio*`, `.fp-slider*`, `.fp-chip*` / `.fp-chip-group`, `.fp-badge*`, `.fp-pill*`, `.fp-approvals*`, `.fp-kbd*`, `.fp-state-dot*`, `.fp-progress*`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: each control family matches the spec §4 row for it.

- [ ] **Step 1: For each family, bring it to its spec §4 treatment**

Apply exactly these treatments (spec §4), touching only colour, border, shadow, outline and radius declarations:

| Family | Default | Hover | Active / on | Focus-visible |
|---|---|---|---|---|
| Button default | `background: var(--bg-raised); border: 1px solid var(--border-subtle); color: var(--text-primary); box-shadow: none` | `background: var(--bg-pressed)` | `background: var(--bg-pressed); border-color: var(--border-mid)` | `outline: 1px solid var(--accent); outline-offset: 1px` |
| Button primary | `background: var(--accent); color: var(--text-on-accent); border: 0` | `background: var(--accent-hover)` | `background: var(--accent-press)` | same |
| Button ghost / icon / circle | `background: transparent; border: 0; color: var(--text-secondary)` | `background: var(--bg-raised); color: var(--text-primary)` | `background: var(--bg-pressed)` | same |
| Input / search / select | `background: var(--bg-raised); border: 1px solid var(--border-subtle); color: var(--text-primary); box-shadow: none`; placeholder `var(--text-tertiary)` | — | focus: `border-color: var(--accent); outline: none` | — |
| Segmented | track `background: var(--bg-raised); border: 1px solid var(--border-subtle)`; option `color: var(--text-tertiary)` | option `color: var(--text-secondary)` | active option `background: var(--bg-content); color: var(--text-primary); box-shadow: none` (keep any sliding-pill transform, drop its shadow) | outline as buttons |
| Toggle / checkbox / radio | off `background: var(--bg-raised); border: 1px solid var(--border-mid)` | — | on `background: var(--accent); border-color: var(--accent)`; thumb/check/dot `var(--text-on-accent)`; no inner shadows | outline as buttons |
| Slider | track `var(--bg-raised)`; fill `var(--accent)`; thumb `background: var(--text-primary); border: 1px solid var(--border-strong); box-shadow: none` | — | — | outline on thumb |
| Chip | `background: transparent; border: 1px solid var(--border-strong); color: var(--text-secondary); border-radius: var(--r-chip)` | `background: var(--bg-raised)` | tinted: `background: var(--accent-wash); border-color: var(--accent-edge); color: var(--accent)`; semantic variants: `-wash` / `-edge` / base | — |
| Badge / pill / approvals pill | `background: var(--accent-wash); color: var(--accent); border: 0; border-radius: var(--r-pill)` | — | — | — |
| Kbd | `border: 1px solid var(--border-strong); color: var(--text-tertiary); background: transparent; border-radius: 3px` | — | — | — |
| State dot | 6px disc, semantic colour, `box-shadow: none` | — | — | — |
| Progress | track `var(--bg-raised)`, fill `var(--accent)`, radius `--r-pill`, no shadow | — | — | — |

- [ ] **Step 2: Verify and inspect**

Run verify → all green. Inspect `settings.png` (Personalization pane has every control type), `home.png`, `browser.png`. Every control flat; primary buttons blue with dark text (dark) / white text (light — check after Task 6 adds light screenshots; for now flip `data-theme="light"` in `index.html` temporarily, run `npm test` in `frontend/` with the backend up to see light screenshots, then revert the attribute before committing).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles.css
git -c core.safecrlf=false commit -m "style(controls): flat treatment for buttons, inputs, segmented, toggles, chips, badges, kbd, dots, progress

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Component treatment — chrome, lists, overlays

**Files:**
- Modify: `frontend/src/styles.css` — `.fp-titlebar*`, `.fp-wc*`, `.fp-tabbar*` / `.fp-tab*` / `.fp-tabs*`, `.fp-toolbar*`, `.fp-breadcrumb*`, `.fp-sidebar*` (incl. `--collapsed`, drive bars, section labels, badge), `.fp-row*`, `.fp-list-header*` / `.list-head*` / `.fp-sortable*`, `#inspector` / `.inspector*`, `.fp-statusbar*`, `.fp-context-menu*` / `.fp-menu*` / `.fp-popover*` / `.fp-tooltip*` / `.fp-palette*`, `.fp-modal*`, `.fp-snackbar*` / `.fp-toast*`, `.fp-error-banner*`, `.fp-empty*` / `.fp-empty-state*`, `.fp-card*` / `.fp-stat-card*`, `.fp-mode-banner*`, `.fp-brand*`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: chrome and lists match spec §4.

- [ ] **Step 1: Apply the spec §4 treatments**

Touch only colour, border, shadow, outline, radius, backdrop-filter and `::before/::after` decoration declarations:

- **Seams:** sidebar `border-right: 1px solid var(--border-hairline)`; toolbar and tab bar `border-bottom: 1px solid var(--border-hairline)`; list header `border-bottom: 1px solid var(--border-hairline)`; status bar `border-top: 1px solid var(--border-hairline)`; inspector `border-left: 1px solid var(--border-hairline)`. Remove any other seam shadows.
- **Titlebar / window controls:** `background: var(--bg-chrome)`; text `var(--text-secondary)`; window-control hover `var(--bg-raised)`; close hover keeps its red (`#C42B1C` at 80% → use `color-mix(in srgb, #C42B1C 80%, transparent)`).
- **Brand mark:** `background: var(--accent)`, glyph `var(--text-on-accent)`, radius 3px, no halo.
- **Sidebar item:** default `color: var(--text-secondary)`; hover `background: var(--bg-raised)`; active `background: var(--bg-raised); color: var(--text-primary)` with the existing left pill element/pseudo-element set to `width: 3px; height: 16px; border-radius: 2px; background: var(--accent)` (keep its centring). Section labels `var(--text-tertiary)`. Drive bar track `var(--bg-raised)`, fill `var(--text-tertiary)`; AI dot `var(--accent)`. Collapsed mode: same colours.
- **Tabs:** inactive `background: transparent; color: var(--text-secondary)`; hover `background: var(--bg-raised)`; active `background: var(--bg-content); color: var(--text-primary); border-radius: 4px 4px 0 0; box-shadow: inset 0 -2px 0 var(--accent)` (replace the existing underline element/pseudo-element treatment with this or recolour it to `var(--accent)` 2px if it is a real element — keep whichever exists, do not add an element). New-tab button ghost treatment. Overflow fade masks stay.
- **Underline tabs (`.fp-tabs`, Home sub-tabs, inspector tabs):** inactive `var(--text-tertiary)`, active `var(--text-primary)` with the sliding indicator `background: var(--accent); height: 2px`, no glow.
- **Toolbar:** `background: var(--bg-chrome)`; breadcrumb crumbs `var(--text-secondary)`, current `var(--text-primary)`, separators `var(--text-tertiary)`; search per Task 4 input treatment.
- **Rows:** default flat, `color: var(--text-primary)`; hover `background: var(--bg-raised)`; selected `background: var(--accent-wash)` with the left bar `2px` `var(--accent)` full height; drag target `background: var(--accent-wash-strong); box-shadow: inset 0 0 0 1px var(--accent-edge)`; ai-filed variant `var(--good-wash)` + `inset 0 0 0 1px var(--good-edge)`; folder icon `var(--accent)`, file icons `var(--text-secondary)`; `.fp-row__size`, `.fp-row__modified` `color: var(--text-secondary)`. Remove any row `highlight-top` leftovers.
- **List header:** `color: var(--text-tertiary)`; `.active`/sorted `var(--text-secondary)`; caret stroke `var(--text-secondary)` (the caret SVGs in `index.html` use `stroke="var(--accent)"` — change those attributes to `var(--text-secondary)`; this is the one `index.html` edit in this task).
- **Inspector:** header `border-bottom: 1px solid var(--border-hairline)`; preview box `background: var(--bg-raised); border: 1px solid var(--border-hairline); border-radius: var(--r-card)`; meta labels `var(--text-tertiary)`.
- **Status bar:** `background: var(--bg-chrome); color: var(--text-secondary)`; pills per badge treatment; backend dot colours by `data-state` (`ok` → `--good`, `checking`/`unknown` → `--warn`, `offline` → `--bad`) with `box-shadow: none`.
- **Context menus / popovers / tooltips / palette:** `background: var(--bg-raised); border: 1px solid var(--border-mid); box-shadow: var(--shadow-popover); border-radius: var(--r-card)`; item hover `var(--bg-pressed)`; remove `backdrop-filter` from these (keep it only on `.fp-modal` scrim and palette scrim).
- **Modal:** `background: var(--bg-content); border: 1px solid var(--border-mid); box-shadow: var(--shadow-modal); border-radius: var(--r-modal)`; scrim `rgba(0,0,0,.45)`, light `rgba(0,0,0,.30)` (put the light value in a `[data-theme="light"] .fp-modal-scrim`-style rule or a token if one exists).
- **Snackbar / toast:** `background: var(--bg-raised); border: 1px solid var(--border-mid); box-shadow: var(--shadow-popover)`; error variant `background: var(--bad-wash); border-color: var(--bad-edge); color: var(--text-primary)`; progress bar `var(--accent)`.
- **Error banner:** `background: var(--bad-wash); border: 1px solid var(--bad-edge)`; icon `var(--bad)`; text `var(--text-primary)`; no highlight.
- **Cards / stat cards / mode banners / empty states:** `background: var(--bg-raised); border: 1px solid var(--border-hairline); border-radius: var(--r-card); box-shadow: none`; empty-state icon `var(--text-tertiary)`.

- [ ] **Step 2: Verify and inspect**

Run verify → all green. Inspect every screenshot: chrome seams are single hairlines, the active sidebar item shows a blue pill, the active tab a blue bottom line, the selected row a blue left bar on a faint blue wash. Placeholder screens (`ftree`, `scan-*`, `review-bin`, `everything`) must simply not look broken.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles.css frontend/index.html
git -c core.safecrlf=false commit -m "style(chrome+lists): hairline seams, accent pill/line/bar model, flat overlays

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Theme mode "system" and light-theme screenshots

**Files:**
- Modify: `frontend/src/app.js` (`toggleTheme`, `applyTheme`, `restoreSettings`)
- Modify: `frontend/main.js` (IPC `set-theme-source`), `frontend/preload.js` (`setThemeSource`)
- Modify: `frontend/test/smoke.spec.js` (light pass)

**Interfaces:**
- Consumes: `applyTheme(theme)` at `app.js` ~line 812; Settings segmented buttons `data-action="settings-set-theme"` with `data-val="dark|light|system"` (already in `index.html` ~2251–2253); `electronAPI` bridge pattern in `preload.js`.
- Produces: `applyTheme('dark'|'light'|'system')`; `electronAPI.setThemeSource(mode)`; `data-theme-mode` attribute; smoke screenshots `home-light.png`, `browser-light.png`, `settings-light.png`.

- [ ] **Step 1: main.js and preload.js**

In `main.js` add `nativeTheme` to the electron import and, next to the other `ipcMain.on` handlers:
```js
ipcMain.on('set-theme-source', (_e, mode) => {
  nativeTheme.themeSource = ['dark', 'light'].includes(mode) ? mode : 'system';
});
```
In `preload.js` add `setThemeSource: (mode) => ipcRenderer.send('set-theme-source', mode),` to the exposed API.

- [ ] **Step 2: app.js**

Replace `toggleTheme` and `applyTheme` with:
```js
const THEME_MODES = ['dark', 'light', 'system'];
const _systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let _systemListenerAttached = false;

function resolveTheme(mode) {
  return mode === 'system' ? (_systemDark.matches ? 'dark' : 'light') : mode;
}

function toggleTheme() {
  const current = localStorage.getItem('fp-theme') || 'system';
  const next = THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
  applyTheme(next);
}

function applyTheme(mode) {
  if (!THEME_MODES.includes(mode)) mode = 'system';
  const html = document.documentElement;
  html.dataset.theme = resolveTheme(mode);
  html.dataset.themeMode = mode;
  localStorage.setItem('fp-theme', mode);
  if (window.electronAPI?.setThemeSource) window.electronAPI.setThemeSource(mode);
  if (mode === 'system' && !_systemListenerAttached) {
    _systemDark.addEventListener('change', () => {
      if ((localStorage.getItem('fp-theme') || 'system') === 'system') applyTheme('system');
    });
    _systemListenerAttached = true;
  }
  document.querySelectorAll('[data-action="settings-set-theme"]').forEach(btn => {
    const v = btn.dataset.theme || btn.dataset.val;
    btn.classList.toggle('active', v === mode);
  });
}
```
In `restoreSettings()` change `const theme = localStorage.getItem('fp-theme'); if (theme) applyTheme(theme);` to `applyTheme(localStorage.getItem('fp-theme') || 'system');`. Confirm the `settings-set-theme` click case passes `btn.dataset.val` (it already handles `dark`/`light`; `system` flows through unchanged).

- [ ] **Step 3: Smoke test light pass**

In `frontend/test/smoke.spec.js`, after the palette screenshot and before the `finally`, add:
```js
    await page.evaluate(() => applyTheme('light'));
    for (const id of ['home', 'browser', 'settings']) {
      await page.evaluate((s) => switchScreen(s), id);
      await page.screenshot({ path: path.join(SHOTS, `${id}-light.png`) });
    }
    await page.evaluate(() => applyTheme('system'));
```

- [ ] **Step 4: Verify**

Run verify → `2 passed`, and `artifacts/screenshots/` now holds 13 PNGs. Open the three `-light.png` files: light greys, blue accent `#0067C0`, white content pane, legible text. Manually: `npm start` in `frontend/`, press the toolbar theme button three times — dark → light → system — and confirm the Settings segmented control follows.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app.js frontend/main.js frontend/preload.js frontend/test/smoke.spec.js
git -c core.safecrlf=false commit -m "feat(theme): follow Windows light/dark by default; toolbar toggle cycles dark/light/system; light-theme smoke screenshots

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Mica behind sidebar and titlebar

**Files:**
- Modify: `frontend/main.js` (BrowserWindow options, `mica-available` IPC), `frontend/preload.js` (`micaAvailable`), `frontend/src/app.js` (set `data-mica`), `frontend/src/styles.css` (transparency rules)

**Interfaces:**
- Consumes: Task 6 (`nativeTheme.themeSource` keeps Mica's tint in step with the app theme).
- Produces: `electronAPI.micaAvailable(): boolean`; `html[data-mica="on"]`.

- [ ] **Step 1: main.js**

In `createWindow()` change `backgroundColor: '#181522'` to `backgroundColor: '#00000000'` and add `backgroundMaterial: 'mica',` to the `BrowserWindow` options. Add near the top:
```js
// Mica needs Windows 11 22H2 (build 22621). Elsewhere Electron ignores the option
// and the renderer paints solid --bg-chrome.
const MICA_AVAILABLE = process.platform === 'win32' && Number(os.release().split('.')[2] || 0) >= 22621;
```
and next to `get-hostname`: `ipcMain.on('mica-available', (event) => { event.returnValue = MICA_AVAILABLE; });`

- [ ] **Step 2: preload.js**

Add `micaAvailable: () => ipcRenderer.sendSync('mica-available'),`.

- [ ] **Step 3: app.js**

At the top of `restoreSettings()` (before `applyTheme`), add:
```js
  if (window.electronAPI?.micaAvailable?.()) document.documentElement.dataset.mica = 'on';
```

- [ ] **Step 4: styles.css**

After the base `html, body { … }` rule add:
```css
/* Mica: on Windows 11 the OS paints the desktop-tinted material behind the window;
   only the titlebar and sidebar let it through. Everything else stays solid. */
html[data-mica="on"],
html[data-mica="on"] body { background: transparent; }
html[data-mica="on"] .fp-titlebar,
html[data-mica="on"] .fp-sidebar { background: transparent; }
```
Confirm `.shell`/`.main`/`.content`/`.fp-tabbar`/`.fp-toolbar`/`.fp-statusbar` each paint their own solid background (add `background: var(--bg-chrome)` or `var(--bg-content)` where a container relied on the body colour).

- [ ] **Step 5: Verify**

Run verify → all green, still zero console errors. Then `npm start`: the sidebar and titlebar show the desktop-tinted Mica material; the content pane, toolbar, tab bar and status bar are solid; text on the sidebar stays legible in both themes (switch with the toolbar toggle). If Mica does not render on this machine, the sidebar must still look exactly like `sidebar` in the screenshots (solid `--bg-chrome`) — that is the fallback working, not a failure; note it in the report.

- [ ] **Step 6: Commit**

```bash
git add frontend/main.js frontend/preload.js frontend/src/app.js frontend/src/styles.css
git -c core.safecrlf=false commit -m "feat(chrome): Mica behind titlebar and sidebar on Windows 11 with solid fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Gates, docs, run summary

**Files:**
- Modify: `CLAUDE.md` (Frontend traps bullet), `docs/UI-SPEC.md` (§A.0)
- Create: `docs/superpowers/runs/<today>-stage-1.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the merge-review document.

- [ ] **Step 1: Grep gates (all must print 0 or nothing)**

```bash
grep -c "glow\|highlight-top\|inset-recess\|depth-bottom\|pressed-shadow\|inset 0 1px 0 rgba\|font-mono\|JetBrains" frontend/src/styles.css
grep -ci "E8965E\|F0A574\|D88248\|rgba(232, 150, 94" frontend/src/styles.css frontend/index.html frontend/src/app.js
grep -c "glow" frontend/index.html frontend/src/app.js
grep -n "Inter" frontend/src/styles.css
grep -n "font-family=\"Inter" frontend/index.html
```
For the last two: `styles.css` must have no `Inter`; in `index.html` any SVG `font-family="Inter,…"` attribute becomes `font-family="Segoe UI Variable Text, Segoe UI, sans-serif"`. Fix and re-run until clean. `linear-gradient(` may remain only for the mask/fade cases listed in Task 3's report.

- [ ] **Step 2: Docs**

`CLAUDE.md`: replace the bullet beginning "Repeating visual treatments become tokens" with: "Elevation is flat: borders (`--border-*`) do the work, overlays get one soft shadow (`--shadow-popover`/`--shadow-modal`), nothing else casts or insets. Repeating treatments become tokens in `:root`; accent-derived colours use `color-mix(... var(--accent) ...)`, never hardcoded rgba. Style spec: `docs/superpowers/specs/2026-09-10-stage-1-redesign-design.md` §3–§4."
`docs/UI-SPEC.md`: replace the body of section A.0 with two sentences: "Visual style is specified in `superpowers/specs/2026-09-10-stage-1-redesign-design.md` (§3 tokens, §4 component treatments). This document specifies layout, sizing, density and behaviour only."

- [ ] **Step 3: Run summary**

Run verify one last time; `ls artifacts/screenshots` (expect 13). Write `docs/superpowers/runs/<today>-stage-1.md` with: branch/base/date/plan/verify line; "What landed" from `git log master..HEAD --oneline --reverse`; "What was skipped and why"; "Rulings made by the controller" (the controller supplies the list at dispatch); "Known debts (deferred to Stage 2)"; "How to review" (switch to the branch, run verify, open the 13 screenshots, run `npm start` and toggle the theme three times, check Mica; merge in two commands). No angle-bracket placeholders.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/UI-SPEC.md docs/superpowers/runs/
git -c core.safecrlf=false commit -m "docs: Stage 1 gates, style pointer in UI-SPEC, run summary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- **Spec coverage.** §3.1–3.4 tokens → T1. §3.5 removals → T2 (glow), T3 (bevels, gradients, amber, font-mono). §4 component model → T4 (controls), T5 (chrome/lists/overlays). §5 Mica → T7; theme → T6. §6 contrast gate → T1; grep gates → T8; smoke light pass → T6; CLAUDE.md and UI-SPEC → T8; run summary → T8. §7 out-of-scope is enforced by Global Constraints.
- **Placeholders.** `<today>` in T8 paths is filled at execution; the summary template's fields are enumerated. No TBDs.
- **Type consistency.** `applyTheme(mode)` with `THEME_MODES` in T6 matches the smoke test calls `applyTheme('light')` / `applyTheme('system')`. `electronAPI.setThemeSource` (T6) and `electronAPI.micaAvailable` (T7) are defined in `preload.js` before `app.js` uses them. `--font-data` is defined in T1 before T3 substitutes it. `FLOORS` tuple shape `(fg, bg, ratio)` is consistent between checker and test. verify.ps1 stage count `1/4…4/4` after T1.
