# FilePlus UI Refinement Report

Generated during the structured UI pass against `docs/design-brief.md`.
Updated incrementally after each spec section.

---

## CONTRADICTIONS

Conflicts between the spec and existing implementation that required a resolution choice.

| # | Spec Ref | Existing code | Resolution | Reason |
|---|---|---|---|---|
| C1 | A.1.2 Tab bar | No tab bar existed; toolbar contained an Approvals pill at the left edge | Tab bar added between titlebar and main area; Approvals pill moved to status bar as spec'd | Spec is unambiguous: tab bar below titlebar, pill in status bar |
| C2 | A.1.3 Sidebar | Old sidebar used `.sidebar` / `.sb-item` / `.sb-section` classes; had Downloads, Documents, Pictures, Desktop, and a "File Tree" quick-add section that don't appear in spec | Restructured to exactly match spec sections: Quick Access (Home, Review Bin, pinned), Tree (drives), Tags, System (File Tree, Scan), Bottom anchor (Everything Folder, Settings). Old non-spec items removed | Spec is the source of truth |
| C3 | A.1.3 Sidebar | Old sidebar had no drives-with-usage-bars tree section | Added Tree section with sample drives (C:, D:) and usage bar per spec | Spec requires it; stub data used with integration comment |
| C4 | A.1.4 Toolbar | Old toolbar had Approvals pill as leftmost element; spec places it in the status bar | Pill removed from toolbar; new "Review Bin pill" added to status bar right side | Spec § A.1.5 explicitly places it in status bar |
| C5 | A.1.4 Toolbar | Old toolbar had a 3-button view toggle (list/grid/compact) but spec says 2-segment (List/Grid) | Kept list and grid only per spec; removed compact view button | Spec defines exactly two segments |
| C6 | A.2 Home | Existing `screen-recent` had no sub-tabs | Replaced with `screen-home` containing 3 sub-tabs (Recent, Favorites, Shared) | Spec mandates the rename and sub-tab structure |
| C7 | A.3 Browser | Existing `screen-explorer` had inspector with 3 tabs (Info/Tags/History) and a resizer | Kept tabs, renamed to Preview/Tags/History per spec; resizer logic preserved | Spec calls them Preview / Tags / History |
| C8 | A.4 File Tree Canvas | Existing canvas had no mode banners and no snapshots right rail | Three mode banners added (live/snapshot/proposal); snapshots panel added as collapsible right rail | Spec requires all three modes |
| C9 | A.4 File Tree Canvas | Proposed (diff) screen and Time Machine screen existed as separate screens | Both merged into canvas as proposal review mode and snapshot view mode respectively; old screens removed from sidebar/screens | Spec explicitly merges them |
| C10 | A.5-A.7 Scan | Existing scan screen was a single screen with a path input and progress bar | Split into 3 sub-screens: Configuration (scan-config), Progress (scan-progress), Results (scan-results) | Spec defines 3 distinct scan screens |
| C11 | A.8 Review Bin | Existing Approvals screen was bare with just an empty state placeholder | Full 2-pane layout built: list pane (grouped by destination) + detail pane | Spec requires substantial structure |
| C12 | A.12 Settings | No Settings screen existed in HTML; only a settings icon button | Full 2-column 11-pane Settings screen added | Spec defines all 11 panes |
| C13 | A.1.3 Sidebar Quick Access | Spec says Review Bin has a count badge with `accent-wash` background; spec says Everything Folder badge uses `bad-wash` | Implemented both as described | Direct spec language followed |

---

## ISSUES

Bugs or out-of-scope problems encountered.

| # | File | Component | Issue | Scope | Suggested Fix |
|---|---|---|---|---|---|
| I1 | frontend/src/app.js | `switchScreen()` | References `sb-item[data-screen]` for sidebar highlight — new sidebar uses `fp-sidebar__item[data-screen]` | In scope (fixed during A.1 pass) | Update selector in app.js |
| I2 | frontend/src/app.js | `initResizer()` | Resizer targets `#list-pane` and `#inspector` — these IDs preserved in A.3 | In scope (IDs preserved) | No action needed |
| I3 | frontend/src/app.js | Backend health check | Polls `/health` every few seconds; will log errors during offline dev. Not a bug. | Out of scope (backend) | Accept as dev-time noise |
| I4 | frontend/index.html | Tab bar | Tab content switching (Ctrl+T, Ctrl+W, Ctrl+Shift+T) is specified but requires non-trivial JS tab management beyond what existing app.js provides | In scope — stubs added | Full tab history management left for separate pass |
| I5 | frontend/tray/index.html | Action buttons | v1 had small `fp-icon-btn--sm` (24×24) action buttons instead of the spec's 36px tall buttons with vertical icon+label stack | In scope (fixed during A.14 pass) | Replaced with `.fp-tray__action-btn` spec pattern |
| I6 | frontend/setup/index.html | Step count | Original had 3 steps; spec requires 7 | In scope (fixed during A.13 pass) | Extended to 7 steps |
| I7 | frontend/src/styles.css | Token audit | Raw `#fff` used for text on colored backgrounds (close button, stage done icon, conflict badge, tray badge). No `--text-on-color` token exists in design system. | Allowed exception (contrast requirement) | Accept as-is; add `--text-on-color: #fff` token if needed |
| I8 | frontend/src/styles.css | Token audit | `.aq-btn` uses hardcoded gradient `#C9B8F0 → #8B93F5` and `#1a1040` text. Pre-existing from earlier codebase. | Out of scope (legacy component) | Replace with `--accent-wash → --accent` gradient using CSS var |
| I9 | frontend/src/styles.css | Token audit | `border-radius: 3px` on brand mark elements. Allowed intentional exception (brand logo aesthetic). Token set starts at 4px. | Allowed exception (brand) | Accept as-is |

