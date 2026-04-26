# FilePlus — UI Specification (canonical)

**Status:** Canonical source of truth.
**Date last updated:** 2026-04-25.
**Supersedes:** `docs/design-brief.md` (kept in place; see history). `docs/finalization-spec.md` (to be archived under `docs/archive/finalization-spec-v0.md` per Task A17 of the foundation plan).
**Decision register:** [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md) §2.
**Tokens:** [docs/design-tokens.md](design-tokens.md).

This document describes every screen, surface, overlay, and component in FilePlus v1. It is the only doc Impeccable sessions audit against.

---

# PART A — UI Design Brief

## A.0 Aesthetic baseline

- Tool, not toy. Warm muted purple base with a single warm amber accent. Tactile chrome, flat content. Every chrome element combines border, inner highlight, and subtle shadow. File rows and data surfaces stay flat.
- Multi-layered, subtle bevels on interactive elements. Buttons, cards, popovers, and the Approvals pill feel "convex" (light from above, subtle drop shadow). Text inputs and the search field feel "concave" (inset recess). File rows and content lists stay flat.
- Blur is reserved for overlays only (modals, command palette, tooltips, popovers, tray popout). Panels, the sidebar, the toolbar, and file lists do not use blur.
- Inter for UI, JetBrains Mono for paths, timestamps, file sizes, hashes, file counts, keyboard shortcuts, and tag chip text.
- No emoji in UI chrome (file names rendered by the OS may show emoji).
- Single accent: defaults to amber `#E8965E`. No gradient. The active accent value is read from a `--accent` CSS custom property; users may override it with a custom hex via Settings → Personalization (see §A.12.1). The same active accent value is used in both light and dark mode for identity consistency. Brand identity is the design language as a whole, not a single locked color.
- Semantic state colors:
  - Neutral / unprocessed: `text-tertiary` grey
  - Active / in-progress / selected: `accent` (amber)
  - Needs attention / low confidence: `warn` (muted gold)
  - Success: `good` (muted green)
  - Error / failed: `bad` (muted coral)
- Border radius scale:
  - 4px: chips, small badges
  - 5px: icon buttons, file row selection bar
  - 6px: standard buttons, search field, segmented control items, sidebar items
  - 8px: cards, popovers, context menus, inspector panels
  - 10px: modals, command palette, stat cards, window corners
  - 12px: tray popout
  - 999px: Approvals pill, status pills, toggle thumbs, avatars
- Spacing base: 2px, working scale 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64.
- Window: frameless custom titlebar, dark by default, light mode fully supported (warm cream, not pure white). Native Windows chrome is disabled.

For the complete token set (color hex values, chrome composition formulas, typography scale, motion durations, icon sizing, audit checklist), reference the **FilePlus Design Tokens v2 spec** which accompanies this document. Any specific styling question not covered here is answered there.

---

## A.1 Global chrome (every main app screen)

### A.1.1 Titlebar (32px tall)
- App name "FilePlus" left-aligned with brand mark (14×14)
- Title text in `t-compact`, Inter 500, `text-secondary`
- Drag region across the rest
- Window controls (min / max / close) right-aligned, custom-styled (see Section 9 of v2 token spec). Native Windows chrome disabled.
- No menu bar
- Window controls: 32×32 ghost icon buttons with 12×12 Lucide icons. Close button hover uses `#C0392B` at 80% alpha. Min/max hover uses `bg-raised`.

### A.1.2 Tab bar (32px tall, below titlebar)
- Explorer-style tabs
- Each tab: 14×14 Lucide folder icon, folder name in `t-body` Inter 500, 12×12 close (×) icon on hover
- Active tab: 2px `accent` underline at bottom, `bg-content` background (matches work area, visually "connects" tab to content below)
- Inactive tabs: `bg-chrome` background, `text-secondary` label
- Underline slides between tabs at `dur-slide` with `ease-out` (the signature tab motion). Tab content swap is instant (jump-cut).
- "+" new tab button right of last tab: 24×24 ghost icon button with 14×14 Lucide `plus`
- Drag tab to reorder
- Drag a file onto a tab → switches to that tab after 600ms hover (file still held)
- Right-click tab: Duplicate, Close, Close others, Close to right, Move to new window
- Middle-click tab: close
- Ctrl+T new, Ctrl+W close, Ctrl+Shift+T reopen closed

### A.1.3 Sidebar (240px wide, collapsible to 52px icon-only)
- Header (56px tall): 24×24 brand mark + "FilePlus" in `t-body` Inter 600 + subtitle in `t-small` Inter 400 `text-tertiary` (drive portion in JetBrains Mono, format: "D:\ · 214k indexed") + 22×22 collapse toggle right
- 1px `border-hairline` right edge (the single structural seam in the app, only required panel-to-panel border)
- Section labels: `t-micro` uppercase +0.06em `text-tertiary`
- **Quick Access section:**
  - Home
  - Review Bin (count badge with `accent-wash` background and `accent-edge` border if non-zero)
  - User-pinned folders (drag to reorder)
- **Tree section:**
  - Detected drives (C:\, D:\, etc.) with used/total bars (use `bg-pressed` track, `accent` fill)
  - Each drive expands to show its top-level folders
  - AI-organized branches get a 6px `accent` dot at right of label
  - 14×14 Lucide `chevron-right` caret on each folder for expand, rotates 90° instantly on expand
- **Tags section:**
  - Top tags as tag chips per the chip spec (see v2 token spec Section 19), with counts in JetBrains Mono
  - "View all" opens Tag Canvas overlay
- **System section** (bottom anchor, above Everything Folder + Settings):
  - File Tree (canvas)
  - Scan
- **Bottom anchor (always visible at bottom of sidebar):**
  - Everything Folder button (with count badge for unprocessed; badge uses `bad-wash` background and `bad` text + `bad-edge` border if errors)
  - Settings button

Sidebar items per v2 token spec Section 10: 28px tall, 6px radius, 16×16 Lucide icon, `t-body` Inter 500 label. Hover: `bg-raised` background with `highlight-top` inset. Active: `bg-pressed` background with `highlight-top` inset plus 2px `accent` left bar (4px from edge, floats shorter than row for "detached" feel) and label weight bumps to Inter 600. The active bar slides between active items at `dur-slide` ease-out.

### A.1.4 Toolbar (48px tall, below tab bar)
- Back / Forward / Up nav buttons (left): 28×28 icon buttons with 16×16 Lucide icons
- Breadcrumb / address bar (flex grow): segments in `t-body` Inter 400 `text-secondary` with current crumb in Inter 500 `text-primary`. Separator is middot `·` in `t-small text-tertiary` (never `>` or `/`). Segments clickable, draggable, right-click for sibling dropdown. Click empty area → editable address bar with autocomplete (path portion in JetBrains Mono when editing).
- Search box right (280px default): concave chrome (`bg-content` + `inset-recess` + 1px `border-subtle`). 14×14 Lucide `search` leading. `Ctrl+K` kbd hint trailing in 16×16 `bg-raised` pill with 4px radius, `t-small` JetBrains Mono 500 `text-tertiary`. Focus: `accent-edge` border + `inset-recess-strong` + `0 0 0 3px accent-glow` ring.
- View toggle: List / Grid segmented control (30px tall, concave container, convex active pill, active pill slides between segments at `dur-slide`)
- Inspector toggle button (rightmost): 28×28 icon button

### A.1.5 Status bar (24px tall, bottom)
- Background: `bg-chrome`, top border: 1px `border-hairline`
- Left: file count, selection count, total size of selection (numeric portions in JetBrains Mono)
- Center: background task indicator ("Indexing 12% · 8m" with subtle pulse on the live dot only)
- Right: Review Bin count if non-zero (as status pill with `accent-wash` variant), keyboard hints in `t-small` Inter 400 `text-tertiary`

---

## A.2 Screen 1 — Home (default landing)

Three sub-tabs at the top of the screen content area: Recent (default), Favorites, Shared (disabled, "v2" tooltip). Tabs use the underline tab style (44px tall container, 2px `accent` underline slides between active tabs, 1px `border-hairline` baseline).

### A.2.1 Recent sub-tab
Grouped vertical scroll: Today, Yesterday, This week, Earlier this month, Older.

Each section: header in `t-title-sm` Inter 600 `text-primary` with "view all →" ghost link right-aligned (`t-body` Inter 500 `text-secondary`, hover `text-primary`).

Each row (26px default density): 16×16 file icon (native Windows extract for branded files, Lucide for generic/folders), filename in `t-body` Inter 500 `text-primary`, path in `t-compact` JetBrains Mono 400 `text-tertiary` (ellipsized), action+time ("opened 11:20") in `t-compact` JetBrains Mono 400 `text-secondary`, tag chip stack.

Selected row: `accent-wash` background, 2px `accent` left bar (4px from edge, 4px shorter than row). Instant state change.

Hover: `bg-raised` background + `highlight-top` inset, `dur-flash` transition. Per-row hover actions appear at right: 24×24 ghost icon buttons (Open, Reveal, Copy path) with 14×14 Lucide icons.

Empty state: 48×48 Lucide outlined icon in `text-tertiary` + "Nothing here yet." in `t-title-sm` Inter 600 + "Files you open will appear in this list." in `t-body` Inter 400 `text-secondary` (max 360px width).

### A.2.2 Favorites sub-tab
Same row layout as Recent.
No time grouping. Manual order, drag to reorder.
14×14 Lucide `star-filled` icon at right of each row in `accent` color. Click unfavorites (star fills → empties, row fades, removes after 200ms).
Empty state: "Right-click any file or folder to add it here."

### A.2.3 Shared sub-tab
Disabled, tooltip "Cloud and network shared files coming in a future version."
Tab label: `text-tertiary` with 40% opacity. No hover state.

---

## A.3 Screen 2 — Browser

Three-pane: sidebar (already part of global chrome), file list (center), inspector (right, collapsible).

### A.3.1 File list (center pane)

**List view columns:** name, size, date modified, tags. Sortable headers.

