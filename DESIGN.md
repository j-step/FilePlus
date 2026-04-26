---
name: FilePlus
description: A personal Windows file explorer with AI-assisted organization.
colors:
  backdrop: "#181522"
  chrome: "#1F1B27"
  content: "#25202D"
  raised: "#312A38"
  pressed: "#3B3344"
  accent: "#E8965E"
  accent-custom: ""  # User override via Settings → Personalization. Empty string means "use default amber."
  accent-hover: "#F0A574"
  accent-press: "#D88248"
  text-primary: "#F2EDE8"
  text-secondary: "#A39BAE"
  text-tertiary: "#6B6478"
  text-on-accent: "#1A1015"
  good: "#7DC494"
  bad: "#E08A86"
  warn: "#E8C56B"
  light-backdrop: "#F5F1EC"
  light-chrome: "#EDE8E1"
  light-content: "#F8F4EF"
  light-raised: "#FFFFFF"
  light-pressed: "#E8E2DA"
  light-text-primary: "#1F1A22"
  light-text-secondary: "#5D5466"
  light-text-tertiary: "#9A93A4"
typography:
  display:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: "34px"
    letterSpacing: "-0.020em"
  headline:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "30px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.010em"
  title-sm:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
    letterSpacing: "-0.010em"
  body:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "20px"
    letterSpacing: "-0.005em"
  label:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "18px"
    letterSpacing: "-0.005em"
  caption:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "-0.005em"
  micro:
    fontFamily: "'Inter', -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: "14px"
    letterSpacing: "0.060em"
  data:
    fontFamily: "'JetBrains Mono', 'Geist Mono', ui-monospace, 'SF Mono', Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "16px"
    letterSpacing: "0"
rounded:
  chip: "4px"
  icon-btn: "5px"
  button: "6px"
  card: "8px"
  modal: "10px"
  tray: "12px"
  pill: "9999px"
spacing:
  "2": "2px"
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "10": "10px"
  "12": "12px"
  "16": "16px"
  "20": "20px"
  "24": "24px"
  "32": "32px"
  "48": "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-on-accent}"
    rounded: "{rounded.button}"
    height: "28px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-press}"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.button}"
    height: "28px"
    padding: "0 12px"
  button-secondary-hover:
    backgroundColor: "{colors.pressed}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.button}"
    height: "28px"
    padding: "0 10px"
  button-ghost-hover:
    backgroundColor: "{colors.raised}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.icon-btn}"
    size: "28px"
  chip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.chip}"
    height: "20px"
    padding: "0 6px"
  chip-active:
    backgroundColor: "rgba(232, 150, 94, 0.10)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.chip}"
  input:
    backgroundColor: "{colors.content}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.button}"
    height: "30px"
    padding: "0 12px"
  approvals-pill:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    height: "30px"
    padding: "0 14px 0 12px"
  approvals-pill-active:
    backgroundColor: "rgba(232, 150, 94, 0.10)"
    textColor: "{colors.text-primary}"
---

# Design System: FilePlus

## 1. Overview

**Creative North Star: "The Dark Workshop"**

FilePlus feels like a workspace that has been used and trusted for years: dark surfaces with the warmth of quality materials, not darkness as aesthetic posture. The physical scene that forced the dark theme: a developer at a desk in the evening, two monitors, files scattered across drives that need organizing, wanting to get in and get out without the tool demanding attention. Dark not because tools look cool dark. Dark because the content is the work, not the chrome.

The hotel lobby note: ambient wayfinding. Everything the user might need is present and legible without requiring them to search for it. No element demands a second glance. Navigation signs are visible but not loud. The space does its job while staying in the background. Applied to software: every control has a label, every state has a color, every affordance has an icon, and none of them compete with the file list.

The material quality: machined precision. Tight tolerances, nothing soft, but the tightness is smooth rather than sharp. Buttons depress cleanly and release quickly. Transitions are fast enough to feel immediate but present enough to confirm causality. The design respects that the user is a power user: density over airiness, information over whitespace, controls where you reach for them.

