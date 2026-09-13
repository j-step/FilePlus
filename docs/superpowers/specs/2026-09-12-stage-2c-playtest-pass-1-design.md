# Stage 2C — Playtest pass 1: design

**Date:** 2026-09-12
**Source:** the author's playtest notes after a day of daily use of the Stage 2 build ("FilePlus Playtest Feedback.md", 2026-09-12). Every bullet in that document maps to a requirement below; §2 is the item-by-item ledger.
**Precedes:** Stage 3 (AI + Everything Folder). Stage 2C is a refinement pass inside Stage 2 (explorer parity), run under the roadmap's §6 protocol: one branch `stage/2c-playtest-1`, one autonomous run, one author review at the end.
**Builds on:** `2026-09-11-stage-2-explorer-parity-design.md` (S2-1..S2-6) and the Stage 2B run summary. Nothing in this spec relaxes the safety rules in the roadmap or CLAUDE.md.

## 1. Goal

Make the daily-use build feel like Windows Explorer where the author expects it to (tabs, selection, drag and drop, properties, views, quick access, icons) and replace the two things the author rejected outright: the search and the icon style. Add the visible shell of the AI entry point so Stage 3 has a home. Fix every flicker and inconsistency reported.

Decisions taken with the author on 2026-09-12:

| # | Decision |
|---|---|
| D2C-1 | Search looks at the **current location live** (walks the disk under the folder you are in, bounded and cancellable). A "This PC" scope chip switches to the SQLite index. |
| D2C-2 | Icons are a **custom FilePlus set by default**, with a Settings option to use **Windows shell icons**. Thumbnails always come from Windows (images, videos, PDFs, folders). |
| D2C-3 | The **Tag Canvas stays a Stage 3 placeholder** (banner). Inspector tags keep working. |
| D2C-4 | The AI button reads **"Ask File+"** and opens a popout shell only; no model is wired in this pass. |

Rulings the controller made without asking (cost if wrong is one bounded rework each) are marked **Ruling** below.

## 2. Feedback ledger

| Feedback item | Section | Status |
|---|---|---|
| Inspector opens on every click; should be a switch; "no file selected" state | §3.4 | build |
| Deselection consistent everywhere, any open space | §3.5 | build |
| Tabs do not work | §3.1 | build |
| Properties: item icon instead of warning icon; Cancel+Close duplication; native option; full General fields; Details tab; "Optimize this folder for" | §5 | build |
| Drive name flashes in the tab; letter in tab, full name in path | §3.2 | build |
| Sidebar drive flashes blue when moving between quick-access items | §3.3 | build |
| Inspector jitters between files | §3.4 | build |
| Favorites: no feedback, star, Add/Remove label toggle | §4.3 | build |
| Refresh button beside the path | §3.6 | build |
| "Tree" → "This PC" dropdown | §3.7 | build |
| Theme toggle needs two clicks dark→light | §3.9 | build |
| Ctrl+wheel zooms only the explorer items | §3.10 | build |
| View and Sort buttons | §3.11 | build |
| Desktop and Screenshots in Quick Access, removable | §3.8 | build |
| Tags "not implemented", Tag Canvas undone | §7 | answered; canvas stays Stage 3 (D2C-3) |
| Dynamic Media View | §3.12 | build |
| Spring-loaded folders while dragging; right-click goes up; multi-file | §4.4 | build |
| Move/Copy badge, cross-drive defaults to copy, Shift forces move | §4.4 | build |
| "Backspace deletes" setting | §3.13 | build |
| Native icons everywhere + custom overhaul + per-extension + thumbnails + folder previews + replace listed icons | §6 | build (D2C-2) |
| Unfocused tabs hard to see | §3.1 | build |
| Selection accent bar hugging the edge; merged borders; grid bar at bottom; multi-select no bar | §4.1 | build |
| Context menu greys out inapplicable items; Open for same-type multi-select | §4.2 | build |
| Search overhaul (Discord-style) | §8 | build (D2C-1) |
| "Ask File+" button and popout | §9 | build (D2C-4) |
| "How does Windows optimize folders?" | §5.5 | answered |
| "What does Index for Search mean?" | §8.7 | answered + relabelled |

