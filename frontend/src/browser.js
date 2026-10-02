/**
 * FilePlus browser screen: folder navigation via /fs/list, directory list
 * rendering, view-mode/column-sort/marquee-selection UI, the selection model
 * + keyboard navigation, and the small formatting helpers (icons, size,
 * modified date, HTML escaping) the row renderer needs.
 *
 * Navigation history is per-tab (Stage 2C Task 7): `nav` below is just an
 * ACCESSOR — app.js's activateTab() repoints nav.history/nav.index at the
 * active tab's own arrays (by reference) on every tab switch, so
 * pushHistory()/navBack()/navForward() here always mutate whichever tab is
 * currently active without needing to know the tabs model exists.
 */

// ── Per-tab navigation history accessor ───────────────────────────────────────
// Swapped by app.js's activateTab(); seeded for the initial tab by
// app.js's seedInitialTab() at boot.
const nav = { history: [], index: -1 };

// ── The view ladder (Stage 2D §3) ────────────────────────────────────────────
// Explorer's eight views, smallest to largest, as one ladder Ctrl+wheel walks
// a notch at a time: Content, Tiles, Details, List, Small icons, then icons
// at every size from 48 to 256 (Medium = 48, Large = 96, Extra large = 256).
// Only `icons` carries a size; the other five are fixed-size (only app zoom
// makes them bigger). browserState.view/iconSize hold where the active tab
// sits on it; setView() is the only writer.
const VIEW_ICON_SIZES = [48, 56, 64, 72, 80, 96, 112, 128, 160, 192, 224, 256];
const VIEW_LADDER = Object.freeze([
  { view: 'content', size: null },
  { view: 'tiles', size: null },
  { view: 'details', size: null },
  { view: 'list', size: null },
  { view: 'small', size: null },
  ...VIEW_ICON_SIZES.map(size => ({ view: 'icons', size })),
].map(Object.freeze));
const VIEW_NAMES = ['content', 'tiles', 'details', 'list', 'small', 'icons'];
// What the View menu's three icon items set.
const VIEW_NAMED_ICON_SIZES = { medium: 48, large: 96, xl: 256 };
// The icon size of the five fixed views, in logical px (spec §3.2).
const VIEW_FIXED_ICON_PX = { content: 32, tiles: 48, details: 16, list: 16, small: 16 };
// An icon cell is the icon plus this much: s + 28 (spec §3.4).
const VIEW_CELL_EXTRA = 28;
// List / Small icons row height (styles.css --view-row-list).
const VIEW_LIST_ROW_PX = 22;
// List / Small icons column width: the longest name, clamped, plus the 16px
// icon, the 8px gap, 2 x 6px padding and 2 x 1px border of a cell.
const VIEW_COL_NAME_MIN = 160;
const VIEW_COL_NAME_MAX = 360;
const VIEW_COL_CHROME = 16 + 8 + 12 + 2;

// Per-folder view memory (spec §3.1): {[normalised path]: {view, size, t}},
// persisted as one settings key, the 500 most recently set paths.
const FOLDER_VIEWS_KEY = 'ui.folder_views';
const FOLDER_VIEWS_MAX = 500;

// ── Browser state ─────────────────────────────────────────────────────────────
// The last-loaded directory listing. `parent`/`isRoot` come straight from the
// /fs/list response so navUp() and the up-button never need to re-derive a
// parent by string-slicing the path. `showHidden` is seeded from
// config['ui.show_hidden'] by app.js's init sequence, before the first load.
// `sort` is re-applied from ui.sort by settings.js's
// applySettingsFromConfig() once GET /config has answered; the view is
// decided per folder on every navigation (decideView). `selection` is the set of absolute paths
// currently selected; `anchor` is the shift-range origin, `focus` is the
// last row acted on (keyboard/click).
const browserState = {
  path: null,
  entries: [],
  sort: { key: 'name', dir: 'asc' },
  selection: new Set(),
  anchor: null,
  focus: null,
  showHidden: false,
  showExtensions: true,
  // One of VIEW_NAMES — mirrors #list-scroll[data-view], read by renderFsRow
  // to pick each view's markup. setView() is the only writer.
  view: 'details',
  // The icons view's size (a VIEW_ICON_SIZES member). Kept while another
  // view is showing, so Ctrl+wheel back into icons lands where it left.
  iconSize: 96,
  // 'browse' (a real /fs/list listing) | 'search' (a results listing from
  // search.js — see renderSearchResults). loadDirectory()'s dynamic-media-view
  // check never runs in 'search', so a results listing never has its own view
  // choice fought over by a folder's media share.
  mode: 'browse',
  // In 'search' mode: the root the results came from ('*' for the This PC
  // index scope) — what the breadcrumb's "Search in <x>" names. null otherwise.
  searchRoot: null,
  parent: null,
  isRoot: false,
  truncated: false,
  // Last path passed to loadDirectory() (including null for the sandbox
  // root) — whatever the load's outcome. Used by the error banner's "Retry"
  // action so it can re-attempt the exact same load that just failed.
  lastAttemptedPath: null,
  // Set by refreshDirectory() when it is called from off the Browser screen
  // (the Settings show-hidden checkbox) and it therefore declines to reload:
  // whatever is sitting in #list-scroll no longer matches the settings it was
  // fetched with, so switchScreen()'s reveal branch re-fetches instead of
  // revealing it. Cleared by every completed loadDirectory().
  listingStale: false,
  // Monotonic counter, bumped by every loadDirectory() call before its
  // fetch — lets a call whose fetch resolves late detect it's been
  // superseded (by a tab switch OR a newer navigation in the same tab) and
  // bail out instead of painting stale data over whatever's current. See
  // loadDirectory()'s reqTabId/reqSeq guard.
  _loadSeq: 0,
  // The tab whose listing browserState.path/entries (and #list-scroll) hold —
  // set by every committed listing. A failed navigation may only fall back
  // to "keep what is on screen" when what is on screen is this tab's own.
  listingTabId: null,
  // When browserState.entries was fetched (ms epoch) — carried into the tab
  // record's cached listing (Stage 2D §4.2).
  fetchedAt: 0,
  // A Back/Forward whose fetch is still in flight: {seq, index}. nav.index
  // only moves once the fetch succeeds (pass-2 #55), so a second Back pressed
  // before the first lands steps on from here instead of repeating it.
  _pendingHistory: null,
  // The tab whose search results are on screen in 'search' mode.
  searchTabId: null,
  // exitSearchResults()'s load while it is in flight: {seq} (searchExitPending).
  _pendingExit: null,
  // patchDirectory() left a row being renamed out of sorted order.
  _orderDirty: false,
};

// Test hooks (Stage 2D §11): renders of the listing, and directory fetches
// still in flight. Read by the Electron tests, never by the app.
window.__fpRenderCount = 0;
window.__fpLoadPending = 0;

// ── Views (Stage 2D §3) ──────────────────────────────────────────────────────

/** The ladder size nearest `px` (ties go to the smaller one). */
function snapIconSize(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return VIEW_NAMED_ICON_SIZES.large;
  let best = VIEW_ICON_SIZES[0];
  for (const s of VIEW_ICON_SIZES) if (Math.abs(s - n) < Math.abs(best - n)) best = s;
  return best;
}

/** {view, size} with `view` one of VIEW_NAMES (anything else is Details) and
 * `size` a ladder size for icons, null otherwise. */
function normalizeView(view, size = null) {
  const v = VIEW_NAMES.includes(view) ? view : 'details';
  return { view: v, size: v === 'icons' ? snapIconSize(size ?? VIEW_NAMED_ICON_SIZES.large) : null };
}

/** Index of a view (and, for icons, size) on VIEW_LADDER. */
function viewStepIndex(view, size = null) {
  const n = normalizeView(view, size);
  return VIEW_LADDER.findIndex(s => s.view === n.view && (n.view !== 'icons' || s.size === n.size));
}

/** Where the listing sits on VIEW_LADDER now. */
function currentViewStep() {
  return viewStepIndex(browserState.view, browserState.iconSize);
}

/** Which View-menu item names the current view: the view itself, or for
 * icons the nearest named size (spec §3.1: < 80 Medium, < 192 Large, else
 * Extra large). */
function viewMenuKey() {
  if (browserState.view !== 'icons') return browserState.view;
  const s = browserState.iconSize;
  return s < 80 ? 'medium' : (s < 192 ? 'large' : 'xl');
}

/** The listing's logical icon size in CSS px — what --icon-size on
 * #list-scroll is set to: the size for icons, the fixed size of every other
 * view (spec §3.2). Row markup asks icons.js for this size, so its
 * synchronous cache lookup uses the same px bucket the lazy path would. */
function fpListIconSize() {
  return browserState.view === 'icons'
    ? browserState.iconSize
    : (VIEW_FIXED_ICON_PX[browserState.view] || 16);
}

/** Puts browserState's view on every DOM surface that reflects it: the
 * listing's data-view and size variables, the column header (Details only),
 * Home's Recent/Favorites panes (icons → their grid). */
function applyViewDom() {
  const v = browserState.view;
  const px = fpListIconSize();
  const listScroll = document.getElementById('list-scroll');
  if (listScroll) {
    listScroll.dataset.view = v;
    // One synchronous update: every icon and thumbnail box is sized from
    // these by CSS, so cells and icons change in the same frame (§3.5).
    listScroll.style.setProperty('--icon-size', `${px}px`);
    listScroll.style.setProperty('--cell-w', `${px + VIEW_CELL_EXTRA}px`);
  }
  const listHead = document.getElementById('list-head');
  if (listHead) listHead.classList.toggle('list-head--grid-hidden', v !== 'details');
  document.querySelectorAll('.home-pane').forEach(pane => {
    pane.dataset.view = v === 'icons' ? 'grid' : 'details';
  });
}

/**
 * Sets the view (and, for icons, the size) and shows it.
 *
 * A change of view re-renders the listing once from the in-memory entries
 * (each view has its own markup) — never a fetch. A size change inside the
 * icons view does not re-render at all: the cells and icon boxes follow
 * --icon-size / --cell-w in this very frame, and every bitmap re-resolves at
 * its new px bucket after decode(), into the same box (spec §3.5, §4.3) — a
 * re-render would rebuild every image at a bucket the cache may not have yet
 * and blank it.
 *
 * Scroll anchoring: the row `anchorEl` sits in (the row under the pointer
 * for Ctrl+wheel), else the first visible row, keeps its offset from the top
 * of the list (from its left in List) across the change.
 *
 * `manual` (the View menu, the empty-area flyout, Ctrl+wheel) remembers the
 * choice for this folder (ui.folder_views) and for this tab; an automatic
 * choice (a navigation deciding its view) does neither. `render: false` is
 * for callers that render the listing themselves right afterwards (one
 * render per navigation, §4.2).
 */
function setView(view, size = null, { manual = false, anchorEl = null, render = true } = {}) {
  const want = normalizeView(view, view === 'icons' ? (size ?? browserState.iconSize) : null);
  const prevView = browserState.view;
  const changed = prevView !== want.view || (want.view === 'icons' && browserState.iconSize !== want.size);
  const listScroll = document.getElementById('list-scroll');
  const hasRows = !!(render && changed && listScroll && listScroll.querySelector(':scope > .fp-row[data-path]'));
  const anchor = hasRows ? captureScrollAnchor(listScroll, anchorEl) : null;

  browserState.view = want.view;
  if (want.view === 'icons') browserState.iconSize = want.size;
  applyViewDom();
  if (manual) rememberViewChoice();
  if (!render || !changed) return;

  if (prevView === want.view && hasRows) {
    // icons → icons: CSS alone resizes; the sharper bitmaps swap in later.
    listScroll.querySelectorAll(':scope > .fp-row .fp-tile__thumb [data-size]').forEach(el => {
      if (!el.classList.contains('fp-thumb--mini')) el.dataset.size = String(want.size);
    });
    if (typeof fpInvalidateLazyIcons === 'function') fpInvalidateLazyIcons(listScroll);
  } else if (browserState.entries && browserState.entries.length) {
    renderDirectory();
  } else {
    syncViewMetrics();
  }
  if (anchor) restoreScrollAnchor(listScroll, anchor);
}

/** One ladder step up (+1, larger) or down (-1); clamps at both ends.
 * Ctrl+wheel (app.js) comes through here. Returns whether the view
 * changed. */
function stepView(delta, { anchorEl = null } = {}) {
  const at = currentViewStep();
  const cur = at === -1 ? viewStepIndex('details') : at;
  const next = Math.max(0, Math.min(VIEW_LADDER.length - 1, cur + Math.sign(delta || 0)));
  if (next === cur) return false;
  const s = VIEW_LADDER[next];
  setView(s.view, s.size, { manual: true, anchorEl });
  return true;
}

/** A View-menu / empty-area-flyout choice: 'xl' | 'large' | 'medium' (the
 * icons view at 256 / 96 / 48) or a fixed view's own name. */
function applyViewChoice(key) {
  const size = VIEW_NAMED_ICON_SIZES[key];
  if (size) setView('icons', size, { manual: true });
  else setView(key, null, { manual: true });
}

/** Where a view change leaves the listing: the anchor row and its offset
 * along the scroll axis (vertical, or horizontal in List). */
function captureScrollAnchor(listScroll, anchorEl) {
  const row = (anchorEl && anchorEl.closest && listScroll.contains(anchorEl) && anchorEl.closest('.fp-row[data-path]'))
    || firstVisibleRow(listScroll);
  if (!row) return null;
  const horiz = browserState.view === 'list';
  const lr = listScroll.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  return { path: row.dataset.path, horiz, offset: horiz ? rr.left - lr.left : rr.top - lr.top };
}

