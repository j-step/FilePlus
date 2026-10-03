# Stage 2D addendum — title bar, search, blur, This PC, motion: design

**Date:** 2026-10-03
**Source:** the author's notes after the Stage 2D feel check (chat, 2026-10-03).
**Branch:** `stage/2d-playtest-2` (same worktree). When the run is done it is merged to master and pushed to GitHub without asking again; the author pre-approved this.
**Builds on:** `2026-10-01-stage-2d-playtest-2-design.md`. Every rule there still holds unless this file says otherwise.

Decisions the author made on 2026-10-03:

| # | Decision |
|---|---|
| A-1 | After the run: merge to master and push master to GitHub (origin). |
| A-2 | Animations follow **only** the new FilePlus Settings switch (on by default). Windows' "Animation effects" / `prefers-reduced-motion` no longer turn them off. |

Rulings the controller made without asking are marked **Ruling**.

## 1. One header bar

The author's words: put close/maximize/minimize, the FilePlus logo and "JJ's PC" on the same header bar as the tabs. Remove the small logo and title in the top-left and replace them with the bigger logo and "JJ's PC" card on that bar. The card is above the side panel, never collapses, and is always visible. "Ask File+" stays collapsible on the side panel.

- The window has a **single top bar**, about 44 screen px tall. From left to right it holds:
  1. **Identity card:** the big logo plus the device name ("JJ's PC"), which can be renamed by double-click as today.
  2. **Tab strip:** tabs, then the plain "+" new-tab button.
  3. A flexible empty **drag region**, so the window can be moved.
  4. **Window controls:** Windows 11 caption buttons for minimise, maximise/restore and close. They are full bar height, about 46 px wide each, and close turns red on hover.
- The old small title-bar logo and title are removed. So is the separate tab row; nothing in the old title bar remains.
- **Identity card width (Ruling):**
  - With the sidebar expanded, the card region is exactly the sidebar's width, so the tabs begin where the content pane begins and track the sidebar when it is resized.
  - With the sidebar collapsed, the card keeps its natural full width (logo + name) and never collapses to the rail. The tabs then start after it.
  - If the device name is long, it ellipsizes at a cap (about 220 screen px) and shows the full name in a tooltip.
- **Sidebar collapse toggle:** it lived in the old sidebar card. It moves to the top row of the sidebar, beside "Ask File+" when expanded and above the rail icons when collapsed. "Ask File+" collapses with the sidebar as before.
- **Screen-px contract (Stage 2D §5):** the card and the bar keep their screen size under app zoom, the same way the panels do. The bar's text and icons scale with zoom like the other chrome; the bar height is fixed in screen px.
- **Mica:** the bar is transparent over Mica, like the old title bar. Interactive controls are marked `no-drag`, empty bar space is a drag region, and double-clicking empty bar space maximises/restores (native caption behaviour).
- **Tab overflow** (fade plus scrolling), tab drag and tab focus rings keep working in the new bar.
- **Maximised and Windows 11 snap layouts:** hovering the maximise button should show snap layouts if Electron can do this with a custom title bar. Use `titleBarOverlay` or the native window-controls overlay if that is the cleanest way to get real caption buttons with snap support, otherwise keep custom buttons. The implementer decides and documents the choice. Keyboard and accessibility labels stay as they are today.

## 2. Search shrinks further and pushes instead of covering

- The search bar keeps shrinking until there is no room left at all: it fills the space between the end of the path and the buttons. Only then does it fold to the magnifier. **Ruling:** its new minimum is about 120 px (magnifier, padding and a few characters of placeholder), down from 180. The full → collapsed hysteresis stays.
- **Collapsed state:** the magnifier button keeps the search field's lighter grey fill, so it reads as the search control and breaks up the row of plain icon buttons. It does not become a plain ghost icon button.
- **Expanding while collapsed** (click, Ctrl+F) no longer overlays the breadcrumb. The bar expands in-flow: its width grows over about 140 ms ease-out, and the breadcrumb is pushed left (the existing leading fade caves the path in further). Collapsing back on blur, when empty, runs the same animation in reverse. Both are instant when animations are off.
- Every Stage 2D toolbar rule still holds:
  - the current crumb is never faded unreadable (ellipsis plus tooltip);
  - the in-bar clear ×;
  - chips;
  - the dropdown fits the window;
  - the chrome focus model.