List header per v2 token spec Section 24: 32px tall, `bg-content` background (becomes `bg-chrome` when sticky), 1px `border-hairline` bottom. Column labels in `t-micro` Inter 500 +0.06em uppercase `text-tertiary`. Active sort column: label `text-secondary`, 10×10 chevron in `accent`.

**Grid view:** thumbnail tiles with filename below in `t-body` Inter 500, tag chip stack at bottom of tile. Tiles use `bg-content` background with 8px radius and 1px `border-subtle` on hover only. Selected tile: `accent-wash` background + 1px `accent-edge` perimeter.

**Tag chip visual (poker-chip stack):** Each chip is a 14px circle in its tag color. Stack ordered by importance (system → AI → user), overlapping by 8px. Chips use semantic wash backgrounds (`accent-wash` for project/AI tags, `good-wash` for system confirmations, `bad-wash` for conflicts) with 1px matching edge borders. Hover the stack: chips fan out vertically below the row with 4px gap between chips, each labeled in `t-small` JetBrains Mono 500 matching the chip color. Fan-out animation: 120ms stagger (30ms per chip), `ease-out`. Click a chip: filter list by that tag.

**Row interactions:**
- Single click: select (instant `accent-wash` background + 2px `accent` left bar, file icon shifts to `accent`)
- Double click: open (configurable to single-click in Settings)
- Slow double-click on selected row: inline rename
- Ctrl+click: extend multi-select
- Shift+click: range select
- Marquee (drag from empty area): rectangular multi-select. Marquee rectangle: `accent-wash-strong` fill, 1px `accent-edge` border, 4px radius.
- Drag selected: reparent to drop target. Drop-target row: `accent-wash-strong` background, 2px `accent-edge-strong` full perimeter border, folder icon scales to 1.05 (the only row-icon scale exception).
- Right-click: context menu (see A.10)

**When inspector opens, list compacts:** Size / Modified / Tags collapse into a single right-aligned mono line per row (e.g., `2.1 MB · 2d` in `t-compact` JetBrains Mono 400 `text-secondary`). Tag chip stack stays inline as the poker-chip visual. When inspector closes, full columns restore. The column transition is instant (jump-cut), not animated.

### A.3.2 Inspector (right pane, closed by default)

Per v2 token spec Section 22:
- Docked: `bg-content` background (matches work area), 1px `border-hairline` left edge, 16px padding, no outer shadow
- Detached: `bg-raised` background, 1px `border-subtle`, 10px radius, `highlight-top` + `shadow-popover`

Behavior:
- Opens on first file click (jump-cut, no slide animation)
- Stays open across selections until manually closed
- Push-style: file list shrinks to accommodate
- Width default 340px, resizable via drag handle on left edge (min 280, max 520). Drag handle: 4px wide hit area, `accent` color on hover.

**Header:**
- File preview area (16:10 aspect): image, video first-frame with play overlay, audio waveform (amber strokes), PDF first page, MD/text rendered preview, code with syntax highlighting, generic large icon for unknown. Preview block: `bg-raised` background, 8px radius, 1px `border-subtle`, `highlight-top` inset.
- Filename below in `t-title-sm` Inter 600 `text-primary`
- Full path in `t-compact` JetBrains Mono 400 `text-tertiary` (breakable, line-height 1.4)

**Three tabs (underline style):** Preview | Tags | History
- 44px tall container, 1px `border-hairline` baseline
- Each tab padding 0 16px, `t-body` Inter 500
- Active: `text-primary` weight 600, 2px `accent` underline slides between tabs at `dur-slide`
- Content swap: instant jump-cut

**Bottom action row:** Open (primary), Open with..., Reveal in Explorer (secondary buttons), More (ghost icon button). Button row gap 8px, top border 1px `border-hairline` above.

**Multi-select state:** aggregate display (count, total size in JetBrains Mono, common tags as chip stack), bulk tag editor available.

---

## A.4 Screen 3 — File Tree (canvas)

**Scope note (v1):** This screen has exactly three modes — Live, Snapshot view, Proposal review. Snapshot-to-snapshot side-by-side comparison ("Comparison mode") is explicitly out of scope for v1; it is approximated by switching between snapshots in the right rail.

Three modes with banners. Banners are 36px tall, flush to top of content area, with 1px `border-hairline` bottom:
- **Live mode** (default, no banner)
- **Snapshot view mode**: `warn-wash` background, `warn-edge` border-bottom, 14×14 Lucide `history` icon in `warn`, `t-body` Inter 500 `warn` text: "Viewing snapshot from [date] · read-only" with "Return to live" secondary button right-aligned
- **Proposal review mode**: `accent-wash` background, `accent-edge` border-bottom, 14×14 Lucide `sparkles` icon in `accent`, `t-body` Inter 500 `accent` text: "Reviewing AI proposal · changes you make update it" with "Execute" primary button right-aligned

### A.4.1 Layout

- Left rail (collapsible): Jump-to flat list of all visible nodes. `bg-chrome` background, 1px `border-hairline` right edge. Click jumps canvas viewport.
- Center: canvas stage (pan/zoom/marquee select). Background `bg-content`. Optional 24px grid at `rgba(255,255,255,0.025)`, visible at >75% zoom only.
- Right rail (collapsible): Snapshots panel. `bg-chrome` background, 1px `border-hairline` left edge.
- All rails collapse to give canvas full width (instant, no animation).

### A.4.2 Canvas content

- Drives leftmost
- Folders to the right, organized by depth columns
- Default expansion: 3 levels visible
- Each leaf with hidden children: "+N" badge in `t-small` JetBrains Mono 500 `accent` text on `accent-wash` background, 4px radius, click to expand in place
- Wide sibling sets: scroll horizontally forever, no wrap, no force-direct
- Compact folder nodes (per v2 token spec Section 35): 120×auto (160 medium, 200 large rare), `bg-raised` background, 1px `border-subtle`, 8px radius, 14px padding, `highlight-top` + `shadow-card`. 20×20 Lucide `folder` icon in `accent`. Name in `t-body` Inter 500. File count in `t-small` JetBrains Mono 400 `text-secondary` ("14 files", direct children only).
- Hover node: `bg-pressed` background, `border-mid`, `shadow-popover`
- Selected node: 1px `accent-edge` border, `accent-wash` background, subtle amber inset highlight
- AI-suggested addition: 1px `good-edge` border + `good-wash` background + "new" badge (4px radius, `good` text on `good-wash`)
- AI-suggested removal: 1px `bad-edge` border + strikethrough name + opacity 0.6
- AI-suggested move: 1px `warn-edge` border + arrow indicator to target (arrow stroke `warn`)

### A.4.3 Floating glass toolbar (top center of canvas)

Per v2 token spec canvas toolbar guidance: same chrome as the Approvals pill (convex, 999px radius on container, `highlight-top-strong` + `shadow-raised`, 1px `border-subtle`, `bg-raised` background). Backdrop blur applied (this is an overlay on canvas, so blur is allowed).

Contents (each control 28×28 or grouped):
- Changes toggle (show/hide AI-proposed deltas)
- Expand all / Collapse to depth-3 toggle
- Zoom out | zoom % (in JetBrains Mono) | zoom in | Fit to view
- Add folder
- Delete (only enabled with selection; disabled state 40% opacity)
- View hidden files toggle (off default)
- Fullscreen (collapses both rails)

### A.4.4 Live mode interactions

- Drag folder onto folder → reparent. Snackbar bottom-center per v2 token spec Section 30 with: "Moved 'X' to 'Y'. Undo (Ctrl+Z)" 5-sec window. Snackbar has `accent-edge` border + `highlight-top` + `shadow-popover`.
- Right-click folder context menu: see A.10.
- F2 or right-click → Rename: inline rename. Input uses concave chrome (`inset-recess`, `accent-edge` border on focus). Cursor at end.
- Multi-select: Shift+click range, Ctrl+click toggle, Shift+drag marquee.
- Pan: click-drag empty space. No inertia (per motion principle: canvas is 1:1 input).
- Zoom: Ctrl+wheel or pinch. No inertia.
- Click folder once: selects + populates inspector with folder metadata (inspector jump-cuts to folder view).
- Double-click folder: opens in new Browser tab.

### A.4.5 Snapshot view mode interactions

- Banner across top (warn styled) with [Return to live] button (secondary button)
- All folders shown as they were
- Click any file: "where is it now?" lookup runs against current index
  - Found: opens new Browser tab focused on current location, optional animated highlight cascade through canvas (toggleable in Settings, off by default; when enabled, uses `accent` stroke at 2px, 300ms per hop fade-in)
  - Not found: toast with `bad-edge` border: "File may not exist anymore" + actions: Quick search (instant), Deeper scan (background task)
- Right-click in snapshot: only "Find current location" (files) or "Restore this snapshot" (whole snapshot)
- Restore confirmation modal per v2 token spec Section 22: "Type RESTORE to confirm. This will revert your filesystem to [date]. [N] files will be moved back. This cannot be easily undone." Type input uses concave chrome. Confirm button is danger-styled (1px `bad-edge` border, `bad` text, `bad-wash` hover).

### A.4.6 Snapshots panel (right rail)

- Header: "Snapshots" in `t-title-sm` Inter 600 + "New snapshot" (+) icon button (28×28, 16×16 Lucide `plus`)
- List newest first. Each row: 48px tall, padding 0 12px, `t-body` Inter 500 label, `t-small` JetBrains Mono 400 `text-tertiary` timestamp, `t-compact` Inter 400 `text-secondary` summary below.
- Row types:
  - "Now · Live state" (first row, 2px `accent` left bar)
  - User-bookmarked: 14×14 Lucide `star-filled` in `accent` (never expires)
  - Major scan snapshots: `accent-wash` chip "Scan" (never expires)
  - AI-task snapshots: countdown in `t-small` JetBrains Mono `warn` "expires 30d"
  - Daily/weekly/monthly snapshots (per retention rules, `text-tertiary` label)
