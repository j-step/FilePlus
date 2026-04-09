# Nexus File Explorer — Complete Feature List

---

## 1. Core Application Shell

### 1.1 Window Management
- Main application window with resizable panes (sidebar, content area, detail panel)
- Minimize to system tray (background service continues running)
- System tray icon with right-click context menu (open, pause watcher, recent files, quit)
- Keyboard shortcut to summon/hide the window (global hotkey, user-configurable)
- Remember window size, position, and pane ratios between sessions
- Multi-monitor support (remembers which monitor it was on)

### 1.2 Default Folder Handler Registration
- On first launch, prompt to register as default folder handler
- Intercepts folder-open events that would normally open Windows Explorer
- One-click revert to Windows Explorer as default (settings page)
- Detects if another app has overridden the association and notifies user

### 1.3 Startup Behavior
- Background watcher service starts on Windows boot (registered as startup task)
- Main UI does not auto-launch on boot (only the watcher)
- First-launch onboarding wizard (see Section 10)

---

## 2. File Browsing — The Core Explorer

### 2.1 Navigation
- Address bar with full path display (click segments to jump up the tree)
- Type-to-navigate in the address bar (autocomplete suggestions from indexed files)
- Back / Forward / Up buttons
- Breadcrumb trail (each segment is clickable and draggable)
- Bookmark / pin any folder to the sidebar (drag to reorder)
- Sidebar section: Pinned folders, Recent folders, Drives, Tags, Smart Folders
- Tab system — open multiple folder locations in tabs within the same window
- Tab drag-and-drop to reorder
- Middle-click a folder to open it in a new tab
- Ctrl+T for new tab, Ctrl+W to close

### 2.2 Content View Modes
- **List view**: filename, size, date modified, tags, type, AI confidence score
- **Grid view**: thumbnail-based, adjustable icon size (slider)
- **Column view**: macOS Finder-style cascading columns
- **Detail view**: shows file preview in a right-side panel without opening the file
- Toggle hidden files on/off
- Sort by: name, size, date modified, date created, type, tag, AI confidence
- Sort ascending/descending with one-click toggle
- Group by: type, tag, date, size range, folder
- Persistent view preferences per folder (remembers if you prefer grid view in your images folder)

### 2.3 File Preview Panel
- Right-side collapsible panel (toggle with keyboard shortcut or button)
- Image preview (jpg, png, gif, webp, svg, bmp, tiff, raw formats)
- Video preview with playback controls (mp4, mkv, webm, avi)
- Audio preview with waveform display (mp3, wav, flac, ogg, aac)
- PDF preview (first page rendered, scroll through pages)
- Markdown preview (rendered)
- Code/text preview with syntax highlighting (json, xml, yaml, py, js, etc.)
- Office document preview (docx, xlsx — first page/sheet rendered)
- Generic metadata display for unsupported types (size, dates, hash)
- Full EXIF display for images (camera, lens, GPS, exposure, etc.)
- Tag display and inline tag editing in the preview panel
- "Open with..." button in the preview panel
- "Reveal in Windows Explorer" option for fallback

### 2.4 File Operations
- Cut, copy, paste (standard keyboard shortcuts)
- Drag and drop files between panes, tabs, sidebar folders
- Drag files out of the app onto the desktop or other applications
- Drag files into the app from the desktop or other applications
- Multi-select with Ctrl+click, Shift+click, and rubber-band selection (click-drag box)
- Right-click context menu: open, open with, copy, cut, paste, rename, delete, tag, move to, copy path, show in Explorer, properties, compress, extract
- Batch rename tool (pattern-based: prefix, suffix, sequential numbering, regex, find-replace)
- Rename inline by clicking on a selected filename (slow double-click, like Explorer)
- Duplicate file (creates a copy in the same directory with " - Copy" suffix)
- Create new folder / new file (with template options for common types)
- Compress to zip/7z (right-click or toolbar button)
- Extract archives (zip, 7z, rar, tar, gz) — preview contents before extracting
- Permanently delete vs. send to Recycle Bin (user preference in settings)
- Delete confirmation dialog with "don't ask again for this session" option