---

## QUESTIONS

Ambiguities that could not be resolved without confirmation.

| # | Spec Ref | Ambiguity | Best Guess | What Would Confirm |
|---|---|---|---|---|
| Q1 | A.1.2 Tab bar | Spec says tabs have "folder name" — but for non-folder screens like Home, Review Bin, Scan, should tab show the screen name instead of a folder name? | Yes — show screen name (e.g., "Home") for non-folder tabs | User confirmation |
| Q2 | A.1.3 Sidebar | "User-pinned folders (drag to reorder)" under Quick Access — spec doesn't define max count or visual treatment for overflow | Show up to 5 pinned, then a "Show more" link | User confirmation |
| Q3 | A.1.3 Sidebar | Tags section says "Top tags as tag chips with counts" — how many "top" tags to show? | Show 5–8 tags | User confirmation |
| Q4 | A.3 Browser | Spec says inspector "Opens on first file click (jump-cut, no slide animation)" and "Push-style: file list shrinks to accommodate" — does this mean inspector is hidden until a file is clicked, even on the Browser screen? | Yes — inspector starts closed; first file click opens it | User confirmation |
| Q5 | A.4 File Tree Canvas | "Default expansion: 3 levels visible" — is this per-drive or globally across the whole canvas? | Per-drive, 3 folder depth levels per branch | User confirmation |
| Q6 | A.5 Scan | Conversational scan config uses Claude API — the chat messages shown are stubs with hardcoded content. Should the AI opening prompt be hardcoded exactly as specified ("What areas of your life are important to you?")? | Yes, hardcode the opening prompt as stub | User confirmation |
| Q7 | A.7 Scan Results | "Reorganization tab: Single CTA — Open File Tree to review proposed reorganization." — does clicking this CTA switch the sidebar nav to File Tree screen and enter proposal review mode simultaneously? | Yes — switch to canvas + enter proposal mode | User confirmation |
| Q8 | A.8 Review Bin | Spec says Review Bin is "a filter on the Everything Folder, not a separate location." Does this mean it should share the same screen element as Everything Folder (filtered), or remain a visually distinct screen that just happens to filter the EF data? | Distinct screen with its own layout (as spec A.8.1 describes), logically backed by EF data | User confirmation |
| Q9 | A.9 Everything Folder | "Bottom 'Currently moving' section — collapsible card (default expanded if 1–3 active, collapsed if 4+)" — the JS for determining active count requires backend data. How should the default stub state look? | Show card expanded with stub "Moving 2 of 2 files" as default visible state | User confirmation |
| Q10 | A.12 Settings | "Accent palette: lavender / indigo / violet / sky / mix" — the design brief says single amber accent is the identity and should not change. This Personalization setting seems to contradict that. | Show the segmented control per spec but stub it (no functionality, comment noting design brief conflict) | User confirmation on whether accent palette swap is intended |
| Q11 | A.14 Tray | "Auto-dismiss popout on click outside or 8-sec idle" — is this implemented via Electron window blur event? | Yes, via `window.electronAPI.hideTray()` on blur | User confirmation |

---

## TESTING CHECKLIST

Run through this in a single sitting after launching `npm start` in `frontend/`. Open DevTools console to check for JS errors as you go.

---

### 1. Global Chrome (A.1)

**Visual checks**
- [ ] Titlebar: FilePlus brand mark (purple rect + cross) + "FilePlus" wordmark visible; window controls (—, □, ✕) right-aligned
- [ ] Tab bar below titlebar: one "Home" tab present, active, with folder icon and close × button
- [ ] Sidebar: Quick Access (Home, Review Bin + count badge, pinned folder), Tree (C: with usage bar), Tags section (chip row), System (File Tree, Scan), Bottom anchor (Everything Folder, Settings)
- [ ] Toolbar: back/forward/up, address bar, search, view toggle (List/Grid), inspector toggle
- [ ] Inspector (right): closed by default on Browser screen; header + tabs + Preview pane visible when opened
- [ ] Status bar: item count · selection text | center task area | Review Bin pill on right