- Hover row: `bg-raised` background + `highlight-top` inset
- Active row (currently viewing): `accent-wash` background + 2px `accent` left bar
- Right-click: Bookmark, Compare to current, Compare to other, Delete, Restore (context menu per A.10)

---

## A.5 Screen 4 — Scan Configuration (pre-scan)

Reached from sidebar > Scan, or from Settings > Scan & Index > "Run new scan."

### A.5.1 Conversational mode (default)

Full-screen chat interface, 48×48 FilePlus brand mark top-left. Claude drives the conversation.

- Chat container: max 640px width, centered
- User message: right-aligned, `accent-wash` background, 1px `accent-edge` border, `highlight-top` inset, `t-body` Inter 400 `text-primary`, 12px padding, 8px radius
- AI message: left-aligned, `bg-raised` background, 1px `border-subtle`, `highlight-top` + `shadow-card`, same typography
- Opening prompt from Claude: "What areas of your life are important to you? Work, music, school, photos, anything else?"
- User responds via text input at bottom (concave chrome, 44px tall, autogrows to 4 lines)
- Claude asks tailored follow-ups
- Conversation continues until Claude has enough info (3-10 turns typical)
- For each category, Claude presents a dropdown/checklist of relevant file extensions styled as tag chips: default chips for unselected, `accent-wash` tinted chips for selected
- "Skip the rest, use defaults" secondary button always visible (top right)
- "Switch to structured form" ghost button always visible (top right)
- "I'm done answering" secondary button at every turn (inline with input)

After conversation, Claude generates structured output.

### A.5.2 Structured form mode (fallback)

Standard form cards per v2 token spec Section 22 (cards with `bg-raised`, 1px `border-subtle`, `highlight-top`, `shadow-card`):
- Scope (drives, custom folders, exclusions)
- Cleanup aggressiveness: Conservative / Moderate / Aggressive (segmented control)
- Tree complexity: Simple / Balanced / Detailed (segmented control)
- Custom file type priorities
- Custom categories
- "Never touch" folder exclusions
- Estimated scan time (display only, `t-display-sm` JetBrains Mono 500 `text-primary`)

### A.5.3 Pre-scan baseline confirmation

Before either mode begins scan execution, a modal (per v2 token spec Section 22): "FilePlus will create a baseline snapshot before scanning so you can revert if needed. Continue?" Two buttons: "Cancel" (secondary) and "Create baseline and scan" (primary).

---

## A.6 Screen 6 — Scan Progress

Per v2 token spec Section 25 (scan stage checklist).

- 5 stages: Index → Deduplicate → Classify → Propose → Review
- Each stage row 36px tall with 24×24 circle icon (pending/current/complete states per spec)
- Active stage: 4px progress bar below label with `accent` fill, shimmer optional (toggleable in Settings, respects reduced motion)
- "Now working on" path display in `bg-raised` card with 1px `border-subtle` + `highlight-top`, padding 14px 16px. `t-micro` label "NOW WORKING ON", path in `t-body` JetBrains Mono 400 `text-primary`.
- Ticker of recent operations: `t-small` JetBrains Mono 400 `text-secondary`, one line, 200ms fade on new entry
- Stats grid: 4 stat cards (per v2 token spec Section 22 stat card) showing rate (files/s), classified, remaining, ETA. Each card: `t-micro` label, `t-display` JetBrains Mono 500 value, optional unit.
- Throughput sparkline (last 5 min): 2px `accent` stroke on `bg-raised` card with `highlight-top` + 1px `border-subtle`. Animates continuously (live data, per motion exception).
- Reassurance banner: `good-wash` background, 1px `good-edge`, `highlight-top` inset, 14×14 Lucide `lock` icon in `good`, `t-body` Inter 400 `text-primary`: "Nothing is being moved. Continues in background if you close this window."
- Footer actions: Pause (secondary), Minimize to tray (secondary), Stop scan (danger button) with confirmation.

---

## A.7 Screen 6 — Scan Results (post-scan)

Three tabs using underline tab style.