function restoreScrollAnchor(listScroll, anchor) {
  const row = findListRow(anchor.path);
  if (!row) return;
  const horiz = browserState.view === 'list';
  const lr = listScroll.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  if (horiz) {
    // Coming from a vertical view the old offset is a distance from the top:
    // keep it as a distance from the left, inside the pane.
    const offset = anchor.horiz ? anchor.offset : Math.min(Math.max(0, anchor.offset), Math.max(0, lr.width - rr.width));
    listScroll.scrollLeft += (rr.left - lr.left) - offset;
  } else {
    const offset = anchor.horiz ? Math.min(Math.max(0, anchor.offset), Math.max(0, lr.height - rr.height)) : anchor.offset;
    listScroll.scrollTop += (rr.top - lr.top) - offset;
  }
}

/** The first row at least partly inside the list's viewport — a binary
 * search over the rows' positions, which grow monotonically in DOM order in
 * every view (row-major down the page, or column-major across it in List). */
function firstVisibleRow(listScroll) {
  const rows = listScroll.querySelectorAll(':scope > .fp-row[data-path]');
  if (!rows.length) return null;
  const lr = listScroll.getBoundingClientRect();
  const horiz = browserState.view === 'list';
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const r = rows[mid].getBoundingClientRect();
    if (horiz ? r.right > lr.left : r.bottom > lr.top) hi = mid;
    else lo = mid + 1;
  }
  return rows[lo];
}

/** The rendered row for an absolute path (direct children of #list-scroll). */
function findListRow(path) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll || !path) return null;
  return listScroll.querySelector(`:scope > .fp-row[data-path="${CSS.escape(path)}"]`);
}

// ── Layout metrics: List / Small icons column width, List rows per column ──
let _colWidthCache = { entries: null, ext: null, mode: null, width: 0 };
let _measureCtx = null;

/** One List / Small icons column width for the whole listing (spec §3.2):
 * the widest display name (canvas measureText, once per listing), clamped to
 * 160–360, plus the icon, gap, padding and border of a cell. */
function listColumnWidth() {
  const c = _colWidthCache;
  if (c.entries === browserState.entries && c.ext === browserState.showExtensions && c.mode === browserState.mode) {
    return c.width;
  }
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim() || 'sans-serif';
  // The cell's name font (styles.css: 500 var(--t-body) — 13px).
  _measureCtx.font = `500 13px ${family}`;
  let widest = 0;
  for (const e of browserState.entries || []) {
    const w = _measureCtx.measureText(displayNameFor(e)).width;
    if (w > widest) widest = w;
  }
  const width = Math.ceil(Math.min(VIEW_COL_NAME_MAX, Math.max(VIEW_COL_NAME_MIN, widest))) + VIEW_COL_CHROME;
  _colWidthCache = { entries: browserState.entries, ext: browserState.showExtensions, mode: browserState.mode, width };
  return width;
}

/** List view: how many 22px rows fit the pane's height — set on every render
 * and on every resize of #list-scroll (initViewLayout). */
function syncListRows(listScroll) {
  const cs = getComputedStyle(listScroll);
  const inner = listScroll.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
  const rows = String(Math.max(1, Math.floor(inner / VIEW_LIST_ROW_PX)));
  if (listScroll.style.getPropertyValue('--list-rows') !== rows) listScroll.style.setProperty('--list-rows', rows);
}

/** Brings the layout variables that depend on the listing (List / Small
 * column width, List rows per column) up to date. */
function syncViewMetrics() {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  const v = browserState.view;
  if (v === 'list' || v === 'small') listScroll.style.setProperty('--list-col-w', `${listColumnWidth()}px`);
  if (v === 'list') syncListRows(listScroll);
}

/** Keeps List's rows-per-column in step with the pane's height (a window
 * resize, app zoom, the inspector opening, the horizontal scrollbar
 * appearing). */
function initViewLayout() {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll || typeof ResizeObserver !== 'function') return;
  new ResizeObserver(() => { if (browserState.view === 'list') syncListRows(listScroll); }).observe(listScroll);
  applyViewDom();
}

// ── Per-folder view memory ────────────────────────────────────────────────
let _folderViewsSaveTimer = 0;

/** The remembered {view, size} for `path`, or null. */
function folderViewFor(path) {
  const map = (window.__fpConfig || {})[FOLDER_VIEWS_KEY];
  if (!path || !map || typeof map !== 'object') return null;
  const rec = map[fpNormalizePath(path)];
  return rec && VIEW_NAMES.includes(rec.view) ? normalizeView(rec.view, rec.size) : null;
}

/** A manual view choice belongs to this tab and to this folder. The folder
 * map keeps the 500 most recently set paths and is saved once a Ctrl+wheel
 * run has stopped (the in-memory config changes at once). */
function rememberViewChoice() {
  const tab = typeof activeTab === 'function' ? activeTab() : null;
  if (tab) { tab.view = browserState.view; tab.iconSize = browserState.iconSize; }
  if (browserState.mode === 'search' || !browserState.path) return;
  const cfg = window.__fpConfig || (window.__fpConfig = {});
  const prev = (cfg[FOLDER_VIEWS_KEY] && typeof cfg[FOLDER_VIEWS_KEY] === 'object') ? cfg[FOLDER_VIEWS_KEY] : {};
  const next = { ...prev };
  next[fpNormalizePath(browserState.path)] = {
    view: browserState.view,
    size: browserState.view === 'icons' ? browserState.iconSize : null,
    t: Date.now(),
  };
  const keys = Object.keys(next);
  if (keys.length > FOLDER_VIEWS_MAX) {
    keys.sort((a, b) => (next[a].t || 0) - (next[b].t || 0))
      .slice(0, keys.length - FOLDER_VIEWS_MAX)
      .forEach(k => { delete next[k]; });
  }
  cfg[FOLDER_VIEWS_KEY] = next;
  clearTimeout(_folderViewsSaveTimer);
  _folderViewsSaveTimer = setTimeout(() => {
    const latest = (window.__fpConfig || {})[FOLDER_VIEWS_KEY];
    if (latest) saveSetting(FOLDER_VIEWS_KEY, latest);
  }, 250);
}

/**
 * The view a freshly-loaded folder opens in (spec §3.1): what the user last
 * picked for it; else, unless ui.dynamic_media_view is off, Large icons for a
 * folder whose entries are more than half pictures/videos; else the default
 * (Details, or what an older version's global view setting migrated to).
 */
function decideView(path, entries) {
  const remembered = folderViewFor(path);
  if (remembered) return remembered;
  const cfg = window.__fpConfig || {};
  if (cfg['ui.dynamic_media_view'] !== false) {
    const shown = (entries || []).filter(e => !e.is_hidden);
    const media = shown.filter(e => !e.is_dir && typeof fpIsMedia === 'function' && fpIsMedia(e.ext)).length;
    if (shown.length && media / shown.length > 0.5) return { view: 'icons', size: VIEW_NAMED_ICON_SIZES.large };
  }
  const def = cfg['ui.view_default'];
  if (def && typeof def === 'object' && VIEW_NAMES.includes(def.view)) return normalizeView(def.view, def.size);
  return { view: 'details', size: null };
}

/**
 * One-time move from the old global view settings (ui.view_mode +
 * ui.list_scale, Stage 2C) to the ladder (spec §3.1): grid at scale s → icons
 * at the ladder size nearest 96·s, list → list, details → details. The
 * result is the default for folders with no memory of their own
 * (ui.view_default); Details needs no entry. Guarded by ui.view_migrated_2d.
 */
function migrateViewSettings(cfg) {
  if (!cfg || cfg['ui.view_migrated_2d']) return;
  const old = cfg['ui.view_mode'];
  let def = null;
  if (old === 'grid') {
    const scale = Number(cfg['ui.list_scale']) || 1;
    def = { view: 'icons', size: snapIconSize(Math.min(256, Math.max(48, 96 * scale))) };
  } else if (old === 'list') {
    def = { view: 'list', size: null };
  }
  if (def) saveSetting('ui.view_default', def);
  saveSetting('ui.view_migrated_2d', true);
  if ('ui.view_mode' in cfg) deleteSetting('ui.view_mode');
  if ('ui.list_scale' in cfg) deleteSetting('ui.list_scale');
}

// ── Column sort cycling (A.3.1 / Task 3) ────────────────────────────────────
// A list always has an active sort — there is no "inactive" third state.
// Clicking a column cycles asc → desc → asc; clicking a different column
// starts it at asc. The active column always carries `active` plus exactly
// one of `asc`/`desc`, which the caret CSS rotates on.
function initColumnSort() {
  updateSortHeaderUI();
  document.querySelectorAll('.fp-sortable[data-sort]').forEach(col => {
    col.style.cursor = 'pointer';
    col.addEventListener('click', () => {
      const key = col.dataset.sort;
      const dir = (browserState.sort.key === key && browserState.sort.dir === 'asc') ? 'desc' : 'asc';
      applySort(key, dir);
    });
  });
}

/** Which timestamp the Details date column shows: the one the sort is on when
 * it is a date sort ('created' | 'accessed'), otherwise 'modified'. The
 * Content view (Task 5) uses the same field for its date line. */
function dateFieldForSort() {
  const key = browserState.sort.key;
  return (key === 'created' || key === 'accessed') ? key : 'modified';
}

/** Syncs the `.fp-sortable` header classes to browserState.sort, and points
 * the date column at the field the sort is on (header label + its sort key). */
function updateSortHeaderUI() {
  const field = dateFieldForSort();
  const dateCol = document.querySelector('#list-head [data-col="date"]');
  if (dateCol) {
    dateCol.dataset.sort = field;
    const label = dateCol.querySelector('.list-col__label');
    if (label) label.textContent = `Date ${field}`;
  }
  document.querySelectorAll('.fp-sortable[data-sort]').forEach(col => {
    const isActive = col.dataset.sort === browserState.sort.key;
    col.classList.toggle('active', isActive);
    col.classList.toggle('asc', isActive && browserState.sort.dir === 'asc');
    col.classList.toggle('desc', isActive && browserState.sort.dir === 'desc');
  });
}

/** Sets the active sort, persists it (ui.sort — replaces the old
 * sessionStorage['fp-sort']), and re-renders the current directory. The
 * re-render keeps the selection (applySelectionState) and scrolls the focused
 * row back into view, since a new order moves it. */
function applySort(key, dir) {
  browserState.sort = { key, dir };
  saveSetting('ui.sort', browserState.sort);
  updateSortHeaderUI();
  renderDirectory();
  // Re-rendering dropped DOM focus (the sort menu / header held it): give it to
  // the focused row (or the list) so arrow keys keep working right after a sort.
  const focusedRow = browserState.focus ? findRowByPath(browserState.focus) : null;
  if (focusedRow) {
    focusedRow.focus({ preventScroll: true });
    focusedRow.scrollIntoView({ block: 'nearest' });
  } else {
    focusListContainer();
  }
}

/**
 * Returns browserState.entries sorted for display: folders always precede
 * files (regardless of direction), then each group is ordered by the active
 * sort key — name (natural, case-insensitive), size, a date field (modified /
 * created / accessed — numeric, entries without the field last in BOTH
 * directions), or type (file-type family, filetypes.js's fpFamilyFor, then
 * name).
 */
function sortedEntries() {
  const { key, dir } = browserState.sort;
  const sign = dir === 'desc' ? -1 : 1;
  const isDate = key === 'modified' || key === 'created' || key === 'accessed';
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return [...browserState.entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let cmp;
    if (isDate) {
      // An access-denied entry (error set) carries dates of 0.0 — treat it as
      // missing so it sorts last instead of first in an ascending date sort.
      const av = a.error ? null : a[key];
      const bv = b.error ? null : b[key];
      const aMissing = av == null, bMissing = bv == null;
      if (aMissing || bMissing) {
        if (aMissing && bMissing) return byName(a, b);
        return aMissing ? 1 : -1;   // unaffected by direction
      }
      cmp = av - bv;
    }
    else if (key === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
    else if (key === 'type') cmp = fpFamilyFor(a.ext).localeCompare(fpFamilyFor(b.ext)) || byName(a, b);
    else cmp = byName(a, b);
    return cmp * sign;
  });
}