## 3. Modal backdrop blur is consistent

- When a stand-out panel opens (Properties, modals, conflict dialog, More filters, palette, the Ask File+ popout if it uses a scrim), one full-window scrim sits above every other layer. That includes the header bar, sidebar, toolbar, overlay scrollbars and status bar. It blurs and dims everything beneath it **uniformly**.
- Nothing may stay sharp: sidebar text, overlay scrollbar thumbs, notices and drag ghosts are all beneath it.
- Fix the cause, which is stacking contexts and z-index layers. Do not add blur to individual panels.
- Define one z-index scale in `:root` tokens (`--z-…`), from base and sticky up through popover, scrim, modal and notice, and move every literal z-index onto it.
- The blur must also look right over Mica-transparent regions. If `backdrop-filter` cannot blur what is behind Mica, the scrim uses a solid dim with no blur for those regions, so the result looks uniform.

## 4. This PC content drops halfway down

The bug: switching from a folder shown in an icon view to This PC sometimes shows the drive cards starting halfway down the window.

- Reproduce it first with a failing test: icons@96 in a long folder, scrolled, then This PC.
- Find the root cause. Likely candidates are a stale `scrollTop`, a grid row template or `--list-rows`/`min-height` left over from the icon view, or the `#list-scroll` being hidden while `#thispc-view` inherits its layout.
- Fix it, and check the reverse (This PC → icon view) and every view → This PC.

## 5. Motion: a deep pass of quick, subtle animations

The author's words: "a ton of subtle, quick animations everywhere… no animation should slow down a user's speedy workflow… clicks, drags, and other actions all feel very smooth on the eye. An option in settings should be added to turn this off."

### 5.1 Rules (binding for every animation)

1. **Never delay the work.**
   - State, DOM truth, focus and input handling change immediately; animation is decoration on top.
   - Nothing waits for an animation to finish before accepting the next click or key.
   - Every animation can be interrupted: a new action cancels or retargets it, and nothing queues.
2. **Fast.** Durations come from tokens:
   - `--motion-instant` 60 ms: hover and press feedback.
   - `--motion-fast` 100 ms: menus, tooltips, selection.
   - `--motion-base` 140 ms: panels, tabs, dialogs.
   - `--motion-slow` 200 ms: the ceiling, used rarely, for example sidebar width.

   Easing tokens: `--ease-out` (cubic-bezier(.2,.8,.2,1)), `--ease-in` and `--ease-standard`. No new literal durations or easings.
3. **Cheap.** Prefer `opacity` and `transform`. Animate width or height only where the layout itself must move (search push, sidebar, inspector, tab insert/remove), and never on big lists. No per-row animations for more than about 30 rows at once; above that, the list fades as a whole.
4. **Continuous input is never animated per step:** key repeat (held arrows/Delete), wheel-driven view steps, drag-follow, and marquee selection.
5. **One switch.**
   - The new setting is Settings › Personalization › "Animations" (`ui.animations`, default on). Off sets `html[data-motion="off"]`, which zeroes every transition and animation in CSS and makes every JS-driven animation instant: zoom ease, refresh spin/dip, search push, tab insert/remove, and any WAAPI or `requestAnimationFrame` tweens.
   - A-2: `prefers-reduced-motion` no longer gates anything. Convert every existing `@media (prefers-reduced-motion: reduce)` rule to the `data-motion="off"` gate.
   - The switch applies at once, with no restart.
6. **Flat style still holds:** no new shadows, glows or bounces. Motion is subtle: small distances (≤ 8 px), small scale changes (≥ 0.96), fades.

### 5.2 Inventory (minimum; the implementer adds more in the same spirit)