### A.7.1 Duplicates tab
- List of duplicate groups, expandable. Each group row: 36px tall, `bg-raised` background on hover, 16×16 file icon, name, size in JetBrains Mono, "X copies" chip (`accent-wash` variant), total reclaimable in `t-compact` JetBrains Mono `good`.
- Per copy (nested): full path in `t-small` JetBrains Mono `text-tertiary`, modified date, "keep" radio button (default: AI's choice). Radios per v2 token spec Section 21.
- Per-row preview pane on selection (inspector-style)
- "Select all AI suggestions" toggle
- Hardlink alternative toggle (advanced)
- Footer: "Reclaimable: X.X GB" (`t-title-sm` JetBrains Mono 500 `good`) + "Execute deduplication" primary button (confirmation modal)

### A.7.2 Cleanup tab
- Categories collapsible cards: Temp, Empty folders, Old downloads (slider for age threshold), Large unused (slider for size + age), Orphaned app data, Old logs, Recycle Bin, Thumbnail cache
- Per category: expand to file list with checkboxes, "Select all" / "Reject all" links
- Big "Total selected: X.X GB" top (`t-display` JetBrains Mono 700 `text-primary`)
- Footer: "Execute cleanup" primary button (confirmation)

### A.7.3 Reorganization tab

Single CTA: "Open File Tree to review proposed reorganization." (primary button, large size 36px, centered)

This sends the user to the File Tree canvas in **proposal review mode**. Three options on the canvas footer (button group, gap 8px):
1. **Manually edit** (secondary button)
2. **Accept as-is** (primary button)
3. **Chat feedback** (ghost button, opens conversational sub-mode)

Chat feedback iterates until user accepts. Each iteration is fast (uses cached index data, no re-scan).

---

## A.8 Screen 7 — Review Bin

Note: Review Bin is a **filter** on the Everything Folder, not a separate location. It shows files in state "needs review" (warn indicator).

Reached from sidebar (with badge), or from Ctrl+Shift+R.

### A.8.1 Layout

Two-pane: list left, detail right (similar to inspector, 340px default).

### A.8.2 List pane

Header: "Review Bin · X files need a decision" in `t-title` Inter 600, count in JetBrains Mono.

Grouped by destination (e.g., "→ /album-mix-2024"). Each group:
- Header row: 32px tall, 16×16 folder icon in `text-secondary`, destination in `t-body` Inter 500, count + avg confidence in `t-compact` JetBrains Mono `text-tertiary`
- Per-group actions (right-aligned in header): "Review each" (ghost), "Approve all" (secondary), "Reject all" (danger ghost: `bad` text, hover `bad-wash`)
- Each file row (26px): filename, route (from `→` to, where "from" is `bad` strikethrough and "to" is `good`), action chip ("move"/"rename"/"flag", each using tinted chip variant with appropriate color), confidence bar (4px tall, track `bg-pressed` with `inset-recess`, fill color scales with confidence: `bad`→`warn`→`good`), overflow 14×14 Lucide `more-vertical` icon button

Special group: "Uncertain — individual review" (confidence < 0.5) at bottom. Header gets `warn-wash` background + `warn-edge` 1px border + `highlight-top` inset, 14×14 Lucide `alert-triangle` icon in `warn`.

### A.8.3 Detail pane (right)

- Header: "Proposed move" label in `t-micro` `text-tertiary`, filename in `t-title-sm` Inter 600
- Proposed route: two lines
  - Line 1: `−` in `bad`, then path in JetBrains Mono `bad` (strikethrough)
  - Line 2: `+` in `good`, then path in JetBrains Mono `good`
- "Why" section: `t-title-sm` heading, body in `t-body` Inter 400 `text-secondary`
- Confidence + tag chips: confidence as `t-body` JetBrains Mono with value in `accent` or semantic color, tag chips per chip spec
- "Similar past decisions": list of 3-5 prior actions, each row with 14×14 Lucide `check` (`good`) or `x` (`bad`) icon + text + timestamp
- Footer action row (sticky bottom): Reject (danger button) | Modify path... (secondary) | Snooze 7d (secondary) | Approve → (primary). Gap 8px, top 1px `border-hairline`.
- Keyboard shortcut hints below buttons: `t-small` JetBrains Mono 500 `text-tertiary` with `←` `m` `→` symbols

### A.8.4 Empty state

48×48 Lucide `check-circle-2` in `good` + "Nothing to review." in `t-title-sm` + "The AI is handling everything within your confidence threshold." in `t-body text-secondary`.

---

## A.9 Screen 8 — Everything Folder

Accessed from sidebar bottom-anchor button.

### A.9.1 Header

- Title: "Everything Folder" in `t-title`
- Path display in `t-compact` JetBrains Mono `text-tertiary`
- Right side: Pause AI processing toggle (toggle switch per v2 token spec Section 21) with `t-body` label, filter chips (All / Unprocessed / Needs Review / Moving / Errors — each chip is a segmented control segment, active segment uses `accent-wash` + `accent-edge`)

### A.9.2 Main file list

Each row (26px default density): 16×16 file icon (native Windows extract where applicable), name in `t-body` Inter 500, time landed in `t-compact` JetBrains Mono `text-secondary`, current state dot (6px filled circle in semantic color), AI's proposed destination if known (in `t-compact` JetBrains Mono `text-tertiary`), hover error tooltip if error state.

State dot colors (non-negotiable, consistent across the app):
- No dot: settled / at final destination / no action needed
- `text-tertiary` (grey): unprocessed
- `warn`: needs review
- `accent`: currently moving / in progress
- `bad`: error

Sort by: recency (default), state, name. Sort controls as list header per v2 token spec Section 24.

### A.9.3 Bottom "Currently moving" section

- Collapsible card (default expanded if 1-3 active, collapsed if 4+)
- Card chrome: `bg-raised`, 1px `border-subtle`, 8px radius, `highlight-top` + `shadow-card`, 16px padding
- Header: "Moving X of Y files" in `t-title-sm` Inter 600, counter in JetBrains Mono (counter updates smoothly, no animation on number change)
- Single progress bar (4px tall, `accent` fill, `bg-pressed` track with `inset-recess`, 999px radius) showing current file's progress
- Current filename below in `t-compact` JetBrains Mono `text-primary`
- Same-drive moves: toast (per v2 token spec Section 30) at bottom for 1 second, no persistent bar
- Cross-drive moves: bar persists for duration

### A.9.4 Error handling

- `bad` state dot on failed files
- Hover dot: tooltip (per v2 token spec Section 26) with specific error
- Sidebar Everything Folder badge turns `bad` (badge background `bad-wash`, border `bad-edge`, text `bad`) with count in JetBrains Mono
- Toast notification at time of failure (`bad-edge` border variant, manual dismiss per spec)

---

## A.10 Right-click context menus

All context menus per v2 token spec Section 27: `bg-raised` background, 1px `border-subtle`, 8px radius, `highlight-top` + `shadow-popover`, 4px padding, 180px min width. Items 28px tall, 5px radius, with optional 14×14 leading icon (`text-secondary`) and optional right-aligned kbd shortcut in `t-small` JetBrains Mono 500 `text-tertiary`. Hover: `accent-wash` background + icon and label shift to `accent`. Destructive items: `bad` text, hover `bad-wash` background.

Separator: 1px `border-subtle`, margin 4px 0.

### A.10.1 File context menu
- Open
- Open with...
- Open in new tab
- Reveal in Browser
- ─
- Cut, Copy, Paste
- Rename (F2)
- Delete (Del) — destructive variant
- ─
- Add tag...
- Reclassify (AI re-runs)
- Add to Favorites
- ─
- Compress to .zip
- Properties
- Show in Windows Explorer

### A.10.2 Folder context menu
- Open
- Open in new tab
- Open in new window
- ─
- Cut, Copy, Paste
- Rename
- Delete — destructive variant
- ─
- New folder inside
- New file (submenu: text, markdown, etc.)
- ─
- Add to Favorites
- Pin to sidebar
- Reclassify contents
- ─
- Properties
- Show in Windows Explorer

### A.10.3 Empty area context menu
- New folder
- New file (submenu)
- Paste
- Refresh
- ─
- View → List / Grid
- Sort by → name / size / modified / type / tag
- Group by → none / type / tag / date
- ─
- Show hidden files (toggle)
- Properties

### A.10.4 Tab context menu (already covered in A.1.2)

### A.10.5 Sidebar item context menu
- Open in new tab
- Unpin (if pinned)
- Pin to top (if not pinned)
- Rename label
- Remove from sidebar

---

## A.11 Overlays

### A.11.1 Command Palette (Ctrl+K)

Per v2 token spec Section 16. Centered modal, 640px width.

Container: `bg-raised` background, 1px `border-subtle`, 10px radius, `highlight-top` + `shadow-modal`. Backdrop scrim `rgba(0,0,0,0.4)` with subtle blur.

**Search mode (default):**
- Input top (44px tall), `t-title-sm` Inter 400, no border on input itself (container frames it)
- 1px `border-hairline` below input separates from results
- Body split: list left (300px), preview right (`bg-content` background, 1px `border-hairline` left)
- List sections: Files, Folders, Tags (#), Commands (>). Section heads in `t-micro` uppercase `text-tertiary`.
- Each result row (36px, 12px padding, `t-body` Inter 500)
- Keyboard-selected row: `accent-wash` + 2px `accent` left bar
- Hover row: `bg-pressed`
- Footer: "↑↓ navigate · ⏎ open · ⇥ action · > commands · # tags · / paths" in `t-small` Inter 400 `text-tertiary` with symbol portions in JetBrains Mono
- Open animation: `dur-fast`, fade + `translateY(4px)`, `ease-out`

**Chat mode:**
- Toggle in palette header: Search / Chat segmented control
- Or auto-detect: typing a sentence with verb context switches mode
- Claude responds inline with proposed plan in `bg-content` card with 1px `border-subtle`
- Plan card has buttons: "Send to Review Bin" (secondary), "Approve all" (primary), "Show me what would change" (ghost)
- Plans go through normal Review Bin / direct execution paths

### A.11.2 Tag Canvas

Centered modal, 820×540. `bg-raised` background, 1px `border-strong`, 10px radius, `highlight-top` + `shadow-modal`. Backdrop scrim at `rgba(0,0,0,0.5)` with stronger blur.

- Header (48px): title "Tag Canvas" in `t-title-sm` Inter 600 with active tag highlighted in `accent`, 24×24 close icon button top-right
- Body two-pane:
  - Left (240px, `bg-content`): Tag tree. `t-body` Inter 500 for labels, counts in JetBrains Mono `text-tertiary`. Groups (project:, type:, app:) as section labels in `t-micro` uppercase.
  - Right (fills): Tag relationship graph (SVG with arrows in `text-tertiary` at 1px stroke, 1.5px `accent` stroke for selected branch) + filtered file grid below
- Right-click tag node: Rename, Merge into..., Delete, Set color, Set group (context menu per A.10)
- Drag tag onto another: merge with confirmation modal
- Drag tag into group: nest

### A.11.3 Confirmation modals

Per v2 token spec Section 22. Centered 440px. `bg-raised`, 1px `border-strong`, 10px radius, `highlight-top` + `shadow-modal`, 24px padding.

Used for: Execute scan, Execute reorg, Execute dedup, Execute cleanup, Restore snapshot, Reset all org, Empty Recycle Bin, Permanently delete files, Hard delete from Downloads (after 30d).

Structure:
- Header: 24×24 Lucide icon (warn `alert-triangle` in `warn` / danger `alert-octagon` in `bad`), title `t-display-sm` Inter 600 with 12px gap
- Body: `t-body` Inter 400 `text-secondary`
- Optional "Type WORD to confirm" input (concave chrome, uppercase text, `accent-edge` focus)
- Footer (right-aligned, gap 8px): Cancel (secondary) + danger-action button (danger variant for destructive, primary for confirm)

Open animation: `dur-slide`, fade + `translateY(6px)`, `ease-out`.

### A.11.4 Snackbars / Toasts

Per v2 token spec Section 30.

**Snackbars** (bottom-center): 360px, `bg-raised`, 1px `accent-edge` border, 8px radius, `highlight-top` + `shadow-popover`. Title in `t-body` Inter 600 `text-primary`. Undo button right-aligned (ghost button, `accent` text). 5s auto-dismiss with progress bar at bottom edge (4px tall, `accent` fill emptying left to right over 5s).

**Notification toasts** (bottom-right): 360px, same chrome base. Border variants:
- Default: `border-subtle`
- Action: `accent-edge`
- Error: `bad-edge` (manual dismiss, never auto)

Stack vertically with 8px gap, newest on top.

---

## A.12 Settings

Two-column: nav left (200px), content right (scroll).

Nav column: `bg-chrome` background, 1px `border-hairline` right edge. Items per sidebar item spec (28px tall, 6px radius, `t-body` Inter 500 label). Active section: `bg-pressed` + 2px `accent` left bar.

Content column: `bg-content` background, 24px padding, max 640px content width.

Nav sections:

**Application**
- Personalization
- Scan & Index
- Everything Folder
- Downloads Folder
- Organization Engine
- AI Configuration
- Custom File Types

**Account**
- Privacy
- Shortcuts
- Data

**System**
- About

All form controls (toggles, sliders, segmented controls, text inputs, radios, checkboxes) per v2 token spec Section 21. Cards per Section 22. Each settings pane uses cards for grouping related settings.

### A.12.1 Personalization
- Theme: Dark / Light / System (segmented control)
- Accent color: default amber + custom hex input. Row layout: a 24×24 swatch (current `--accent` value) + an Inter 500 hex input field (concave chrome, accepts `#RRGGBB` or `#RGB`) + a "Reset to default" ghost button. On valid hex input, `--accent-custom` is written to localStorage and applied immediately to `--accent`. Invalid input shows the inline error pattern (`fp-field-error`) below the field; the swatch does not update until the input is valid.
- Inspector default width slider (280-520, value label in JetBrains Mono on drag)
- Density: Compact / Comfortable / Spacious (segmented control)
- Tab style: Compact / Standard (segmented control)
- Show file extensions toggle
- View hidden files toggle (off default)
- Single vs double-click open (segmented)

### A.12.2 Scan & Index
- Indexed drives & folders (list with add/remove buttons)
- Ignore patterns (chip list with add-chip placeholder)
- File content analysis toggle
- Re-scan schedule: Manual / Daily / Weekly (segmented)
- "Run new scan" primary button → Scan Configuration screen

### A.12.3 Everything Folder
- Watched folder path (file picker row)
- Auto-sort confidence threshold slider (default 80%, value in JetBrains Mono)
- Excluded file types (chip list)
- Max time before forcing review prompt slider (default 7d)
- Browser download redirect: per-browser toggles (Chrome, Firefox, Edge, Brave, Arc) — each toggle row with 16×16 browser icon
- Notification preferences: Off / Only uncertain / Every sort (segmented)
- Stuck-detection threshold (hours before sidebar badge, default 24, slider)

### A.12.4 Downloads Folder
- Path (default Windows Downloads)
- Auto-purge after: 7d / 30d (default) / 60d / Never (segmented)
- Purge action: Move to Recycle Bin (default, recommended) / Hard delete (with warning; danger-colored radio) (radio group)
- Excluded file types (chip list)

### A.12.5 Organization Engine
- Autonomy level: Passive / Suggest / Proactive (segmented)
- Suggestion batch size slider (10-500, default 100)
- Confidence threshold for Review Bin slider
- Propose rename of files toggle
- Propose deletion of duplicates toggle
- Time Machine retention summary (ghost link to Data pane)

### A.12.6 AI Configuration
- **Local LLM card**
  - Status display: "Ollama detected" with `good` dot, or "Ollama not running" with `bad` dot (uses live dot style per v2 token spec Section 25)
  - Model selection dropdown
  - "Test classification" secondary button
- **Cloud (Claude API) card**
  - Cloud inference toggle
  - API key input (password type, show/hide icon button, concave chrome)
  - Default model: sonnet / haiku (radio group)
  - Monthly cost cap input (number with $ prefix in `text-tertiary`)
  - Monthly token cap input
  - Temperature slider
- **Usage stats card**
  - Tokens used this month (`t-display-sm` JetBrains Mono value)
  - Estimated cost this month
  - Files classified locally vs cloud (stacked bar: `accent` for local, `text-tertiary` for cloud)
  - Reset stats ghost button

### A.12.7 Custom File Types
- Table-style editable list (rows alternate `bg-content` / `bg-raised` at 50% for readability, or just use `bg-content` with 1px `border-hairline` between rows). Columns: extension (JetBrains Mono), category, default tags (chip list inline), description.
- "Add file type" primary button
- "Re-run setup conversation" secondary button

### A.12.8 Privacy
- Cloud inference toggle (mirror of A.12.6)
- Analytics toggle (off default)
- Redact file contents from logs toggle (on default)
- Index encryption: Off / On (AES-256) (segmented)

### A.12.9 Shortcuts
Editable list of keybinding rows. Each row: action label in `t-body` Inter 500, keybinding in 24×24+ kbd pill (`bg-raised`, 1px `border-subtle`, 4px radius, `t-small` JetBrains Mono 500 `text-secondary`). Click row to re-bind (shows "Press new keys..." state with `accent-edge` border).

Default bindings:
- Open command palette: Ctrl+K
- Open Review Bin: Ctrl+Shift+R
- Focus search: /
- Switch to Home: Ctrl+1
- Switch to Browser: Ctrl+2
- Open File Tree: Ctrl+Shift+F
- Toggle inspector: Ctrl+I
- New folder: Ctrl+Shift+N
- Rename: F2
- Delete: Del
- Undo: Ctrl+Z
- New tab: Ctrl+T
- Close tab: Ctrl+W
- Reopen closed tab: Ctrl+Shift+T
- Toggle hidden files: Ctrl+.
- View mode cycle: Ctrl+1/2
- Summon FilePlus from anywhere: ⊞+Shift+F
- Open last download: ⊞+Shift+D

### A.12.10 Data
- Index size display (`t-display-sm` JetBrains Mono)
- Snapshot storage display + "Cleanup snapshots" secondary button
- Snapshot retention rules (checkbox list with numeric inputs):
  - Daily: toggle (off default), keep last 7
  - Weekly: toggle (on default), keep last 4
  - Monthly: toggle (on default), keep last 12
  - AI-task: 30d (informational, `text-tertiary`)
  - User-bookmarked: forever (informational)
  - Major scan: forever (informational)
- Disk full safety: warn when snapshot storage exceeds X GB (slider)
- Export database (backup .zip) — secondary button
- Import database (restore) — secondary button
- Clear all AI tags (confirmation modal) — danger button
- Reset all organization (typed confirmation) — danger button
- Reset settings to defaults — secondary button

### A.12.11 About
- Version, build (`t-small` JetBrains Mono)
- Index size, file count
- Local LLM model + version
- Diagnostics export — ghost button
- Open source licenses — ghost button
- Reset to defaults — danger button

---

## A.13 First-Run Setup

Seven steps, full-window flow, replaces shell until done. Background `bg-backdrop`.

Left rail (240px, `bg-chrome`, 1px `border-hairline` right):
- 48×48 FilePlus brand mark + "FilePlus" wordmark top
- Version in `t-small` JetBrains Mono `text-tertiary`
- Step list: each step 40px tall, 24×24 circle left (pending `bg-pressed`, current `accent-wash` with `accent-edge`, complete `good` filled with white check)
- Footer: "~X min remaining · ~X GB disk · offline after setup" in `t-small` JetBrains Mono `text-tertiary`

Content area (flex-grow, 80px padding uniform, max 560px content width centered):
- Hero icon: 64×64 Lucide outlined icon in `accent` (varies per step)
- Title: `t-display` Inter 600
- Body: `t-read` Inter 400 `text-secondary`, line-height 1.6

### Step 1: Welcome
- Hero: 64×64 brand mark
- Title: "FilePlus"
- Tagline: "Your file explorer, with an AI safety net"
- Brief explainer paragraph
- "Get started" large primary button (36px tall) right-aligned

### Step 2: Install Engine
- Live download progress for Ollama runtime + main model + embedding model
- Each component: 48px row with 16×16 icon + name + progress bar (4px `accent` fill) + size/ETA right
- Completed components: 16×16 Lucide `check` in `good` replaces progress bar
- Bundled deps verified section with green check
- "Continues in background if you close this window" — `t-small` Inter 400 `text-tertiary`
- Windows file association registration: toggle row with description

### Step 3: Connect Claude
- Anthropic API key input (concave chrome, 14×14 lock icon leading, show/hide trailing)
- Live validity check: green check on valid, bad icon on invalid
- Default model selection: Sonnet (default) / Haiku (radio group with descriptions)
- Offline mode toggle ("Disable all cloud calls")
- "I'll add one later" ghost button (skips)

### Step 4: Basic Settings
Form card with:
- Everything Folder location (file picker row)
- Drives to index (checkbox list per drive with size)
- Replace default Windows downloads folder: No / Per Browser / Yes (radio, default Yes). Per Browser expands to per-browser toggle sublist.
- Auto-move confidence threshold slider (default 0.7, JetBrains Mono value)
- Flagged-deletion retention: 7d / 30d / 90d / Forever (segmented, default 30d)
- Background scan schedule: Never / Nightly @ 02:00 / Weekly (segmented, default Never)
- Show taskbar quick-access widget toggle (default on)

### Step 5: Final Touches (helpful but not necessary)
Opt-in checklist. Each item as a card:
- Checkbox left
- Name in `t-body` Inter 600
- Description in `t-body` Inter 400 `text-secondary`
- Size right-aligned in `t-compact` JetBrains Mono `text-tertiary`

Items:
- Tesseract OCR — read text inside scanned PDFs and images (~150 MB)
- Whisper.cpp tiny — transcribe audio for tagging (~75 MB)
- ONNX image classifier — distinguish screenshots vs photos vs memes (~50 MB)
- Custom file type categories per detected interest (auto-checked based on Step 6 conversation)

All default unchecked except the auto-detected one. User can install later from Settings.

### Step 6: Conversational Scan Config
Chat interface per A.5.1 styling, within the setup window.

### Step 7: Ready to Scan
Two cards side by side (gap 16px):
- **Start first scan** — primary styled card with `accent-wash` background, `accent-edge`, large CTA
- **Just open the app** — secondary styled card with `bg-raised`, `border-subtle`

Below: snapshot baseline confirmation text + shortcut reference card (`bg-raised`, displays 4-5 key shortcuts in JetBrains Mono).

"Finish setup" primary button bottom-right.

---

## A.14 Tray Popout

Per v2 token spec Section 31. Anchored above Windows tray. 380px wide, 500-600px tall.

Container: `bg-backdrop`, 1px `border-strong`, 12px radius, `shadow-modal`.

### A.14.1 Header (top)
- Background: `bg-chrome`, 1px `border-hairline` bottom, 14px padding
- Layout: 22×22 brand mark left + title stack + icons right
- Title: "Recent downloads" in `t-body` Inter 600 + clickable expand arrow (14×14 Lucide `arrow-up-right`) adjacent
- Subtitle: "Everything Folder · D:\Everything" in `t-small` Inter 400 `text-tertiary` (path in JetBrains Mono)
- Right-side icons (28×28 icon buttons):
  - Review Bin (14×14 Lucide `inbox`, with count badge `accent-wash` if non-zero)
  - Everything Folder (14×14 Lucide `archive`)
  - Pause AI processing toggle (14×14 Lucide `pause` / `play`)
  - Expand arrow (14×14 Lucide `maximize-2`)

### A.14.2 Sub-tab toggle
Segmented control below header: **Recent** (default) / **Favorites**. 30px tall, 16px side margin.

### A.14.3 Recent list
Each entry shows current state via 6px colored dot (semantic per state dot system A.9.2):
- No dot: settled at final destination
- Grey (`text-tertiary`): unprocessed
- `warn`: needs review
- `accent`: currently moving
- `bad`: error (hover for tooltip)

Each row (32px, slightly taller than main app for tray ergonomics): 16×16 file icon (native Windows for branded), filename, size + source in `t-small` JetBrains Mono `text-tertiary`, time + state chip right-aligned.

Hover row: `bg-raised` + `highlight-top` inset. Action buttons fade in right (Open, Reveal, Copy path) — these use the tray action button style below.

Auto-prune: 24h hard cap OR 15-file limit (whichever first), unresolved items persist.

### A.14.4 Favorites list
Same row format, no time grouping. 14×14 Lucide `star-filled` at right in `accent` unfavorites.

### A.14.5 Currently moving section (bottom)
Collapsible card. Default expanded if 1-3 active, collapsed if 4+.
- `bg-raised` card, 1px `border-subtle`, 8px radius, `highlight-top` + `shadow-card`
- Header: "Moving X of Y files" in `t-body` Inter 600, count in JetBrains Mono
- Current filename (mono) below progress bar
- Same-drive moves: 1-sec toast at very bottom, no bar
- Cross-drive moves: persistent 4px progress bar with `accent` fill

### A.14.6 Active download block (if downloading, sits between header and tabs)
- `accent-wash` background, 1px `border-hairline` bottom
- 18×18 Lucide `arrow-down` in `accent` leading
- Filename in `t-body` Inter 600 `text-primary`
- Inline 4px progress bar below with `accent` fill on `bg-pressed` track
- Size progress in `t-compact` JetBrains Mono `text-secondary` (e.g., "1.3 / 2.1 MB")

### A.14.7 Action buttons (Drag, Open, Reveal, Copy — the v1 bug fix zone)
CRITICAL: each button renders its icon at exactly 16×16, never larger. Buttons are 36px tall with:
- `bg-raised` background, 1px `border-subtle`, 6px radius, `highlight-top` + `shadow-raised`
- Vertical stack: 16×16 Lucide icon on top + `t-small` Inter 500 `text-secondary` label below
- Equal width across row of 4 buttons, gap 8px

### A.14.8 Footer
- `bg-chrome` background, 1px `border-hairline` top, 10px 14px padding
- Left: 28×28 icon buttons (folder, search)
- Center: "Open FilePlus" primary button
- Right: 28×28 settings icon button
- Global hotkey hint below: "⊞+Shift+F to summon" in `t-small` JetBrains Mono `text-tertiary`
- Auto-dismiss popout on click outside or 8-sec idle

### A.14.9 Drag-to-tray
Drop a file from desktop or another app onto the tray icon → file moved into Everything Folder for processing. Tray icon shows amber pulse (scale `1 → 1.4 → 1` at 600ms) on successful drop.

### A.14.10 Tray icon right-click context menu
Per A.10 context menu chrome.
- Open FilePlus
- Open Everything Folder
- Open Review Bin (with count in `t-small` JetBrains Mono right-aligned)
- Open last downloaded: [filename.ext] (dynamic, in JetBrains Mono)
- ─
- Pause AI processing (toggle, check icon if active)
- ─
- Settings
- Quit — destructive variant

---

## A.15 Empty states (every applicable surface)

Required for: Home > Recent, Home > Favorites, Browser > empty folder, Review Bin, File Tree > no snapshots, Search > no results, Tag Canvas > no tags, Everything Folder > empty, Tray popout > empty.

Per v2 token spec Section 29:
- Centered container
- 48×48 Lucide outlined icon in `text-tertiary` (or semantic color if appropriate, e.g., `good` for "nothing to review")
- Title in `t-title-sm` Inter 600 `text-primary`
- Description in `t-body` Inter 400 `text-secondary`, max 360px width
- Optional CTA: secondary or primary button, 16px gap below description
- 12px gap between elements

---

## A.16 Error states

Required for: file not found in time machine restore, scan interrupted, AI offline (Ollama), disk space low, database integrity, cloud API key invalid, file failed to process (bad dot + hover tooltip).

Inline banner at top of affected area:
- Full-width, 36-44px tall
- `bad-wash` background, 1px `bad-edge` bottom border, `highlight-top` inset
- 14×14 Lucide `alert-circle` in `bad` leading
- Message in `t-body` Inter 500 `text-primary`
- Suggested action button right-aligned (secondary button with `bad` text, hover `bad-wash`)
- Dismiss × ghost icon button right-most (optional)

---

## A.17 Edge cases that need decisions

*Style treatments for the edge cases; behavior/logic remain per the feature list.*

1. **External file vanish in Everything Folder**: show file as settled state dot (grey) with strikethrough text at 60% opacity. Fade out over 1s, remove.
2. **External folder rename/delete while viewed**: banner per A.16 ("This folder no longer exists") with "Go back" secondary button.
3. **File dropped on tab body (not folder area)**: same accent drop-target styling as folder rows. Brief snackbar confirming move.
4. **Two FilePlus instances**: second launch shows brief amber pulse on taskbar icon indicating focus transfer, then exits.
5. **Scan running with window closed**: tray icon shows small `accent` badge with running percentage in JetBrains Mono (appears only when window is closed).
6. **Delete folder being scanned**: warn modal per A.11.3 with `warn` accent.
7. **File paste name conflict**: Windows-style dialog with Replace, Skip, Keep both, Cancel options as button group in a modal.
8. **Snapshot restore + new file mid-restore**: progress indicator in modal shows queue.
9. **Claude API down during conversational setup**: toast per A.11.4 (`bad-edge` variant): "Cloud AI unavailable, switching to manual setup."
10. **Invalid filename**: inline red validation below input (`t-small bad` text), input border becomes `bad` while invalid.
11. **Inspector preview render failure**: preview area shows `bg-raised` block with 48×48 Lucide `file-x` icon in `text-tertiary` + "Preview unavailable" caption.
12. **Tab history skip**: no visual; silent.
13. **External file drag-in**: same drop-target styling as folders.
14. **Many tabs**: horizontal scroll on tab bar with subtle gradient fade at edges. Soft cap warning at 50: toast. Hard cap 200: toast + prevent.
15. **Crash recovery on launch**: first-launch-after-crash modal: "FilePlus recovered from an unexpected shutdown. Some operations may be incomplete." with "Review" and "Dismiss" actions.
16. **Disk full in Everything Folder**: sidebar badge turns `bad`, inline banner per A.16, auto-pause AI toggle flips.
17. **AI modifies user-pinned folder attempt**: never happens by design. Tooltip on pinned folders: "Pinned folders are never modified by the AI."
18. **Large/many drives**: drive picker modal with each drive as a card showing size bar (`bg-pressed` track, `accent` fill representing used). Warn cards for >5TB drives.
19. **Snapshot restore conflict**: confirmation modal with conflict list. Each conflict row with `warn` dot. "Restore anyway / Skip conflicts / Cancel" button group.
20. **In-progress moves on quit**: brief splash on next launch: "Resuming 12 queued moves..." with `accent` progress bar that fades after completion.

---

# PART B — Claude Code Implementation Prompt Sequence

The following prompts are designed to be fed to Claude Code one at a time, in order. Each prompt is self-contained but assumes the previous prompts have been executed. Do not run them all at once.

Each prompt begins with the assumption that Claude Code has read `feature-list.md`, `CLAUDE.md`, `PLAN.md`, and the latest version of `frontend/index.html`. The **FilePlus Design Tokens v2 spec** should also be available as `skills/design-tokens-v2.md`.

## Prompt 0: Project initialization (skip if already done)

```
Read CLAUDE.md and PLAN.md. Confirm the project structure matches:
- frontend/ (HTML, CSS, JS for Electron renderer)
- backend/ (Python FastAPI app with SQLite, watchdog, indexer, classifier, mover)
- shared/ (TypeScript-style JSON schema definitions for IPC contracts)
- skills/ (this finalization spec, the feature list, design tokens v2)

If anything is missing, scaffold it. Make sure SAFETY_MODE is set to true in config.py and all file operations are restricted to NEXUS_SANDBOX_PATH.

Commit: "chore: scaffold confirmed, safety mode locked"
```

## Prompt 1: Design tokens and global styles

```
Read skills/design-tokens-v2.md in its entirety before writing any code. The Part 1 Principles section overrides everything else in that doc. The Section 41 audit checklist is your self-verification tool.

Create frontend/src/design-tokens.css with all CSS custom properties from Section 40 of the v2 spec. This includes:
- Surface tokens (bg-backdrop, bg-chrome, bg-content, bg-raised, bg-pressed)
- Accent tokens (accent, accent-hover, accent-press, accent-wash, accent-wash-strong, accent-edge, accent-edge-strong, accent-glow)
- Text tokens (text-primary, text-secondary, text-tertiary, text-on-accent, text-on-good, text-on-bad)
- Semantic tokens (good and variants, bad and variants, warn and variants)
- Border tokens (border-hairline, border-subtle, border-mid, border-strong)
- Highlight and depth tokens (highlight-top, highlight-top-strong, depth-bottom, inset-recess, inset-recess-strong)
- Outer shadow tokens (shadow-raised, shadow-card, shadow-popover, shadow-modal, shadow-window)
- Radius tokens (r-chip, r-icon-btn, r-button, r-card, r-modal, r-window, r-tray, r-pill)
- Motion tokens (durations and easings)
- Font stacks (font-ui = Inter, font-mono = JetBrains Mono with fallbacks)

Also define the light-mode overrides under [data-theme="light"].

Create frontend/src/styles.css importing design-tokens.css. Set up global base styles:
- Inter as the default UI font (import from Google Fonts or bundle), 400/500/600/700 weights
- JetBrains Mono as the mono font, 400/500 weights
- Remove default button / input / etc. chrome
- Set up the typography scale as utility classes or custom properties per v2 Section 4.1

Do NOT preserve any old token values from the previous design-tokens.css. This is a complete replacement.

Commit: "feat(design): v2 design tokens and global typography"
```

## Prompt 2: Global chrome — titlebar, tab bar, sidebar, toolbar, status bar

```
Read section A.1 of this finalization spec AND Sections 9, 10, 11, 13, 14, 15, 22 (status bar subsection) of the v2 design tokens spec.

Implement in frontend/index.html:
- Frameless custom titlebar (32px tall) with brand mark, title text, custom-styled window controls per v2 Section 9. Electron must be configured with `frame: false`.
- Explorer-style tab bar (32px tall) with the amber underline sliding between active tabs, active-tab jump-cut on switch.
- Updated sidebar (240px expanded, 52px collapsed) with the section structure: Quick Access (Home, Review Bin, pinned), Tree (drives with usage bars), Tags, System (File Tree, Scan), bottom anchor (Everything Folder, Settings). 1px border-hairline on right edge as the structural seam.
- Toolbar (48px tall) with Back/Forward/Up nav icon buttons, breadcrumb (middot separators, no arrows/slashes), search field with concave chrome and kbd hint, view toggle as segmented control, inspector toggle.
- Status bar (24px tall) with bg-chrome, 1px border-hairline top, file count / task indicator / Review Bin pill.

Each interactive element gets a data-action attribute. All chrome elements must satisfy the Section 39 clickability rule (have border OR fill OR accent color OR visible chrome treatment at default state, not just on hover).

When done, run the Section 41 audit checklist against your output and report pass/fail per item.

Commit: "feat(chrome): v2-compliant titlebar, tab bar, sidebar, toolbar, status bar"
```

## Prompt 3: Home screen with three sub-tabs

```
Read finalization spec section A.2.

Replace the current "Recent" screen in frontend/index.html with the new Home screen. Three sub-tabs at the top using underline tab style (44px tall container, 2px accent underline that slides between active tabs at dur-slide, 1px border-hairline baseline).

- Recent: grouped by Today / Yesterday / This week / Earlier this month / Older. Each row 26px tall (default density). Hover shows bg-raised with highlight-top inset; selected shows accent-wash with 2px accent left bar (instant). Per-row hover actions as 24×24 ghost icon buttons.
- Favorites: same row layout, no grouping, star icon (Lucide star-filled) to unfavorite.
- Shared: disabled state with v2 tooltip (tooltip chrome per v2 Section 26).

All empty states per v2 Section 29 (48×48 Lucide icon, t-title-sm title, t-body description, optional CTA).

All interactions stubbed with data-action attributes.

Commit: "feat(home): three sub-tab Home screen with empty states"
```

## Prompt 4: Browser screen with inspector

```
Read finalization spec section A.3 and v2 Sections 22 (inspector) and 23 (file row).

Implement the Browser screen with:
- File list (List + Grid views). List view columns name, size (JetBrains Mono), modified (JetBrains Mono), tags. Column header per v2 Section 24.
- File rows 26px default density. States: default (transparent), hover (bg-raised + highlight-top inset, dur-flash), selected (accent-wash + 2px accent left bar, instant), drag-target (accent-wash-strong + 2px accent-edge-strong perimeter border), AI-just-filed (200ms fade-in + 1.5s amber border fade-out), disabled (text-tertiary italic, not-allowed cursor).
- Inspector pane (340px default, resizable 280-520 via drag handle). Closed by default, opens on first file click via jump-cut (no slide animation). When open, file list compacts: Size/Modified/Tags collapse into single right-aligned mono line.
- Tag chip poker-stack per A.3.1: 14px circles with semantic wash backgrounds + matching edge borders, overlapping by 8px, fan-out on hover at 30ms stagger.
- All row interactions: single/double click, slow double-click rename, multi-select, marquee, drag. Marquee rectangle uses accent-wash-strong fill + 1px accent-edge border + 4px radius.

Inspector has Preview / Tags / History tabs (underline style). Preview area uses bg-raised card with 1px border-subtle, highlight-top, 8px radius. Tab content swaps via jump-cut.

Bottom action row: Open (primary), Open with..., Reveal in Explorer (secondary), More (ghost icon button). 1px border-hairline top of row, 8px gap between buttons.

Multi-select inspector state: aggregate display with count and total size in JetBrains Mono.

Commit: "feat(browser): file list with collapsible inspector and tag poker chips"
```

## Prompt 5: File Tree canvas — three modes

```
Read finalization spec section A.4 and v2 Section 35 (File Tree canvas).

The current canvas in frontend/index.html is a viewer only. Extend it to support three modes with banners:
- Live mode (no banner)
- Snapshot view mode (warn-wash banner, warn-edge border-bottom, 14×14 Lucide history icon in warn, t-body warn label, "Return to live" secondary button right)
- Proposal review mode (accent-wash banner, accent-edge border-bottom, 14×14 Lucide sparkles icon in accent, t-body accent label, "Execute" primary button right)

Canvas node chrome per v2 Section 35: bg-raised, 1px border-subtle, 8px radius, highlight-top + shadow-card, 14px padding. 20×20 Lucide folder in accent. Name in t-body Inter 500. File count in t-small JetBrains Mono.

Proposal styling:
- AI-suggested addition: 1px good-edge border + good-wash background + "new" chip (good text on good-wash)
- AI-suggested removal: 1px bad-edge + strikethrough name + opacity 0.6
- AI-suggested move: 1px warn-edge + arrow to target in warn stroke

Add:
- Drag-and-drop folder reparenting in live mode (with snackbar per v2 Section 30, accent-edge border variant, undo button)
- Inline rename via F2 (concave input chrome)
- Right-click context menu (spec A.10.2 and v2 Section 27)
- Click-to-expand "+N" chips on collapsed branches (accent-wash background, accent text, 4px radius)
- Default depth-3 expansion
- Floating glass toolbar (999px radius pill container, same chrome as Approvals pill: highlight-top-strong + shadow-raised + 1px border-subtle + bg-raised, with backdrop blur since this is an overlay on canvas)

Snapshot view mode interactions per A.4.5. Restore confirmation modal with concave "Type RESTORE" input and danger confirm button.

Snapshots panel right rail per A.4.6.

Commit: "feat(canvas): three-mode File Tree canvas with drag-edit and snapshot navigation"
```

## Prompt 6: Scan flow — config, progress, results

```
Read finalization spec sections A.5, A.6, A.7 and v2 Section 25 (scan stage checklist).

Implement three new screens:

1. Scan Configuration screen (frontend/src/screens/scan-config.html):
   - Conversational mode (default): chat interface with 48×48 brand mark, max 640px chat container width. User messages right-aligned with accent-wash + accent-edge, AI messages left-aligned with bg-raised + border-subtle + shadow-card. Input at bottom with concave chrome, autogrowing textarea.
   - Structured form mode: cards per v2 Section 22 (bg-raised + border-subtle + highlight-top + shadow-card).
   - Pre-scan baseline confirmation modal per v2 Section 22.

2. Scan Progress screen per v2 Section 25:
   - 5-stage checklist (Index/Dedup/Classify/Propose/Review) with 24×24 circle icons per stage state
   - Active stage: 4px progress bar with accent fill
   - "Now working on" path card (bg-raised + border-subtle + highlight-top, 14px 16px padding, JetBrains Mono path)
   - Stats grid: 4 stat cards per v2 Section 22 stat card (bg-raised, 10px radius, 1px border-subtle, highlight-top + shadow-card). Values in t-display JetBrains Mono 500.
   - Throughput sparkline on bg-raised card, 2px accent stroke, animates continuously
   - Reassurance banner: good-wash + good-edge + highlight-top, lock icon in good
   - Footer: Pause (secondary), Minimize to tray (secondary), Stop scan (danger button)

3. Scan Results screen with three underline-style tabs:
   - Duplicates: grouped rows with "X copies" chips (accent-wash variant), "keep" radio buttons per v2 Section 21
   - Cleanup: categories as collapsible cards per v2 Section 22
   - Reorganization: single large primary CTA opening File Tree in proposal review mode

All interactions stubbed.

Commit: "feat(scan): conversational + structured config, progress, results screens"
```

## Prompt 7: Review Bin

```
Read finalization spec section A.8 and v2 Section 22 (inspector chrome).

Implement the Review Bin screen. Two-pane layout (list left, detail right at 340px).

List pane:
- Grouped by destination with group headers (32px, folder icon in text-secondary, destination in t-body Inter 500, count + avg confidence in t-compact JetBrains Mono)
- Per-group actions right-aligned: "Review each" (ghost), "Approve all" (secondary), "Reject all" (danger ghost: bad text, hover bad-wash)
- Each file row 26px with filename, route visualization (from path in JetBrains Mono bad strikethrough → to path in JetBrains Mono good), action chip (tinted), confidence bar (4px tall, inset-recess track, fill color scales from bad through warn to good), overflow icon button
- Special "Uncertain — individual review" group with warn-wash header + warn-edge border + alert-triangle icon in warn

Detail pane:
- "Proposed move" t-micro label, filename t-title-sm
- Route lines with − (bad) and + (good) prefix in JetBrains Mono
- "Why" section with t-title-sm heading and t-body body
- Confidence in accent, tag chips in chip variants
- "Similar past decisions" list with check/x icons
- Sticky footer action row: Reject (danger), Modify path (secondary), Snooze 7d (secondary), Approve (primary). 8px gap, 1px border-hairline top.
- Keyboard hints below: t-small JetBrains Mono text-tertiary with ←, m, → symbols

Empty state per v2 Section 29: 48×48 Lucide check-circle-2 in good.

Add Ctrl+Shift+R shortcut.

Commit: "feat(review-bin): two-pane queue with grouped destinations and detail panel"
```

## Prompt 8: Everything Folder screen

```
Read finalization spec section A.9 and v2 Section 23 (file row), Section 22 (cards), Section 26 (tooltips).

Implement Everything Folder screen.

- Header: title in t-title, path in t-compact JetBrains Mono text-tertiary, right-side Pause AI toggle (per v2 Section 21), filter chips as segmented control (All / Unprocessed / Needs Review / Moving / Errors)
- Main file list: 26px rows, 6px state dots per state dot system (no dot = settled, text-tertiary = unprocessed, warn = needs review, accent = moving, bad = error)
- Error dot hover tooltip per v2 Section 26
- Bottom "Currently moving" section: collapsible card (bg-raised + border-subtle + 8px radius + highlight-top + shadow-card, 16px padding), count in JetBrains Mono, 4px progress bar with accent fill on inset-recess track
- Same-drive moves: 1-sec toast per v2 Section 30
- Cross-drive moves: persistent bar

Error handling: bad dot, hover tooltip, sidebar badge turns bad-wash + bad-edge with count. Toast on failure with bad-edge variant.

Commit: "feat(everything-folder): unified file processing view with state dots and move queue"
```

## Prompt 9: Settings — all 11 panes

```
Read finalization spec section A.12 and v2 Section 21 (inputs), Section 22 (cards).

Replace current Settings screen with full version. Two-column layout:
- Nav column (200px): bg-chrome, 1px border-hairline right edge. Items use sidebar item spec (28px tall, 6px radius, t-body Inter 500). Active section shows bg-pressed + 2px accent left bar.
- Content column: bg-content, 24px padding, 640px max content width.

All 11 panes implemented per A.12.1 through A.12.11. All controls per v2 Section 21:
- Toggles: 32×18 track with inset-recess off state, accent on state, 14×14 thumb
- Sliders: 4px inset-recess track, accent fill, 14×14 thumb with shadow-raised
- Segmented controls: concave container with convex active pill that slides
- Text inputs: concave chrome, accent-edge + inset-recess-strong on focus
- Checkboxes: 16×16 with accent fill when checked
- Radios: 16×16 with 6×6 accent dot when selected

Cards group related settings per v2 Section 22.

Custom File Types pane includes "Re-run setup conversation" secondary button.

Shortcuts pane: each keybinding row with action label + kbd pill (bg-raised + border-subtle + 4px radius, t-small JetBrains Mono). Click to rebind.

Commit: "feat(settings): all 11 panes with v2-compliant controls"
```

## Prompt 10: Overlays — Command Palette, Tag Canvas, modals, snackbars

```
Read finalization spec section A.11 and v2 Sections 16 (command palette), 22 (modals), 27 (context menu), 30 (toast).

Implement four overlay types:

1. Command Palette (Ctrl+K) per v2 Section 16: 640px, bg-raised + border-subtle + 10px radius + highlight-top + shadow-modal. 44px input top, 1px border-hairline below, split body (300px list + preview). Keyboard-selected result: accent-wash + 2px accent left bar. Search/Chat segmented control toggle. Open animation dur-fast fade + translateY(4px) ease-out. Backdrop scrim rgba(0,0,0,0.4) with subtle blur.

2. Tag Canvas (820×540): bg-raised + border-strong + 10px radius + highlight-top + shadow-modal. 48px header, two-pane body. Left (240px, bg-content) tag tree. Right graph + file grid. SVG arrows with 1px text-tertiary default stroke, 1.5px accent for selected. Backdrop scrim at rgba(0,0,0,0.5) with stronger blur.

3. Confirmation modals (440px) per v2 Section 22: bg-raised + border-strong + highlight-top + shadow-modal, 24px padding, 10px radius. Header with semantic icon. Optional concave "type-WORD" input. Footer with Cancel (secondary) + danger or primary action button. Open animation dur-slide fade + translateY(6px) ease-out.

4. Snackbars (bottom-center, 360px, accent-edge border, 5s auto-dismiss with bottom progress bar) and Toasts (bottom-right, variants by border: default/accent/bad) per v2 Section 30.

All overlays support ESC to dismiss. Click outside dismisses (except error toasts).

Commit: "feat(overlays): v2-compliant command palette, tag canvas, modals, snackbars"
```

## Prompt 11: Right-click context menus

```
Read finalization spec section A.10 and v2 Section 27 (context menu).

Implement five context menu variants per A.10. Menu chrome per v2 Section 27:
- bg-raised background, 1px border-subtle, 8px radius, highlight-top + shadow-popover, 4px padding, 180px min width
- Items 28px tall, 5px radius, optional 14×14 leading icon (text-secondary)
- Optional right-aligned kbd shortcut in t-small JetBrains Mono 500 text-tertiary
- Hover: accent-wash background + label/icon shift to accent
- Destructive items: bad text, hover bad-wash
- Separators: 1px border-subtle, margin 4px 0

Open animation: 80ms fade only, no movement (context menus expect immediacy).

Menu variants:
1. File row
2. Folder (browser and canvas)
3. Empty area
4. Tab
5. Sidebar item

Wire right-click handlers throughout the app.

Commit: "feat(context-menus): five menu variants wired throughout"
```

## Prompt 12: First-Run Setup (standalone window)

```
Read finalization spec section A.13 and v2 Section 32 (onboarding).

Create frontend/setup/index.html as a standalone window. Background bg-backdrop.

Left rail (240px, bg-chrome, 1px border-hairline right):
- 48×48 brand mark + "FilePlus" wordmark
- Version in t-small JetBrains Mono text-tertiary
- Step list with 24×24 circle state indicators per v2 Section 25 style
- Footer info in t-small JetBrains Mono text-tertiary

Content area (flex-grow, 80px padding, 560px max):
- 64×64 Lucide hero icon in accent
- t-display title
- t-read body

Seven steps per A.13. Step 3 Claude API: concave password input with 14×14 lock leading icon. Step 5 final touches: cards per v2 Section 22 with checkbox + name + description + size right.

For Step 6 conversation, use same chat styling as A.5.1.

For Step 7, two large cards side by side:
- "Start first scan" as primary card (accent-wash bg + accent-edge border + highlight-top)
- "Just open the app" as secondary card (bg-raised + border-subtle + highlight-top + shadow-card)

"Finish setup" primary button bottom-right.

Commit: "feat(setup): v2-compliant seven-step first-run setup"
```

## Prompt 13: Tray Popout (standalone window)

```
Read finalization spec section A.14 and v2 Section 31 (tray popout).

Create frontend/tray/index.html as standalone popout (380px × 500-600px).

Container: bg-backdrop, 1px border-strong, 12px radius, shadow-modal. Anchored above tray.

Per v2 Section 31 and A.14:
- Header: bg-chrome + 1px border-hairline bottom, 14px padding. 22×22 brand mark + title + right icons (28×28 icon buttons).
- Sub-tab toggle (Recent/Favorites) as segmented control
- Optional active download block: accent-wash + 1px border-hairline bottom, 18×18 Lucide arrow-down in accent, filename t-body Inter 600, 4px inline progress bar, size progress in JetBrains Mono
- Recent list with state dots (6px, semantic colors)
- Action buttons (Drag, Open, Reveal, Copy) — CRITICAL: icons render at exactly 16×16, never larger. This was the v1 bug. Each button 36px tall, bg-raised + border-subtle + 6px radius + highlight-top + shadow-raised. Vertical stack: 16×16 icon on top, t-small Inter 500 label below.
- Currently moving section bottom: collapsible card per v2 Section 22
- Footer: bg-chrome + 1px border-hairline top, 10px 14px padding. Icon buttons + "Open FilePlus" primary button + settings icon.

Tray icon right-click menu per A.14.10.

Drag-to-tray: amber pulse (scale 1 → 1.4 → 1 at 600ms) on successful drop.

Auto-dismiss on click outside or 8-sec idle.

Commit: "feat(tray): v2-compliant popout with state dots and fixed icon sizing"
```

## Prompt 14: Empty states + error states pass

```
Read finalization spec sections A.15 and A.16 and v2 Section 29 (empty state), Section 30 (toast).

Implement empty states for: Home > Recent, Home > Favorites, Browser empty folder, Review Bin, File Tree no snapshots, Search no results, Tag Canvas no tags, Everything Folder empty, Tray popout empty.

Pattern per v2 Section 29:
- 48×48 Lucide outlined icon in text-tertiary (or semantic color where appropriate)
- t-title-sm Inter 600 title
- t-body Inter 400 text-secondary description (max 360px width)
- Optional secondary or primary button CTA
- 12px gap between elements

Implement error states for: file not found, scan interrupted, AI offline, disk space low, database integrity, cloud API key invalid, file failed to process.

Pattern per A.16:
- Full-width inline banner at top (36-44px tall)
- bad-wash background + 1px bad-edge bottom + highlight-top inset
- 14×14 Lucide alert-circle in bad leading
- t-body Inter 500 message
- Suggested action as secondary button (bad text, hover bad-wash) right-aligned
- Optional ghost × dismiss right-most

Commit: "feat(states): v2-compliant empty and error states"
```

## Prompt 15: Edge case implementations

```
Read finalization spec section A.17. Implement the 20 edge cases with the style treatments specified.

Wire the feature behavior per the feature list, using the style treatments in A.17:
1. Vanish state: strikethrough 60% opacity, fade out over 1s
2. External folder missing banner per A.16
3. File drop on tab body: accent drop-target styling + confirmation snackbar
4. Second instance: brief amber pulse on taskbar icon
5. Background scan badge: accent badge with percentage in JetBrains Mono
6-20: as specified in A.17

Modals use v2 Section 22 chrome. Toasts use v2 Section 30. Tooltips use v2 Section 26.

Commit: "feat(edge-cases): 20 edge case behaviors with v2-compliant styling"
```

## Prompt 16: Final integration and audit

```
Final integration and audit pass.

1. Read the entire finalization spec and v2 design tokens spec one more time.
2. Verify every screen mentioned exists, every button has a data-action attribute, every overlay can be triggered, every keyboard shortcut is wired, every empty and error state has a trigger condition.
3. Verify the state dot system (no dot / text-tertiary / warn / accent / bad) is consistent everywhere it appears: Everything Folder, Tray popout, Review Bin, Recent.
4. Verify tag chip poker-stack visual is consistent in Browser, Inspector, Recent, Tray, Tag Canvas.
5. Verify Everything Folder + Review Bin + Downloads Folder unified model (Review Bin is a filter, not separate).

Run the v2 Section 41 audit checklist against the complete app. Report pass/fail per line item. Fix any failures.

Verify specifically:
- The app window has a visible 10px radius, 1px border-strong edge, shadow-window drop shadow, 32px custom titlebar
- The sidebar/content seam is a 1px border-hairline
- Every button at default state passes the Section 39 clickability rule
- The Approvals pill has highlight-top-strong + shadow-raised, full 999px radius
- File rows are 26px default, hover uses bg-raised, selected uses accent-wash + 2px accent left bar (states are visually distinct)
- Every Lucide SVG has explicit width and height
- Tray action buttons render icons at 16×16, never larger
- Panel and tab content swaps are instant jump-cut, no fade
- prefers-reduced-motion: reduce collapses animations to 0.01ms except AI-filed border, badge pulse, live data

Generate frontend/src/actions.js mapping every data-action to a function stub that logs the call, fetches the backend endpoint from PLAN.md, and shows a "not implemented" toast if endpoint missing.

Generate docs/UI-INVENTORY.md listing every data-action with purpose and screen(s).

Commit: "feat(integration): UI inventory complete, v2 audit passed"
```

---

# Final notes

This spec assumes:
- The current frontend/index.html from the v1 mockup is the starting point
- CLAUDE.md and PLAN.md exist from the original project scaffolding session
- The FilePlus Design Tokens v2 spec is available to Claude Code as `skills/design-tokens-v2.md`
- Backend API endpoints will be defined in a separate Python implementation pass (not covered here)

When running these prompts in Claude Code:
- Run them one at a time, never multiple at once
- Review the output of each before moving to the next
- If something is wrong, use a follow-up prompt to fix it before moving on
- Commit after each successful prompt
- Branch off main for any prompt you're unsure about
- Have Claude Code run the Section 41 audit after every visual prompt (2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13)

Do not give Claude Code this entire document at once. It will try to do everything and fail. Feed it one prompt per session.
