# FilePlus — Screen-by-Screen Finalization Spec (ARCHIVED)

> **Superseded by `docs/UI-SPEC.md` on 2026-04-25.** Kept for history. Do not consult for design decisions; consult `docs/UI-SPEC.md`. The aesthetic described below (violet/lavender/blue liquid-glass, Geist fonts) was abandoned in favor of the Burnt Amber Workshop direction documented in DESIGN.md and UI-SPEC.md.

This is the design brief for the final UI pass. Each section is a Claude Design session in itself. Treat it as the source of truth for what every screen and overlay contains, what it does, and how its pieces connect. Implementation detail (how the buttons actually work) is out of scope; this is purely UI scope.

Aesthetic across everything: dark minimal liquid-glass over violet/lavender/blue accents. Glass blur on floating elements only; flat matte on everything else. Geist sans, Geist Mono for paths/metadata/shortcuts. No emoji in chrome. No saturated colors.

---

## Global chrome (every screen)

**Window frame.** Frameless custom titlebar at the very top: app name "FilePlus" left, window controls (min/max/close) right. Drag region across the titlebar.

**Sidebar (left, 240px, collapsible to 52px icon-rail).**

Sections, top to bottom:

- **Header**: logo + "FilePlus" + collapse toggle
- **Quick access**: Home (default selected), Everything Folder (badge for new), Downloads, Recycle Bin
- **Drives**: C:\, D:\, any others detected. Each shows used/total bar.
- **Tree**: pinned and recent folders. Drag to reorder. Each shows a caret for expand. AI-organized branches get a small accent dot.
- **Tags**: top-N tags as colored chips with counts. "View all" at bottom opens Tag Canvas.
- **System**: File Tree, Scan, Review Bin (with badge count), Settings

Sidebar items: 13px label, 16px icon, 6px padding. Active item gets a 2px accent bar on the left, gradient background. Hover gets subtle wash.

**Tab bar (above the toolbar, every screen except first-run).**

Explorer-style tabs. Active tab has accent underline and subtle gradient bg. Inactive tabs muted. New tab "+" button at the right. Each tab shows current folder name, with a small icon for folder type. Close (×) on hover. Right-click tab for: Duplicate tab, Close tab, Close other tabs, Close tabs to the right.

Drag-hover on a tab for ~600ms switches to that tab while still holding a dragged file. Standard browser pattern.

**Toolbar (below tab bar).**

- Back / Forward / Up nav buttons (left)
- Breadcrumb / address bar (flex grow)
- Search box with ⌘K hint (right of breadcrumb, ~280px)
- View mode toggle (List / Grid)
- Inspector toggle button (rightmost)

Breadcrumb segments are clickable, draggable (drop to reparent), and reveal a dropdown of sibling folders on right-click. Clicking the breadcrumb's empty area converts it to an editable address bar with autocomplete.

**Status bar (bottom of every screen, 28px).**

Left side: file count, selection count, total size. Right side: background task indicator (e.g., "Indexing 12% · 8 min"), Review Bin count if non-zero ("3 files need decision"), keyboard hints.

Status bar items are mono font, 11px, muted color. Background task indicator pulses subtly when active.

---

## Screen 1: Home (default landing)

Replaces the mockup's "Recent" screen as the landing. Three sub-tabs at the top: Recent (default), Favorites, Shared (Shared shows "Coming in v2" placeholder; tab visible but disabled with tooltip).

**Sub-tab: Recent**

Grouped sections, vertical scroll:
- Today
- Yesterday
- This week
- Earlier this month
- Older

Each section header is a small caps label with a "view all →" link that opens the Browser screen filtered to that timeframe.

Each row: file icon (16px), filename, path (mono, muted, ellipsized), action-with-time ("opened 11:20", "downloaded 08:41", "moved 2d ago"), tag chips. Selected row gets accent gradient and a 2px accent bar on the left. Hover gets wash.

Empty state: large soft icon + "Nothing here yet. Files you open will appear in this list."

**Sub-tab: Favorites**

Same row layout as Recent but no time grouping. Manual order, drag to reorder. Each row has a star icon at the right that unfavorites on click.

