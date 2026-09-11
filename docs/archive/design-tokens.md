# FilePlus Design Tokens & Component Specification

**Version:** 2.0 (full replacement of v1)
**Mode priority:** Dark first, light second. Identity is consistent across both.
**App identity in one line:** Tool not toy. Warm dark base, single warm amber accent. Tactile chrome, flat content. Multi-layered subtle bevels everywhere chrome lives. Motion confirms causality, never decorates transitions.

---

## PART 0: How to apply this spec

You are receiving this spec to update an existing stylesheet for an existing HTML/CSS/JS application. The existing layout, screens, and component hierarchy already exist. Your job is to align styles to this spec.

Important rules for applying this spec:

1. **Principles in Part 1 override everything else in this document.** If a component spec in Part 4 contradicts a principle, the principle wins and the component spec is treated as the wrong document.
2. **Component specs in Part 4 override existing styling in the codebase.** If the existing markup or CSS contradicts a Part 4 spec, the spec wins. The previous v1 implementation is presumed broken; do not preserve its values.
3. **Every interactive element must satisfy the Clickability Rule (Section 37).** If an existing element fails this test after applying tokens, add the missing chrome.
4. **Run the audit checklist (Section 39) against the output before declaring complete.** If any line in the checklist fails, fix it before returning.
5. **Do not skip the window chrome (Section 9).** It was missing entirely in v1. The titlebar, window border, and window radius are mandatory.
6. **All icons must respect explicit size rules in Section 8.** Never let SVG inherit container width.

---

## PART 1: Non-negotiable principles

These are the design philosophy. Memorize them. Every visual decision in this app traces back to one of them.

### Principle 1: Tool not toy

This is a power-user file manager used for hours at a time. Every visual decision serves fast scanning of dense information. Decoration that slows scanning gets cut. The aesthetic is "expensive precision instrument," not "consumer app launch animation."

### Principle 2: Tactile chrome, flat content

The single most important principle. Memorize this distinction:

- **Chrome** (anything you click or interact with): subtly tactile. Has at least an inner highlight, a border, and a shadow. Reads as a discrete object that can be touched. Examples: every button, the Approvals pill, search field, sidebar items, tab pills, pill badges, cards, popovers, modals, the inspector panel, the toolbar segmented control.
- **Content** (anything you read): flat. No chrome. No border. No shadow. No highlight. Examples: file row in default state, body text inside cards, breadcrumb path text, sidebar section labels, file name within a row, file size and date columns.

The contrast between flat content and tactile chrome is what produces clarity. If everything is flat, the user cannot tell what is interactive. If everything is tactile, the data is illegible.

### Principle 3: Multi-layered subtle bevels are mandatory on chrome

Every chrome element must combine:
- A border (even at 6 to 8% opacity)
- An inner highlight at the top (light from above)
- A subtle drop shadow (depth from below)

Chrome that recesses (text inputs, the search field) inverts this: inset shadow at top simulates the surface dipping inward. Chrome that lifts (buttons, cards, popovers) layers shadow underneath.

This is not neumorphism. The effects are barely perceptible individually. They compound to create the feeling of a real surface with subtle depth, which is what the user described as "concaves and convexes, drop shadows, imprints, multi-layered."

### Principle 4: Color carries meaning

- **Amber** (`#E8965E`) is identity. Used for: selection, AI activity, primary actions, active states, focus indicators.
- **Green** (`#7DC494`) is success and healthy state. Used for: auto-filed chips, completed scan steps, success notifications.
- **Coral/red** (`#E08A86`) is destructive and error. Used for: delete buttons, error states, conflict warnings.
- **Cool tones** are for chrome surfaces only. Never as accents.
- Do not introduce additional accent colors anywhere.

### Principle 5: Identity stays consistent across modes

Amber is the same hex in dark and light mode. Light mode is warm cream (not pure white). Pure white never appears in dark mode and only appears as the raised surface tier in light mode (where lift requires brightness). The app must read as the same product in either mode.

### Principle 6: Motion confirms causality, never decorates transitions

Click produces an instant result plus a 60ms feedback flash on the thing clicked. Tabs and panels jump-cut their content. The indicator that travels between tabs is the one place a small sliding motion buys feel. Nothing else moves unless it represents live data or signals a discrete event (a new approval arriving, an AI auto-filing).

### Principle 7: Tonal separation plus borders, not one or the other

The previous spec said "tonal lift does almost all separation, borders are rare." This was wrong and produced a flat-looking app. Surfaces use tonal steps for cohesion AND borders for clarity. The combination of both is what separates panels and elements without making the app feel walled-off.

### Principle 8: Icon system is hybrid

- **Chrome icons** (sidebar nav, toolbar, buttons, status, tabs): Lucide outline, 1.5px stroke, currentColor. Always.
- **File icons in lists** (rows in any folder view, recent list, approval queue, tray popout history): native Windows icons extracted via pywin32, cached to disk as PNGs at 16px and 32px sizes, served from cache thereafter.
- **Folder icons in lists**: Lucide outline (consistent chrome look). Folders are part of navigation, not file identity.
- **Brand mark** (app logo): custom SVG, amber gradient fill.

This was decided in a prior chat and was missing from v1. Reinstate it.

### Principle 9: Clickability is a hard rule

Every interactive element must communicate its interactivity at a glance with at least one of:
- A visible border (border-subtle or stronger)
- A background fill different from its parent surface
- An accent-colored icon or label
- A visible chrome treatment (shadow plus highlight)

If an element fails all four, the user does not know it is clickable. Default text on default background with no other treatment is forbidden for interactive elements.

---

## PART 2: Color tokens

### 2.1 Dark mode (default)

#### Surfaces (the tonal ramp)

The ramp is intentionally narrow. Cohesion comes from the ramp; separation comes from borders and shadows in Part 3. Do not widen the ramp to compensate for missing chrome; instead, add the chrome.

| Token | Value | Use |
|---|---|---|
| `bg-backdrop` | `#181522` | Window edge, status bar, behind everything |
| `bg-chrome` | `#1F1B27` | Sidebar, persistent structural shell |
| `bg-content` | `#25202D` | Main work area where data lives |
| `bg-raised` | `#312A38` | Cards, popovers, hover states, the Approvals pill, button defaults |
| `bg-pressed` | `#3B3344` | Active hover, pressed state, sidebar active item, dropdown selected items |

The `bg-raised` value was bumped from v1 (`#2E2935`) to widen the gap with `bg-content`. This makes cards and popovers visibly lift even before borders and shadows are applied.

#### Accent (single warm amber)

| Token | Value | Use |
|---|---|---|
| `accent` | `#E8965E` | Primary buttons, selection bars, AI sparkle, active indicators, focus ring |
| `accent-hover` | `#F0A574` | Hover state for primary buttons and accent surfaces |
| `accent-press` | `#D88248` | Active press state for accent buttons |
| `accent-wash` | `rgba(232, 150, 94, 0.10)` | Selected row backgrounds, AI-suggested chips, selected popover items |
| `accent-wash-strong` | `rgba(232, 150, 94, 0.18)` | Drag-target rows, active context menu items, "Uncertain" alert blocks |
| `accent-edge` | `rgba(232, 150, 94, 0.40)` | Borders on tinted/selected elements |
| `accent-edge-strong` | `rgba(232, 150, 94, 0.55)` | Heavy accent borders (drag-target perimeter, focus on accent-tinted) |
| `accent-glow` | `rgba(232, 150, 94, 0.20)` | Focus ring outer aura |

#### Text

| Token | Value | Use |
|---|---|---|
| `text-primary` | `#F2EDE8` | File names, button labels, headings, anything important. Warm off-white. |
| `text-secondary` | `#A39BAE` | Secondary labels, meta text, default icon color |
| `text-tertiary` | `#6B6478` | Timestamps, sizes, separators, inactive items, placeholder text |
| `text-on-accent` | `#1A1015` | Text on amber fills (primary buttons, count badges) |
| `text-on-good` | `#0F2E18` | Text on green fills |
| `text-on-bad` | `#3D0F0D` | Text on coral fills |

#### Semantic

| Token | Value | Use |
|---|---|---|
| `good` | `#7DC494` | Success states, healthy indicators, auto-filed chips, completed steps |
| `good-wash` | `rgba(125, 196, 148, 0.10)` | Success-tinted backgrounds |
| `good-edge` | `rgba(125, 196, 148, 0.40)` | Success-tinted borders |
| `bad` | `#E08A86` | Destructive actions, errors, conflicts |
| `bad-wash` | `rgba(224, 138, 134, 0.10)` | Error-tinted backgrounds |
| `bad-edge` | `rgba(224, 138, 134, 0.40)` | Error/danger borders |
| `warn` | `#E8C56B` | Cautions that are not errors |
| `warn-wash` | `rgba(232, 197, 107, 0.10)` | Warning-tinted backgrounds |
| `warn-edge` | `rgba(232, 197, 107, 0.40)` | Warning borders |

#### Borders (mandatory on chrome, never on content)

| Token | Value | Use |
|---|---|---|
| `border-hairline` | `rgba(255, 255, 255, 0.06)` | The structural seam between sidebar and content, optional list-header bottom |
| `border-subtle` | `rgba(255, 255, 255, 0.09)` | Default border for all raised elements (cards, popovers, buttons, inputs, the Approvals pill, chips) |
| `border-mid` | `rgba(255, 255, 255, 0.13)` | Hover state on subtle borders, list dividers if needed |
| `border-strong` | `rgba(255, 255, 255, 0.18)` | Window edge, modal edge, focused inputs |