## 3. Shell and navigation

### 3.1 Tabs are real

- Each tab owns its state: `{ id, screen, label, path, history: [], historyIndex, view, scrollTop, selection }`. `browserState` and `navHistory` become views over the active tab's record; `switchToTab` saves the outgoing tab's state and restores the incoming one (path re-listed from the API, scroll and selection restored when the listing still contains them).
- New tab (Ctrl+T, the `+` button, the tab menu) opens Home. Middle-click closes a tab. Ctrl+W closes, Ctrl+Shift+T reopens the last closed tab with its path.
- Tab menu: New tab, Duplicate tab (same path and history), Close tab, Close other tabs. **Ruling:** "Pin tab" and "Rename tab" are removed from the menu rather than left as stubs (placeholders are debt).
- Tab label = folder basename; for a drive root the label is the letter only (`D:`). Home tab label "Home".
- Tab visibility: unfocused tabs have a subtle fill (`--bg-raised`), hover a lighter fill (`--bg-hover`), the focused tab has the hairline border and the accent underline. Tokens only.

### 3.2 No label flash on drive navigation

- The breadcrumb's first crumb for a drive shows the Windows-style volume label `Seagate Barracuda 4tb HDD (D:)` (from `/drives`, cached); the tab shows `D:`. Both are computed synchronously from the cached drive list before the listing request, so nothing repaints twice. If the drive list is not loaded yet, the letter is used everywhere until it is.

### 3.3 No sidebar flash

- Sidebar active state has one source of truth: the active tab's path. `updateSidebarActive` runs synchronously on navigation intent (before the fetch) with the target path and again on completion; the optimistic `data-manual-active` flag is removed. Screen items (Home, Settings) clear path highlights immediately.

### 3.4 Inspector is a switch, and does not jitter

- `ui.inspector_open` (config, default on) is the only thing that decides whether the inspector is visible. Ctrl+I and the toolbar button flip it. Selection never opens or closes it.
- With nothing selected the panel shows the same layout with "No file selected" in the header and dimmed empty rows; with several selected it shows the multi summary. No `display` toggling of the aside on selection.
- Jitter fix: the preview box keeps a fixed aspect ratio; the metadata grid has a fixed number of rows with reserved height; the filename is one line with ellipsis; pane switching uses `hidden` on panes whose container has a fixed `min-height`; the width of the aside never changes on selection. Screenshots `inspector-empty.png`, `inspector-file.png` are compared in the smoke for identical bounding boxes of the header, preview and meta blocks.

### 3.5 Deselect anywhere

- A capture-phase `mousedown` on `#app` clears the active selection (Browser rows or Home rows) unless the target is inside an interactive element: `button, a, input, select, textarea, [contenteditable], [role=button], .fp-row, .home-row, .fp-tab, .fp-sidebar__item, .fp-context-menu, .modal, .palette, .fp-inspector__tab, .fp-chip`. Right-click on open space also clears. Marquee selection in the list keeps its current behaviour.

### 3.6 Refresh button

- A refresh icon button sits immediately right of the breadcrumb. It re-lists the current folder only (no index run), keeps selection by path and the scroll position, spins for the duration of the request, and is what F5 calls.

### 3.7 "This PC"

- The "Tree" sidebar section becomes **This PC**: a header row with a chevron that expands or collapses the drive list (state persisted as `ui.sidebar_thispc_open`, default open). Clicking the label opens the Browser at the drives listing (`/fs/list/root`), whose tab label is "This PC".

### 3.8 Quick Access defaults

- Backend `GET /known-folders` returns Windows known folders via `SHGetKnownFolderPath` (Desktop, Downloads, Documents, Pictures, Videos, Music) plus `Screenshots` = `<Pictures>\Screenshots` when it exists. Redirected folders (OneDrive) are honoured because the shell answers.
- Default Quick Access = Home, Desktop, Downloads, Screenshots. Config `ui.quick_access_hidden` (list of known-folder ids) records removals; the sidebar item menu has "Remove from Quick Access", and Settings › Personalization lists the known folders with checkboxes to restore them. User pins stay below the defaults as today.