Empty state: "Right-click any file or folder to add it here."

**Sub-tab: Shared**

Disabled, tooltip "Cloud and network shared files coming in a future version."

---

## Screen 2: Browser (file list with optional inspector)

Standard 3-pane minus the third pane (sidebar already counts as the first). Toolbar + content + status bar.

**Content area:** file list, full width by default.

List view columns: name, size, date modified, tags. Sortable by clicking headers. Tags column shows poker-chip stack (overlapping circles in tag colors).

Grid view: thumbnail-based. Tiles include filename and a poker-chip tag stack at the bottom.

**Row interactions:**
- Single click selects
- Double click opens (configurable to single-click in settings)
- Slow double-click on selected row enters inline rename
- Ctrl+click extends multi-select
- Shift+click range-selects
- Click-drag from empty area starts marquee selection
- Drag selected items to reparent (drop into folders, sidebar, tabs)
- Right-click opens context menu

**Tag stack visual:** poker-chip stack, each chip 14px diameter, overlapping by ~8px, ordered by tag importance (system → AI → user). Hover the stack expands it: chips fan out vertically below the row, each labeled. Clicking a chip filters the list by that tag.

**Inspector pop-out (closed by default):**

- Opens on first file click. Stays open across selections until manually closed.
- Push-style: file list shrinks. When inspector is open, list collapses Size / Modified / Tags into a single right-aligned mono line per row (e.g., `2.1 MB · 2d`) with tag chips becoming the poker-chip stack inline. When inspector closes, full columns restore.
- Width default 340px, resizable via drag-handle on left edge. Min 280, max 520.
- Header: file thumbnail/preview area (16:10 aspect). For images: actual image. PDFs: first page. Video: first-frame thumbnail with play overlay. Audio: waveform. Text/MD: rendered preview snippet. Unknown types: large file icon + extension label.
- Below preview: filename (large), full path (mono, muted, breakable).
- Three tabs: **Preview** (full content scrollable), **Tags** (full tag list with add/remove inline), **History** (per-file Time Machine entries).
- Bottom action row: Open, Open with..., Reveal in Explorer, More (overflow menu).

**Multi-select inspector state:** when multiple files selected, inspector shows aggregate: count, total size, common tags, "Select a single file to see preview." Bulk tag editor is available.

---

## Screen 3: File Tree (canvas: viewer + editor + time machine)

Three modes, with prominent banner across the top whenever not in default mode:

- **Live mode** (default, no banner)
- **Snapshot view mode** (warm amber banner: "Viewing snapshot from [date] · read-only")
- **Comparison mode** (info banner: "Comparing [snapshot A] vs [snapshot B]")

**Layout:**

- Left rail (collapsible to icon-only): Jump-to folder list, flattened depth-indented tree of all visible nodes. Click jumps the canvas viewport to that node.
- Center: canvas stage (pan/zoom, marquee select)
- Right rail (collapsible): Snapshots panel

When all rails collapsed, canvas takes full screen.

**Canvas content:**

- Drives at the leftmost column
- Folders to the right, organized by depth. Each depth column shows children of the previous column's selected folder.
- Default expansion: 3 levels visible (drive → top folder → subfolder)
- Each leaf folder with hidden children shows a "+N" badge
- Clicking the badge expands that branch in place
- Sibling sets that exceed viewport width scroll horizontally, no wrapping

**Folder node visual:**

- Compact: icon (vector for sharpness at zoom), folder name (Geist 12px), file count below ("14 files", direct children only, not recursive)
- Hover: light wash, slight elevation
- Selected: accent border, accent glow
- AI-suggested addition: green border + subtle green wash + "new" badge
- AI-suggested removal: red border + strikethrough name + opacity 0.6
- AI-suggested move: amber border + arrow indicator showing target

**Toolbar (floating glass pill, top center of canvas):**

- Changes toggle (show/hide AI-proposed deltas)
- Expand all / Collapse to depth-3 toggle
- Zoom out / zoom percent / zoom in / Fit to view
- Add folder
- Delete (only enabled when nodes selected)
- View hidden files toggle (off by default)
- Fullscreen (collapses both rails)