**Key Characteristics:**
- Deep warm-purple base with a single Burnt Amber accent used sparingly
- Tactile chrome (convex buttons, convex cards, concave inputs) on intentionally flat content lists
- Two typefaces, used without exception: Inter for all UI, JetBrains Mono for all data-class text
- Motion limited to state confirmation: 50-180ms, ease-out exponential, never decorative
- Restrained color strategy: accent on 10% or less of any surface
- Full light mode support: warm cream palette mirroring the dark surface hierarchy

## 2. Colors: The Amber Workshop Palette

A single warm signal in a cool-dark field. Burnt Amber is the only saturated color in the interface; everything else is a step on the purple-grey neutral ramp.

### Primary
- **Burnt Amber** (`#E8965E`): The single accent. Active sidebar indicator, selected file row tint (`accent-wash`: rgba variant), focus rings, approval count badge fill, and any interactive element communicating "this is the action." If amber is visible, something is selected, active, or pending.
- **Custom accent override** (`--accent-custom`): user-set CSS custom property exposed in Settings → Personalization. When set to a valid hex, the entire accent ramp (`--accent`, `--accent-wash`, `--accent-edge`, `--accent-glow`, etc.) re-resolves to use the custom value. When empty, all accent vars default to the brand amber. Implementation: every accent-derived var defines its base color via `var(--accent-custom, #E8965E)`.
- **Amber hover** (`#F0A574`): Primary button hover, accent-colored element hover. Always lighter than base accent.
- **Amber press** (`#D88248`): Primary button active/pressed. Always darker than base accent.

### Neutral
The surface ramp is five steps from near-black to pressed-active. All five are tinted toward violet — never a pure grey.

- **Backdrop** (`#181522`): Window edge, titlebar, status bar. The darkest surface; appears only at structural boundaries.
- **Chrome** (`#1F1B27`): Sidebar, persistent structural shell. One step above backdrop.
- **Content** (`#25202D`): Main work area, toolbar background, input backgrounds. Where files live.
- **Raised** (`#312A38`): Buttons, cards, hover backgrounds, popovers. Visually lifted above content.
- **Pressed** (`#3B3344`): Active hover, active sidebar items, pressed state. Highest tonal step.
- **Text primary** (`#F2EDE8`): Warm near-white. All primary labels, file names, active breadcrumb.
- **Text secondary** (`#A39BAE`): Inactive labels, sidebar item default, breadcrumb segments, icon default color.
- **Text tertiary** (`#6B6478`): Placeholder text, section headers, monospaced data fields at rest, dimmed metadata.
- **Text on accent** (`#1A1015`): Near-black for text placed on Burnt Amber backgrounds only.

Light mode uses a warm cream ramp (`#F5F1EC` through `#E8E2DA`) mirroring the same five-step hierarchy. The same accent and semantic colors are used unchanged in both modes.

### Semantic Signals
Not accent variants. Status signals only: they tell the user whether a file state is unresolved, in-progress, succeeded, or failed.

- **Oxidized Copper** (`#7DC494`, good): Success, classified, applied, confirmed. Used as chip fill-wash and text; never as background wash on large areas.
- **Muted Coral Red** (`#E08A86`, bad): Error, failed classification, rejected operation, destructive action hover.
- **Warn Gold** (`#E8C56B`, warn): Needs attention, low-confidence classification, pending review.

### Named Rules

**The One Amber Rule.** Burnt Amber appears on 10% or less of any given surface. If every sidebar item glows amber, nothing is selected. Rarity is the signal.

**The Flat-Content Rule.** File rows, list items, scan results, and data tables have no background, no border, and no shadow at rest. Depth comes from the tonal placement of the parent surface. Elevation is reserved for chrome.

**The Wash-Not-Solid Rule.** Semantic colors and the accent appear in content areas only as wash variants (10-18% alpha tints) with matching edge variants for borders. Never a solid accent or semantic background in a content list.

## 3. Typography

**UI Font:** Inter (with -apple-system, system-ui, Segoe UI fallbacks)
**Data Font:** JetBrains Mono (with Geist Mono, ui-monospace, SF Mono, Consolas fallbacks)