// ── Marquee selection (A.3.1 / Task 3) ───────────────────────────────────────
function initMarqueeSelection() {
  const listScroll = document.getElementById('list-scroll');
  const marqueeRect = document.getElementById('marquee-rect');
  if (!listScroll || !marqueeRect) return;
  let dragging = false, startX = 0, startY = 0, ctrlDrag = false;
  // #marquee-rect is position:absolute, so its left/top are measured from its
  // containing block (#screen-browser — .content/.list-pane are static), NOT
  // from the viewport. Pointer coordinates are viewport-space, so they have to
  // be translated into that box before they are written as styles: writing
  // clientX/clientY straight in painted the band a sidebar-width right and a
  // chrome-height down from the pointer, where .content's overflow:hidden
  // usually clipped it away entirely (pass 2 #48). Hit-testing below stays in
  // viewport space, which is where getBoundingClientRect() already answers.
  let originX = 0, originY = 0;
  const captureMarqueeOrigin = () => {
    // offsetParent is null while the element is display:none, so this is only
    // ever called once the band has been shown.
    const host = marqueeRect.offsetParent || document.getElementById('screen-browser');
    const r = host && host.getBoundingClientRect ? host.getBoundingClientRect() : null;
    originX = r ? r.left : 0;
    originY = r ? r.top : 0;
  };

  listScroll.addEventListener('mousedown', e => {
    if (e.target.closest('.fp-row, .fp-row__icon, .fp-row__name')) return;
    if (e.button !== 0) return;
    dragging = true;
    ctrlDrag = e.ctrlKey;
    startX = e.clientX; startY = e.clientY;
    marqueeRect.style.display = 'block';
    captureMarqueeOrigin();
    marqueeRect.style.left = (startX - originX) + 'px';
    marqueeRect.style.top  = (startY - originY) + 'px';
    marqueeRect.style.width = '0px';
    marqueeRect.style.height = '0px';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    marqueeRect.style.left   = (x - originX) + 'px';
    marqueeRect.style.top    = (y - originY) + 'px';
    marqueeRect.style.width  = w + 'px';
    marqueeRect.style.height = h + 'px';
    // Highlight intersecting rows — Ctrl+drag also keeps the pre-existing
    // selection highlighted even where it doesn't intersect the marquee.
    const mr = { left: x, right: x + w, top: y, bottom: y + h };
    listScroll.querySelectorAll('.fp-row[data-path]').forEach(row => {
      const rr = row.getBoundingClientRect();
      const hit = rr.left < mr.right && rr.right > mr.left &&
                  rr.top  < mr.bottom && rr.bottom > mr.top;
      const keep = ctrlDrag && browserState.selection.has(row.dataset.path);
      row.classList.toggle('fp-row--selected', hit || keep);
    });
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    marqueeRect.style.display = 'none';
    // A plain click on the empty background (mousedown+mouseup with no drag
    // distance) never fires mousemove, so the rows still carry whatever
    // `.fp-row--selected` classes they had BEFORE this click — reading them
    // back here would silently re-adopt the old selection instead of
    // clearing it. Treat a near-zero-size marquee as a plain click.
    const w = parseFloat(marqueeRect.style.width) || 0;
    const h = parseFloat(marqueeRect.style.height) || 0;
    if (w < 2 && h < 2 && !ctrlDrag) {
      clearSelection();
      return;
    }
    const paths = [...listScroll.querySelectorAll('.fp-row--selected')]
      .map(r => r.dataset.path)
      .filter(Boolean);
    browserState.selection = new Set(paths);
    if (paths.length) {
      browserState.anchor = paths[0];
      browserState.focus  = paths[paths.length - 1];
    } else {
      browserState.anchor = null;
      browserState.focus  = null;
    }
    applySelectionState();
    focusListContainer();
    onSelectionChanged();
  });
}


// ── File list loading ─────────────────────────────────────────────────────────

// Row and tile icons all come from iconFor()/fpThumbBox() in icons.js — the
// old ICON_* constants and the two hard-coded extension sets they switched on
// are gone (Stage 2C Task 6): the family split now lives in
// backend/filetypes.py, mirrored into frontend/src/filetypes.js, and each
// family has its own fp-ft-<family> sprite symbol.

function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

// Module-level formatters and a once-per-second "now": renderDirectory calls
// formatModified once per entry with no virtualisation (up to LISTING_CAP =
// 10,000 rows), and building an Intl.DateTimeFormat plus two Date objects and
// two toDateString() calls per row cost ~34 µs each — a third of a second per
// render of a large folder, paid again on every sort/view/extension toggle
// (pass 2 #37). Locale is the user's default ([]), as before.
const _FMT_TIME = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const _FMT_WEEKDAY = new Intl.DateTimeFormat([], { weekday: 'short' });
const _FMT_DATE = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', year: 'numeric' });
let _nowCache = { at: 0, now: null };
function _nowForFormat() {
  const t = Date.now();
  if (!_nowCache.now || t - _nowCache.at > 1000) _nowCache = { at: t, now: new Date(t) };
  return _nowCache.now;
}
function formatDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  const now = _nowForFormat();
  const diff = now - d;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return _FMT_TIME.format(d);
  if (diff < 86400000 * 2) return 'Yesterday';
  if (diff < 86400000 * 7) return _FMT_WEEKDAY.format(d);
  return _FMT_DATE.format(d);
}
/** Older name for formatDate(); kept so home/inspector callers read the same. */
function formatModified(ts) { return formatDate(ts); }

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Joins a parent directory path and a child name into an absolute path. */
function joinPath(parentPath, name) {
  return parentPath.replace(/[\\\/]+$/, '') + '\\' + name;
}

/**
 * The absolute path of one browserState.entries item.
 *
 * A /fs/list entry carries only its own `name` and belongs to
 * browserState.path; a search result (Task 14) carries a full `path` of its
 * own and can live anywhere on disk. Every place that used to join
 * browserState.path onto a name goes through this instead, so the selection
 * model, entry lookup and keyboard navigation all work unchanged in both
 * modes.
 */
function entryPath(entry) {
  if (!entry) return null;
  if (entry.path) return entry.path;
  return browserState.path ? joinPath(browserState.path, entry.name) : entry.name;
}

/** Returns the parent folder of an absolute path (string-only; no filesystem
 * lookup) — used by "Open in new tab" on a file row, which may belong to a
 * directory that isn't the currently loaded one (e.g. a Home/Recent row). */
