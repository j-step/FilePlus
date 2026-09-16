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

// ── List/grid scale (Task 10) ────────────────────────────────────────────────
// Ctrl+wheel over #list-scroll and the View menu's icon-size presets both
// step/set this — it drives --list-scale on #list-scroll (see styles.css:
// row height/icon/font in list & details view, tile/thumb size in grid).
const LIST_SCALE_STEPS = [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.75, 2];

// Per-path manual view override, this session only (Map, never persisted) —
// set by setViewMode(mode, {manual: true}) (View menu items, the empty-area
// menu's View → Details/Grid). Read by loadDirectory()'s dynamic-media-view
// check (decideViewAndScale, below) so a folder the user has explicitly
// switched away from its auto-decided view stays that way for the rest of
// the session, even if its media share still qualifies it for the other view.
const manualViewByPath = new Map();

// ── Browser state ─────────────────────────────────────────────────────────────
// The last-loaded directory listing. `parent`/`isRoot` come straight from the
// /fs/list response so navUp() and the up-button never need to re-derive a
// parent by string-slicing the path. `showHidden` is seeded from
// config['ui.show_hidden'] by app.js's init sequence, before the first load.
// `sort`/`view`/`listScale` are re-applied from ui.sort/ui.view_mode/
// ui.list_scale by settings.js's applySettingsFromConfig() once GET /config
// has answered — the literal defaults below only cover the brief window
// before that first resolves. `selection` is the set of absolute paths
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
  // 'details' (the old 'list' — columns) | 'list' (name-only, single
  // column) | 'grid' — mirrors #list-scroll[data-view], read by renderFsRow
  // to pick row vs tile markup (a tile carries a thumbnail area a row has no
  // place for). setViewMode() is the only writer, and re-renders the
  // listing after changing it.
  view: 'details',
  // Current --list-scale value (a LIST_SCALE_STEPS member) applied to
  // #list-scroll; setListScale() is the only writer.
  listScale: 1,
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
};

// ── View modes ────────────────────────────────────────────────────────────────
/**
 * Sets the active view + syncs every DOM surface that reflects it (list vs
 * grid layout, the column header's visibility, Home's Recent/Favorites
 * panes) and re-renders the listing (row and tile markup differ).
 *
 * `manual` (View menu items, the empty-area menu's View → Details/Grid,
 * Task 11's future callers) records the choice into manualViewByPath for the
 * CURRENT folder and persists it as the ui.view_mode default; an automatic
 * choice (loadDirectory()'s dynamic-media-view check, via decideViewAndScale)
 * does neither, so it never clobbers a default the user picked deliberately,
 * nor a future folder's own auto-decision.
 */
function setViewMode(mode, { manual = false } = {}) {
  const v = (mode === 'list' || mode === 'grid') ? mode : 'details';
  browserState.view = v;
  const listScroll = document.getElementById('list-scroll');
  const listHead   = document.getElementById('list-head');
  if (listScroll) {
    // Suppress layout flicker by hiding briefly during the layout swap
    listScroll.style.opacity = '0';
    listScroll.dataset.view = v;
    // Only 'details' shows the column header — 'list' (name-only) and
    // 'grid' both hide it (A.3.1's rule extended to the new name-only view).
    if (listHead) listHead.classList.toggle('list-head--grid-hidden', v !== 'details');
    // Restore opacity on next paint — batches DOM updates before repaint
    requestAnimationFrame(() => {
      listScroll.style.opacity = '';
    });
  }
  // Home — Recent and Favorites panes share the same view-mode toggle
  document.querySelectorAll('.home-pane').forEach(pane => {
    pane.dataset.view = v;
  });
  if (manual) {
    if (browserState.path) manualViewByPath.set(browserState.path, v);
    saveSetting('ui.view_mode', v);
  }
  // Rows and tiles are different markup (a tile has a 96px thumbnail area
  // that requests a real shell thumbnail; a row has a 16px icon), so the
  // listing has to be re-rendered rather than just re-styled.
  if (browserState.entries && browserState.entries.length) renderDirectory();
}

/**
 * Sets --list-scale on #list-scroll (list row height/icon/font, grid
 * tile/thumb size — see styles.css) and, by default, persists it as
 * ui.list_scale. loadDirectory()'s dynamic-media-view check passes
 * {persist: false} to apply a listing-scoped scale (the auto-grid default,
 * or just re-syncing the already-persisted value) without touching the
 * user's actual saved preference.
 */