**Character:** Inter at compressed letter-spacing (-0.005em to -0.020em) reads as functional and legible without personality. JetBrains Mono appears exclusively where data precision matters: file paths, sizes, hashes, timestamps, counts, keyboard hints. The two faces divide the interface cleanly: Inter is what you act on, Mono is what you read as information.

### Hierarchy
- **Display** (700, 28px/34px, -0.020em): Reserved for screen-level titles on high-context transitions. Rarely used; its rarity makes it meaningful.
- **Headline** (600, 22px/30px, -0.015em): Overlay titles, modal headings, named section anchors.
- **Title** (600, 18px/26px, -0.010em): Screen titles in the toolbar area, major panel headings.
- **Title-sm** (600, 16px/22px, -0.010em): Inspector panel headings, sheet headers, sidebar brand name.
- **Body** (500, 13px/20px, -0.005em): All interactive UI text: buttons, sidebar items, file names, breadcrumb, menu items, tab labels. The most common weight in the app.
- **Label** (500, 12px/18px, -0.005em): Secondary UI: toolbar subtitles, metadata key labels, form field labels.
- **Caption** (400, 11px/16px, -0.005em): Non-uppercase section labels, helper text, badge content when non-data.
- **Micro** (500, 10px/14px, +0.060em, `text-transform: uppercase`): Sidebar section headers (QUICK ACCESS, FILE TREE, SYSTEM). Uppercase and tracked-out for legibility at minimum size.
- **Data** (JetBrains Mono 500, 11px/16px, 0): File paths, sizes, hashes, timestamps, counts, keyboard shortcuts. Letter-spacing 0; monospace handles its own rhythm.

### Named Rules

**The Two-Font Rule.** Inter for everything the user reads as UI copy. JetBrains Mono for everything the user reads as a data value. These roles never swap. A file name is UI (Inter). A file path is data (Mono). A button label is UI. A file size is data.

**The No-Weight-Wall Rule.** No two adjacent text elements share the same size and weight. Hierarchy requires contrast on at least one axis: scale must differ by at least one step, or weight must shift by at least 100.

## 4. Elevation

The system is **hybrid**: tonal placement for depth at rest, shadow for interactive lift. A button on the Content surface (`#25202D`) uses Raised (`#312A38`) as its background, placing it one tonal step above the surface without any shadow. Add `shadow-raised` on top and it reads as physically lifted. Content rows stay at zero elevation: no shadow, no background, no border.

Chrome elements (buttons, pills, sidebar items, cards, popovers) are **convex**: they carry `inset 0 1px 0 rgba(255,255,255,0.06)` as a top highlight simulating light from above, plus a drop shadow proportional to their elevation role.

Input fields are **concave**: they carry `inset 0 1px 2px rgba(0,0,0,0.30)` (recess) and no top highlight. The two directions never mix on the same element.

### Shadow Vocabulary
- **Raised** (`0 1px 2px rgba(0,0,0,0.30), 0 0 0 1px rgba(0,0,0,0.15)`): Buttons at rest, badge pills, chips. Barely perceptible lift with a thin outline.
- **Card** (`0 2px 6px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.20)`): Hover-elevated elements, popover containers, raised card at rest. First visible separation.
- **Popover** (`0 8px 24px rgba(0,0,0,0.40), 0 2px 6px rgba(0,0,0,0.25)`): Context menus, tooltips, dropdowns. Clearly above the surface.
- **Modal** (`0 16px 48px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35)`): Dialogs, command palette, confirmation overlays. Maximum app elevation.
- **Recess** (`inset 0 1px 2px rgba(0,0,0,0.30)`): Search input, text input at rest. Concave.
- **Recess-strong** (`inset 0 2px 4px rgba(0,0,0,0.40)`): Input on focus, combined with the 3px amber glow ring.
- **Pressed** (`inset 0 1px 2px rgba(0,0,0,0.30), inset 0 0 0 1px rgba(255,255,255,0.09)`): Buttons and pills in their active/pressed state.

### Named Rules

**The Convex-Concave Rule.** Buttons, pills, cards, and badges are convex (top highlight + drop shadow). Inputs are concave (inset recess, no highlight). These two directions never appear on the same element. If you see an input with a drop shadow, it is wrong.