**Interaction checks**
- [ ] Ctrl+B toggles sidebar open/closed
- [ ] Ctrl+I toggles inspector open/closed
- [ ] Toggle sidebar: file list area expands to fill
- [ ] Click "Review Bin" sidebar item → navigates to Review Bin screen
- [ ] Click "Everything Folder" sidebar item → navigates to Everything Folder screen
- [ ] Click "Settings" sidebar item → navigates to Settings screen
- [ ] Clicking sidebar drives/folders changes address bar path text (stub)
- [ ] Window controls: minimize, maximize, close all fire IPC stubs (check console log)

**data-action coverage**
- [ ] `toggle-sidebar` → `IPC client-side`
- [ ] `toggle-inspector` → `IPC client-side`
- [ ] `navigate-screen` → `client-side`
- [ ] `window-minimize/maximize/close` → `IPC`
- [ ] `open-tag-canvas` → `GET /api/tags/graph`
- [ ] `open-review-bin` → `client-side`

---

### 2. Home Screen (A.2)

**Visual checks**
- [ ] Three sub-tabs: Recent / Favorites / Shared — underline indicator on active
- [ ] Recent tab: section header ("Today"), recent file rows with name + path + time + hover action buttons (Open, Reveal, Edit)
- [ ] Favorites tab: favorited folder rows (name + path + 3 action buttons on hover)
- [ ] Shared tab: empty state ("Coming in a future version")

**Interaction checks**
- [ ] Clicking Recent / Favorites / Shared sub-tab switches content pane (underline indicator moves)
- [ ] Hover on recent file row reveals action buttons
- [ ] Clicking recent file row shows toast "not yet implemented"

**data-action coverage**
- [ ] `switch-home-tab` → client-side tab switch
- [ ] `open-recent-file` → `GET /api/recent/:id` (stub)
- [ ] `open-file`, `reveal-file`, `unfavorite-file` → stubs

---

### 3. Browser Screen (A.3)

**Visual checks**
- [ ] Address bar shows path, breadcrumb trail clickable
- [ ] File list: rows with icon (16×16), name, ext, size, modified columns; column headers sortable
- [ ] Inspector pane (when open): 16/10 preview thumbnail, filename, path, 3 tabs (Preview/Tags/History)
- [ ] Inspector tabs: Preview, Tags (tag chips + add button), History (operations list)
- [ ] 4 file row states present: normal, hover (bg-raised), selected (accent-wash + 2px left bar), error/missing (bad-wash)
- [ ] Empty folder state (commented — confirm markup matches fp-empty-state pattern)
- [ ] Error banner for missing folder (commented — verify markup)

**Interaction checks**
- [ ] Clicking a file row selects it (accent-wash bg, left bar), updates inspector filename/path
- [ ] Ctrl+click or Shift+click stub (console log)
- [ ] Double-click stub (console log)
- [ ] View toggle (List/Grid) switches view mode class (check console)
- [ ] Sort by column header: shows toast stub
- [ ] Right-click file row → context menu appears at cursor with 5 sections (Open, Open with, Copy, Rename, Delete, Add tag…)
- [ ] Context menu: hover items highlight with accent-wash, destructive item "Delete" shows bad text
- [ ] Click outside context menu → menu dismisses

**data-action coverage**
- [ ] `select-file`, `open-file`, `reveal-file` → stubs
- [ ] `sort-by` → client-side stub
- [ ] `navigate-crumb`, `navigate-path` → stubs
- [ ] `set-view-mode` → client-side
- [ ] `cm-open`, `cm-copy`, `cm-rename`, `cm-delete`, `cm-add-tag` → stubs
- [ ] `filter-by-tag` → `GET /api/files?tag=` stub

---

### 4. File Tree Canvas (A.4)

**Visual checks**
- [ ] Left rail: folder list with expand/collapse, new folder button, snapshot list
- [ ] Canvas area: SVG placeholder nodes, toolbar (zoom in/out, fit, fullscreen)
- [ ] Toolbar: new snapshot, return to live, toggle changes, snapshot selector
- [ ] Live mode banner: "Showing live filesystem" (green dot, good-wash)
- [ ] Snapshot mode banner: "Viewing snapshot X" with date + Return to live button (yellow, warn-wash) — visible when switching to snapshot view
- [ ] Proposal review mode banner: Execute proposal primary button + Reject all ghost — visible in proposal mode

**Interaction checks**
- [ ] ftree-toggle-left-rail: toast stub fired
- [ ] ftree-zoom-in / zoom-out / fit-view / fullscreen: toast stubs
- [ ] ftree-new-snapshot: toast stub
- [ ] Ctrl+K opens command palette

**data-action coverage**
- [ ] `ftree-new-snapshot` → `POST /api/snapshots/create`
- [ ] `ftree-execute-proposal` → `POST /api/proposals/execute`
- [ ] `ftree-zoom-in/out/fit-view` → client stubs

---

### 5. Scan Config Screen (A.5)

**Visual checks**
- [ ] Conversational mode (default): centered chat container, AI message (bg-raised + shadow-card + border-subtle), bottom textarea (concave)
- [ ] Tag extension chips row: some active (accent-wash), some inactive
- [ ] "Skip the rest, use defaults" secondary button top-right area
- [ ] "Switch to structured form" ghost button
- [ ] Structured form mode (hidden by default): fp-card groups for drives/aggressiveness/complexity/exclusions