`border-subtle` was bumped from v1 (was 0.08) to be more reliably visible. The previous value disappeared on some monitors.

### 2.2 Light mode

Warm cream base, identical amber accent, identical semantic colors. Same identity, inverted brightness.

#### Surfaces

| Token | Value | Use |
|---|---|---|
| `bg-backdrop` | `#F5F1EC` | Window edge, behind everything |
| `bg-chrome` | `#EDE8E1` | Sidebar |
| `bg-content` | `#F8F4EF` | Main work area |
| `bg-raised` | `#FFFFFF` | Cards, popovers, hover (the only place pure white is permitted) |
| `bg-pressed` | `#E8E2DA` | Active hover, pressed |

#### Text

| Token | Value | Use |
|---|---|---|
| `text-primary` | `#1F1A22` | Warm near-black, not pure black |
| `text-secondary` | `#5D5466` | Default secondary |
| `text-tertiary` | `#9A93A4` | Lightest readable text |
| `text-on-accent` | `#1A1015` | Identical to dark mode |

#### Borders

| Token | Value |
|---|---|
| `border-hairline` | `rgba(0, 0, 0, 0.06)` |
| `border-subtle` | `rgba(0, 0, 0, 0.09)` |
| `border-mid` | `rgba(0, 0, 0, 0.14)` |
| `border-strong` | `rgba(0, 0, 0, 0.18)` |

Accent and semantic tokens are identical to dark mode. Do not modify.

---

## PART 3: Chrome composition (the layered system)

This is the most important part of the spec. Chrome is built by composing several layers, never one alone. The combinations below produce the multi-layered, subtly tactile feel the app requires.

### 3.1 Highlight and depth tokens

These are inset shadows used as part of every chrome composition. They are not standalone shadows; they are layered with outer shadows.

| Token | Value | Purpose |
|---|---|---|
| `highlight-top` | `inset 0 1px 0 rgba(255, 255, 255, 0.06)` | Light from above on standard chrome |
| `highlight-top-strong` | `inset 0 1px 0 rgba(255, 255, 255, 0.10)` | Light from above on primary buttons, the Approvals pill |
| `depth-bottom` | `inset 0 -1px 0 rgba(0, 0, 0, 0.18)` | Subtle weight at bottom of buttons |
| `inset-recess` | `inset 0 1px 2px rgba(0, 0, 0, 0.30)` | Concave dip for inputs and search field |
| `inset-recess-strong` | `inset 0 2px 4px rgba(0, 0, 0, 0.40)` | Deeper recess for focused inputs |

In light mode, swap white-alpha and black-alpha values: highlights use `rgba(255, 255, 255, 0.50)` to `0.65`, depths use `rgba(0, 0, 0, 0.04)` to `0.08`, inset recesses use `rgba(0, 0, 0, 0.06)` to `0.10`.

### 3.2 Outer shadow tokens

| Token | Value | Use |
|---|---|---|
| `shadow-raised` | `0 1px 2px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(0, 0, 0, 0.15)` | Buttons, chips, the Approvals pill |
| `shadow-card` | `0 2px 6px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.20)` | Cards, inspector panels, stat blocks |
| `shadow-popover` | `0 8px 24px rgba(0, 0, 0, 0.40), 0 2px 6px rgba(0, 0, 0, 0.25)` | Dropdowns, menus, tooltips |
| `shadow-modal` | `0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35)` | Modals, command palette, tray popout |
| `shadow-window` | `0 24px 64px rgba(0, 0, 0, 0.60), 0 8px 24px rgba(0, 0, 0, 0.40)` | Application window |

In light mode: scale all alpha values down by ~50% (e.g., `0.30` becomes `0.15`).

### 3.3 Composed chrome formulas

These are the exact box-shadow stacks for each chrome type. Do not improvise; use these compositions verbatim.

#### Convex chrome (buttons, cards, popovers, the pill, raised pills/chips)

```
background: var(--bg-raised);
border: 1px solid var(--border-subtle);
box-shadow: var(--highlight-top), var(--shadow-raised);
```

For primary buttons and the Approvals pill, use `--highlight-top-strong` instead.

For cards, swap `--shadow-raised` for `--shadow-card`.

For popovers and dropdowns, swap for `--shadow-popover`.

For modals and the command palette, use `border-strong` and `--shadow-modal`.

#### Concave chrome (text inputs, search field, segmented control track)

```
background: var(--bg-content);
border: 1px solid var(--border-subtle);
box-shadow: var(--inset-recess);
```

When focused:

```
border-color: var(--accent-edge);
box-shadow: var(--inset-recess-strong), 0 0 0 3px var(--accent-glow);
```

#### Pressed state (any chrome being clicked)

```
transform: translateY(1px);
box-shadow: var(--inset-recess), 0 0 0 1px var(--border-subtle) inset;
```

This flattens the element by removing the lift shadow and adding a slight inset, simulating the surface depressing.

### 3.4 What gets which chrome

| Element | Chrome type |
|---|---|
| Primary button | Convex with `highlight-top-strong`, accent fill instead of `bg-raised` |
| Secondary button | Convex |
| Ghost button | None at default; convex on hover |
| Icon button | None at default; convex on hover |
| Card | Convex with `shadow-card` |
| Popover, dropdown, context menu | Convex with `shadow-popover` |
| Modal, command palette | Convex with `border-strong` and `shadow-modal` |
| Approvals pill | Convex with `highlight-top-strong` |
| Sidebar item, default | None |
| Sidebar item, hover | Convex (background only, no shadow, retain highlight) |
| Sidebar item, active | Convex with accent left bar |
| Tab pill (segmented control), active | Convex with `accent-wash` background and `accent-edge` border |
| Tab underline, active | None on tab itself; underline is a 2px accent bar at bottom |
| Text input, search field | Concave |
| Toggle switch track | Concave |
| Slider track | Concave |
| Stat card (scan screen) | Convex with `shadow-card` |
| Inspector panel | Convex when detached, flat with `border-hairline` left edge when docked |
| Tray popout window | Convex with `shadow-modal` |
| Status pill | Convex |
| Count badge | Convex if `accent-wash` variant, flat with `bg-pressed` background if neutral |
| Tag chip, default | Flat with `bg-pressed` background, no border |
| Tag chip, accent or semantic | Convex with appropriate wash and edge |
| File row, default | Flat |
| File row, hover | Flat with `bg-raised` background, no shadow |
| File row, selected | Flat with `accent-wash` background, 2px `accent` left bar |

---

## PART 4: Component specifications

### Section 4.1: Typography

**UI font:** Inter (variable, weights 400/500/600/700)
**Mono font:** JetBrains Mono (weights 400/500). If the implementer prefers to keep Geist Mono for continuity with previous markup, that is acceptable; the spec is on the role of mono, not the specific face. Choose one and apply consistently.

#### Size scale

| Token | Size / Line-height | Tracking | Use |
|---|---|---|---|
| `t-micro` | 10 / 14, uppercase | +0.06em | Caps section labels (QUICK ACCESS, TREE, SYSTEM TAGS, NOW WORKING ON) |
| `t-small` | 11 / 16 | 0 | Mono captions, kbd shortcuts, status pills, tooltip body, badge numbers |
| `t-compact` | 12 / 18 | -0.005em | Chips, secondary buttons, sidebar item count badges, breadcrumb separators |
| `t-body` | 13 / 20 | -0.005em | Default UI text, file row name, sidebar items, button labels, tab labels |
| `t-read` | 14 / 22 | -0.005em | Settings descriptions, scan checklist labels, longer body text |
| `t-title-sm` | 16 / 22 | -0.01em | Panel titles, inspector section heads, empty state titles |
| `t-title` | 18 / 26 | -0.01em | Screen titles |
| `t-display-sm` | 22 / 30 | -0.015em | Modal heads, scan stage titles |
| `t-display` | 28 / 34 | -0.02em | Hero numbers (scan ETA, throughput totals), onboarding titles |

#### Weights

- 400: Body paragraphs, descriptions
- 500: UI default. Buttons, sidebar items, toolbar text, chips, tabs, breadcrumb crumbs
- 600: Emphasis. Primary buttons, screen titles, active sidebar item, file names, panel titles
- 700: Display numbers only. Scan stat values, throughput headlines

#### Mono usage (strict)

Mono is for data, never prose.

**Use mono for:** file sizes, timestamps, paths, hashes, file counts, keyboard shortcuts, AI confidence values, scan rate/throughput numbers, tag chip text, hex/numeric values in inspector, drive labels, count badges with numeric content.

**Never use mono for:** body copy, button labels, tooltips, error messages, descriptions, breadcrumbs, file names, screen titles, tab labels, sidebar items.

### Section 4.2: Spacing

**Base unit:** 2px
**Working scale:** 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64

#### Density (file row height, the most-used measurement)

| Mode | File row height | Sidebar item height | Toolbar height |
|---|---|---|---|
| Compact | 22px | 24px | 44px |
| Default | 26px | 28px | 48px |
| Comfortable | 32px | 32px | 52px |

Default is the shipping baseline. Density toggle in settings. Do not default to 28 (v1 mistake).

#### Component dimensions

| Element | Dimensions |
|---|---|
| Titlebar | 32px tall |
| Toolbar | 48px tall |
| Status bar | 24px tall |
| Standard button | 28px tall, padding `0 14px` |
| Large button | 36px tall, padding `0 18px` |
| Small button | 24px tall, padding `0 10px` |
| Icon button (sm/md/lg) | 24×24, 28×28, 32×32 |
| Search field | 30px tall, padding `0 12px`, default width 280px |
| Text input | 30px tall, padding `0 12px` |
| Chip | 20px tall, padding `0 8px` |
| Status pill | 20px tall, padding `0 10px` |
| Count badge | 18px tall, min-width 18px, padding `0 6px` |
| Approvals pill | 30px tall, padding `0 14px 0 12px` |

