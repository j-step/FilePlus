# FilePlus — UI Specification (canonical)

> **Style note (2026-09-10).** Section A.0 "Aesthetic baseline" and every colour, bevel, glow and font reference in this document describe the April 2026 design, which the roadmap replaces (decisions D7/D8 in `superpowers/specs/2026-09-10-fileplus-roadmap-design.md`). Layout, sizing, density and behaviour in this document remain canonical.

> **Stage 2D update (2026-10-02).** Playtest pass 2 (`superpowers/specs/2026-10-01-stage-2d-playtest-2-design.md`; run summary `superpowers/runs/2026-10-01-stage-2d.md`) changed the behaviour of the tab bar, sidebar, toolbar and status bar (A.1.2–A.1.5), Home (A.2, the Shared tab is gone), the file list's views and refresh (A.3.1, A.3.3), the inspector (A.3.2), the empty-area menu (A.10.3), the palette (A.11.1), notices (A.11.4) and Settings (A.12). Each change is marked inline as **Stage 2D** and wins over the older text around it. It also added the This PC page (A.3.0). Screens A.4–A.9 (File Tree, Scan, Review Bin, Everything Folder) are **hidden** until the stage that builds them: no entry point reaches them, and their mock-up markup is kept in `archive/2026-10-02-unbuilt-screens-markup.html`.

**Status:** Canonical source of truth.
**Date last updated:** 2026-04-25 (Stage 2D notes added 2026-10-02).
**Supersedes:** `docs/archive/design-brief.md`. `docs/finalization-spec.md` (archived under `docs/archive/finalization-spec-v0.md`).
**Decision register:** [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md) §2.
**Tokens:** [docs/archive/design-tokens.md](archive/design-tokens.md).

This document describes every screen, surface, overlay, and component in FilePlus v1. It is the only doc Impeccable sessions audit against.

---

# PART A — UI Design Brief

## A.0 Aesthetic baseline

Visual style is specified in `superpowers/specs/2026-09-10-stage-1-redesign-design.md` (§3 tokens, §4 component treatments). This document specifies layout, sizing, density and behaviour only.

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
  - **Stage 2D:** a 28×28 ghost square with the plain 16 px `fp-add` glyph, centred with the tabs. A drive-root tab is labelled with its letter only (`C:`; the full name is in the breadcrumb and sidebar); a This PC tab reads "This PC". A tab keeps its own view, scroll, selection, search and last listing; switching back paints that listing at once and then revalidates it.
- Drag tab to reorder
- Drag a file onto a tab → switches to that tab after 600ms hover (file still held)
- Right-click tab: Duplicate, Close, Close others, Close to right, Move to new window
- Middle-click tab: close
- Ctrl+T new, Ctrl+W close, Ctrl+Shift+T reopen closed

### A.1.3 Sidebar (240px wide, collapsible to 52px icon-only)

> **Stage 2C/2D — supersedes the section list below.** Top to bottom: header; **Quick Access** (Home, the known folders from `GET /known-folders` — Desktop, Downloads and Screenshots by default — then pinned folders; Review Bin is hidden until Stage 3); a hairline divider; **This PC**, which replaced the Tree section: a collapsible section listing every drive (fixed, removable, network, optical) as `Label (C:)` with a 3 px usage bar and "X free of Y" in its tooltip, no per-drive expansion; clicking the section header opens the This PC page (A.3.0) and shows it as active while you are there; **Tags** (the top 8 real tags by file count, hidden while nothing is tagged); bottom anchor **Settings** only (Everything Folder is hidden until Stage 3; the System section with File Tree and Scan until Stage 4).
> Section headers are 11/16 px, weight 600, uppercase, 0.04em tracking, `text-secondary`; sections are separated by 1 px `border-subtle` dividers inset 12 px; items are 28 px tall with an 18 px icon, 8 px gap and 13 px label. The collapsed rail is 52 screen px with 40×40 items, 22 px icons, a This PC icon entry and a tooltip on every item. The sidebar never scrolls sideways; its scroller uses the overlay scrollbar (no native bar: a 3 px thumb that widens to 7 px near the edge, shows while scrolling or hovering, fades 900 ms after the last scroll, with 20 px top/bottom fade cues). Its width is in screen px (`ui.sidebar_w`), so app zoom grows its contents but never narrows it. Mouse clicks on sidebar items hand keyboard focus back to the list.
- Header (56px tall): 24×24 brand mark + "FilePlus" in `t-body` Inter 600 + subtitle in `t-small` Inter 400 `text-tertiary` (drive portion in JetBrains Mono, format: "D:\ · 214k indexed") + 22×22 collapse toggle right
- 1px `border-hairline` right edge (the single structural seam in the app, only required panel-to-panel border)
- Section labels: `t-micro` uppercase +0.06em `text-tertiary`
- **Quick Access section:**
  - Home
  - Review Bin (count badge with `accent-wash` background and `accent-edge` border if non-zero)
  - Downloads (opens the Browser screen pointed at the configured Downloads Folder path; see §A.12.4. No bespoke "Downloads screen" exists.)
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