**Live mode interactions:**

- Drag folder onto another → reparent. Snackbar: "Moved 'Documents/Projects' to 'D:\Archive\'. Undo (Ctrl+Z)" with 5-second window.
- Right-click folder → context menu: Open in Browser tab, Rename (inline), New subfolder, Cut, Copy, Paste, Delete, Properties, Add to Favorites, Show in Explorer
- Inline rename: F2 or right-click → Rename. Cursor lands at end of name.
- Multi-select: Shift+click range, Ctrl+click toggle, marquee with Shift+drag on empty space
- Pan: click-drag on empty space
- Zoom: Ctrl+wheel or pinch
- Click folder once: selects, populates Inspector (right) with folder metadata (size, file count recursive vs direct, date modified, contained types breakdown)
- Double-click folder: opens it in a new Browser tab focused on that path
- Selection count appears in bottom-center floating pill

**Snapshot view mode interactions:**

- Banner across top: "Viewing snapshot from Mon Apr 14 · read-only · [Return to live]"
- All folders shown exactly as they were in that snapshot
- Click any file → "Where is it now?" lookup runs against current index
  - Found: opens new Browser tab focused on current location, with the optional animated path cascade if enabled (highlight cascades through canvas root → final, capped at 3 seconds)
  - Not found: red toast "Error: this file may not exist anymore" with two actions: "Quick search by name" (instant) and "Run deeper scan" (background task)
- Right-click anything in snapshot view: only "Restore this snapshot" (for entire snapshot) or "Find current location" (for files). No edit options.
- "Restore this snapshot" requires explicit confirmation modal: "This will revert your filesystem to the state from [date]. [N] files will be moved back to their original locations. This cannot be easily undone. Type RESTORE to confirm."

**Right rail (Snapshots panel):**

- Header: "Snapshots" with a "New snapshot" button (+ icon)
- List of snapshots, newest first:
  - "Now · Live state" (always at top, current mode indicator)
  - User-bookmarked snapshots (star icon, never expire)
  - Major scan snapshots (badge "Scan", never expire)
  - AI-task snapshots ("23 files moved by AI", expires in 30 days, countdown shown subtly)
  - Daily / weekly / monthly snapshots (per retention rules, expire countdown shown)
- Each snapshot row: timestamp (mono, muted), label, what changed summary (e.g., "Atlas folder created, 3 files moved")
- Click to enter snapshot view mode
- Right-click: Bookmark / Unbookmark, Compare to current, Compare to other snapshot, Delete (with confirmation), Restore

**Empty state (if no snapshots exist yet):** "Snapshots are created automatically before AI tasks and on a schedule. Your first snapshot will appear after the initial scan."

---

## Screen 4: Scan — Configuration (pre-scan)

Reached from sidebar > Scan, or from Settings > Scan & Index > "Run new scan."

Single-page form with cards. Header: "Configure scan" + subtitle "This will index every file in the selected locations and propose an organization. Nothing moves until you approve."

**Cards:**

1. **Scope.** Drives (checkboxes, with size shown). "Add specific folder" with file picker. "Exclude folders" list with chip-style entries.

2. **Cleanup aggressiveness.** Three-segment selector: Conservative / Moderate / Aggressive. Below: bulleted preview of what each level flags ("Conservative: temp files, browser cache only"). Updates as user changes selection.

3. **Tree complexity.** Three-segment selector: Simple / Balanced / Detailed. Same live preview pattern.

4. **Custom file type priorities.** List of user-defined types (e.g., `.vst3 → Music Production`). Add/edit/remove buttons per row. "Add type" CTA at bottom.

5. **Custom categories.** Pre-define categories before scan. List with add/edit/remove.

6. **Estimate.** Live calculation: "Estimated time: 1h 14m · ~214,000 files · runs in background, can close window." Updates when scope changes.

**Footer:** "Cancel" (returns to wherever) and "Start scan →" (primary, accent gradient).

---

## Screen 5: Scan — Progress

Largely as in current mockup, with adjustments.

