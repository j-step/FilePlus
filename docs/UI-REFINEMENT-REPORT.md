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

*(Appended after all spec sections complete)*