> **Stage 2C/2D — supersedes the bullets below where they differ.** Left to right: Back / Forward / Up; the breadcrumb, **left-anchored** (a drive path starts with an icon-only This PC root crumb); Refresh (A.3.3); the search box; the **View** and **Sort** dropdown buttons, which replaced the List / Grid segmented control; the Inspector toggle. As the bar narrows or the path grows: (1) the search box shrinks from 280 to 120 px, filling the space up to the end of the path, (2) it folds to a magnifier (an input-height square) that keeps the field's lighter fill, (3) only then does the path overflow — it right-anchors under a leading fade, and the current folder never fades (it ellipsizes, with the full name as a tooltip), (4) the current folder is never squeezed below a readable floor (~56 px): when even the magnifier leaves it less, the theme toggle, then Refresh, the Inspector toggle and View/Sort move into a "…" (See more) button at the end of the row, whose menu lists them with their icons (View and Sort as flyouts, the Inspector with its on/off check) — nothing just disappears. The decision uses the path's measured width with 24 px hysteresis, never a fixed constant. The magnifier or Ctrl+F opens search in flow: the bar grows over ~140 ms and pushes the path left (never covers it), giving way to keep the current folder's name whole where it can, then down to ~80 px, before anything moves into the "…" menu; it folds back the same way on blur when empty. Both are instant with Animations off (Stage 2D addendum §2). An in-bar × clears a search. Clicking a toolbar button hands keyboard focus back to the list, so Enter afterwards opens the focused row (Explorer's model).
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
- **Stage 2D:** there is no background-task indicator (the fake "Indexing 12%" is gone) and no Review Bin pill. Left: item count and selection (on Home they count the visible pane; Settings shows none), plus "N items cut" / "N items copied" while the clipboard holds them. Right: the zoom pill (shows the % on every app-zoom change, fades 1.2 s later, click resets to 100 %), the write-mode hint and the keyboard hints, which hide first when the bar is narrow. One line; it never wraps.

---

## A.2 Screen 1 — Home (default landing)

Three sub-tabs at the top of the screen content area: Recent (default), Favorites, Shared (disabled, "v2" tooltip). **Stage 2D:** two sub-tabs, Recent and Favorites; the Shared tab was removed (A.2.3). Tabs use the underline tab style (44px tall container, 2px `accent` underline slides between active tabs, 1px `border-hairline` baseline).

### A.2.1 Recent sub-tab
Grouped vertical scroll: Today, Yesterday, This week, Earlier this month, Older.

Each section: header in `t-title-sm` Inter 600 `text-primary` with "view all →" ghost link right-aligned (`t-body` Inter 500 `text-secondary`, hover `text-primary`).

Each row (26px default density): 16×16 file icon (native Windows extract for branded files, Lucide for generic/folders), filename in `t-body` Inter 500 `text-primary`, path in `t-compact` JetBrains Mono 400 `text-tertiary` (ellipsized), action+time ("opened 11:20") in `t-compact` JetBrains Mono 400 `text-secondary`, tag chip stack.

Selected row: `accent-wash` background, 2px `accent` left bar (4px from edge, 4px shorter than row). Instant state change.

Hover: `bg-raised` background + `highlight-top` inset, `dur-flash` transition. Per-row hover actions appear at right: 24×24 ghost icon buttons (Open, Reveal, Copy path) with 14×14 Lucide icons.