#### Padding defaults

| Surface | Padding |
|---|---|
| Toolbar | `0 12px` |
| Sidebar outer | `4px 8px` |
| Sidebar item | `0 10px` |
| Card | `16px` |
| Stat card (scan screen) | `14px 16px` |
| Modal | `24px` |
| Popover | `6px` (items have own padding) |
| Inspector panel | `16px` |
| Tooltip | `6px 10px` |
| Tray popout | `0` (sections have own padding) |

#### Gaps

| Context | Gap |
|---|---|
| Toolbar items | 6px |
| Card stack | 12px |
| Section to section | 24px |
| Form fields | 14px |
| Chip group | 6px |
| Sidebar item icon to label | 10px |
| File row columns | 12px |
| Stat card group | 12px |

### Section 4.3: Radii

| Element | Radius |
|---|---|
| Chip, count badge, small label | 4px |
| Icon button, file row selection bar | 5px |
| Standard button, search field, segmented control item, sidebar item | 6px |
| Card, popover, inspector pane, dropdown | 8px |
| Modal, command palette, stat card | 10px |
| Window | 10px |
| Tray popout | 12px |
| Approvals pill | 999px (the one full-rounded element in chrome) |
| Toggle switch thumb, live dot, avatar, brand mark in tray | 999px |

Tighter than fully soft, but never sharp. The user explicitly described this as "tighter but slightly beveled."

### Section 4.4: Borders (mandatory rules)

#### Where borders MUST appear

- Window edge: 1px `border-strong`
- Sidebar right edge (the structural seam): 1px `border-hairline`
- Every card, popover, modal, dropdown, context menu: 1px `border-subtle` minimum
- Every button at default state (except ghost and icon-only buttons): 1px `border-subtle`
- The Approvals pill: 1px `border-subtle`
- Search field, all text inputs: 1px `border-subtle`
- Selected file row: 2px `accent` left bar (4px from row edge, 4px shorter than row top/bottom for floating feel)
- Drag-target file row: 1px `accent-edge-strong` perimeter, radius 5px
- Stat cards on scan screen: 1px `border-subtle`
- Status bar top edge: 1px `border-hairline`
- List header bottom: 1px `border-hairline`
- Inspector tab strip baseline: 1px `border-hairline`

#### Where borders MUST NOT appear

- Between file rows (use spacing only)
- Around chips with default styling (use background fill only)
- Around tabs themselves (use indicator instead)
- Sidebar items at default state (use left bar on active instead)
- Inside a card (use spacing or hairline if absolutely needed)
- Between toolbar items

### Section 4.5: Motion (final values)

#### Durations

| Token | Value | Use |
|---|---|---|
| `dur-flash` | 60ms | Hover background fades, color swaps |
| `dur-press-down` | 50ms | Button press-down translateY |
| `dur-press-up` | 80ms | Button release translateY |
| `dur-fast` | 120ms | Popover open, dropdown open, palette open |
| `dur-slide` | 180ms | Tab indicator slide, sidebar active bar slide, modal open |
| `dur-pulse` | 400ms | Approvals badge pulse on increment, live dot pulse on state change |
| `dur-info` | 1500ms | AI-filed amber left-border fade-out |

#### Easing

| Token | Value | Use |
|---|---|---|
| `ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default for opening, sliding indicators |
| `ease-snap` | `cubic-bezier(0.4, 0.0, 0.2, 1)` | State changes, color swaps |
| `linear` | `linear` | Progress bars, throughput graph |

#### What animates

- Hover background change: `dur-flash`, `ease-snap`
- Button press: down `dur-press-down`, up `dur-press-up`, `translateY(1px)` then return
- Tab indicator slide between tabs: `dur-slide`, `ease-out` (the one signature motion)
- Sidebar active bar slide between active items: `dur-slide`, `ease-out`
- Popover/dropdown open: `dur-fast`, fade and `translateY(3px)`, `ease-out`
- Command palette open: `dur-fast`, fade and `translateY(4px)`, `ease-out`
- Modal open: `dur-slide`, fade and `translateY(6px)`, `ease-out`
- Approvals badge increment: `dur-pulse`, scale `1 → 1.15 → 1`, `ease-snap`
- Live dot on state change: 600ms, scale `1 → 1.4 → 1` plus opacity `1 → 0.4 → 1`. Steady when running.
- AI-filed file row appearance: 200ms fade-in plus `dur-info` amber left-border fade-out
- Throughput graph and waveform playhead: continuous, `linear` (live data)
- Progress bar fill width: `dur-fast`, `linear`

#### What never animates (non-negotiable, this was repeatedly emphasized)

- Panel and tab content swap: jump cut, zero fade
- Sidebar section navigation: jump cut
- File row selection: instant
- File row deselection: instant
- Sort reordering: instant
- Sidebar tree expand/collapse: instant
- File Tree canvas pan/zoom: 1:1 input, no inertia
- Toolbar mode/view toggles: jump cut on the content

#### Reduced motion (`prefers-reduced-motion: reduce`)

Collapse all transitions to `0.01ms` except:
- AI-filed amber left-border fade (kept; it is information)
- Approvals badge pulse on increment (kept; it is notification)
- Progress bars and throughput graph (kept; they represent live data state)

### Section 4.6: Iconography (hybrid system)

Decided in a previous chat. The v1 spec dropped this. Reinstate completely.

#### Icon source by element class

| Element class | Icon source |
|---|---|
| Sidebar nav items (Recent, Everything Folder, Downloads, Scan, etc.) | Lucide outline |
| Toolbar buttons (back, forward, up, view mode, search) | Lucide outline |
| Inspector tabs and section headers | Lucide outline |
| Status indicators (live dot, lock, check, warn) | Lucide outline |
| Buttons in popovers/menus | Lucide outline |
| Tray popout action buttons (Drag, Open, Reveal, Copy) | Lucide outline |
| Folder icons in any list | Lucide outline `folder` |
| File icons for branded files (.exe, .psd, .logicx, .docx, .ai, .fig, etc.) | Native Windows icon, extracted via pywin32, cached as PNG |
| File icons for generic file types (.txt, .md, unknown extensions) | Lucide outline `file-text` or `file` |
| Brand mark | Custom SVG with amber gradient |

#### Lucide rendering rules

- Stroke width: 1.5px on source, do not modify
- Color: `currentColor` (inherits from parent text color)
- Size: explicit `width` and `height` per context, see table below
- Never let the SVG inherit container size. Always set explicit dimensions.

#### Native Windows icon rendering rules

- Source: extracted via `pywin32` (`win32api.ExtractIconEx`) on first encounter, cached to local PNG store keyed by file extension or by file-specific hash for custom-iconed files
- Extract two sizes: 16px (for list rows) and 32px (for grid view, large preview)
- Render at exact target size; do not upscale 16px to a larger render
- Do not apply CSS filters to native icons (no monochrome conversion, no opacity reduction at default)

#### Explicit icon sizes per context (mandatory; this prevents the v1 tray bug)

| Context | Icon size | Notes |
|---|---|---|
| Window titlebar (app icon) | 14×14 | |
| Sidebar item (default and tree items) | 16×16 | |
| Sidebar collapsed icon-only mode | 18×18 | |
| Toolbar nav buttons (back, forward, up) | 16×16 inside 28×28 button | |
| Toolbar view mode toggle | 14×14 inside 24×24 segment | |
| Approvals pill icon | 14×14 | |
| Search field leading icon | 14×14 | |
| Breadcrumb separator chevrons | 10×10 | |
| File row file icon | 16×16 | |
| File row folder icon | 16×16 | |
| Tag chip leading glyph (if any) | 10×10 | |
| AI sparkle | 10×10, always `accent` color | |
| Inspector tab indicators | 14×14 | |
| Inspector property icons | 14×14 | |
| Status pill leading dot | 6×6 (filled circle, semantic color) | |
| Status pill icon (lock, check) | 12×12 | |
| Tray popout active download icon | 18×18 | |
| Tray popout file row icon | 16×16 | |
| **Tray popout action button icon** | **16×16, max 18×18** | This was the v1 bug. Set explicit size. |
| Tray popout footer icon buttons | 16×16 | |
| Context menu item icons | 14×14 | |
| Tooltip icons (rare) | 12×12 | |
| Modal header icon | 18×18 | |
| Empty state hero icon | 48×48, max 64×64 | |
| Onboarding hero icon | 64×64, max 96×96 | |
| Brand mark (sidebar header) | 24×24 |  |
| Brand mark (titlebar) | 14×14 | |
| Brand mark (tray popout header) | 22×22 | |
| Brand mark (onboarding hero) | 48×48 | |
| Brand mark (about screen) | 96×96 | |

**Implementation rule:** every SVG element must have explicit `width` and `height` attributes (or inline `style="width: Npx; height: Npx;"`). Never rely on container sizing. Never set `width: 100%` or `height: 100%` on icons. The v1 tray bug happened because icons inherited button width.

#### Below 14px display size

Render no Lucide icon below 14px. Causes sub-pixel fuzziness on Windows at 100% DPI. If a smaller mark is needed, use a glyph character or a custom 16px-optimized SVG.

#### Forbidden

- Emoji in chrome (data fields like file names can render emoji as the OS does, but UI labels and buttons never use emoji)
- Drop-shadowed icons
- Color-filled or duotone Lucide icons (Lucide is currentColor only)
- Animated icons (except progress spinners)
- Filters on native Windows icons

---

## Section 9: Window shell (MANDATORY, was missing in v1)

The implementer skipped this entirely in v1, leaving the app as a frameless desktop window with no chrome. Reinstate.

### Window container

- Background: `bg-backdrop`
- Border: 1px `border-strong`
- Radius: 10px
- Drop shadow: `shadow-window` if rendered in light DOM (Electron BrowserWindow with `frame: false` and shadow controlled in CSS)
- The window MUST have a visible edge. The titlebar, content, and status bar all sit inside this frame.

### Custom titlebar

Native Windows chrome must be disabled (`frame: false` in Electron). A custom titlebar must be implemented.

```
Height: 32px
Background: bg-backdrop
Padding: 0 12px
Display: flex, align-items center
Drag region: full titlebar except controls (CSS: -webkit-app-region: drag on container, no-drag on controls)
```

Layout (left to right):

1. App icon: 14×14 brand mark
2. 10px gap
3. Title text: `t-compact`, Inter 500, `text-secondary`. Format: "File Explorer" alone, or "File Explorer · {ScreenName}" when on a specific screen
4. `flex-grow` spacer
5. Window controls group: minimize, maximize/restore, close

#### Window control buttons

- Each: 32×32, ghost icon button
- Icons: 12×12 Lucide (`minus`, `square`, `x`)
- Default color: `text-secondary`
- Hover (minimize, maximize): `bg-raised` background, icon `text-primary`
- Hover (close): background `#C0392B` at 80% alpha, icon white
- Press: matches hover state plus `translateY(1px)`