- Stages list: Index → Deduplicate → Classify → Propose → Review (renamed from "Execute on approval")
- Current stage shows progress bar with shimmer animation (toggleable in settings)
- "Now working on" path display, ticker of recently classified files
- Stats grid: rate, classified, remaining, ETA
- Throughput sparkline graph
- Reassurance banner: "Nothing is being moved yet. Stage 5 (Review) requires your approval. Continues in background if you close the window."
- Footer actions: Pause, Minimize to tray, Stop scan (danger, requires confirmation)

---

## Screen 6: Scan — Results (post-scan)

Reached automatically when scan completes, or from sidebar > Scan if results exist.

Tabbed interface, three tabs:

**Tab 1: Duplicates.**

List of duplicate groups, expandable. Each group:
- Header row: file icon, original filename, size, "X copies" badge, total reclaimable space
- Expanded: each copy shown as a row with full path, last modified, "keep" radio button (one per group, defaults to AI's choice)
- Per-row preview pane on the right (image/text/etc) when row is selected
- "Select all AI suggestions" toggle at top
- Hardlink alternative offered as advanced toggle: "Replace duplicates with links instead of deleting"
- Footer: "Reclaimable: X.X GB" + "Execute deduplication" (requires confirmation)

**Tab 2: Cleanup.**

Categories as collapsible sections:
- Temp files (X items, X.X GB)
- Empty folders (X items)
- Old downloads (X items, X.X GB) — slider for "older than X days"
- Large unused files (X items, X.X GB) — slider for size and last-accessed thresholds
- Orphaned app data (X items)
- Old log files
- Recycle Bin contents
- Thumbnail cache

Each category expands to show individual files with checkboxes. Per-category "Select all" and "Reject all" buttons. Big "Total selected: X.X GB" at top. "Execute cleanup" footer button (with confirmation modal).

**Tab 3: Reorganization.**

Single CTA: "Open File Tree to review proposed reorganization." This sends the user to the File Tree canvas in proposal-review mode (similar to snapshot mode but for proposed future state, with full edit ability before execution). When in this mode, banner: "Reviewing AI proposal · click Execute when ready · changes you make here update the proposal." Footer in canvas: "Reject all proposals" / "Execute proposal" (confirmation modal).

---

## Screen 7: Review Bin (formerly Approval Queue)

Reached from sidebar (with badge), from passive notification card, or from Ctrl+Shift+R shortcut.

Header: "Review Bin · X files need a decision" + subtitle "These files were below the AI's confidence threshold."

Same grouped layout as the current mockup's Approval Queue. Two-pane (list left, detail right).

**List pane:**

Groups by destination (e.g., "→ /album-mix-2024"). Each group:
- Header: destination, file count, average confidence
- Per-group actions: "Review each", "Approve all", "Reject all"
- Each row: filename, route (from → to), action chip ("move", "rename", "flag"), confidence bar, overflow menu

Special group at bottom: "Uncertain — individual review" with accent header for very low confidence (<0.5).

**Detail pane (right):**

- Filename header
- Proposed route (red strike-through old path → green new path)
- "Why" explanation in plain text from the AI
- Tag chips
- "Similar past decisions" showing 3-5 prior actions on similar files
- Footer actions: Reject, Modify path..., Snooze 7d, Approve (primary)
- Keyboard shortcut hints below buttons

**Empty state:** "Nothing to review. The AI is handling everything within your confidence threshold."

**Passive notification card** (separate component, appears bottom-right when AI batches new uncertain items):

- Card: glass blur, accent border, ~360px wide
- Content: "AI wants to organize 23 new files." subtitle "5 above threshold (auto-moved). 18 need your decision."
- Two buttons: "Review →" (opens Review Bin), "Dismiss" (collapses card; items remain in Review Bin silently)
- Auto-dismiss after 30 seconds; never re-shows for the same batch

---

## Screen 8: Settings

Two-column layout: nav (left, 200px) + content (right, scrollable).

**Nav sections:**

- **Application**
  - Personalization
  - Scan & Index
  - Everything Folder
  - Organization engine
  - AI Configuration
  - Custom file types
- **Account**
  - Privacy
  - Shortcuts
  - Data
- **System**
  - About

Each pane uses the card pattern: section header, description, then `settings-card` containing rows with label / sub-label / control.

### Pane: Personalization

- Theme: Dark / Light / System
- Accent palette: lavender, indigo, violet, sky, mix (gradient swatches)
- Inspector default width: range 280-520
- Density: Compact / Comfortable / Spacious
- Tab style: Compact / Standard
- Show file extensions: toggle
- View hidden files: toggle (default off)

### Pane: Scan & Index

- Indexed drives & folders: list with add/remove
- Ignore patterns: chip list (`node_modules`, `.git`, `*.tmp`, etc.)
- File content analysis: toggle (read inside docs/audio/images for tags)
- Re-scan schedule: Manual / Daily / Weekly
- Hidden file handling: skip / index but hide / index and show
- "Run new scan" button → opens Scan Configuration screen

### Pane: Everything Folder

- Watched folder path (file picker)
- Auto-sort: toggle
- Auto-sort confidence threshold: slider with live percentage (default 80%)
- Excluded file types: chip list (e.g., never auto-sort `.exe`, `.iso`)
- Max time before forcing review prompt: slider (default 7 days)
- Browser download redirect: per-browser toggles for detected browsers (Chrome, Firefox, Edge, Brave, Arc). Each shows "Detected" or "Not installed."
- Notification preferences: Off / Only uncertain / Every sort

### Pane: Organization engine

- Autonomy level: Passive / Suggest / Proactive
- Suggestion batch size: slider (10-500, default 100)
- Confidence threshold for Review Bin: slider
- Propose rename of files: toggle
- Propose deletion of duplicates: toggle (byte-identical only)
- Time Machine retention: shows non-editable summary of current rules + link to Data pane for advanced

### Pane: AI Configuration

- **Local LLM**
  - Status: detected (Ollama running / not running)
  - Model selection: dropdown
  - Test classification: button
- **Cloud (Claude API)**
  - Cloud inference: toggle (off by default)
  - API key: password input with show/hide
  - Monthly cost cap: input ($USD)
  - Monthly token cap: input (alternative to cost)
  - Temperature: slider (0.0 - 1.0)
- **Usage stats**
  - Tokens used this month
  - Estimated cost this month
  - Files classified locally vs cloud
  - "Reset stats" button

### Pane: Custom file types

- Table-style list: extension, category, default tags, description
- Each row editable inline
- "Add file type" CTA
- Examples bundled by default: `.vst3`, `.als`, `.flp`, `.fxp`, etc. (music production focus given user)

### Pane: Privacy

- Cloud inference toggle (mirror from AI Config for prominence)
- Analytics: toggle (off by default)
- Redact file contents from logs: toggle (on by default)
- Index encryption: Off / On (AES-256)

### Pane: Shortcuts

Editable list of keybindings. Each row: action label + current binding chip + edit button.

Defaults shown:
- Open command palette: ⌘K
- Open Review Bin: ⌘⇧R
- Focus search: /
- Switch to Home: ⌘1
- Switch to Browser: ⌘2
- Open File Tree: ⌘T
- Toggle inspector: ⌘I
- New folder: ⌘⇧N
- Rename: F2
- Delete: Delete
- Undo last action: ⌘Z
- New tab: ⌘T
- Close tab: ⌘W
- Reopen closed tab: ⌘⇧T
- Toggle hidden files: ⌘.
- View mode cycle: ⌘1/2

### Pane: Data

- Index size display
- Time Machine snapshot storage display + "Cleanup snapshots" button
- Snapshot retention rules:
  - Daily snapshots: toggle (off by default), keep last 7
  - Weekly snapshots: toggle (on by default), keep last 4
  - Monthly snapshots: toggle (on by default), keep last 12
  - AI-task snapshots: 30 days (non-editable, informational)
  - User-bookmarked: forever (informational)
  - Major scan snapshots: forever (informational)
- Disk full safety: warn when snapshot storage exceeds [X] GB, slider
- Export database (backup .zip)
- Import database (restore from backup)
- Clear all AI tags (confirmation required)
- Reset all organization (revert everything app has ever done, requires typed confirmation)
- Reset settings to defaults (does not touch files)

### Pane: About

- Version, build
- Index size, file count
- Local LLM model + version
- Diagnostics export
- Open source licenses
- Reset to defaults

---

## Overlays

### Overlay 1: Command Palette (⌘K)

Centered modal, ~640px wide, glass card with backdrop dim. Default opens with search mode.

**Search mode:**

Input at top with magnifier icon, esc hint right-aligned. Below input split into list (left, 300px) + preview (right, fills).

List sections (scrollable):
- Files (top matches)
- Folders
- Tags (prefix `#`)
- Commands (prefix `>`)

Selected item shows preview in right pane (file content, folder contents summary, tag info, or command description).

Footer: keyboard hints ("↑↓ navigate · ⏎ open · ⇥ action") + mode hints ("> commands · # tags · / paths · or just ask").

**Chat mode:** typing a natural-language sentence or pressing Tab from search mode switches to chat view. AI responds inline with proposed plan and "Send to Review Bin / Approve all / Show me what would change" buttons. Plans always go through the same Review Bin / direct execution paths as everything else.

**Mode toggle in palette header:** small segmented control for Search / Chat (default Search, AI auto-detects intent from input).

### Overlay 2: Tag Canvas

Centered modal, 820×540, glass with stronger backdrop dim.

Header: title with active tag highlighted, close button.

Body two-pane:
- Left (240px): Tag tree (groups: project:*, type:*, app:*, etc.). Each leaf shows count. Click selects.
- Right (fills): Tag relationship graph (SVG with animated arrows between related tags) + filtered file grid below.

**Tag editing in this overlay:**
- Right-click tag node: Rename, Merge into..., Delete, Set color, Set group
- Drag tag onto another to merge (with confirmation)
- Drag tag into a group section to nest

**Footer:** "Manage tags in Settings" link, accent button "Apply selected tags to..." for bulk operations.

### Overlay 3: Right-click context menus

Three primary variants:

**File context menu:**
- Open
- Open with...
- Open in new tab
- Reveal in Browser
- Cut, Copy, Paste
- Rename (F2)
- Delete
- Add tag...
- Reclassify (AI re-runs)
- Add to Favorites
- Compress to .zip
- Properties
- Show in Windows Explorer

**Folder context menu:**
- Open
- Open in new tab
- Open in new window
- Cut, Copy, Paste
- Rename
- Delete
- New folder inside
- New file
- Add to Favorites
- Pin to sidebar
- Reclassify contents
- Properties
- Show in Windows Explorer

**Empty area context menu:**
- New folder
- New file (submenu: text, markdown, etc.)
- Paste
- Refresh
- View → List / Grid
- Sort by → name / size / modified / type / tag
- Group by → none / type / tag / date
- Show hidden files (toggle)
- Properties

Menus use clean grouped sections with subtle separators. Keyboard shortcut hints right-aligned. Hover state subtle. Submenus expand to the right.

### Overlay 4: Confirmation modals

Centered, ~440px wide, glass card.

Used for: Execute scan, Execute reorganization, Execute deduplication, Execute cleanup, Restore snapshot, Reset all organization, Empty Recycle Bin, Permanently delete files.

Standard structure:
- Icon (warning amber for moderate, danger red for severe)
- Title
- Body explaining what will happen
- "Type [WORD] to confirm" input for severe actions
- Cancel + danger-action buttons

### Overlay 5: Snackbar / toasts

Bottom-center for snackbars (action-with-undo), bottom-right for notifications.

Snackbars: ~360px, dark glass, white text, undo button right-aligned, 5-second auto-dismiss with progress bar at the bottom edge.

Notification toasts: ~360px, glass, may include icon, title, body, action buttons, manual dismiss (×) on hover.

Stack vertically when multiple. Newest on top.

---

## Peripheral surfaces

### First-run onboarding

Full-window flow, replaces shell until completed. Steps shown as horizontal progress dots.

1. **Welcome.** App name, tagline, brief one-paragraph explanation. "Get started" CTA.
2. **Set up Everything Folder.** Pick path (default suggestion: `C:\Everything`). Browser redirect toggles for detected browsers. Skip option.
3. **AI setup.** Detect Ollama (offer to install if missing). Optional Claude API key input. "Use local only for now" option.
4. **Custom file types (optional).** Quick-add for music production, dev, design, photography presets. Skip option.
5. **First scan.** "Want to run a full scan now? It can take hours but runs in the background." Yes → Scan Configuration screen. Skip → land on Home.

Each step has Skip + Back + Continue. "Quick setup" link in step 1 picks defaults and skips to Home.

### Tray popup

Triggered from system tray icon click. ~360px wide, anchored above tray.

Sections:
- Header: "FilePlus" + status dot (active / paused) + open-main-window button
- Recent downloads: last 5-10 files from Everything Folder, each with filename, time, drag handle (drag out to other apps), open button
- Quick actions: Pause auto-sort, Open latest download, Open Review Bin
- Footer: keyboard hint for global hotkey

Auto-dismisses on click outside or after 8 seconds idle.

### Notifications (Windows native + in-app toasts)

In-app toasts for: scan complete, AI batched new files, snapshot created, file moved with undo, error states.

Windows native notifications for: scan complete (when window minimized), uncertain files exceed threshold (configurable), errors during background ops.

---

## Empty states (apply to every applicable screen)

Each screen needs an empty state. Standard pattern: large soft icon (40-60px, accent-tinted) + headline (16px, semibold) + subhead (13px, muted) + optional CTA button.

Required:
- Home > Recent: "Nothing here yet. Open a file and it'll appear here."
- Home > Favorites: "Right-click any file or folder to favorite it."
- Browser > empty folder: "This folder is empty. Drop files here or right-click to create new."
- Review Bin: "Nothing to review. The AI is handling everything within your confidence threshold."
- File Tree > no snapshots: "Snapshots are created automatically before AI tasks and on a schedule."
- Search > no results: "No matches for '[query]'. Try a different search or remove filters."
- Tag Canvas > no tags: "Tags will appear here as the AI classifies your files."

---

## Error states

Standard pattern: inline red banner at top of affected area, with description + suggested action button.

Required:
- File not found in time machine restore: red toast with "Quick search" + "Deeper scan" actions
- Scan interrupted: persistent banner on Home until acknowledged, "Resume scan" CTA
- AI offline (Ollama down): persistent banner in toolbar, "Restart Ollama" / "Use cloud only" actions
- Disk space low: persistent banner, "Clean up snapshots" CTA
- Database integrity issue: full-screen takeover on launch, "Repair" / "Restore from backup" actions
- Cloud API key invalid: red banner in AI Configuration pane

---

## Build order for the design pass (Claude Design sessions)

Don't do all of this in one session. Each numbered item is one or two Claude Design sessions:

1. Global chrome: titlebar, sidebar, tab bar, toolbar, status bar (these are reused everywhere, so design first)
2. Home screen with all three sub-tabs (including disabled Shared)
3. Browser screen with Inspector open and closed states, both List and Grid views
4. File Tree canvas: live mode + snapshot mode + comparison mode + empty state
5. Scan Configuration + Progress + Results (three sub-screens, can be one session)
6. Review Bin + passive notification card
7. Settings (all panes, can be one session if patterns are reused)
8. Command Palette (search + chat modes)
9. Tag Canvas
10. Right-click context menus (three variants, one session)
11. Confirmation modals + snackbars + toasts
12. First-run onboarding
13. Tray popup
14. Empty states pass (across all screens)
15. Error states pass (across all screens)

After all 15 are designed, the final session is consolidation: bring every screen and overlay into a single HTML file, ensure consistent class naming and design tokens, then hand off to Claude Code with the feature list and a prompt to attach `data-action` attributes and wire stub functions.

---

## Final scope summary

**8 screens** | **5 overlays** | **3 peripheral surfaces** | **10 settings panes** | **3 context menu variants**

Total Claude Design sessions estimated: 15-20

Total design surface: enough to be a complete file manager with AI augmentation, not so much that scope creep buries the project.