**Stage 2D:** the name keeps priority as the row narrows (the path gives way first and is cut from the left); a truncated name, folder or time carries a tooltip; an item moved or deleted since is dimmed with a "Moved or deleted" tooltip and selecting it fetches nothing. Each pane is one tab stop (Up/Down/Home/End move between rows; the hover buttons are not tab stops).

Empty state: 48×48 Lucide outlined icon in `text-tertiary` + "Nothing here yet." in `t-title-sm` Inter 600 + "Files you open will appear in this list." in `t-body` Inter 400 `text-secondary` (max 360px width).

### A.2.2 Favorites sub-tab
Same row layout as Recent.
No time grouping. Manual order, drag to reorder.
14×14 Lucide `star-filled` icon at right of each row in `accent` color. Click unfavorites (star fills → empties, row fades, removes after 200ms).
Empty state: "Right-click any file or folder to add it here."

### A.2.3 Shared sub-tab
**Removed in Stage 2D (2026-10-02).** A permanently disabled tab is a control that does nothing, so the tab and its empty pane left the app (markup in `archive/2026-10-02-unbuilt-screens-markup.html`). It comes back only with v2's shared-files feature. The original text: disabled, tooltip "Cloud and network shared files coming in a future version."; tab label `text-tertiary` with 40% opacity, no hover state.

---

## A.3 Screen 2 — Browser

Three-pane: sidebar (already part of global chrome), file list (center), inspector (right, collapsible).

### A.3.0 This PC page (Stage 2D)
- Opened by the sidebar's This PC header, the breadcrumb's This PC root crumb, and Up / Alt+Up / Backspace at a drive root (which lands with that drive selected; Backspace only while Settings › Personalization › "Backspace deletes selected items" (`ui.backspace_deletes`) is off — when it is on, Backspace deletes the selection instead and never navigates). It opens in the current tab, is a step in Back/Forward history (path `thispc:`), and the tab reads "This PC". A tab that has no folder yet opens here when it switches to the Browser (a new tab itself opens Home). The sandbox root is no longer what "This PC" opens.
- "Devices and drives" heading, then drive cards in auto-fill columns (min 280 px). Each card: the drive icon at 48 px (the shell icon in Windows-icon mode); the name as Explorer writes it, `Label (C:)`, or by kind when unlabelled (`Local Disk`, `USB Drive`, `Network Drive`, `CD Drive`); a 6 px usage bar (accent fill, `bad` above 90 % used); "X GB free of Y GB" below it, or "Unavailable" when the drive did not answer in time.
- Single click selects, double click or Enter opens, arrow keys move geometrically. Card menu: Open, Open in new tab, Properties (the native drive Properties). Empty-space menu: Refresh and View (Tiles / Details). Ctrl+wheel switches tiles ↔ details (`ui.thispc_view`). Refresh re-reads the drives and patches the cards in place.
- With a drive card selected the inspector shows that drive's summary: its icon, `Label (C:)` and mount (`C:\`), the usage bar, and Type, File system, Used (with %), Free and Capacity ("Unavailable" when the drive did not answer); no Preview/Tags/History tabs. With no card selected it shows "No file selected". Its Open / Open with… / Reveal buttons are disabled on this page either way (open a drive with a double click or Enter). A "current location" search from This PC searches the index.

### A.3.1 File list (center pane)

