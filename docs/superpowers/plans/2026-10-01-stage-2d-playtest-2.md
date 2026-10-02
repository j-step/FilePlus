# Stage 2D — Playtest pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship-quality pass on everything already built: Explorer's eight-view ladder, flash-free icons, in-place refresh, This PC page, sidebar polish, app zoom with fixed panels, plus the pass-2 leftovers and a sibling-oversight sweep.

**Architecture:** The work is plain-JS renderer changes in `frontend/src/*.js` and `styles.css`, plus small FastAPI extensions (`backend/api.py`). The view model moves from `details|list|grid + --list-scale` to a ladder of named views with a per-folder memory. The icon pipeline gains synchronous cache painting and generic-first per-path icons. Refresh becomes a diff-patch of the rendered rows. Electron's default menu is removed.

**Tech Stack:** Electron 41, plain JS (globals, no build step), FastAPI + aiosqlite, pytest, `@playwright/test` driving Electron (`frontend/test/harness/app.js`: `launchApp`, `shot`, `rowByName`, `apiGet`, `apiHeaders`).

**Spec:** `docs/superpowers/specs/2026-10-01-stage-2d-playtest-2-design.md` — every task cites its section. Read the spec section before the task.

## Global Constraints

- CLAUDE.md is binding: path_guard on every fs touch; no hardcoded paths; async backend; renderer uses `fetch()` only; no `/api/` prefix.
- Load order of the frontend globals is fixed (CLAUDE.md "Frontend traps"). New renderer modules go in `frontend/index.html` before `app.js` and must only *define* functions at top level.
- Design tokens only. Repeating values become `:root` tokens; accent-derived colours use `color-mix(... var(--accent) ...)`. No new shadows.
- `showSnackbar`/`showToast` only from `app.js`; notifications are gated by `fp-notifications-enabled` except `showToast(msg,'error')`.
- `icons-sprite.js` and `filetypes.js` are generated. Change sprite symbols only through `scripts/build_icons.js`, and change filetypes through `backend/filetypes.py` + `scripts/build_filetypes.py`.
- Every `cm-*` / `data-action` added needs its `switch` case in `app.js` (`check_menu_cases.js` gate).
- Reduced motion (`prefers-reduced-motion: reduce`) disables every new animation. Tests run with it on.
- Zero console errors in every Electron test. Do not probe routes that can 404.
- Each task ends with `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` green, then one commit (`git add` named paths only, never `-A`; check `git diff --cached --name-only` first). Never commit on red.
- New Electron spec files use `launchApp()` from `frontend/test/harness/app.js` (port 9877, fixture copy). Never hardcode 9876.

## Review Focus

1. **Huge folders (LISTING_CAP, ~5k rows) at 256 px icons and in List view.** Wheel stepping must stay responsive (a step must not cost more than one render), and icon requests are only made for visible rows. → Task 5 adds a timing check over the `_gen` large folder.
2. **Thumbnail or shell-icon failure** (corrupt image, access denied, backend shell route absent). The slot must end on the type icon, then the sprite, and never stay empty forever. → Task 4 adds a test with a corrupt `.png` fixture and the shell route forced `absent`.
3. **Refresh while the folder was deleted, or renamed outside the app.** The listing stays visible, an error toast appears, and nothing navigates. → Task 3 test.
4. **Window narrower than 700 px at 150% zoom.** The toolbar, sidebar and This PC cards must not overflow horizontally or clip. → Task 6 / Task 7 sweep.
5. **Tab switch during an in-flight listing or refresh.** A late response must never paint into the wrong tab (race guard). → Task 3 test.

---

### Task 0: Baseline

- [ ] Run `py -3 -m pytest -q` and `powershell -ExecutionPolicy Bypass -File scripts/verify.ps1` in the worktree. Record the pass counts in the ledger (`.superpowers/sdd/2026-10-01-stage-2d/progress.md`, git-ignored). If it is red, stop and fix before any task.

### Task 1: Backend — listing dates and richer drives (spec §6.3, §8)

**Files:**
- Modify: `backend/api.py` (`_scandir_entries` ~643-711, `/drives` ~1147-1167)
- Test: `tests/test_api_fs.py` (append), `tests/test_api_drives_2d.py` (new)

**Interfaces:**
- Produces: each `/fs/list` and `/fs/list/root` entry gains `created: float` (epoch seconds; `st_birthtime`, falling back to `st_ctime`) and `accessed: float` (`st_atime`). Search-result entries built from a live stat gain the same fields.
- Produces: each `/drives` item gains `kind: "fixed"|"removable"|"network"|"cdrom"` and `fs: str`. Removable, network and cdrom drives are included. Drives where `psutil.disk_usage` raises (no media) are skipped.

- [ ] **Step 1: Failing tests**

```python
# tests/test_api_fs.py (append) — reuse the module's existing client/fixture helpers
async def test_list_entries_carry_created_and_accessed(client, sandbox_tree):
    r = await client.get("/fs/list", params={"path": str(sandbox_tree)})
    e = next(x for x in r.json()["entries"] if not x["is_dir"])
    assert isinstance(e["created"], float) and isinstance(e["accessed"], float)
    st = (sandbox_tree / e["name"]).stat()
    assert abs(e["accessed"] - st.st_atime) < 2
```

```python
# tests/test_api_drives_2d.py
from types import SimpleNamespace as NS
def _parts():
    return [NS(device="C:\\", mountpoint="C:\\", fstype="NTFS", opts="rw,fixed"),
            NS(device="E:\\", mountpoint="E:\\", fstype="FAT32", opts="rw,removable"),
            NS(device="F:\\", mountpoint="F:\\", fstype="", opts="cdrom"),
            NS(device="Z:\\", mountpoint="Z:\\", fstype="NTFS", opts="rw,remote")]
async def test_drives_kinds_and_no_media_skipped(client, monkeypatch):
    import psutil
    monkeypatch.setattr(psutil, "disk_partitions", lambda all=False: _parts())
    def usage(p):
        if p.startswith("F"): raise OSError("no media")
        return NS(total=100, used=40, free=60)
    monkeypatch.setattr(psutil, "disk_usage", usage)
    items = (await client.get("/drives")).json()
    kinds = {d["letter"]: d["kind"] for d in items}
    assert kinds == {"C": "fixed", "E": "removable", "Z": "network"}
    assert all("fs" in d for d in items)
```
Match the fixture names (`client`, sandbox fixture) and the letter format (`"C"` vs `"C:"`) to what `tests/conftest.py` and the current `/drives` response use. Read them first and adjust the assertions to the existing shape, never the other way round.

- [ ] **Step 2:** Run `py -3 -m pytest tests/test_api_fs.py tests/test_api_drives_2d.py -q`. Expected: FAIL (KeyError `created` / `kind`).
- [ ] **Step 3: Implement.** In `_scandir_entries`, read `st = entry.stat()` once (already done for size/mtime) and add `created=getattr(st, "st_birthtime", st.st_ctime)` and `accessed=st.st_atime`. In `/drives`, use `psutil.disk_partitions(all=True)`. Derive `kind` from `opts` (`removable` / `cdrom` / `remote` → network, else fixed), skip on `OSError`/`PermissionError` from `disk_usage`, and add `fs=part.fstype`. The work stays off-loop: if the existing route uses `asyncio.to_thread`, keep it.
- [ ] **Step 4:** Run the same pytest. Expected: PASS. Then run the full `py -3 -m pytest -q`.
- [ ] **Step 5:** Run verify.ps1 green, then commit: `feat(api): created/accessed on listings; drives carry kind and filesystem, removable/network included (2D §6.3, §8)`.

