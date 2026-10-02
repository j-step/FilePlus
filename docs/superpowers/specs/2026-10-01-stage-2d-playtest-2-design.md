# Stage 2D — Playtest pass 2: design

**Date:** 2026-10-01
**Source:** "FilePlus Playtest Feedback #2.md" (author, 2026-10-01). Every bullet in it maps to a requirement below (§2 ledger).
**Branch:** `stage/2d-playtest-2` (worktree `.worktrees/stage-2d-playtest-2`), from master@22d555f (master now includes the dev harness).
**Builds on:** `2026-09-12-stage-2c-playtest-pass-1-design.md`, `2026-09-14-stage-2c-pass-2-icon-design.md`. Nothing here relaxes the safety rules in CLAUDE.md.
**Also absorbs:** the unfinished `ux-daily-use`, `tests-verify-honesty` and `docs-vs-code` batches of the pass-2 audit (`.worktrees/stage-2c-pass-2/.superpowers/sdd/2026-09-13-pass-2/confirmed-findings.json`, 61 findings). Each is re-checked against current code first; already-fixed ones are recorded as such, not re-fixed.

## 1. Goal and bar

The author's framing: treat this as the last pass before shipping. Everything already built (browsing, tabs, views, search, Properties, inspector, sidebar, drag and drop, undo, settings) must work without flicker, clipping, layout jumps, dead controls or state loss. Tags and AI stay out of scope (Stage 3). Packaging stays Stage 5.

The author also asked: for every reported issue, find the *class* of oversight behind it and hunt down its siblings (§12).

Decisions taken with the author on 2026-10-01:

| # | Decision |
|---|---|
| D2D-1 | App zoom (Ctrl+= / Ctrl+- / Ctrl+0; the feedback's "Ctrl + arrows") keeps **panel widths fixed on screen**: sidebar and inspector keep their screen width while their contents grow; each zoom step eases in quickly. |
| D2D-2 | One autonomous run, no check-ins; the author does the final feel check. |
| D2D-3 | Feedback line 22 ("too much space between") is ignored by the author's instruction. |
| D2D-4 | `setup/dev-harness` is merged into master before this branch starts (done, 22d555f). |

Rulings made by the controller without asking are marked **Ruling**.

## 2. Feedback ledger

| Feedback item | Section |
|---|---|
| Custom icons flash before shell icons on every folder/tab switch | §4 |
| Ctrl+wheel = Explorer's 8 views in order, continuous size from Small to XL | §3 |
| Icons switch to simpler versions at small sizes | §4.5 |
| Ctrl +/- app zoom: panels closing in feels bad | §5 (D2D-1) |
| Grid names cut off at the bottom at some sizes | §3.4 |
| Icons grow/shrink after the grid adjusts | §3.5, §4.3 |
| List view too small / too big | §3.2 (List is fixed-size) |
| List view = multi-column, Details = properties | §3.2 |
| Names cut after 4 lines, long words wrap, icons stay square, extra height goes down | §3.4 |
| Windows shell icons everywhere; Properties top-left icon = type icon, never the thumbnail | §4.6 |
| New-tab button = plain "+" | §6.1 |
| Search fully collapses before the path squeezes; path starts on the left | §6.2 |
| Image-only folders get freeform thumbnails | §4.4 |
| Ctrl+R / refresh = in-place refresh of the open folders, same scroll, tiny flash | §7 |
| Sort: "Date…" flyout with Created / Modified / Accessed | §6.3 |
| This PC = page of drives with icon, name, usage bar, "free of total" | §8 |
| Sidebar section headers bigger | §9.1 |
| Sidebar sections tighter, thin divider lines | §9.1 |
| Collapsed sidebar icons bigger | §9.2 |
| Sidebar overlay scrollbar, hover widen with fade, scroll fade cues | §9.3 |
| No horizontal sidebar scroll | §9.3 |
| Clean up sidebar spacing/dimensions | §9.1 |
| "Find similar oversights" | §12 |

## 3. Views — the Explorer ladder

### 3.1 The ladder

`browserState.view` becomes one of `content | tiles | details | list | small | icons`. `icons` carries `iconSize` (logical px). The Ctrl+wheel ladder, smallest to largest, is:

```
content → tiles → details → list → small → icons@48 → 56 → 64 → 72 → 80 → 96 → 112 → 128 → 160 → 192 → 224 → 256
```

- One wheel notch = one ladder step. Wheel up (zoom in) moves right; down moves left. Wheel deltas accumulate, and a step fires per 100 units of deltaY so trackpads and high-resolution wheels behave. The 80 ms cooldown is removed. The ladder clamps at both ends.
- Ctrl+wheel acts anywhere over the file area, empty space included. It never zooms the app (the wheel never changes `setZoomFactor`).
- Named sizes: **Medium = 48**, **Large = 96**, **Extra large = 256**. The View menu lists the eight views top to bottom like Explorer: Extra large icons, Large icons, Medium icons, Small icons, List, Details, Tiles, Content. The check mark sits on the nearest bucket for `icons`: < 80 → Medium, < 192 → Large, otherwise Extra large. Picking a menu item sets 48 / 96 / 256.
- The empty-area context menu's View entry becomes a flyout with the same eight items (§6.3 flyout support).
- **Persistence.** Each folder remembers its view and size, Explorer-style: an LRU of 500 paths kept in settings (`ui.folder_views`), so it survives restarts. Default for an unremembered folder: Details. A folder whose entries are more than 50% images/videos defaults to Large icons. Tabs keep their own view state as today.
- `--list-scale` is retired as a user-facing control. Any remaining uses migrate to the per-view sizes below. Old `ui.list_scale` / `ui.view_mode` values migrate once (grid → icons at the nearest size, list → list, details → details).

### 3.2 Layouts (logical px, before app zoom)

| View | Icon | Row / cell | Text | Flow and scroll |
|---|---|---|---|---|
| Content | 32 | full-width row, 56 high, hairline separator | line 1: name (left), "Date modified: …" (right); line 2: type (left), "Size: …" (right), muted | one column, vertical |
| Tiles | 48 | cell 256×64 | name / type / size, three lines, ellipsis | row-major auto-fill columns, vertical |
| Details | 16 | row 26 | columns (Name, Date modified, Type, Size; §6.3 for the date column) | one column, vertical |
| List | 16 | row 22 | name only | **column-major**: fills top to bottom, then the next column to the right; **horizontal scroll**, and the plain wheel scrolls horizontally |
| Small icons | 16 | row 22 | name only | row-major auto-fill columns of fixed width, vertical scroll |
| Icons (48–256) | s | width s + 28, height auto | name under the icon, centred, max 4 lines | row-major auto-fill, vertical |

- List and Small icons share one column width per listing: the measured width of the longest name (canvas `measureText` once per render), clamped to 160–360, plus the icon and padding. Longer names ellipsize and get a tooltip.
- None of Content, Tiles, Details, List or Small icons scales with the wheel. Only app zoom (§5) makes them bigger.
- The column header shows in Details only.

### 3.3 Keyboard navigation per view

Arrow keys move focus geometrically, by the rendered positions of the cells (closing pass-2 finding #168).
- **Icons, Tiles, Small:** ←/→ move within a row and wrap to the previous/next row. ↑/↓ move to the cell in the row above or below whose centre is nearest.
- **List:** ↑/↓ move within a column. ←/→ jump to the neighbouring column at the same row.
- **Details, Content:** ↑/↓ only.
- **Everywhere:** Home/End and PageUp/PageDown work, and Shift/Ctrl selection behaves as today. The focused cell is scrolled into view.

### 3.4 Icon cells: square first, the name grows downward

- The icon box is exactly s×s, centred in a cell of width s+28. The name sits below it at 12px / 16px line height, `overflow-wrap: anywhere`. A long unbroken word wraps inside the cell and never leaves it.
- The name clamps at **4 lines** with an ellipsis. The full name is in the tooltip, and is shown in full while the item is selected *and* focused (Explorer's behaviour); the cell grows downward for that.
- CSS grid: `grid-template-columns: repeat(auto-fill, var(--cell-w))`, `grid-auto-rows: auto`, `align-items: start`. A row is as tall as its tallest name, so long names push the next row down and never squash a cell. Column widths never stretch (no `1fr`), which is why icons never resize after the grid reflows.
- The selection/hover fill covers icon and name together.
- Never clipped (applies to every view): no fixed `height` plus `overflow:hidden` on any element that contains text. Rows use `min-height`, or a height derived from the font's line height. The test sweeps every view at the app zoom steps 0.8, 1, 1.25, 1.5, 2 and asserts that no name's `scrollHeight` exceeds its `clientHeight`, except where it is ellipsized on purpose.

### 3.5 Smooth size changes

- A size change is one synchronous update of `--icon-size` / `--cell-w` on `#list-scroll`. Every icon and thumbnail is sized by CSS from those variables, so it scales in the same frame as its cell.
- The sharper bitmap for the new size swaps in only after `img.decode()` resolves, into the same box (§4.3). Nothing changes size after the reflow.
- **Scroll anchoring.** The item under the pointer (Ctrl+wheel) or the first visible item (menu or keyboard) keeps its on-screen position across the change.
- Changing view or size never re-fetches the listing. It re-renders from the in-memory entries, once.

## 4. Icons and thumbnails without flashing

### 4.1 Root causes in the current code

1. `loadDirectory` renders twice per navigation: `renderDirectory` runs, then `setViewMode` runs `renderDirectory` again, and `setListScale` invalidates icons a third time.
2. Windows-mode grid tiles paint the FilePlus sprite first (`fpThumbBox`), then fade the shell image in over it.
3. Cache hits are never painted synchronously. Markup is built blank, and the cached URL arrives only after a 16 ms scan, the IntersectionObserver callback and an async IO hop.
4. Directory keys are per path (`dir:<path>:<px>`), so every folder in a newly visited directory misses the cache, even though nearly all of them have the same generic folder icon.
5. `activateTab` re-fetches and re-renders from nothing on every tab switch.

### 4.2 Rules

- **One render per navigation.** Decide the view and size *before* the first render. Nothing in `loadDirectory`, `activateTab` or `setViewMode` renders the same listing twice.
- **Synchronous cache paint.** When building a row, the icon helper looks up the renderer LRU (`_fpWinIconCache` / `_fpThumbCache`) with the exact key. On a hit it emits `<img src=…>` already settled, with no observer and no transition.
- **Generic first for per-path keys.** In Windows mode, a directory, `.exe`, `.lnk`, `.url` or `.ico` row paints the shell's generic icon for that kind (`dir:*:<px>`, `ext:.exe:<px>`, etc.). Those generics are resolved once per px bucket and prewarmed at startup. The per-path answer replaces the generic only if its bytes differ (compare the data URL or a hash). A plain folder therefore never visibly changes. Special folders (Desktop, Downloads, desktop.ini custom icons) do change, exactly once, as they do in Explorer.
- **Misses are empty, never wrong.** In Windows mode an unresolved icon slot is empty and keeps its exact size. When the image arrives it fades in over 90 ms (disabled under `prefers-reduced-motion`). The FilePlus sprite appears only after **both** tiers have failed for that item.
- **Stale-while-revalidate tabs.** Each tab keeps its last listing (entries, plus its fetched-at time) in memory. `activateTab` renders that cached listing at once, with scroll and selection restored and icons painted from cache. It then re-fetches in the background and patches only if something changed (§7.2).
- **Prewarm.** At startup and on every icon-size bucket change, request the generic folder, drive and per-kind generics at the current bucket.

### 4.3 Size buckets and swaps

- Requests go out at physical px snapped up to `{16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256}`, capped at 256. The `<img>` is CSS-sized to the logical size, and the browser downsamples. This caps the number of distinct requests while the wheel moves through 48–256, and keeps keys stable at fractional DPR.
- When the bucket changes, the img keeps its current bitmap, scaled by CSS. It swaps to the new bucket's URL only after `decode()`, so the swap shows no blank frame and no size change. Resolution is debounced to 120 ms after the last wheel step, and only for visible rows plus a 200 px margin.

### 4.4 Thumbnails: freeform

- Images and videos in every folder, not just image folders, show their thumbnail in Content, Tiles and Icons views, and at 16 px in Details, List and Small icons (Explorer shows icons at 16; **Ruling:** we keep the 16 px icon there, as Explorer does).
- The thumbnail keeps the image's own aspect ratio inside the s×s box, bottom-aligned like Explorer. It has no frame, background or sprite behind it. **Ruling:** every thumbnail gets a 1 px `--border-subtle` outline hugging the image itself (not the square box), so white-edged screenshots stay visible on a light background.
- While a thumbnail is unresolved, the slot shows the item's *type* icon (the shell icon in Windows mode) and crossfades to the thumbnail. **Ruling:** an image's type icon is a truthful stand-in, not a "wrong" icon.
- Image folders (more than 50% media) default to Large icons (§3.1).

### 4.5 Simpler icons at small sizes

- **Windows mode:** this comes from requesting the true physical px (§4.3). The shell picks the 16/24/32 px resource, which is the simplified art (PDF without the text, `.cpp` without the VS Code badge). This must not be defeated by upscaling a small bitmap or by downsampling a big one. When the logical size is ≤ 32, the request is for exactly that physical px, with no bucket snap-up beyond the next listed bucket.
- **FilePlus mode:** at ≤ 32 logical px, `fpTileIcon` / `iconFor` render the compact variant: no extension label, no badge, just the family glyph. This is a CSS class on the svg (`fp-icon--compact`) that hides the label/badge groups.

### 4.6 Windows icons everywhere

In Windows mode, every place that shows an item icon uses the shell icon. That covers:
- list rows in every view, and tab icons
- the breadcrumb root crumb (drive)
- sidebar Quick Access and pinned folders, sidebar drives
- This PC cards, Home rows, search results, the inspector header
- the Properties header, the drag ghost, the "Open with" app row

Chrome glyphs (toolbar, menus) stay on the Fluent sprite. A test enumerates every icon site and asserts it carries `data-win-icon` (or the shell img) in Windows mode.

**Properties header:** shows the item's type icon at 32 px, never its thumbnail. Example: a `.png` shows the PNG file-type icon. It is resolved through Tier A with `thumbnail=false` semantics: request the icon for the extension (`ext:` key) for ordinary files, the per-path icon for per-path kinds, and the folder icon for directories. It must render inside the Properties dialog (the lazy observer currently never fires there, which is why the FilePlus fallback showed).

## 5. App zoom (Ctrl+= / Ctrl+- / Ctrl+0)

- The zoom steps are the same as today (0.6–2.0). The renderer publishes the current factor as `--app-zoom` on `:root`.
- **Fixed panel widths (D2D-1).** Sidebar width, inspector width and the collapsed rail width are specified in screen px. Their CSS width is `calc(var(--sidebar-w-screen) / var(--app-zoom))`, and the same for the inspector. Text, icons and row heights inside them grow. The file area keeps its width.
  - Panel *min/max* resize limits are in screen px too.
  - The inspector resize handle and the stored widths are screen px. This persists inspector width (closing pass-2 #176).
- **Eased steps.** A zoom step interpolates `webFrame.setZoomFactor` over 4 frames (about 70 ms, ease-out). This is exposed through preload as `electronAPI.zoomTo(factor)`.
  - It is skipped under reduced motion.
  - **Fallback ruling:** if frame time during the ease exceeds 32 ms on the fixture tree in the test, the ease is dropped and the step is instant. The test records which mode is active.
- The zoom pill shows the percentage and fades 1.2 s after the last change.
- At every zoom step, no toolbar, tab or sidebar text clips (§3.4 sweep) and the toolbar collapse order of §6.2 still holds.

## 6. Toolbar, tabs, menus

### 6.1 New-tab button
The new-tab button is the plain `fp-add` "+" glyph at 16 px in a 28 px square ghost button, vertically centred with the tabs. The inline styles are removed and moved into a class.

### 6.2 Path and search share the bar
- The breadcrumb is **left-anchored**: it starts right after the nav group and grows rightward.
- Collapse order as the bar narrows, or as the path grows:
  1. The search box shrinks from its preferred width (280) to its minimum (180).
  2. Search **fully collapses** to the 28 px magnifier button.
  3. Only after that does the breadcrumb overflow. When it does, it right-anchors so the current folder stays visible and the start caves in under the existing leading fade.
- The decision uses the breadcrumb's measured natural width (`scrollWidth`) against the free space, in a ResizeObserver plus a `MutationObserver` on crumbs, with 24 px hysteresis. It is never based on a fixed constant. Focusing the collapsed magnifier (or pressing Ctrl+F) expands search as an overlay over the breadcrumb, without reflowing it, and it collapses again on blur when empty.

### 6.3 Sort, the date flyout, and menu flyouts
- Context menus gain **flyout submenus** (`items: [...]` on an entry), with these behaviours:
  - opening: on hover after 250 ms or on click, or with → / Enter on the keyboard; ← closes
  - placement: flipped to the left when there is no room on the right, and clamped to the window
  - safe-triangle hover so the flyout doesn't close while the pointer moves to it
  - full keyboard navigation
- **Sort menu:** Name, **Date…** ▸ (Date created / Date modified / Date accessed), Type, Size, a separator, then Ascending / Descending. The parent shows a check when any date sort is active, and the flyout checks the active one.
- **Backend:** `/fs/list` and `/fs/list/root` entries gain `created` (`st_birthtime`, falling back to `st_ctime` on Windows) and `accessed` (`st_atime`). Search results gain the same fields wherever they come from a live stat. The index route returns them when it has them, and otherwise sorts those entries last.
- **Details date column:** it follows the active date sort. Its header reads "Date created" / "Date modified" / "Date accessed" and shows that field. Content view's right-hand date line follows it too.
- Sort changes keep the selection and the focused item, and keep the focused item in view.

## 7. Refresh

### 7.1 No more full reloads
- `main.js` sets `Menu.setApplicationMenu(null)`. This drops Electron's default menu and every accelerator it carries: Ctrl+R reload, Ctrl+Shift+R, Ctrl+W close-window, Ctrl+Shift+I, the default zoom accelerators, and the Alt-key menu bar.
  - Every shortcut we actually want is handled in the renderer: Ctrl+W closes a tab, and F12/devtools stays window-local, dev only.
  - A test asserts that Ctrl+R never fires a `did-start-navigation` / page reload: the window's `performance.timeOrigin` must be unchanged.
- **Ctrl+R, F5 and the refresh button** all call one `refreshAll()`, which:
  1. re-lists the **active tab** in place, preserving scroll, selection, anchor, focus, view and size
  2. marks every other tab stale, so they revalidate on activation (§4.2)
  3. in search mode, re-runs the search
  4. in This PC, re-reads the drives
  5. on Home, re-fetches Home's data

### 7.2 In-place patch, with a tiny flash
- The new listing is diffed against the rendered one by path (added, removed, changed size/mtime). Only the changed rows are replaced, inserted or removed, in sorted position. Unchanged rows keep their DOM nodes, so their icons never repaint. `scrollTop` is unchanged.
  - If more than 30% of the rows changed, it does one full render instead, still restoring scroll.
- Feedback: the refresh button icon does one 360° spin (400 ms). The list does a quick opacity dip (1 → 0.55 → 1 over 160 ms), skipped under reduced motion.
- If refresh fails (folder gone, access denied), the current listing stays on screen and an error toast explains why. It does not navigate away. Today a failed navigation leaves the chrome pointing at the new folder; that is pass-2 #55, fixed in the same place.

## 8. This PC

- "This PC" (sidebar header, `thispc-open`, the breadcrumb root, Alt+↑ from a drive root) opens a **This PC page** in the current tab. Its path is the sentinel `thispc:`, it is in history (Back/Forward), and the tab label is "This PC".
  - The sandbox root listing is no longer reachable by "This PC". The sandbox stays reachable as an ordinary folder.
- **Layout:** a "Devices and drives" heading, then drive cards in auto-fill columns (min 280 px). Each card has:
  - the drive icon at 48 (shell icon in Windows mode)
  - the name as Explorer writes it, `Label (C:)`, or `Local Disk (C:)` when unlabelled
  - a usage bar 6 px high: accent fill, turning `--danger` above 90% used, with a track of `--bg-raised`
  - below the bar, muted: "X GB free of Y GB"
- **Data:** `/drives` is extended with `kind` (fixed / removable / network / cdrom) and `fs` (filesystem). Removable and network drives are included, and drives without media are skipped. Sizes use the existing byte formatter (GB/TB, one decimal).
- **Interaction:**
  - single click selects, double click or Enter opens
  - arrow keys navigate (geometric, §3.3)
  - context menu: Open, Open in new tab, Properties (native drive properties via `showProperties`)
  - Ctrl+wheel switches the cards between tiles and a details-style list
  - refresh re-reads the drives
- The sidebar's This PC list and the page share one drive model and one formatter. Renaming a sidebar drive label (if supported) updates both.

## 9. Sidebar

### 9.1 Typography and rhythm
- **Section headers** (Quick Access, This PC, Tags, System): 11px/16px, weight 600, uppercase, tracking 0.04em, `--text-secondary`. That is the `--t-caption` size, one step up from today's 10px micro.
- **Section spacing:** sections are separated by a 1px hairline (`--border-subtle`) inset 12px on both sides, with 6px above and 4px below. The current larger `margin-top` gap is removed, and so is the gap between the last item of one section and the next header.
- **Items:** 28px high, 8px horizontal padding, an 18px icon, then an 8px gap to a 13px label. The Drive usage mini-bars stay, 3px high. A token pass puts all of these values into `:root` (`--sidebar-*`), and no magic numbers remain in the sidebar rules.

### 9.2 Collapsed rail
- The rail stays 52 screen px wide (§5). Items are 40×40 with **22px icons**. Drive letter badges are 22px, and dividers are full rail width minus 16px. Tooltips show the full names.

### 9.3 Scrolling
- `.fp-sidebar` no longer scrolls; only `.fp-sidebar__scroll` does. `overflow-x: hidden` sits on both, and nothing in the sidebar can be wider than it: labels ellipsize and drive rows use `min-width:0`.
- **Overlay scrollbar component** `fpOverlayScroll(el)` (new, in `app.js` or a small new module loaded before `app.js`):
  - The native scrollbar is hidden (`scrollbar-width: none`). An absolutely positioned track and thumb sit *over* the content against the right edge, so they take no layout width.
  - The thumb is 3px wide and `--scrollbar-thumb` coloured. It widens to 7px when the pointer is within the track's 10px hot zone, with a 160ms ease on both width and opacity, so a quick pass doesn't flash.
  - The thumb is drag-scrollable, and clicking the track pages.
  - It is visible while scrolling and on hover of the panel, and fades out 900ms after the last scroll.
  - It is hidden entirely when the content doesn't overflow.
  - It follows content size changes through a ResizeObserver on the content.
- **Scroll cues:** while content is hidden above or below, the scroller gets a 20px top or bottom `mask-image` fade, toggled by classes the component sets (`is-scroll-top` / `is-scroll-bottom`), the same pattern as the tab bar.
- **Ruling:** the inspector panel and the Properties dialog body use the same component, since they have the same problem. The file list keeps its native scrollbar, which needs a precise drag on long folders.

## 10. Pass-2 leftover findings

The 21 `ux-daily-use`, 17 `tests-verify-honesty` and 24 `docs-vs-code` confirmed findings are re-checked against current code. Each is either:
- fixed, with a test where it's behaviour, or
- recorded as "already fixed by <commit>", or
- recorded as superseded by this spec (e.g. #168 by §3.3, #176 by §5, #55 by §7.2).

The ledger is `docs/superpowers/runs/2026-10-01-stage-2d.md` § Leftovers.

## 11. Testing

- **Backend:** pytest for `created`/`accessed` on `/fs/list` and `/fs/list/root`, and for `/drives` `kind`/`fs`, removable included, no-media skipped (psutil mocked).
- **Electron** (new spec `frontend/test/playtest2.spec.js`, plus additions to the smoke where the check is fast):
  - every view renders, and each Ctrl+wheel step walks the ladder in order (the View menu check follows)
  - List scrolls horizontally on a plain wheel
  - icon cells keep width s+28; names ≤ 4 lines; no clipped text across views × zoom steps
  - no icon size change after the size change settles: sample the img `getBoundingClientRect` at 0, 50 and 300 ms
  - **no sprite in Windows mode on revisit:** switching back to a visited folder or tab paints every row icon as a settled img in the first frame (checked from a `requestAnimationFrame` immediately after the render call), with no `.fp-icon` sprite visible
  - one render per navigation (a counter hook)
  - Ctrl+R keeps `timeOrigin`, tabs, scroll and selection; a file added on disk appears after Ctrl+R with scroll unchanged
  - the Sort Date flyout opens and sorts by created
  - This PC shows cards with a bar and the free text; Enter opens a drive
  - sidebar: no horizontal overflow, overlay thumb takes no width (client width equals offset width), fade classes toggle, header font size 11px
  - toolbar collapse order at three window widths
  - Properties icon is a shell img for a `.png` and is not the thumbnail
  - app zoom keeps the sidebar's screen width within 1px across 0.8 to 1.5
- Screenshots of every view at 1.0 and 1.5 zoom, This PC, the sidebar expanded and collapsed, and the toolbar at three widths. The `qa` agent reviews all of them.

## 12. Sibling-oversight sweep

For each reported issue, the bug class and where to hunt. Each finding is fixed and tested, and logged in the run doc.

| Reported | Class | Hunt in |
|---|---|---|
| Icon flash | async content painted via a placeholder swap, or re-rendered from nothing | inspector preview, Home rows, search results, sidebar quick-access/drive icons, tab icons, Properties, drag ghost, folder peeks; any double render (`renderDirectory` callers, `renderHome`, search result rendering) |
| Names cut off | fixed height + overflow hidden around text | tabs, sidebar labels, inspector meta, Properties fields, context menus, breadcrumb crumbs, snackbars, settings rows, Home rows, status bar, at every zoom step |
| Icons resize after layout | box sized by async content or `1fr` stretch | inspector preview, Properties header, This PC cards, Home grid |
| Shell icons not everywhere | an icon site bypassing `iconFor` / shell path | every `fp-` sprite use for an *item* (not chrome) |
| Search box overflow | fixed-constant layout decisions | status bar, inspector header, tab strip overflow, settings rows, Home header, dialogs at narrow width / high zoom |
| Ctrl+R full reload | Electron defaults leaking | default menu accelerators, Alt menu bar, drag-drop of a file onto the window navigating it, `window.open`, middle-click on links, `will-navigate` |
| Refresh loses place | state dropped across re-render | scroll and selection after rename/delete/paste/undo/sort/view change, Back/Forward scroll restore, tab duplicate |
| Missing date fields | listing narrower than the UI needs | inspector dates, Properties dates, search results, Home recent rows |
| This PC → sandbox | navigation target ≠ label | every sidebar item, breadcrumb root, Alt+↑ at a drive root, Home links, tab labels for sentinels |
| Sidebar scrollbar / horizontal scroll | panels with permanent bars or x-overflow | inspector, Properties, settings, search popovers, context menus, Ask File+ popout |
| Small section headers / spacing | typography/spacing off-token | every section header across screens uses the same token |