### Window controls placement

Right-aligned, no gap between them. Order: minimize, maximize, close (Windows convention).

---

## Section 10: Sidebar

### Container

- Width: 240px expanded, 52px collapsed
- Background: `bg-chrome`
- Right border: 1px `border-hairline` (the structural seam, only required border between major panels)
- Padding: `4px 8px`
- Vertical scroll on overflow with custom scrollbar (Section 33)

### Header (logo area)

- Height: 56px
- Padding: `14px 14px 10px`
- Layout: brand mark + name/subtitle stack + collapse toggle right-aligned

Brand mark: 24×24 (see Section 28)
Name: `t-body`, Inter 600, `text-primary`, "File Explorer"
Subtitle: `t-small`, Inter 400, `text-tertiary`. Format: "{drive} · {N}k indexed". The `{drive}` and `{N}` portions in JetBrains Mono.
Collapse toggle: 22×22 ghost icon button, top-right, 12px Lucide `chevron-left` icon

### Section labels

- Text: `t-micro`, Inter 500, +0.06em tracking, uppercase, `text-tertiary`
- Padding: `14px 8px 6px`
- Examples: "QUICK ACCESS", "TREE", "SYSTEM"

### Sidebar item (mandatory chrome on hover and active)

```
Height: 28px
Padding: 0 10px
Radius: 6px
Display: flex, align-items center, gap 10px
Background (default): transparent
```

Children:
- Icon: 16×16 Lucide outline, `text-secondary`
- Label: `t-body`, Inter 500, `text-primary`
- Right slot (optional): count badge

#### Sidebar item states

**Default**
- Background: transparent
- No border
- No shadow

**Hover**
- Background: `bg-raised`
- Highlight: `highlight-top` inset shadow
- Border: none
- Transition: `dur-flash`
- Icon: shifts to `text-primary`

**Active (current screen)**
- Background: `bg-pressed`
- Highlight: `highlight-top` inset shadow
- 2px `accent` left bar, positioned absolutely 4px above and below visible row, 4px from container left edge, radius 999px on bar
- Icon: `accent` color (overrides text-primary)
- Label: `text-primary`, Inter 600 (weight bumps from 500 to 600)
- The active bar slides between active items: `dur-slide`, `ease-out`

**Active + hover**
- Same as active, no extra background change

### Tree items

Same as sidebar item, with these additions:
- 14×14 Lucide `chevron-right` caret on left (replaces or precedes the icon)
- Caret rotates 90° on expand: instant, no animation
- Folder icon: 14×14 Lucide `folder`, sits 6px right of caret
- Indentation: 16px per nesting level
- Tree expansion is instant (no height animation per principle 6)

### Collapsed sidebar

- Items become 36×36, icon-only, centered
- Tooltip on hover with 400ms delay (see Section 25)
- Active state still shows 2px `accent` left bar
- Section labels and tree items hidden
- App name and subtitle hidden, brand mark stays at 18×18 size

---

## Section 11: Toolbar

### Container

- Height: 48px
- Background: `bg-content` (no fill distinct from main area; the sidebar/content seam is the only structural separator)
- No bottom border (the list header below it carries the separation)
- Padding: `0 12px`
- Display: flex, align-items center, gap 8px

### Slot order (left to right, when present)

1. Approvals pill (Section 13)
2. Back / forward / up navigation buttons (icon buttons, 28×28)
3. Breadcrumb (Section 14, flex-grow, takes remaining space)
4. Search field (Section 15, fixed 280px)
5. View mode toggle (segmented control, list/grid)

When the screen does not have a breadcrumb (e.g., Recent, Approvals, Scan), the slot is replaced by a screen title in `t-title`, Inter 600, `text-primary`, with optional secondary metadata to its right.

---

## Section 13: Approvals pill (signature element)

The most prominent persistent element. The full-rounded radius is intentional: it reads as the always-available primary entry point in the chrome.

```
Height: 30px
Padding: 0 14px 0 12px
Radius: 999px
Background: bg-raised
Border: 1px border-subtle
Box-shadow: highlight-top-strong, shadow-raised
Display: inline-flex, align-items center, gap 8px
```

Children:
- Icon: 14×14 Lucide `checks` (or `inbox`), `text-secondary`
- Label: `t-compact`, Inter 500, `text-primary`, "Approvals"
- Count badge: amber-filled pill, see below

#### Count badge inside the pill

```
Min: 18×18
Padding: 0 6px
Radius: 999px
Background: accent
Color: text-on-accent
Font: t-small JetBrains Mono 500
```

#### Approvals pill states

**Hover**
- Background: `bg-pressed`
- Border: `border-mid`
- Box-shadow: `highlight-top-strong, shadow-card`
- Transform: `translateY(-0.5px)`
- Transition: `dur-flash`

**Press**
- Transform: `translateY(1px)`
- Box-shadow: `inset-recess, 0 0 0 1px var(--border-subtle) inset`
- Duration: `dur-press-down` then return on `dur-press-up`

**Active (Approvals panel currently open)**
- Background: `accent-wash`
- Border: `accent-edge`
- Box-shadow: `highlight-top-strong, shadow-raised`
- Label color stays `text-primary`
- Count badge stays amber

**Count badge increment animation**
- On every increment, scale `1 → 1.15 → 1` over `dur-pulse`, `ease-snap`
- Optionally also flash the badge background to `accent-hover` for `dur-flash` then back

---

## Section 14: Breadcrumb

- Height: 30px
- Padding: `0 12px`
- Background: transparent (sits in toolbar)
- No border, no shadow
- Font: `t-body`, Inter 400, `text-secondary`
- Current crumb: `text-primary`, Inter 500
- Separator: middot character `·`, `t-small`, `text-tertiary`. Do not use `>` or `/`.
- Crumbs are click targets, hover changes label to `text-primary`
- Long paths truncate the second-to-current crumb with ellipsis if container width exceeded

Never use mono on breadcrumb. It is UI navigation, not raw path data.

---

## Section 15: Search field

```
Height: 30px
Width: 280px (default), expands if no other right-side toolbar items
Padding: 0 12px
Background: bg-content
Border: 1px border-subtle
Radius: 6px
Box-shadow: inset-recess
Display: flex, align-items center, gap 8px
```

Children (left to right):
- Icon: 14×14 Lucide `search`, `text-tertiary`
- Input: `t-body`, Inter 400, `text-primary`. Placeholder `text-tertiary`, "Search or ask anything..."
- Right slot: kbd hint pill

Kbd hint pill:
- 16×16 minimum, padding `0 4px`
- Background: `bg-raised`
- Border: 1px `border-subtle`
- Radius: 4px
- Text: `t-small` JetBrains Mono 500 `text-tertiary`, "⌘K" or "Ctrl K"

#### Search field states

**Hover**
- Border: `border-mid`
- Box-shadow: `inset-recess`

**Focus**
- Border: `accent-edge`
- Box-shadow: `inset-recess-strong, 0 0 0 3px var(--accent-glow)`
- Placeholder color: `text-secondary`

**Filled (has value)**
- Same border as focus
- No glow ring once unfocused
- Show clear button (12×12 Lucide `x`, `text-tertiary`, hover `text-primary`)

---

## Section 16: Command palette

```
Width: 640px
Max height: 480px
Background: bg-raised
Border: 1px border-subtle
Radius: 10px
Box-shadow: highlight-top, shadow-modal
```

### Top input

- Height: 44px
- Padding: `0 16px`
- Font: `t-title-sm`, Inter 400, `text-primary`
- No border on the input itself (the palette container is the visual frame)
- Bottom border: 1px `border-hairline` separating input from results

### Results area

- Padding: 4px
- Each result: 36px row, padding `0 12px`, `t-body` Inter 500
- Hover: `bg-pressed`
- Keyboard-selected: `accent-wash` background, 2px `accent` left bar
- Section heads: `t-micro` uppercase `text-tertiary`, padding `12px 12px 6px`

