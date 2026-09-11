# Stage 1 — Redesign (one system pass) — Design Spec

**Date:** 2026-09-10
**Status:** Approved direction (roadmap D5–D8, plus the three Stage 1 decisions below). Author chose to run Stage 1 end to end without a separate spec review gate; this spec is still the binding contract for the run.
**Parent:** `docs/superpowers/specs/2026-09-10-fileplus-roadmap-design.md` §5 "Stage 1", §9.
**Reference mockup:** design canvas https://claude.ai/code/artifact/9a6b4309-d4af-4e45-b894-120156066a94 — board **C · Blend — chosen**, and its token sheet. The generator that produced it is the ground truth for values: `scratchpad/design/gen.mjs` direction `C` (values copied into §3 below so this spec stands alone).

---

## 1. Goal and budget

Replace the April 2026 skin (warm purple base, amber accent, tactile bevels and glows, Inter + JetBrains Mono) with board C: neutral greys, hairline borders, flat surfaces, a fixed blue accent, Segoe UI Variable throughout. **Layout, sizing, spacing and density do not change** (roadmap D7). **One autonomous run, one author review, then Stage 2 starts regardless** (D6). Corrections from that review queue as Stage 2 debts unless they are contrast or breakage bugs.

## 2. Decisions fixed for Stage 1 (author, 2026-09-10)

| # | Decision | Choice |
|---|---|---|
| S1-1 | Accent source | **Fixed blue from board C** (`#4CC2FF` dark, `#0067C0` light). The existing `--accent-custom` override in Settings → Personalization stays as the escape hatch. Windows system accent is **not** read. |
| S1-2 | Mica | **Yes, Mica behind the sidebar and titlebar** on Windows 11 (Electron `backgroundMaterial: 'mica'`), with a solid `--bg-chrome` fallback wherever Mica is unavailable. Content area, toolbar, tab bar and status bar stay solid. |
| S1-3 | Default theme | **Follow Windows light/dark** and switch live. The manual toggle overrides; a third "System" option appears in Settings. When the user forces a theme, Electron's `nativeTheme.themeSource` is set to match so the Mica tint agrees with the app. |
| S1-4 | Typeface | **Segoe UI Variable throughout** (author's pick: board C with A's typeface). No monospace face. Data columns use `font-variant-numeric: tabular-nums`. |

## 3. Token set (the whole of the visual change lives here first)

Token **names** stay as they are in `frontend/src/styles.css` so the 5,300-line stylesheet keeps resolving; only **values** change, plus the removals in §3.5. New names are introduced only where a concept did not exist (`--font-data`, `--accent-fg`, the theme/mica attributes).

### 3.1 Surfaces and borders

| Token | Dark | Light |
|---|---|---|
| `--bg-backdrop` | `#1C1D20` | `#F4F4F5` |
| `--bg-chrome` | `#1C1D20` | `#F4F4F5` |
| `--bg-content` | `#232428` | `#FFFFFF` |
| `--bg-raised` | `#2B2C31` | `#EBEBED` |
| `--bg-pressed` | `#33353B` | `#E0E0E3` |
| `--border-hairline` | `#2F3136` | `#E2E2E5` |
| `--border-subtle` | `#35373D` | `#D8D9DD` |
| `--border-mid` | `#3C3E45` | `#CFD0D4` |
| `--border-strong` | `#4A4D55` | `#BFC0C5` |

Borders become **solid hex**, not white/black alphas, so they render identically over Mica and over solid surfaces.

### 3.2 Text

| Token | Dark | Light |
|---|---|---|
| `--text-primary` | `#E7E8EA` | `#1D1E21` |
| `--text-secondary` | `#A0A3AA` | `#5F6168` |
| `--text-tertiary` | `#74777F` | `#82848B` |
| `--text-on-accent` | `#062033` | `#FFFFFF` |
| `--text-on-good` | `#0B2A14` | `#FFFFFF` |
| `--text-on-bad` | `#2B0A0A` | `#FFFFFF` |