function setListScale(v, { persist = true } = {}) {
  const scale = LIST_SCALE_STEPS.includes(v) ? v : 1;
  browserState.listScale = scale;
  const listScroll = document.getElementById('list-scroll');
  if (listScroll) {
    listScroll.style.setProperty('--list-scale', String(scale));
    // Row/tile icons and thumbnails are sized in physical px from the CSS
    // box (icon-design.md §2), so a --list-scale change makes the old
    // bitmap the wrong size until it re-resolves. A timer, not rAF: an
    // occluded window stops painting (icons.js:_fpQueueScan does the same).
    if (typeof fpInvalidateLazyIcons === 'function') setTimeout(() => fpInvalidateLazyIcons(listScroll), 0);
  }
  if (persist) saveSetting('ui.list_scale', scale);
}

/** Steps --list-scale by one LIST_SCALE_STEPS entry in `direction` (+1/-1) —
 * Ctrl+wheel over #list-scroll (app.js). Persists like any other manual
 * scale change (setListScale's default). */
function stepListScale(direction) {
  const idx = LIST_SCALE_STEPS.indexOf(browserState.listScale);
  const curIdx = idx === -1 ? LIST_SCALE_STEPS.indexOf(1) : idx;
  const nextIdx = Math.max(0, Math.min(LIST_SCALE_STEPS.length - 1, curIdx + direction));
  setListScale(LIST_SCALE_STEPS[nextIdx]);
}

/**
 * Dynamic media view (playtest pass 1, Task 10): decides the view + scale
 * for `path`'s freshly-fetched `entries`. Called by loadDirectory() after
 * every real navigation — never for a tab-switch restore, which reapplies
 * whatever that tab last showed instead (see loadDirectory()'s restore.view
 * handling), and never in a future search-results mode (browserState.mode).
 *
 * A manual override recorded for this exact path this session wins outright,
 * at the persisted scale. Otherwise, unless ui.dynamic_media_view is
 * explicitly false, a folder whose own non-hidden files are more than half
 * pictures/video opens in grid at scale 1 — not persisted, since this is a
 * per-listing default, not a change to the user's actual preference.
 * Anything else falls back to the persisted ui.view_mode/ui.list_scale.
 */