### Behavior

- Open animation: `dur-fast`, fade plus `translateY(4px)`, `ease-out`
- Backdrop scrim: `rgba(0, 0, 0, 0.4)`, fades in with palette
- Esc closes; click outside closes; selecting a result closes

---

## Section 17: Buttons (full set)

Every button (except ghost and icon-only) MUST have visible chrome at default state per Principle 9.

### Primary button

```
Height: 28px
Padding: 0 14px
Background: accent
Color: text-on-accent
Font: t-compact, Inter 600, tracking -0.01em
Border: 1px solid rgba(0, 0, 0, 0.20)
Radius: 6px
Box-shadow: highlight-top-strong, shadow-raised
Display: inline-flex, align-items center, gap 6px
```

States:
- Hover: background `accent-hover`, box-shadow gains lift (use `shadow-card` instead of `shadow-raised`)
- Press: `translateY(1px)`, box-shadow becomes `inset-recess`, duration `dur-press-down`
- Disabled: 40% opacity, no hover, no shadow change
- Focus: focus ring (Section 7) overlays the existing shadow

Leading icon (optional): 14×14 Lucide, currentColor

### Secondary button

```
Height: 28px
Padding: 0 12px
Background: bg-raised
Color: text-primary
Border: 1px solid border-subtle
Radius: 6px
Box-shadow: highlight-top, shadow-raised
Font: t-compact, Inter 500
```

States:
- Hover: background `bg-pressed`, border `border-mid`, shadow gains lift to `shadow-card`
- Press: `translateY(1px)`, shadow becomes `inset-recess`
- Disabled: 40% opacity
- Focus: focus ring

### Ghost button

```
Height: 28px
Padding: 0 10px
Background: transparent
Color: text-secondary
Border: none
Radius: 5px
Font: t-compact, Inter 500
```

States:
- Hover: `bg-raised` background, `highlight-top` inset, `text-primary` color
- Press: `bg-pressed` background, `inset-recess`
- Used for: toolbar nav (back/forward/up), inline cancel, secondary modal actions, "show all" links

### Icon button (sm / md / lg: 24 / 28 / 32)

```
Sizes: 24×24 / 28×28 / 32×32
Background: transparent (default)
Icon: 14 / 16 / 18 px (always centered)
Color: text-secondary
Border: none (default)
Radius: 5 / 6 / 6 px
```

States:
- Hover: `bg-raised`, `highlight-top` inset, icon `text-primary`
- Press: `bg-pressed`, `inset-recess`
- Toggle-active state: `accent-wash` background, 1px `accent-edge` border, icon `accent`
- Focus: focus ring

### Circular button (FAB-like, canvas controls)

```
Size: 40×40
Background: bg-raised
Border: 1px solid border-subtle
Radius: 999px
Box-shadow: highlight-top, shadow-card
Icon: 16×16 Lucide, text-secondary
```

States:
- Hover: `bg-pressed`, `border-mid`, shadow becomes `shadow-popover`, icon `text-primary`
- Press: `translateY(1px)`, shadow becomes `inset-recess`

### Danger button (destructive secondary variant)

Same chrome as secondary button, but:
- Border: 1px `bad-edge`
- Color: `bad`
- Icon: `bad`
- Hover: background `bad-wash`, full `bad` border (1px solid `bad`)
- Press: `bad-wash` plus `translateY(1px)` plus `inset-recess`
- Used only for: delete, remove, reset, destructive confirmations

---

## Section 18: Pills and badges

### Notification count badge (sidebar items)

```
Min: 18×18
Padding: 0 6px
Background: bg-raised
Border: 1px border-subtle
Color: text-secondary
Font: t-small JetBrains Mono 500
Radius: 4px
Box-shadow: highlight-top
```

Variant **accent** (used when count needs attention, like "Approvals 14"):
- Background: `accent-wash`
- Border: 1px `accent-edge`
- Color: `accent`

### Status pill (e.g., "scan idle", "live", "continues if you close the app")

```
Height: 20px
Padding: 0 10px
Background: bg-raised
Border: 1px border-subtle
Color: text-secondary
Font: t-small Inter 500
Radius: 999px
Box-shadow: highlight-top, shadow-raised
Display: inline-flex, align-items center, gap 6px
```

Optional leading dot: 6×6 circle, semantic color
Variant **live**: dot pulses 600ms once on activation, then steady

### AI sparkle badge (marks AI-generated tags)

- 10×10 sparkle glyph (Lucide `sparkles`)
- Color: `accent` always
- Sits 4px to the left of the AI-tagged element
- Never animates

---

## Section 19: Tag chips

### Default chip (file-type, system tags)

```
Height: 20px
Padding: 0 8px
Background: bg-pressed
Color: text-secondary
Font: t-small JetBrains Mono 400
Radius: 4px
Border: none
```

### Tinted chip (AI-suggested, pending action, project tags)

```
Same dimensions
Background: accent-wash
Color: accent
Border: 1px accent-edge
Box-shadow: highlight-top
```

### Semantic chips

| Variant | Background | Color | Border |
|---|---|---|---|
| `auto-filed` (success) | `good-wash` | `good` | `good-edge` |
| `conflict` (error) | `bad-wash` | `bad` | `bad-edge` |
| `warn` | `warn-wash` | `warn` | `warn-edge` |

All semantic chips include `highlight-top` inset shadow.

### Add-tag chip (the `+ add tag` placeholder)

- Same dimensions as default chip
- Background: transparent
- Border: 1px dashed `border-subtle`
- Color: `text-tertiary`
- Hover: `bg-raised`, solid `border-mid`, `text-secondary`

---

## Section 20: Tabs and segmented controls

### Segmented control (view mode toggle, inspector tabs as pills)

Container:
```
Height: 30px
Background: bg-content
Padding: 2px
Border: 1px border-subtle
Radius: 6px
Box-shadow: inset-recess
Display: inline-flex
```

Items (each segment):
```
Height: 26px
Padding: 0 12px
Font: t-compact Inter 500
Color: text-tertiary
Background: transparent
Border: none
Radius: 5px
```

Item states:
- Inactive: `text-tertiary`
- Hover (inactive): `text-secondary`
- Active item: `accent-wash` background, 1px `accent-edge` border, `accent` text, `highlight-top` inset, `shadow-raised`
- The active pill slides between items: `dur-slide`, `ease-out` (the signature motion)
- Content area for the selected segment: jump-cut on switch (NEVER fade panels)

### Underline tabs (Inspector: Preview / Tags / History)

Container:
```
Height: 44px
Background: transparent
Bottom border: 1px border-hairline
Display: flex
```

Items:
```
Padding: 0 16px
Full container height
Font: t-body Inter 500
```

Item states:
- Inactive: `text-secondary`
- Hover: `text-primary`
- Active: `text-primary` weight 600, plus 2px `accent` underline at bottom of tab (overlapping the baseline border)
- Underline slides between tabs: `dur-slide`, `ease-out`
- Content area: jump-cut on switch

---

## Section 21: Inputs

### Text input

```
Height: 30px
Padding: 0 12px
Background: bg-content
Border: 1px border-subtle
Radius: 6px
Box-shadow: inset-recess
Color: text-primary
Font: t-body Inter 400
Placeholder: text-tertiary
```

- Hover: `border-mid`
- Focus: `accent-edge` border, `inset-recess-strong` plus `0 0 0 3px var(--accent-glow)` ring
- Disabled: 50% opacity
- Error: `bad` border, `t-small bad` helper text below at 6px gap

### Textarea

- Same chrome as text input
- Min height: 72px
- Padding: `8px 12px`
- Resize: vertical only

### Select / dropdown

- Same chrome as text input
- Trailing 12×12 chevron-down icon, `text-tertiary`
- Open state: dropdown popover beneath, see Section 22

### Toggle switch

```
Width: 32px
Height: 18px
Track radius: 999px
Track off: bg-pressed, inset-recess
Track on: accent
Thumb: 14×14 circle, bg-raised, shadow-raised, 1px border-subtle
Thumb position transition: 120ms ease-snap
```

- Label: `t-body` Inter 400 `text-primary`, sits 10px to the left
- Disabled: 50% opacity

### Checkbox

```
Size: 16×16
Border: 1px border-strong
Background: bg-content
Radius: 4px
Box-shadow: inset-recess
```

- Checked: `accent` fill, white 12×12 Lucide `check`
- Indeterminate: `accent` fill, 8×2 white horizontal bar
- Focus: focus ring
- Label: `t-body` Inter 400 `text-primary`, 8px gap

### Radio

```
Size: 16×16
Border: 1px border-strong
Background: bg-content
Radius: 999px
Box-shadow: inset-recess
```

- Checked: 6×6 `accent` dot center, border stays
- Focus: focus ring

### Slider

```
Track height: 4px
Track background: bg-pressed
Track box-shadow: inset-recess
Track fill (left of thumb): accent
Track radius: 999px
Thumb: 14×14 circle, bg-raised, shadow-raised, 1px border-subtle
```

- Hover thumb: scale 1.1, `dur-flash`
- Active thumb (dragging): scale 1.15
- Optional value label on drag: `t-small` JetBrains Mono 500 `text-secondary`, 8px above thumb, follows position

---

## Section 22: Surfaces (cards, popovers, modals, inspector)

### Card

```
Background: bg-raised
Border: 1px border-subtle
Radius: 8px
Padding: 16px
Box-shadow: highlight-top, shadow-card
```

If interactive (clickable card):
- Hover: `bg-pressed` background, `border-mid`, `shadow-popover`, `dur-flash`
- Press: `translateY(1px)`, `inset-recess`