Contrast floors (checked by `scripts/contrast_check.py`, §6): primary ≥ 7:1 on `--bg-content`; secondary ≥ 4.5:1 on `--bg-content` and `--bg-chrome`; tertiary ≥ 3:1 on `--bg-content`, `--bg-chrome` and `--bg-raised`; `--text-on-accent` ≥ 4.5:1 on `--accent`. (#8E9097 from board C failed the 3:1 floor on light chrome; corrected during Task 1.)

### 3.3 Accent and semantic

| Token | Dark | Light |
|---|---|---|
| `--accent` | `var(--accent-custom, #4CC2FF)` | `var(--accent-custom, #0067C0)` |
| `--accent-hover` | `#6DCFFF` | `#0A74D1` |
| `--accent-press` | `#2FB3F5` | `#005AA8` |
| `--accent-wash` | `color-mix(in srgb, var(--accent) 12%, transparent)` | `color-mix(in srgb, var(--accent) 10%, transparent)` |
| `--accent-wash-strong` | `color-mix(in srgb, var(--accent) 20%, transparent)` | `color-mix(in srgb, var(--accent) 16%, transparent)` |
| `--accent-edge` | `color-mix(in srgb, var(--accent) 40%, transparent)` | same |
| `--accent-edge-strong` | `color-mix(in srgb, var(--accent) 55%, transparent)` | same |
| `--good` / `--good-wash` / `--good-edge` | `#7DD48F` / 10% mix / 40% mix | `#218A3A` / same |
| `--bad` / `--bad-wash` / `--bad-edge` | `#EF8A8A` / 10% / 40% | `#C73B3B` / same |
| `--warn` / `--warn-wash` / `--warn-edge` | `#E6C465` / 10% / 40% | `#946200` / same |
| `--warn-rgb` | `230 196 101` | `148 98 0` |

`--accent-custom` is NOT declared in `:root` — an empty declaration (`--accent-custom: ;`) is a valid empty value and would make `var(--accent-custom, #hex)` resolve to nothing. The Settings override defines it at runtime via `style.setProperty`.

Wash/edge tokens move to `color-mix` on the base token so a custom accent recolours them (this was already the rule for glow; it becomes the rule for everything).

### 3.4 Typography, radii, elevation

- `--font-ui: 'Segoe UI Variable Text', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;`
- `--font-data: var(--font-ui);` **new.** `code, kbd, pre, .mono` switch to `font-family: var(--font-data); font-variant-numeric: tabular-nums;`. `--font-mono` is **deleted**; every `var(--font-mono)` becomes `var(--font-data)`.
- Body weight `400` (was 500). Headings and emphasised labels `600`. All `--track-*` become `0` except `--track-caps: 0.06em`. Size/line-height pairs unchanged.
- Radii: `--r-chip: 3px; --r-icon-btn: 4px; --r-button: 4px; --r-card: 6px; --r-modal: 8px; --r-window: 8px; --r-tray: 8px; --r-pill: 999px; --r-sm: 3px`.
- Elevation model, **flat**: `--highlight-top`, `--highlight-top-strong`, `--depth-bottom`, `--inset-recess`, `--inset-recess-strong`, `--pressed-shadow` all become `none`. `--shadow-raised` and `--shadow-card` become `0 0 0 1px var(--border-subtle)` (a border, not a shadow). Overlays keep one soft shadow each: `--shadow-popover: 0 8px 24px rgba(0,0,0,.30)` dark / `.14` light; `--shadow-modal: 0 16px 48px rgba(0,0,0,.40)` dark / `.20` light; `--shadow-window: none`.

### 3.5 Removals

- All glow tokens: `--accent-glow`, `--accent-glow-strong`, `--accent-core`, `--glow-sm/md/lg`, `--glow-filter-sm/md/lg`, `--glow-blade-sm/md`, and the `[data-accent-glow]` rule block, and the `prefers-reduced-motion` overrides that exist only to zero them.
- The Settings → Personalization "accent glow" toggle (`#settings-accent-glow`), `applyAccentGlow()` in `app.js`, its click handler, its `IN_SCOPE_ACTIONS` entry, and the `fp-accent-glow` localStorage key (purged on startup).
- Every hardcoded amber literal (`#E8965E`, `#F0A574`, `#D88248`, `rgba(232, 150, 94, …)`), every `linear-gradient(` used for chrome shading, and every hardcoded `inset 0 1px 0 rgba(...)` bevel outside the token block. Gate: grep counts reach zero (§6).

## 4. Component model (how the tokens are applied)

The sizing of every component is unchanged. This section fixes the *treatment*.

| Component | Treatment |
|---|---|
| Surfaces | Window/sidebar/titlebar `--bg-chrome` (transparent over Mica, §5). Tab bar, toolbar, status bar `--bg-chrome` solid. Content `--bg-content`. Seams are 1px `--border-hairline`: sidebar right, toolbar bottom, tab bar bottom, list header bottom, status bar top, inspector left. |
| Buttons | Default: `--bg-raised` fill + 1px `--border-subtle`, no shadow. Hover `--bg-pressed`. Active/pressed: `--bg-pressed` + `--border-mid`. Primary: `--accent` fill, `--text-on-accent`, no border; hover `--accent-hover`; press `--accent-press`. Ghost: transparent, hover `--bg-raised`. Icon buttons same as ghost. Focus-visible: `outline: 1px solid var(--accent); outline-offset: 1px`. |
| Inputs / search | `--bg-raised` fill, 1px `--border-subtle`; focus: border `--accent`, no ring, no inset. Placeholder `--text-tertiary`. |
| Segmented | Track `--bg-raised` + 1px `--border-subtle`; active option `--bg-content` fill + `--text-primary`; no sliding pill shadow. |
| Toggle / checkbox / radio / slider | Off: `--bg-raised` + `--border-mid`. On: `--accent` fill, thumb/check `--text-on-accent`. No inner shadows. Slider track `--bg-raised`, fill `--accent`, thumb `--text-primary`-coloured disc with 1px `--border-strong`. |
| Chips / badges / pills | Chip: transparent, 1px `--border-strong`, text `--text-secondary`, radius `--r-chip`. Tinted chip: `--accent-wash` fill, `--accent-edge` border, `--accent` text. Semantic variants use their `-wash`/`-edge`/base. Badge (counts): `--accent-wash` fill, `--accent` text, `--r-pill`. |
| Sidebar item | Default text `--text-secondary`. Hover `--bg-raised`. Active: `--bg-raised` + `--text-primary` + a **3×16px `--accent` pill** centred on the left edge (radius 2px). Section labels `--text-tertiary`, 11px. Drive usage bar: 2px track `--bg-raised`, fill `--text-tertiary`; AI dot `--accent`. |
| Tabs (tab bar) | Inactive: transparent, `--text-secondary`. Hover `--bg-raised`. Active: `--bg-content` fill, `--text-primary`, **2px `--accent` line along the bottom edge**, radius `4px 4px 0 0`. |
| File rows | Flat. Hover `--bg-raised`. Selected: `--accent-wash` fill + **2px `--accent` bar on the left edge** (full row height). Drag target: `--accent-wash-strong` + 1px `--accent-edge` inset border. Folder icon `--accent`, file icons `--text-secondary`. Size/modified columns `--text-secondary`, `font-variant-numeric: tabular-nums`. |
| List header | 11px `--text-tertiary`; sorted column `--text-secondary`; caret `--text-secondary` (not accent). |
| Breadcrumb | `--text-secondary`, current crumb `--text-primary`, middot separators `--text-tertiary`. |
| Inspector | Header 40px with 1px `--border-hairline` below; tabs underline style: active tab `--text-primary` + 2px `--accent` line; preview box `--bg-raised` + 1px `--border-hairline`, radius `--r-card`. |
| Status bar | `--text-secondary` 11px; Review Bin pill = badge treatment; backend dot `--good`/`--warn`/`--bad`. |
| Popovers / context menus / palette | `--bg-raised`, 1px `--border-mid`, `--shadow-popover`, radius `--r-card`. Items hover `--bg-pressed`. **No blur** except the modal scrim and palette scrim. |
| Modals | `--bg-content`, 1px `--border-mid`, `--shadow-modal`, radius `--r-modal`. Scrim `rgba(0,0,0,.45)` dark / `.30` light. |
| Snackbar / toast | `--bg-raised`, 1px `--border-mid`, `--shadow-popover`; error variant uses `--bad-wash`/`--bad-edge`/`--bad`. Progress bar `--accent`. |
| Kbd pill / state dot / empty states / error banner | Kbd: 1px `--border-strong`, `--text-tertiary`, radius 3px. State dot: 6px, semantic colour, no halo. Error banner: `--bad-wash` fill, 1px `--bad-edge`, `--bad` icon, `--text-primary` text; no `highlight-top`. |

## 5. Mica and theme plumbing

**Mica (S1-2).** `main.js`: `new BrowserWindow({ ..., backgroundMaterial: 'mica' })` and drop the opaque `backgroundColor` in favour of `'#00000000'` so the material shows; the option is ignored on platforms that lack it. Main computes `micaAvailable = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621` and exposes it through `preload.js` as `electronAPI.micaAvailable()` (sync IPC, same pattern as `hostname()`). `app.js` sets `document.documentElement.dataset.mica = 'on'` when available. CSS: `html[data-mica="on"] body { background: transparent }`, `html[data-mica="on"] .fp-titlebar, html[data-mica="on"] .fp-sidebar { background: transparent }`; every other surface stays solid, so Mica shows only through the titlebar and sidebar. When `data-mica` is absent, nothing changes and `--bg-chrome` paints as today.

**Theme (S1-3).** `applyTheme(mode)` accepts `'dark' | 'light' | 'system'`. `'system'` resolves through `window.matchMedia('(prefers-color-scheme: dark)')`, sets `data-theme` to the resolved value and `data-theme-mode="system"`, and subscribes to `change` once. Default when `localStorage['fp-theme']` is unset: `'system'`. The toolbar sun/moon toggle cycles dark → light → system. Settings segmented control gains a "System" option. Each change also calls `electronAPI.setThemeSource(mode)` → `nativeTheme.themeSource = mode` in main, so Mica's tint follows a forced theme. The `<html data-theme="dark">` attribute in `index.html` stays as the pre-paint default; `restoreSettings()` runs before first paint of the shell content already.

## 6. Verification and done criteria

- `scripts/contrast_check.py` **new**: parses the `:root` and `[data-theme="light"]` blocks of `styles.css` (hex values only; `color-mix` and `var()` skipped), computes WCAG contrast for the pairs in §3.2 and fails non-zero on any floor miss. Run by `scripts/verify.ps1` between pytest and the backend start. Unit test in `tests/test_contrast_check.py` against a fixture block.
- Grep gates (all must be 0 in `frontend/src/styles.css`, `frontend/index.html`, `frontend/src/app.js` unless noted): `glow`, `highlight-top`, `inset-recess`, `depth-bottom`, `pressed-shadow`, `linear-gradient(`, `inset 0 1px 0 rgba`, `E8965E`, `F0A574`, `D88248`, `rgba(232, 150, 94`, `Inter`, `JetBrains`, `font-mono`. (`Inter` may remain inside SVG `font-family` attributes in `index.html` placeholder art only if the tag also lists `Segoe UI` first.)
- Smoke test extended: after the dark pass, `applyTheme('light')` and screenshot `home-light.png`, `browser-light.png`, `settings-light.png`; then `applyTheme('system')`. Still zero console errors.
- `verify.ps1` green; `CLAUDE.md` "Frontend traps" bullet about glow tokens deleted and replaced by the flat-elevation rule.
- `docs/UI-SPEC.md` A.0 replaced by a short pointer to this spec's §3–§4 (style is now specified here; behaviour stays in UI-SPEC).
- Run summary `docs/superpowers/runs/<date>-stage-1.md` with the screenshot set; the author reviews once.

## 7. Out of scope (explicit)

Any layout, size or spacing change; any behaviour change beyond the theme mode and the glow removal; any wiring of placeholder screens; the Windows system accent; Acrylic or Mica on anything but sidebar and titlebar; fonts beyond Segoe UI Variable; per-pixel iteration after the single review.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Mica unsupported or ugly on the author's machine | `data-mica` gate; the solid fallback is the exact board C look; one config line disables it. |
| Segoe UI Variable missing (Windows 10) | Fallback stack ends in `'Segoe UI', system-ui`; metrics are near-identical. |
| Flattening via tokens leaves stray hardcoded bevels | §3.5 grep gates are hard fails in the plan's final task. |
| Custom accent breaks contrast | `--text-on-accent` is per theme and fixed; a poor custom accent is the user's choice, as before. |
| Light mode weak on placeholder screens | Only chrome/Home/Browser are in scope; other screens must merely not break (smoke test). |