**The Blur Boundary Rule.** Backdrop-filter blur is permitted only on temporary overlays: modals, the command palette, the tray popout. It is explicitly prohibited on the sidebar, toolbar, content panes, and file lists. Blur on structural surfaces is decorative; structural surfaces do not decorate.

## 5. Components

### Buttons
Convex chrome shape. Pressing depresses the button via `translateY(1px)` and switches to pressed-shadow. All press transitions at 50ms ease-snap; release at 80ms ease-snap.

- **Shape:** Gently rounded (6px radius). Not soft. Not a pill.
- **Primary:** Burnt Amber background (`#E8965E`), near-black text (`#1A1015`), top highlight at `rgba(255,255,255,0.15)`, `shadow-raised`. Hover: `#F0A574`. Active: `#D88248` + pressed shadow.
- **Secondary:** `raised` background, `text-primary`, `border-subtle` 1px border, `shadow-raised`. Hover: `pressed` background.
- **Ghost:** Transparent background, `text-secondary`, no border, no shadow. Hover: `raised` + `highlight-top`.
- **Icon button:** Square (28x28px), 5px radius, transparent. Hover: `raised` + `highlight-top`. Active: `translateY(1px)`.
- **Large button:** Same as primary/secondary but 36px height, 16px horizontal padding. Used for primary CTAs in overlays.
- **Small button:** 24px height, 8px horizontal padding. Used in inspector actions, inline confirmations.

### Chips
State via background wash and border tint. Never a solid-color background or a side-stripe border.

- **Default:** `raised` background, `text-secondary` text, `border-subtle` 1px border, 4px radius, 20px height, 6px horizontal padding, JetBrains Mono 11px.
- **Active/selected:** `rgba(232,150,94,0.10)` background, `text-primary` text, `rgba(232,150,94,0.40)` border.
- **Good state:** `rgba(125,196,148,0.10)` background, `good` text, `rgba(125,196,148,0.40)` border.
- **Warn state:** `rgba(232,197,107,0.10)` background, `warn` text, `rgba(232,197,107,0.40)` border.
- **Bad state:** `rgba(224,138,134,0.10)` background, `bad` text, `rgba(224,138,134,0.40)` border.

### Approvals Pill (Signature Component)
The only pill-radius interactive element in the main toolbar. Its count badge is the only Burnt Amber fill visible during normal use.

- Convex chrome: `raised` background, `border-subtle` 1px border, `highlight-top-strong`, `shadow-raised`.
- Hover: elevates to `shadow-card`, lifts 0.5px via `translateY(-0.5px)`.
- Active (items pending): `rgba(232,150,94,0.10)` background, `rgba(232,150,94,0.40)` border.
- Badge: Burnt Amber fill (`#E8965E`), near-black text, JetBrains Mono count, pill radius, 18px height.

### File Row (Signature Component)
The content surface is intentionally flat. State is communicated entirely through fill, never through shadows or side borders.

- **Default:** transparent background, no border. 26px height (default density). Grid: 24px icon, flex name (Inter 500 13px), 72px size (Mono), 88px modified (Mono), 120px tags.
- **Hover:** `raised` background. No shadow, no border change.
- **Selected:** `rgba(232,150,94,0.10)` background, `rgba(232,150,94,0.40)` 1px full border.
- **Active/open:** `pressed` background.
- **Folder variant:** Folder icon with Burnt Amber fill at 75% opacity, `accent-edge` stroke. Same row layout.
- Density variants: compact (22px), default (26px), comfortable (32px).

### Cards
Used on configuration surfaces (Scan config, Settings panes) and the inspector. Never in file lists.

- 8px radius, `raised` background, `border-subtle` 1px border, `shadow-card`.
- 16px internal padding.
- Top highlight (`highlight-top`) for the convex feel.

### Inputs and Search
Concave chrome. The search field is the only concave interactive element in the main toolbar.