### Task 2: Context-menu flyouts, Sort "Date…" flyout, date column (spec §6.3)

**Files:**
- Modify: `frontend/src/app.js` (`showContextMenu` ~1601, `SORT_MENU_ITEMS` ~1470, sort handlers ~3036-3050), `frontend/src/browser.js` (`applySort` ~227, `sortedEntries` ~240, details header + row date cell), `frontend/src/styles.css` (context-menu section), `frontend/index.html` (details header date column)
- Test: `frontend/test/stage2d-menus.spec.js` (new)

**Interfaces:**
- Consumes: Task 1 `created` / `accessed` on entries.
- Produces: menu item shape `{ label, icon?, action?, checked?, disabled?, items?: Item[] }`. An item with `items` renders a chevron and opens a flyout. `showContextMenu(x, y, items, opts)` keeps its signature. `browserState.sort.key` gains the values `'created' | 'accessed'`, alongside `'name' | 'modified' | 'type' | 'size'`. New exported helper `dateFieldForSort()` → `'created'|'modified'|'accessed'` (defaults to `modified` when the sort is not a date), used by the Details date column and by Task 5's Content view.

- [ ] **Step 1: Failing test** (`stage2d-menus.spec.js`):

```js
const { test, expect } = require('@playwright/test');
const { launchApp, shot, apiGet } = require('./harness/app');
test('sort Date… flyout and date column', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await page.click('[data-action="open-sort-menu"]');
    const dateItem = page.locator('.fp-context-menu [data-menu-label="Date…"]');
    await expect(dateItem).toBeVisible();
    await dateItem.hover();
    const fly = page.locator('.fp-context-menu--flyout');
    await expect(fly).toBeVisible();
    await expect(fly.locator('.fp-context-menu__item')).toHaveText(['Date created', 'Date modified', 'Date accessed']);
    await shot(page, 'menus-sort-date-flyout');
    await fly.locator('text=Date created').click();
    await expect(page.locator('#list-head [data-col="date"]')).toHaveText(/Date created/);
    // keyboard: reopen, ArrowDown to Date…, ArrowRight opens flyout, Escape closes all
    await page.click('[data-action="open-sort-menu"]');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
    await expect(fly).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fp-context-menu')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
```
Before writing, read the real selector names in app.js (`open-sort-menu` action, the context-menu class names, `#list-head` column attributes) and use those exactly. The names above are illustrative only where the code differs.

- [ ] **Step 2:** Run `cd frontend && npx playwright test test/stage2d-menus.spec.js`. Expected: FAIL.
- [ ] **Step 3: Implement the flyouts in `showContextMenu`.**
  - Render items with `items` as a row with a trailing `fp-chevron-right`.
  - Open the child menu (`.fp-context-menu--flyout`, the same builder called recursively) on 250 ms hover, on click, or on ArrowRight/Enter. Position it at the parent row's right edge; flip to the left edge when it would overflow `innerWidth`; clamp vertically to `innerHeight`.
  - Safe-triangle: while the pointer moves toward the open flyout, hovering sibling rows for less than 300 ms doesn't close it.
  - ArrowLeft/Escape closes only the flyout. Escape on the root closes all. A click outside closes all.
  - Only one flyout is open per level.
  - Also fix pass-2 #61: position the root menu with its measured `offsetWidth`/`offsetHeight` (not the hardcoded 200), clamped so it never leaves the top or left edge.
- [ ] **Step 4: Sort menu.**
  - `SORT_MENU_ITEMS`: Name, `{label:'Date…', items:[created, modified, accessed]}`, Type, Size, separator, Ascending, Descending.
  - Add `case 'sort-created'` and `case 'sort-accessed'` beside `sort-modified`.
  - `sortedEntries` sorts by `e[key]`, with missing values last.
  - Add `dateFieldForSort()`. The Details date column header text and the row cell use it (`formatModified` gets generalised to `formatDate(ts)`).
  - `applySort` keeps the selection and focus, and keeps the focused row in view.
- [ ] **Step 5:** Run the spec, then the full verify.ps1. Expected: green. Commit: `feat(menus): flyout submenus; Sort "Date…" with created/modified/accessed; date column follows the sort (2D §6.3)`.

### Task 3: No default menu, in-place refresh, one render per navigation, tab listing cache (spec §4.1-4.2 non-icon parts, §7)

**Files:**
- Modify: `frontend/main.js` (window creation ~145; add `Menu.setApplicationMenu(null)`; `will-navigate` / `setWindowOpenHandler` deny), `frontend/src/browser.js` (`loadDirectory` ~490-560, `refreshDirectory` ~563-611, `setViewMode` ~104, `renderDirectory`), `frontend/src/app.js` (`activateTab` ~267-366, tab record ~165-188, `syncActiveTabRecord`, keydown for Ctrl+R/F5, `case 'refresh-directory'`), `frontend/src/styles.css` (refresh spin, list dip)
- Test: `frontend/test/stage2d-refresh.spec.js` (new)

**Interfaces:**
- Produces:
  - `refreshAll(): Promise<void>` (app.js), the single entry point for Ctrl+R, F5, the toolbar button and the context menu.
  - `patchDirectory(newEntries)` (browser.js), the diff-patch renderer. It keys on `entry.name` and keeps the DOM nodes of unchanged rows.
  - `window.__fpRenderCount`, incremented in `renderDirectory`; the tests read it.
  - The tab record gains `listing: {path, entries, fetchedAt} | null` and `stale: boolean`.
  - `loadDirectory(path, {restore, cached})` paints `cached.entries` synchronously when given, then revalidates.

- [ ] **Step 1: Failing tests** (`stage2d-refresh.spec.js`), one launch, ordered checks:

```js
// 1. Ctrl+R does not reload the page
const origin0 = await page.evaluate(() => performance.timeOrigin);
await page.keyboard.press('Control+r'); await page.waitForTimeout(600);
expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin0);
// 2. scroll + selection survive; new file appears
await page.evaluate((p) => openBrowserAt(p), bigDir);            // _gen large folder
await page.evaluate(() => { document.getElementById('list-scroll').scrollTop = 900; });
await rowByName(page, someVisibleName).click();
fs.writeFileSync(path.join(bigDirOnDisk, 'aaa-new-2d.txt'), 'x');
await page.keyboard.press('Control+r');
await expect(rowByName(page, 'aaa-new-2d.txt')).toHaveCount(1);
expect(await page.evaluate(() => document.getElementById('list-scroll').scrollTop)).toBe(900);
await expect(rowByName(page, someVisibleName)).toHaveClass(/is-selected/);
// 3. unchanged rows keep their DOM node identity across refresh
const marked = await page.evaluate(() => { const r = document.querySelector('#list-scroll .fp-row'); r.dataset.probe = '1'; return r.dataset.path; });
await page.keyboard.press('F5'); await page.waitForTimeout(500);
expect(await page.locator('#list-scroll .fp-row[data-probe="1"]').count()).toBe(1);
// 4. one render per navigation
const n0 = await page.evaluate(() => window.__fpRenderCount);
await page.evaluate((p) => openBrowserAt(p), docsDir); await page.waitForTimeout(500);
expect(await page.evaluate(() => window.__fpRenderCount) - n0).toBe(1);
// 5. tab switch paints the cached listing synchronously (no empty frame)
//    open docs in tab A, pics in tab B; switch back to A and read the rows in the same task
const rowsAtSwitch = await page.evaluate(() => { switchToTab(tabs.list[0]); return document.querySelectorAll('#list-scroll .fp-row').length; });
expect(rowsAtSwitch).toBeGreaterThan(0);
// 6. refresh of a folder deleted on disk keeps listing + error toast, no navigation
// 7. race: start openBrowserAt(slowDir) then switchToTab(other) immediately; after settle the other tab's rows are shown
// 8. Alt key does not show a menu bar; Ctrl+Shift+I does nothing in test env
```
Derive `bigDir`, `docsDir` and the disk path from `apiGet('/fs/list/root')` and the fixture builder (`frontend/test/harness/global-setup.js`). If the fixture lacks a folder with more than 200 entries, add one there (deterministic names).

- [ ] **Step 2:** Run the spec. Expected: FAIL on checks 1, 3, 4, 5.
- [ ] **Step 3: main.js.**
  - Call `Menu.setApplicationMenu(null)` before creating the window.
  - Add `webContents.on('will-navigate', e => e.preventDefault())` unless the url equals the loaded index (a dropped file must not navigate the app).
  - Add `setWindowOpenHandler(() => ({action:'deny'}))`.
  - Keep F12 window-local and dev-only, as it is today.
  - Grep the renderer for anything that relied on default-menu accelerators (copy/paste in inputs: the Edit roles!). Without the menu, Ctrl+C/V/X/A/Z in `<input>` still work natively in Chromium, but verify it in the test: type in the search box, select all with Ctrl+A, cut, paste.