### 3.9 Theme toggle

- The toolbar toggle flips between the **resolved** theme's opposite (dark ↔ light) and persists that explicit choice; "Follow Windows" remains available only in Settings. Root cause of the two-click bug: the old cycle went dark → light → system, so from "system resolving dark" the first click landed on "dark" with no visible change.

### 3.10 Zoom

- Ctrl+wheel over the list or grid scales only the explorer items via `--list-scale` (0.75 … 2.0 in 8 steps; list: row height, icon and font; grid: tile and thumbnail size). Persisted as `ui.list_scale`. Ctrl+= / Ctrl+− / Ctrl+0 keep the application zoom (keyboard only); the status-bar pill shows application zoom only.

### 3.11 View and Sort buttons

- Toolbar gains **View** and **Sort** dropdown buttons (Windows-style menus, built with the context-menu component so items support checks and disabled states).
- View: Extra large icons, Large icons, Medium icons, Small icons (grid at four `--list-scale` presets), List (name-only rows, no columns), Details (the current columns view); separator; Show hidden items, Show file extensions, Dynamic media view (checks that write the existing settings). `ui.view_mode ∈ { details, list, grid }`; grid size is `ui.list_scale`.
- Sort: Name, Date modified, Type, Size (radio); separator; Ascending, Descending. Sort is `ui.sort` (global default). Column headers keep click-to-sort.
- **Ruling:** view and sort are global defaults, not per-folder memory. Dynamic media view (§3.12) is the only per-folder behaviour.

### 3.12 Dynamic media view

- `ui.dynamic_media_view` (default on): when a folder listing arrives and more than half of its files (folders excluded, hidden excluded) are images or videos, the tab shows the grid at Medium icons; otherwise the user's default view. A manual view change inside that folder wins for the rest of the session (per-path session map). Off = always the user's view.

### 3.13 Backspace deletes