**Interaction checks**
- [ ] Click "Switch to structured form" → hides chat, shows form; button text changes to "Switch to chat"
- [ ] Click chat extension chips → toast stub
- [ ] "I'm done answering" button → toast stub
- [ ] "Skip the rest" button → toast stub

**data-action coverage**
- [ ] `scan-config-switch-mode` → client-side
- [ ] `scan-baseline-confirm` → `POST /api/snapshots/create`
- [ ] `scan-form-toggle-drive`, `scan-form-set-aggressiveness` → `POST /api/scan/config`

---

### 6. Scan Progress Screen (A.6)

**Visual checks**
- [ ] 5-stage checklist rows (36px each): Index/Deduplicate/Classify/Propose/Review
- [ ] Stage states: done (green circle + checkmark), active (accent-wash circle + progress bar below), pending (bg-pressed circle + number)
- [ ] "Now working on" path card: bg-raised + border-subtle + highlight-top, mono path text
- [ ] Stats grid: 4 cards (Rate, Classified, Remaining, ETA) with display-sized mono values
- [ ] Throughput sparkline: bg-raised card + SVG placeholder
- [ ] Reassurance banner: good-wash bg + good-edge border + lock icon in good color
- [ ] Footer: Pause (secondary), Minimize to tray (secondary), Stop scan (danger)

**Interaction checks**
- [ ] Pause → toast stub
- [ ] Minimize to tray → IPC stub
- [ ] Stop scan → opens confirmation modal (check `#modal-scrim` becomes visible)
- [ ] Confirm in modal → `scan-stop-confirm` toast stub; modal closes

**data-action coverage**
- [ ] `scan-pause` → `POST /api/scan/pause`
- [ ] `scan-minimize-tray` → IPC
- [ ] `scan-stop-confirm` → `POST /api/scan/stop`

---

### 7. Scan Results Screen (A.7)

**Visual checks**
- [ ] Three underline tabs: Duplicates (active) / Cleanup / Reorganization
- [ ] Duplicates tab: one expanded group (files with "keep" radio + full path), one collapsed group; "Reclaimable: X GB" footer; "Execute deduplication" primary button
- [ ] Cleanup tab: 4 category fp-cards (Temp, Empty folders, Old downloads, Large unused) with expand/collapse
- [ ] Reorganization tab: single "Open File Tree" primary button centered

**Interaction checks**
- [ ] Clicking Cleanup / Reorganization tabs switches pane content
- [ ] "Execute deduplication" → opens confirmation modal → confirm fires toast stub
- [ ] "Execute cleanup" → opens confirmation modal → confirm fires toast stub
- [ ] "Select all AI suggestions" toggle → toast stub

**data-action coverage**
- [ ] `switch-scan-results-tab` → client-side
- [ ] `scan-dedup-confirm` → `POST /api/dedup/execute`
- [ ] `scan-cleanup-confirm` → `POST /api/cleanup/execute`
- [ ] `scan-open-reorg-canvas` → navigate to file-tree-canvas

---

### 8. Review Bin Screen (A.8)

**Visual checks**
- [ ] Two-pane layout: list left + 340px detail pane right
- [ ] List: header "Review Bin · 14 files need a decision", destination groups with 32px headers (folder icon + dest path + count + confidence avg)
- [ ] Group actions right-aligned: "Review each" ghost, "Approve all" secondary, "Reject all" danger ghost (bad text + bad-wash hover)
- [ ] File rows (26px): filename + from→to route chips + action chip + 4px confidence bar
- [ ] "Uncertain" group: warn-wash bg + warn-edge border + alert-triangle icon
- [ ] Empty state (commented) uses 48×48 check-circle in good + "Nothing to review."
- [ ] Detail pane: proposed move label, route (strikethrough from + arrow to destination), "Why" section, confidence, similar decisions list
- [ ] Detail footer: Reject / Modify path / Snooze 7d / Approve →, keyboard hints below

**Interaction checks**
- [ ] Clicking a file row: should update detail pane (currently stub — check console)
- [ ] "Approve all" → toast stub
- [ ] "Reject all" → toast stub
- [ ] "Approve →" in detail → `rb-approve` toast stub
- [ ] "Reject" in detail → `rb-reject` toast stub
- [ ] Ctrl+Shift+R → navigates to Review Bin

**data-action coverage**
- [ ] `rb-approve` → `POST /api/review-bin/:id/approve`
- [ ] `rb-reject` → `POST /api/review-bin/:id/reject`
- [ ] `rb-group-approve-all` → `POST /api/review-bin/group/:id/approve`
- [ ] `rb-snooze` → `POST /api/review-bin/:id/snooze?days=7`
- [ ] `rb-modify-path` → `PATCH /api/review-bin/:id`

---

### 9. Everything Folder Screen (A.9)