- [ ] **Step 4: One render per navigation.**
  - `loadDirectory` decides the view (today's `decideViewAndScale`; Task 5 replaces it with the ladder) *before* the single `renderDirectory`.
  - `setViewMode` gets an option `{render:false}` for internal callers.
  - Remove the opacity-0 rAF dance from `setViewMode`.
  - Remove the `setListScale` invalidation from the navigation path.
- [ ] **Step 5: Tab listing cache.**
  - `syncActiveTabRecord` stores `listing` (a reference to the entries array, not a copy).
  - `activateTab` calls `loadDirectory(path, {restore, cached: tab.listing})`. That paints synchronously (rows, scroll, selection), then fetches. If the fetched entries differ (by name + size + modified), it calls `patchDirectory`.
  - Keep the existing race guard (request token per tab). Extend it so a late response for a non-active tab only updates that tab's `listing` and never touches the DOM.
- [ ] **Step 6: `patchDirectory` and `refreshAll`.**
  - `patchDirectory`: diff old vs new by name. When changed rows ≤ 30% of the total, remove, replace or insert only those rows at their sorted index. Otherwise do a full render. Either way, restore `scrollTop`, the selection, anchor and focus by path.
  - `refreshAll`:
    - Browser screen: re-fetch, then patch.
    - Search mode: re-run the search.
    - `thispc:` (Task 8 hooks in later; for now a no-op guard).
    - Home: re-fetch Home data.
    - Then mark every other tab `stale`.
  - Feedback:
    - add `.is-spinning` to `#btn-refresh` for one 400 ms 360° spin (restart the animation if it is already spinning)
    - `#list-scroll` gets class `is-refreshing` for 160 ms, a CSS opacity keyframe 1 → .55 → 1
    - both are disabled by `@media (prefers-reduced-motion: reduce)`
  - On a fetch error: keep the DOM and call `showToast(reason, 'error')`. Also fix pass-2 #55: navigation state (path, breadcrumb, history) commits only after a successful fetch.
  - Ctrl+R and F5 keydowns: `preventDefault()` + `refreshAll()`. They are ignored while a modal dialog is open.
- [ ] **Step 7:** Run the spec green, then verify.ps1 green. Commit: `feat(refresh): Ctrl+R/F5 refresh in place with row diffing; default Electron menu removed; one render per navigation; tabs repaint from their cached listing (2D §7, §4.2)`.

### Task 4: Flash-free icons, generic-first, buckets, freeform thumbnails, shell icons everywhere (spec §4)

**Files:**
- Modify: `frontend/src/icons.js` (`iconFor` 142, `_winIcon` 171, `fpThumbBox` 186, `fpTileIcon` 204, caches 265-272, `_fpResolveWinIcon` 431, `fpShellIconUrl` 469, `_fpFetchThumb` 585-665, `fpInvalidateLazyIcons` 758, scan 730-749), `frontend/iconCache.js` (bucket helper; keep dual-mode export), `frontend/src/browser.js` (`renderFsIcon` 773-790), `frontend/src/properties.js` (`renderPropertiesHeader` 187-197), `frontend/src/app.js` (tab icons `tabIconFor` 118, `renderDriveItem` 1902, quick-access rendering), `frontend/src/home.js`, `frontend/src/search.js`, `frontend/src/inspector.js`, `frontend/src/dragdrop.js` (drag ghost), `frontend/src/styles.css` (`.fp-thumb*` 5963-6005, the `.fp-icon--compact` rule)
- Test: `frontend/test/stage2d-icons.spec.js` (new), `frontend/test/icon-cache.spec.js` (bucket unit tests)

**Interfaces:**
- Produces:
  - `fpIconBucket(physPx) → number`, in iconCache.js: snaps up to `[16,20,24,32,40,48,64,96,128,192,256]`, capped at 256.
  - `fpCachedIconImg(entry, logicalPx) → string|null`: synchronous markup for a cache hit.
  - `fpGenericKey(entry, px)`: `dir:*`, or `ext:.exe` etc. for per-path kinds.
  - `fpPrewarmGenerics(px)`.
  - `fpTypeIconFor(entry, logicalPx)`: the type icon, never a thumbnail (used by Properties and as the thumbnail stand-in).
- Consumes: Task 3's single render and cached-listing paint.

- [ ] **Step 1: Unit tests (failing)** in `icon-cache.spec.js`: `fpIconBucket(1)=16, 17→20, 33→40, 50→64, 300→256`. Then run `cd frontend && npx playwright test test/icon-cache.spec.js`. Expected: FAIL.
- [ ] **Step 2: Electron tests (failing)** in `stage2d-icons.spec.js`, with Settings → icon source = windows (set the setting via the same API/settings path the Settings screen uses):

```js
// revisit paints settled shell imgs synchronously, no sprite
await page.evaluate((p) => openBrowserAt(p), docsDir); await page.waitForTimeout(1500); // warm
await page.evaluate((p) => openBrowserAt(p), picsDir); await page.waitForTimeout(800);
const snap = await page.evaluate(async (p) => {
  await openBrowserAt(p);                       // resolves after the single render
  const rows = [...document.querySelectorAll('#list-scroll .fp-row')];
  return rows.map(r => {
    const img = r.querySelector('img[data-win-icon], img.fp-thumb');
    const sprite = r.querySelector('svg.fp-icon');
    return { settled: !!img && img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:image/gif'),
             spriteVisible: !!sprite && getComputedStyle(sprite).visibility !== 'hidden' };
  });
}, docsDir);
expect(snap.every(s => s.settled)).toBe(true);
expect(snap.some(s => s.spriteVisible)).toBe(false);
// first visit of a never-seen folder: no sprite visible at any sample (0/16/50/200 ms)
// plain sub-folders: the img src never changes after first paint (record src at 0 and at 1500 ms)
// Properties for a .png: header img is a shell icon (data-win-icon, ext key), not img.fp-thumb
// corrupt.png + shell route forced absent (fpShellIconRoute('absent')): ends on a type icon or the sprite, never an empty slot after 2 s
// icon box size stable: getBoundingClientRect of a tile img at 0/50/300 ms after a size change (Task 5 re-runs this)
// every icon site in windows mode carries a shell img: tab icon, sidebar quick-access + drives, breadcrumb drive crumb, Home recent rows, search results, inspector header
```
Add a deliberately corrupt `broken.png` (random bytes) and a desktop.ini-less plain folder to the fixture builder if missing. Then run the spec. Expected: FAIL.
- [ ] **Step 3: Synchronous paint.**
  - `iconFor` (windows source) and `renderFsIcon` call `fpCachedIconImg` first. On a hit they emit `<img class="fp-win-icon is-settled" src=... width/height via CSS var>`, with no observer attribute.
  - On a miss with a per-path kind, they emit the generic from cache if it is present (`data-generic="1"` plus the lazy attributes, so the per-path answer can still replace it).
  - Otherwise they emit an empty sized slot with `data-win-icon` (lazy).
  - The 16 ms MutationObserver debounce becomes a microtask (`queueMicrotask`) so misses start sooner.
- [ ] **Step 4: Generic-first + replace-if-different.** When the per-path answer arrives for a `data-generic` img, swap only if `url !== currentSrc` (data URLs compare by string). Prewarm generics at startup (after `/health` reports `shell_icons`) for the current bucket at 16 px and at the current icon size. Repeat on every bucket change.
- [ ] **Step 5: No sprite placeholder in windows mode.**
  - `fpThumbBox` in windows mode shows the type icon (cached shell icon, or an empty slot), never the sprite. The thumbnail crossfades over it in 90 ms.
  - The sprite appears only through `_fpWinIconFallback`, after both tiers fail.
  - FilePlus mode keeps the sprite as the type icon (it is the real icon there).
- [ ] **Step 6: Buckets and decode-before-swap.**
  - Every shell and thumbnail request goes out at `fpIconBucket(round(logical*dpr))`.
  - `fpInvalidateLazyIcons` no longer clears the src. It re-requests, `await img.decode()` on a detached `Image`, then assigns, so the size is unchanged.
  - Resolution is debounced 120 ms after the last size change, visible rows only (the IntersectionObserver keeps its 200 px margin).
- [ ] **Step 7: Freeform thumbnails (§4.4).**
  - The thumbnail `<img>` uses `object-fit: contain`. Its own box is computed to the image's aspect ratio inside the s×s slot, bottom-aligned, with `outline: 1px solid var(--border-subtle)` on the img.
  - The slot has no background or border.
  - Folder peeks keep their look.
- [ ] **Step 8: Compact custom icons (§4.5).** `fpTileIcon` / `iconFor` add `fp-icon--compact` when the logical size is ≤ 32. CSS hides the label/badge groups for it. (Read `fpTileIcon` to find the label/badge element classes. If the label is drawn inline, add a class to it in `fpTileIcon`.)
- [ ] **Step 9: Every icon site + Properties.**
  - Grep for `iconFor(`, `fpTileIcon(` and `#fp-` sprite uses that represent *items* (tabs, sidebar quick access / pinned / drives, breadcrumb drive crumb, Home, search, inspector header, drag ghost, This PC placeholder hooks). Each item site goes through `iconFor` / `fpTypeIconFor`.
  - Properties header: `fpTypeIconFor(entry, 32)`, resolved eagerly (not by the IntersectionObserver, which never fires inside the dialog). Call `_fpStartLazy` directly on insert.
- [ ] **Step 10:** Run both specs green, then verify.ps1 green (including the smoke's shell-bitmap device-pixel test; update its expected px to the bucket rule if it asserts raw px). Commit: `fix(icons): no placeholder flash — synchronous cache paint, generic-first per-path icons, px buckets with decode-before-swap, freeform thumbnails, compact small icons, shell icons at every item site (2D §4)`.

### Task 5: The view ladder (spec §3)

**Files:**
- Modify: `frontend/src/browser.js` (`browserState` 53-58, `setViewMode` 104, `setListScale`/`stepListScale` 143-161 → replaced, `decideViewAndScale` 182, `renderDirectory`, row builders, `moveFocus` and keyboard 1484-1555), `frontend/src/app.js` (`VIEW_MENU_ITEMS` 1446-1468, `viewScaleBucket`, view cases 2973-3019, wheel listener 3343, tab record view fields, settings migration), `frontend/src/styles.css` (grid 4154-4223, rows 2430, 2597, thumbs 6001), `frontend/index.html` (list head)
- Modify tests that reference `--list-scale` / `stepListScale` / `setListScale`: `smoke.spec.js` (:367, :791), `tabs-nav-pass2.spec.js` (:250), `dnd-menus-pass2.spec.js` (:314). Rewrite their assertions to the ladder API. Keep each test's original intent (per-tab view state, wheel steps the menu check).
- Test: `frontend/test/stage2d-views.spec.js` (new)

**Interfaces:**
- Produces:
  - `VIEW_LADDER` (browser.js), an array of `{view, size}`: `content, tiles, details, list, small, icons@48 … icons@256`.
  - `setView(view, size?, {manual, anchor})`.
  - `stepView(delta, {anchorEl})`.
  - `currentViewStep() → index`.
  - `browserState.view ∈ {'content','tiles','details','list','small','icons'}`, plus `browserState.iconSize`.
  - CSS variables on `#list-scroll`: `--icon-size`, `--cell-w`, `--list-col-w`.
  - `data-view` takes the new names.
  - Settings key `ui.folder_views`: `{[pathLower]: {view, size, t}}`, an LRU of 500.
  - The tab record stores `view` and `iconSize`; `listScale` is removed.
- Consumes: Task 2 `dateFieldForSort()`; Task 4 `fpIconBucket`, the CSS-var-sized icons and the decode-before-swap invalidation.

- [ ] **Step 1: Failing tests** (`stage2d-views.spec.js`):

```js
const ladder = await page.evaluate(() => VIEW_LADDER.map(s => s.view + (s.size ? '@' + s.size : '')));
expect(ladder.slice(0, 6)).toEqual(['content','tiles','details','list','small','icons@48']);
expect(ladder.at(-1)).toBe('icons@256');
// wheel walks the ladder from content to the top, one notch = one step, View menu check follows
await page.evaluate(() => setView('content', null, { manual: true }));
const box = await page.locator('#list-scroll').boundingBox();
await page.mouse.move(box.x + 50, box.y + box.height - 20);          // empty space counts
for (let i = 1; i < ladder.length; i++) {
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  expect(await page.evaluate(() => currentViewStep())).toBe(i);
}
// list view: column-major and plain wheel scrolls horizontally
await page.evaluate(() => setView('list', null, { manual: true }));
const before = await page.evaluate(() => document.getElementById('list-scroll').scrollLeft);
await page.mouse.wheel(0, 300);
expect(await page.evaluate(() => document.getElementById('list-scroll').scrollLeft)).toBeGreaterThan(before);
// icons@96: cells exactly 124 wide, icon box 96x96, name <= 4 lines, long unbroken name stays inside the cell
// no clipped text: for each view x zoom [0.8,1,1.25,1.5,2] every .fp-row__name has scrollWidth<=clientWidth+1 unless it has the ellipsis class, and every row's scrollHeight <= clientHeight+1
// icon img rect identical at 0/50/300 ms after a wheel step (stable)
// per-folder memory survives relaunch: set Large in Pictures, close, launchApp again, open Pictures -> icons@96
// media-heavy folder defaults to icons@96; plain folder defaults to details
// arrow keys: in icons view ArrowRight moves focus to the next cell; ArrowDown to the cell below (same column centre)
// Review Focus 1: in the large folder at icons@256, a wheel step's render completes in < 250 ms (performance.now around stepView)
// screenshots: views-<view>.png for each of the 8 named views at zoom 1 and 1.5
```
Run the spec. Expected: FAIL.
- [ ] **Step 2: State and ladder.**
  - Replace `--list-scale` and `LIST_SCALE_STEPS` with `VIEW_LADDER`.
  - `setView` sets `data-view` and the CSS vars, then renders once from the in-memory entries (no fetch), storing to `ui.folder_views` and the tab record when `manual`.
  - Scroll anchoring: before the change, record `anchorEl` (the row under the pointer, or the first visible row) and its offset from the viewport top. After the render, set `scrollTop` (or `scrollLeft` for list) so it sits at the same offset.
  - Migration (once, guarded by `ui.view_migrated_2d`): old `ui.view_mode` grid + `ui.list_scale` s → icons at the nearest ladder size to `96*s` clamped 48–256; list → list; details → details.
- [ ] **Step 3: Wheel.**
  - The document wheel listener with Ctrl, over `#list-scroll` or any descendant (empty space included), accumulates `deltaY`. For every −100 or +100 it calls `stepView(∓1)`. `preventDefault` always.
  - Remove the 80 ms cooldown.
  - In list view without Ctrl, translate `deltaY` to `scrollLeft += deltaY` (with `preventDefault`) when there is no horizontal delta.
- [ ] **Step 4: CSS layouts per §3.2.** One block per `[data-view="…"]`.
  - **icons:** `grid-template-columns: repeat(auto-fill, var(--cell-w)); grid-auto-rows:auto; align-items:start; justify-content:start; gap:2px`. The icon box is `width/height: var(--icon-size)`. The name is 12px/16px, `display:-webkit-box; -webkit-line-clamp:4; overflow-wrap:anywhere; text-align:center`. `.is-selected.is-focused` removes the clamp.
  - **list:** `display:grid; grid-auto-flow:column; grid-template-rows: repeat(var(--list-rows), 22px); grid-auto-columns: var(--list-col-w); overflow-x:auto; overflow-y:hidden`. `--list-rows` = `floor(clientHeight/22)`, set in JS on render and on resize (ResizeObserver on `#list-scroll`).
  - **small:** `grid-template-columns: repeat(auto-fill, var(--list-col-w)); grid-auto-rows:22px`.
  - **tiles:** `repeat(auto-fill, 256px)`, rows 64.
  - **content:** a block of 56px rows, with a two-line grid inside each row.
  - Name measure for `--list-col-w`: a canvas `measureText` with the row font over all names, max, clamp 160–360, + 16 (icon) + 8 (gap) + 12 (padding).
  - All row heights use `min-height` so nothing clips at any zoom.
  - Empty state, error banner and truncation banner span all columns (`grid-column: 1 / -1`; in list view, place them outside the flowing grid). This fixes pass-2 #169.
- [ ] **Step 5: Row markup per view.** Content rows: name and type on the left, `Date …: x` (`dateFieldForSort`) and `Size: y` on the right. Tiles: name/type/size lines. Others: icon + name. The icon comes from `renderFsIcon(entry, logicalPx)` (Task 4) with px = `--icon-size` for icons, 48 for tiles, 32 for content, and 16 otherwise.
- [ ] **Step 6: Menus.** `VIEW_MENU_ITEMS`: XL, Large, Medium, Small, List, Details, Tiles, Content, then the existing toggles. The check uses the buckets from §3.1. The empty-area context menu's View entry becomes a flyout with the same eight (Task 2's flyouts). Keep every `cm-*` / `data-action` case wired.
- [ ] **Step 7: Keyboard (§3.3).** `moveFocus` becomes geometric: collect the rendered row rects once per keypress (`getBoundingClientRect`), pick the neighbour per the rules, and scroll it into view (`block:'nearest', inline:'nearest'`).
- [ ] **Step 8:** Update the old tests (see Files), run the view spec green, then verify.ps1 green. Commit: `feat(views): Explorer view ladder — Content, Tiles, Details, List, Small, Medium→XL continuous; square icon cells with 4-line names; geometric arrow keys; per-folder view memory (2D §3)`.

### Task 6: App zoom with fixed-width panels and eased steps (spec §5)

**Files:**
- Modify: `frontend/main.js` (zoom IPC 198-228; add `win-zoom-to`), `frontend/preload.js` (`zoomTo`), `frontend/src/app.js` (`zoomIn/Out/Reset` 1226-1263, `updateZoomPill` 1213, sidebar collapse 702-721, inspector resize + width persistence), `frontend/src/styles.css` (sidebar/inspector width rules, `:root --app-zoom`)
- Test: `frontend/test/stage2d-zoom.spec.js` (new)

**Interfaces:**
- Produces: `:root` style `--app-zoom: <factor>`; `electronAPI.zoomTo(factor)`. Settings `ui.sidebar_w` / `ui.inspector_w` hold screen px. The zoom mode in effect is exposed as `window.__fpZoomEase` (`'eased'|'instant'`).

- [ ] **Step 1: Failing test:**

```js
const screenW = async (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().width * (window.devicePixelRatio / (window.__fpBaseDpr || window.devicePixelRatio)), sel);
// read the sidebar width in *screen* px: rect.width * zoomFactor
const sw = async () => page.evaluate(() => document.querySelector('.fp-sidebar').getBoundingClientRect().width * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')));
const w1 = await sw();
for (const k of ['Control+=', 'Control+=', 'Control+=']) { await page.keyboard.press(k); await page.waitForTimeout(200); }
expect(Math.abs((await sw()) - w1)).toBeLessThanOrEqual(1);
// same for the inspector; sidebar label font-size grew (computed px * zoom larger)
// inspector width persists across relaunch (drag the handle, relaunch, same screen width ±1)
// collapsed rail stays 52 screen px at 1.5
// screenshot zoom-150-browser.png
```
(Drop the unused `screenW` helper when writing the real test.) Run it. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - Every zoom change sets `--app-zoom` (also on startup, from the restored factor).
  - Sidebar, inspector and rail widths become `calc(var(--sidebar-w) / var(--app-zoom))`, with `--sidebar-w` in screen px (and the same for min/max).
  - Resize handles convert the pointer delta (CSS px) to screen px (`* zoom`) before storing.
  - Persist the inspector width (pass-2 #176).
- [ ] **Step 3: Easing.**
  - `zoomTo(target)` in preload uses `webFrame.setZoomFactor` over 4 rAF frames, ease-out from the current to the target. Under reduced motion, go straight there.
  - Measure frame durations. If any exceeds 32 ms in the first two eased steps of a session, set `window.__fpZoomEase='instant'` and stop easing.
  - The renderer keeps the pill/state in sync from the final factor.
  - Keep the main-process `ZOOM_STEPS` the source of the step list (expose it via IPC if the renderer needs it).
- [ ] **Step 4:** Spec green, then verify.ps1 green. Commit: `feat(zoom): app zoom keeps panel screen widths, eases each step; inspector width persisted (2D §5)`.

### Task 7: Toolbar — plain "+" new tab, left-anchored path, search collapses first (spec §6.1, §6.2)

**Files:**
- Modify: `frontend/index.html` (232-234 new-tab button; toolbar 243-343), `frontend/src/styles.css` (`.fp-breadcrumb-wrap` 917-926, `.fp-toolbar__search` 794-801, narrow mode 809-850, tab strip), `frontend/src/app.js` (`initToolbarNarrowMode` 848-887), `frontend/src/search.js` (expand/collapse 1059-1064), `frontend/src/browser.js` (`updateBreadcrumb` 1041 notifies the layout)
- Test: `frontend/test/stage2d-toolbar.spec.js` (new)

**Interfaces:**
- Produces: `#toolbar[data-search="full"|"collapsed"]` replaces `data-narrow`. Update every CSS/JS/test reference to `data-narrow`. Also produces `.fp-breadcrumb-wrap.is-overflowing` (right-anchored + fade) and `layoutToolbar()` (app.js), which is callable after any crumb change.

- [ ] **Step 1: Failing test:**

```js
await expect(page.locator('#btn-new-tab use')).toHaveAttribute('href', '#fp-add');  // or xlink:href per sprite helper
// wide window, short path: search full, crumbs start at the left edge of the wrap
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1400, 800));
await page.evaluate((p) => openBrowserAt(p), docsDir);
const wrap = await page.locator('#breadcrumb-wrap').boundingBox();
const first = await page.locator('#breadcrumb .fp-breadcrumb__crumb').first().boundingBox();
expect(first.x - wrap.x).toBeLessThan(12);
await expect(page.locator('#toolbar')).toHaveAttribute('data-search', 'full');
// deep path at 900px: search collapsed BEFORE the breadcrumb overflows
await page.evaluate((p) => openBrowserAt(p), deepDir);   // fixture: nest 8 levels with long names
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 700));
await page.waitForTimeout(300);
const st = await page.evaluate(() => ({ s: document.getElementById('toolbar').dataset.search, of: document.getElementById('breadcrumb-wrap').classList.contains('is-overflowing') }));
expect(!(st.of && st.s === 'full')).toBe(true);           // never overflowing while search is full
// at 700px: collapsed + overflowing, current crumb visible inside the wrap
// Ctrl+F at 700px expands search as overlay; breadcrumb rect unchanged; Escape collapses again
// screenshots toolbar-1400.png, toolbar-900.png, toolbar-700.png, also at zoom 1.5
```
Run it. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - The new-tab button uses `icon('fp-add', 16)` through the existing sprite helper, with class `fp-tab-new` and the inline styles moved into CSS.
  - `layoutToolbar()` measures `crumbNatural = #breadcrumb.scrollWidth`, `free = wrap.parentWidth - fixedSiblings`. Then:
    - if `crumbNatural + searchPreferred(280) <= free`: full, preferred width
    - else if `crumbNatural + searchMin(180) <= free`: full, width = `free - crumbNatural`
    - else: collapsed. Overflowing = `crumbNatural > free - 28`.
    - Apply 24 px hysteresis on the transitions.
  - The breadcrumb is left-anchored (`justify-content:flex-start`). `.is-overflowing` switches it to `flex-end` and enables the existing leading mask.
  - The expanded-while-collapsed search is `position:absolute` over the breadcrumb wrap, so the crumbs never reflow.
  - Call `layoutToolbar` from the ResizeObserver, from `updateBreadcrumb`, on zoom change and on font load.
- [ ] **Step 3: Sibling sweep (spec §12, the "fixed-constant layout" row).** Check the status bar, inspector header, tab strip overflow and Home header at 700 px and at 1.5 zoom. Fix anything that overflows or clips, and add assertions to this spec.
- [ ] **Step 4:** Spec green, then verify.ps1 green. Commit: `feat(toolbar): plain + new-tab; path grows from the left; search collapses fully before the path caves in (2D §6.1-6.2)`.

### Task 8: This PC page (spec §8)

**Files:**
- Create: `frontend/src/thispc.js` (loaded after `browser.js`, before `app.js`; it defines `renderThisPC(drives)`, `driveDisplayName(d)` and `driveUsageMarkup(d)`)
- Modify: `frontend/index.html` (script tag; a `#thispc-view` container inside the browser pane, sibling of `#list-scroll`), `frontend/src/app.js` (`thispc-open` 2274, `openBrowserAt` 482, `tabLabelFor` 94, `loadDrives` 1888, `renderDriveItem` 1902 → shared formatter, `refreshAll` hook, context-menu cases `cm-drive-open`, `cm-drive-open-tab`, `cm-drive-properties`), `frontend/src/browser.js` (`loadDirectory` handles the `thispc:` sentinel; `updateBreadcrumb` root crumb; Alt+↑ at a drive root → `thispc:`), `frontend/src/styles.css` (cards)
- Test: `frontend/test/stage2d-thispc.spec.js` (new)

**Interfaces:**
- Consumes: Task 1 `/drives` `kind` / `fs`; Task 3 `refreshAll`; Task 4 `iconFor` for drives; Task 5 geometric `moveFocus` (cards are `.fp-row`-like focusables with `data-path`).
- Produces: the `THISPC = 'thispc:'` path sentinel. It is accepted by `loadDirectory`, history, tab records and `tabLabelFor` ("This PC").

- [ ] **Step 1: Failing test:**

```js
await page.click('[data-action="thispc-open"]');
await expect(page.locator('#thispc-view')).toBeVisible();
await expect(page.locator('#list-scroll')).toBeHidden();
const drives = await apiGet('/drives');
const cards = page.locator('#thispc-view .fp-drive-card');
await expect(cards).toHaveCount(drives.length);
const c = cards.first();
await expect(c.locator('.fp-drive-card__name')).toHaveText(/\([A-Z]:\)$/);
await expect(c.locator('.fp-drive-card__free')).toHaveText(/free of/);
const bar = await c.locator('.fp-drive-card__bar-fill').evaluate(el => parseFloat(el.style.width));
expect(bar).toBeGreaterThan(0);
expect(await page.evaluate(() => activeTab().label)).toBe('This PC');
await c.focus(); await page.keyboard.press('Enter');
await expect(page.locator('#list-scroll')).toBeVisible();     // drive opened
await page.click('#btn-back');
await expect(page.locator('#thispc-view')).toBeVisible();      // in history
await page.keyboard.press('Control+r');                        // refresh re-reads drives, no error
// Alt+Up from a drive root lands on This PC
// no horizontal overflow at 700px / zoom 1.5; screenshot thispc.png, thispc-narrow.png
```
Run it. Expected: FAIL.
- [ ] **Step 2: Implement.**
  - `loadDirectory('thispc:')` hides `#list-scroll` and `#list-head`, shows `#thispc-view`, fetches `/drives` (it updates `window.__fpDrives`), and renders the cards.
  - Navigation commits as in Task 3 (history, breadcrumb = a single "This PC" crumb, tab label).
  - Card markup:
    - the icon: `iconFor({path: mount, is_dir:true, kind:'drive'}, 48)`, the shell drive icon in windows mode and `fp-drive` in fileplus mode
    - the name: `driveDisplayName` = `${label || 'Local Disk'} (${letter}:)`
    - the bar: track `--bg-raised`, fill `--accent`, fill `--danger` when `used/total > .9`
    - the free text: "X GB free of Y GB" via the existing byte formatter
  - Cards are keyboard focusable (`tabindex=0`, roving focus), single click selects, double click / Enter opens.
  - Context menu: Open, Open in new tab, Properties (`electronAPI.showProperties(mount)`).
  - The sidebar `renderDriveItem` uses the same `driveDisplayName` and formatter.
  - `refreshAll` on `thispc:` re-renders the cards.
- [ ] **Step 3: Sibling sweep (§12 "navigation target ≠ label").** Click every sidebar item and the breadcrumb root, and assert the tab label and breadcrumb match the location. Add those checks to this spec.
- [ ] **Step 4:** Spec green, then verify.ps1 green. Commit: `feat(thispc): This PC page with drive cards — icon, full name, usage bar, free of total (2D §8)`.

### Task 9: Sidebar polish and overlay scrollbar (spec §9)

**Files:**
- Create: `frontend/src/overlayscroll.js` (loaded before `app.js`; it defines `fpOverlayScroll(el, {fade:true}) → {update(), destroy()}`)
- Modify: `frontend/index.html` (script tag), `frontend/src/styles.css` (sidebar 458-718, 4831-5010; new `--sidebar-*` tokens; `.fp-oscroll*` rules; the `.is-scroll-top/.is-scroll-bottom` masks), `frontend/src/app.js` (attach to `.fp-sidebar__scroll` at init; attach to the inspector body and the Properties dialog body), `frontend/src/inspector.js`, `frontend/src/properties.js` (attach)
- Test: `frontend/test/stage2d-sidebar.spec.js` (new)

**Interfaces:**
- Produces: `fpOverlayScroll(el, opts)`. It adds a sibling overlay `.fp-oscroll` (track + thumb) positioned absolutely in el's offset parent (wrap el if needed), sets `scrollbar-width:none` on el, and toggles `is-scroll-top` (content hidden above) and `is-scroll-bottom` (content hidden below) on el.

- [ ] **Step 1: Failing test:**

```js
const sc = page.locator('.fp-sidebar__scroll');
// header size
expect(await page.locator('.fp-sidebar__section-label').first().evaluate(e => getComputedStyle(e).fontSize)).toBe('11px');
// dividers between sections exist
expect(await page.locator('.fp-sidebar__divider').count()).toBeGreaterThanOrEqual(3);
// no horizontal overflow anywhere in the sidebar
expect(await page.evaluate(() => [...document.querySelectorAll('.fp-sidebar, .fp-sidebar *')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'hidden' && e.clientWidth > 0).length)).toBe(0);
// overlay: scrollbar takes no layout width
expect(await sc.evaluate(e => e.offsetWidth - e.clientWidth)).toBe(0);
// make it overflow: small window height
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 420));
await page.waitForTimeout(300);
await expect(sc).toHaveClass(/is-scroll-bottom/);
await expect(sc).not.toHaveClass(/is-scroll-top/);
await sc.evaluate(e => e.scrollTop = e.scrollHeight);
await page.waitForTimeout(100);
await expect(sc).toHaveClass(/is-scroll-top/);
await expect(sc).not.toHaveClass(/is-scroll-bottom/);
// thumb widens on hover of its hot zone
const thumb = page.locator('.fp-sidebar .fp-oscroll__thumb');
const w0 = await thumb.evaluate(e => e.getBoundingClientRect().width);
const tb = await thumb.boundingBox(); await page.mouse.move(tb.x + tb.width / 2, tb.y + 5);
await page.waitForTimeout(250);
expect(await thumb.evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThan(w0);
// drag thumb scrolls
// collapsed: icons 22px; rail screen width 52
await page.keyboard.press('Control+b');
expect(await page.locator('.fp-sidebar__item .fp-icon').first().evaluate(e => e.getBoundingClientRect().width)).toBe(22);
// screenshots sidebar-expanded.png, sidebar-collapsed.png, sidebar-scroll-cue.png
```
Run it. Expected: FAIL.
- [ ] **Step 2: Tokens and rhythm (§9.1).**
  - Add the `:root` tokens `--sidebar-item-h:28px`, `--sidebar-pad-x:8px`, `--sidebar-icon:18px`, `--sidebar-gap:8px`, `--sidebar-label:13px`, `--sidebar-section-gap-top:6px`, `--sidebar-section-gap-bottom:4px`, `--sidebar-rail-item:40px`, `--sidebar-rail-icon:22px`, `--scrollbar-thumb`.
  - Section labels use 11px/16px, weight 600, tracking 0.04em.
  - Add `<div class="fp-sidebar__divider" role="separator">` between sections in `index.html` (and wherever sections render dynamically). The rule is 1px `--border-subtle`, margin `6px 12px 4px`.
  - Remove the old section `margin-top`.
- [ ] **Step 3: Collapsed rail (§9.2).** Items 40×40, icons 22, drive badges 22, dividers full width minus 16, and tooltips on every rail item (`title`, or the existing tooltip helper).
- [ ] **Step 4: Scrolling (§9.3).**
  - `.fp-sidebar { overflow:hidden }`; `.fp-sidebar__scroll { overflow-y:auto; overflow-x:hidden; scrollbar-width:none }`.
  - Labels get `min-width:0` + ellipsis, so nothing can be wider than the panel.
  - The `fpOverlayScroll` thumb:
    - 3px base, 7px on hover of a 10px hot zone (a `.is-hot` class set via pointermove on the scroller's right edge, plus `:hover` on the track)
    - `transition: width 160ms ease, opacity 160ms ease`
    - visible while scrolling or while the panel is hovered, fading 900 ms after the last scroll
    - hidden when `scrollHeight <= clientHeight`
    - thumb drag via pointer capture; a click on the track pages
    - ResizeObserver on the content plus a MutationObserver (childList) so dynamic sections update it
  - Mask fades: `.is-scroll-top { mask-image: linear-gradient(to bottom, transparent 0, #000 20px) }`, the mirror for bottom, and both combined when both apply.
  - Attach the component to the inspector body and the Properties body too.
- [ ] **Step 5: Sibling sweep (§12 "permanent bars / x-overflow").** Check the settings screen, search popovers, context menus and the Ask File+ popout for x-overflow or permanent bars at 700 px / 1.5 zoom. Fix them and add assertions.
- [ ] **Step 6:** Spec green, contrast gate green (the new thumb colour must pass `contrast_check.py` if it checks non-text UI), then verify.ps1 green. Commit: `feat(sidebar): bigger section headers, hairline dividers, tighter rhythm, larger rail icons, overlay scrollbar with scroll cues, no horizontal scroll (2D §9)`.

### Task 10: Pass-2 leftover `ux-daily-use` findings (spec §10)

**Files:** per finding. Ledger: `.worktrees/stage-2c-pass-2/.superpowers/sdd/2026-09-13-pass-2/confirmed-findings.json` (dimension `ux-daily-use`, 21 findings: #53-63, #168-177). Test: `frontend/test/stage2d-ux-leftovers.spec.js` (new).

- [ ] **Step 1:** For each finding, re-read the cited code. Classify it as *still present*, *already fixed* (cite the commit via `git log -S`), or *superseded* (#168 → Task 5, #169 → Task 5, #176 → Task 6, #55 → Task 3, #61 → Task 2).
- [ ] **Step 2:** For each still-present finding, write a failing assertion in the spec (or a pytest), implement the finding's `fix`, and confirm the assertion passes. Required behaviours:
  - #53: Browser shortcuts are inert while any modal or overlay is open.
  - #54: the More-filters modal closes on Escape or a backdrop click.
  - #56: already Task 3; just confirm.
  - #57: the inspector resize handle is hidden while the inspector is closed.
  - #58: disabled buttons keep their tooltip and the not-allowed cursor; use `aria-disabled` styling, not `pointer-events:none`.
  - #59: Escape on device-name rename reverts to the *current* name.
  - #60: truncated names get a `title`.
  - #62: snackbars stack.
  - #63: error toasts auto-dismiss after 8 s, max 3 visible.
  - #170: Home row hover buttons get `tabindex=-1`, with roving focus on rows.
  - #171: confirm F12 is window-local.
  - #172: cut items render at 50% opacity, and copied items get a subtle badge until the clipboard changes.
  - #173: `:focus-visible` rings on sidebar items and tabs, using the accent token.
  - #174: maximize ↔ restore glyph via a `win-maximized` IPC event + new sprite symbol through `build_icons.js`.
  - #175: open menus and popovers close on window resize or ancestor scroll.
  - #177: Details rows scroll horizontally with the header in sync.
- [ ] **Step 3:** Record every finding's outcome in `.superpowers/sdd/2026-10-01-stage-2d/leftovers.md` (it feeds the run doc). Run verify.ps1 green. Commit: `fix(ux): pass-2 ux-daily-use leftovers (2D §10)`.

### Task 11: Pass-2 leftover `tests-verify-honesty` findings (spec §10)

**Files:** `scripts/verify.ps1`, `scripts/check_menu_cases.js`, `scripts/check_icons.js`, `scripts/gen_sandbox.py`, `frontend/test/*.spec.js`, `tests/*.py`. Ledger: the 17 findings #99-109 and #185-190.

- [ ] **Step 1:** Re-check each finding against the post-harness code. Much of it changed in the dev-harness merge (the specs now use the harness, the backend runs on 9877). Classify each as present, fixed or superseded.
- [ ] **Step 2:** Fix the present ones. Required, if still present:
  - #99 the decoy step really runs and cleans up only what it created
  - #100 try/finally around the read-only Properties round trip
  - #102 the race steps wait on a deterministic signal instead of a sleep
  - #103 the STUB_SCREENS gate checks live code or is deleted
  - #104 `check_icons` resolves non-literal references through a declared list exported from icons.js
  - #105 the CLAUDE.md wording matches verify.ps1
  - #106 attach console listeners before the window is created (via `app.on('browser-window-created')` in launchApp)
  - #107 verify empties `.FilePlusTrash` in the fixture after the run
  - #108 the parity test is CWD-independent
  - #109 the zero-assert tests become strict xfail with a reason, or real asserts
  - #185 the inspector "Open with…" is wired to `openWithDialog`
  - #186 no stub toast from titlebar / home-tab controls
  - #187 `check_menu_cases` covers every `data-action` in index.html
  - #188 / #189 the polls wait on a change token
  - #190 the line-count gate is added or the spec line removed (pick removed: CLAUDE.md is now longer by design; record that)
- [ ] **Step 3:** Run verify.ps1 green. Commit: `test(verify): pass-2 tests-verify-honesty leftovers (2D §10)`.

### Task 12: Sibling-oversight sweep (spec §12)

- [ ] **Step 1: Audit** (read-only). For each row of spec §12 not already swept by Tasks 7-9, check the listed places in the running app (Playwright evaluate + screenshots at zoom 1 / 1.5 and 700 / 1400 px) and in the code. Write each confirmed issue to `.superpowers/sdd/2026-10-01-stage-2d/sweep.md` with file:line and a repro.
- [ ] **Step 2: Fix** each confirmed issue with a regression assertion in `frontend/test/stage2d-sweep.spec.js` (or the closest existing 2D spec). Run verify.ps1 green. Commit: `fix(sweep): sibling oversights of playtest-2 issue classes (2D §12)`.

### Task 13: Docs leftovers, CLAUDE.md, run doc (spec §10)

- [ ] **Step 1:** Re-check the 24 `docs-vs-code` findings, and fix the docs (or record them as already fixed).
- [ ] **Step 2:** Update CLAUDE.md:
  - Frontend traps: the new module load order (`thispc.js`, `overlayscroll.js`), the view ladder (replaces `--list-scale`), `data-search` (replaces `data-narrow`), the icon bucket rule
  - Current state: Stage 2D
  - Update `docs/UI-SPEC.md` for views, This PC, refresh and the sidebar
- [ ] **Step 3:** Write `docs/superpowers/runs/2026-10-01-stage-2d.md`: what landed per spec section, the leftovers ledger, the sweep findings, test counts, and the feel-check list for the author (5-8 things to click).
- [ ] **Step 4:** Run verify.ps1 green. Commit: `docs: Stage 2D run summary, CLAUDE.md and UI-SPEC brought up to date`.

### Task 14: Whole-branch review and QA

- [ ] **Step 1:** Dispatch the `reviewer` agent on `git diff master...HEAD` and the `qa` agent (full suite + screenshots + logs), in parallel.
- [ ] **Step 2:** Fix every MUST FIX, and every SHOULD FIX that affects behaviour or visuals, with tests. Run verify.ps1 green. Commit: `fix: whole-branch review and QA findings (2D)`.
- [ ] **Step 3:** Final verify.ps1 on a clean tree. Report to the author with the feel-check list. Do not merge; merging is the author's call.