function decideViewAndScale(path, entries) {
  const cfg = window.__fpConfig || {};
  const persistedScale = LIST_SCALE_STEPS.includes(cfg['ui.list_scale']) ? cfg['ui.list_scale'] : 1;
  const defaultView = ['details', 'list', 'grid'].includes(cfg['ui.view_mode']) ? cfg['ui.view_mode'] : 'details';
  const manualPicked = manualViewByPath.get(path);
  if (manualPicked) return { view: manualPicked, scale: persistedScale };
  if (cfg['ui.dynamic_media_view'] !== false) {
    const files = entries.filter(e => !e.is_dir && !e.is_hidden);
    const mediaShare = files.length
      ? files.filter(e => typeof fpIsMedia === 'function' && fpIsMedia(e.ext)).length / files.length
      : 0;
    if (mediaShare > 0.5) return { view: 'grid', scale: 1 };
  }
  return { view: defaultView, scale: persistedScale };
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

/** Syncs the `.fp-sortable` header classes to browserState.sort. */
function updateSortHeaderUI() {
  document.querySelectorAll('.fp-sortable[data-sort]').forEach(col => {
    const isActive = col.dataset.sort === browserState.sort.key;
    col.classList.toggle('active', isActive);
    col.classList.toggle('asc', isActive && browserState.sort.dir === 'asc');
    col.classList.toggle('desc', isActive && browserState.sort.dir === 'desc');
  });
}

/** Sets the active sort, persists it (ui.sort — replaces the old
 * sessionStorage['fp-sort']), and re-renders the current directory. */
function applySort(key, dir) {
  browserState.sort = { key, dir };
  saveSetting('ui.sort', browserState.sort);
  updateSortHeaderUI();
  renderDirectory();
}

/**
 * Returns browserState.entries sorted for display: folders always precede
 * files (regardless of direction), then each group is ordered by the active
 * sort key — name (natural, case-insensitive), size, modified (numeric), or
 * type (file-type family, filetypes.js's fpFamilyFor, then name).
 */
function sortedEntries() {
  const { key, dir } = browserState.sort;
  const sign = dir === 'desc' ? -1 : 1;
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return [...browserState.entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let cmp;
    if (key === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
    else if (key === 'modified') cmp = (a.modified ?? 0) - (b.modified ?? 0);
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

  listScroll.addEventListener('mousedown', e => {
    if (e.target.closest('.fp-row, .fp-row__icon, .fp-row__name')) return;
    if (e.button !== 0) return;
    dragging = true;
    ctrlDrag = e.ctrlKey;
    startX = e.clientX; startY = e.clientY;
    marqueeRect.style.display = 'block';
    marqueeRect.style.left = startX + 'px';
    marqueeRect.style.top  = startY + 'px';
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
    marqueeRect.style.left   = x + 'px';
    marqueeRect.style.top    = y + 'px';
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

function formatModified(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d)) return isoStr;
  const now = new Date();
  const diff = now - d;
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 86400000 * 2) return 'Yesterday';
  if (diff < 86400000 * 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

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
  return idx > 0 ? norm.slice(0, idx) : norm;
}

/**
 * opts.restore (Stage 2C Task 7) — {scrollTop, selection, view} from a tab
 * record being reactivated: applied after the fresh render lands (selection
 * only for paths still present in the refreshed listing). Mutually exclusive
 * with opts.preserveSelection — activateTab() is the only restore caller and
 * it always passes addToHistory:false too.
 *
 * reqTabId/reqSeq (fix round 1) guard against the fetch resolving after this
 * call has been superseded — either by a tab switch (tabs.activeId no longer
 * reqTabId) or by a newer navigation in the same tab (browserState._loadSeq
 * moved on). Without this, an unawaited loadDirectory() left running while
 * the user switches tabs (or fires a second navigation before the first
 * lands) could paint a stale listing over whatever's actually current.
 */
async function loadDirectory(absPath, opts = {}) {
  const { addToHistory = true, preserveSelection = false, restore = null } = opts;
  const reqTabId = tabs.activeId;
  const reqSeq = ++browserState._loadSeq;
  // Any real navigation ends a search — opening a result folder, Back, a
  // sidebar click, a spring-loaded drop. Done here rather than at each call
  // site so there is exactly one exit from search mode.
  leaveSearchMode();
  browserState.lastAttemptedPath = absPath;
  // Sets the active tab's label/icon, the sidebar highlight, and (when
  // absPath is a real path) the breadcrumb — synchronously, before the
  // fetch below, so none of them wait on the network or get rewritten a
  // second time once it resolves.
  onNavigated(absPath);
  let data;
  try {
    data = absPath
      ? await API.get('/fs/list', { path: absPath, show_hidden: browserState.showHidden })
      : await API.get('/fs/list/root', { show_hidden: browserState.showHidden });
  } catch (err) {
    if (tabs.activeId !== reqTabId || browserState._loadSeq !== reqSeq) return;
    handleLoadError(err, absPath);
    return;
  }
  if (tabs.activeId !== reqTabId || browserState._loadSeq !== reqSeq) return;

  const prevSelection = preserveSelection ? new Set(browserState.selection) : null;
  const prevAnchor    = preserveSelection ? browserState.anchor : null;
  const prevFocus      = preserveSelection ? browserState.focus : null;

  browserState.path = data.path;
  browserState.entries = data.entries;
  browserState.parent = data.parent;
  browserState.isRoot = data.is_root;
  // Dynamic media view (Task 10): decided fresh on every real navigation —
  // never for a tab-switch restore (restore.view below reapplies whatever
  // that tab last showed instead), and never in a future search-results mode.
  const decidedView = (!(restore && restore.view) && browserState.mode !== 'search')
    ? decideViewAndScale(data.path, data.entries)
    : null;
  if (restore && restore.view) browserState.view = restore.view;
  else if (decidedView) browserState.view = decidedView.view;

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
  }
  browserState.listingStale = false;
  // onNavigated(null) (the sandbox-root request) couldn't build breadcrumb
  // crumbs from nothing — finalize them now that the real path is known.
  if (!absPath) updateBreadcrumb(data.path);

  if (restore) {
    const validPaths = new Set(data.entries.map(e => joinPath(data.path, e.name)));
    const restoredSelection = (restore.selection || []).filter(p => validPaths.has(p));
    browserState.selection = new Set(restoredSelection);
    browserState.anchor = restoredSelection.length ? restoredSelection[0] : null;
    browserState.focus  = restoredSelection.length ? restoredSelection[restoredSelection.length - 1] : null;
  } else if (preserveSelection && prevSelection) {
    // Keep only paths that still exist in the refreshed listing.
    const validPaths = new Set(data.entries.map(e => joinPath(data.path, e.name)));
    browserState.selection = new Set([...prevSelection].filter(p => validPaths.has(p)));
    browserState.anchor = prevAnchor && validPaths.has(prevAnchor) ? prevAnchor : null;
    browserState.focus  = prevFocus && validPaths.has(prevFocus) ? prevFocus : null;
  } else {
    browserState.selection = new Set();
    browserState.anchor = null;
    browserState.focus = null;
  }

  renderDirectory(data);
  if (restore && restore.view) {
    // --list-scale is a single global custom property, so a restore has to
    // re-assert THIS tab's scale too — otherwise the tab inherits whatever
    // scale the outgoing tab (or a Ctrl+wheel zoom in it) last set (pass 2 #19).
    if (restore.listScale) setListScale(restore.listScale, { persist: false });
    setViewMode(restore.view);
  } else if (decidedView) {
    setListScale(decidedView.scale, { persist: false });
    setViewMode(decidedView.view, { manual: false });
  }
  if (addToHistory) pushHistory(data.path);
  else refreshNavButtons();
  updateAddressBar(data.path);
  onSelectionChanged();

  const listScroll = document.getElementById('list-scroll');
  if (listScroll) listScroll.scrollTop = restore ? (restore.scrollTop || 0) : 0;
}

/** Re-fetches the current directory, keeping selection/anchor/focus (by path)
 * and the list scroll position where they still apply, and spins the
 * toolbar refresh button's icon for the duration — shared by the toolbar
 * button (data-action="refresh-directory"), F5, and the empty-area context
 * menu's Refresh item, all of which just call this (Task 8, playtest pass 1
 * §3.6). Returns loadDirectory's promise so callers (fileops.run(), inline
 * rename) can await the re-render actually landing before touching the DOM
 * again.
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
    const searchBtn = document.getElementById('btn-refresh');
    searchBtn?.classList.add('is-spinning');
    const rerun = typeof runSearch === 'function'
      ? Promise.resolve(runSearch({ pushHistory: false, preserveSelection: true }))
      : Promise.resolve();
    return rerun.finally(() => searchBtn?.classList.remove('is-spinning'));
  }
  if (!browserState.path) return;
  const btn = document.getElementById('btn-refresh');
  const listScroll = document.getElementById('list-scroll');
  const scrollTop = listScroll ? listScroll.scrollTop : 0;
  // #list-scroll is DOM shared by every tab: if the user switches tabs while
  // this refresh is in flight, loadDirectory() bails on its own reqTabId guard
  // but this finally() would still stamp THIS tab's offset onto the tab that
  // is now showing (pass 2 #20).
  const reqTabId = tabs.activeId;
  btn?.classList.add('is-spinning');
  const p = loadDirectory(browserState.path, { addToHistory: false, preserveSelection: true });
  return p.finally(() => {
    if (listScroll && tabs.activeId === reqTabId) listScroll.scrollTop = scrollTop;
    btn?.classList.remove('is-spinning');
  });
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

function navBack() {
  // Same Explorer rule navUp() follows: the first Back out of a results
  // listing leaves the search and returns to the folder that was searched —
  // searching never pushed a history entry of its own, so without this Back
  // silently skips PAST the searched folder to the previous one (pass 2 #154).
  if (browserState.mode === 'search') { exitSearchResults(); return; }
  if (nav.index <= 0) return;
  nav.index -= 1;
  loadDirectory(nav.history[nav.index], { addToHistory: false });
}

function navForward() {
  if (browserState.mode === 'search') { exitSearchResults(); return; }
  if (nav.index >= nav.history.length - 1) return;
  nav.index += 1;
  loadDirectory(nav.history[nav.index], { addToHistory: false });
}

function navUp() {
  // Explorer's rule: Up out of a results listing goes back to the folder that
  // was searched, not to that folder's parent. This is the one path behind the
  // toolbar Up button, Alt+Up and Backspace (browserKeydown, when
  // ui.backspace_deletes is off), so all three agree by construction.
  if (browserState.mode === 'search') { exitSearchResults(); return; }
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
  if (data) browserState.truncated = !!data.truncated;
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  const isSearch = browserState.mode === 'search';
  // The 10,000-entry banner belongs to a /fs/list listing; a truncated search
  // says so in its own results header instead (renderSearchResults).
  const truncatedHtml = (!isSearch && browserState.truncated) ? renderTruncatedBanner() : '';

  if (!browserState.entries || browserState.entries.length === 0) {
    listScroll.innerHTML = truncatedHtml + (isSearch ? renderNoSearchResults() : renderEmptyFolder());
    updateStatusBar();
    return;
  }

  listScroll.innerHTML = truncatedHtml + sortedEntries().map(entry => renderFsRow(entry, browserState.path)).join('');
  applySelectionState();
  updateStatusBar();
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

/** Leading visual for one entry: a 16px family icon in list view, a 96px
 * thumbnail area in grid view.
 *
 * Grid tiles show real content wherever the shell can produce it — a shell
 * thumbnail for media files, and, for a folder in 'fileplus' mode, up to two
 * of the folder's own pictures fanned over the folder icon (GET /fs/peek,
 * requested only once the tile is on screen). In 'windows' mode every tile
 * asks the shell directly, folders included, which is what Explorer shows.
 * List view keeps the family icon everywhere except image rows, which get a
 * 16px thumbnail of the picture itself. */
function renderFsIcon(entry) {
  const source = fpIconSource();
  if (browserState.view !== 'grid') {
    const wantsThumb = !entry.is_dir && !entry.error && source === 'fileplus'
      && typeof fpIsMedia === 'function' && fpIsMedia(entry.ext)
      && fpFamilyFor(entry.ext) !== 'svg'; // an SVG's own markup is its icon
    return wantsThumb
      ? fpThumbBox(entry, 16, 'fp-row__icon fp-row__icon--thumb')
      : iconFor(entry, 16, 'fp-row__icon');
  }
  if (entry.error) return fpTileIcon(entry);
  if (source === 'windows') return fpThumbBox(entry, 96, 'fp-tile__thumb');
  if (entry.is_dir) return fpFolderPeekBox(entry, 'fp-tile__thumb');
  if (typeof fpIsMedia === 'function' && fpIsMedia(entry.ext) && fpFamilyFor(entry.ext) !== 'svg') {
    return fpThumbBox(entry, 96, 'fp-tile__thumb');
  }
  return fpTileIcon(entry);
}

function renderFsRow(entry, parentPath) {
  // A search result carries its own absolute path (it can live anywhere under
  // the searched root); a /fs/list entry is joined onto the open folder.
  const childPath = entry.path || joinPath(parentPath, entry.name);
  // iconFor()/fpThumbBox() key their shell requests off an absolute path, and
  // a /fs/list entry only carries its own name — join it on here rather than
  // making every icon call site re-derive it.
  const iconHtml = renderFsIcon({ ...entry, path: childPath });
  const sizeText = (entry.is_dir || entry.error) ? '—' : formatSize(entry.size);
  const modifiedText = entry.error ? '—' : formatModified(entry.modified * 1000);
  const rowClass = `fp-row${entry.is_dir ? ' fp-row--folder' : ''}${entry.error ? ' fp-row--disabled' : ''}`;
  const titleAttr = entry.error ? ' title="Access denied"' : '';
  // ui.show_extensions === false hides the extension on FILE rows only —
  // folders never have one to hide. The full name still shows as a tooltip.
  const hideExt = !entry.is_dir && browserState.showExtensions === false;
  const displayName = hideExt ? stemOf(entry.name) : entry.name;
  const nameTitleAttr = hideExt ? ` title="${escapeHtml(entry.name)}"` : '';
  // Search mode: wrap the matched substrings in <mark> and hang the parent
  // folder under the name as a "Location" subline. entry.match's offsets index
  // the RAW name, so highlighting is skipped when show-extensions has trimmed
  // it — the spans would no longer line up with what is being rendered.
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
  // No draggable="true": Stage 2C Task 12 replaced HTML5 drag and drop with a
  // pointer-event drag session (dragdrop.js). The native attribute would now
  // only get in the way — a native drag starting under our own pointermove
  // handler swallows the rest of the session.
  return `<div class="${rowClass}" role="option"
            data-path="${escapeHtml(childPath)}"
            data-type="${entry.is_dir ? 'folder' : 'file'}" tabindex="-1"${titleAttr}>
    ${iconHtml}
    ${isSearch
      ? `<span class="fp-row__namecell">
          <span class="fp-row__name"${nameTitleAttr}>${nameHtml}</span>
          <span class="fp-row__location" title="${escapeHtml(location)}">${escapeHtml(location)}</span>
        </span>`
      : `<span class="fp-row__name"${nameTitleAttr}>${nameHtml}</span>`}
    ${starHtml}
    <span class="fp-row__size mono">${sizeText}</span>
    <span class="fp-row__modified mono">${modifiedText}</span>
    <div class="fp-row__tags"></div>
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
  el.insertAdjacentHTML('beforeend', `<span class="list-search-header__hint">
      ${escapeHtml(text)} —
      <button class="fp-btn fp-btn--ghost fp-btn--sm" data-action="${escapeHtml(actionName)}">${escapeHtml(actionLabel)}</button>
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
  if (listScroll) listScroll.dataset.mode = 'search';
  if (entering) {
    browserState.entries = [];
    browserState.selection = new Set();
    browserState.anchor = null;
    browserState.focus = null;
    if (listScroll) listScroll.innerHTML = '';
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
  leaveSearchMode();
  return loadDirectory(target, { addToHistory: false });
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
    return `<button class="${cls}" data-action="navigate-crumb" data-path="${escapeHtml(cumulative)}">${escapeHtml(label)}</button>`;
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

  const path = order[idx];
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
  findRowByPath(path)?.scrollIntoView({ block: 'nearest' });
  onSelectionChanged();
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
  };
  const doRename = (newName) => {
    settled = true;
    // fileops.rename()'s own run() re-fetches the directory and re-renders
    // every row (including this one) on success — and reselects it there
    // too; on failure the row stays as-is under the (now orphaned) input —
    // restore the static name span.
    fileops.rename(path, newName).catch(() => { if (input.isConnected) input.replaceWith(nameEl); });
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
    if (clickMode === 'single' && row.dataset.type === 'folder') {
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
function browserKeydown(e) {
  // Never act on Browser shortcuts while a modal or the command palette has
  // focus/visibility — e.g. Ctrl+Z while a paste-conflict modal is open must
  // not also undo the last file op behind it, and typing in the palette
  // search box must not trigger F2/Delete/etc.
  const modalScrim = document.getElementById('modal-scrim');
  const propertiesScrim = document.getElementById('properties-modal-scrim');
  const paletteOpen = paletteScrim && paletteScrim.style.display !== 'none';
  if ((modalScrim && modalScrim.style.display !== 'none')
      || (propertiesScrim && propertiesScrim.style.display !== 'none')
      || paletteOpen) return;

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
  if (ctrl && key.toLowerCase() === 'x') { e.preventDefault(); fileops.cutSelection(); return; }
  if (ctrl && key.toLowerCase() === 'c') { e.preventDefault(); fileops.copySelection(); return; }
  if (ctrl && key.toLowerCase() === 'v') { e.preventDefault(); if (browserState.path) fileops.pasteInto(browserState.path).catch(fileopsReported); return; }
  if (key === 'F2') { e.preventDefault(); if (canRenameSelection() && browserState.focus) startInlineRename(browserState.focus); return; }
  if (key === 'Delete') { e.preventDefault(); fileops.trashSelection().catch(fileopsReported); return; }

  switch (key) {
    case 'ArrowDown': e.preventDefault(); moveFocus(1, { shift: e.shiftKey }); break;
    case 'ArrowUp':   e.preventDefault(); moveFocus(-1, { shift: e.shiftKey }); break;
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
    case 'F5':        e.preventDefault(); refreshDirectory(); break;
    default: break;
  }
}