- `ui.backspace_deletes` (default off). On: Backspace trashes the selection exactly like Delete; off: Backspace goes up a folder (today's behaviour). Setting lives in Personalization under "Keyboard".

### 3.14 Related fixes found while mapping

- "Spacious" density has a button but no CSS; add the rule (row 40 px).
- Home rows get the same keyboard and deselect behaviour as Browser rows.
- `syncActiveTabPath` is replaced by the tab model; `openBrowserAt` takes `(path, label, {tab})`.

## 4. Browser, selection, context menu, drag and drop

### 4.1 Selection visuals

- List: the accent bar hugs the row's left edge at `left: 0` inside the list container (container gets no horizontal padding; rows keep their inner padding). Adjacent selected rows merge: shared borders are removed and only the outer corners are rounded, producing one block with one accent bar spanning it. Separated rows keep their own borders and bars.
- Grid: a single selected tile shows the accent bar along its bottom edge; with several tiles selected no bar is drawn, only the accent hairline border and wash.

### 4.2 Context menu applicability

- `CONTEXT_MENUS` items gain an optional `enabled(ctx)` predicate where `ctx = { selection: [entries], target, tab, favoritesSet }`. Disabled items render greyed (`aria-disabled="true"`, no hover, click ignored). Rules:
  - Open: single item; or all selected are files sharing one extension (opens each with the shell, at most 20, confirm above 10).
  - Open with…, Rename, Properties, Index folder, Pin to sidebar: single item only (Pin/Index: folders only).
  - Copy path: enabled for any count (joins with newlines).
  - Cut, Copy, Trash, Add/Remove favorites, Add tag: any count.
  - Paste: only when the clipboard holds entries.

### 4.3 Favorites feedback

- `favoritesSet` (paths) is loaded once at init and kept in sync by every favorite mutation; it lives in `home.js` and is read by `browser.js` rows and the context menu. Favorited rows show a small accent star right of the name (`title="In Favorites"`); the menu item reads "Add to Favorites" or "Remove from Favorites". Folders can be favorites.

### 4.4 Drag and drop, rebuilt on pointer events

- **Ruling:** HTML5 drag and drop is replaced by an in-app pointer-event drag session (Chromium cancels a native drag on right-click and gives no control over the ghost). Native drag-out to other applications was not supported before and stays out of scope.
- Session: pointerdown on a row + 6 px movement starts a drag of the whole selection (the pressed row is added if unselected). A floating badge follows the pointer: the type icon of the first item, then **"Move file" / "Move 3 files" / "Copy …"**. Targets: folder rows, sidebar items with paths, breadcrumb crumbs, the Up button; the hovered target highlights. Escape cancels. Releasing outside a target cancels.
- Move vs copy: same volume → Move; different volume (drive letter or UNC root differs) → Copy. Ctrl held → Copy; Shift held → Move. The badge updates live on modifier keydown/keyup during the drag. Drop calls `fileops.moveTo(paths, dest, copy)`; the existing conflict modal and undo apply.
- Spring-loaded folders: hovering a folder row, a sidebar folder, a crumb or the Up button for 700 ms plays a subtle pulse on the target and navigates into it (or up) while the drag continues; the badge and payload persist across the re-render. Right-click (secondary button down) during the drag navigates up one level. Both work with multiple files.
- Rows also remain keyboard-movable through Cut/Paste as today.

## 5. Properties

### 5.1 Panel

- New module `properties.js` and modal `#properties-modal`: header with the item's own type icon (same source as rows, §6) and name; tabs **General** and **Details**; footer with **Close** and, when there are pending edits, **Apply**. No Cancel button.
- **General, folder:** Name (editable → rename op), Type ("File folder"), Location, Size, Size on disk, Contains ("12 files, 3 folders"; walked in a thread with a 3 s budget, shown as "≥ N" if truncated), Created, Attributes (Read-only, Hidden, Archive checkboxes), **Optimize this folder for** (General items, Documents, Pictures, Videos, Music).
- **General, file:** Name (editable), Type of file ("Text Document (.txt)" from the shell association), Opens with (friendly app name + its icon; **Change…** opens the Windows "Open with" dialog), Location, Size, Size on disk, Created, Modified, Accessed, Attributes (Read-only, Hidden; **Advanced…** opens the native Windows properties dialog for the item).
- **Details:** the Windows property system's values for the item (what Explorer's Details tab shows: for a video Length, Frame width/height, Data rate, Total bitrate, Frame rate…; for images Dimensions, camera data; for audio Title/Artist/Album/Length; for documents Title/Author/Pages). Displayed as grouped name/value rows; empty values omitted.
- Multi-selection: Properties is single-item only in this pass (menu item disabled otherwise).

### 5.2 Setting

- `ui.properties_mode` = `fileplus` (default) | `windows`. In `windows` mode the Properties menu item and Alt+Enter open the native dialog (bridge `electronAPI.showProperties(path)`).

### 5.3 Backend