**Visual checks**
- [ ] Header: "Everything Folder" title + path in mono + Pause AI toggle chip row (All/Unprocessed/Needs Review/Moving/Errors)
- [ ] Column headers: Name, Time landed, Status (sortable)
- [ ] File rows (26px): 5 state examples visible — no dot (settled), grey dot (unprocessed), warn dot (needs review), accent dot (moving), bad dot (error)
- [ ] "Currently moving" collapsible card at bottom: bg-raised + border-subtle + shadow-card + progress bar
- [ ] Empty state (commented) uses 48×48 icon + "Everything Folder is empty."

**Interaction checks**
- [ ] Filter chip "Needs Review" → `ef-filter` toast stub
- [ ] Pause AI toggle → `ef-toggle-pause-ai` toast stub
- [ ] Moving card click → toggles collapsed (card hides/shows via `ef-toggle-moving-card`)
- [ ] Sort by column → `ef-sort` toast stub

**data-action coverage**
- [ ] `ef-filter` → client-side filter
- [ ] `ef-sort` → client-side sort
- [ ] `ef-toggle-pause-ai` → `POST /api/ai/pause`
- [ ] `ef-toggle-moving-card` → client-side

---

### 10. Settings Screen (A.12)

**Visual checks**
- [ ] Two-column layout: 200px nav rail (bg-chrome) + content area (bg-content)
- [ ] Nav: Application section (7 items) + Account (3 items) + System (About)
- [ ] Active item: bg-pressed + 2px accent left bar
- [ ] Content: each pane shows fp-card groups with settings-row items (label + control)
- [ ] Personalization pane: theme segmented (Dark/Light/System) + density + accent + font scale slider
- [ ] All 11 panes listed in nav; 10 hidden with style="display:none"

**Interaction checks**
- [ ] Clicking nav item switches active pane (active class moves, content switches)
- [ ] Theme toggle in Personalization pane: `data-theme` on `<html>` changes (dark ↔ light), persists in localStorage
- [ ] Density toggle: `data-density` on `<html>` changes, persists in localStorage
- [ ] Reload page → theme + density restored from localStorage
- [ ] Toggle inputs in settings: checkbox CSS toggles state

**data-action coverage**
- [ ] `settings-nav` → client-side pane switch
- [ ] `settings-set-theme` → localStorage
- [ ] `settings-set-density` → localStorage
- [ ] `settings-set-accent` → localStorage + CSS var
- [ ] `settings-toggle` → `POST /api/config/:key` (stub)
- [ ] `settings-reset-defaults` → `POST /api/config/reset` (stub)

---

### 11. Command Palette (A.11.1)