### Stat card (scan screen, dashboard metrics)

This was missing chrome in v1. The fix:

```
Background: bg-raised
Border: 1px border-subtle
Radius: 10px
Padding: 14px 16px
Box-shadow: highlight-top, shadow-card
Display: flex, flex-direction column, gap 4px
Min-width: 160px
```

Children:
- Label: `t-micro` uppercase `text-tertiary`
- Value: `t-display` JetBrains Mono 500 `text-primary`
- Optional unit: `t-small` JetBrains Mono 400 `text-secondary` inline with value

### Popover (dropdowns, hover-cards, menus)

```
Background: bg-raised
Border: 1px border-subtle
Radius: 8px
Box-shadow: highlight-top, shadow-popover
Padding: 6px (items have own padding)
Min width: 180px
Max width: 320px
```

- Open animation: `dur-fast`, fade plus `translateY(3px)`, `ease-out`
- Close: `dur-flash`, fade only

### Modal

```
Background: bg-raised
Border: 1px border-strong
Radius: 10px
Box-shadow: highlight-top, shadow-modal
Padding: 24px
Width: 480px (standard) or 640px (large)
```

- Backdrop scrim: `rgba(0, 0, 0, 0.5)`, fades in 180ms
- Open animation: `dur-slide`, fade plus `translateY(6px)`, `ease-out`
- Close: same in reverse, `dur-fast`
- Header: title `t-display-sm` Inter 600, optional close icon button top-right
- Footer: button group right-aligned, gap 8px

### Inspector panel

When **docked** (right side of content area):
- Background: `bg-content` (matches main work area)
- Left border: 1px `border-hairline` (provides separation from list area)
- Padding: 16px
- No outer shadow

When **detached** (floating, future feature):
- Background: `bg-raised`
- Border: 1px `border-subtle`
- Box-shadow: `highlight-top, shadow-popover`
- Radius: 10px

### Status bar (bottom of window)

```
Height: 24px
Background: bg-chrome
Top border: 1px border-hairline
Padding: 0 12px
Color: text-tertiary
Font: t-small Inter 400
Display: flex, align-items center, gap 12px
```

- Mono used for counts, sizes, file paths in status messages
- Right side: status pills (scan idle, approvals count) in `bg-raised` with chrome

---

## Section 23: File row (the most-used element)

```
Height: 26px (default density)
Padding: 0 12px
Background: transparent (sits on bg-content)
Display: grid, grid-template-columns: 16px 1fr 96px 120px minmax(0, 1fr)
Gap: 12px
Align-items: center
```

Columns:
- File icon: 16×16 (native Windows for branded files, Lucide for folders/generic, see Section 8)
- Name: `t-body` Inter 500 `text-primary`
- Size: `t-compact` JetBrains Mono 400 `text-secondary`, right-aligned in column
- Modified: `t-compact` JetBrains Mono 400 `text-secondary`
- Tags: chip group, gap 6px

#### File row states (this is where v1 most failed; restore properly)

**Default**
- Background: transparent
- No border
- No shadow

**Hover**
- Background: `bg-raised`
- Inset highlight: `highlight-top`
- Transition: `dur-flash`
- Cursor: default (not pointer; rows are not links)
- File row stays flat (no shadow); the background change alone confirms hover

**Selected (single)**
- Background: `accent-wash`
- 2px `accent` left bar (positioned 4px from row left, 4px shorter than row top/bottom)
- Inset highlight: `inset 0 1px 0 rgba(232, 150, 94, 0.10)` (subtle amber glow at top edge)
- File icon: shifts to `accent` for native and Lucide alike (apply CSS filter for native if needed: `filter: drop-shadow(0 0 0 var(--accent))`, otherwise leave native colored if filter degrades quality)
- Name color: `text-primary` unchanged
- **Instant** state change, no transition

**Selected (multi-contiguous)**
Same as single selected for each row.

**Selected + keyboard focused**
All selected styling plus focus ring on the row.

**Drag-target (file dragged over a folder row)**
- Background: `accent-wash-strong`
- 2px `accent-edge-strong` border full perimeter, radius 5px
- Folder icon scales 1.05 (the only file-row icon-scale exception, signals drop affordance)
- Transition: `dur-flash`

**AI just-filed (special transient state)**
- Row fades in over 200ms when first appearing in list
- 2px `accent` left bar fades from full opacity to 0 over `dur-info`
- Tooltip on hover during fade: "filed by AI 3s ago, click to undo"
- After fade-out, row settles to default state

**Disabled / unavailable (file deleted but in recent list)**
- All text: `text-tertiary`
- Italic name
- No hover state
- Cursor: not-allowed

**Deselection**
- Instant return to default state
- Triggered by: clicking elsewhere, pressing Esc, navigating away

---

## Section 24: List header

```
Height: 32px
Padding: 0 12px
Background: bg-content (becomes bg-chrome when sticky on scroll)
Bottom border: 1px border-hairline
Display: grid (matches file row column structure)
Align-items: center
```

- Column labels: `t-micro` Inter 500 +0.06em uppercase `text-tertiary`
- Sortable column: hover label gets `bg-raised` background (small radius 4px, padding 2px 6px), sort indicator chevron 10×10 to right of label
- Active sort column: label `text-secondary`, chevron `accent`

---

## Section 25: Status indicators

### Live dot

```
Size: 6×6
Border-radius: 999px
Color: good (healthy) | accent (active) | bad (error)
```

- Pulse on state-change only: 600ms scale `1 → 1.4 → 1` plus opacity `1 → 0.4 → 1`
- Steady when running

### Status text

- `t-small` Inter 400 `text-tertiary`
- Mono only for the numeric portion (e.g., "14 approvals" with "14" in mono)

### Linear progress bar

```
Height: 4px
Track background: bg-pressed
Track box-shadow: inset-recess
Fill: accent (default), good (success completion), bad (error)
Radius: 999px
```

- Width transitions: `dur-fast`, linear (matches data updates)
- Indeterminate variant: shimmer 1500ms linear infinite, gradient from `accent-wash` to `accent` to `accent-wash`

### Scan stage checklist (large progress)

Each stage is a row, 36px tall:

Leading: 24×24 circle
- Empty (pending): `bg-pressed` background, `border-subtle`, number in `t-small` `text-tertiary` JetBrains Mono 500
- Current: `accent-wash` background, 1px `accent-edge`, `highlight-top`, number in `accent`
- Complete: `good` filled, 12×12 white check icon, `highlight-top`

Label: `t-read` Inter 500
- Active or done: `text-primary`
- Pending: `text-tertiary`

Right-aligned meta: `t-compact` JetBrains Mono 500 `text-secondary` (e.g., "95% · ETA 2m"). Active stage uses `accent` for percentage.

Inline progress bar below label (only on active stage), full row width minus icon column, 4px tall.

---

## Section 26: Tooltips

```
Background: bg-raised
Border: 1px border-subtle
Radius: 6px
Padding: 6px 10px
Box-shadow: highlight-top, shadow-popover
Color: text-primary
Font: t-small Inter 400
Max width: 240px
```

- Show delay: 400ms
- Hide delay: 0ms
- Open animation: 80ms fade only, no movement
- Position: above element by default, flips if no room

---

## Section 27: Context menu

```
Background: bg-raised
Border: 1px border-subtle
Radius: 8px
Box-shadow: highlight-top, shadow-popover
Padding: 4px
Min width: 180px
```

- Open animation: 80ms fade only, no movement (faster than popover; user expects immediacy on right-click)

### Menu item

```
Height: 28px
Padding: 0 10px
Color: text-primary
Font: t-compact Inter 500
Radius: 5px
Display: flex, align-items center, gap 10px
```

- Optional leading icon: 14×14 `text-secondary`
- Optional trailing kbd shortcut: `t-small` JetBrains Mono 500 `text-tertiary`, right-aligned
- Hover: `accent-wash` background, label and icon shift to `accent`
- Disabled: 40% opacity, no hover
- Destructive variant: label `bad`, hover `bad-wash` background, `bad` text

### Separator

- Height: 1px
- Margin: `4px 0`
- Background: `border-subtle`

### Submenu indicator

- 10×10 chevron-right icon, `text-tertiary`, right-aligned
- Submenu opens to the right with same chrome

---

## Section 28: Brand mark

### Logo construction

- Source: 24×24 SVG, single shape
- Background: amber gradient `linear-gradient(135deg, #E8965E, #F0A574)`
- Foreground: 12×12 simplified mark (folder or stylized "F"), fill `text-on-accent`
- Container radius: 4px (small contexts) or 6px (full mark in onboarding)

### Sizes (must use explicit width/height, not inherited)

| Context | Container size |
|---|---|
| Window titlebar | 14×14 |
| Notification, popover header | 16×16 |
| Sidebar header | 24×24 |
| Tray popout header | 22×22 |
| Onboarding hero | 48×48 |
| About screen | 96×96 |

### Wordmark

- Inter 600, tracking `-0.02em`
- Always paired with mark when introduced
- Mark may stand alone in tight spaces (titlebar, tray)

---

## Section 29: Empty state

For empty list, empty inspector, no search results, blank Recent.

- Container: centered vertically and horizontally in available space
- Icon (optional): 48×48 Lucide outlined, `text-tertiary`
- Title: `t-title-sm` Inter 600 `text-primary`
- Description: `t-body` Inter 400 `text-secondary`, max width 360px, line-height 1.5
- Optional CTA: secondary or primary button below at 16px gap
- Spacing between elements: 12px

---

## Section 30: Notification / toast