- `GET /fs/properties?path=` → General fields: `stat` times (created = `st_birthtime`/`st_ctime` on Windows, modified, accessed), size, size on disk (`GetCompressedFileSizeW` rounded up to the volume cluster size from `GetDiskFreeSpaceW`), attributes (`GetFileAttributesW`: read_only, hidden, archive, system), `type_description` and `opens_with` (`AssocQueryStringW` FRIENDLYDOCNAME / FRIENDLYAPPNAME / EXECUTABLE), `contains` for folders (budgeted), `folder_type` from `desktop.ini` `[ViewState] FolderType` when present else the auto-detected type (§5.5).
- `GET /fs/properties/details?path=` → `[{ group, name, value }]` from the shell property store (`pywin32` `propsys`: `SHGetPropertyStoreFromParsingName`, keys named with `PSGetNameFromPropertyKey`), run in a thread, cached by `(path, mtime)`. `pywin32` is added to `requirements.txt`; if it is missing the route returns `503 {detail: "pywin32 not installed"}` and the tab says so.
- `POST /fs/attributes { path, read_only?, hidden?, archive? }` → logged op `attr-set` (extra = previous and new attribute bits) → `SetFileAttributesW` → mark; inverse restores the previous bits. Guarded as a write.
- `POST /fs/folder-type { path, type }` → logged op `folder-type-set` (extra = previous desktop.ini bytes or null) → writes `desktop.ini` (`[ViewState]\nFolderType=<Documents|Pictures|Videos|Music|Generic>` merged into an existing file, hidden+system attributes on the ini, folder marked read-only as Explorer does) → mark; inverse restores the previous file or removes it. Guarded as a write.
- Bridge (main process): `showProperties(path)` runs `frontend/native/show-properties.ps1` hidden (invokes the shell verb and keeps the process alive until the dialog closes); `openWithDialog(path)` runs `rundll32.exe shell32.dll,OpenAs_RunDLL <path>`. Both only accept paths the backend has listed in this session (the renderer passes paths; main.js validates absolute Windows paths and refuses UNC).

### 5.4 Undo

- `attr-set` and `folder-type-set` appear in the Inspector History and are undoable there and with Ctrl+Z (they are batch ops like everything else).

### 5.5 How Windows "optimizes" a folder (answer)

Explorer stores the template in a hidden `desktop.ini` inside the folder: `[ViewState] FolderType=Pictures` (values Generic, Documents, Pictures, Music, Videos). The folder is flagged read-only or system so the shell reads the ini. When no ini exists the shell "sniffs" the content: if most items are images it picks Pictures, videos → Videos, and so on, and it also uses the known-folder identity (the Pictures library is always Pictures). The template chooses column layout and default view. FilePlus mirrors this: the properties panel reads the ini when present, otherwise shows the auto-detected type (same majority rule as §3.12, plus known-folder identity), and the user's explicit choice writes the ini through the guarded, logged op above. Dynamic media view (§3.12) is FilePlus's version of the sniffing.

## 6. Icons and thumbnails

### 6.1 Sources

- `ui.icon_source` = `fileplus` (default) | `windows`. A single renderer helper `icons.js` exposes `iconFor(entry, size)` returning either a sprite reference (`<svg><use href="#fp-…">`) or an `<img>` backed by a cached data URL from the bridge.
- Windows mode: bridge `fileIcon(path, ext, size)` → `app.getFileIcon` in main.js, cached by extension (by full path for `.exe .lnk .url .ico .cpl`), returned as a PNG data URL. Folder icons in Windows mode also come from the shell.
- Thumbnails (both modes): bridge `thumbnail(path, size)` → `nativeImage.createThumbnailFromPath` for images, videos, PDFs and folders (the shell composes the folder preview). LRU cache of 500 keyed by `(path, mtime, size)`; requests are lazy (IntersectionObserver) and cancelled when the tile leaves the viewport. On failure the type icon shows. Grid tiles show thumbnails; list rows show type icons (as Explorer does), except images in list view show a 16 px thumbnail like Explorer's small-icon mode. **Ruling:** in `fileplus` mode folder tiles use the custom folder icon with up to two fanned thumbnails of the first media children (`GET /fs/peek?path=&n=2`, a capped listing); empty folders show the plain folder.

### 6.2 The FilePlus icon set