### 2.5 Search
- Search bar at top of window (Ctrl+F or click)
- Real-time results as you type (searches indexed database, not live filesystem crawl)
- Search by: filename, tag, extension, content (full-text for indexed text files), date range, size range
- Search filters as interactive pills (click to add: "type:image", "tag:taxes", "size:>100mb")
- Search scope: current folder, current folder + subfolders, entire system, specific drive
- Save a search as a Smart Folder (lives in sidebar, dynamically updates)
- Recent searches dropdown
- Natural language search powered by AI: "that PDF I downloaded last Tuesday about mortgages"

---

## 3. The Initial Scan — System Overhaul

### 3.1 Scan Configuration (Pre-Scan Wizard)
- Select drives/partitions to include or exclude
- Select specific folders to exclude (e.g., "don't touch my C:\Projects folder")
- Aggressiveness slider for cleanup suggestions:
  - Conservative: only obvious junk (temp files, empty folders, browser cache)
  - Moderate: above + old logs, orphaned app data, duplicate files
  - Aggressive: above + unused large files, stale downloads
- Tree structure complexity preference:
  - Simple (fewer top-level categories, broader grouping)
  - Balanced
  - Detailed (deep nesting, granular subcategories)
- Custom file type priorities: user defines types they care about (e.g., .vst, .vst3, .fxp, .als, .flp)
- Custom category definitions: user can pre-define categories like "Music Production", "Tax Documents" before the scan even runs
- Estimated scan time displayed before starting
- "Scan in background" option — lower priority threads so the PC stays usable

### 3.2 Pass 1 — Indexing (No AI, Read-Only)
- Walks all selected drives/folders
- Records: path, filename, extension, size, created date, modified date, xxHash64
- Extracts metadata where available (EXIF, PDF properties, Office doc metadata, audio tags like ID3)
- Progress bar: files indexed / estimated total, current folder, elapsed time, ETA
- Pause / resume / cancel at any time
- Results stored in SQLite immediately (incremental, not batched at end)
- Post-index summary: total files, total size, breakdown by type, largest files, oldest files