**Visual checks**
- [ ] Full-screen scrim (rgba black + blur) behind palette
- [ ] Palette: 640px wide, bg-raised + border-subtle + 10px radius + shadow-modal
- [ ] 44px input at top; 1px hairline below input
- [ ] Split body: 300px list left + preview pane right
- [ ] List sections: Files, Folders, Tags (#), Commands (>) with t-micro uppercase headers
- [ ] Rows 36px, keyboard-selected row: accent-wash + 2px accent left bar
- [ ] Footer: shortcut hints in mono
- [ ] Search/Chat mode toggle in header

**Interaction checks**
- [ ] Ctrl+K opens palette; scrim appears
- [ ] Escape closes palette
- [ ] Clicking scrim outside palette closes palette
- [ ] Clicking "Go to Home" command row → navigates to home screen
- [ ] Search/Chat toggle: switches between search pane and chat pane

**data-action coverage**
- [ ] `palette-set-mode` → client-side toggle
- [ ] `palette-open-file` → `GET /api/files/:id` stub
- [ ] `palette-plan-approve-all` → `POST /api/review-bin/approve-all` stub

---

### 12. Tag Canvas (A.11.2)

**Visual checks**
- [ ] 820×540 centered modal, bg-raised + border-strong + shadow-modal
- [ ] Header: "Tag Canvas" title + close button
- [ ] Left pane 240px: tag tree with category groups and tag items
- [ ] Right pane: SVG placeholder graph with nodes + connecting lines + file grid below
- [ ] Strong scrim (rgba + stronger blur) behind modal

**Interaction checks**
- [ ] Open Tag Canvas via sidebar "View all →" button → scrim + modal appear
- [ ] Escape closes tag canvas
- [ ] Click scrim outside → closes tag canvas
- [ ] Clicking tag in left pane → `tag-canvas-select` stub
- [ ] No-tags empty state (commented): verify HTML is present and matches pattern

**data-action coverage**
- [ ] `open-tag-canvas` → `GET /api/tags/graph`
- [ ] `close-tag-canvas` → client-side
- [ ] `tag-canvas-select` → `GET /api/tags/:id/files`

---

### 13. Confirmation Modal (A.11.3)

**Visual checks**
- [ ] 440px modal, bg-raised + border-strong + shadow-modal
- [ ] Header: 24×24 semantic icon + title (t-display-sm Inter 600)
- [ ] Body: descriptive text
- [ ] Footer: Cancel (secondary) + action button
- [ ] Open animation: modal appears with subtle translateY + fade (check CSS transition fires)

**Interaction checks**
- [ ] Trigger via "Stop scan" in scan progress → modal opens with correct title + icon
- [ ] Cancel → modal closes
- [ ] Confirm → toast stub (for destructive actions)
- [ ] Click scrim → modal closes
- [ ] Escape → modal closes

**data-action coverage**
- [ ] `modal-cancel` → client-side close
- [ ] `modal-confirm` → client-side close + stub
- [ ] `modal-confirm-type` → client-side validation stub

---

### 14. Snackbars & Toasts (A.11.4)

**Visual checks**
- [ ] Snackbar container at bottom-center; toast container at bottom-right
- [ ] Snackbar: bg-raised + accent-edge border + 8px radius + shadow-popover + progress bar at bottom edge
- [ ] Toast: same chrome, border variant by type

**Interaction checks**
- [ ] Trigger a snackbar via app.js `showSnackbar()` call in console → appears, auto-dismisses after 5s
- [ ] Error toast (variant='error'): has dismiss × button, does not auto-dismiss
- [ ] Snackbar with "Undo": Undo button appears, fires callback on click

---

### 15. Context Menus (A.10)

**Visual checks**
- [ ] Menu chrome: bg-raised + 1px border-subtle + 8px radius + shadow-popover
- [ ] Items 28px tall, optional 14×14 leading icon
- [ ] Keyboard hints right-aligned in mono
- [ ] Hover: accent-wash + icon+label color shifts to accent
- [ ] Destructive items: bad text + bad-wash hover

**Interaction checks**
- [ ] Right-click file row → file context menu (5 sections with separators)
- [ ] Right-click empty area in browser → empty area menu
- [ ] Right-click tab → tab menu
- [ ] Right-click sidebar item → sidebar item menu
- [ ] Click outside → menu dismisses
- [ ] Click menu item → toast stub fires

**data-action coverage** (sample)
- [ ] `cm-open` → IPC stub
- [ ] `cm-rename` → `POST /api/fs/rename` stub
- [ ] `cm-delete` → `POST /api/fs/trash` stub
- [ ] `cm-add-tag` → `POST /api/files/:id/tags` stub

---

### 16. Tray Popout (A.14)

Open tray window separately: `frontend/tray/index.html` in browser.

**Visual checks**
- [ ] 380px width, bg-backdrop + border-strong + 12px radius + shadow-modal
- [ ] Header: 22×22 brand mark + "Recent downloads" title + subtitle path (mono) + 5 icon buttons right
- [ ] Header icon buttons (28×28): Review Bin (with badge "3"), Everything Folder, Pause AI, Expand, Close
- [ ] Sub-tab segmented 30px: Recent / Favorites
- [ ] File rows 32px: 16×16 icon + name + size+time mono + **6px state dot** (3 dot states shown)
- [ ] Action buttons row: 4 equal-width buttons (Drag/Open/Reveal/Copy), each 36px tall, bg-raised + border-subtle + shadow-raised, **16×16 icon** + t-small label
- [ ] Currently Moving card (hidden): bg-raised + border-subtle + 8px radius + 4px progress bar
- [ ] Footer: folder + search icon buttons left, "Open FilePlus" primary center, settings button right, hotkey hint "Ctrl+Shift+F to summon" below

**Interaction checks**
- [ ] Recent/Favorites tab switch: active class moves
- [ ] Click file row: selected state (accent-wash bg)
- [ ] Right-click file row: tray context menu appears
- [ ] Click outside context menu: menu dismisses
- [ ] Pause AI button: toggles `tray-icon-btn--active` class

**data-action coverage**
- [ ] `tray-switch-tab` → client-side
- [ ] `tray-open-main`, `tray-open-review-bin`, `tray-open-everything` → IPC
- [ ] `tray-open-file`, `tray-copy-path`, `tray-reveal-in-app` → stubs
- [ ] `tray-toggle-pause-ai` → `POST /api/ai/pause` stub

---

### 17. First-run Setup (A.13)

Open setup window separately: `frontend/setup/index.html` in browser.

**Visual checks**
- [ ] Full-window layout: 240px left rail + content area fill
- [ ] Rail: 48×48 brand mark + "FilePlus" wordmark + v0.1.0-alpha version in mono
- [ ] Rail steps: 7 steps with 24×24 circle indicators; step 1 active (accent-wash + accent-edge), rest pending (bg-pressed)
- [ ] Rail footer: "~5 min remaining · ~2.1 GB · offline after setup" in mono
- [ ] Content area: 80px padding, 64×64 accent hero icon per step, t-display title, t-read body
- [ ] Step 1: "Get started" primary button (36px)
- [ ] Step 2: Two download rows (done + in-progress with progress bar)
- [ ] Step 3: Password input with lock icon, show/hide toggle, model radio group, cost cap segmented, offline toggle
- [ ] Step 4: Form card with ef-path, drives checkboxes, DL mode segmented, confidence slider, scan schedule segmented, tray toggle
- [ ] Step 5: 4 opt-in cards (Tesseract selected by default in accent-wash, others unchecked)
- [ ] Step 6: Chat interface with AI+user message bubbles, chip selection, textarea input
- [ ] Step 7: Two side-by-side action cards (primary/secondary), shortcut reference card

**Interaction checks**
- [ ] "Continue" footer button advances step (rail indicator + dots update)
- [ ] "Back" button goes back (hidden on step 1)
- [ ] On last step (7): Continue button hidden; use action cards
- [ ] Step 5 opt-in cards: click toggles selected state (accent-wash + checkbox)
- [ ] Step 6 extension chips: click toggles fp-chip--active class
- [ ] Step 3 show/hide key: toggles input type password↔text
- [ ] Step 4 confidence slider: live value display updates

---

### 18. Empty States (A.15)

- [ ] Home → Recent sub-tab: fp-empty-state with history clock icon + "Nothing here yet."
- [ ] Home → Favorites sub-tab: fp-empty-state with star icon + "No favorites yet."
- [ ] Browser empty folder: commented fp-empty-state with folder icon (verify present in HTML)
- [ ] Review Bin empty: commented fp-empty (check-circle in good + "Nothing to review.") — verify present in HTML
- [ ] File Tree Canvas no snapshots: fp-empty-state with tree icon + "File Tree Canvas" + description
- [ ] Search no results: commented palette-empty div with search icon + "No results" — verify present in HTML
- [ ] Tag Canvas no tags: commented empty div — verify present in HTML
- [ ] Everything Folder empty: commented fp-empty div — verify present in HTML
- [ ] Tray popout empty: tray-empty div with + icon + "No recent files" + description — verify present
- [ ] Each empty state: 48×48 outlined icon in text-tertiary, t-title-sm title, t-body text-secondary description, max 360px wide

---

### 19. Error States (A.16)

All error banners use fp-error-banner pattern: bad-wash bg + bad-edge 1px bottom + highlight-top + 14×14 alert-circle in bad.

- [ ] Browser folder missing: commented fp-error-banner in browser screen — verify present (line ~576 in index.html)
- [ ] Scan progress interrupted: commented fp-error-banner in scan-progress screen — verify present
- [ ] Scan results load error: commented fp-error-banner in scan-results screen — verify present
- [ ] Review Bin load error: commented fp-error-banner in review-bin screen — verify present
- [ ] Everything Folder watcher stopped: commented fp-error-banner in everything screen — verify present
- [ ] Backend offline + AI offline + cost cap: three commented fp-error-banner divs above statusbar — verify present
- [ ] Uncomment one of the banners and reload → verify correct styling (bad-wash bg, bad text, action button, dismiss ×)
- [ ] `dismiss-error` data-action: verify clicking × calls `el.closest('.fp-error-banner').remove()`

---

### 20. Edge Cases (A.17)

- [ ] CSS class `.fp-row--vanished` — inspect element, manually add class → row should show strikethrough + 60% opacity
- [ ] CSS class `.fp-tab--drop-target` — manually add to a tab → accent-wash bg + dashed accent border
- [ ] CSS class `.fp-input--invalid` — manually add to an input → bad border + bad glow ring
- [ ] CSS class `.fp-field-error` — manually add below an input → bad-colored error text
- [ ] CSS class `.fp-tabbar--overflow` — add many tab elements → overflow-x:auto, fade gradients on edges
- [ ] Conflict modal HTML present (commented) — verify `#conflict-modal-scrim` in DOM
- [ ] Crash recovery modal HTML present (commented) — verify `#crash-recovery-modal-scrim` in DOM

---

### 21. Keyboard Shortcuts

- [ ] Ctrl+K → opens command palette
- [ ] Escape (with palette open) → closes palette
- [ ] Escape (with tag canvas open) → closes tag canvas
- [ ] Escape (with modal open) → closes modal
- [ ] Ctrl+B → toggles sidebar
- [ ] Ctrl+I → toggles inspector
- [ ] Ctrl+Shift+R → navigates to Review Bin screen

---

### 22. Settings Persistence (localStorage)

- [ ] Change theme to "Light" in Personalization pane → page goes light
- [ ] Reload page → page loads in light theme (from localStorage)
- [ ] Change theme back to "Dark" → verify persists
- [ ] Open DevTools → Application → Local Storage → verify `fp-theme`, `fp-density`, `fp-accent` keys present

---

*End of testing checklist. Last updated after A.17 pass.*

---

## Resolutions (2026-04-25)

The open questions Q1–Q11 in this document were adjudicated during the brainstorming session that produced [docs/superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md](superpowers/specs/2026-04-25-fileplus-ui-re-pass-design.md). Each is resolved as follows:

| # | Resolution | Source |
|---|---|---|
| Q1 | Tabs for non-folder screens (Home, Review Bin, etc.) show the screen name. Confirmed implementation behavior. | Spec §2 (auto-resolved by Q1=A canonical pick) |
| Q2 | Pinned folder overflow not addressed in v1; max 5 visible, no "show more" link. Defer to v1.1. | Out of scope for this work |
| Q3 | Top tags shown: 5–8. Confirmed implementation behavior. | Spec §2 (auto-resolved) |
| Q4 | Inspector starts closed; first file-click in session opens it; persists across selections; does not auto-reopen on app restart. | Spec §2, decision E |
| Q5 | Default canvas expansion: 3 levels per drive branch. Confirmed implementation behavior. | Spec §2 (auto-resolved) |
| Q6 | Conversational scan-config opening prompt is hardcoded as specified. Confirmed implementation behavior. | Spec §2 (auto-resolved) |
| Q7 | Reorganization tab CTA navigates to File Tree canvas + enters proposal-review mode simultaneously. Confirmed. | Spec §2 (auto-resolved) |
| Q8 | Review Bin is a logically distinct screen with its own layout, backed by Everything Folder data via filter. Confirmed. | Spec §2 (auto-resolved) |
| Q9 | "Currently moving" card defaults to expanded with stub "Moving 2 of 2 files." Confirmed. | Spec §2 (auto-resolved) |
| Q10 | Accent customization: default amber + custom hex override (not a fixed palette). Personalization pane shows hex input + swatch + reset. | Spec §2, decision A (option A3) |
| Q11 | Tray auto-dismiss via Electron window blur event. Confirmed implementation behavior. | Spec §2 (auto-resolved) |

All v1 contradictions captured in this report are now closed. Future contradiction reports go in a fresh report doc.

---

## Phase 2 System Pass — Audit Results (2026-04-25)

The Phase 2 system pass per `docs/superpowers/plans/2026-04-25-fileplus-ui-re-pass-phase2-system.md` is complete. 24 tasks executed across documentation and component layers of `frontend/src/styles.css`.

### Token coverage
- All 68 canonical tokens from DESIGN.md frontmatter and design-tokens.md §§1–8 are present in `:root`.
- `--accent-custom` user-override hook added; `--accent` cascades through it (default amber `#E8965E`).
- 3 historically-undefined tokens added: `--r-sm`, `--ease-ui`, `--track-heading`.

### Component coverage (24 fp-* class families)
Built or reconciled per UI-SPEC + DESIGN.md:
- Typography: 9 utility classes (`.t-display`, `.t-headline`, `.t-title`, `.t-title-sm`, `.t-body`, `.t-label`, `.t-caption`, `.t-micro`, `.t-data`)
- Buttons: `.fp-button` family (7 modifiers: `--primary`, `--secondary`, `--ghost`, `--icon`, `--large`, `--small`, `--danger`), aliased to legacy `.fp-btn`
- Form controls: `.fp-chip` (4 semantic modifiers), `.fp-input` (concave + focus ring + invalid), `.fp-kbd-pill` (NEW), `.fp-segmented`, `.fp-toggle` (track + thumb + checked + focus + disabled), `.fp-slider`, `.fp-radio`, `.fp-checkbox`
- Layout: `.fp-row` (flat states + density variants), `.fp-sidebar__item` (floating amber pill), `.fp-card` (header/body/title)
- Overlays: `.fp-popover`, `.fp-context-menu`, `.fp-tooltip`, `.fp-dropdown`, `.fp-modal` (with scrim), `.fp-snackbar` (with progress bar), `.fp-toast` (variants)
- Indicators: `.fp-badge` (4 variants), `.fp-state-dot` (5 colors), `.fp-breadcrumb` (middot), `.fp-tabs` (sliding underline), `.fp-tab` (explorer), `.fp-drag-handle` (NEW), `.fp-marquee`

### Reduced motion
Strict `prefers-reduced-motion: reduce` policy applied. All animation collapses to instant via `*` rule with `!important`. Sole exception: `.fp-sparkline` (live data, not decoration) reverts duration.

### Removed
- Legacy `.aq-btn` block (purple-blue gradient, anti-spec) deleted.
- 5 duplicate component definitions reconciled (fp-input, fp-segmented, fp-modal, fp-toast, fp-chip).
- Duplicate animation keyframes consolidated to single declarations.

### Section 41 audit
Manual visual audit deferred to Phase 3 per-screen polish sessions where each screen renders against real markup. Structural audit (token presence, class definitions, state coverage, no hardcoded hex outside :root, reduced-motion respect) confirmed via the per-task reviews logged in commit history (S1–S24).

### Definition of done — confirmed
1. ✅ All 24 tasks committed (see git log)
2. ✅ Single canonical `:root` tokens block matching DESIGN.md and design-tokens.md
3. ✅ `--accent-custom` cascade wired
4. ✅ All 9 typography utility classes defined
5. ✅ All 22+ component classes defined with required visual states
6. ✅ `prefers-reduced-motion: reduce` collapses motion to instant except sparkline
7. ✅ Section 41 structural audit passes (visual audit deferred to Phase 3)
8. ⏳ App launch verification: pending user manual smoke test (Phase 3 entry point)

Phase 3 (per-screen polish) can begin.