- Built into `frontend/assets/fp-icons.svg` as `<symbol>`s on a 20 px grid with 1.5 px strokes and 2 px radii, monochrome `currentColor` for chrome, two-tone for file types. Loaded once and inlined at startup so `<use>` works offline.
- **Chrome icons** are vendored from Microsoft's Fluent UI System Icons (MIT), copied by `scripts/build_icons.js` from the `@fluentui/svg-icons` dev dependency into the sprite: sidebar (home, desktop, download, image-multiple for Screenshots, folder, pin, hard-drive for drives, document-search for Scan, tray/inbox for Review Bin, folder-open for Everything Folder, settings, sparkle for Ask File+), toolbar (arrow left/right/up, arrow-sync for refresh, grid/list for View, arrow-sort for Sort, panel-right for Inspector, weather-moon/sunny for theme, search), inspector and menus (open, folder-arrow-right for Reveal, star/star-off, tag, copy, cut, paste, rename, delete, pin, info). This replaces every hand-drawn inline SVG in `index.html` and the JS modules; a gate fails the build if an inline `<svg` remains outside the sprite file.
- **File-type icons** are FilePlus's own family set on the same grid: a shared document silhouette with a coloured tab and a glyph or badge per family — text, markdown, pdf, word, excel, powerpoint, code (with language colour: js/ts/py/html/css/json/xml/yaml/…), image, video, audio, archive, executable, shortcut, installer, font, disk-image, database, spreadsheet-csv, generic. Every known extension maps to a family in `frontend/src/filetypes.js` (generated from `backend/filetypes.py` so search filters and icons agree). Unknown extensions render the generic silhouette with the upper-cased extension as a text badge, so every extension has its own distinct icon. Folders: closed, open, and special glyph variants for Desktop, Downloads, Documents, Pictures, Videos, Music, Screenshots.
- Icons named in the feedback are replaced: drives, scan, review bin, generic file (browser and inspector), reveal in browser. The `#screen-*` placeholders keep their banners.

## 7. Tags

- Inspector tags remain as built (add/remove, persisted, undoable). The Tag Canvas overlay gets the "Not built yet — planned for Stage 3" banner and its mock body is dimmed like the placeholder screens; its sidebar entry stays. (D2C-3.) The feedback's "tags not implemented" observation was the canvas, not the tag store.

## 8. Search

### 8.1 Bar

- The toolbar search is the only search surface. Focusing it opens a dropdown under the bar with **Filters** and **History**:
  - In a specific folder — `in:` (default: current location; choices: current location, This PC, a picked folder)
  - Includes a specific type — `type:` (folder, image, video, audio, document, code, archive, executable, other) or `ext:`
  - Modified — `modified:` (today, this week, this month, this year, custom range)
  - Size — `size:` (< 1 MB, 1–100 MB, > 100 MB, > 1 GB, custom)
  - Tag — `tag:` (from `/tags`)
  - More filters… — a modal with all of the above plus Created range, Hidden items, and "Match whole words".
  - History: the last 10 searches (chips + text) from localStorage with a clear button.
- Chosen filters become chips inside the bar (Discord style); the text after the chips is the name query. Backspace on empty text removes the last chip; clicking a chip removes it. Enter or 300 ms of quiet runs the search; typing cancels the in-flight request (`AbortController` through `API.request`).

### 8.2 Results

- Results render in the Browser list as a search listing: name with matched substrings wrapped in `<mark>`, a "Location" subline (parent path), size, modified. Rows carry the full path so open, context menu, drag, favorites and properties all work. The breadcrumb shows `Search in <folder>` with a Clear (×) that returns to the folder. Clicking away leaves chips, text and results in place; Escape in the bar only closes the dropdown.
- The list header shows "N results" or "First 500 results (refine the search)" when truncated, and "Searching…" while walking.

### 8.3 Layout

- The search bar grows with its content up to 60 % of the toolbar. The breadcrumb yields space from the left: its container is right-anchored so the end of the path stays visible while the start scrolls out (`overflow: hidden; justify-content: flex-end`), with a leading fade.

### 8.4 Backend

- `GET /fs/search?root=&q=&type=&ext=&modified_after=&modified_before=&created_after=&created_before=&min_size=&max_size=&tag=&hidden=&whole_word=&limit=500` walks `root` with `os.scandir` in a thread: case-insensitive substring match on the name (all words must match; `whole_word` respects boundaries), skipping `.FilePlusTrash`, protected read roots, reparse points, and hidden entries unless `hidden=true`. Budget 4 s wall clock, cap `limit`. Returns `{ results: [{ path, name, is_dir, size, modified, created, ext, match: [[start, end], …] }], truncated, elapsed_ms, walked }`. `tag:` intersects with the tagger's file set. Type groups come from `backend/filetypes.py` (served as `GET /filetypes` so the renderer's `filetypes.js` is generated from it by `scripts/build_filetypes.js`).
- `root=*` (This PC scope) uses the index (`/search` extended with the same filters) and the response carries `indexed_roots` so the UI can say "3 drives are not indexed — Index now" (the button runs `POST /index` per drive).