### 3.3 Pass 2 — Deduplication Analysis
- Groups files by identical hash
- For each duplicate group: shows all locations, file sizes (should match), last modified dates
- Suggests which copy to keep based on: most recent, shortest path, most "organized" location
- UI: list of duplicate groups, expand each to see copies, checkboxes to mark for deletion
- "Select all suggestions" button (AI's recommendations) with individual override
- Preview any file in the group before deciding
- Estimated space savings displayed prominently
- Hardlink/symlink option: instead of deleting, replace duplicates with links to the original (advanced toggle)
- Exclude specific folders from deduplication (e.g., intentional backups)

### 3.4 Pass 3 — Cleanup Suggestions
- **Temp files**: Windows temp, browser caches, app caches, installer leftovers
- **Empty folders**: detected and listed, one-click purge
- **Old downloads**: files in Downloads folder older than user-defined threshold
- **Large unused files**: files above a size threshold not accessed in X months
- **Orphaned app data**: AppData folders for programs no longer installed
- **Old log files**: .log files older than a threshold
- **Recycle Bin contents**: shows size, offers to empty
- **Thumbnail cache**: Windows thumbnail db files
- Each category is collapsible, with a file list inside
- Per-item and per-category approve/reject
- "Select all safe suggestions" button (most conservative batch)
- Space savings per category and total displayed
- Nothing is deleted until the user explicitly clicks "Execute Cleanup"
- Post-cleanup summary with total space recovered

### 3.5 Pass 4 — AI Classification & Tree Proposal
- Rules engine classifies files by extension and known paths first
- Local LLM (Ollama) handles ambiguous files: weird names, misplaced locations, unknown extensions
- Cloud API (Claude) handles the hardest cases in a batch (if enabled)
- For each file: assigns a proposed category, tags, and destination path in the new tree
- Confidence score per file (high/medium/low)
- Low-confidence files are flagged for manual review

### 3.6 The Tree Editor — Reorganization Proposal UI
- Full-screen modal or dedicated tab showing proposed new folder structure
- Two-pane view: current structure (left) vs. proposed structure (right)
- Proposed tree is fully interactive:
  - Drag and drop folders to rearrange the tree
  - Drag and drop files between folders
  - Rename any folder by clicking its label
  - Right-click a folder: rename, merge with another, delete branch, add subfolder
  - Create new folders anywhere in the proposed tree
  - Collapse / expand branches
  - Color-coded nodes: green (new), yellow (moved), red (flagged for review), gray (unchanged)
- Bulk operations:
  - "Move all .vst files under Music Production > Plugins" — type a rule, it applies globally
  - Filter the tree to show only specific file types
  - Search within the proposed tree
- File count and size displayed per folder node
- "Low confidence" filter — show only files the AI wasn't sure about for quick manual sorting
- "Accept all high-confidence suggestions" button
- "Reset to current structure" button (undo all proposal changes)
- "Preview as flat list" toggle — see all proposed moves as a source → destination table
- Undo/redo within the tree editor (Ctrl+Z / Ctrl+Y)
- Save proposal as draft (come back to it later without losing changes)
- "Execute Reorganization" button (requires confirmation dialog)
- Estimated time to execute displayed
- During execution: progress bar, current file being moved, pause/cancel
- Post-execution: summary of moves, link to the undo log

---

## 4. The Everything Folder — Smart Download Inbox

### 4.1 Folder Setup
- On first launch, user designates the Everything Folder location (default: a new folder like C:\Everything)
- App modifies default download directories for detected browsers (Chrome, Firefox, Edge, Brave, Arc — with user permission per browser)
- Detects other common download sources and offers to redirect them
- If user declines browser redirect, they can manually set their download dir and the app watches whatever path they choose

### 4.2 File Watcher Service
- Monitors the Everything Folder for new files via OS filesystem events
- Detects: new file created, file renamed, file moved in
- Ignores partial downloads (.crdownload, .part, .tmp) until they complete
- Handles rapid bursts (downloading 20 files at once) by queueing, not choking

### 4.3 Classification Pipeline (Per New File)
- Step 1: file lands in Everything Folder
- Step 2: basic metadata extraction (extension, size, embedded metadata)
- Step 3: rules engine attempts classification (known extension → category, known source app → category)
- Step 4: if rules engine is confident → auto-sort to destination (if user has auto-sort enabled) or add to "sorted" queue with proposed destination
- Step 5: if rules engine is uncertain → local LLM classifies with context of user's folder structure
- Step 6: if LLM is uncertain → file goes to "Needs Approval" queue
- Step 7: if cloud API is enabled and LLM was uncertain → batch-send to cloud API for smarter classification
- User configurable: skip straight to "Needs Approval" for all files (fully manual mode), or auto-sort everything above a confidence threshold

### 4.4 Quick Access — Taskbar Widget
- System tray icon shows a badge count of new/unsorted files
- Click the tray icon: popup panel showing recent downloads in chronological order
- Each entry shows: filename, thumbnail/icon, size, time downloaded, proposed destination
- One-click actions per file: open, open containing folder, approve sort, change destination, delete
- Drag a file from this popup directly into another application
- "Open latest" global hotkey — instantly opens the most recent download in its default app
- Panel auto-dismisses after a few seconds if the user drags a file out or opens it (configurable)
- "Clear all" to dismiss processed notifications

### 4.5 Needs Approval Queue
- Accessible from sidebar and from the tray popup
- List of files the AI couldn't confidently classify
- Per file: thumbnail, name, metadata, AI's best guess (with confidence %), alternative suggestions
- Quick-sort buttons: approve AI suggestion, pick from recent folders, pick from category list, "leave here"
- Batch mode: "sort all by AI suggestion" for when you trust it enough
- Teach-the-AI: when you manually assign a file, the app logs this as a training signal for future classification (stored locally, used to adjust rules engine weights)

---

## 5. Tagging System

### 5.1 Tag Types
- **System tags** (auto-generated, non-editable): file type, size class (tiny/small/medium/large/huge), source app (if detectable), duplicate status
- **AI tags** (auto-generated, editable): semantic descriptions, project associations, context tags
- **User tags** (fully manual): user creates and assigns freely

### 5.2 Tag Management
- Tag manager page in settings: see all tags, rename, merge, delete, set colors
- Tags are color-coded (user picks color per tag or per tag group)
- Tag groups for organization: "Projects", "File Types", "Status", "Priority"
- Auto-tag rules: "any file in /Taxes/ gets tagged 'taxes'" (user-defined)
- Tag suggestions when manually tagging (autocomplete from existing tags)
- Bulk tagging: select multiple files, apply/remove tags in batch
- Tag inheritance option: files in a folder inherit the folder's tags

### 5.3 Tag-Based Navigation
- Sidebar section showing all tags as a flat list or grouped
- Click a tag to see all files with that tag (across entire system)
- Combine tags with AND/OR logic in the search bar
- Smart Folders based on tag combinations (e.g., "images AND project:album-2024")

---

## 6. Smart Folders

- User-defined or AI-suggested dynamic views
- Based on: tag combinations, file types, date ranges, size ranges, location rules, search queries
- Always up-to-date (query runs against the database, not a static folder)
- Editable criteria at any time
- Displayed in the sidebar under their own section
- Examples:
  - "All images from this month"
  - "Large videos not accessed in 6 months"
  - "All project files tagged 'active'"
  - "Recently AI-sorted files with low confidence"
  - "All VST3 plugins"

---

## 7. Undo / History / Time Machine

### 7.1 Operation Log
- Every file move, rename, delete, and tag change is logged with timestamp and reason
- Log is searchable and filterable by operation type, date, file
- Stored in SQLite, separate table from the file index

### 7.2 Undo System
- Undo last operation (Ctrl+Z in the main window, but only for file operations the app performed)
- Undo any specific operation from the history log (right-click → undo this)
- Undo an entire batch (e.g., "undo the full reorganization from Tuesday")
- Undo is only possible if the file still exists at the destination (checks before attempting)
- If a file has been externally modified or deleted since the operation, flag it as un-undoable

### 7.3 Time Machine View
- "Where was this file before?" — select any file, see its full movement history within the app
- Timeline visualization: dots on a horizontal line showing each move with timestamps
- "Where was everything on [date]?" — reconstruct the folder state as it was before the app's changes
- This is metadata-only (not file backups), so it only tracks what the app itself moved

---

## 8. Settings

### 8.1 General
- Dark mode / Light mode toggle (system default option too)
- Accent color picker (single accent color used across the UI)
- Language (English only for v1, but architect for i18n)
- Default view mode (list, grid, column, detail)
- Default sort order
- Confirm before deleting (toggle)
- Show hidden files by default (toggle)
- Start on Windows boot (toggle for background service)
- Global hotkey configuration (summon window, open latest download)
- Default file open behavior: single-click or double-click

### 8.2 Everything Folder
- Change watched folder path
- Auto-sort toggle (on/off)
- Auto-sort confidence threshold slider (only auto-sort above this confidence %)
- Notification preferences: notify on every sort, only on "needs approval", never
- Maximum time to keep files in the Everything Folder before forcing a sort prompt
- Excluded file types (never sort these, leave them in the Everything Folder)

### 8.3 AI Configuration
- Local LLM toggle (on/off, model selection if multiple installed)
- Cloud API toggle (on/off)
- Cloud API key input (Claude API key)
- Cloud API usage cap (max tokens per day/month)
- AI classification temperature setting (lower = more conservative)
- View AI usage stats: tokens used, API cost this month, files classified locally vs. cloud

### 8.4 Scan & Cleanup
- Cleanup aggressiveness preset
- Excluded folders list (never scan these)
- Excluded file types list
- Schedule recurring scans (weekly, monthly, manual only)
- Scan scope per scheduled run

### 8.5 Custom File Type Definitions
- User defines important file types the AI should recognize
- Per type: extension(s), category, description, default tags
- Example: `.vst3` → category: "Music Production > Plugins > VST3", tags: ["audio", "plugin"]
- These definitions feed directly into the rules engine (priority over AI guessing)

### 8.6 Data & Privacy
- View database size
- Export database (backup)
- Import database (restore from backup)
- Clear all AI-generated tags
- Reset all file organization (undo everything the app has ever done)
- Delete all data and unregister as default folder handler (full uninstall prep)

---

## 9. AI Features — Natural Language Interface

### 9.1 Command Bar
- Accessible via keyboard shortcut (Ctrl+K or similar)
- Type natural language commands:
  - "find all photos from 2023"
  - "move everything tagged 'old-project' to the archive"
  - "show me the biggest files on my D drive"
  - "what's taking up space in AppData"
  - "organize my Downloads folder"
- Results appear inline, actions require confirmation before execution
- Command history (up arrow to cycle through previous commands)

### 9.2 AI Insights Dashboard
- Accessible from sidebar
- Storage breakdown: visual chart of disk usage by category
- "Files you might want to clean up" — suggestions based on access patterns
- "Duplicate alert" — new duplicates detected since last scan
- "Unorganized files" — count of files not yet categorized
- Weekly/monthly summary: files sorted, space saved, new files tracked

---

## 10. First-Launch Onboarding

- Step 1: Welcome screen — brief explanation of what the app does
- Step 2: Set the Everything Folder location
- Step 3: Choose whether to register as default folder handler
- Step 4: Browser download redirect setup (per-browser toggles)
- Step 5: Scan configuration (drives, aggressiveness, custom types)
- Step 6: AI setup (local LLM check — is Ollama installed? offer to install. Cloud API key optional.)
- Step 7: Start initial scan or skip for now
- Each step is skippable
- "Quick setup" option that picks sensible defaults and skips to end
- Onboarding state saved so user can return to it later from settings

---

## 11. UI/UX Design Notes

### 11.1 General Aesthetic
- Minimalist, clean, flat design with subtle depth (no gradients, light shadows only)
- Dark mode: near-black background (#0d0d0d to #1a1a1a range), with slightly lighter surface panels
- Light mode: white to off-white (#fafafa), with light gray panels
- Single accent color throughout (default: muted blue, user-configurable)
- Accent used sparingly: active tab underline, selected item highlight, primary buttons, badge counts
- Typography: single sans-serif font family (Inter or similar), limited to 3-4 size tiers
- Icons: outlined/stroke style (Lucide or Phosphor icon set), monochrome, accent color on active states only
- No rounded-everything. Subtle rounding on buttons and cards (4-6px), sharp corners on panels and containers
- Thin 1px borders for separation, never thick dividers

### 11.2 Layout
- Three-column layout: Sidebar (fixed, collapsible) | Content area (flexible) | Preview panel (collapsible)
- Sidebar width: ~220px, collapsible to icon-only mode (~48px)
- Preview panel: ~300px, toggle on/off with a button or keyboard shortcut
- Top bar: address/breadcrumb bar, search, view mode toggles, account/settings icon
- Bottom status bar: file count in current view, total size, selection count, background task indicator
- No floating action buttons. All actions are in the top toolbar, right-click context menus, or inline

### 11.3 Interaction Patterns
- Hover states on all interactive elements (subtle background shift, never color change on text)
- Selection: single click selects, double click opens (configurable to single-click-opens)
- Drag and drop: ghost preview of file/folder while dragging, drop targets highlight with accent color border
- Context menus: clean, grouped with subtle separators, keyboard shortcut hints right-aligned
- Modals: centered, dimmed backdrop, always have a clear close button and Escape key dismissal
- Toast notifications: bottom-right, auto-dismiss after 4 seconds, stack vertically, click to dismiss early
- Confirmation dialogs: clear destructive action in red, cancel is always available, never auto-confirm

### 11.4 Animations & Motion
- Minimal. No gratuitous animations.
- Folder expand/collapse: fast height transition (~150ms)
- Tab switching: instant, no slide
- Panel open/close: slide in/out (~200ms)
- File sort/move in list: items shift position smoothly (~100ms)
- Toast appear/disappear: fade + slight upward slide
- Loading states: subtle pulsing skeleton screens, never spinners
- Drag and drop: smooth follow with slight offset from cursor

### 11.5 Accessibility Basics
- Full keyboard navigation (Tab, Shift+Tab, arrow keys in lists/trees, Enter to open, Space to select)
- Focus ring visible on all focused elements (accent color, 2px offset)
- Minimum contrast ratios met for all text
- Screen reader labels on all icon-only buttons
- No information conveyed by color alone (always paired with icon or text)

### 11.6 Responsive Behavior
- Not a web app, but the layout should handle window resize gracefully
- Below certain width: preview panel auto-collapses
- Below smaller width: sidebar collapses to icon mode
- File grid adjusts column count to window width

### 11.7 Things to Explicitly Avoid
- No hamburger menus. Sidebar is always accessible.
- No settings buried in sub-sub-menus. Two levels deep maximum.
- No "pro tips" tooltips that pop up unsolicited
- No onboarding tours that highlight every button after first launch
- No skeleton/placeholder content that looks like real content (confusing)
- No "are you sure?" for non-destructive actions
- No animations that block interaction (everything is interruptible)

---

## 12. Background Processes & Status

### 12.1 Task Manager (Internal)
- Bottom status bar shows currently running background task (indexing, sorting, classifying)
- Click to expand: list of all queued/active/completed tasks
- Each task: name, progress %, ETA, pause/cancel buttons
- Task history: completed tasks with duration and result

### 12.2 System Resource Awareness
- Background tasks throttle when the user is actively using other applications (detect foreground app CPU/GPU usage)
- User can set max CPU/RAM allocation for background tasks in settings
- "Pause all background tasks" quick toggle in tray menu

---

## 13. Data Integrity & Safety

### 13.1 Database Integrity
- SQLite WAL mode for crash resistance
- Automatic daily backup of the database file
- On launch: integrity check, auto-repair if journal is dirty
- Database version migrations handled automatically on app update

### 13.2 Filesystem Sync
- On launch: quick check that indexed files still exist at recorded paths
- If files were moved/deleted externally (outside the app): flag them, update DB, notify user
- Periodic background re-sync (configurable interval or manual trigger)
- Conflict resolution: filesystem always wins, DB adapts

### 13.3 Crash Recovery
- If app crashes mid-operation: on next launch, detect incomplete batch from the operation log
- Offer to undo the partial batch or complete it
- No half-moved states: each file move is atomic (copy-then-delete-original, not cut-paste)

---

## Appendix: Keyboard Shortcuts (Default)

| Action | Shortcut |
|---|---|
| Summon / hide window | Win+Shift+E (configurable) |
| Open latest download | Win+Shift+D (configurable) |
| New tab | Ctrl+T |
| Close tab | Ctrl+W |
| Search | Ctrl+F |
| Command bar | Ctrl+K |
| Toggle preview panel | Ctrl+P |
| Toggle sidebar | Ctrl+B |
| Back | Alt+Left |
| Forward | Alt+Right |
| Up one folder | Alt+Up |
| Select all | Ctrl+A |
| Rename | F2 |
| Delete | Delete |
| Undo last app operation | Ctrl+Z |
| View mode cycle | Ctrl+1/2/3/4 |
| Toggle dark/light mode | Ctrl+Shift+D |
| Open settings | Ctrl+, |