> **Stage 2D — views (supersedes "List view" / "Grid view" below).** The file list has Explorer's eight views. Ctrl+wheel anywhere over the file area walks one ladder, one step per wheel notch (deltas accumulate per 100 units), clamped at both ends, never zooming the app: `Content → Tiles → Details → List → Small icons → Icons 48 → 56 → 64 → 72 → 80 → 96 → 112 → 128 → 160 → 192 → 224 → 256`. The View menu (toolbar button, and a flyout in the empty-area menu) lists Extra large icons (256), Large icons (96), Medium icons (48), Small icons, List, Details, Tiles, Content; the check sits on the nearest named size.
> - **Layouts (logical px, before app zoom):** Content — 32 px icon, full-width 56 px rows: name and the sort's date on line 1, type and size on line 2. Tiles — 48 px icon, 256×64 cells with name / type / size. Details — 16 px icon, 26 px rows, columns Name / date / Type / Size (the column header shows only here; a narrow pane drops Tags, then Size, then the date before Name goes under 120 px). List — 16 px icon, 22 px rows, column-major with horizontal scroll (the plain wheel scrolls sideways). Small icons — 16 px icon, 22 px rows in fixed-width columns. Icons 48–256 — an s×s icon box in an (s+28)-wide cell, name under it, clamped at 4 lines with an ellipsis (shown in full while the item is selected and focused); long unbroken names wrap inside the cell. List and Small icons share one column width per folder (the longest name, 160–360 px). Only the icon views scale with the wheel; the others grow only with app zoom.
> - **Memory:** each folder remembers its view and size (`ui.folder_views`, the 500 most recent folders). An unremembered folder opens in Details, or in Large icons when more than half of it is images or videos. A tab keeps its own view.
> - **Keys:** arrows move by the cells' real positions — in icon/tile/small views ←/→ wrap along rows and ↑/↓ go to the nearest cell above/below; in List ↑/↓ move within a column and ←/→ jump columns; Details and Content use ↑/↓ only. Home/End and PageUp/PageDown work everywhere.
> - **Sort:** Name, Date… (Date created / Date modified / Date accessed), Type, Size, then Ascending / Descending. The Details date column and Content's date line follow the active date sort. A sort keeps the selection and keeps the focused item in view.
> - **Icons and thumbnails:** a size change scales every icon in the same frame (CSS from `--icon-size`), and the sharper bitmap swaps in after it has decoded — nothing changes size after the reflow, nothing flashes. Images and videos show freeform thumbnails (their own aspect ratio, bottom-aligned, a hairline outline, no frame) in Content, Tiles and Icons; the 16 px views show the type icon. At 32 px and below, icons use their simpler small-size art. In Windows-icon mode every item icon is the shell's.
> - **Cut / copy:** cut items show ghosted (50 %), copied items carry a small accent dot, in every view, until the clipboard changes.

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
**Stage 2D: not built, and dropped.** Its CSS was never wired and was deleted; a narrow file area drops Details columns instead (see Views above).

### A.3.2 Inspector (right pane; open by default since Stage 2C)

Per v2 token spec Section 22:
- Docked: `bg-content` background (matches work area), 1px `border-hairline` left edge, 16px padding, no outer shadow
- Detached: `bg-raised` background, 1px `border-subtle`, 10px radius, `highlight-top` + `shadow-popover`

Behavior (**superseded by Stage 2C §3.4 and Stage 2D**; the April text said closed by default, opened by the first file click, not persisted):
- **Open by default.** It is a switch: the toolbar toggle and Ctrl+I are the only things that open or close it. Selection never opens or closes it. The state is persisted (`ui.inspector_open`).
- Push-style: file list shrinks to accommodate.
- Width default 340px, resizable via drag handle on left edge (min 280, max 520). Drag handle: 4px wide hit area, `accent` color on hover. **Stage 2D:** the width is in screen px and persisted (`ui.inspector_w`), so app zoom grows its contents but never narrows it; the handle is hidden while the inspector is closed.
- **Stage 2D:** it never names an item that is not selected — an emptied selection shows "No file selected" at once, a click shows the new item at once, only a burst of key-repeat changes waits 120 ms; a rename or move keeps the item selected under its new name, a delete selects the next item. Open / Open with… / Reveal are disabled unless exactly one item is selected (Open with… is for files only). Everything above the action row scrolls with the overlay scrollbar and the action row stays pinned; at the 500 px minimum window height the preview shrinks first.

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

### A.3.3 Refresh and keeping your place (Stage 2D)
- **Ctrl+R, F5 and the Refresh button** do the same thing: re-list the open folder in place. Scroll, selection, focus, view and size stay; only rows that changed are replaced, inserted or removed (more than 30 % changed → one full render, scroll still kept). Other tabs are marked stale and revalidate when you switch to them; a search re-runs; This PC re-reads the drives; Home re-fetches. The refresh icon spins once (`--motion-refresh-spin`, 200 ms) and the list dips in opacity (`--motion-refresh-dip`, 140 ms); both are off when Settings › Animations is off. A failed refresh keeps the listing and says why in an error toast. An inline rename survives a refresh.
- The app never reloads its page: Electron's default menu is removed (so are its Ctrl+R reload, Ctrl+Shift+I, zoom keys and Alt menu bar), navigation away from the app page is refused (a file dropped on the window is blocked, not copied in) and `window.open` makes no window. F12 opens DevTools only outside `FILEPLUS_ENV=prod`.
- **Places:** Back / Forward restore each folder's scroll and selection; Up selects the folder it came out of; after a delete the item that takes its place is selected; after a paste or undo, what landed is selected.