| Area | Animation |
|---|---|
| Tabs | A new tab grows in (width from 0 plus fade). A closed tab shrinks out while its neighbours close the gap. The active-tab underline/fill slides to the new tab on switch. Tab drag-reorder slides the other tabs. The "+" gets press feedback. |
| Screens | Home ↔ Browser ↔ Settings crossfade, about 100 ms, with no blank frame. |
| Folder navigation | After the single render, the new listing fades in from 0.6 to 1 and slides ≤ 6 px: from the right when going into a folder or Forward, from the left on Back or Up. A tab switch from a cached listing gets the fade only. The Stage 2D no-flash guarantees still hold: icons painted in the first frame stay painted. |
| Breadcrumb | Changed crumbs fade or slide in; the overflow fade animates its appearance. |
| Inspector | Toggling it open or closed animates its width, and the file pane resizes smoothly. Content crossfades when the selection changes (discrete changes only, not during an arrow-key burst). Tab switches (Preview/Tags/History) get a quick fade. |
| Sidebar | Collapse and expand animate width. Labels fade out before the narrowing and in after the widening. The This PC section chevron rotates and the section height animates. Hover and active fills fade. |
| Menus and popovers | Context menus, flyouts, the View/Sort menus, the search dropdown and tooltips: fade plus scale from 0.97, from the anchor side, 100 ms. Exit is faster (60 ms) or instant. |
| Dialogs | Properties, modals and conflict dialogs: scrim fades in, dialog fades and scales from 0.97, 140 ms. Close is a quick fade out. |
| Notices | Snackbars and toasts slide up and fade in. Stacked notices slide to their new positions, and dismissed ones fade and slide out. |
| Rows and selection | Hover and selection fills fade (60–100 ms). |
| New items | A new folder, pasted items and restored items fade and grow in. |
| Removed items | Deleted or moved-away rows fade and collapse out. The DOM truth and selection update at once; exiting rows are visual ghosts that never take input. |
| Rename | The rename box fades in. |
| Cut/copy | The cut fade animates, and the copy badge pops in (scale 0.9 → 1). |
| Drag and drop | The drag ghost fades in. Drop-target highlights fade. Spring-loaded folder open gets a subtle pulse. |
| Views and sort | A change of view kind crossfades. Sort reorders with a FLIP slide when ≤ 30 rows are visible, and a crossfade otherwise. Size steps inside Icons stay as they are. |
| Search | The results header slides in. The results list fades in. Chips pop in and out. |
| This PC | Cards fade in with a 20 ms stagger, capped. Usage bars fill from 0 on first show, 200 ms, not on refresh. |
| Home | Recent and Favorites rows fade in. The sub-tab underline slides. Favouriting pops the star. |
| Settings | Pane switch crossfade. Toggles slide their knob. Segmented controls slide their highlight. |
| Buttons and toggles everywhere | Press feedback (scale 0.97 on `:active`, 60 ms) and hover fill fades. |
| Window | The maximise/restore glyph crossfades. |
| Zoom | The existing ease and pill stay; they follow the switch. |
| Refresh | The existing spin and dip stay; they follow the switch. |
| Ask File+ | The popout scales and fades in from its button. |

### 5.3 Tests

- **Harness default:** `launchApp()` turns animations off (`ui.animations=false` through the same path the Settings switch uses, or a launch flag), so existing specs stay deterministic. `launchApp({motion:true})` turns them on.
- A new `stage2d-motion.spec.js` with animations on checks that:
  - every animation and transition that runs is ≤ 200 ms (`document.getAnimations()`, computed transition durations), and nothing uses a literal outside the tokens (a static CSS check in `check_*` style is fine);
  - **input is never delayed:** right after "+" the new tab is active and focusable; right after closing a tab the next one is clickable; right after opening a menu its items are clickable; right after navigating, rows can be selected, all in the same task with no waiting;
  - with the switch off, `getAnimations()` stays empty across a scripted tour (new tab, close tab, navigate, inspector toggle, sidebar toggle, menu, dialog, delete) and every JS-driven ease is instant;
  - key repeat and Ctrl+wheel steps start no per-step animations.
- Screenshots of mid-animation states are not required.

## 6. Done means

- §1–§5 built, each with tests.
- Full verify green.
- Final whole-branch review and QA clean (or findings fixed).
- Docs updated: CLAUDE.md, UI-SPEC, and an addendum section in the run doc.
- Merged to master (including the two docs commits on `setup/dev-harness`).
- Main checkout on master and clean.
- Pushed to origin.