### 8.5 Palette

- Ctrl+K stays the command palette. Its file search mode is replaced by one command "Search files for '<text>'" that hands the text to the toolbar search. One search code path.

### 8.6 Results are safe

- Search is read-only (`path_guard` mode `read`); mutations from result rows go through the same routes and guards as any row.

### 8.7 "Index for search" (answer)

The index is the SQLite `files` table that Stage 2A's indexer fills for a folder tree (names, sizes, dates, hashes). Live search (§8.4) does not need it. It exists for whole-machine search (walking every drive live is too slow), for Stage 3's AI classification and the Everything Folder, and for snapshots. The folder menu item is relabelled **"Index for This PC search"**, and Settings › Scan & Index shows real data instead of a placeholder: indexed roots with file counts and last-run time (`GET /index/status`), a Re-index button, and a Remove-from-index button per root.

## 9. Ask File+

- A pill button **Ask File+** with the sparkle icon sits under the device name in the sidebar, above Quick Access, accent-filled so it stands out. Ctrl+J also opens it.
- It opens `#ask-popout`, a popover anchored to the button: a textarea placeholder "Ask File+ to find, move or organise your files…", three example prompts as chips ("Find last week's screenshots", "Move these PDFs to Documents/Invoices", "What is filling my Downloads folder?"), a disabled Send button with the tooltip "AI arrives in Stage 3", and Close. Nothing is sent anywhere. Escape closes; clicking outside closes.

## 10. Frontend module map after this pass

`api.js, filetypes.js (generated), icons.js, fileops.js, browser.js, dragdrop.js, search.js, inspector.js, properties.js, home.js, settings.js, app.js` — same global-script rules as before (each file may call anything defined earlier at top level). `tabs` state lives in `app.js`. New settings keys: `ui.inspector_open, ui.sidebar_thispc_open, ui.quick_access_hidden, ui.list_scale, ui.view_mode, ui.sort, ui.dynamic_media_view, ui.backspace_deletes, ui.properties_mode, ui.icon_source`.

## 11. Verification

- pytest: every new route (`/fs/search` incl. budget/cap/tag/type filters and protected-root skipping, `/fs/properties`, `/fs/properties/details` (503 path and a real file), `/fs/attributes` + inverse, `/fs/folder-type` + inverse, `/fs/peek`, `/known-folders`, `/filetypes`, `/index/status`), mover inverses, filetypes generation parity (the JS file equals the Python source of truth).
- Smoke (Playwright, zero console errors): open a second tab → navigate → switch back → path restored; search "doc-0" in `_gen` → results with `<mark>` → clear; chips add/remove; properties modal opens with the item icon, General fields populated, Close only; Ask File+ popout opens and closes; deselect by clicking sidebar blank space; favorite star appears and the menu label flips; View and Sort menus; pointer-drag of one file onto a folder shows the badge and moves the file (then undo); inspector switch: off → click a row → still closed; on → deselect → "No file selected" with identical block geometry to the file state; Ctrl+wheel changes `--list-scale` and not the zoom factor.
- Gates: no inline `<svg` outside the sprite; every `filetypes.js` family has a sprite symbol; every `data-icon` referenced exists in the sprite; `check_menu_cases`; contrast check on new tokens; CLAUDE.md ≤ 100 lines.

## 12. Out of scope

Native drag-out to other apps; per-folder view memory; the Tag Canvas graph; any model call behind Ask File+; multi-item Properties; Windows "Details" editing; column customisation; libraries and network locations in This PC.