---

## A.4 Screen 3 — File Tree (canvas)

**Scope note (v1):** This screen has exactly three modes — Live, Snapshot view, Proposal review. Snapshot-to-snapshot side-by-side comparison ("Comparison mode") is explicitly out of scope for v1; it is approximated by switching between snapshots in the right rail.

Three modes with banners. Banners are 36px tall, flush to top of content area, with 1px `border-hairline` bottom:
- **Live mode** (default, no banner)
- **Snapshot view mode**: `warn-wash` background, `warn-edge` border-bottom, 14×14 Lucide `history` icon in `warn`, `t-body` Inter 500 `warn` text: "Viewing snapshot from [date] · read-only" with "Return to live" secondary button right-aligned
- **Proposal review mode**: `accent-wash` background, `accent-edge` border-bottom, 14×14 Lucide `wand-2` icon in `accent`, `t-body` Inter 500 `accent` text: "Reviewing proposed changes · changes you make update the proposal" with "Execute" primary button right-aligned. (No sparkles iconography or AI-personality language anywhere on the banner.)

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
> **Stage 2D:** View is a flyout with the eight views (A.3.1). Menus support flyout submenus: hover 250 ms, click, → or Enter opens; ← or Escape closes only the innermost; they flip left at the window edge and keep a safe triangle for the pointer. A menu taller than the window scrolls inside itself. Resizing the window or scrolling outside a menu closes it. On This PC the empty-area menu is Refresh + View (Tiles / Details).

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

> **Stage 2D:** Chat mode (and its Search / Chat toggle and plan buttons) is hidden until it is built (Stage 4); the preview pane, which nothing ever filled, is gone, so the list takes the full width; the footer reads "↑↓ navigate · ⏎ open · Esc close". Key hints read Ctrl, never ⌘.

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

**Stage 2D:** error toasts are opaque, carry `role="alert"`, auto-dismiss after 8 s (the clock pauses while hovered or focused), and sit above panels and dialogs. At most 3 notices show per stack; the oldest non-error goes first. Snackbars stack instead of painting on one spot. The `fp-notifications-enabled` gate is unchanged: only errors bypass it.

---

## A.12 Settings

> **Stage 2D (2026-10-02) — what Settings shows today.** Five panes: **Personalization**, **Scan & Index**, **Shortcuts**, **Data** (under Application) and **About** (under System). The Everything Folder, Downloads Folder, Organization Engine, AI Configuration, Custom File Types and Privacy panes (A.12.3–A.12.8) are hidden until the stage that wires them — none of their controls changed real behaviour — with their markup kept in `archive/2026-10-02-unbuilt-screens-markup.html`. Shortcuts (A.12.9) is a read-only list of the keys the app really handles (rebinding and Quick Slots are not built). Data (A.12.10) has Empty FilePlus trash, the write mode, Clear Recent, Clear icon and thumbnail cache, and Open logs folder; nothing else in A.12.10 is built. About (A.12.11) shows the real app, Electron, Chromium, Node and backend versions, the environment, the write mode and the log folder, with Open logs folder. When the Settings area is narrow (≤ 480 px) the nav becomes one section picker and the whole page scrolls; both scroll areas use the overlay scrollbar.

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
- Browser download redirect: per-browser toggles (Chrome, Firefox, Edge — Brave and Arc deferred to a later version) — each toggle row with 16×16 browser icon
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
- Ctrl+0 through Ctrl+9: governed by the **Quick Slots** subsection below (programmable when in Pages mode; fixed when in Default mode; tab-jump when in Tabs mode).
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
- View mode → List: Ctrl+Shift+L
- View mode → Grid: Ctrl+Shift+G
- Summon FilePlus from anywhere: ⊞+Shift+F
- Open last download: ⊞+Shift+D

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