function parentOfPath(p) {
  const norm = String(p || '').replace(/[\\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'));
  if (idx <= 0) return norm;
  const parent = norm.slice(0, idx);
  // A file sitting directly in a drive root has "C:" as its parent — which is
  // not a folder (Windows reads a bare drive spec as "the current directory on
  // C:"), and renders as ":C" in the RTL-trimmed location subline. Keep the
  // separator: "C:\" is both the real root and an unambiguously LTR string
  // (pass 2 #166).
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

/**
 * Loads `absPath` (null = the sandbox root) into the Browser listing.
 *
 * opts.restore (Stage 2C Task 7) — {scrollTop, scrollLeft, selection, view, iconSize}
 * from a tab record being reactivated: applied with the render (selection
 * only for paths present in the listing). Mutually exclusive with
 * opts.preserveSelection — activateTab()/switchScreen() are the restore
 * callers and they always pass addToHistory:false too.
 *
 * opts.cached (Stage 2D §4.2, stale-while-revalidate) — the tab's last
 * listing {path, entries, parent, isRoot, truncated, fetchedAt}. Painted
 * synchronously (rows, scroll, selection — no empty frame on a tab switch),
 * then re-fetched; a changed answer is patched in (patchDirectory), an
 * unchanged one touches nothing.
 *
 * opts.historyIndex — Back/Forward: the nav.history slot being visited. It
 * becomes nav.index only once the fetch succeeds.
 *
 * One render per navigation (§4.2): the view and size are decided BEFORE
 * the single renderDirectory(). Navigation state — browserState.path, the
 * tab's label, the breadcrumb, the sidebar highlight and history — commits
 * only after a successful fetch (pass-2 #55): a failed navigation leaves the
 * folder on screen and says why in an error toast.
 *
 * reqTabId/reqSeq (fix round 1) guard against the fetch resolving after this
 * call has been superseded — either by a tab switch (tabs.activeId no longer
 * reqTabId) or by a newer navigation in the same tab (browserState._loadSeq
 * moved on). A late answer for a tab that is no longer active may refresh
 * that tab's cached listing, and never touches the DOM.
 */
async function loadDirectory(absPath, opts = {}) {
  const { addToHistory = true, preserveSelection = false, restore = null, cached = null, historyIndex = null } = opts;
  const reqTabId = tabs.activeId;
  const reqSeq = ++browserState._loadSeq;
  const superseded = () => tabs.activeId !== reqTabId || browserState._loadSeq !== reqSeq;
  // Any real navigation ends a search — opening a result folder, Back, a
  // sidebar click, a spring-loaded drop, the breadcrumb's ×. This tab's OWN
  // search is only stopped here (no in-flight run may paint over the
  // folder) and left on screen: commitListing() tears it down once the
  // folder has really loaded, so a navigation that fails keeps the results
  // (pass-2 #55). A search left over from another tab goes at once.
  const ownSearch = browserState.mode === 'search' && browserState.searchTabId === reqTabId;
  const searchWasInFlight = ownSearch && typeof searchState !== 'undefined' && !!(searchState && searchState.inflight);
  if (ownSearch) {
    if (typeof abortSearch === 'function') abortSearch();
    if (typeof searchState !== 'undefined' && searchState) searchState._seq++;
  } else {
    leaveSearchMode();
  }
  browserState.lastAttemptedPath = absPath;

  const cachedListing = (cached && Array.isArray(cached.entries) && cached.path) ? cached : null;
  if (cachedListing) {
    commitListing({
      path: cachedListing.path,
      entries: cachedListing.entries,
      parent: cachedListing.parent ?? null,
      is_root: !!cachedListing.isRoot,
      truncated: !!cachedListing.truncated,
    }, { absPath, addToHistory, restore, historyIndex, fetchedAt: cachedListing.fetchedAt || 0 });
  }

  let data;
  window.__fpLoadPending++;
  try {
    data = absPath
      ? await API.get('/fs/list', { path: absPath, show_hidden: browserState.showHidden })
      : await API.get('/fs/list/root', { show_hidden: browserState.showHidden });
  } catch (err) {
    if (superseded()) return;
    // The Back/Forward (or exit from search) this was went nowhere: the next
    // press starts again from what is on screen.
    browserState._pendingHistory = null;
    browserState._pendingExit = null;
    if (cachedListing) {
      // The tab's own listing is on screen already: keep it and say why it
      // could not be brought up to date.
      showToast(loadErrorMessage(err, absPath), 'error');
      return;
    }
    failNavigation(err, absPath, { reqTabId, ownSearch, searchWasInFlight });
    return;
  } finally {
    window.__fpLoadPending--;
  }

  if (superseded()) {
    if (tabs.activeId !== reqTabId) storeBackgroundListing(reqTabId, data);
    return;
  }
  if (cachedListing && data.path === browserState.path) {
    browserState.parent = data.parent;
    browserState.isRoot = data.is_root;
    patchDirectory(data.entries, data);
    rememberTabListing();
    return;
  }
  commitListing(data, { absPath, addToHistory, restore, preserveSelection, historyIndex });
}

/** The tab-record form of a listing (Stage 2D §4.2) — `entries` by
 * reference, never copied: every writer replaces browserState.entries with a
 * new array rather than mutating it. */
function listingRecordFrom(data, fetchedAt = Date.now()) {
  return {
    path: data.path,
    entries: data.entries,
    parent: data.parent ?? null,
    isRoot: !!(data.is_root ?? data.isRoot),
    truncated: !!data.truncated,
    fetchedAt,
  };
}

/** Points the active tab's cached listing at what browserState now holds. */
function rememberTabListing() {
  const tab = activeTab();
  if (!tab || browserState.mode === 'search' || !browserState.path) return;
  if (browserState.listingTabId !== tab.id) return;
  tab.listing = listingRecordFrom({
    path: browserState.path, entries: browserState.entries, parent: browserState.parent,
    is_root: browserState.isRoot, truncated: browserState.truncated,
  }, browserState.fetchedAt || Date.now());
}

/** A fetch that landed after its tab stopped being the active one: it may
 * refresh that tab's cached listing (the folder it is still showing), and
 * never touches the DOM. */
function storeBackgroundListing(tabId, data) {
  const t = typeof tabRecordFor === 'function' ? tabRecordFor(tabId) : null;
  if (!t || t.screen !== 'browser' || t.search || t.path !== data.path) return;
  t.listing = listingRecordFrom(data);
}

/**
 * Makes `data` the Browser listing: browserState, the tab record, the chrome
 * (tab label, sidebar, breadcrumb, address bar, history) and ONE render, with
 * the view decided before it.
 */
function commitListing(data, { absPath, addToHistory = true, restore = null, preserveSelection = false, historyIndex = null, fetchedAt = Date.now() } = {}) {
  const prevSelection = preserveSelection ? new Set(browserState.selection) : null;
  const prevAnchor    = preserveSelection ? browserState.anchor : null;
  const prevFocus     = preserveSelection ? browserState.focus : null;

  // The navigation succeeded: only now does a search on screen end, and only
  // now does a tab that was on Home (or any other screen) show the Browser —
  // the screen, the chrome and the rows change in the same task, so the
  // Browser never shows rows it held from before (Stage 2D fix round 1).
  leaveSearchMode();
  if (!browserScreenActive()) showScreenDom('browser');

  browserState.path = data.path;
  browserState.entries = data.entries;
  browserState.parent = data.parent;
  browserState.isRoot = data.is_root;
  browserState.truncated = !!data.truncated;
  browserState.fetchedAt = fetchedAt;
  browserState.listingTabId = tabs.activeId;
  browserState.listingStale = false;
  browserState._pendingHistory = null;
  browserState._pendingExit = null;
  browserState._orderDirty = false;

  // View first, so the one render below paints rows at their final size. A
  // tab-switch restore reapplies whatever that tab last showed (tabs keep
  // their own view state); every real navigation decides fresh from the
  // folder's own memory, its media share, or the default (decideView).
  const decided = (restore && restore.view)
    ? normalizeView(restore.view, restore.iconSize)
    : (browserState.mode !== 'search' ? decideView(data.path, data.entries) : null);
  if (decided) setView(decided.view, decided.size, { render: false });

  // Keep the active tab's own record continuously pointed at the real
  // (resolved) path — this is what lets switchScreen() tell "this tab has
  // never loaded a folder" (path still null, createTab()'s default) apart
  // from "this tab is sitting at the sandbox root" (a real resolved path).
  const tab = activeTab();
  if (tab) {
    tab.path = data.path;
    tab.screen = 'browser';
    // Remember that this tab was opened AT the root entry point rather than at
    // a folder of that name: the resolved path is a real directory, so without
    // this the "This PC" label would be recomputed as its basename the first
    // time the tab is re-activated or duplicated (pass 2 #16).
    tab.isRootTarget = !absPath;
    tab.listing = listingRecordFrom(data, fetchedAt);
    tab.stale = false;
  }
  // Tab label/icon, sidebar highlight and breadcrumb — only now that the
  // folder is known to exist (pass-2 #55).
  onNavigated(absPath);
  // onNavigated(null) (the sandbox-root request) can't build breadcrumb
  // crumbs from nothing — the real path is known now.
  if (!absPath) updateBreadcrumb(data.path);

  const validPaths = new Set(data.entries.map(e => joinPath(data.path, e.name)));
  if (restore) {
    const restoredSelection = (restore.selection || []).filter(p => validPaths.has(p));
    browserState.selection = new Set(restoredSelection);
    browserState.anchor = restoredSelection.length ? restoredSelection[0] : null;
    browserState.focus  = restoredSelection.length ? restoredSelection[restoredSelection.length - 1] : null;
  } else if (preserveSelection && prevSelection) {
    // Keep only paths that still exist in the refreshed listing.
    browserState.selection = new Set([...prevSelection].filter(p => validPaths.has(p)));
    browserState.anchor = prevAnchor && validPaths.has(prevAnchor) ? prevAnchor : null;
    browserState.focus  = prevFocus && validPaths.has(prevFocus) ? prevFocus : null;
  } else {
    browserState.selection = new Set();
    browserState.anchor = null;
    browserState.focus = null;
  }

  renderDirectory(data);
  if (historyIndex !== null && historyIndex >= 0 && historyIndex < nav.history.length) {
    nav.index = historyIndex;
    refreshNavButtons();
  } else if (addToHistory) pushHistory(data.path);
  else refreshNavButtons();
  updateAddressBar(data.path);
  onSelectionChanged();

  const listScroll = document.getElementById('list-scroll');
  if (listScroll) {
    listScroll.scrollTop = restore ? (restore.scrollTop || 0) : 0;
    listScroll.scrollLeft = restore ? (restore.scrollLeft || 0) : 0;
  }
}

/**
 * A navigation whose fetch failed. Nothing about it is committed (pass-2
 * #55), and the user keeps what they were looking at, with an error toast
 * saying why:
 * - a tab on another screen (Home, a sidebar link from Settings) stays there
 *   — openBrowserAt() no longer switches screens before the fetch lands;
 * - a tab showing its own search results keeps them (a run that was still in
 *   flight is restarted, since this navigation aborted it);
 * - a tab showing its own folder listing keeps it, chrome re-pointed at it.
 * Only a tab with nothing of its own to fall back on shows the error banner
 * (Go back / Retry) for the folder it tried to open.
 */
function failNavigation(err, absPath, { reqTabId, ownSearch = false, searchWasInFlight = false }) {
  const tab = activeTab();
  const message = loadErrorMessage(err, absPath);
  if (!browserScreenActive()) {
    // The Browser was never revealed (it appears only when a listing
    // commits): the user is still on the screen they started from, and the
    // tab's record says so again (switchScreen() set it to 'browser' early).
    const shown = document.querySelector('.screen.active')?.id?.replace(/^screen-/, '');
    if (tab && shown) tab.screen = shown;
    showToast(message, 'error');
    return;
  }
  if (tab && tab.screen !== 'browser') {
    showScreenDom(tab.screen);
    showToast(message, 'error');
    return;
  }
  if (ownSearch && browserState.mode === 'search') {
    if (searchWasInFlight && typeof runSearch === 'function') {
      runSearch({ pushHistory: false, preserveSelection: true });
    }
    refreshNavButtons();
    showToast(message, 'error');
    return;
  }
  const ownListingShown = browserState.path && browserState.listingTabId === reqTabId
    && document.querySelector('#list-scroll > .fp-row, #list-scroll > .fp-empty-state');
  if (ownListingShown) {
    onNavigated(tab && tab.isRootTarget ? null : browserState.path);
    if (tab && tab.isRootTarget) updateBreadcrumb(browserState.path);
    refreshNavButtons();
    showToast(message, 'error');
    return;
  }
  leaveSearchMode();
  onNavigated(absPath);
  handleLoadError(err, absPath);
}

/** One sentence for a failed /fs/list — the error toast's text. Names the
 * folder the way its tab would (tabLabelFor, app.js), not by its full path. */
function loadErrorMessage(err, absPath) {
  const where = typeof tabLabelFor === 'function' ? tabLabelFor(absPath) : (absPath || 'This PC');
  if (err instanceof ApiError) {
    if (err.status === 403) return `Access denied: ${where}`;
    if (err.status === 404) return `Folder not found: ${where}`;
    if (err.status === 400) return `Invalid path: ${where}`;
    return formatApiError(err);
  }
  return `Couldn't reach backend: ${formatApiError(err)}`;
}

/** Re-fetches the current directory and patches the difference into the
 * rendered listing (patchDirectory) — selection/anchor/focus (by path),
 * scroll position, view and size all stay. Shared by refreshAll() (Ctrl+R,
 * F5, the toolbar button, the empty-area menu's Refresh) and every file
 * operation that has to show its result. Returns a promise that resolves once
 * the patch has landed, so callers (fileops.run(), inline rename) can await it
 * before touching the DOM again. A failed fetch keeps the listing on screen
 * and shows an error toast; it never navigates away (Stage 2D §7.2).
 *
 * In search-results mode there is no folder to re-list: the same call re-runs
 * the current search instead (Task 14), which is what a file operation
 * performed on a result row needs so the vanished/renamed row disappears from
 * the results the same way it would from a folder listing. */
function refreshDirectory() {
  // Not every caller is on the Browser screen: Settings › Personalization's
  // "View hidden files" checkbox and the View menu both call this from a
  // screen of their own. Reloading from there would repaint a hidden
  // #list-scroll AND let onNavigated() turn the Settings tab into a folder tab
  // (label, icon, sidebar highlight and all), losing the Settings tab for
  // good. Mark the listing stale instead — switchScreen()'s reveal branch and
  // activateTab() both re-fetch before it is next seen (pass 2 #155).
  if (!browserScreenActive()) {
    browserState.listingStale = true;
    return Promise.resolve();
  }
  if (browserState.mode === 'search') {
    const searchList = document.getElementById('list-scroll');
    // renderSearchResults() scrolls a fresh result set to the top; a re-run of
    // the SAME search (F5, or the refresh every fileops.run() ends with) is not
    // a fresh set, and dropping the viewport left the row the user just acted
    // on hundreds of rows off-screen while staying selected (pass 2 #94).
    // Same reqTabId guard the browse branch below carries.
    const searchScrollTop = searchList ? searchList.scrollTop : 0;
    const searchTabId = tabs.activeId;
    const rerun = typeof runSearch === 'function'
      ? Promise.resolve(runSearch({ pushHistory: false, preserveSelection: true }))
      : Promise.resolve();
    return rerun.finally(() => {
      if (searchList && tabs.activeId === searchTabId && browserState.mode === 'search') {
        searchList.scrollTop = searchScrollTop;
      }
    });
  }
  if (!browserState.path || !browserHasOwnListing()) return Promise.resolve();
  const path = browserState.path;
  // #list-scroll is DOM shared by every tab: a refresh that lands after a tab
  // switch or a newer navigation must not patch somebody else's listing
  // (pass 2 #20) — the same reqTabId/reqSeq guard loadDirectory() carries.
  const reqTabId = tabs.activeId;
  const reqSeq = ++browserState._loadSeq;
  window.__fpLoadPending++;
  return API.get('/fs/list', { path, show_hidden: browserState.showHidden }).then(data => {
    if (tabs.activeId !== reqTabId || browserState._loadSeq !== reqSeq) {
      if (tabs.activeId !== reqTabId) storeBackgroundListing(reqTabId, data);
      return;
    }
    browserState.parent = data.parent;
    browserState.isRoot = data.is_root;
    browserState.listingStale = false;
    patchDirectory(data.entries, data);
    rememberTabListing();
  }, err => {
    if (tabs.activeId !== reqTabId || browserState._loadSeq !== reqSeq) return;
    showToast(loadErrorMessage(err, path), 'error');
  }).finally(() => { window.__fpLoadPending--; });
}

/** What a row shows, as one comparable string — patchDirectory() replaces a
 * row only when this changes. */
function rowSignature(e) {
  return [e.name, e.is_dir ? 1 : 0, e.size ?? '', e.modified ?? '', e.created ?? '', e.accessed ?? '',
    e.is_hidden ? 1 : 0, e.error || '', e.ext || ''].join('\u0001');
}

// Above this share of changed rows, one full render is cheaper (and no less
// stable) than row surgery (Stage 2D §7.2).
const PATCH_FULL_RENDER_SHARE = 0.3;

/**
 * Brings the rendered listing in line with `newEntries` (Stage 2D §7.2): the
 * listing is diffed against the rendered one by name, and only added, removed
 * or changed rows are inserted, removed or replaced, in sorted position.
 * Unchanged rows keep their DOM nodes (their icons never repaint). When more
 * than 30% of the rows changed it does one full render instead. Either way
 * scrollTop, the selection (by path — gone paths drop out), the anchor and
 * DOM focus on the focused row are kept. `data` (the /fs/list payload)
 * carries `truncated`.
 */
function patchDirectory(newEntries, data = null) {
  const listScroll = document.getElementById('list-scroll');
  const oldEntries = browserState.entries || [];
  const truncatedBefore = browserState.truncated;
  if (data) browserState.truncated = !!data.truncated;
  browserState.entries = newEntries;
  browserState.fetchedAt = Date.now();

  const valid = new Set(newEntries.map(entryPath));
  browserState.selection = new Set([...browserState.selection].filter(p => valid.has(p)));
  if (browserState.anchor && !valid.has(browserState.anchor)) browserState.anchor = null;
  if (browserState.focus && !valid.has(browserState.focus)) browserState.focus = null;
  if (!listScroll) return;

  const scrollTop = listScroll.scrollTop;
  const scrollLeft = listScroll.scrollLeft;
  const active = document.activeElement;
  // DOM focus is put back only when it sat on a row itself. Focus inside a
  // row (the inline-rename input) is never taken: blurring that input
  // commits the rename (Stage 2D fix round 1).
  const focusOnRow = !!(active && active !== listScroll && listScroll.contains(active)
    && active.classList.contains('fp-row'));
  // A row being renamed keeps its DOM node (and the input in it) as long as
  // the entry still exists, whatever else changed.
  const renaming = listScroll.querySelector('.fp-row__rename')?.closest('.fp-row[data-path]') || null;
  const renamingPath = renaming ? renaming.dataset.path : null;

  const rows = [...listScroll.querySelectorAll(':scope > .fp-row[data-path]')];
  const nodeByPath = new Map(rows.map(r => [r.dataset.path, r]));
  const oldByName = new Map(oldEntries.map(e => [e.name, e]));
  const newNames = new Set(newEntries.map(e => e.name));
  const changed = new Set();
  for (const e of newEntries) {
    if (renamingPath && entryPath(e) === renamingPath) continue;
    const o = oldByName.get(e.name);
    if (!o || rowSignature(o) !== rowSignature(e)) { changed.add(e.name); continue; }
    // A favourite toggled since the row was drawn changes its star.
    const p = entryPath(e);
    const node = nodeByPath.get(p);
    const starred = typeof favoritesHas === 'function' && favoritesHas(p);
    if (node && starred !== !!node.querySelector('.fp-row__star')) changed.add(e.name);
  }
  const removed = oldEntries.filter(o => !newNames.has(o.name));
  const changes = changed.size + removed.length;
  const total = Math.max(oldEntries.length, newEntries.length);
  const domMatches = rows.length === oldEntries.length && oldEntries.length > 0;

  // _orderDirty: an earlier patch left a renaming row out of sorted place;
  // the row-by-row pass below puts it back once the rename has settled.
  const orderDirty = !!browserState._orderDirty && !renaming;
  if (changes === 0 && !orderDirty && domMatches && truncatedBefore === browserState.truncated) {
    applySelectionState();
    updateStatusBar();
  } else if (!domMatches || !newEntries.length || truncatedBefore !== browserState.truncated
             || (changes > total * PATCH_FULL_RENDER_SHARE && !(renamingPath && valid.has(renamingPath)))) {
    // (A full render would destroy an inline rename in progress; that one
    // case always takes the row-by-row path below instead.)
    browserState._orderDirty = false;
    renderDirectory();
  } else {
    for (const o of removed) nodeByPath.get(entryPath(o))?.remove();
    const tpl = document.createElement('template');
    // The row being renamed never moves, even if its sort key changed (a move
    // detaches it, and a detached rename input blurs — which commits). Rows
    // flow around it; it re-sorts with the refresh after the rename settles.
    const pinned = (renamingPath && valid.has(renamingPath)) ? renaming : null;
    let cursor = listScroll.querySelector(':scope > .fp-row[data-path]');
    const skipPinned = () => { while (cursor && cursor === pinned) cursor = cursor.nextElementSibling; };
    for (const e of sortedEntries()) {
      let node = nodeByPath.get(entryPath(e));
      if (node && node === pinned) continue;
      skipPinned();
      if (changed.has(e.name)) {
        tpl.innerHTML = renderFsRow(e, browserState.path);
        const fresh = tpl.content.firstElementChild;
        if (node) {
          if (cursor === node) cursor = node.nextElementSibling;
          node.remove();
        }
        node = fresh;
      }
      if (!node) continue;
      skipPinned();
      if (node === cursor) cursor = node.nextElementSibling;
      else listScroll.insertBefore(node, cursor);
    }
    browserState._orderDirty = !!pinned;
    applySelectionState();
    updateStatusBar();
  }
  // A new or renamed entry may be the widest name (List / Small icons).
  syncViewMetrics();
  listScroll.scrollTop = scrollTop;
  listScroll.scrollLeft = scrollLeft;
  if (focusOnRow) {
    const row = browserState.focus ? findRowByPath(browserState.focus) : null;
    if (row) row.focus({ preventScroll: true });
    else focusListContainer();
  }
  onSelectionChanged();
}

// Every load failure gets the same two recovery actions: "Go back" (real
// history navigation via navBack()) and "Retry" (re-attempt the exact same
// path that just failed, via browserState.lastAttemptedPath).
const LOAD_ERROR_ACTIONS = [
  { label: 'Go back', name: 'nav-back' },
  { label: 'Retry', name: 'nav-retry' },
];

function handleLoadError(err, absPath) {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      showErrorBanner(`Access denied: ${absPath}`, { actions: LOAD_ERROR_ACTIONS });
      return;
    }
    if (err.status === 404) {
      showErrorBanner('Folder not found', { actions: LOAD_ERROR_ACTIONS });
      return;
    }
    if (err.status === 400) {
      showErrorBanner('Invalid path', { actions: LOAD_ERROR_ACTIONS });
      return;
    }
    showErrorBanner(formatApiError(err), { actions: LOAD_ERROR_ACTIONS });
    return;
  }
  showErrorBanner(`Couldn't reach backend: ${formatApiError(err)}`, { actions: LOAD_ERROR_ACTIONS });
}

// Re-attempts the load that just failed — used by the error banner's "Retry"
// action. lastAttemptedPath is set by loadDirectory() before the fetch (even
// for the sandbox root, where it's null), so this always repeats the exact
// same request.
function retryLoad() {
  loadDirectory(browserState.lastAttemptedPath, { addToHistory: false });
}

function pushHistory(path) {
  // A navigation that lands on the folder already showing changes nothing —
  // decide that BEFORE the truncation below, or re-opening the current folder
  // (its Quick Access row, its own breadcrumb crumb) after a Back throws the
  // forward stack away for a navigation that went nowhere (pass 2 #17).
  if (nav.history[nav.index] === path) { refreshNavButtons(); return; }
  // If we navigated forward from a non-tail position, drop the forward
  // stack — truncate nav.history IN PLACE (never reassign it to a new
  // array) so it stays the same object activateTab() pointed the active
  // tab's own record.history at.
  if (nav.index < nav.history.length - 1) {
    nav.history.length = nav.index + 1;
  }
  nav.history.push(path);
  nav.index = nav.history.length - 1;
  refreshNavButtons();
}

/** True while this tab's search is on screen but a navigation out of it
 * (the × / Back / Up, or any other loadDirectory) is already in flight —
 * search mode only ends when that listing commits. A second Back/Forward/Up
 * then steps on from where the first is going instead of repeating it. */
function searchExitPending() {
  if (browserState.mode !== 'search') return false;
  // Either the exit itself, or a Back/Forward already stepping on from it
  // (a third press while the second is in flight steps on again). Both are
  // per tab: another tab's pending navigation says nothing about this one.
  return pendingNavFor(browserState._pendingExit) || pendingNavFor(browserState._pendingHistory);
}

/** A recorded in-flight navigation ({seq, tabId}) that is still the latest
 * load, and belongs to the active tab. */
function pendingNavFor(rec) {
  return !!(rec && rec.seq === browserState._loadSeq && rec.tabId === tabs.activeId);
}

function navBack() {
  // Same Explorer rule navUp() follows: the first Back out of a results
  // listing leaves the search and returns to the folder that was searched —
  // searching never pushed a history entry of its own, so without this Back
  // silently skips PAST the searched folder to the previous one (pass 2 #154).
  if (browserState.mode === 'search' && !searchExitPending()) return exitSearchResults();
  const from = pendingHistoryIndex();
  if (from <= 0) return undefined;
  return visitHistory(from - 1);
}

function navForward() {
  if (browserState.mode === 'search' && !searchExitPending()) return exitSearchResults();
  const from = pendingHistoryIndex();
  if (from >= nav.history.length - 1) return undefined;
  return visitHistory(from + 1);
}

/** Where Back/Forward step from: a still-in-flight Back/Forward's target, or
 * nav.index (which moves only once a fetch succeeds — pass-2 #55). */
function pendingHistoryIndex() {
  const ph = browserState._pendingHistory;
  return pendingNavFor(ph) ? ph.index : nav.index;
}

function visitHistory(index) {
  const p = loadDirectory(nav.history[index], { addToHistory: false, historyIndex: index });
  // loadDirectory() bumped _loadSeq synchronously, before its first await.
  browserState._pendingHistory = { seq: browserState._loadSeq, index, tabId: tabs.activeId };
  return p;
}

function navUp() {
  // Explorer's rule: Up out of a results listing goes back to the folder that
  // was searched, not to that folder's parent. This is the one path behind the
  // toolbar Up button, Alt+Up and Backspace (browserKeydown, when
  // ui.backspace_deletes is off), so all three agree by construction.
  if (browserState.mode === 'search' && !searchExitPending()) { exitSearchResults(); return; }
  if (browserState.isRoot || !browserState.parent) return;
  loadDirectory(browserState.parent);
}

/**
 * Is the Browser screen the one actually on display?
 *
 * The toolbar (nav group, breadcrumb, search bar) lives OUTSIDE `.screen`
 * (index.html) and Settings' own controls live on another screen entirely, so
 * both can reach browser.js while the user is looking at Home/Settings/any
 * stub screen. Acting on the listing from there paints into a hidden
 * #list-scroll and lets onNavigated() silently rewrite the active tab into a
 * folder tab (pass 2 #11 / #155) — every such entry point is gated on this.
 */
function browserScreenActive() {
  const el = document.getElementById('screen-browser');
  return !!(el && el.classList.contains('active'));
}

/**
 * Does #list-scroll hold the ACTIVE tab's own content — its committed folder
 * listing, or its own search results? False while a tab's first fetch is in
 * flight (clearBrowserListing): every shortcut that acts on the listing, and
 * refresh, is then a no-op rather than acting on another tab's rows.
 */
function browserHasOwnListing() {
  const id = typeof tabs !== 'undefined' ? tabs.activeId : null;
  return browserState.mode === 'search'
    ? browserState.searchTabId === id
    : (!!browserState.path && browserState.listingTabId === id);
}

/** Empties the Browser listing — DOM and state together — for a tab that has
 * nothing of its own to show yet. */
function clearBrowserListing() {
  leaveSearchMode();
  document.getElementById('list-scroll')?.replaceChildren();
  setListNotice('');
  browserState.path = null;
  browserState.entries = [];
  browserState.parent = null;
  browserState.isRoot = false;
  browserState.truncated = false;
  browserState.selection = new Set();
  browserState.anchor = null;
  browserState.focus = null;
  browserState.listingTabId = null;
  browserState._pendingHistory = null;
  browserState._pendingExit = null;
  browserState._orderDirty = false;
  updateStatusBar();
  onSelectionChanged();
}

function refreshNavButtons() {
  const back = document.querySelector('[data-action="nav-back"]');
  const fwd  = document.querySelector('[data-action="nav-forward"]');
  const up   = document.querySelector('[data-action="nav-up"]');
  // The toolbar is painted on every screen, so off the Browser screen the
  // whole nav group is dead rather than acting on a listing the user cannot
  // see (pass 2 #11/#12).
  const onBrowser = browserScreenActive();
  if (back) back.disabled = !onBrowser || nav.index <= 0;
  if (fwd)  fwd.disabled  = !onBrowser || nav.index >= nav.history.length - 1;
  // In search mode Up always has somewhere to go (back to the searched
  // folder), regardless of whether that folder has a parent of its own.
  if (up)   up.disabled   = !onBrowser || (browserState.mode !== 'search'
    && (!browserState.path || browserState.isRoot || !browserState.parent));
}

function renderDirectory(data) {
  window.__fpRenderCount++;
  if (data) browserState.truncated = !!data.truncated;
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  const isSearch = browserState.mode === 'search';
  // The 10,000-entry notice belongs to a /fs/list listing; a truncated search
  // says so in its own results header instead (renderSearchResults). It sits
  // above the listing, outside it, so it never takes a cell of a flowing
  // grid (List flows column by column — pass-2 #169).
  setListNotice((!isSearch && browserState.truncated) ? renderTruncatedBanner() : '');

  if (!browserState.entries || browserState.entries.length === 0) {
    listScroll.innerHTML = isSearch ? renderNoSearchResults() : renderEmptyFolder();
    updateStatusBar();
    return;
  }

  // Column width / rows per column first, so the rows land in their final
  // cells with the one innerHTML below.
  syncViewMetrics();
  listScroll.innerHTML = sortedEntries().map(entry => renderFsRow(entry, browserState.path)).join('');
  applySelectionState();
  updateStatusBar();
}

/** Fills (or, with '', hides) #list-notice — the strip above the listing. */
function setListNotice(html) {
  const el = document.getElementById('list-notice');
  if (!el) return;
  el.innerHTML = html;
  el.hidden = !html;
}

function renderTruncatedBanner() {
  return `<div class="fp-error-banner fp-error-banner--info" role="status">
    ${icon('info', 'fp-icon--14')}
    <span class="fp-body" style="color: var(--text-primary)">Showing the first 10,000 entries</span>
  </div>`;
}

/** Strips a file's extension for the show-extensions-off display name (the
 * on-disk name, path, sort key, etc. are always the untouched full name —
 * only this rendered label changes). Dotfiles with no real stem (".env")
 * and extension-less names are returned unchanged. */
function stemOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The label a row shows for `entry`: its name, minus the extension for a
 * file when ui.show_extensions is off. */
function displayNameFor(entry) {
  return (!entry.is_dir && browserState.showExtensions === false) ? stemOf(entry.name) : entry.name;
}

/** Leading visual for one entry, per view (spec §3.2, §4.4).
 *
 * Details, List and Small icons: a 16px icon (FilePlus mode shows a 16px
 * thumbnail for a picture; Explorer, and Windows mode, keep the type icon at
 * 16 — §4.4 ruling).
 *
 * Content (32), Tiles (48) and Icons (s): an s×s slot (.fp-tile__thumb,
 * sized by --icon-size) showing real content wherever the shell can produce
 * it — a thumbnail for pictures and videos in every folder, and in
 * 'fileplus' mode a large icon's folder fans up to two of its own pictures
 * over the folder (GET /fs/peek, requested only once the cell is on screen).
 * In 'windows' mode every slot asks the shell directly, folders included,
 * which is what Explorer shows. */
function renderFsIcon(entry) {
  const view = browserState.view;
  const source = fpIconSource();
  const isMedia = !entry.is_dir && typeof fpIsMedia === 'function' && fpIsMedia(entry.ext)
    && fpFamilyFor(entry.ext) !== 'svg'; // an SVG's own markup is its icon
  if (view === 'details' || view === 'list' || view === 'small') {
    return (isMedia && !entry.error && source === 'fileplus')
      ? fpThumbBox(entry, 16, 'fp-row__icon fp-row__icon--thumb')
      : iconFor(entry, 16, 'fp-row__icon');
  }
  const size = fpListIconSize();
  if (entry.error) return fpTileIcon(entry, size);
  if (source === 'windows') return fpThumbBox(entry, size, 'fp-tile__thumb');
  if (entry.is_dir) return view === 'icons' ? fpFolderPeekBox(entry, 'fp-tile__thumb') : fpTileIcon(entry, size);
  if (isMedia) return fpThumbBox(entry, size, 'fp-tile__thumb');
  return fpTileIcon(entry, size);
}

/** A short type description for Tiles / Content: "File folder", or the
 * extension's own name ("PNG File") — what Explorer shows when no richer
 * description is registered. */
function typeLabelFor(entry) {
  if (entry.is_dir) return 'File folder';
  const ext = String(entry.ext || '').replace(/^\./, '');
  return ext ? `${ext.toUpperCase()} File` : 'File';
}

function renderFsRow(entry, parentPath) {
  // A search result carries its own absolute path (it can live anywhere under
  // the searched root); a /fs/list entry is joined onto the open folder.
  const childPath = entry.path || joinPath(parentPath, entry.name);
  // iconFor()/fpThumbBox() key their shell requests off an absolute path, and
  // a /fs/list entry only carries its own name — join it on here rather than
  // making every icon call site re-derive it.
  const iconHtml = renderFsIcon({ ...entry, path: childPath });
  const view = browserState.view;
  const sizeText = (entry.is_dir || entry.error) ? '—' : formatSize(entry.size);
  // The date follows the sort: created / modified / accessed (a result that
  // lacks the field, e.g. an index-backed search hit's accessed, shows —).
  const dateField = dateFieldForSort();
  const dateValue = entry[dateField];
  const dateText = (entry.error || dateValue == null) ? '—' : formatDate(dateValue * 1000);
  const rowClass = `fp-row${entry.is_dir ? ' fp-row--folder' : ''}${entry.error ? ' fp-row--disabled' : ''}`;
  const titleAttr = entry.error ? ' title="Access denied"' : '';
  // ui.show_extensions === false hides the extension on FILE rows only —
  // folders never have one to hide. The full name is always the name's
  // tooltip: any view may ellipsize or clamp it (spec §3.2, §3.4).
  const displayName = displayNameFor(entry);
  const hideExt = displayName !== entry.name;
  const nameTitleAttr = ` title="${escapeHtml(entry.name)}"`;
  // Search mode: wrap the matched substrings in <mark>. entry.match's offsets
  // index the RAW name, so highlighting is skipped when show-extensions has
  // trimmed it — the spans would no longer line up with what is rendered.
  const isSearch = browserState.mode === 'search';
  const nameHtml = (isSearch && !hideExt)
    ? highlightMatch(displayName, entry.match)
    : escapeHtml(displayName);
  const location = isSearch ? (entry.location || parentOfPath(childPath)) : '';
  // favoritesHas is home.js's (loaded AFTER browser.js — see the module load
  // order in CLAUDE.md) — safe here because renderFsRow's body only ever
  // runs later, from a directory render, never at this file's own parse time.
  const starHtml = (typeof favoritesHas === 'function' && favoritesHas(childPath))
    ? `<span class="fp-row__star" title="In Favorites">${icon('star')}</span>`
    : '';
  const nameSpan = `<span class="fp-row__name"${nameTitleAttr}>${nameHtml}</span>`;

  let body;
  if (view === 'details') {
    // Search results hang the parent folder under the name as a "Location"
    // subline (Details only; the other views keep it in the name's tooltip).
    body = `${isSearch
      ? `<span class="fp-row__namecell">
          ${nameSpan}
          <span class="fp-row__location" title="${escapeHtml(location)}"><bdi>${escapeHtml(location)}</bdi></span>
        </span>`
      : nameSpan}
    ${starHtml}
    <span class="fp-row__size mono">${sizeText}</span>
    <span class="fp-row__modified mono">${dateText}</span>
    <div class="fp-row__tags"></div>`;
  } else if (view === 'content') {
    // Two lines: name | "Date <field>: …" over type (or, for a search
    // result, its folder) | "Size: …".
    const second = isSearch
      ? `<span class="fp-row__meta fp-row__meta--start" title="${escapeHtml(location)}"><bdi>${escapeHtml(location)}</bdi></span>`
      : `<span class="fp-row__meta fp-row__meta--start" title="${escapeHtml(typeLabelFor(entry))}">${escapeHtml(typeLabelFor(entry))}</span>`;
    const dateLabel = `Date ${dateField}:`;
    body = `<span class="fp-row__content">
      ${nameSpan}
      <span class="fp-row__meta" title="${escapeHtml(`${dateLabel} ${dateText}`)}"><span class="fp-row__meta-label">${dateLabel}</span> ${escapeHtml(dateText)}</span>
      ${second}
      ${(entry.is_dir || entry.error) ? '<span class="fp-row__meta"></span>'
        : `<span class="fp-row__meta" title="${escapeHtml(`Size: ${sizeText}`)}"><span class="fp-row__meta-label">Size:</span> ${escapeHtml(sizeText)}</span>`}
    </span>
    ${starHtml}`;
  } else if (view === 'tiles') {
    const type = typeLabelFor(entry);
    body = `<span class="fp-row__lines">
      ${nameSpan}
      <span class="fp-row__line" title="${escapeHtml(type)}">${escapeHtml(type)}</span>
      ${(entry.is_dir || entry.error) ? '' : `<span class="fp-row__line" title="${escapeHtml(sizeText)}">${escapeHtml(sizeText)}</span>`}
    </span>
    ${starHtml}`;
  } else {
    // List, Small icons, Icons: the icon and the name.
    body = `${nameSpan}${starHtml}`;
  }
  // No draggable="true": Stage 2C Task 12 replaced HTML5 drag and drop with a
  // pointer-event drag session (dragdrop.js). The native attribute would now
  // only get in the way — a native drag starting under our own pointermove
  // handler swallows the rest of the session.
  return `<div class="${rowClass}" role="option"
            data-path="${escapeHtml(childPath)}"
            data-type="${entry.is_dir ? 'folder' : 'file'}" tabindex="-1"${titleAttr}>
    ${iconHtml}
    ${body}
  </div>`;
}

function renderEmptyFolder() {
  return `<div class="fp-empty-state" role="status" aria-live="polite">
    ${icon('ft-folder-open', 'fp-icon--48 fp-empty-state__icon')}
    <h3 class="t-title-sm">This folder is empty</h3>
    <p class="t-body" style="color: var(--text-secondary)">Drop files here or right-click to create new ones.</p>
  </div>`;
}

// ── Search results listing (Task 14, design §8.2) ────────────────────────────
// Search renders INTO the Browser list, not into a popup: every result is a
// real .fp-row carrying its absolute path, so open / context menu / drag /
// favorites / properties / inspector all work on a result unchanged. search.js
// owns the query; everything below owns how the answer looks.

/** Wraps every `match` span in <mark>, escaping around and inside the spans.
 * `spans` index the RAW name, so the string is sliced first and each piece
 * escaped afterwards — escaping first would shift every offset. */
function highlightMatch(name, spans) {
  const raw = String(name == null ? '' : name);
  if (!Array.isArray(spans) || spans.length === 0) return escapeHtml(raw);
  let html = '';
  let cursor = 0;
  for (const span of spans) {
    if (!Array.isArray(span) || span.length < 2) continue;
    const start = Math.max(0, Math.min(raw.length, span[0] | 0));
    const end = Math.max(start, Math.min(raw.length, span[1] | 0));
    if (start < cursor) continue;   // overlapping/unsorted — the backend merges, but never trust it blindly
    html += escapeHtml(raw.slice(cursor, start));
    html += `<mark class="fp-row__mark">${escapeHtml(raw.slice(start, end))}</mark>`;
    cursor = end;
  }
  return html + escapeHtml(raw.slice(cursor));
}

function renderNoSearchResults() {
  return `<div class="fp-empty-state" role="status" aria-live="polite">
    ${icon('search', 'fp-icon--48 fp-empty-state__icon')}
    <h3 class="t-title-sm">No matches</h3>
    <p class="t-body" style="color: var(--text-secondary)">Try fewer filters, or search This PC instead of this folder.</p>
  </div>`;
}

/** The one writer of #list-search-header's text ("N results" / "Searching…"). */
function setSearchHeader(text) {
  const el = document.getElementById('list-search-header');
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<span class="list-search-header__count">${escapeHtml(text)}</span>`;
}

/** Appends a right-aligned note + action button to the results header — the
 * This PC scope's "N drives are not indexed — Index now" (design §8.1). */
function appendSearchHeaderHint(text, actionLabel, actionName) {
  const el = document.getElementById('list-search-header');
  if (!el || el.hidden) return;
  // The text and the button both carry ids: search.js's indexMissingDrives()
  // rewrites them in place to report progress, because the toasts it used to
  // rely on are gated off by default (pass 2 #87).
  el.insertAdjacentHTML('beforeend', `<span class="list-search-header__hint" id="list-search-header-hint">
      <span id="list-search-header-hint-text">${escapeHtml(text)}</span> —
      <button class="fp-btn fp-btn--ghost fp-btn--sm" id="list-search-header-hint-btn"
              data-action="${escapeHtml(actionName)}">${escapeHtml(actionLabel)}</button>
    </span>`);
}

/** Called by search.js the moment a request goes out: enter search mode (so
 * the breadcrumb and header already read "Search in …") and say we're walking.
 * Rows from a previous search stay on screen until the new ones land — only
 * the first search of a session clears the folder listing underneath. */
function showSearchPending(query, root) {
  const listScroll = document.getElementById('list-scroll');
  const entering = browserState.mode !== 'search';
  // A search firing (or re-firing while typing) supersedes any /fs/list still
  // in flight from loadDirectory() the same way a real navigation would —
  // otherwise a slow listing that resolves after the bar starts searching
  // would paint folder entries into the now-search-mode list.
  browserState._loadSeq++;
  browserState.mode = 'search';
  browserState.searchRoot = root;
  // #list-scroll no longer holds a folder listing (see listingTabId).
  browserState.listingTabId = null;
  browserState.searchTabId = tabs.activeId;
  if (listScroll) listScroll.dataset.mode = 'search';
  if (entering) {
    browserState.entries = [];
    browserState.selection = new Set();
    browserState.anchor = null;
    browserState.focus = null;
    if (listScroll) listScroll.innerHTML = '';
    setListNotice('');
  }
  updateSearchBreadcrumb(root);
  setSearchHeader('Searching…');
  refreshNavButtons();
}

/**
 * Paints a search payload as the Browser listing.
 *
 * `payload` is always in GET /fs/search's shape ({results, truncated, …}) —
 * search.js normalises the index route's rows into it first — and each result
 * gets a `location` (its parent folder) for the row's subline.
 *
 * `preserveSelection` (Task 8/finding 5 parity with loadDirectory's own
 * preserveSelection branch, browser.js ~456-461) keeps whichever result paths
 * are still present after a re-run — refreshDirectory()'s search-mode branch
 * passes this so an op on a result row (favorite toggle, attributes Apply,
 * rename) doesn't drop the selection and blank the inspector.
 */
function renderSearchResults(payload, { query = '', root = '', preserveSelection = false } = {}) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  const prevSelection = preserveSelection ? new Set(browserState.selection) : null;
  const prevAnchor = preserveSelection ? browserState.anchor : null;
  const prevFocus = preserveSelection ? browserState.focus : null;
  browserState.mode = 'search';
  browserState.searchRoot = root;
  browserState.listingTabId = null;
  browserState.searchTabId = tabs.activeId;
  browserState.truncated = false;
  browserState.entries = (payload.results || []).map(r => ({ ...r, location: parentOfPath(r.path) }));
  if (preserveSelection && prevSelection) {
    const validPaths = new Set(browserState.entries.map(e => e.path));
    browserState.selection = new Set([...prevSelection].filter(p => validPaths.has(p)));
    browserState.anchor = prevAnchor && validPaths.has(prevAnchor) ? prevAnchor : null;
    browserState.focus = prevFocus && validPaths.has(prevFocus) ? prevFocus : null;
  } else {
    browserState.selection = new Set();
    browserState.anchor = null;
    browserState.focus = null;
  }
  listScroll.dataset.mode = 'search';

  updateSearchBreadcrumb(root);
  renderDirectory();
  listScroll.scrollTop = 0;

  const n = browserState.entries.length;
  setSearchHeader(payload.truncated ? `First ${n} results — refine the search` : `${n} results`);
  onSelectionChanged();
  refreshNavButtons();
}

/** The breadcrumb in search mode: `Search in <folder>` plus a × that returns
 * to the folder the tab was showing (data-action="search-clear"). */
function updateSearchBreadcrumb(root) {
  const crumb = document.getElementById('breadcrumb');
  if (!crumb) return;
  const label = root === '*'
    ? 'This PC'
    : (pathBaseName(root) || String(root || '') || 'this folder');
  crumb.innerHTML = `<span class="fp-breadcrumb__search">
      ${icon('search', 'fp-icon--14')}
      <span>Search in ${escapeHtml(label)}</span>
    </span>
    <button class="fp-icon-btn fp-icon-btn--sm fp-breadcrumb__clear" data-action="search-clear"
            title="Clear search" aria-label="Clear search">${icon('close', 'fp-icon--10')}</button>`;
}

/**
 * Tears the search UI down WITHOUT reloading anything — called at the top of
 * every loadDirectory() so that navigating away from results (opening a
 * result folder, Back, a sidebar click, a spring-loaded drop) leaves search
 * mode exactly once, in one place. exitSearchResults() is this plus the
 * reload; splitting them is what keeps the two from recursing into each other.
 */
function leaveSearchMode() {
  if (browserState.mode !== 'search') return;
  browserState.mode = 'browse';
  browserState.searchRoot = null;
  // search.js loads after browser.js, so its exports only exist once the app
  // has booted — safe here because leaveSearchMode() is only ever called from
  // event handlers, long after every script has run. Abort the in-flight
  // request and bump the sequence runSearch()'s superseded() checks so a
  // response that lands after this navigation is ignored instead of
  // repainting stale search results over the folder we're navigating to.
  if (typeof abortSearch === 'function') abortSearch();
  if (typeof searchState !== 'undefined' && searchState) searchState._seq++;
  const listScroll = document.getElementById('list-scroll');
  if (listScroll) delete listScroll.dataset.mode;
  const header = document.getElementById('list-search-header');
  if (header) { header.hidden = true; header.innerHTML = ''; }
  const tab = typeof activeTab === 'function' ? activeTab() : null;
  if (tab) tab.search = null;
  if (typeof searchResetBar === 'function') searchResetBar();
}

/** Leaves search mode and re-lists the folder the active tab was showing —
 * the breadcrumb's × and search.js's clearSearch(). */
function exitSearchResults() {
  if (browserState.mode !== 'search') return undefined;
  const tab = typeof activeTab === 'function' ? activeTab() : null;
  const target = tab && tab.path !== undefined ? tab.path : browserState.path;
  // loadDirectory() ends this tab's search once the folder has loaded (and
  // keeps the results if it cannot be).
  const p = loadDirectory(target, { addToHistory: false });
  // loadDirectory() bumped _loadSeq synchronously, before its first await.
  browserState._pendingExit = { seq: browserState._loadSeq, tabId: tabs.activeId };
  return p;
}

function updateAddressBar(path) {
  const addressEl = document.getElementById('address-bar-text') || document.querySelector('.fp-address-bar__text');
  if (addressEl) addressEl.textContent = path;
}

function updateBreadcrumb(path) {
  const crumb = document.getElementById('breadcrumb');
  if (!crumb || !path) return;
  // Split on \ or /, drop empties. First part is drive letter (e.g. "C:") — keep with backslash for nav.
  const parts = String(path).split(/[\\\/]+/).filter(Boolean);
  let cumulative = '';
  const html = parts.map((part, i) => {
    cumulative = i === 0 ? part + '\\' : cumulative + part + '\\';
    const isLast = i === parts.length - 1;
    const cls = isLast ? 'fp-breadcrumb__crumb fp-breadcrumb__crumb--current' : 'fp-breadcrumb__crumb';
    // First crumb of a drive path shows the real drive label (Task 7) — the
    // button's own data-path stays the literal "D:\\" for navigation either way.
    const isDriveRoot = i === 0 && /^[A-Za-z]:$/.test(part);
    const label = isDriveRoot ? driveDisplayLabel(part) : part;
    // The drive crumb carries the drive's own icon — the real shell icon in
    // Windows-icon mode (Stage 2D §4.6).
    const iconHtml = isDriveRoot
      ? fpShellItemIcon({ path: cumulative, is_dir: true }, 16, 'drive', 'fp-breadcrumb__icon')
      : '';
    return `<button class="${cls}" data-action="navigate-crumb" data-path="${escapeHtml(cumulative)}">${iconHtml}${escapeHtml(label)}</button>`;
  }).join('<span class="fp-breadcrumb__sep">·</span>');
  crumb.innerHTML = html;
}

/**
 * opts.actions is a list of {label, name} buttons rendered right-aligned
 * (data-action=name, dispatched through the global click delegation);
 * opts.actionLabel/actionName is kept as a single-button legacy shorthand.
 */
function showErrorBanner(message, opts = {}) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  const actions = opts.actions || (opts.actionLabel ? [{ label: opts.actionLabel, name: opts.actionName || 'nav-back' }] : []);
  const actionsHtml = actions.length
    ? `<div class="fp-error-banner__actions">${actions.map(a =>
        `<button class="fp-error-banner__action fp-btn fp-btn--ghost" data-action="${escapeHtml(a.name)}">${escapeHtml(a.label)}</button>`
      ).join('')}</div>`
    : '';
  setListNotice('');
  listScroll.innerHTML = `<div class="fp-error-banner" role="alert">
    ${icon('error', 'fp-icon--14')}
    <span class="fp-body" style="color: var(--text-primary)">${escapeHtml(message)}</span>
    ${actionsHtml}
  </div>`;
}

// ── Selection model (Task 3) ─────────────────────────────────────────────────

/** Returns the current selection as an array of absolute paths. */
function getSelectedPaths() { return [...browserState.selection]; }

/** Rename applies to exactly one item — the single shared rule behind both
 * the Rename context-menu item (app.js's CONTEXT_MENUS 'cm-rename' entries,
 * file and folder menus both call this directly) and the F2 keyboard
 * shortcut (browserKeydown below), so the two can never drift apart
 * (Task 11 fix round 1). */
function canRenameSelection() { return browserState.selection.size === 1; }

/** Looks up the entry object for an absolute path in the current directory, or null. */
function entryForPath(path) {
  if (!browserState.path && browserState.mode !== 'search') return null;
  return browserState.entries.find(e => entryPath(e) === path) || null;
}

/** Finds the rendered row element for an absolute path, or null. */
function findRowByPath(path) {
  const rows = document.querySelectorAll('#list-scroll .fp-row[data-path]');
  for (const row of rows) {
    if (row.dataset.path === path) return row;
  }
  return null;
}

/** Moves DOM focus to the list container so arrow-key navigation works. */
function focusListContainer() {
  document.getElementById('list-scroll')?.focus();
}

/**
 * Re-applies `.fp-row--selected` / `.fp-row--focused` classes, aria-selected,
 * and roving tabindex to the currently rendered rows from browserState.
 */
function applySelectionState() {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  listScroll.querySelectorAll('.fp-row[data-path]').forEach(row => {
    const path = row.dataset.path;
    const isSelected = browserState.selection.has(path);
    const isFocused = path === browserState.focus;
    row.classList.toggle('fp-row--selected', isSelected);
    row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    row.classList.toggle('fp-row--focused', isFocused);
    row.setAttribute('tabindex', isFocused ? '0' : '-1');
  });
}

/**
 * Click selection semantics: plain click selects only this row; Ctrl toggles
 * it in/out of the selection; Shift extends a contiguous range from `anchor`
 * to `path` in the current sorted order.
 */
function selectRow(path, { ctrl = false, shift = false } = {}) {
  if (!browserState.path) return;
  const order = sortedEntries().map(entryPath);

  if (shift) {
    const anchorPath = browserState.anchor || path;
    const a = order.indexOf(anchorPath);
    const b = order.indexOf(path);
    if (a === -1 || b === -1) {
      browserState.selection = new Set([path]);
      browserState.anchor = path;
    } else {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      browserState.selection = new Set(order.slice(lo, hi + 1));
      if (!browserState.anchor) browserState.anchor = anchorPath;
    }
  } else if (ctrl) {
    if (browserState.selection.has(path)) browserState.selection.delete(path);
    else browserState.selection.add(path);
    browserState.anchor = path;
  } else {
    browserState.selection = new Set([path]);
    browserState.anchor = path;
  }
  browserState.focus = path;

  applySelectionState();
  focusListContainer();
  onSelectionChanged();
}

/** Selects every entry in the current directory. */
function selectAll() {
  if (!browserState.path) return;
  const order = sortedEntries().map(entryPath);
  browserState.selection = new Set(order);
  if (order.length) {
    browserState.anchor = order[0];
    browserState.focus = browserState.focus && order.includes(browserState.focus)
      ? browserState.focus
      : order[order.length - 1];
  }
  applySelectionState();
  focusListContainer();
  onSelectionChanged();
}

/** Clears the selection (anchor/focus included). */
function clearSelection() {
  browserState.selection = new Set();
  browserState.anchor = null;
  browserState.focus = null;
  applySelectionState();
  onSelectionChanged();
}

/**
 * Moves keyboard focus by `delta` rows (or to 'home'/'end') in the current
 * sorted order. With `shift`, extends the selection from `anchor` through
 * the new focus row instead of replacing it.
 */
function moveFocus(delta, { shift = false } = {}) {
  if (!browserState.path) return;
  const order = sortedEntries().map(entryPath);
  if (!order.length) return;

  const curIdx = browserState.focus ? order.indexOf(browserState.focus) : -1;
  let idx;
  if (delta === 'home') idx = 0;
  else if (delta === 'end') idx = order.length - 1;
  else idx = curIdx === -1 ? 0 : Math.max(0, Math.min(order.length - 1, curIdx + delta));
  moveFocusTo(order[idx], { shift }, order);
}

/** Focuses `path` (selecting it, or with `shift` the range from the anchor
 * in sorted order) and scrolls it into view along both axes. */
function moveFocusTo(path, { shift = false } = {}, order = sortedEntries().map(entryPath)) {
  const idx = order.indexOf(path);
  if (idx === -1) return;
  if (shift) {
    if (!browserState.anchor) browserState.anchor = browserState.focus || path;
    const a = order.indexOf(browserState.anchor);
    const [lo, hi] = a <= idx ? [a, idx] : [idx, a];
    browserState.selection = new Set(order.slice(lo, hi + 1));
  } else {
    browserState.selection = new Set([path]);
    browserState.anchor = path;
  }
  browserState.focus = path;

  applySelectionState();
  findListRow(path)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  onSelectionChanged();
}

/**
 * Arrow keys and PageUp/PageDown, by the rendered positions of the cells
 * (spec §3.3, pass-2 #168):
 *  - Icons, Tiles, Small icons: ←/→ step through DOM order (within a row,
 *    wrapping to the previous/next row); ↑/↓ go to the cell in the row
 *    above/below whose centre is nearest.
 *  - List: ↑/↓ step through DOM order (down a column, on into the next);
 *    ←/→ go to the neighbouring column at the same row.
 *  - Details, Content: ↑/↓ only.
 * PageUp/PageDown move a viewport's worth along the scroll axis. Rects are
 * read once per keypress, lazily, only for the rows the search looks at.
 * `dir` is 'left' | 'right' | 'up' | 'down' | 'pageup' | 'pagedown'.
 */
function moveFocusDir(dir, { shift = false } = {}) {
  if (!browserState.path) return;
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  const rows = listScroll.querySelectorAll(':scope > .fp-row[data-path]');
  if (!rows.length) return;
  let cur = -1;
  if (browserState.focus) {
    const focused = findListRow(browserState.focus);
    if (focused) cur = Array.prototype.indexOf.call(rows, focused);
  }
  if (cur === -1) { moveFocusTo(rows[0].dataset.path, { shift }); return; }

  const view = browserState.view;
  const grid = view === 'icons' || view === 'tiles' || view === 'small';
  const rects = new Array(rows.length);
  const rectOf = (i) => rects[i] || (rects[i] = rows[i].getBoundingClientRect());
  const step = (d) => Math.max(0, Math.min(rows.length - 1, cur + d));
  let target = cur;
  if (dir === 'left' || dir === 'right') {
    if (grid) target = step(dir === 'right' ? 1 : -1);
    else if (view === 'list') target = nearestAcross(rows.length, cur, rectOf, dir === 'right' ? 1 : -1, true);
    else return;
  } else if (dir === 'up' || dir === 'down') {
    target = grid
      ? nearestAcross(rows.length, cur, rectOf, dir === 'down' ? 1 : -1, false)
      : step(dir === 'down' ? 1 : -1);
  } else if (dir === 'pageup' || dir === 'pagedown') {
    const horiz = view === 'list';
    const c = rectOf(cur);
    const page = Math.max(1, (horiz ? listScroll.clientWidth - c.width : listScroll.clientHeight - c.height));
    target = pageTarget(rows.length, cur, rectOf, dir === 'pagedown' ? 1 : -1, horiz, page);
  }
  if (target === cur || target < 0) return;
  moveFocusTo(rows[target].dataset.path, { shift });
}

/** The cell in the next line (row, or column when `horiz`) in direction
 * `sign` whose centre is nearest the current cell's, or `cur` when there is
 * no such line. DOM order runs line by line, so the scan stops at the first
 * cell past that line. */
function nearestAcross(n, cur, rectOf, sign, horiz) {
  const c = rectOf(cur);
  const centre = horiz ? (c.top + c.bottom) / 2 : (c.left + c.right) / 2;
  const start = (r) => (horiz ? r.left : r.top);
  let line = null, best = cur, bestD = Infinity;
  for (let i = cur + sign; i >= 0 && i < n; i += sign) {
    const r = rectOf(i);
    const beyond = sign > 0 ? start(r) >= (horiz ? c.right : c.bottom) - 1 : (horiz ? r.right : r.bottom) <= start(c) + 1;
    if (!beyond) continue;
    if (line === null) line = start(r);
    else if (Math.abs(start(r) - line) > 1) break;
    const d = Math.abs((horiz ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2) - centre);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** PageUp/PageDown: the farthest line within one page in direction `sign`
 * (the last line when the list ends sooner), and in it the cell nearest the
 * current one across the other axis. */
function pageTarget(n, cur, rectOf, sign, horiz, page) {
  const c = rectOf(cur);
  const pos = (r) => (horiz ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2);
  const across = (r) => (horiz ? (r.top + r.bottom) / 2 : (r.left + r.right) / 2);
  const from = pos(c);
  let lineIdx = cur;
  // Walk outwards until a cell lies more than a page away.
  for (let i = cur + sign; i >= 0 && i < n; i += sign) {
    if (Math.abs(pos(rectOf(i)) - from) > page) break;
    lineIdx = i;
  }
  if (lineIdx === cur) return sign > 0 ? n - 1 : 0;
  // In the line of lineIdx, the cell nearest across.
  const linePos = pos(rectOf(lineIdx));
  let best = lineIdx, bestD = Math.abs(across(rectOf(lineIdx)) - across(c));
  for (const dirn of [-1, 1]) {
    for (let i = lineIdx + dirn; i >= 0 && i < n; i += dirn) {
      const r = rectOf(i);
      if (Math.abs(pos(r) - linePos) > 1) break;
      const d = Math.abs(across(r) - across(c));
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

/** Opens a directory entry: folder navigates into it, file opens via the OS
 * and is logged as a recent action (folders are not — see home.js's
 * loadRecent, which only ever expects file entries in /recent's groups). */
function openEntry(path) {
  const entry = entryForPath(path);
  if (!entry) return;
  if (entry.is_dir) {
    loadDirectory(path);
    return;
  }
  const openPath = window.electronAPI?.openPath;
  if (!openPath) return;
  Promise.resolve(openPath(path)).then(result => {
    if (result) showToast(result, 'error');
  }).catch(err => showToast(formatApiError(err), 'error'));
  API.post('/recent', { path, action: 'opened' }).catch(() => { /* best-effort logging */ });
}

/** Enter key: opens the currently focused row, if any. */
function openFocused() {
  if (browserState.focus) openEntry(browserState.focus);
}

/**
 * Selects `path` alone if it is not already part of the current selection —
 * used before opening the context menu on a row (right-click on an
 * unselected row selects it alone; right-click within an existing
 * multi-selection leaves the selection untouched).
 */
function ensureRowSelected(path) {
  if (!browserState.selection.has(path)) selectRow(path, {});
}

// ── Inline rename (Task 4) ────────────────────────────────────────────────────
// Client-side mirror of backend.mover.validate_name — the backend remains the
// authority (a race, or a rule we've missed, still comes back as a 409), but
// catching the obvious cases here avoids a round-trip for typos.
const _RESERVED_STEMS = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);
const _BAD_NAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/;

/** Returns an error message if `name` is invalid, or null if it's fine. */
function validateEntryName(name) {
  if (!name || name === '.' || name === '..') return 'Name is empty or reserved.';
  if (_BAD_NAME_CHARS.test(name)) return 'Name contains a character that Windows does not allow: \\ / : * ? " < > |';
  if (/[. ]$/.test(name)) return 'Name may not end with a dot or a space.';
  if (_RESERVED_STEMS.has(name.split('.')[0].toUpperCase())) return `'${name}' is a reserved device name.`;
  return null;
}

/**
 * Swaps a row's `.fp-row__name` span for an editable input. For a file with
 * an extension, only the stem is preselected (folders and extension-less
 * files select the whole name) — matches Explorer's rename UX. Enter commits
 * via fileops.rename, Escape cancels, blur commits, and a no-change commit is
 * silently ignored.
 */
function startInlineRename(path) {
  const row = findRowByPath(path);
  if (!row) return;
  const nameEl = row.querySelector('.fp-row__name');
  if (!nameEl) return;
  const entry = entryForPath(path);
  const currentName = entry ? entry.name : (nameEl.textContent || '').trim();
  const isDir = row.dataset.type === 'folder';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fp-input fp-row__rename';
  input.value = currentName;
  input.setAttribute('aria-label', 'Rename');
  nameEl.replaceWith(input);
  input.focus();

  const dot = currentName.lastIndexOf('.');
  if (!isDir && dot > 0) input.setSelectionRange(0, dot);
  else input.select();

  let settled = false;
  const restore = () => {
    if (settled) return;
    settled = true;
    input.replaceWith(nameEl);
    // A refresh during the rename left this row where it was; now that the
    // rename is over, put it where the current sort says (no re-fetch).
    resortAfterRename();
  };
  // A refresh during the rename left this row where it was. Once the rename
  // is over (cancelled, or failed) put it where the current sort says — only
  // for a folder listing; search results are never patched.
  const resortAfterRename = () => {
    if (!browserState._orderDirty) return;
    if (browserState.mode !== 'search' && nameEl.isConnected) patchDirectory(browserState.entries);
    else browserState._orderDirty = false;
  };
  const doRename = (newName) => {
    settled = true;
    // fileops.rename()'s own run() re-fetches the directory and re-renders
    // every row (including this one) on success — and reselects it there
    // too; on failure the row stays as-is under the (now orphaned) input —
    // restore the static name span.
    fileops.rename(path, newName).catch(() => {
      if (input.isConnected) input.replaceWith(nameEl);
      resortAfterRename();
    });
  };
  // Enter and blur both "commit", but a validation failure means something
  // different on each: on Enter the user is still in the field, so keep
  // editing (toast + refocus, let them fix it). On blur they've already left
  // — calling .focus() from inside a blur handler fights the browser's own
  // focus change (can loop/trap focus), so instead just cancel the rename
  // (restore the static name) and toast why.
  const commitFromKeydown = () => {
    if (settled) return;
    const newName = input.value.trim();
    if (!newName || newName === currentName) { restore(); return; }
    const error = validateEntryName(newName);
    if (error) { showToast(error, 'error'); input.focus(); return; }
    doRename(newName);
  };
  const commitFromBlur = () => {
    if (settled) return;
    // A blur that comes from the row being re-rendered or removed under the
    // input (a refresh) is not the user leaving the field: cancel, never
    // rename without them confirming (fix round 2). Chromium fires that blur
    // from inside the removal, while the input can still read as connected,
    // so the decision waits for the current task's DOM work to finish.
    queueMicrotask(commitAfterBlur);
  };
  const commitAfterBlur = () => {
    if (settled) return;
    if (!input.isConnected) { settled = true; return; }
    const newName = input.value.trim();
    if (!newName || newName === currentName) { restore(); return; }
    const error = validateEntryName(newName);
    if (error) { showToast(error, 'error'); restore(); return; }
    doRename(newName);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitFromKeydown(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
    e.stopPropagation();
  });
  input.addEventListener('blur', commitFromBlur);
  input.addEventListener('click', e => e.stopPropagation());
}

// Selection → inspector debounce: arrow-key navigation and marquee drags can
// change the selection many times a second, and each change would otherwise
// fire a fresh GET /file + GET /preview + GET /files/history round-trip.
// Wait for the selection to settle for 120ms before fetching; _inspectorSeq
// (inspector.js) additionally guards against an in-flight fetch from an
// already-superseded selection overwriting the DOM once it resolves.
let _inspectorDebounceTimer = null;

/** Hook called whenever the selection changes: updates the status bar
 * immediately, and (debounced) the inspector panel via showInspectorFor /
 * showInspectorMulti / updateInspector('none'). */
function onSelectionChanged() {
  // Drives the grid single-tile-only selection bar (styles.css, Task 11
  // playtest pass 1 §4.1) — a plain string attribute rather than a boolean
  // so CSS can target the exact count ([data-selection-count="1"]) instead
  // of merely "any selection".
  const listScroll = document.getElementById('list-scroll');
  if (listScroll) listScroll.dataset.selectionCount = String(browserState.selection.size);
  updateStatusBar();
  clearTimeout(_inspectorDebounceTimer);
  _inspectorDebounceTimer = setTimeout(() => {
    const n = browserState.selection.size;
    if (n === 0) {
      _inspectorSeq++; // invalidate any fetch still in flight from the prior selection
      // updateInspector('none') renders the full empty state itself now
      // (including revoking any preview blob: URL) — no separate call needed.
      updateInspector('none');
    } else if (n === 1) {
      showInspectorFor([...browserState.selection][0]);
    } else {
      showInspectorMulti(getSelectedPaths());
    }
  }, 120);
}

/** Sums the size of selected files (folders/errored entries contribute 0). */
function selectionTotalSize() {
  let total = 0;
  browserState.selection.forEach(path => {
    const entry = entryForPath(path);
    if (entry && !entry.is_dir && !entry.error && typeof entry.size === 'number') total += entry.size;
  });
  return total;
}

/** Updates the status bar's item count and selection summary. */
function updateStatusBar() {
  const countEl = document.getElementById('status-count');
  const selEl = document.getElementById('status-selected');
  const n = browserState.entries.length;
  if (countEl) countEl.textContent = browserState.mode === 'search' ? `${n} results` : `${n} items`;
  if (selEl) {
    const n = browserState.selection.size;
    if (n === 0) selEl.textContent = 'Nothing selected';
    else if (n === 1) selEl.textContent = '1 selected';
    else selEl.textContent = `${n} selected · ${formatSize(selectionTotalSize())}`;
  }
}

// ── Row click/dblclick + keyboard (Task 3) ────────────────────────────────────

/**
 * Delegated row interactions on #list-scroll: single click selects (or, in
 * single-click mode, opens folders); double-click always opens.
 */
function initRowInteractions() {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  listScroll.addEventListener('click', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) return;
    const path = row.dataset.path;
    const clickMode = window.__fpConfig && window.__fpConfig['ui.click_mode'];
    // A MODIFIED click is always a selection gesture, in either click mode:
    // checking click_mode first sent Ctrl+click / Shift+click on a folder row
    // to openEntry(), which navigated away and threw the selection the user
    // was building away with it (pass 2 #198).
    const modified = e.ctrlKey || e.shiftKey || e.metaKey;
    if (clickMode === 'single' && row.dataset.type === 'folder' && !modified) {
      openEntry(path);
      return;
    }
    selectRow(path, { ctrl: e.ctrlKey, shift: e.shiftKey });
  });

  listScroll.addEventListener('dblclick', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) return;
    openEntry(row.dataset.path);
  });
}

/**
 * Browser-screen keyboard shortcuts. Called from app.js's global keydown
 * handler only when the Browser screen is active and no input/textarea/
 * contenteditable has focus. F2/Delete/Ctrl+C/X/V/Z/Y belong to Task 4.
 */
function anyScrimOpen() {
  return [...document.querySelectorAll('.fp-scrim')].some(el => {
    if (el.hidden) return false;
    // Every scrim in index.html ships with style="display:none" and is shown
    // by setting it to 'flex'; getComputedStyle is the fallback for one that
    // is driven by a class instead.
    return el.style.display
      ? el.style.display !== 'none'
      : getComputedStyle(el).display !== 'none';
  });
}

/** True when a real (non-collapsed) text selection exists on the page — a
 *  path dragged out in the Inspector, a breadcrumb, a status-bar figure. The
 *  Browser's Ctrl+C/Ctrl+X must leave that to the browser's native copy
 *  instead of swallowing it (pass 2 #50). */
function hasTextSelection() {
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  return !!(sel && !sel.isCollapsed && String(sel).trim().length);
}

function browserKeydown(e) {
  // Never act on Browser shortcuts while a modal or the command palette has
  // focus/visibility — e.g. Ctrl+Z while a paste-conflict modal is open must
  // not also undo the last file op behind it, and typing in the palette
  // search box must not trigger F2/Delete/etc.
  // Hand-listing the scrims meant every dialog added later was missed: the
  // search More-filters dialog let Delete through to the selection behind it
  // (pass 2 #86). Ask the DOM instead — every overlay in the app is a
  // .fp-scrim toggled through its own inline display.
  if (anyScrimOpen()) return;

  const key = e.key;
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.altKey) {
    if (key === 'ArrowUp')         { e.preventDefault(); navUp(); }
    else if (key === 'ArrowLeft')  { e.preventDefault(); navBack(); }
    else if (key === 'ArrowRight') { e.preventDefault(); navForward(); }
    // Alt+Enter — Properties for the focused/selected single item (Task 13;
    // canRenameSelection()'s single-selection rule doubles as "Properties is
    // single-item only in this pass", design spec §5.1). Same target as F2's
    // Rename below: browserState.focus.
    else if (key === 'Enter' && canRenameSelection() && browserState.focus) {
      e.preventDefault();
      if (typeof openProperties === 'function') openProperties(browserState.focus);
    }
    return;
  }

  // Everything below acts on the listing (or the file clipboard / undo for
  // it). A tab whose first listing is still loading — or that shows only an
  // error banner — has none of its own: the folder it came from went with
  // its rows (fix round 2). Alt+arrows above still navigate.
  if (!browserHasOwnListing()) return;

  if (ctrl && key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAll();
    return;
  }

  // Undo/redo work even with nothing selected — checked before any
  // selection-dependent shortcut below. e.repeat is ignored so a held key
  // can't fire a burst of undo/redo calls (each fileops call is already
  // async and _inFlight-guarded, but a held key still shouldn't queue up
  // several dozen intents).
  if (ctrl && !e.shiftKey && key.toLowerCase() === 'z' && !e.repeat) { e.preventDefault(); fileops.undoLast(); return; }
  if (ctrl && !e.repeat && ((key.toLowerCase() === 'y' && !e.shiftKey) || (key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault(); fileops.redoLast(); return;
  }
  // Ctrl+X / Ctrl+C only belong to the file clipboard when there IS a row
  // selection and the user is not copying text. With nothing selected they
  // used to preventDefault() the native copy and then overwrite a perfectly
  // good file clipboard with an empty one (Paste silently greyed out) — so
  // fall through to the browser instead (pass 2 #50).
  if (ctrl && (key.toLowerCase() === 'x' || key.toLowerCase() === 'c')) {
    if (!browserState.selection.size || hasTextSelection()) return;
    e.preventDefault();
    if (key.toLowerCase() === 'x') fileops.cutSelection(); else fileops.copySelection();
    return;
  }
  // Ctrl+V pastes into the folder ON SCREEN. In search mode that folder is not
  // on screen — browserState.path is still the pre-search directory — so a
  // paste there would move/copy the clipboard into a directory the user cannot
  // see and the re-run search would not show (pass 2 #51).
  if (ctrl && key.toLowerCase() === 'v') {
    e.preventDefault();
    if (browserState.mode === 'search') { showToast('Leave search results to paste here', 'error'); return; }
    if (browserState.path) fileops.pasteInto(browserState.path).catch(fileopsReported);
    return;
  }
  if (key === 'F2') { e.preventDefault(); if (canRenameSelection() && browserState.focus) startInlineRename(browserState.focus); return; }
  if (key === 'Delete') { e.preventDefault(); fileops.trashSelection().catch(fileopsReported); return; }

  switch (key) {
    case 'ArrowDown':  e.preventDefault(); moveFocusDir('down', { shift: e.shiftKey }); break;
    case 'ArrowUp':    e.preventDefault(); moveFocusDir('up', { shift: e.shiftKey }); break;
    case 'ArrowLeft':  e.preventDefault(); moveFocusDir('left', { shift: e.shiftKey }); break;
    case 'ArrowRight': e.preventDefault(); moveFocusDir('right', { shift: e.shiftKey }); break;
    case 'PageDown':   e.preventDefault(); moveFocusDir('pagedown', { shift: e.shiftKey }); break;
    case 'PageUp':     e.preventDefault(); moveFocusDir('pageup', { shift: e.shiftKey }); break;
    case 'Home':      e.preventDefault(); moveFocus('home', { shift: e.shiftKey }); break;
    case 'End':       e.preventDefault(); moveFocus('end', { shift: e.shiftKey }); break;
    case 'Enter':     e.preventDefault(); openFocused(); break;
    case 'Backspace': {
      e.preventDefault();
      // ui.backspace_deletes (Settings › Personalization › Keyboard): trash
      // the selection instead of navigating up. trashSelection() already
      // no-ops on an empty selection, so "nothing selected" falls out for
      // free rather than needing its own check here.
      const backspaceDeletes = !!(window.__fpConfig && window.__fpConfig['ui.backspace_deletes']);
      if (backspaceDeletes) fileops.trashSelection().catch(fileopsReported);
      else navUp();
      break;
    }
    default: break;
  }
}