```
Position: bottom-right, 16px from window edges
Width: 360px
Background: bg-raised
Border: 1px border-subtle (default), accent-edge (action), bad-edge (error)
Radius: 8px
Box-shadow: highlight-top, shadow-popover
Padding: 12px 14px
```

- Title: `t-body` Inter 600 `text-primary`
- Body: `t-compact` Inter 400 `text-secondary`
- Optional leading icon: 16×16, semantic color (or `accent` for AI actions)
- Auto-dismiss: 5s default, 8s for action notifications, never for errors (manual dismiss)
- Open animation: `dur-slide`, slide-in from right 12px plus fade
- Close animation: `dur-fast`, fade only
- Stacked toasts: 8px gap, newest on top

---

## Section 31: Tray popout

Smaller floating window, anchored to system tray icon. Same tokens as main app, with tighter scope.

```
Width: 380px
Max height: 560px
Background: bg-backdrop
Border: 1px border-strong
Radius: 12px
Box-shadow: shadow-modal
Position: anchored to tray icon (bottom-right of screen, with arrow pointing down)
```

### Header

- Padding: 14px
- Background: `bg-chrome`
- Bottom border: 1px `border-hairline`
- Layout: 22×22 brand mark + title "Recent downloads" + path subtitle, expand button right (14×14 Lucide `arrow-up-right`)

### Active download (if downloading)

- Standalone block at top, padding `12px 14px`
- Background: `accent-wash`
- Border-bottom: 1px `border-hairline`
- 18×18 Lucide `arrow-down` leading icon in `accent`
- Inline progress bar: 4px tall, `accent` fill on `bg-pressed` track
- Filename: `t-body` Inter 600 `text-primary`
- Size progress: `t-compact` JetBrains Mono 400 `text-secondary` (e.g., "1.3 / 2.1 MB")

### Just-finished section

- Section label: `t-micro` "JUST FINISHED" with relative time right-aligned
- File card: `bg-raised`, radius 8px, padding 12px, contains 32×32 file icon + name + size + source
- Action button row below card: Drag, Open, Reveal, Copy

#### Tray action buttons (the v1 fix point)

```
Each button: secondary button chrome (Section 17)
Height: 36px (slightly larger than standard for touch comfort)
Padding: 0 12px
Display: flex column, align-items center, gap 4px
Equal width across the row of 4 buttons
Background: bg-raised
Border: 1px border-subtle
Box-shadow: highlight-top, shadow-raised
```

Each button contains:
- Icon: **16×16, max 18×18** Lucide outline, `text-secondary`
- Label below: `t-small` Inter 500 `text-secondary`

This is the v1 bug. Set the icon size explicitly. Do not let SVG inherit width.

### Earlier today section

- Section label: `t-micro` "EARLIER TODAY", "show all" link right-aligned
- Standard file rows, 32px height (slightly taller than main app for tray context)
- Each row: 16×16 file icon, name, meta (size + source), relative time right-aligned
- Each row may have a status chip below (pending approval, auto-filed, etc.)

### Footer

- Padding: 10px 14px
- Background: `bg-chrome`
- Top border: 1px `border-hairline`
- Layout: 28×28 icon buttons (folder, search) left, primary "Open File Explorer" button center, 28×28 settings icon button right

---

## Section 32: Onboarding screens

- Full-window takeover
- Background: `bg-backdrop`
- Padding: 80px (uniform)
- Max content width: 560px, centered
- Hero icon: 64×64 brand mark or Lucide outlined icon, `accent` color
- Title: `t-display`, Inter 600
- Body: `t-read`, Inter 400, `text-secondary`, line-height 1.6
- Step indicator: 6px dots at top, 8px gap, `accent` for current, `bg-pressed` for inactive
- Primary CTA: large primary button (36px tall, 14px font), centered or right-aligned
- Skip link: ghost button below, `text-tertiary`

---

## Section 33: Scrollbars

Custom-styled. Do not use OS default.

```
Track: transparent
Thumb: bg-pressed
Thumb hover: rgba(255, 255, 255, 0.18)
Width: 8px (vertical and horizontal)
Thumb radius: 999px
Margin: 2px from edges
```

- Auto-hide: fade out after 1500ms of no scroll
- Fade in on hover within 50px of edge
- Always visible during active scroll

---

## Section 34: Dividers

Used very sparingly. Default to spacing for separation.

#### Where dividers may appear

- Between sections in a popover/menu (1px `border-subtle`, margin `4px 0`)
- Above the status bar (1px `border-hairline`)
- Inspector panel section headers may have a bottom hairline (1px `border-hairline`)
- Tray popout sections (1px `border-hairline`)

#### Where dividers never appear

- Between file rows
- Between toolbar items
- Inside a card
- Between sidebar items

---

## Section 35: File Tree canvas (special spatial view)

The canvas is a different mode. Most rules above apply, with these additions.

### Canvas background

- Background: `bg-content`
- Optional 24px grid: 1px lines at `rgba(255, 255, 255, 0.025)`, only visible at >75% zoom

### Node (folder card on canvas)

```
Width: 120px (small) | 160px (medium) | 200px (large, rare)
Height: auto, min 80px
Background: bg-raised
Border: 1px border-subtle
Radius: 8px
Padding: 14px
Box-shadow: highlight-top, shadow-card
```

- Icon: 20×20 Lucide folder, `accent`
- Name: `t-body` Inter 500 `text-primary`
- Meta: `t-small` JetBrains Mono 400 `text-secondary` (size or count)
- Hover: `bg-pressed`, `border-mid`, `shadow-popover`
- Selected: 1px `accent-edge` border, `accent-wash` background, `highlight-top` plus subtle amber inset

### Connection lines (parent-to-child)

- Stroke: `rgba(255, 255, 255, 0.12)`
- Width: 1px
- Style: orthogonal (90° turns), no curves
- Selected branch: `accent` stroke, 1.5px

### Canvas toolbar (zoom, fit, changes)

- Same chrome as the Approvals pill (rounded, raised, with `highlight-top-strong, shadow-raised`)
- Zoom %: `t-small` JetBrains Mono 500
- Pan/zoom: 1:1 input, no inertia (per Principle 6)

---

## Section 36: Loading states

For lists or panels loading data:

### Skeleton row

- Same dimensions as the eventual content row (26px for file rows)
- Background: `bg-raised` (subtle, sits one tier above content surface)
- Inside: 2-3 grey blocks where text would be, varying widths (60%, 40%, 30% of column)
- Block color: `bg-pressed`
- Block radius: 4px
- Shimmer animation: linear gradient sweep, 1500ms infinite, ease-in-out
- Shimmer respects reduced motion (becomes static `bg-pressed` blocks)

### Spinner

Used for inline async actions, never for full-screen loading (use skeletons instead).

- Size: 14×14 (inline) or 16×16 (button-replacing)
- Stroke: 1.5px
- Color: `currentColor` (inherits from parent)
- Rotation: 1000ms linear infinite
- Respects reduced motion (becomes static)

---

## Section 37: Selection summary across the app

Across all selectable elements (file rows, sidebar items, canvas nodes, list items in popovers, tab items):

- **Selected** state uses `accent-wash` background plus accent left bar (or border for canvas nodes) plus accent on icon. Optional subtle amber inset highlight.
- **Hover** state uses `bg-raised` background, neutral. Optional `highlight-top` inset.
- These two must always be visually distinct: hover is a brighter neutral wash, selection is amber-tinted.
- **Multi-select** repeats single-select styling per item; no special "first/middle/last" treatment.
- **Deselection** is instant (no animation): triggered by click-elsewhere, Esc key, navigating away, or explicit deselect.
- **Keyboard focus** (when present alongside selection) adds the focus ring on top of selection styling.

---

## Section 38: Focus ring

Keyboard-only (use `:focus-visible`, never `:focus` for mouse interactions).

```
box-shadow:
  0 0 0 2px var(--bg-content),
  0 0 0 4px var(--accent-glow);
```

Universal across all interactive elements. Do not vary per component.

When focus appears on a chrome element with existing shadow, append the focus ring shadow to the existing stack: do not replace the chrome shadows.

---

## Section 39: Clickability rules (non-negotiable)

Every interactive element in the app must satisfy at least one of the following at default state. If an element fails all four, it is not visibly clickable and the spec has been violated.

### The four indicators of interactivity

1. **A visible border** at `border-subtle` or stronger (not `border-hairline`)
2. **A background fill** distinct from the parent surface (uses `bg-raised`, `bg-pressed`, or any `*-wash` variant)
3. **An accent-colored icon or label** (icon or text in `accent` color)
4. **Visible chrome treatment** (the convex shadow plus highlight composition from Part 3)

### Examples

- Primary button: passes all four (border + fill + chrome + amber fill)
- Secondary button: passes 1, 2, and 4 (border + fill + chrome)
- Ghost button: passes 4 only on hover. At default state, ghost buttons MUST sit in a context where their interactivity is implied (toolbar, button group). If a ghost button is standalone, use a secondary button instead.
- Icon button: passes 4 only on hover. Same constraint as ghost.
- File row: NOT a button per se. Passes 2 only on hover/select. The file row is read-content, the action affordance comes from the row being clearly part of a clickable list.
- Sidebar item: passes 2 (background) on hover and active, plus 3 (accent left bar) on active.
- Approvals pill: passes all four.
- Tab pill (active): passes all four.
- Tab pill (inactive): passes 1 (within the segmented control container border) and is implied by being inside a segmented control.

### Audit question

For every interactive element in your output, ask: "could a user know this is clickable from a screenshot, with no hover state visible?" If the answer is no, fix it.