- 6px radius, 30px height, `content` background (flush with toolbar; not `raised`).
- `border-subtle` 1px border, `inset-recess` shadow.
- Focus: `rgba(232,150,94,0.40)` border, `inset-recess-strong` + `0 0 0 3px rgba(232,150,94,0.20)` glow ring.
- Leading search icon at `text-tertiary`; placeholder text at `text-tertiary`; kbd hint trailing in `raised` pill (JetBrains Mono, 4px radius).

### Navigation (Sidebar)
The active item indicator is a 2px Burnt Amber pill floating 4px left of the active row, inset 4px from top and bottom. It slides between items at 180ms ease-out. The indicator floats independently of the row background.

- Section labels: Micro (10px, uppercase, +0.06em), `text-tertiary`. 14px top padding, 6px bottom padding.
- Items: 28px height, 6px radius, Inter 500 body, `text-primary`.
- Hover: `raised` background + `highlight-top`; icon shifts to `text-primary`.
- Active: `pressed` background + `highlight-top` + floating 2px amber pill; label shifts to Inter 600; icon shifts to `accent`.
- Collapsed (52px wide): labels hidden, items become 36x36px centered icon squares.

### Command Palette
Blur-backed overlay at modal elevation. The only structural use of `backdrop-filter` in the app.

- 10px radius, `shadow-modal`, `backdrop-filter: blur(12px)`.
- Input at top: no inset recess (the overlay provides its own depth context); standard focus ring on the input.
- Result items: flat at rest, `raised` hover. Group labels in Micro style.

## 6. Do's and Don'ts

### Do:
- **Do** use JetBrains Mono for every data-class string: file paths, sizes, hashes, timestamps, event counts, keyboard shortcuts. No exceptions.
- **Do** give every interactive element a `data-action` attribute in kebab-case describing its intended function (`data-action="toggle-inspector"`, `data-action="open-review-bin"`).
- **Do** represent all state variants inline in HTML: one active example, commented-out alternates for every other state (empty, error, loading, selected).
- **Do** put `inset 0 1px 0 rgba(255,255,255,0.06)` on every convex chrome element so it reads as physically lifted above its surface.
- **Do** express selected and active states in content areas using wash+edge tints (rgba 10-18% fill, rgba 40% border), never solid accent backgrounds.
- **Do** express error and warning states using `bad-wash`/`bad-edge` and `warn-wash`/`warn-edge` chip patterns. No side-stripe borders on any element.
- **Do** keep file rows and list items completely flat at rest. No card treatment in file lists or data tables.
- **Do** limit blur to temporary overlays: modals, command palette, tray popout, context menus. Not on persistent panels.
- **Do** match the physical scene: a single user at their own machine, files to organize, wants fast access. Every screen should load immediately with content or a minimal empty state, never a wizard.

### Don't:
- **Don't** look like Windows Explorer: no sparse whitespace, no flat header-bar-only chrome, no toolbar without personality.
- **Don't** look like Total Commander or Directory Opus: no competing toolbar rows, no crowded multi-column headers, no tiny icon buttons packed 12 across.
- **Don't** foreground the AI: no pulsing "thinking" indicators, no gradient glow around AI-classified results, no badge that says "AI filed this." Results speak; the AI stays silent.
- **Don't** look like a SaaS dashboard: no hero-metric cards with big numbers and small labels, no purple-to-blue gradient in the sidebar, no rounded-corner on every element, no gradient text.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on any row, card, callout, or alert. The active sidebar item uses a floating 2px pill at the left edge of the container, not a border on the row itself.
- **Don't** use `background-clip: text` with a gradient background. All text is a single solid color. Emphasis through weight or size only.
- **Don't** apply `backdrop-filter` blur to the sidebar, toolbar, content panes, or file lists. Blur is for overlays that appear above the surface.
- **Don't** use the same padding value everywhere. The sidebar header (56px) is taller than sidebar items (28px); the toolbar (48px) is taller than the status bar (24px). Vary rhythm to communicate structure.
- **Don't** use cards inside file lists or anywhere data density is the priority. Cards fragment scanning. One exception: configuration surfaces (Scan config, Settings panes) where grouping has structural meaning.
- **Don't** invent UI patterns not described in the spec. No helpful extras, no suggested settings, no friendly tooltips on stable controls.