---

## Section 40: CSS custom properties export

Implement these as CSS variables. The receiving chat may use a CSS-in-JS system, Tailwind, or plain CSS; map naming conventions accordingly.

```css
:root {
  /* surfaces */
  --bg-backdrop: #181522;
  --bg-chrome: #1F1B27;
  --bg-content: #25202D;
  --bg-raised: #312A38;
  --bg-pressed: #3B3344;

  /* accent */
  --accent: #E8965E;
  --accent-hover: #F0A574;
  --accent-press: #D88248;
  --accent-wash: rgba(232, 150, 94, 0.10);
  --accent-wash-strong: rgba(232, 150, 94, 0.18);
  --accent-edge: rgba(232, 150, 94, 0.40);
  --accent-edge-strong: rgba(232, 150, 94, 0.55);
  --accent-glow: rgba(232, 150, 94, 0.20);

  /* text */
  --text-primary: #F2EDE8;
  --text-secondary: #A39BAE;
  --text-tertiary: #6B6478;
  --text-on-accent: #1A1015;
  --text-on-good: #0F2E18;
  --text-on-bad: #3D0F0D;

  /* semantic */
  --good: #7DC494;
  --good-wash: rgba(125, 196, 148, 0.10);
  --good-edge: rgba(125, 196, 148, 0.40);
  --bad: #E08A86;
  --bad-wash: rgba(224, 138, 134, 0.10);
  --bad-edge: rgba(224, 138, 134, 0.40);
  --warn: #E8C56B;
  --warn-wash: rgba(232, 197, 107, 0.10);
  --warn-edge: rgba(232, 197, 107, 0.40);

  /* borders */
  --border-hairline: rgba(255, 255, 255, 0.06);
  --border-subtle: rgba(255, 255, 255, 0.09);
  --border-mid: rgba(255, 255, 255, 0.13);
  --border-strong: rgba(255, 255, 255, 0.18);

  /* highlights and depth (inset, used in chrome compositions) */
  --highlight-top: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --highlight-top-strong: inset 0 1px 0 rgba(255, 255, 255, 0.10);
  --depth-bottom: inset 0 -1px 0 rgba(0, 0, 0, 0.18);
  --inset-recess: inset 0 1px 2px rgba(0, 0, 0, 0.30);
  --inset-recess-strong: inset 0 2px 4px rgba(0, 0, 0, 0.40);

  /* outer shadows */
  --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.30), 0 0 0 1px rgba(0, 0, 0, 0.15);
  --shadow-card: 0 2px 6px rgba(0, 0, 0, 0.25), 0 1px 2px rgba(0, 0, 0, 0.20);
  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.40), 0 2px 6px rgba(0, 0, 0, 0.25);
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.35);
  --shadow-window: 0 24px 64px rgba(0, 0, 0, 0.60), 0 8px 24px rgba(0, 0, 0, 0.40);

  /* radii */
  --r-chip: 4px;
  --r-icon-btn: 5px;
  --r-button: 6px;
  --r-card: 8px;
  --r-modal: 10px;
  --r-window: 10px;
  --r-tray: 12px;
  --r-pill: 999px;

  /* motion */
  --dur-flash: 60ms;
  --dur-press-down: 50ms;
  --dur-press-up: 80ms;
  --dur-fast: 120ms;
  --dur-slide: 180ms;
  --dur-pulse: 400ms;
  --dur-info: 1500ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-snap: cubic-bezier(0.4, 0.0, 0.2, 1);

  /* fonts */
  --font-ui: 'Inter', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Geist Mono', 'SF Mono', Consolas, monospace;
}

[data-theme="light"] {
  --bg-backdrop: #F5F1EC;
  --bg-chrome: #EDE8E1;
  --bg-content: #F8F4EF;
  --bg-raised: #FFFFFF;
  --bg-pressed: #E8E2DA;

  --text-primary: #1F1A22;
  --text-secondary: #5D5466;
  --text-tertiary: #9A93A4;

  --border-hairline: rgba(0, 0, 0, 0.06);
  --border-subtle: rgba(0, 0, 0, 0.09);
  --border-mid: rgba(0, 0, 0, 0.14);
  --border-strong: rgba(0, 0, 0, 0.18);

  --highlight-top: inset 0 1px 0 rgba(255, 255, 255, 0.55);
  --highlight-top-strong: inset 0 1px 0 rgba(255, 255, 255, 0.65);
  --depth-bottom: inset 0 -1px 0 rgba(0, 0, 0, 0.06);
  --inset-recess: inset 0 1px 2px rgba(0, 0, 0, 0.06);
  --inset-recess-strong: inset 0 2px 4px rgba(0, 0, 0, 0.10);

  --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04);
  --shadow-card: 0 2px 6px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-popover: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
  --shadow-modal: 0 16px 48px rgba(0, 0, 0, 0.18), 0 4px 12px rgba(0, 0, 0, 0.10);
  --shadow-window: 0 24px 64px rgba(0, 0, 0, 0.20), 0 8px 24px rgba(0, 0, 0, 0.12);

  /* accent and semantic stay the same */
}
```

---

## Section 41: Implementation audit checklist

After applying this spec, verify each line below. Every line must pass. If any fail, fix before declaring complete.

### Window and chrome

- [ ] The application window has a custom titlebar, 32px tall, with app icon, title text, and three window controls (minimize, maximize, close)
- [ ] Native Windows chrome is disabled (Electron `frame: false`)
- [ ] The window has a visible 1px border at `border-strong` and a 10px corner radius
- [ ] The window has a drop shadow (`shadow-window`)

### Sidebar

- [ ] Sidebar is 240px wide expanded, 52px collapsed
- [ ] A 1px `border-hairline` exists between the sidebar's right edge and the content area
- [ ] Sidebar items show a `bg-raised` background with `highlight-top` inset on hover
- [ ] The active sidebar item shows a 2px `accent` left bar plus `bg-pressed` background plus `highlight-top` inset
- [ ] The active bar slides between active items at `dur-slide` ease-out
- [ ] Section labels are uppercase `t-micro` `text-tertiary`

### Toolbar and Approvals pill

- [ ] The Approvals pill has a `bg-raised` background, 1px `border-subtle`, full 999px radius, `highlight-top-strong` inset, `shadow-raised` outer shadow
- [ ] The Approvals pill count badge is amber-filled with `text-on-accent` text
- [ ] On increment, the Approvals badge pulses scale `1 → 1.15 → 1` over 400ms

### Buttons

- [ ] Every primary button has amber background, `highlight-top-strong`, `shadow-raised`, 6px radius
- [ ] Every secondary button has `bg-raised` background, 1px `border-subtle`, `highlight-top`, `shadow-raised`
- [ ] Ghost and icon buttons have no chrome at default but acquire `bg-raised` plus `highlight-top` on hover
- [ ] Press state on every button: `translateY(1px)` plus `inset-recess` shadow swap

### File rows

- [ ] Default row height is 26px (not 28px from v1)
- [ ] Hover state shows `bg-raised` background with `highlight-top` inset
- [ ] Selected state shows `accent-wash` background, 2px `accent` left bar, accent-tinted icon
- [ ] Hover and selected states are visually distinct (one is neutral, one is amber)
- [ ] No borders between rows

### Cards and surfaces

- [ ] Every card has 1px `border-subtle`, `highlight-top`, `shadow-card`
- [ ] Stat cards on the scan screen have visible chrome (border + shadow + highlight)
- [ ] Popovers have `shadow-popover`
- [ ] Modals have 1px `border-strong` and `shadow-modal`

### Inputs

- [ ] The search field shows `inset-recess` shadow (concave, recessed)
- [ ] On focus, the search field shows `accent-edge` border plus `inset-recess-strong` plus `0 0 0 3px accent-glow` ring
- [ ] All text inputs use the same concave chrome formula

### Icons

- [ ] All Lucide icons render at explicit `width` and `height` (never inherit from container)
- [ ] Tray popout action button icons render at 16×16, never larger than 18×18
- [ ] No Lucide icon renders below 14px display size
- [ ] File icons in lists use native Windows extraction for branded files (.exe, .psd, .logicx, etc.) and Lucide for folders/generic
- [ ] Brand mark renders at the size specified for its context, never inherited

### Tabs and segmented controls

- [ ] Active segmented control item has `accent-wash` background, 1px `accent-edge`, `accent` text
- [ ] Active pill or underline slides between tabs at `dur-slide` ease-out
- [ ] Tab content swaps via jump-cut, never fades

### Motion

- [ ] Hover transitions are 60ms, not longer
- [ ] Press translateY is 50ms down, 80ms up
- [ ] Panel and tab content swaps are instant (no fade)
- [ ] `prefers-reduced-motion: reduce` collapses all transitions to 0.01ms except AI-filed border, badge pulse, and live data graphs

### Clickability

- [ ] Every interactive element passes Section 39's clickability test at default state
- [ ] No element relies on hover-only state to communicate that it is clickable

### Typography

- [ ] UI font is Inter, applied to all chrome and body text
- [ ] Mono font is used only for: file sizes, timestamps, paths, hashes, file counts, kbd shortcuts, AI confidence values, throughput numbers, tag chip text
- [ ] Mono is NOT used for: button labels, breadcrumbs, file names, screen titles, sidebar labels, tooltips

### Color

- [ ] No element uses pure white (`#FFFFFF`) in dark mode
- [ ] Amber accent hex (`#E8965E`) is identical in light and dark mode
- [ ] No additional accent colors have been introduced beyond amber, good, bad, warn

End of spec.
