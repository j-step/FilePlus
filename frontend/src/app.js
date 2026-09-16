// ── DOM references ─────────────────────��────────────────────────────────────
const shell              = document.getElementById('shell');
const sidebar            = document.getElementById('sidebar');
const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse');
const paletteScrim       = document.getElementById('palette-scrim');
const paletteInput       = document.getElementById('palette-input');

// ── Screen switching ────────────────────────────────────────────────────────
// Screens whose backend wiring is not yet complete. Each screen's HTML carries
// its own static "Not built yet — planned for Stage N" banner (see index.html)
// — this map is now just the stage-number reference for those banners; entry
// no longer fires a stub toast (showScreenDom below).
const STUB_SCREENS = {
  'review-bin':     3,
  everything:       3,
  ftree:            4,
  'scan-config':    4,
  'scan-progress':  4,
  'scan-results':   4,
};

// Per-tab UI state model (Stage 2C Task 7)
// ─────────────────────────────────────────
// `tabs.list` holds one record per open tab; `tabs.activeId` names the active
// one. Each record owns its screen, its folder path, its own back/forward
// history, and (for the browser screen) the bits of browserState worth
// restoring — selection, scroll position, view mode. Two tabs on the same
// screen are still distinct: activating one never touches another.
//
//   activeTab()          — the active tab's record.
//   createTab(opts)       — builds a record + DOM element, does NOT activate it.
//   activateTab(id)       — saves the outgoing tab's live state into its own
//                          record, then restores the incoming one (re-fetching
//                          its folder for the browser screen — #list-scroll is
//                          shared DOM, so switching tabs always repaints it).
//   switchScreen(id)      — change the ACTIVE tab's screen in place. Sidebar
//                          navigation, keyboard shortcuts, and any other "go
//                          to screen X" entry point should call this.
//   openBrowserAt(path, {tab}) — point a tab (default: the active one) at a
//                          folder; only fetches immediately if that tab is
//                          the active one, otherwise just stages the path.
const tabs = { list: [], activeId: null };
let _tabIdSeq = 1; // unique id generator (HTML seeds the first tab as tab-1)
let _closedTabs = []; // stack of full tab records, most-recently-closed last

function nextTabId() {
  _tabIdSeq += 1;
  return `tab-${_tabIdSeq}`;
}

function activeTab() {
  return tabs.list.find(t => t.id === tabs.activeId) || null;
}

function tabRecordFor(id) {
  return tabs.list.find(t => t.id === id) || null;
}

// NOTE: 'browser' has no fixed label here — a browser tab's title always
// comes from tabLabelFor(path) (computed from the folder itself), never from
// this map. Non-browser screens still use it as-is.
const SCREEN_LABELS = {
  home:            'Home',
  browser:         'Files',
  ftree:           'File Tree',
  'scan-config':   'Scan',
  'scan-progress': 'Scan',
  'scan-results':  'Scan',
  'review-bin':    'Review Bin',
  everything:      'Everything Folder',
  settings:        'Settings',
};

const SCREEN_ICONS = {
  home: icon('home', 'fp-icon--14'),
};
const DEFAULT_TAB_ICON = icon('file', 'fp-icon--14');

function getScreenLabel(id) { return SCREEN_LABELS[id] || id; }
function getScreenIcon(id)  { return SCREEN_ICONS[id]  || DEFAULT_TAB_ICON; }

function pathBaseName(p) {
  if (!p) return '';
  // "C:\Users\Justin\Documents" → "Documents"; "D:\" → "D:"; "/" → ''
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(p);
}

/** Tab label for a browser-screen path: 'This PC' for the sandbox root
 * (loadDirectory(null)'s target — never a folder name), the bare drive
 * letter for a drive root ('D:'), the folder's basename otherwise. (A Home
 * tab's label comes from createTab's own 'Home' default, not from here —
 * this only ever runs for the browser screen, from onNavigated().) */
function tabLabelFor(path) {
  if (!path) return 'This PC';
  const norm = String(path).replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(norm)) return norm.toUpperCase();
  return pathBaseName(norm) || 'This PC';
}

/** 'Seagate Barracuda 4tb HDD (D:)' from the cached /drives list
 * (window.__fpDrives, populated by loadDrives()) — 'Local Disk (D:)' when the
 * drive has no label, or the bare letter when the drive isn't in the cache
 * yet (e.g. a breadcrumb painted before loadDrives() has resolved). */
function driveDisplayLabel(letter) {
  const norm = String(letter || '').replace(/[\\/]+$/, '').toUpperCase();
  const drives = window.__fpDrives || [];
  const d = drives.find(x => String(x.letter || '').replace(/[\\/]+$/, '').toUpperCase() === norm);
  if (!d) return norm;
  const label = (d.label || '').trim();
  return label ? `${label} (${norm})` : `Local Disk (${norm})`;
}

/** Tab element icon: home for the Home screen, a drive glyph for a browser
 * tab sitting at a drive root, a plain folder for every other browser tab,
 * and the screen's own icon (falling back to a generic file glyph) for
 * anything else. */
function tabIconFor(record) {
  if (record.screen === 'browser') {
    const norm = String(record.path || '').replace(/[\\/]+$/, '');
    return /^[A-Za-z]:$/.test(norm) ? icon('drive', 'fp-icon--14') : icon('folder', 'fp-icon--14');
  }
  return getScreenIcon(record.screen);
}

/** Syncs one tab's DOM element (icon, label, title) to its record. Never
 * touches active/aria-selected state — that belongs solely to activateTab(). */
function updateTabElementAppearance(record) {
  const el = document.querySelector(`.fp-tab[data-tab-id="${record.id}"]`);
  if (!el) return;
  const labelEl = el.querySelector('.fp-tab__label');
  if (labelEl) labelEl.textContent = record.label;
  const firstSvg = el.querySelector(':scope > svg');
  if (firstSvg) firstSvg.outerHTML = tabIconFor(record);
  el.setAttribute('title', record.label);
}

function buildTabHtml(record) {
  // Close affordance is a <span role="button">, NOT a nested <button> —
  // nesting buttons is invalid HTML and Chromium silently splits the inner
  // one out as a sibling (see index.html's seed-tab comment for the fallout).
  return `${tabIconFor(record)}<span class="fp-tab__label">${escapeHtml(record.label)}</span><span class="fp-tab__close" role="button" data-action="close-tab" title="Close tab" tabindex="-1" aria-label="Close tab">${icon('close', 'fp-icon--10')}</span>`;
}

function createTabElement(record) {
  const el = document.createElement('div');
  el.className = 'fp-tab';
  el.setAttribute('role', 'tab');
  el.setAttribute('aria-selected', 'false');
  el.setAttribute('data-tab-id', record.id);
  el.setAttribute('data-action', 'switch-tab');
  el.setAttribute('title', record.label);
  el.setAttribute('draggable', 'true');
  el.innerHTML = buildTabHtml(record);
  return el;
}

/** Builds a tab record + DOM element and inserts it into the tab strip.
 * Does NOT activate it — callers that want the new tab visible call
 * activateTab(record.id) themselves. */
function createTab({ screen = 'home', path = null, history = [], historyIndex = -1, label = 'Home' } = {}) {
  const record = {
    id: nextTabId(),
    screen, label, path,
    history: history.slice(),
    historyIndex,
    view: null,
    scrollTop: 0,
    selection: [],
    // Task 14: this tab's own search (chips + text + the rendered results),
    // or null when it is showing a plain folder listing. Captured on every
    // deactivation and repainted on reactivation, so switching tabs and back
    // keeps the results without re-walking the tree.
    search: null,
  };
  tabs.list.push(record);
  const el = createTabElement(record);
  const tabbar = document.getElementById('tabbar');
  const newTabBtn = document.getElementById('btn-new-tab');
  if (tabbar) tabbar.insertBefore(el, newTabBtn);
  initTabDrag(el);
  return record;
}

/** Copies the live browserState/nav into the currently active tab's own
 * record — the record is the only place that state lives once this tab
 * stops being active (switched away from, closed, or duplicated). */
function syncActiveTabRecord() {
  const tab = activeTab();
  if (!tab) return;
  tab.path = browserState.path;
  tab.view = browserState.view;
  tab.selection = [...browserState.selection];
  tab.historyIndex = nav.index;
  // The live search bar + its results, or null when this tab is showing a
  // plain listing (search.js's captureSearchState).
  tab.search = typeof captureSearchState === 'function' ? captureSearchState() : null;
  const listScroll = document.getElementById('list-scroll');
  if (listScroll) tab.scrollTop = listScroll.scrollTop;
}

/** Activates tab `id`: saves the outgoing tab's live state into its own
 * record, swaps browser.js's nav accessor over to the incoming tab's own
 * history (by reference), and restores the incoming tab — re-fetching its
 * folder for the browser screen, since #list-scroll is DOM shared by every
 * tab and has to be repainted on every switch either way. */
function activateTab(id) {
  const incoming = tabRecordFor(id);
  if (!incoming || incoming.id === tabs.activeId) return;

  if (tabs.activeId) syncActiveTabRecord();
  // The outgoing tab stops fetching the moment it stops being visible; its
  // chips and text are already on its record (syncActiveTabRecord above) and
  // re-run below if no results had landed yet.
  if (typeof abortSearch === 'function') abortSearch();

  tabs.activeId = id;
  document.querySelectorAll('.fp-tab').forEach(t => {
    const isActive = t.dataset.tabId === id;
    t.classList.toggle('fp-tab--active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  nav.history = incoming.history;
  nav.index = incoming.historyIndex;

  if (incoming.screen === 'browser' && incoming.search && incoming.search.results
      && typeof restoreSearchResultsForTab === 'function') {
    // This tab was showing search results: repaint them from the tab's own
    // snapshot rather than re-running the walk. browserState.path stays the
    // folder the tab was in before the search, which is where the breadcrumb's
    // × (exitSearchResults) returns to.
    showScreenDom('browser');
    browserState.path = incoming.path;
    browserState.parent = null;
    browserState.isRoot = false;
    // Apply the INCOMING tab's own view/scale before repainting its results —
    // otherwise renderDirectory() (called from inside restoreSearchResultsForTab
    // → renderSearchResults) paints them with whatever view/scale the OUTGOING
    // tab left behind (e.g. a grid Pictures tab making another tab's results
    // render as tiles). Mirrors the listing branch's restore.view handling below.
    const cfg = window.__fpConfig || {};
    const cfgView = ['details', 'list', 'grid'].includes(cfg['ui.view_mode']) ? cfg['ui.view_mode'] : 'details';
    if (typeof setViewMode === 'function') setViewMode(incoming.view || cfgView);
    if (typeof setListScale === 'function' && typeof LIST_SCALE_STEPS !== 'undefined') {
      const cfgScale = LIST_SCALE_STEPS.includes(cfg['ui.list_scale']) ? cfg['ui.list_scale'] : 1;
      setListScale(cfgScale, { persist: false });
    }
    restoreSearchResultsForTab(incoming.search);
    updateSidebarActive(incoming.path);
    refreshNavButtons();
  } else if (incoming.screen === 'browser') {
    showScreenDom('browser');
    if (typeof searchResetBar === 'function') searchResetBar();
    const loaded = loadDirectory(incoming.path, {
      // Empty history means this tab was staged in the background (openBrowserAt
      // on an inactive tab) and is only now getting its first real fetch — treat
      // that as a real navigation (push it) rather than a pure restore.
      addToHistory: incoming.history.length === 0,
      restore: { scrollTop: incoming.scrollTop, selection: incoming.selection, view: incoming.view },
    });
    // A search this tab had typed but not finished (its request was aborted
    // when it was switched away) re-runs once the folder listing underneath it
    // has landed — running the two concurrently would let the listing paint
    // over the results.
    if (incoming.search && typeof resumeSearchForTab === 'function') {
      Promise.resolve(loaded).then(() => resumeSearchForTab(incoming.search, incoming.id));
    }
  } else {
    showScreenDom(incoming.screen);
    updateSidebarActive(incoming.screen);
  }
  updateTabElementAppearance(incoming);
}

// Load a screen's DOM into view (no tab-state changes, no data fetch —
// callers own both; the browser screen's own auto-load-root fallback lives
// in switchScreen(), the one caller that can tell "never loaded" from "just
// showing what's already in #list-scroll" apart).
function showScreenDom(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${id}`);
  if (target) target.classList.add('active');
  if (id === 'home') {
    loadRecent();
    loadFavorites();
  }
}

function switchScreen(id, labelOverride) {
  // Mutate the ACTIVE tab's screen state — never switch tabs from here.
  const tab = activeTab();
  if (!tab) return;
  tab.screen = id;
  if (id === 'browser') {
    if (tab.path === null) {
      // This tab has never shown Browser before — load the sandbox root,
      // same fallback the old global navHistory-empty check used to give.
      showScreenDom('browser');
      loadDirectory(null);
    } else {
      // Already has a folder loaded, still sitting in #list-scroll from
      // earlier in this tab's life (screens are hidden, not torn down) — just
      // reveal it, no re-fetch.
      tab.label = labelOverride || tabLabelFor(tab.path);
      updateTabElementAppearance(tab);
      showScreenDom('browser');
      updateSidebarActive(tab.path);
    }
    return;
  }
  tab.label = labelOverride || getScreenLabel(id);
  updateTabElementAppearance(tab);
  showScreenDom(id);
  updateSidebarActive(id);
}

/**
 * Points tab `opts.tab` (default: the active tab) at `path`. If that tab is
 * the active one, switches to the Browser screen and loads it now (through
 * loadDirectory()/onNavigated(), which set the label/sidebar/breadcrumb
 * synchronously before the fetch). Otherwise just stages screen/path/label
 * on the (inactive) tab's own record — activateTab() does the real fetch
 * once the user actually switches to it, so a background tab is never
 * loaded before it's seen.
 */
function openBrowserAt(path, { tab } = {}) {
  const target = tab || activeTab();
  if (!target) return;
  if (target.id !== tabs.activeId) {
    target.screen = 'browser';
    target.path = path ?? null;
    target.label = tabLabelFor(target.path);
    updateTabElementAppearance(target);
    return Promise.resolve();
  }
  showScreenDom('browser');
  return loadDirectory(path);
}

function openNewTab() {
  const record = createTab({ screen: 'home', label: 'Home' });
  activateTab(record.id);
  showSnackbar('New tab opened', null, null);
  return record;
}

/** Closes tab `id`. Closing the last remaining tab opens a fresh Home tab
 * instead of quitting the app. Every closed record (full state included)
 * goes onto the _closedTabs stack for reopenLastTab(). */
function closeTabById(id) {
  const idx = tabs.list.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (id === tabs.activeId) syncActiveTabRecord();
  const record = tabs.list[idx];
  const el = document.querySelector(`.fp-tab[data-tab-id="${id}"]`);
  const wasActive = tabs.activeId === id;
  // Neighbor is read off the DOM (not tabs.list's order, which drag-reorder
  // never touches) so the fallback active tab always matches what the user
  // actually sees next to the one they closed.
  const prevEl = el?.previousElementSibling;
  const nextEl = el?.nextElementSibling;
  const neighborEl = (prevEl && prevEl.classList.contains('fp-tab')) ? prevEl
                    : (nextEl && nextEl.classList.contains('fp-tab')) ? nextEl : null;

  tabs.list.splice(idx, 1);
  el?.remove();
  _closedTabs.push(record);

  if (tabs.list.length === 0) {
    const fresh = createTab({ screen: 'home', label: 'Home' });
    activateTab(fresh.id);
  } else if (wasActive) {
    activateTab(neighborEl ? neighborEl.dataset.tabId : tabs.list[0].id);
  }
  showSnackbar('Tab closed · Ctrl+Shift+T to reopen', null, null);
}

// Backwards compat — the Ctrl+W keyboard shortcut calls this name.
function closeCurrentTab() {
  const tab = activeTab();
  if (tab) closeTabById(tab.id);
}

function reopenLastTab() {
  if (!_closedTabs.length) { showToast('No recently closed tabs', 'warn'); return; }
  const record = _closedTabs.pop();
  const restored = createTab({
    screen: record.screen,
    path: record.path,
    history: record.history,
    historyIndex: record.historyIndex,
    label: record.label,
  });
  restored.view = record.view;
  restored.scrollTop = record.scrollTop;
  restored.selection = record.selection;
  activateTab(restored.id);
}

function duplicateTab(id) {
  const source = tabRecordFor(id);
  if (!source) return;
  if (source.id === tabs.activeId) syncActiveTabRecord();
  const sourceEl = document.querySelector(`.fp-tab[data-tab-id="${id}"]`);
  const copy = createTab({
    screen: source.screen,
    path: source.path,
    history: source.history.slice(),
    historyIndex: source.historyIndex,
    label: source.label,
  });
  copy.view = source.view;
  copy.selection = source.selection.slice();
  copy.scrollTop = source.scrollTop;
  // Place the duplicate right after its source, matching a browser's
  // "Duplicate tab" placement, instead of at the end of the strip.
  const copyEl = document.querySelector(`.fp-tab[data-tab-id="${copy.id}"]`);
  if (sourceEl && copyEl) sourceEl.insertAdjacentElement('afterend', copyEl);
  activateTab(copy.id);
}

function closeOtherTabs(id) {
  if (!tabRecordFor(id)) return;
  if (tabs.activeId !== id) activateTab(id);
  [...tabs.list].forEach(t => { if (t.id !== id) closeTabById(t.id); });
}

/** Registers the statically-authored seed tab (index.html's tab-1) into the
 * tabs model at boot — every other tab is created through createTab(). */
function seedInitialTab() {
  const el = document.querySelector('.fp-tab[data-tab-id]');
  const id = el ? el.dataset.tabId : 'tab-1';
  const record = { id, screen: 'home', label: 'Home', path: null, history: [], historyIndex: -1, view: null, scrollTop: 0, selection: [], search: null };
  tabs.list.push(record);
  tabs.activeId = id;
  nav.history = record.history;
  nav.index = record.historyIndex;
}

/**
 * Runs synchronously at the START of loadDirectory(), before the network
 * fetch — updates everything derivable from the path STRING alone (tab
 * label/icon, sidebar highlight, breadcrumb) so none of it waits on the
 * network, and none of it gets rewritten a second time once the fetch
 * resolves (the old syncActiveTabPath()/data-manual-active flash). Only ever
 * called from inside loadDirectory() — never at module load time.
 */
function onNavigated(path) {
  const tab = activeTab();
  if (tab) {
    tab.screen = 'browser';
    tab.label = tabLabelFor(path);
    updateTabElementAppearance(tab);
  }
  updateSidebarActive(path);
  if (path) updateBreadcrumb(path);
}

// ── Sidebar active-state machinery ────────────────────────────────────────────
// Exactly ONE sidebar item carries --active at any time — this is the single
// place that decides which one, called synchronously from onNavigated() (a
// browser-screen path, including null for the sandbox root) and from
// activateTab()/switchScreen() (a non-browser screen id). No other code
// touches .fp-sidebar__item--active.
//
// Two modes:
//   Screen-only items  — active when data-screen matches pathOrScreen AND
//                        they have no data-path (they are not path-bound).
//   Path-bound items   — active when pathOrScreen is a real path and their
//                        data-path is its longest matching prefix.
function updateSidebarActive(pathOrScreen) {
  const items = document.querySelectorAll('.fp-sidebar__item');
  items.forEach(it => {
    it.classList.remove('fp-sidebar__item--active');
    it.classList.remove('active');
  });

  const isKnownScreen = typeof pathOrScreen === 'string'
    && pathOrScreen !== 'browser'
    && Object.prototype.hasOwnProperty.call(SCREEN_LABELS, pathOrScreen);
  if (isKnownScreen) {
    items.forEach(it => {
      if (it.dataset.screen === pathOrScreen && !it.dataset.path) {
        it.classList.add('fp-sidebar__item--active');
      }
    });
    return;
  }

  // A real filesystem path (or null/'' for the sandbox root, which has no
  // sidebar entry to highlight) — match the longest data-path prefix.
  const currentPath = String(pathOrScreen || '').toLowerCase();
  if (!currentPath) return;

  let bestMatch = null;
  let bestMatchLen = 0;

  items.forEach(it => {
    const itemPath = (it.dataset.path || '').toLowerCase();
    if (!itemPath) return;

    // Normalize trailing separator for comparison.
    const normalised = itemPath.replace(/[\\\/]+$/, '');
    const matchesSelf  = currentPath === normalised;
    const matchesChild = currentPath.startsWith(normalised + '\\') ||
                         currentPath.startsWith(normalised + '/');

    if ((matchesSelf || matchesChild) && itemPath.length > bestMatchLen) {
      bestMatch = it;
      bestMatchLen = itemPath.length;
    }
  });

  if (bestMatch) {
    bestMatch.classList.add('fp-sidebar__item--active');
  }
}

// ── Sidebar collapse + drag-resize ────────────────────────────────────────────
// VSCode-like hysteresis model: cursor X drives the panel width directly while
// dragging, with a "dead zone" between collapsed (52) and the expanded floor (180).
//   - Cursor X below TRIGGER (100) → collapsed
//   - Cursor X in [TRIGGER, MIN] → panel locked at MIN (visual lock zone)
//   - Cursor X above MIN → panel width = cursor X, capped at MAX
// Snap direction switches at the same TRIGGER, so the act of snapping (which
// moves the panel) creates the natural hysteresis preventing flicker.
const SIDEBAR_WIDTH_MAX        = 480; // px; absolute maximum draggable width
const SIDEBAR_WIDTH_MIN        = 180; // px; minimum expanded width (lock position)
const SIDEBAR_COLLAPSE_TRIGGER = 100; // px; cursor X — going IN past this collapses, going OUT past this expands
const SIDEBAR_EXPANDED_DEFAULT = 240;
const SIDEBAR_COLLAPSED_WIDTH  = 52;

function setSidebarCollapsed(collapsed) {
  if (!shell || !sidebar) return;
  if (collapsed) {
    shell.classList.add('sidebar-collapsed');
    sidebar.classList.add('fp-sidebar--collapsed');
    document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_COLLAPSED_WIDTH + 'px');
  } else {
    shell.classList.remove('sidebar-collapsed');
    sidebar.classList.remove('fp-sidebar--collapsed');
    const saved = parseInt(localStorage.getItem('fp-sidebar-width'), 10);
    const w = (saved && saved >= SIDEBAR_WIDTH_MIN && saved <= SIDEBAR_WIDTH_MAX) ? saved : SIDEBAR_EXPANDED_DEFAULT;
    document.documentElement.style.setProperty('--sidebar-width', w + 'px');
  }
  localStorage.setItem('fp-sidebar-collapsed', collapsed ? 'on' : 'off');
}

function toggleSidebar() {
  const isCollapsed = sidebar && sidebar.classList.contains('fp-sidebar--collapsed');
  setSidebarCollapsed(!isCollapsed);
}

function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  if (!handle || !sidebar) return;

  let dragging = false;

  handle.addEventListener('pointerdown', e => {
    dragging = true;
    handle.classList.add('fp-sidebar__resize-handle--active');
    sidebar.classList.add('fp-sidebar--dragging');
    shell.classList.add('sidebar-dragging');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    // VSCode-like model: cursor X drives the panel width directly. The dead
    // zone between TRIGGER and MIN keeps the panel locked at MIN until the
    // cursor pulls past MIN, then 1:1 follows. Below TRIGGER → collapsed.
    const cursorX = e.clientX;
    const isCollapsed = sidebar.classList.contains('fp-sidebar--collapsed');

    if (isCollapsed) {
      if (cursorX >= SIDEBAR_COLLAPSE_TRIGGER) {
        // Cursor crossed back over the trigger — snap to expanded at MIN
        setSidebarCollapsed(false);
        document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_WIDTH_MIN + 'px');
      }
      // else: stay collapsed, no visual change
    } else {
      if (cursorX < SIDEBAR_COLLAPSE_TRIGGER) {
        // Crossed below trigger while expanded — snap to collapsed
        setSidebarCollapsed(true);
      } else if (cursorX <= SIDEBAR_WIDTH_MIN) {
        // Dead zone — lock at MIN regardless of cursor position
        document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_WIDTH_MIN + 'px');
      } else {
        // Cursor past MIN — width follows cursor 1:1, capped at MAX
        const w = Math.min(SIDEBAR_WIDTH_MAX, cursorX);
        document.documentElement.style.setProperty('--sidebar-width', w + 'px');
      }
    }
  });

  handle.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('fp-sidebar__resize-handle--active');
    sidebar.classList.remove('fp-sidebar--dragging');
    shell.classList.remove('sidebar-dragging');
    // Persist final width if expanded
    if (!sidebar.classList.contains('fp-sidebar--collapsed')) {
      const finalWidth = sidebar.getBoundingClientRect().width;
      const w = Math.max(SIDEBAR_WIDTH_MIN, Math.round(finalWidth));
      localStorage.setItem('fp-sidebar-width', String(w));
      document.documentElement.style.setProperty('--sidebar-width', w + 'px');
    }
    handle.releasePointerCapture(e.pointerId);
  });
}

function restoreSidebarState() {
  const collapsed = localStorage.getItem('fp-sidebar-collapsed') === 'on';
  const saved = parseInt(localStorage.getItem('fp-sidebar-width'), 10);
  if (collapsed) {
    setSidebarCollapsed(true);
  } else if (saved && saved >= 180 && saved <= 480) {
    document.documentElement.style.setProperty('--sidebar-width', saved + 'px');
  } else {
    document.documentElement.style.setProperty('--sidebar-width', SIDEBAR_EXPANDED_DEFAULT + 'px');
  }
}

// ── Sidebar device name ───────────────────────────────────────────────────────
// Editable label at the top of the sidebar — defaults to OS hostname, can be
// renamed by double-clicking. The chosen name persists in localStorage.
function initDeviceName() {
  const el = document.getElementById('sb-device-name');
  if (!el) return;
  const saved = localStorage.getItem('fp-device-name');
  const fallback = (window.electronAPI?.hostname?.() || 'My PC').trim() || 'My PC';
  el.textContent = saved || fallback;

  el.addEventListener('dblclick', () => {
    el.setAttribute('contenteditable', 'plaintext-only');
    el.focus();
    // Select all so the user can just start typing to replace
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  function commit() {
    el.removeAttribute('contenteditable');
    const next = (el.textContent || '').trim().slice(0, 80) || fallback;
    el.textContent = next;
    localStorage.setItem('fp-device-name', next);
  }

  el.addEventListener('blur',    commit);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); el.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); el.textContent = saved || fallback; el.blur(); }
  });
}

// ── Toolbar layout ─────────────────────────────────────────────────
// The old JS resize model (initToolbarResponsive: a ResizeObserver +
// MutationObserver pair that measured the breadcrumb every frame and wrote a
// pixel width onto the search bar, collapsing it to an icon below a threshold)
// is gone — Task 14's layout is pure CSS (styles.css §7/§9/§10, design §8.3):
// #breadcrumb-wrap flexes and is right-anchored with a leading mask fade, and
// #search-wrap grows with its own content (field-sizing: content, with
// search.js's measuring-span fallback) up to 60% of the toolbar. Nothing has
// to run per frame, and the search bar no longer collapses into a button that
// opened the palette instead of searching.

// The toolbar stays on one line at every width: the breadcrumb yields its
// space first (it can shrink to nothing under its fade), then the search bar
// folds into a single magnifier button, and the nav/View/Sort/Inspector/Theme
// buttons never move. The only thing JS decides is WHEN that fold happens —
// once per resize, never per frame.
const TOOLBAR_SEARCH_MIN = 140;  // px the expanded search bar wants
const TOOLBAR_PATH_MIN   = 120;  // px the breadcrumb wants before the bar folds

function initToolbarNarrowMode() {
  const toolbar = document.getElementById('toolbar');
  if (!toolbar || typeof ResizeObserver === 'undefined') return;

  function recalc() {
    const style = getComputedStyle(toolbar);
    const gap = parseFloat(style.gap) || 0;
    let fixed = 0;
    let visible = 0;
    for (const child of toolbar.children) {
      const width = child.getBoundingClientRect().width;
      if (width === 0) continue;
      visible++;
      // The two flexible children are excluded so the measurement cannot
      // change as a result of the mode it decides — no oscillation.
      if (child.id === 'search-wrap' || child.id === 'breadcrumb-wrap') continue;
      fixed += width;
    }
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const available = toolbar.clientWidth - padding - gap * Math.max(0, visible - 1);
    toolbar.toggleAttribute('data-narrow', available < fixed + TOOLBAR_SEARCH_MIN + TOOLBAR_PATH_MIN);
  }

  new ResizeObserver(recalc).observe(toolbar);
  recalc();
}

// ── Command palette ───────────────────────────────���──────────────────────��─────
function openPalette() {
  if (!paletteScrim) return;
  paletteScrim.style.display = 'flex';
  paletteScrim.removeAttribute('aria-hidden');
  if (paletteInput) { paletteInput.value = ''; paletteInput.focus(); }
  paletteResetToCommands();
}

function closePalette() {
  if (!paletteScrim) return;
  paletteScrim.style.display = 'none';
  paletteScrim.setAttribute('aria-hidden', 'true');
}

// ── Palette → toolbar search (Task 14, design §8.5) ────────────────────
// The palette no longer runs its own GET /search: one search code path, and
// it is the toolbar bar. Typing at least one character puts a single command
// at the top of the list — "Search files for '<text>'" — which hands the text
// to search.js and shows the results in the Browser like any other search.
const PALETTE_MIN_CHARS = 1;

/** Every visible (not display:none-ancestor'd), non-disabled palette item —
 * whichever group (the search command or Commands) is currently shown. */
function paletteVisibleItems() {
  return [...document.querySelectorAll('#palette-search-pane .fp-palette__item:not([disabled])')]
    .filter(el => el.offsetParent !== null);
}

function paletteSelectFirst() {
  const items = paletteVisibleItems();
  items.forEach(i => i.classList.remove('fp-palette__item--selected'));
  if (items[0]) items[0].classList.add('fp-palette__item--selected');
}

function paletteResetToCommands() {
  const resultsEl = document.getElementById('palette-search-results');
  const commandsEl = document.getElementById('palette-commands');
  if (resultsEl) resultsEl.innerHTML = '';
  if (commandsEl) commandsEl.style.display = '';
  paletteSelectFirst();
}

paletteInput?.addEventListener('input', () => {
  const q = paletteInput.value.trim();
  const resultsEl = document.getElementById('palette-search-results');
  if (!resultsEl) return;
  if (q.length < PALETTE_MIN_CHARS) {
    paletteResetToCommands();
    return;
  }
  resultsEl.innerHTML = `<button class="fp-palette__item" role="option"
      data-action="palette-search-files" data-query="${escapeHtml(q)}">
      ${icon('search', 'fp-icon--14 fp-palette__item-icon')}
      <span>Search files for “${escapeHtml(q)}”</span>
    </button>`;
  paletteSelectFirst();
});

paletteInput?.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
  const items = paletteVisibleItems();
  if (!items.length) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    const sel = items.find(i => i.classList.contains('fp-palette__item--selected'));
    if (sel) sel.click();
    return;
  }
  e.preventDefault();
  let idx = items.findIndex(i => i.classList.contains('fp-palette__item--selected'));
  idx = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
  items.forEach(i => i.classList.remove('fp-palette__item--selected'));
  items[idx].classList.add('fp-palette__item--selected');
  items[idx].scrollIntoView({ block: 'nearest' });
});

function handlePaletteAction(btn) {
  const { action, screen: screenTarget } = btn.dataset;
  if (action === 'navigate-screen' && screenTarget) switchScreen(screenTarget);
  if (action === 'toggle-theme')   toggleTheme();
  if (action === 'toggle-sidebar') toggleSidebar();
  if (action === 'toggle-inspector') toggleInspector();
  closePalette();
}

// Palette Search/Chat mode switch (A.11.1)
function setPaletteMode(mode) {
  const searchPane = document.getElementById('palette-search-pane');
  const chatPane   = document.getElementById('palette-chat-pane');
  const toggle     = document.getElementById('palette-mode-toggle');
  if (searchPane) searchPane.style.display = mode === 'search' ? '' : 'none';
  if (chatPane)   chatPane.style.display   = mode === 'chat' ? '' : 'none';
  toggle?.querySelectorAll('.fp-segmented__opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  if (paletteInput) {
    paletteInput.placeholder = mode === 'search'
      ? 'Type a command, path, or question…'
      : 'Ask Claude anything about your files…';
  }
}

// ── Tag canvas (A.11.2) ───────────────────────────────────────────────────────
function openTagCanvas() {
  const scrim = document.getElementById('tag-canvas-scrim');
  if (!scrim) return;
  scrim.style.display = 'flex';
  scrim.removeAttribute('aria-hidden');
}

function closeTagCanvas() {
  const scrim = document.getElementById('tag-canvas-scrim');
  if (!scrim) return;
  scrim.style.display = 'none';
  scrim.setAttribute('aria-hidden', 'true');
}

// ── Ask File+ (Task 15, design spec §9) ─────────────────────────────────────
// Visible shell only — no model wired until Stage 3. Opens a popover anchored
// to the sidebar's .fp-ask button; Send stays permanently disabled and
// nothing here ever calls the backend.
function askPopoutOpen() {
  const popout = document.getElementById('ask-popout');
  return !!popout && popout.style.display !== 'none';
}

function openAskPopout() {
  const popout = document.getElementById('ask-popout');
  const btn = document.getElementById('btn-ask-fileplus');
  if (!popout || !btn) return;
  popout.style.display = 'flex';
  // Anchor to the button's bottom-left, clamped to the viewport — the same
  // getBoundingClientRect() technique showContextMenu()'s {anchor} branch
  // uses for the View/Sort toolbar dropdowns.
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  popout.style.left = `${Math.min(r.left, vw - popout.offsetWidth - 8)}px`;
  popout.style.top  = `${Math.min(r.bottom + 6, vh - popout.offsetHeight - 8)}px`;
  document.getElementById('ask-input')?.focus();
}

function closeAskPopout() {
  // Fix round 1 (Task 16): the global Escape handler calls closeAskPopout()
  // unconditionally (it also closes the palette, Properties modal, etc.), so
  // the focus-return below must only fire when the popout was actually open
  // -- otherwise every unrelated Escape steals focus to the Ask File+ pill.
  // Mirrors the open-check the outside-click handler already uses.
  const wasOpen = askPopoutOpen();
  const popout = document.getElementById('ask-popout');
  if (popout) popout.style.display = 'none';
  if (wasOpen) document.getElementById('btn-ask-fileplus')?.focus();
}

function toggleAskPopout() {
  if (askPopoutOpen()) closeAskPopout();
  else openAskPopout();
}

// ── Confirmation modal (A.11.3) ───────────────────────────────────────────────
// The modal can close via several independent paths — the Cancel button, a
// backdrop click, Escape, an extraActions button, or the default Confirm
// button — and a caller that needs to know "the modal closed, however that
// happened" (fileops.resolveConflicts, to settle its promise and avoid a
// leaked handler) registers config.onClose. closeModal() invokes it exactly
// once per open() and clears it, so it fires regardless of which path closed
// the modal and never double-fires or leaks into the next modal.
let _modalOnClose = null;

function openModal(type, config = {}) {
  const scrim   = document.getElementById('modal-scrim');
  const icon    = document.getElementById('modal-icon');
  const title   = document.getElementById('modal-title');
  const body    = document.getElementById('modal-body');
  const confirm = document.getElementById('modal-confirm');
  const confirmRow = document.getElementById('modal-confirm-input-row');
  const confirmWord = document.getElementById('modal-confirm-word');
  const textInputRow = document.getElementById('modal-text-input-row');
  const textInput = document.getElementById('modal-text-input');
  if (!scrim) return;

  // Icon: danger uses the sprite's error glyph in bad, warn uses warning in warn.
  const isDanger = type === 'danger';
  if (icon) {
    icon.style.color = isDanger ? 'var(--bad)' : 'var(--warn)';
    const iconUse = icon.querySelector('use');
    if (iconUse) iconUse.setAttribute('href', `#fp-${isDanger ? 'error' : 'warning'}`);
  }
  if (title)   title.textContent  = config.title   || 'Confirm';
  if (body)    body.textContent   = config.body    || '';
  if (confirm) {
    confirm.textContent = config.confirmLabel || (isDanger ? 'Delete' : 'Confirm');
    confirm.className = `fp-btn fp-btn--sm ${isDanger ? 'fp-btn--danger' : 'fp-btn--primary'}`;
    // onConfirm may return false to veto the close (e.g. client-side
    // validation failure) — any other return value (including undefined,
    // the common case) closes the modal as before.
    confirm.onclick = () => {
      if (config.confirmWord) {
        const typed = (document.getElementById('modal-confirm-text')?.value || '').trim();
        if (typed.toUpperCase() !== config.confirmWord.toUpperCase()) {
          showToast(`Type ${config.confirmWord} to confirm`, 'error');
          document.getElementById('modal-confirm-text')?.focus();
          return;
        }
      }
      if (config.onConfirm && config.onConfirm() === false) return;
      closeModal();
    };
  }
  // Typed confirmation (optional)
  if (config.confirmWord && confirmRow && confirmWord) {
    confirmWord.textContent = config.confirmWord;
    confirmRow.style.display = '';
    const confirmText = document.getElementById('modal-confirm-text');
    if (confirmText) confirmText.value = ''; // never carry over a previous modal's typed word
  } else if (confirmRow) {
    confirmRow.style.display = 'none';
  }

  // Free-text input (optional) — e.g. the sidebar-pin rename modal.
  if (config.textInput && textInputRow && textInput) {
    textInputRow.style.display = '';
    textInput.value = config.textInput.value || '';
    textInput.placeholder = config.textInput.placeholder || '';
    requestAnimationFrame(() => textInput.focus());
  } else if (textInputRow) {
    textInputRow.style.display = 'none';
  }

  // Extra action buttons (optional) — e.g. the paste-conflict modal's
  // Replace / Skip / Keep both. Replaces the default Confirm button; Cancel
  // (wired separately, outside openModal()) stays available either way.
  const extraRow = document.getElementById('modal-extra-actions');
  if (config.extraActions && config.extraActions.length && extraRow) {
    extraRow.innerHTML = '';
    config.extraActions.forEach(a => {
      const b = document.createElement('button');
      b.className = `fp-btn fp-btn--sm ${a.variant ? `fp-btn--${a.variant}` : 'fp-btn--secondary'}`;
      b.style.cssText = 'width:100%;justify-content:flex-start';
      b.textContent = a.label;
      b.addEventListener('click', () => { a.onClick(); closeModal(); });
      extraRow.appendChild(b);
    });
    extraRow.style.display = 'flex';
    if (confirm) confirm.style.display = 'none';
  } else {
    if (extraRow) extraRow.style.display = 'none';
    if (confirm) confirm.style.display = '';
  }

  _modalOnClose = typeof config.onClose === 'function' ? config.onClose : null;

  scrim.style.display = 'flex';
  scrim.removeAttribute('aria-hidden');
}

function closeModal() {
  const scrim = document.getElementById('modal-scrim');
  const onClose = _modalOnClose;
  _modalOnClose = null;
  if (scrim) {
    scrim.style.display = 'none';
    scrim.setAttribute('aria-hidden', 'true');
  }
  if (onClose) onClose();
}

// ── Theme toggle ─────────��─────────────────────────────────────────────────────
const THEME_MODES = ['dark', 'light', 'system'];
const _systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let _systemListenerAttached = false;

function resolveTheme(mode) {
  return mode === 'system' ? (_systemDark.matches ? 'dark' : 'light') : mode;
}

// Flips the RESOLVED theme's opposite (dark <-> light) and persists that as
// an explicit choice — never lands on 'system'. "Follow Windows" stays
// available only in Settings (settings-set-theme, below). Root cause of the
// old two-click bug (design spec §3.9): the previous cycle went
// dark -> light -> system, so from "system resolving dark" the first click
// landed on "dark" with no visible change.
function toggleTheme() {
  const current = localStorage.getItem('fp-theme') || 'system';
  const next = resolveTheme(current) === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  saveSetting('ui.theme', next);
}

function applyTheme(mode) {
  if (!THEME_MODES.includes(mode)) mode = 'system';
  const html = document.documentElement;
  const resolved = resolveTheme(mode);
  html.dataset.theme = resolved;
  html.dataset.themeMode = mode;
  localStorage.setItem('fp-theme', mode);
  if (window.electronAPI?.setThemeSource) window.electronAPI.setThemeSource(mode);
  if (mode === 'system' && !_systemListenerAttached) {
    _systemDark.addEventListener('change', () => {
      if ((localStorage.getItem('fp-theme') || 'system') === 'system') applyTheme('system');
    });
    _systemListenerAttached = true;
  }
  document.querySelectorAll('[data-action="settings-set-theme"]').forEach(btn => {
    const v = btn.dataset.theme || btn.dataset.val;
    btn.classList.toggle('active', v === mode);
  });
  // Toolbar toggle's icon tracks the RESOLVED theme (not the picked mode —
  // 'system' resolves to whichever the OS currently reports).
  const themeIconUse = document.querySelector('#btn-theme use');
  if (themeIconUse) themeIconUse.setAttribute('href', `#fp-theme-${resolved}`);
}

// ── Zoom — uses Electron webContents.setZoomFactor when in Electron (no layout cut-off),
//           falls back to CSS zoom for non-Electron contexts (tests/browser).
const ZOOM_STEPS   = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.33, 1.5, 1.75, 2.0];
const ZOOM_DEFAULT = 1.0;
function getCurrentZoom() {
  if (window.electronAPI?.getZoom) return window.electronAPI.getZoom();
  const z = parseFloat(document.documentElement.style.zoom);
  return isNaN(z) ? ZOOM_DEFAULT : z;
}

// Status-bar zoom pill — visible only when zoom != 100%, click resets.
function updateZoomPill() {
  const pill = document.getElementById('status-zoom-pill');
  const sep  = document.getElementById('status-zoom-sep');
  if (!pill) return;
  const z = getCurrentZoom();
  const pct = Math.round(z * 100);
  pill.textContent = pct + '%';
  // Treat 99–101% as "100%" to absorb floating-point drift around the default.
  const atDefault = Math.abs(z - ZOOM_DEFAULT) < 0.005;
  pill.style.display = atDefault ? 'none' : '';
  if (sep) sep.style.display = atDefault ? 'none' : '';
}

function zoomIn() {
  if (window.electronAPI?.zoomIn) {
    window.electronAPI.zoomIn();
    updateZoomPill();
    return;
  }
  // Fallback for non-Electron
  const cur = getCurrentZoom();
  const next = ZOOM_STEPS.find(s => s > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  document.documentElement.style.zoom = String(next);
  localStorage.setItem('fp-zoom', String(next));
  updateZoomPill();
}
function zoomOut() {
  if (window.electronAPI?.zoomOut) {
    window.electronAPI.zoomOut();
    updateZoomPill();
    return;
  }
  // Fallback for non-Electron
  const cur = getCurrentZoom();
  const prev = [...ZOOM_STEPS].reverse().find(s => s < cur - 0.001) ?? ZOOM_STEPS[0];
  document.documentElement.style.zoom = String(prev);
  localStorage.setItem('fp-zoom', String(prev));
  updateZoomPill();
}
function zoomReset() {
  if (window.electronAPI?.zoomReset) {
    window.electronAPI.zoomReset();
    document.documentElement.style.zoom = '';
    localStorage.removeItem('fp-zoom');
    updateZoomPill();
    return;
  }
  document.documentElement.style.zoom = '';
  localStorage.removeItem('fp-zoom');
  updateZoomPill();
}

// ── Context-menu applicability (Task 11, playtest pass 1 §4.2) ─────────────
// Shared enabled(ctx)/label(ctx) predicates, built from buildMenuContext()'s
// ctx = { selection, target, favoritesSet, clipboard } (defined further
// below, next to getMenuTypeForTarget). An item with no `enabled` is always
// enabled, matching showContextMenu's existing "unknown field is simply
// never read" contract for `checked`.

/** Open: a single item; or several items that are all files (no folders, no
 * access-denied rows) sharing one non-empty extension. */
function cmOpenEnabled(ctx) {
  const sel = ctx.selection || [];
  if (sel.length === 0) return false;
  if (sel.length === 1) return true;
  if (sel.some(e => !e || e.is_dir || e.error)) return false;
  const exts = new Set(sel.map(e => String(e.ext || '').toLowerCase()));
  return exts.size === 1 && [...exts][0] !== '';
}
/** Open with…, Properties: single item only. (Rename has its own identical-
 * by-construction rule, browser.js's canRenameSelection() — kept separate so
 * it stays the one shared source of truth with the F2 keyboard shortcut,
 * Task 11 fix round 1, rather than incidentally matching this one.) */
function cmSingleEnabled(ctx) { return (ctx.selection || []).length === 1; }
/** Pin to sidebar, Index for search: a single FOLDER only. */
function cmSingleFolderEnabled(ctx) {
  const sel = ctx.selection || [];
  return sel.length === 1 && !!sel[0] && !!sel[0].is_dir;
}
/** Cut, Copy, Delete, Add tag, Add/Remove favorites: any (non-empty) count. */
function cmAnyEnabled(ctx) { return (ctx.selection || []).length > 0; }
/** Paste: only when the clipboard actually holds something. */
function cmClipboardEnabled(ctx) { return (ctx.clipboard || 0) > 0; }
/** Add/Remove Favorites label — "Remove" only when EVERY selected item (or
 * the single Home row) is already favorited; "Add" otherwise, including an
 * empty selection (the item is disabled then anyway, via cmAnyEnabled). */
function cmFavoriteLabel(ctx) {
  const sel = ctx.selection || [];
  const allFav = sel.length > 0 && ctx.favoritesSet
    && sel.every(e => e && ctx.favoritesSet.has(String(e.path || '').toLowerCase()));
  return allFav ? 'Remove from Favorites' : 'Add to Favorites';
}

// ── Context menu ──────────────────────────────────────────────────────────────
// A.10: five menu type definitions (items rendered dynamically into #context-menu)
const CONTEXT_MENUS = {
  // A.10.1 — File context menu
  // "Open in new tab" is folder-only (Task 11 fix round 1 ruling) — it never
  // appears here at all (visible, not merely disabled: a file's own "open in
  // a new tab" concept doesn't exist), and stays unconditional on the folder
  // menu below.
  file: [
    { label: 'Open',            action: 'cm-open',            icon: icon('open', 'fp-icon--14'), enabled: cmOpenEnabled },
    { label: 'Open with…',      action: 'cm-open-with',       enabled: cmSingleEnabled },
    'sep',
    { label: 'Cut',    action: 'cm-cut',    kbd: 'Ctrl+X', enabled: cmAnyEnabled },
    { label: 'Copy',   action: 'cm-copy',   kbd: 'Ctrl+C', enabled: cmAnyEnabled },
    { label: 'Paste',  action: 'cm-paste',  kbd: 'Ctrl+V', enabled: cmClipboardEnabled },
    // Same rule, same predicate as the F2 keyboard shortcut
    // (browser.js's browserKeydown) — canRenameSelection() is the one
    // shared source of truth for both (Task 11 fix round 1).
    { label: 'Rename', action: 'cm-rename', kbd: 'F2', enabled: () => canRenameSelection() },
    { label: 'Delete', action: 'cm-delete', kbd: 'Del', danger: true, icon: icon('delete', 'fp-icon--14'), enabled: cmAnyEnabled },
    'sep',
    { label: 'Add tag…',         action: 'cm-add-tag',     icon: icon('tag', 'fp-icon--14'), enabled: cmAnyEnabled },
    { label: cmFavoriteLabel,    action: 'cm-favorite',    enabled: cmAnyEnabled },
    'sep',
    { label: 'Properties',             action: 'cm-properties', enabled: cmSingleEnabled },
    { label: 'Show in Windows Explorer', action: 'cm-reveal-explorer' },
  ],

  // A.10.2 — Folder context menu
  folder: [
    { label: 'Open',             action: 'cm-open', icon: icon('folder', 'fp-icon--14'), enabled: cmOpenEnabled },
    { label: 'Open in new tab',  action: 'cm-open-new-tab' },
    'sep',
    { label: 'Cut',    action: 'cm-cut',    kbd: 'Ctrl+X', enabled: cmAnyEnabled },
    { label: 'Copy',   action: 'cm-copy',   kbd: 'Ctrl+C', enabled: cmAnyEnabled },
    { label: 'Paste',  action: 'cm-paste',  kbd: 'Ctrl+V', enabled: cmClipboardEnabled },
    { label: 'Rename', action: 'cm-rename', kbd: 'F2', enabled: () => canRenameSelection() },
    { label: 'Delete', action: 'cm-delete', kbd: 'Del', danger: true, icon: icon('delete', 'fp-icon--14'), enabled: cmAnyEnabled },
    'sep',
    { label: 'New folder inside', action: 'cm-new-folder' },
    { label: 'New file',          action: 'cm-new-file' },
    'sep',
    { label: cmFavoriteLabel,      action: 'cm-favorite',      enabled: cmAnyEnabled },
    { label: 'Pin to sidebar',     action: 'cm-pin-sidebar',   enabled: cmSingleFolderEnabled },
    { label: 'Index for This PC search', action: 'cm-index-folder', enabled: cmSingleFolderEnabled },
    'sep',
    { label: 'Properties',              action: 'cm-properties', enabled: cmSingleEnabled },
    { label: 'Show in Windows Explorer', action: 'cm-reveal-explorer' },
  ],

  // A.10.3 — Empty area context menu (targets the current folder itself, not
  // a selection — Properties and the rest stay unconditionally enabled).
  'empty-area': [
    { label: 'New folder', action: 'cm-new-folder', icon: icon('folder-add', 'fp-icon--14') },
    { label: 'New file',   action: 'cm-new-file' },
    { label: 'Paste',      action: 'cm-paste',      kbd: 'Ctrl+V', enabled: cmClipboardEnabled },
    { label: 'Refresh',    action: 'cm-refresh',    kbd: 'F5' },
    'sep',
    { label: 'View → Details',    action: 'cm-view-list' },
    { label: 'View → Grid',       action: 'cm-view-grid' },
    { label: 'Sort by → name',    action: 'cm-sort-name' },
    { label: 'Sort by → modified', action: 'cm-sort-modified' },
    'sep',
    { label: ctx => browserState.showHidden ? 'Hide hidden files' : 'Show hidden files', action: 'cm-toggle-hidden' },
    { label: 'Properties',        action: 'cm-properties' },
  ],

  // A.10.4 — Tab context menu
  tab: [
    { label: 'New tab',            action: 'cm-new-tab' },
    { label: 'Duplicate tab',      action: 'cm-duplicate-tab' },
    'sep',
    { label: 'Close tab',          action: 'cm-close-tab',  kbd: 'Ctrl+W' },
    { label: 'Close other tabs',   action: 'cm-close-other-tabs' },
  ],

  // A.10.5 — Sidebar item context menu (pinned folders and Quick Access known
  // folders — see getMenuTypeForTarget). Unpin/Rename apply to pins only;
  // Remove from Quick Access applies to known folders only; a drive gets
  // neither (its sidebar item carries neither data-pin-id nor data-known-id,
  // so both predicates read false for it) — visible(ctx) reads ctx.target
  // (the resolved .fp-sidebar__item element itself) and OMITS whichever pair
  // doesn't match the right-clicked item's kind (Task 11 fix round 1 ruling:
  // never-applicable-to-this-kind is a hide, not a grey — replacing both the
  // ad hoc .filter() Task 9/10 used and Task 11's own initial enabled(ctx)
  // pass, which greyed these instead of hiding them).
  'sidebar-item': [
    { label: 'Open in new tab',          action: 'cm-open-new-tab' },
    { label: 'Unpin',                    action: 'cm-unpin-sidebar',        visible: ctx => !!ctx.target?.dataset?.pinId },
    { label: 'Rename label',             action: 'cm-rename-sidebar-item',  visible: ctx => !!ctx.target?.dataset?.pinId },
    { label: 'Remove from Quick Access', action: 'cm-quick-access-remove',  visible: ctx => !!ctx.target?.dataset?.knownId },
  ],

  // A.10.6 — Home row context menu (Recent + Favorites rows). "Add/Remove
  // from Favorites" label reflects buildMenuContext's single-row selection.
  'home-row': [
    { label: 'Open',               action: 'open-file' },
    { label: 'Reveal in Browser',  action: 'reveal-file' },
    { label: 'Copy path',          action: 'copy-path' },
    'sep',
    { label: cmFavoriteLabel,      action: 'home-toggle-favorite' },
  ],
};

// ── Inspector "…" menu (Task 13) ──────────────────────────────────────────────
// Single item so far — Properties, single-selection only (design spec §5.1:
// "Properties is single-item only in this pass"). Opened below the button by
// the same showContextMenu({anchor}) the View/Sort toolbar dropdowns use.
const INSPECTOR_MORE_MENU_ITEMS = [
  { label: 'Properties', action: 'inspector-properties', enabled: () => browserState.selection.size === 1 },
];

// ── View / Sort toolbar dropdowns (Task 10) ─────────────────────────────────
// Windows-Explorer-style menus opened below the toolbar's View/Sort buttons
// (data-action="open-view-menu"/"open-sort-menu"), replacing the old
// List/Grid segmented toggle. Both share showContextMenu() with the rest of
// the app — {anchor} positions the menu below the button instead of at a
// click point, and {ctx: menuContext()} drives each item's checked(ctx)
// predicate (Task 11 adds enabled(ctx) to the same item shape — unknown
// fields are simply ignored by showContextMenu, not an error).
const VIEW_MENU_ITEMS = [
  { label: 'Extra large icons', action: 'view-xl',      checked: ctx => ctx.view === 'grid' && ctx.scale === 2 },
  { label: 'Large icons',       action: 'view-large',   checked: ctx => ctx.view === 'grid' && ctx.scale === 1.5 },
  { label: 'Medium icons',      action: 'view-medium',  checked: ctx => ctx.view === 'grid' && ctx.scale === 1 },
  { label: 'Small icons',       action: 'view-small',   checked: ctx => ctx.view === 'grid' && ctx.scale === 0.75 },
  'sep',
  // "List" is deliberately not Explorer's multi-column flowing list — ours
  // is a single-column, name-only row (see browser.js's setViewMode).
  { label: 'List',              action: 'view-list',    checked: ctx => ctx.view === 'list' },
  { label: 'Details',           action: 'view-details', checked: ctx => ctx.view === 'details' },
  'sep',
  { label: 'Show hidden files',    action: 'toggle-show-hidden',     checked: ctx => ctx.showHidden },
  { label: 'Show file extensions', action: 'toggle-show-extensions', checked: ctx => ctx.showExtensions },
  { label: 'Dynamic media view',   action: 'toggle-dynamic-media',   checked: ctx => ctx.dynamicMediaView },
];

const SORT_MENU_ITEMS = [
  { label: 'Name',          action: 'sort-name',     checked: ctx => ctx.sortKey === 'name' },
  { label: 'Date modified', action: 'sort-modified', checked: ctx => ctx.sortKey === 'modified' },
  { label: 'Type',          action: 'sort-type',     checked: ctx => ctx.sortKey === 'type' },
  { label: 'Size',          action: 'sort-size',     checked: ctx => ctx.sortKey === 'size' },
  'sep',
  { label: 'Ascending',     action: 'sort-asc',      checked: ctx => ctx.sortDir === 'asc' },
  { label: 'Descending',    action: 'sort-desc',     checked: ctx => ctx.sortDir === 'desc' },
];

/** Snapshot of the state the View/Sort menus' checked(ctx) predicates read —
 * built fresh each time either menu opens (the menu itself is rebuilt from
 * scratch on every open, so there is nothing to keep in sync between opens). */
function menuContext() {
  const cfg = window.__fpConfig || {};
  return {
    view: browserState.view,
    scale: browserState.listScale,
    showHidden: browserState.showHidden,
    showExtensions: browserState.showExtensions,
    dynamicMediaView: cfg['ui.dynamic_media_view'] !== false,
    sortKey: browserState.sort.key,
    sortDir: browserState.sort.dir,
  };
}

function getMenuTypeForTarget(target) {
  if (target.closest('.fp-tab')) return 'tab';
  // User pins (data-pin-id) and Quick Access known folders (data-known-id)
  // both get the sidebar-item menu — Home and drives are neither and fall
  // through to the empty-area menu instead.
  if (target.closest('.fp-sidebar__item[data-pin-id], .fp-sidebar__item[data-known-id]')) return 'sidebar-item';
  // Home's Recent/Favorites rows get their own menu — checked before the
  // generic folder/file checks below so a Home row never falls into those.
  if (target.closest('.fp-row--recent')) return 'home-row';
  if (target.closest('.fp-row[data-type="folder"], .ef-row[data-type="folder"]')) return 'folder';
  if (target.closest('.fp-row, .ef-row, .rb-row')) return 'file';
  return 'empty-area';
}

// The element + menu type the currently-open context menu was raised for —
// set by the 'contextmenu' listener, read by the sidebar-item action handlers
// (cm-open-new-tab / cm-unpin-sidebar / cm-rename-sidebar-item) below.
let contextMenuTarget = null;
let contextMenuType = null;

/** The path a single-target context-menu action (Open, Rename, Properties, …)
 * should act on: the row that was right-clicked, falling back to the
 * keyboard-focused row or the first selected path. */
function contextTargetPath() {
  const row = contextMenuTarget?.closest ? contextMenuTarget.closest('.fp-row[data-path]') : null;
  if (row) return row.dataset.path;
  return browserState.focus || getSelectedPaths()[0] || null;
}

/** The directory a "create/paste/index here" action should target: the
 * right-clicked folder itself (folder menu — "New folder inside" etc.), or
 * the currently open directory otherwise (empty-area menu, or a paste
 * initiated from the file menu). */
function contextTargetDir() {
  if (contextMenuType === 'folder') {
    const path = contextTargetPath();
    if (path) return path;
  }
  return browserState.path;
}

/**
 * Builds the ctx object passed to every CONTEXT_MENUS item's enabled(ctx)/
 * label(ctx) predicate (Task 11, playtest pass 1 §4.2): `{ selection,
 * target, favoritesSet, clipboard }`.
 *
 * `selection` is the array of full entry objects (path included) the menu
 * should judge applicability against — for 'file'/'folder'/'empty-area' that
 * is the Browser's real multi-selection (browserState.selection, via
 * getSelectedPaths()/entryForPath(), both browser.js); for 'home-row' it's
 * the single right-clicked row (Home has no multi-selection); every other
 * menu type (tab, sidebar-item) has no notion of a file selection and gets
 * an empty array — their own items don't read ctx.selection.
 *
 * `target` is contextMenuTarget (already resolved by the caller below) —
 * the sidebar-item menu's enabled() predicates read its dataset directly
 * (data-pin-id vs data-known-id) instead of the old per-kind item filter.
 */
function buildMenuContext(target) {
  const type = getMenuTypeForTarget(target);
  let selection = [];
  if (type === 'home-row') {
    const row = target?.closest ? target.closest('.fp-row[data-path]') : null;
    if (row) selection = [{ path: row.dataset.path, ext: row.dataset.ext || '', is_dir: (row.dataset.ext || '') === '' }];
  } else if (type === 'file' || type === 'folder' || type === 'empty-area') {
    selection = getSelectedPaths().map(p => {
      const entry = entryForPath(p);
      return entry ? { ...entry, path: p } : { path: p };
    });
  }
  return {
    selection,
    target: contextMenuTarget,
    favoritesSet,
    clipboard: fileops.clipboardCount(),
  };
}

const contextMenu = document.getElementById('context-menu');

/**
 * Renders `items` into the shared #context-menu and shows it.
 *
 * opts.anchor (the View/Sort toolbar buttons) positions the menu below that
 * element instead of at the click point `x,y`, which are then ignored.
 * opts.ctx, when present, is passed to every item's `checked(ctx)`,
 * `enabled(ctx)`, `label(ctx)` and `visible(ctx)` predicates (Task 11 adds
 * the latter three; an item with no such field just always renders, enabled,
 * with its own static `label`). The leading check-icon slot still only
 * appears on a menu that actually has `checked` items (the View/Sort
 * dropdowns) — keyed off the item list itself rather than "was ctx passed",
 * since Task 11 now passes ctx to every right-click menu too (for
 * enabled/label/visible) without wanting their layout to grow that slot.
 *
 * `visible(ctx) === false` OMITS the item entirely — distinct from
 * `enabled(ctx) === false`, which keeps it in place but greys it out. Use
 * `visible` for an item that structurally can never apply to the target
 * kind (Task 11 fix round 1: a pin's menu never even shows "Remove from
 * Quick Access", rather than showing it permanently disabled); use `enabled`
 * for a state-dependent rule that could flip the other way for the very
 * same kind of target (single- vs multi-selection, empty vs non-empty
 * clipboard, …). A separator left with nothing but hidden items on one or
 * both sides is dropped too, so a menu never shows a leading, trailing, or
 * doubled-up divider.
 */
function showContextMenu(x, y, items, opts = {}) {
  if (!contextMenu) return;
  contextMenu.innerHTML = '';
  const ctx = opts.ctx;
  const shown = [];
  for (const item of items) {
    if (item === 'sep') {
      if (shown.length === 0 || shown[shown.length - 1] === 'sep') continue;
      shown.push(item);
      continue;
    }
    if (typeof item.visible === 'function' && !item.visible(ctx)) continue;
    shown.push(item);
  }
  while (shown.length && shown[shown.length - 1] === 'sep') shown.pop();
  const showChecks = shown.some(item => item !== 'sep' && typeof item.checked === 'function');
  shown.forEach(item => {
    if (item === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'fp-context-menu__sep';
      contextMenu.appendChild(sep);
      return;
    }
    const isEnabled = typeof item.enabled !== 'function' || !!item.enabled(ctx);
    const label = typeof item.label === 'function' ? item.label(ctx) : item.label;
    const btn = document.createElement('button');
    btn.className = 'fp-context-menu__item'
      + (item.danger ? ' fp-context-menu__item--danger' : '')
      + (!isEnabled ? ' fp-context-menu__item--disabled' : '');
    btn.setAttribute('data-action', item.action || '');
    btn.setAttribute('role', 'menuitem');
    if (!isEnabled) {
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('tabindex', '-1'); // keyboard Tab order skips it too
    }
    if (showChecks) {
      const isChecked = typeof item.checked === 'function' && !!item.checked(ctx);
      btn.innerHTML = `<span class="fp-context-menu__check">${isChecked ? icon('check', 'fp-icon--14') : ''}</span>`;
    }
    if (item.icon) btn.innerHTML += item.icon;
    btn.innerHTML += `<span>${label}</span>`;
    if (item.kbd) {
      const kbd = document.createElement('span');
      kbd.className = 'fp-context-menu__kbd';
      kbd.textContent = item.kbd;
      btn.appendChild(kbd);
    }
    // A disabled item gets no click listener at all — CSS's pointer-events:
    // none on .fp-context-menu__item--disabled already keeps the click from
    // ever reaching this button (see styles.css), so this is belt-and-braces
    // against that CSS being bypassed some other way, not the only guard.
    if (isEnabled) {
      if (item.onClick) btn.addEventListener('click', () => { item.onClick(); hideContextMenu(); });
      else btn.addEventListener('click', hideContextMenu);
    }
    contextMenu.appendChild(btn);
  });
  contextMenu.style.display = 'block';
  // Position within viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  if (opts.anchor) {
    const r = opts.anchor.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(r.left, vw - 220)}px`;
    contextMenu.style.top  = `${Math.min(r.bottom + 4, vh - contextMenu.offsetHeight - 8)}px`;
  } else {
    contextMenu.style.left = `${Math.min(x, vw - 200)}px`;
    contextMenu.style.top  = `${Math.min(y, vh - contextMenu.offsetHeight - 8)}px`;
  }
}

function hideContextMenu() {
  if (contextMenu) contextMenu.style.display = 'none';
}

document.addEventListener('click', e => {
  if (!contextMenu?.contains(e.target)) hideContextMenu();
});

// ── Deselect anywhere (design spec §3.5) ────────────────────────────────────
// A capture-phase mousedown on #app clears the active selection (Browser
// rows or Home rows, whichever screen the active tab is on) unless the
// target sits inside an interactive element. Right-click on open space does
// the same (called from the contextmenu listener below, before the
// empty-area menu opens).
//
// #list-scroll (the file list background) is excluded entirely — it runs
// its own marquee mousedown/mouseup handling (browser.js,
// initMarqueeSelection), which already clears on a near-zero-distance drag
// (a plain click) and needs browserState.selection to still hold whatever
// was selected BEFORE this mousedown so a Ctrl/Shift-drag can keep rows
// outside the marquee box selected (`keep = ctrlDrag &&
// browserState.selection.has(...)`). Clearing here first — even though the
// marquee's own mouseup runs later and would seem to override it — races
// that read: this capture-phase handler fires and clears synchronously
// before the marquee's bubble-phase mousedown listener ever runs, so by the
// time it reads browserState.selection to decide what to keep, it's already
// empty. Fix round 1 (playtest pass 1): every OTHER open space (sidebar,
// toolbar, tab bar, inspector blank space, Home background) still clears.
const DESELECT_INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, ' +
  '[contenteditable], [role=button], .fp-row, .home-row, .fp-tab, ' +
  '.fp-sidebar__item, .fp-context-menu, .modal, .palette, .fp-inspector__tab, .fp-chip';

function deselectOnOpenSpace(target) {
  if (target?.closest?.(DESELECT_INTERACTIVE_SELECTOR)) return;
  if (target?.closest?.('#list-scroll')) return;
  const screen = activeTab()?.screen;
  if (screen === 'browser') clearSelection();
  else if (screen === 'home') homeClearSelection();
}

document.getElementById('app')?.addEventListener('mousedown', e => {
  deselectOnOpenSpace(e.target);
}, true);

// ── Snackbar ───────────────────────────────────────────────��────────────────────
// Notifications gate (single setting controls all transient toasts/snackbars).
// Defaults to OFF. Critical errors (showErrorBanner) are NOT gated — those
// are inline banners and must always be shown.
function notificationsEnabled() {
  return localStorage.getItem('fp-notifications-enabled') === 'on';
}

function showSnackbar(message, undoLabel, onUndo) {
  if (!notificationsEnabled()) return;
  const container = document.getElementById('snackbar-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'fp-snackbar';
  // message can be a filename (e.g. home.js's `Removed "${filename}" …`) —
  // escape it the same way showToast does before inserting via innerHTML.
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (undoLabel) {
    const btn = document.createElement('button');
    btn.className = 'fp-snackbar__undo fp-btn fp-btn--ghost fp-btn--sm';
    btn.textContent = undoLabel;
    btn.addEventListener('click', () => { onUndo?.(); el.remove(); });
    el.appendChild(btn);
  }
  const prog = document.createElement('div');
  prog.className = 'fp-snackbar__progress';
  el.appendChild(prog);
  container.appendChild(el);
  setTimeout(() => el.remove(), 5200);
}

// ── Toast ────────────────────────────────────────────────────────────────────────
function showToast(message, variant = '') {
  // Errors bypass the gate so failures are never silently swallowed.
  if (variant !== 'error' && !notificationsEnabled()) return;
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'fp-toast' + (variant ? ` fp-toast--${variant}` : '');
  // message is frequently API error text (formatApiError()) now that fileops
  // routes every failure through here — escape it before inserting.
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (variant === 'error') {
    const btn = document.createElement('button');
    btn.className = 'fp-btn fp-btn--ghost fp-btn--sm';
    btn.textContent = '✕';
    btn.addEventListener('click', () => el.remove());
    btn.style.marginLeft = 'auto';
    el.appendChild(btn);
  } else {
    setTimeout(() => el.remove(), 5000);
  }
  container.appendChild(el);
}

async function triggerScan(path) {
  showToast('Scanning…', 'default');
  try {
    const data = await API.post('/scan', path ? { path } : {}, { signal: AbortSignal.timeout(60000) });
    showSnackbar(`Scan complete — ${data.count} file${data.count !== 1 ? 's' : ''} indexed`);
    await openBrowserAt(data.path);
  } catch (err) {
    showToast(`Scan failed: ${formatApiError(err)}`, 'error');
  }
}

// ── Backend health ─────────────────────��──────────────────────���───────────────
// Last state the pill was painted with. checkBackend() is polled every 30s,
// and an offline/error -> ok transition is the only signal the renderer gets
// that a backend which was down (or that started AFTER the renderer) is now
// up -- every one-shot startup loader swallows its own failure silently, so
// without this the sidebar/config/known-folders stayed empty for the rest of
// the session. 'unknown' (the first poll) deliberately does NOT trigger a
// refresh: init runs the same loaders itself.
let _backendState = 'unknown';

async function checkBackend() {
  const el = document.getElementById('status-backend');
  if (!el) return;
  const label = el.querySelector('.fp-statusbar__backend-label');
  const prev = _backendState;
  const paint = (state, text) => {
    _backendState = state;
    el.dataset.state = state;
    if (label) label.textContent = text;
  };
  try {
    const data = await API.get('/health', null, { signal: AbortSignal.timeout(2000) });
    window.__fpHealth = data; // read by settings.js's Data-pane "Writes" line
    // /health is the ONE route the backend's token middleware exempts, so a
    // 200 here does not prove our X-FilePlus-Token is the one it wants. It
    // does report whether auth is on; when it is and the bridge handed us no
    // token, every other route 401s -- say so instead of painting a green
    // pill over an app that can't fetch anything.
    if (data && data.auth && !apiToken()) {
      paint('error', 'Backend auth');
      return false;
    }
    paint('ok', 'Backend');
    setWriteLockHint(data.write_unlocked === false);
    if (typeof updateWritesStatusLine === 'function') updateWritesStatusLine();
    if (prev === 'offline' || prev === 'error') refreshBackendData();
    return true;
  } catch (err) {
    // ApiError means the backend answered but with a non-2xx status; any
    // other rejection (network error, the 2s AbortSignal firing) means it
    // didn't answer at all.
    paint(err instanceof ApiError ? 'error' : 'offline',
          err instanceof ApiError ? 'Backend error' : 'Backend offline');
    return false;
  }
}

/** Re-runs every one-shot startup loader: the config cache and the settings
 * derived from it, the known-folder map, the sidebar's drives/pins/tags/Quick
 * Access, and Home's two lists when Home is what the active tab is showing.
 *
 * Called on an offline/error -> ok health transition and by the status pill's
 * own 'retry-backend-connect' click. Every loader degrades silently on
 * failure, so this is safe to call at any time and never throws. */
async function refreshBackendData() {
  await loadConfig();
  applySettingsFromConfig();
  // fpLoadKnownFolders() returns its cache when already populated; drop it so
  // a reconnect actually re-fetches (on the failing path it was never set).
  delete window.__fpKnownFolders;
  await fpLoadKnownFolders();
  await Promise.allSettled([loadDrives(), loadPins(), loadSidebarTags()]);
  loadQuickAccess();
  if (activeTab()?.screen === 'home') { loadRecent(); loadFavorites(); }
}

/** The status pill's click/Enter handler: re-probe /health now (rather than
 * waiting out the rest of the 30s poll) and repopulate the shell if it
 * answers. The only reconnect affordance in the UI -- the A.16 offline
 * banner markup is still commented out in index.html. */
async function refreshBackendConnection() {
  const el = document.getElementById('status-backend');
  const label = el?.querySelector('.fp-statusbar__backend-label');
  if (el) {
    _backendState = 'checking';
    el.dataset.state = 'checking';
    if (label) label.textContent = 'Checking…';
  }
  const ok = await checkBackend();
  if (ok) await refreshBackendData();
  else showToast('Backend is not reachable — is it running?', 'error');
}

/** Shows/hides the "writes: sandbox" status-bar hint (health.write_unlocked === false). */
function setWriteLockHint(locked) {
  const hint = document.getElementById('status-write-lock');
  const sep  = document.getElementById('status-lock-sep');
  if (hint) hint.style.display = locked ? '' : 'none';
  if (sep)  sep.style.display  = locked ? '' : 'none';
}

// ── Sidebar: real drives, pins, Downloads ─────────────────────────────────────
// Called once at startup (after loadConfig() so applyDownloadsPath can read
// the config cache) and safe to re-run any time the backend state changes
// (e.g. after a pin is renamed/unpinned). All three degrade silently to a
// no-op on failure — the sidebar keeps whatever it last rendered — since a
// console.error here would fail the smoke test's "no renderer errors" gate.

async function loadDrives() {
  const container = document.getElementById('sb-drives');
  if (!container) return;
  let driveList;
  try {
    driveList = await API.get('/drives', null, apiTimeout());
  } catch (err) {
    console.warn('[fp-drives] failed to load drives:', formatApiError(err));
    return;
  }
  window.__fpDrives = driveList; // driveDisplayLabel() reads this synchronously
  container.innerHTML = driveList.map(renderDriveItem).join('');
}

function renderDriveItem(d) {
  const letter = d.letter || '';
  const label = (d.label || '').trim();
  const labelText = label ? `${letter} ${label}` : `${letter} Drive`;
  const pct = d.total_bytes > 0 ? Math.round((d.used_bytes / d.total_bytes) * 100) : 0;
  const usageTitle = `${formatSize(d.used_bytes)} / ${formatSize(d.total_bytes)} used`;
  return `<div class="fp-sidebar__drive-item">
    <button class="fp-sidebar__item" data-screen="browser" data-path="${escapeHtml(d.mount)}"
            data-action="navigate-path" title="${escapeHtml(labelText)}">
      <svg class="fp-icon fp-icon--16 fp-sidebar__drive-icon" aria-hidden="true"><use href="#fp-drive"></use></svg>
      <span class="fp-sidebar__drive-letter" aria-hidden="true">${escapeHtml(letter)}</span>
      <span class="fp-sidebar__item__label">${escapeHtml(labelText)}</span>
    </button>
    <div class="fp-sidebar__drive-bar" title="${escapeHtml(usageTitle)}">
      <div class="fp-sidebar__drive-bar__fill" style="width:${pct}%"></div>
    </div>
  </div>`;
}

async function loadPins() {
  const container = document.getElementById('sb-pinned-folders');
  if (!container) return;
  let pinList;
  try {
    pinList = await API.get('/pins', null, apiTimeout());
  } catch (err) {
    console.warn('[fp-pins] failed to load pins:', formatApiError(err));
    return;
  }
  container.innerHTML = pinList.map(renderPinItem).join('');
}

function renderPinItem(pin) {
  const label = pin.label || pathBaseName(pin.path) || pin.path;
  return `<button class="fp-sidebar__item" data-screen="browser" data-path="${escapeHtml(pin.path)}"
          data-pin-id="${pin.id}" data-action="navigate-path" title="${escapeHtml(pin.path)}">
    <svg class="fp-icon fp-icon--16" aria-hidden="true"><use href="#fp-folder"></use></svg>
    <span class="fp-sidebar__item__label">${escapeHtml(label)}</span>
  </button>`;
}

// ── Sidebar Tags (Task 14) ─────────────────────────────────────────
// The eight most-used real tags (GET /tags, ranked by the file count the
// route now reports), replacing the four hardcoded sample chips. The whole
// section — label, chips and "View all →" — hides when nothing is tagged
// yet, rather than showing an empty shelf. The response is also cached on
// window.__fpTags for search.js's Tag filter row and the More-filters modal,
// so neither has to fetch again.
const SIDEBAR_TAG_LIMIT = 8;

async function loadSidebarTags() {
  const chips = document.getElementById('sb-tags-chips');
  const section = document.getElementById('sb-tags');
  const label = document.getElementById('sb-tags-label');
  if (!chips) return;
  let tags;
  try {
    tags = await API.get('/tags', null, apiTimeout());
  } catch (err) {
    // Hide the shelf on failure too: the markup authors it hidden and this
    // function is what reveals it, so a failed /tags must not leave the
    // "Tags" label and "View all" button standing over zero chips -- exactly
    // the empty shelf this section exists to avoid.
    console.warn('[fp-tags] failed to load tags:', formatApiError(err));
    if (section) section.hidden = true;
    if (label) label.hidden = true;
    return;
  }
  window.__fpTags = Array.isArray(tags) ? tags : [];
  const top = window.__fpTags
    .filter(t => (t.count || 0) > 0)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name))
    .slice(0, SIDEBAR_TAG_LIMIT);
  const empty = top.length === 0;
  if (section) section.hidden = empty;
  if (label) label.hidden = empty;
  chips.innerHTML = top.map(t => `<button class="fp-chip" data-action="filter-by-tag"
      data-tag="${escapeHtml(t.name)}" title="Search This PC for tag: ${escapeHtml(t.name)}">
      ${escapeHtml(t.name)} <span class="fp-chip__count">${t.count}</span>
    </button>`).join('');
}

// ── Quick Access known folders (Task 9) ─────────────────────────────────────
// Known-folder ids shown in Quick Access by default: Desktop, Downloads, and
// Screenshots (when the machine has one — GET /known-folders only returns it
// if the folder actually exists). Each maps to its own icon() sprite symbol
// — distinct from icons.js's FP_FOLDER_SPECIALS, the family-sprite icon used
// for folder rows inside a directory listing.
const QUICK_ACCESS_IDS = ['desktop', 'downloads', 'screenshots'];
const QUICK_ACCESS_ICON = { desktop: 'desktop', downloads: 'download', screenshots: 'screenshots' };

function quickAccessHiddenIds() {
  const hidden = window.__fpConfig && window.__fpConfig['ui.quick_access_hidden'];
  return Array.isArray(hidden) ? hidden : [];
}

/** Renders the sidebar's Quick Access known-folder items (between Home and
 * Review Bin) and the Settings › Personalization checkboxes that control
 * them — both read the same GET /known-folders cache (fpLoadKnownFolders(),
 * icons.js, awaited before this in app.js's init) and the
 * ui.quick_access_hidden config array, so one function keeps them in sync.
 * Safe to re-run any time either source changes (a Settings checkbox, the
 * sidebar-item "Remove from Quick Access" menu action). */
function loadQuickAccess() {
  // fpLoadKnownFolders() only assigns __fpKnownFolderList when GET
  // /known-folders actually answered, so "not an array" means the fetch never
  // succeeded -- a different statement from "this PC has none", and the
  // Settings copy below says so.
  const loaded = Array.isArray(window.__fpKnownFolderList);
  const list = loaded ? window.__fpKnownFolderList : [];
  const hidden = new Set(quickAccessHiddenIds());

  const sidebar = document.getElementById('sb-quick-access-folders');
  if (sidebar) {
    const visible = QUICK_ACCESS_IDS
      .map(id => list.find(f => f && f.id === id))
      .filter(f => f && !hidden.has(f.id));
    sidebar.innerHTML = visible.map(renderQuickAccessItem).join('');
  }

  renderQuickAccessSettings(list, hidden, loaded);
}

function renderQuickAccessItem(f) {
  const symbol = QUICK_ACCESS_ICON[f.id] || 'folder';
  const label = f.name || pathBaseName(f.path) || f.id;
  return `<button class="fp-sidebar__item" data-screen="browser" data-path="${escapeHtml(f.path)}"
          data-known-id="${escapeHtml(f.id)}" data-action="navigate-path" title="${escapeHtml(label)}">
    ${icon(symbol, 'fp-icon--16')}
    <span class="fp-sidebar__item__label">${escapeHtml(label)}</span>
  </button>`;
}

/** Settings › Personalization › Quick Access: one checkbox per known folder
 * that can appear in Quick Access, checked = currently shown. `list` is the
 * raw GET /known-folders result, `hiddenIds` the Set of currently-hidden ids
 * (both already computed by loadQuickAccess(), the sole caller). */
function renderQuickAccessSettings(list, hiddenIds, loaded = true) {
  const container = document.getElementById('settings-quick-access-list');
  if (!container) return;
  const items = QUICK_ACCESS_IDS.map(id => list.find(f => f && f.id === id)).filter(Boolean);
  if (!items.length) {
    container.innerHTML = loaded
      ? '<div class="settings-row__desc">No known folders detected on this PC.</div>'
      : '<div class="settings-row__desc">Couldn’t read this PC’s folders — the backend isn’t reachable.</div>';
    return;
  }
  container.innerHTML = items.map((f, i) => `
    <div class="settings-row">
      <div class="settings-row__label">${escapeHtml(f.name || pathBaseName(f.path) || f.id)}</div>
      <label class="fp-toggle">
        <input type="checkbox" data-action="settings-quick-access-toggle" data-known-id="${escapeHtml(f.id)}" ${hiddenIds.has(f.id) ? '' : 'checked'} />
        <span class="fp-toggle__track"></span>
        <span class="fp-toggle__thumb"></span>
      </label>
    </div>${i < items.length - 1 ? '<div class="settings-sep"></div>' : ''}`).join('');
}

/** Adds or removes `id` from ui.quick_access_hidden and re-renders both the
 * sidebar Quick Access list and the Settings checkboxes. Shared by the
 * Settings checkbox (change listener, below) and the sidebar-item context
 * menu's "Remove from Quick Access" action (the click switch, above). */
async function setQuickAccessHidden(id, hide) {
  const hidden = new Set(quickAccessHiddenIds());
  if (hide) hidden.add(id); else hidden.delete(id);
  await saveSetting('ui.quick_access_hidden', [...hidden]);
  loadQuickAccess();
}

// ── This PC collapse (Task 9) ───────────────────────────────────────────────
/** Expands/collapses the "This PC" sidebar section: rotates the chevron,
 * shows/hides #sb-drives, and (unless {persist:false}, used when restoring
 * from config at startup) saves ui.sidebar_thispc_open. */
function setThisPcOpen(open, { persist = true } = {}) {
  const chevron = document.querySelector('#sb-thispc .fp-sidebar__chevron');
  const body = document.getElementById('sb-drives');
  if (chevron) {
    chevron.setAttribute('aria-expanded', String(open));
    chevron.setAttribute('aria-label', open ? 'Collapse This PC' : 'Expand This PC');
  }
  if (body) body.hidden = !open;
  if (persist) saveSetting('ui.sidebar_thispc_open', open);
}

// ── Window controls (Electron IPC) ───────────────────────────────────────────
function initWindowControls() {
  const api = window.electronAPI;
  if (!api) return;
  document.getElementById('btn-minimize')?.addEventListener('click', () => api.minimize?.());
  document.getElementById('btn-maximize')?.addEventListener('click', () => api.maximize?.());
  document.getElementById('btn-close')?.addEventListener('click', () => api.close?.());
}

// ── Underline tab indicator (sub-tabs within screens) ─────────────��──────────
/** Slides a .fp-tabs container's accent underline under `tab` (default: the
 * container's currently-active item). The single writer of
 * indicator.style.left/width, so every way a tab becomes active -- a real
 * click (initUnderlineTabs below), switchInspectorTab(), switchPropertiesTab()
 * -- moves the underline with the active class instead of stranding it under
 * whichever tab was last clicked. */
function moveTabIndicator(container, tab) {
  if (!container) return;
  const indicator = container.querySelector('.fp-tabs__indicator');
  const target = tab || container.querySelector('.fp-tabs__item--active');
  // offsetWidth 0 = the container isn't laid out yet (a closed inspector is
  // display:none, a closed Properties modal likewise). Measuring then would
  // pin the underline at width 0; leave it where it is and let whoever
  // reveals the container call again.
  if (!indicator || !target || target.offsetWidth === 0) return;
  indicator.style.left  = `${target.offsetLeft}px`;
  indicator.style.width = `${target.offsetWidth}px`;
}

function initUnderlineTabs(container) {
  if (!container) return;
  const tabs     = container.querySelectorAll('.fp-tabs__item');
  function setActive(tab) {
    tabs.forEach(t => t.classList.toggle('fp-tabs__item--active', t === tab));
    moveTabIndicator(container, tab);
    const targetPane = tab?.dataset.tab;
    container.closest('.screen')?.querySelectorAll('[data-pane]').forEach(pane => {
      pane.style.display = pane.dataset.pane === targetPane ? '' : 'none';
    });
  }
  tabs.forEach(tab => {
    tab.addEventListener('click', () => setActive(tab));
  });
  // Initialise with first active tab. ResizeObserver re-runs setActive once
  // the tab actually has a measurable width — Electron cold-start can return
  // offsetWidth:0 at DOMContentLoaded, fonts.ready, and the next rAF, which
  // pins the indicator at width:0 until the user clicks something.
  const first = container.querySelector('.fp-tabs__item--active') || tabs[0];
  if (first) {
    setActive(first);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (first.offsetWidth > 0) {
          setActive(first);
          ro.disconnect();
        }
      });
      ro.observe(first);
    }
  }
}

// ── data-action global delegation ─────────────────────────────────────────────
// In-scope actions are handled here; out-of-scope show "not implemented" stub.
const IN_SCOPE_ACTIONS = new Set([
  'navigate-screen', 'navigate-path', 'switch-tab', 'close-tab', 'new-tab', 'scan',
  'toggle-sidebar', 'toggle-inspector', 'toggle-theme', 'retry-backend-connect',
  'focus-search', 'filter-by-tag', 'open-tag-canvas', 'close-tag-canvas',
  'tag-canvas-select',
  // Ask File+ (Task 15) — shell only, no model wired until Stage 3.
  'ask-open', 'ask-close', 'ask-example',
  'nav-back', 'nav-forward', 'nav-up', 'navigate-crumb', 'nav-retry',
  // 'sort-by' is handled by initColumnSort()'s own listener (browser.js);
  // 'select-file' only appears on the static placeholder rows in index.html,
  // superseded by browser.js's delegated row click handler. Both are listed
  // here purely so the data-action bubble to the global switch is a silent
  // no-op instead of a "not yet implemented" toast.
  'sort-by', 'select-file',
  'cm-open-new-tab', 'cm-unpin-sidebar', 'cm-rename-sidebar-item',
  'open-review-bin',
  'switch-inspector-tab',
  'inspector-open', 'inspector-reveal', 'inspector-remove-tag', 'inspector-undo-op',
  'unfavorite-file', 'open-recent-file',
  'open-file', 'reveal-file', 'copy-path', 'home-toggle-favorite',
  'palette-open-file', 'palette-open-folder', 'palette-search-files',
  'open-palette', 'close-palette', 'palette-set-mode',
  // Toolbar search (Task 14)
  'search-clear', 'search-remove-chip', 'search-expand-filter', 'search-pick-filter',
  'search-more-filters', 'search-more-apply', 'search-more-cancel',
  'search-history-run', 'search-history-clear', 'search-index-drives',
  // Settings › Scan & Index (Task 14)
  'settings-index-add', 'settings-index-reindex', 'settings-index-remove',
  'modal-cancel', 'modal-confirm', 'modal-confirm-type',
  'ef-filter', 'ef-sort', 'ef-toggle-pause-ai', 'ef-toggle-moving-card',
  'scan-config-switch-mode', 'scan-baseline-confirm',
  'settings-nav', 'settings-set-theme', 'settings-set-density', 'settings-set-accent',
  'settings-set-accent-hex', 'settings-reset-accent',
  'settings-set-show-notifications', 'settings-toggle', 'settings-set-click-mode',
  'settings-set-icon-source', 'settings-quick-access-toggle', 'settings-set-backspace-deletes',
  'settings-empty-trash',
  'settings-set-font-scale', 'settings-reset-shortcuts',
  'zoom-reset',
  // File operations (Task 4) — context-menu actions wired in the switch below.
  'cm-open', 'cm-open-with', 'cm-reveal-explorer',
  'cm-cut', 'cm-copy', 'cm-paste', 'cm-paste-here', 'cm-rename', 'cm-delete',
  'cm-new-folder', 'cm-new-file', 'cm-refresh', 'refresh-directory',
  'cm-favorite', 'cm-pin-sidebar', 'cm-index-folder', 'cm-properties', 'cm-toggle-hidden',
  'cm-view-list', 'cm-view-grid', 'cm-sort-name', 'cm-sort-modified',
  // View/Sort toolbar dropdowns + their checked items (Task 10)
  'open-view-menu', 'open-sort-menu',
  'view-xl', 'view-large', 'view-medium', 'view-small', 'view-list', 'view-details',
  'toggle-show-hidden', 'toggle-show-extensions', 'toggle-dynamic-media',
  'sort-name', 'sort-modified', 'sort-type', 'sort-size', 'sort-asc', 'sort-desc',
  // Properties panel (Task 13)
  'inspector-more', 'inspector-properties', 'switch-properties-tab',
  'props-apply', 'props-close', 'props-open-with', 'props-advanced',
  'props-attr-toggle', 'props-folder-type-select', 'settings-set-properties-mode',
]);

/** Activates the Inspector tab named `name` ('preview' | 'tags' | 'history') —
 * the same tab-button/pane toggle the 'switch-inspector-tab' click case
 * performs, extracted so a non-click caller (e.g. cm-add-tag) can jump to a
 * specific tab without synthesizing a click on the tab button. */
function switchInspectorTab(name) {
  const inspector = document.getElementById('inspector');
  if (!inspector) return;
  const targetTab = inspector.querySelector(`.fp-inspector__tab[data-tab="${name}"]`);
  inspector.querySelectorAll('.fp-inspector__tab').forEach(t => {
    t.classList.toggle('fp-tabs__item--active', t === targetTab);
  });
  // hidden (not inline display) so the panes container's own fixed
  // min-height (styles.css .inspector__panes) is what keeps geometry from
  // jittering between a short pane (e.g. "Select a file") and a tall one.
  inspector.querySelectorAll('.fp-inspector__pane').forEach(p => {
    p.hidden = p.dataset.pane !== name;
  });
  moveTabIndicator(inspector.querySelector('.fp-inspector__tabs'), targetTab);
}

/** Flips ui.show_hidden — shared by the empty-area menu's "Show hidden
 * files" (cm-toggle-hidden) and the View menu's checked item of the same
 * name (toggle-show-hidden), so both stay in sync with each other and with
 * the Settings › Personalization checkbox. */
function toggleShowHidden() {
  const next = !browserState.showHidden;
  browserState.showHidden = next;
  refreshDirectory();
  saveSetting('ui.show_hidden', next);
  const hiddenToggle = document.querySelector('[data-action="settings-toggle"][data-setting="show-hidden"]');
  if (hiddenToggle) hiddenToggle.checked = next;
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'navigate-screen':
      switchScreen(btn.dataset.screen || btn.dataset.target);
      break;
    case 'retry-backend-connect':
      refreshBackendConnection();
      break;
    case 'navigate-path': {
      // openBrowserAt() → loadDirectory() → onNavigated() sets the tab label
      // and the sidebar highlight synchronously, before the fetch even
      // lands — no manual pre-marking needed here any more.
      openBrowserAt(btn.dataset.path);
      break;
    }
    // This PC (Task 9): thispc-open sits on the section-head row itself and
    // opens the drives listing (openBrowserAt(null), tab label "This PC");
    // thispc-toggle sits on the nested chevron button, so a click there is
    // caught by this case first (closest() returns the innermost match) and
    // never falls through to thispc-open.
    case 'thispc-open':
      openBrowserAt(null);
      break;
    case 'thispc-toggle': {
      const expanded = btn.getAttribute('aria-expanded') !== 'false';
      setThisPcOpen(!expanded);
      break;
    }
    case 'nav-back':
      navBack();
      break;
    case 'nav-forward':
      navForward();
      break;
    case 'nav-up':
      navUp();
      break;
    case 'navigate-crumb':
      if (btn.dataset.path) loadDirectory(btn.dataset.path);
      break;
    case 'nav-retry':
      retryLoad();
      break;
    case 'refresh-directory':
      refreshDirectory();
      break;
    case 'switch-tab':
      // btn IS the .fp-tab itself — it's the only data-action="switch-tab"
      // element in the subtree (the close span carries its own 'close-tab'
      // action, so a click there never reaches this case).
      activateTab(btn.dataset.tabId);
      break;
    case 'close-tab': {
      e.stopPropagation();
      // The X button is a child of a .fp-tab — close THAT tab, not whichever
      // happens to be active.
      const targetTab = btn.closest('.fp-tab');
      if (targetTab) closeTabById(targetTab.dataset.tabId);
      break;
    }
    case 'new-tab':
      openNewTab();
      break;
    case 'zoom-reset':
      zoomReset();
      break;
    case 'scan':
      triggerScan(btn.dataset.path || null);
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'toggle-inspector':
      toggleInspector();
      break;
    case 'toggle-theme':
      toggleTheme();
      break;
    case 'focus-search':
      // The bar is the search surface now (Task 14) — focusing it opens its
      // own Filters/History dropdown; ⌘K stays the command palette.
      focusSearchInput();
      break;
    case 'filter-by-tag': {
      // A sidebar tag chip: search This PC for everything carrying that tag.
      const tag = btn.dataset.tag;
      if (!tag) break;
      searchResetBar();
      searchState.chips = [
        { key: 'in', value: 'pc', label: 'This PC' },
        { key: 'tag', value: tag, label: tag },
      ];
      searchState.scope = 'pc';
      renderSearchChips();
      runSearch();
      break;
    }
    // ── Toolbar search (Task 14) ──────────────────────────────────
    case 'search-clear':
      clearSearch();
      break;
    case 'search-remove-chip':
      removeChip(Number(btn.dataset.chipIndex));
      break;
    case 'search-expand-filter':
      toggleSearchFilterRow(btn.dataset.filter);
      break;
    case 'search-pick-filter':
      pickSearchFilter(btn.dataset.filter, btn.dataset.value, btn.dataset.label);
      break;
    case 'search-more-filters':
      openMoreFilters();
      break;
    case 'search-more-apply':
      applyMoreFilters();
      break;
    case 'search-more-cancel':
      closeMoreFilters();
      break;
    case 'search-history-run':
      restoreSearchHistoryEntry(Number(btn.dataset.index));
      break;
    case 'search-history-clear':
      clearSearchHistory();
      break;
    case 'search-index-drives':
      indexMissingDrives();
      break;
    // ── Settings › Scan & Index (Task 14) ────────────────────────────────────
    case 'settings-index-add':
      pickFolderToIndex();
      break;
    case 'settings-index-reindex':
      startIndexOf(btn.dataset.root);
      break;
    case 'settings-index-remove':
      removeIndexRoot(btn.dataset.root);
      break;
    case 'palette-search-files': {
      const q = btn.dataset.query || '';
      closePalette();
      setSearchText(q);
      runSearch();
      break;
    }
    case 'open-tag-canvas':
      openTagCanvas();
      break;
    case 'close-tag-canvas':
      closeTagCanvas();
      break;
    case 'tag-canvas-select':
      // INTEGRATION: highlight tag in canvas, filter file grid
      break;
    case 'ask-open':
      // Same toggle as Ctrl+J: clicking the sidebar CTA again closes it.
      toggleAskPopout();
      break;
    case 'ask-close':
      closeAskPopout();
      break;
    case 'ask-example': {
      const input = document.getElementById('ask-input');
      if (input) {
        input.value = btn.dataset.text || '';
        input.focus();
      }
      break;
    }
    case 'palette-set-mode':
      setPaletteMode(btn.dataset.mode || 'search');
      break;
    case 'modal-cancel':
      closeModal();
      break;
    case 'modal-confirm':
      // No-op here by design: openModal() assigns #modal-confirm's own
      // .onclick to the button directly (gating on a typed confirmWord,
      // calling config.onConfirm(), and only then closeModal()). A second,
      // unconditional closeModal() from this delegated switch would race
      // ahead of that gating on every click — including a wrong typed word
      // — and close the modal regardless of what onclick decided. 'modal-confirm'
      // stays in IN_SCOPE_ACTIONS so this case is a deliberate silent no-op,
      // not a missing handler.
      break;
    case 'scan-config-switch-mode': {
      const conv = document.querySelector('.scan-conv');
      const form = document.querySelector('.scan-form');
      const switchBtn = document.getElementById('btn-scan-switch');
      if (!conv || !form) break;
      const goingToForm = btn.dataset.mode === 'form';
      conv.style.display = goingToForm ? 'none' : '';
      form.style.display = goingToForm ? '' : 'none';
      if (switchBtn) {
        switchBtn.textContent = goingToForm ? 'Switch to conversational' : 'Switch to structured form';
        switchBtn.dataset.mode = goingToForm ? 'conversational' : 'form';
      }
      break;
    }
    case 'ef-filter': {
      // Update segmented filter chips active state
      const bar = document.getElementById('ef-filter-bar');
      bar?.querySelectorAll('.fp-segmented__opt').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.filter === btn.dataset.filter);
      });
      // INTEGRATION: filter file list by state
      break;
    }
    case 'scan-baseline-confirm':
      openModal('warn', {
        title: 'Create baseline snapshot',
        body: 'FilePlus will take a snapshot of your current folder structure before scanning. This lets you restore to the current state at any time. The snapshot runs in the background and takes about 30 seconds.',
        confirmLabel: 'Create baseline & scan',
        // INTEGRATION: onConfirm → POST /scan/start (after POST /snapshots/baseline)
      });
      break;
    case 'ef-sort':
      // INTEGRATION: sort file list by column
      break;
    case 'ef-toggle-pause-ai':
      // INTEGRATION: toggle AI processing pause
      break;
    case 'ef-toggle-moving-card': {
      const card = document.getElementById('ef-moving-card');
      if (card) card.style.display = card.style.display === 'none' ? '' : 'none';
      break;
    }
    case 'open-review-bin':
      switchScreen('review-bin');
      break;
    case 'settings-nav':
      switchSettingsPane(btn.dataset.pane);
      if (btn.dataset.pane === 'data') updateWritesStatusLine();
      if (btn.dataset.pane === 'scan-index') loadIndexStatus();
      break;
    case 'settings-set-theme':
      applyTheme(btn.dataset.theme || btn.dataset.val);
      saveSetting('ui.theme', btn.dataset.theme || btn.dataset.val);
      break;
    case 'settings-set-density':
      applyDensity(btn.dataset.density || btn.dataset.val);
      saveSetting('ui.density', btn.dataset.density || btn.dataset.val);
      break;
    case 'settings-set-accent':
      // Legacy: only applies if dataset.accent or dataset.val is a valid hex
      applyAccent(btn.dataset.accent || btn.dataset.val);
      break;
    case 'settings-set-accent-hex':
      applyAccentHex(btn.value);
      break;
    case 'settings-reset-accent':
      resetAccentToDefault();
      deleteSetting('ui.accent_hex');
      break;
    case 'settings-set-click-mode': {
      const mode = btn.dataset.val === 'single' ? 'single' : 'double';
      document.querySelectorAll('[data-action="settings-set-click-mode"]').forEach(b => {
        b.classList.toggle('active', b.dataset.val === mode);
      });
      saveSetting('ui.click_mode', mode);
      break;
    }
    case 'settings-set-icon-source': {
      const source = applyIconSource(btn.dataset.val);
      saveSetting('ui.icon_source', source);
      refreshIconSurfaces();
      break;
    }
    case 'settings-empty-trash':
      openModal('danger', {
        title: 'Empty FilePlus trash?',
        body: 'Everything FilePlus has deleted is sent to the Windows Recycle Bin. Undo will no longer be possible for those items.',
        confirmLabel: 'Empty',
        confirmWord: 'EMPTY',
        onConfirm: () => {
          API.post('/fs/trash/empty').then(result => {
            const n = result.batches || 0;
            const skipped = result.skipped_roots && result.skipped_roots.length;
            let msg = `Sent ${n} batch folder${n === 1 ? '' : 's'} to the Recycle Bin`;
            if (skipped) msg += ` (${skipped} location${skipped === 1 ? '' : 's'} skipped)`;
            showToast(msg, 'default');
          }).catch(err => showToast(`Failed to empty trash: ${formatApiError(err)}`, 'error'));
        },
      });
      break;
    case 'settings-set-font-scale': {
      const scale = btn.dataset.scale;
      // Font scale applied as CSS zoom; for Ctrl+/- Electron native zoom is used instead.
      document.documentElement.style.zoom = scale;
      localStorage.setItem('fp-zoom', scale);
      break;
    }
    case 'settings-reset-shortcuts':
      // INTEGRATION: reset to default keybindings
      break;
    case 'switch-inspector-tab':
      switchInspectorTab(btn.dataset.tab);
      break;
    case 'inspector-open':
      inspectorOpenSelected();
      break;
    case 'inspector-reveal':
      inspectorRevealSelected();
      break;
    case 'inspector-remove-tag': {
      const tagId = btn.dataset.tagId;
      if (tagId) inspectorRemoveTag(tagId);
      break;
    }
    case 'inspector-undo-op': {
      const opId = btn.dataset.opId;
      if (opId) inspectorUndoOp(opId, btn.dataset.batchId || null);
      break;
    }
    case 'unfavorite-file':
      unfavoriteFile(btn);
      break;
    case 'open-recent-file': {
      const row = btn;
      const path = row.dataset.path || '';
      const name = row.querySelector('.fp-row__name')?.textContent?.trim()
                || path.split(/[\\/]/).pop() || '';
      const pane = row.closest('.home-pane');
      pane?.querySelectorAll('.fp-row--selected').forEach(r => {
        if (r !== row) r.classList.remove('fp-row--selected');
      });
      row.classList.add('fp-row--selected');
      // Populate + open the global inspector. INTEGRATION: real meta/preview
      // data per backend-integration.md §A.2.1 item 2 (time-label formatter)
      // and §A.3 (file/info, file/preview, file/hash).
      updateInspector('single', { name, path });
      break;
    }
    // Home hover actions (Recent + Favorites rows) and the home-row context
    // menu's Open/Reveal/Copy path — resolveHomeRowTarget (home.js) resolves
    // the acting row whether `btn` is the hover-action button itself (nested
    // inside the row) or a context-menu popup button (rendered outside the
    // row; falls back to contextMenuTarget, captured at right-click time).
    case 'open-file': {
      const target = resolveHomeRowTarget(btn);
      if (target) homeOpenPath(target.path, target.ext);
      break;
    }
    case 'reveal-file': {
      const target = resolveHomeRowTarget(btn);
      if (target) homeRevealInBrowser(target.path);
      break;
    }
    case 'copy-path': {
      const target = resolveHomeRowTarget(btn);
      if (target) homeCopyPath(target.path);
      break;
    }
    case 'home-toggle-favorite': {
      const target = resolveHomeRowTarget(btn);
      if (target) homeToggleFavorite(target.path);
      break;
    }
    case 'palette-open-file': {
      const path = btn.dataset.path;
      if (!path) break;
      closePalette();
      const parent = parentOfPath(path);
      const loaded = openBrowserAt(parent);
      Promise.resolve(loaded).then(() => selectRow(path));
      break;
    }
    case 'palette-open-folder': {
      const path = btn.dataset.path;
      if (!path) break;
      closePalette();
      openBrowserAt(path);
      break;
    }
    // Tab context menu (A.10.4)
    case 'cm-new-tab':
      openNewTab();
      break;
    case 'cm-duplicate-tab': {
      const tab = contextMenuTarget?.closest ? contextMenuTarget.closest('.fp-tab') : null;
      if (tab) duplicateTab(tab.dataset.tabId);
      break;
    }
    case 'cm-close-tab': {
      const tab = contextMenuTarget?.closest ? contextMenuTarget.closest('.fp-tab') : null;
      if (tab) closeTabById(tab.dataset.tabId);
      break;
    }
    case 'cm-close-other-tabs': {
      const tab = contextMenuTarget?.closest ? contextMenuTarget.closest('.fp-tab') : null;
      if (tab) closeOtherTabs(tab.dataset.tabId);
      break;
    }
    // Sidebar item context menu (A.10.5) — pins and Quick Access known
    // folders both reach here (see getMenuTypeForTarget); both carry
    // data-path. Any other menu (file/folder/tab/empty-area) still falls
    // through to the stub below.
    case 'cm-open-new-tab': {
      if (contextMenuType === 'sidebar-item' && contextMenuTarget) {
        const itemPath = contextMenuTarget.dataset.path;
        if (itemPath) { openNewTab(); openBrowserAt(itemPath); }
      } else if (contextMenuType === 'file' || contextMenuType === 'folder') {
        // Folder → open that folder; file → open its parent folder.
        const path = contextTargetPath();
        if (path) {
          const targetDir = contextMenuType === 'folder' ? path : parentOfPath(path);
          openNewTab();
          openBrowserAt(targetDir);
        }
      } else {
        console.log(`[FilePlus] data-action stub: ${action}`, btn.dataset);
        showToast(`Action "${action}" — not yet implemented`, 'action');
      }
      break;
    }
    case 'cm-unpin-sidebar': {
      if (contextMenuType === 'sidebar-item' && contextMenuTarget) {
        const pinId = contextMenuTarget.dataset.pinId;
        if (pinId) {
          API.del(`/pins/${pinId}`)
            .then(loadPins)
            .catch(err => showToast(`Failed to unpin: ${formatApiError(err)}`, 'error'));
        }
      } else {
        console.log(`[FilePlus] data-action stub: ${action}`, btn.dataset);
        showToast(`Action "${action}" — not yet implemented`, 'action');
      }
      break;
    }
    case 'cm-rename-sidebar-item': {
      if (contextMenuType === 'sidebar-item' && contextMenuTarget) {
        const pinId = contextMenuTarget.dataset.pinId;
        const currentLabel = (contextMenuTarget.querySelector('.fp-sidebar__item__label')?.textContent || '').trim();
        if (pinId) {
          openModal('warn', {
            title: 'Rename pin',
            body: 'Enter a new label for this pinned folder.',
            confirmLabel: 'Rename',
            textInput: { value: currentLabel, placeholder: 'Label' },
            onConfirm: () => {
              const input = document.getElementById('modal-text-input');
              const val = (input?.value || '').trim();
              if (!val) {
                showToast('Label cannot be empty', 'error');
                input?.focus();
                return false; // veto the close — keep the modal open
              }
              API.patch(`/pins/${pinId}`, { label: val })
                .then(loadPins)
                .catch(err => showToast(`Failed to rename: ${formatApiError(err)}`, 'error'));
            },
          });
        }
      } else {
        console.log(`[FilePlus] data-action stub: ${action}`, btn.dataset);
        showToast(`Action "${action}" — not yet implemented`, 'action');
      }
      break;
    }
    // Quick Access known-folder removal (Task 9) — only reachable for
    // sidebar items carrying data-known-id (see getMenuTypeForTarget); adds
    // the id to ui.quick_access_hidden and re-renders both the sidebar list
    // and the Settings checkboxes (setQuickAccessHidden -> loadQuickAccess).
    case 'cm-quick-access-remove': {
      if (contextMenuType === 'sidebar-item' && contextMenuTarget) {
        const knownId = contextMenuTarget.dataset.knownId;
        if (knownId) setQuickAccessHidden(knownId, true);
      } else {
        console.log(`[FilePlus] data-action stub: ${action}`, btn.dataset);
        showToast(`Action "${action}" — not yet implemented`, 'action');
      }
      break;
    }
    // ── File operations context-menu wiring (Task 4) ─────────────────────────
    // Task 11: also handles a same-extension multi-file selection (only
    // reachable when cmOpenEnabled(ctx) allowed the click at all — a folder
    // never appears here for more than one selected item, since a folder in
    // the mix always fails that predicate).
    case 'cm-open': {
      if (contextMenuType === 'folder') {
        const path = contextTargetPath();
        if (path) loadDirectory(path);
        break;
      }
      const paths = getSelectedPaths();
      if (paths.length <= 1) {
        const path = contextTargetPath();
        if (!path) break;
        const openPath = window.electronAPI?.openPath;
        if (openPath) {
          Promise.resolve(openPath(path)).then(result => { if (result) showToast(result, 'error'); })
            .catch(err => showToast(formatApiError(err), 'error'));
        }
        API.post('/recent', { path, action: 'opened' }).catch(() => { /* best-effort logging */ });
        break;
      }
      // Sequential, not fire-and-forget-in-parallel — 20 simultaneous shell
      // launches is exactly the kind of thing the cap+confirm exists to
      // avoid in the first place (Task 11 fix round 1).
      const cappedPaths = paths.slice(0, 20);
      const openMany = async () => {
        const openPath = window.electronAPI?.openPath;
        for (const p of cappedPaths) {
          if (openPath) {
            try {
              const result = await openPath(p);
              if (result) showToast(result, 'error');
            } catch (err) {
              showToast(formatApiError(err), 'error');
            }
          }
          API.post('/recent', { path: p, action: 'opened' }).catch(() => { /* best-effort logging */ });
        }
        showToast(`Opened ${cappedPaths.length} of ${paths.length}`, 'default');
      };
      if (paths.length > 10) {
        // Honest about the cap: "Open 20 of 25 files?" once the selection
        // actually exceeds it, not just "Open 25 files?" when only 20 will
        // really open.
        const title = paths.length > 20
          ? `Open ${cappedPaths.length} of ${paths.length} files?`
          : `Open ${paths.length} files?`;
        openModal('warn', { title, confirmLabel: 'Open', onConfirm: openMany });
      } else {
        openMany();
      }
      break;
    }
    case 'cm-open-with': {
      const path = contextTargetPath();
      if (path) {
        Promise.resolve(window.electronAPI?.openWithDialog?.(path)).then(ok => {
          if (!ok) showToast('Failed to open the Open With dialog', 'error');
        });
      }
      break;
    }
    case 'cm-reveal-explorer': {
      const path = contextTargetPath();
      if (path) window.electronAPI?.showItemInFolder?.(path);
      break;
    }
    case 'cm-cut':
      fileops.cutSelection();
      break;
    case 'cm-copy':
      fileops.copySelection();
      break;
    case 'cm-paste':
    case 'cm-paste-here':
      fileops.pasteInto(contextTargetDir()).catch(fileopsReported);
      break;
    case 'cm-rename': {
      const path = contextTargetPath();
      if (path && typeof startInlineRename === 'function') startInlineRename(path);
      break;
    }
    case 'cm-delete':
      fileops.trashSelection().catch(fileopsReported);
      break;
    case 'cm-new-folder':
      fileops.newFolder(contextTargetDir()).catch(fileopsReported);
      break;
    case 'cm-new-file':
      fileops.newFile(contextTargetDir()).catch(fileopsReported);
      break;
    case 'cm-refresh':
      refreshDirectory();
      break;
    // Task 11: toggles the WHOLE selection (design spec §4.2 — "any count").
    // "Remove" only when every selected path is already favorited (matching
    // cmFavoriteLabel's own predicate, which decided which label the user
    // just clicked); otherwise every not-yet-favorited path is added
    // (POST /favorites is idempotent for one already favorited, so adding
    // the whole selection unconditionally on the "Add" branch is safe).
    // favoritesReload() resyncs favoritesSet/the Favorites pane;
    // refreshDirectory() re-renders Browser rows so the star appears/clears.
    case 'cm-favorite': {
      const paths = getSelectedPaths();
      if (!paths.length) break;
      const allFav = paths.every(p => favoritesHas(p));
      // favoritesReload() MUST finish before refreshDirectory() re-renders —
      // renderFsRow reads favoritesHas() at render time, and the two fetches
      // (/favorites, /fs/list) race independently, so firing them merely in
      // parallel could re-render the row from a still-stale favoritesSet.
      const settle = async () => { await favoritesReload(); await refreshDirectory(); };
      if (allFav) {
        Promise.all(paths.map(p => API.del('/favorites', { path: p })))
          .then(() => { showToast('Removed from Favorites', 'default'); settle(); })
          .catch(err => showToast(`Failed to remove favorite: ${formatApiError(err)}`, 'error'));
      } else {
        Promise.all(paths.map(p => API.post('/favorites', { path: p })))
          .then(() => { showToast('Added to Favorites', 'default'); settle(); })
          .catch(err => showToast(`Failed to favorite: ${formatApiError(err)}`, 'error'));
      }
      break;
    }
    case 'cm-add-tag': {
      // The row was already selected by the 'contextmenu' listener
      // (ensureRowSelected) before this menu item could be clicked — just
      // surface the Inspector's existing tag-add input for it. The Tags pane
      // is display:none unless it's the active tab (Preview is the default),
      // so switch to it first or .focus() below is a silent no-op.
      const inspectorEl = document.getElementById('inspector');
      if (inspectorEl && !inspectorEl.classList.contains('inspector--open')) toggleInspector();
      switchInspectorTab('tags');
      document.getElementById('inspector-tag-input')?.focus();
      break;
    }
    case 'cm-pin-sidebar': {
      const path = contextTargetPath();
      if (!path) break;
      API.post('/pins', { path })
        .then(loadPins)
        .catch(err => showToast(`Failed to pin: ${formatApiError(err)}`, 'error'));
      break;
    }
    case 'cm-index-folder': {
      const path = contextTargetPath();
      if (!path) break;
      const name = pathBaseName(path) || path;
      API.post('/index', { path })
        .then(() => showToast(`Indexing ${name}…`, 'default'))
        .catch(err => showToast(`Failed to index: ${formatApiError(err)}`, 'error'));
      break;
    }
    case 'cm-properties': {
      const path = contextMenuType === 'empty-area' ? browserState.path : contextTargetPath();
      if (path) openProperties(path);
      break;
    }
    case 'inspector-more':
      showContextMenu(0, 0, INSPECTOR_MORE_MENU_ITEMS, { anchor: btn });
      break;
    case 'inspector-properties': {
      const path = browserState.selection.size === 1 ? [...browserState.selection][0] : null;
      if (path) openProperties(path);
      break;
    }
    case 'switch-properties-tab':
      switchPropertiesTab(btn.dataset.tab);
      break;
    case 'props-apply':
      propertiesApply();
      break;
    case 'props-close':
      closeProperties();
      break;
    case 'props-open-with': {
      const path = propertiesCurrentPath();
      if (path) {
        Promise.resolve(window.electronAPI?.openWithDialog?.(path)).then(ok => {
          if (!ok) showToast('Failed to open the Open With dialog', 'error');
        });
      }
      break;
    }
    case 'props-advanced': {
      const path = propertiesCurrentPath();
      if (path) {
        Promise.resolve(window.electronAPI?.showProperties?.(path)).then(ok => {
          if (!ok) showToast('Failed to open Properties', 'error');
        });
      }
      break;
    }
    case 'settings-set-properties-mode': {
      const mode = applyPropertiesMode(btn.dataset.val);
      saveSetting('ui.properties_mode', mode);
      break;
    }
    case 'cm-toggle-hidden':
      toggleShowHidden();
      break;
    case 'cm-view-list':
      // Empty-area menu's "View → Details" — maps to the View menu's own
      // Details item (the renamed columns view).
      setViewMode('details', { manual: true });
      break;
    case 'cm-view-grid':
      // Empty-area menu's "View → Grid" — maps to the View menu's Medium
      // icons (the grid default scale).
      setListScale(1);
      setViewMode('grid', { manual: true });
      break;
    case 'cm-sort-name':
      applySort('name', (browserState.sort.key === 'name' && browserState.sort.dir === 'asc') ? 'desc' : 'asc');
      break;
    case 'cm-sort-modified':
      applySort('modified', (browserState.sort.key === 'modified' && browserState.sort.dir === 'asc') ? 'desc' : 'asc');
      break;

    // ── View / Sort toolbar menus (Task 10) ─────────────────────────────
    case 'open-view-menu':
      showContextMenu(0, 0, VIEW_MENU_ITEMS, { anchor: btn, ctx: menuContext() });
      break;
    case 'open-sort-menu':
      showContextMenu(0, 0, SORT_MENU_ITEMS, { anchor: btn, ctx: menuContext() });
      break;
    case 'view-xl':
      setListScale(2);
      setViewMode('grid', { manual: true });
      break;
    case 'view-large':
      setListScale(1.5);
      setViewMode('grid', { manual: true });
      break;
    case 'view-medium':
      setListScale(1);
      setViewMode('grid', { manual: true });
      break;
    case 'view-small':
      setListScale(0.75);
      setViewMode('grid', { manual: true });
      break;
    case 'view-list':
      setViewMode('list', { manual: true });
      break;
    case 'view-details':
      setViewMode('details', { manual: true });
      break;
    case 'toggle-show-hidden':
      toggleShowHidden();
      break;
    case 'toggle-show-extensions': {
      const next = !browserState.showExtensions;
      browserState.showExtensions = next;
      saveSetting('ui.show_extensions', next);
      renderDirectory(); // re-render cached entries locally — no re-fetch needed
      const extToggle = document.querySelector('[data-action="settings-toggle"][data-setting="show-extensions"]');
      if (extToggle) extToggle.checked = next;
      break;
    }
    case 'toggle-dynamic-media': {
      const next = !((window.__fpConfig || {})['ui.dynamic_media_view'] !== false);
      saveSetting('ui.dynamic_media_view', next);
      const dmToggle = document.querySelector('[data-action="settings-toggle"][data-setting="dynamic-media-view"]');
      if (dmToggle) dmToggle.checked = next;
      break;
    }
    case 'sort-name':
      applySort('name', browserState.sort.dir);
      break;
    case 'sort-modified':
      applySort('modified', browserState.sort.dir);
      break;
    case 'sort-type':
      applySort('type', browserState.sort.dir);
      break;
    case 'sort-size':
      applySort('size', browserState.sort.dir);
      break;
    case 'sort-asc':
      applySort(browserState.sort.key, 'asc');
      break;
    case 'sort-desc':
      applySort(browserState.sort.key, 'desc');
      break;

    default:
      if (!IN_SCOPE_ACTIONS.has(action)) {
        // Stub: log and show toast for out-of-scope actions
        console.log(`[FilePlus] data-action stub: ${action}`, btn.dataset);
        showToast(`Action "${action}" — not yet implemented`, 'action');
      }
  }
});

// Hex accent input — listen on input event, not click
document.addEventListener('input', e => {
  const t = e.target;
  if (t && t.dataset && t.dataset.action === 'settings-set-accent-hex') {
    // Only persist once the value is actually a valid hex — a half-typed
    // value ("#4C") shouldn't overwrite the last-good saved accent.
    if (applyAccentHex(t.value)) saveSetting('ui.accent_hex', t.value.trim());
  }
  // Properties panel's editable name field — any keystroke enables Apply.
  if (t && t.id === 'properties-name-input') propertiesMarkDirty();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (!t || !t.dataset) return;
  if (t.dataset.action === 'settings-set-show-notifications') {
    setNotificationsEnabled(t.checked);
    saveSetting('ui.notifications', t.checked);
    return;
  }
  if (t.dataset.action === 'settings-toggle' && t.dataset.setting === 'show-extensions') {
    browserState.showExtensions = t.checked;
    saveSetting('ui.show_extensions', t.checked);
    renderDirectory(); // re-render cached entries locally — no re-fetch needed
    return;
  }
  if (t.dataset.action === 'settings-toggle' && t.dataset.setting === 'show-hidden') {
    browserState.showHidden = t.checked;
    saveSetting('ui.show_hidden', t.checked);
    refreshDirectory();
    return;
  }
  if (t.dataset.action === 'settings-toggle' && t.dataset.setting === 'dynamic-media-view') {
    saveSetting('ui.dynamic_media_view', t.checked);
    return;
  }
  if (t.dataset.action === 'settings-quick-access-toggle') {
    const id = t.dataset.knownId;
    if (id) setQuickAccessHidden(id, !t.checked);
    return;
  }
  if (t.dataset.action === 'settings-set-backspace-deletes') {
    saveSetting('ui.backspace_deletes', t.checked);
    return;
  }
  // Properties panel — an attribute checkbox or the folder-type select was
  // touched; propertiesApply() re-reads the live DOM state itself, so this
  // only needs to enable Apply, not track the new value.
  if (t.dataset.action === 'props-attr-toggle' || t.dataset.action === 'props-folder-type-select') {
    propertiesMarkDirty();
    return;
  }
});

function setNotificationsEnabled(enabled) {
  localStorage.setItem('fp-notifications-enabled', enabled ? 'on' : 'off');
  const checkbox = document.getElementById('settings-show-notifications');
  if (checkbox) checkbox.checked = !!enabled;
}

// Tab drag-reorder (A.1.2) — DOM-only (tabs.list's order is never read for
// anything order-sensitive; closeTabById() picks its fallback-active
// neighbor off the DOM for exactly this reason).
let _dragTab = null;

function initTabDrag(tab) {
  tab.addEventListener('dragstart', e => {
    _dragTab = tab;
    tab.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
  });
  tab.addEventListener('dragend', () => {
    _dragTab = null;
    tab.style.opacity = '';
    document.querySelectorAll('.fp-tab').forEach(t => {
      t.classList.remove('fp-tab--drag-over-before', 'fp-tab--drag-over-after');
    });
    showSnackbar('Tab order saved', null, null);
    // INTEGRATION: POST /ui/tabs with new order for persistence
  });
  tab.addEventListener('dragover', e => {
    if (!_dragTab || _dragTab === tab) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = tab.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    document.querySelectorAll('.fp-tab').forEach(t => {
      t.classList.remove('fp-tab--drag-over-before', 'fp-tab--drag-over-after');
    });
    if (e.clientX < mid) {
      tab.classList.add('fp-tab--drag-over-before');
    } else {
      tab.classList.add('fp-tab--drag-over-after');
    }
  });
  tab.addEventListener('dragleave', () => {
    tab.classList.remove('fp-tab--drag-over-before', 'fp-tab--drag-over-after');
  });
  tab.addEventListener('drop', e => {
    if (!_dragTab || _dragTab === tab) return;
    e.preventDefault();
    const tabbar = tab.parentElement;
    const rect = tab.getBoundingClientRect();
    if (e.clientX < rect.left + rect.width / 2) {
      tabbar.insertBefore(_dragTab, tab);
    } else {
      tabbar.insertBefore(_dragTab, tab.nextSibling);
    }
    tab.classList.remove('fp-tab--drag-over-before', 'fp-tab--drag-over-after');
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // ⌘K / Ctrl+K — command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openPalette(); }
  // Ctrl+B — sidebar
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  // ⌘I / Ctrl+I — inspector
  if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); toggleInspector(); }
  // Ctrl+J — Ask File+ (Task 15)
  if ((e.metaKey || e.ctrlKey) && e.key === 'j') { e.preventDefault(); toggleAskPopout(); }
  // Ctrl+= or Ctrl++ — zoom in (with or without Shift; standard browser convention)
  if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
  // Ctrl+- or Ctrl+_ — zoom out
  if ((e.metaKey || e.ctrlKey) && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomOut(); }
  // Ctrl+0 — reset zoom
  if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); zoomReset(); }
  // Ctrl+Shift+R — Review Bin
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') { e.preventDefault(); switchScreen('review-bin'); }
  // Ctrl+T — new tab
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 't') { e.preventDefault(); openNewTab(); }
  // Ctrl+W — close current tab
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') { e.preventDefault(); closeCurrentTab(); }
  // Ctrl+Shift+T — reopen last closed tab
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') { e.preventDefault(); reopenLastTab(); }
  // Ctrl+1..9 — numbered shortcuts (screen navigation stubs)
  // Escape — close all overlays
  if (e.key === 'Escape') {
    closePalette();
    hideContextMenu();
    closeModal();
    closeTagCanvas();
    closeProperties();
    closeAskPopout();
  }
  // Browser-screen keyboard nav (selection, sort-order arrows, Enter, F5,
  // Ctrl+A, Alt+arrows) only applies when that screen is active and the
  // user isn't typing into an input/textarea/contenteditable element.
  // Fix round 1: narrowly exclude only Enter/Space while focus sits on a
  // sidebar element — a sidebar row/button (This PC's chevron included)
  // owns its own Enter/Space activation (native <button> click, or a
  // dedicated keydown listener) and must not also have Enter reinterpreted
  // as "open the focused FILE LIST row" (browserState.focus has nothing to
  // do with sidebar focus). Every OTHER shortcut (F2, Delete, F5, Ctrl+Z/Y/
  // X/C/V, arrow navigation, …) must keep reaching browserKeydown
  // regardless of where DOM focus happens to be — excluding the whole
  // sidebar for every key (the original fix) went too far and silently
  // killed all of those the moment the user clicked any sidebar control.
  const activeEl = document.activeElement;
  const activeTag = activeEl && activeEl.tagName;
  const isEditableTarget = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (activeEl && activeEl.isContentEditable);
  const sidebarKeyActivation = (e.key === 'Enter' || e.key === ' ') && activeEl?.closest?.('#sidebar');
  const browserScreenActive = document.getElementById('screen-browser')?.classList.contains('active');
  if (browserScreenActive && !isEditableTarget && !sidebarKeyActivation && typeof browserKeydown === 'function') {
    browserKeydown(e);
  }
  const homeScreenActive = document.getElementById('screen-home')?.classList.contains('active');
  if (homeScreenActive && !isEditableTarget && typeof homeKeydown === 'function') {
    homeKeydown(e);
  }
});

// Middle-click (auxclick, button 1) on a tab closes it — matches every
// browser's tab strip. 'click' never fires for the middle button, so this
// needs its own listener rather than a data-action case.
document.addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  const tabEl = e.target.closest('.fp-tab');
  if (!tabEl) return;
  e.preventDefault();
  closeTabById(tabEl.dataset.tabId);
});

// Ctrl + scroll wheel over the file list — steps --list-scale (Task 10,
// explorer-only zoom of just the listing), one step per gesture; anywhere
// else it's now ignored entirely — application zoom is keyboard-only
// (Ctrl+=/-/0 above). Throttled because trackpads (and high-resolution
// wheels) emit dozens of wheel events per swipe; without a cooldown a single
// flick would jump straight to the min/max scale. ~80ms matches the natural
// pacing of one "notch" of a physical wheel without making intentional fast
// scrolls feel sluggish.
{
  let lastWheelAt = 0;
  const COOLDOWN_MS = 80;
  document.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (!e.target.closest('#list-scroll')) return; // outside the list: ignore
    e.preventDefault(); // suppress the default page-scroll while scaling
    const now = performance.now();
    if (now - lastWheelAt < COOLDOWN_MS) return;
    lastWheelAt = now;
    stepListScale(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

// ── Context menu event listener (A.10) ────────────────────────────────────────
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  // Right-click on open space clears the active selection too (design spec
  // §3.5), same rule as the mousedown handler above — checked directly
  // against the target rather than gated on contextMenuType === 'empty-area'
  // below, since e.g. an unpinned sidebar item (Home, a drive) resolves to
  // the empty-area MENU but is still an interactive row that must stay
  // excluded from deselect.
  deselectOnOpenSpace(e.target);
  contextMenuType = getMenuTypeForTarget(e.target);
  contextMenuTarget = contextMenuType === 'sidebar-item'
    ? e.target.closest('.fp-sidebar__item[data-pin-id], .fp-sidebar__item[data-known-id]')
    : e.target;
  // Right-click on a row that isn't already selected selects it alone before
  // the menu opens; right-click within an existing multi-selection leaves it
  // untouched so batch actions (Task 4) apply to the whole selection.
  if (contextMenuType === 'file' || contextMenuType === 'folder') {
    const row = e.target.closest('.fp-row[data-path]');
    if (row && typeof ensureRowSelected === 'function') ensureRowSelected(row.dataset.path);
  }

  // Home row menu: select the row first (mirrors the plain-click
  // select+inspect behavior) so buildMenuContext below reads the row that's
  // actually about to be highlighted.
  if (contextMenuType === 'home-row') {
    const row = e.target.closest('.fp-row[data-path]');
    if (row) {
      const pane = row.closest('.home-pane');
      pane?.querySelectorAll('.fp-row--selected').forEach(r => { if (r !== row) r.classList.remove('fp-row--selected'); });
      row.classList.add('fp-row--selected');
    }
  }

  const items = CONTEXT_MENUS[contextMenuType] || CONTEXT_MENUS.file;
  // Every dynamic label (favorites toggle, hidden-files toggle, sidebar-item
  // kind) and every applicability rule (§4.2) now goes through this one
  // ctx, read by the items' own enabled(ctx)/label(ctx) — replacing the
  // per-menu-type filtering/relabeling this listener used to do inline.
  const ctx = buildMenuContext(e.target);
  showContextMenu(e.clientX, e.clientY, items, { ctx });
});

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Idempotent belt-and-braces: icons.js already installs the sprite
  // synchronously at parse time (see its own DOMContentLoaded fallback for
  // the case this script somehow ran before <body> existed); calling again
  // here is a guaranteed no-op unless that path was somehow skipped.
  fpInstallSprite();

  // Register the statically-authored seed tab into the tabs model — every
  // other tab is created through createTab(). Must run before anything else
  // touches activeTab()/nav (switchScreen('home') at the end of this handler
  // included).
  seedInitialTab();

  // Restore theme from localStorage
  const savedTheme = localStorage.getItem('fp-theme');
  if (THEME_MODES.includes(savedTheme)) document.documentElement.dataset.theme = resolveTheme(savedTheme);

  initWindowControls();
  initResizer();
  initInspectorTagInput();
  // Paint the inspector's real "No file selected" empty state immediately —
  // otherwise its static placeholder markup (a sample filename/size/etc.)
  // would show through until the first selection change, and the inspector
  // is open by default now (ui.inspector_open, applied below once config
  // loads) instead of starting closed.
  updateInspector('none');
  initSidebarResize();
  restoreSidebarState();
  initSearch();
  initToolbarNarrowMode();
  checkBackend();
  // The status pill is the reconnect affordance (role="button" in the
  // markup): its click reaches the delegated switch, but a <span> never
  // activates on a key press by itself.
  document.getElementById('status-backend')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refreshBackendConnection(); }
  });
  const _backendPollId = setInterval(checkBackend, 30_000);
  window.addEventListener('beforeunload', () => clearInterval(_backendPollId), { once: true });

  // NOTE: sidebar-collapse and theme-toggle are wired via data-action delegation
  // (see the click switch above). Direct addEventListener calls were removed
  // because they fired in addition to the delegated handler, causing each click
  // to toggle twice (visible no-op). The View/Sort toolbar buttons (Task 10)
  // are data-action="open-view-menu"/"open-sort-menu" for the same reason —
  // no separate listener needed here.

  // Palette backdrop click closes
  paletteScrim?.addEventListener('click', e => {
    if (e.target === paletteScrim) closePalette();
  });

  // Tag canvas backdrop click closes
  document.getElementById('tag-canvas-scrim')?.addEventListener('click', e => {
    if (e.target === document.getElementById('tag-canvas-scrim')) closeTagCanvas();
  });

  // Modal backdrop click closes
  document.getElementById('modal-scrim')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-scrim')) closeModal();
  });

  // Properties panel backdrop click closes
  document.getElementById('properties-modal-scrim')?.addEventListener('click', e => {
    if (e.target === document.getElementById('properties-modal-scrim')) closeProperties();
  });

  // Ask File+ popout (Task 15) has no scrim — it's a lightweight anchored
  // popover, not a modal — so "click outside closes it" is a mousedown
  // listener that ignores anything inside the popout or the button that
  // opens it (that click's own 'ask-open' case toggles it instead; if this
  // listener also closed it on mousedown, the following click would just
  // reopen it and the button would appear to do nothing).
  document.addEventListener('mousedown', e => {
    if (!askPopoutOpen()) return;
    const popout = document.getElementById('ask-popout');
    if (popout?.contains(e.target) || e.target.closest('.fp-ask')) return;
    closeAskPopout();
  });

  // Palette item clicks
  document.querySelectorAll('.fp-palette__item, .palette__item').forEach(btn => {
    btn.addEventListener('click', () => handlePaletteAction(btn));
  });

  // Init tab drag-reorder for existing tabs (A.1.2)
  document.querySelectorAll('.fp-tab[draggable]').forEach(initTabDrag);

  // Sidebar device name — load saved name or fall back to OS hostname
  initDeviceName();

  // This PC section head is a <div role="button"> (its click already routes
  // through the delegated data-action switch above) — Enter/Space need their
  // own listener since a div, unlike a real <button>, never activates on a
  // key press by itself.
  document.querySelector('#sb-thispc .fp-sidebar__section-head')?.addEventListener('keydown', e => {
    // Enter/Space on the nested chevron button (data-action="thispc-toggle")
    // must toggle collapse, not also open This PC — only act when this
    // listener's own element (the section-head row itself), not a
    // descendant, was the real key target (Task 9 review, fix round 1).
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBrowserAt(null); }
  });

  // Sync the status-bar zoom pill with Electron's persisted zoom factor
  updateZoomPill();

  // Init column sort cycling, marquee selection, and row click/dblclick (A.3.1, Task 3)
  initColumnSort();
  initMarqueeSelection();
  initRowInteractions();

  // Drag and drop: rows onto folder rows / sidebar items / breadcrumb crumbs /
  // the Up button, on pointer events (Task 12 — dragdrop.js; the three HTML5
  // initialisers this replaced are gone).
  initDragDrop();

  // Home: double-click to open (Task 6) + Favorites drag-to-reorder
  initHomeRowInteractions();
  initFavoritesDragDrop();

  // View mode is no longer restored from sessionStorage here — ui.view_mode/
  // ui.list_scale (config) are applied by applySettingsFromConfig() below,
  // and every real navigation re-decides the view itself (loadDirectory()'s
  // dynamic-media-view check, Task 10).

  // Init underline tabs in any pre-existing tab containers
  document.querySelectorAll('.fp-tabs').forEach(initUnderlineTabs);

  // Restore persisted settings (theme, density, accent, font scale)
  restoreSettings();

  // Always start on Home — the previous "restore last active screen"
  // behaviour landed users on whatever they last visited (often Browser),
  // which was disorienting on cold start. Tabs preserve their own state
  // through `activateTab()`; this only sets the initial paint.
  //
  // Painted BEFORE the backend chain below, not after it: the click
  // dispatcher is live from parse time, so a user who clicks a drive or
  // Quick Access item while those awaits are still running used to be yanked
  // back to Home the moment they finished. Home also shows its own empty
  // states immediately this way instead of staying literally blank until the
  // last await lands.
  switchScreen('home');

  // Load the config cache, then everything that reads from it — Downloads'
  // real path and the show-hidden default — followed by the sidebar's live
  // drives/pins. loadConfig/fpLoadKnownFolders stay ordered (the settings
  // apply and the icon map depend on them); the three independent sidebar
  // loaders run together. Each step degrades to a harmless no-op on backend
  // failure, and every request is bounded by apiTimeout() so a backend that
  // has bound its port but not finished starting can't stall init forever.
  try {
    await loadConfig();
    applySettingsFromConfig();
    restoreSettingsPane();
    // Before the first listing renders: iconFor() decides the special folder
    // icons (Desktop, Downloads, …) by matching a path against this map, and
    // falls back to guessing from the folder's name until it has loaded.
    await fpLoadKnownFolders();
    await Promise.allSettled([loadDrives(), loadPins(), loadSidebarTags()]);
    loadQuickAccess();
    await checkCrashRecovery();
  } catch (err) {
    // Nothing above is supposed to reject (each loader swallows its own
    // failure), but an unhandled one here would silently abort the rest of
    // init with no trace at all.
    console.warn('[fp-init] startup data load failed:', err);
  }

  // ── A.17 Edge case INTEGRATION stubs ──────────────────────────────────────
  // #2  External folder missing on navigation → show fp-error-banner "This folder no longer exists"
  //     INTEGRATION: catch 404/ENOENT from GET /ls?path=... → toggle .fp-error-banner in browser screen
  // #6  Files added to Everything Folder while tray is closed → update count badge on next open
  //     INTEGRATION: GET /ef/count on tray show event → update #tray-rb-badge
  // #8  Drop file onto sidebar folder → accept drag event, call POST /move (requires approval)
  //     INTEGRATION: sidebar items need dragover + drop listeners → openModal('move', {src, dest})
  // #9  Inspector opened on a file that has been deleted externally → show preview fail state
  //     INTEGRATION: GET /file/preview?path=... → on 404 show commented preview-fail HTML
  // #12 Scan starts while one is already running → show toast "Scan already in progress"
  //     INTEGRATION: POST /scan/start → if 409 response → showToast('Scan already running', 'warn')
  // #13 Ollama model not downloaded when classification starts → show error banner with install CTA
  //     INTEGRATION: GET /ai/status → if model_status !== 'ready' → show #banner-ai-offline
});

/**
 * Crash recovery (Task 4): GET /operations/pending returns whatever the
 * backend's startup reconciliation classified as left mid-flight by an
 * abnormal shutdown ([] once reconciliation has run with nothing pending —
 * always [] until Task 9 wires reconcile_pending() into the API's lifespan).
 * Non-empty → one line per row: op type, source → dest, resolution.
 */
async function checkCrashRecovery() {
  let rows;
  try { rows = await API.get('/operations/pending', null, apiTimeout()); } catch (_) { return; }
  if (!rows || !rows.length) return;
  const body = rows.map(r => `${r.op_type}: ${r.source_path || '—'} → ${r.dest_path || '—'} (${r.resolution || 'unresolved'})`).join('\n');
  openModal('warn', { title: 'Recovered operations', body, confirmLabel: 'OK' });
  // The report is one-shot: the backend holds its startup reconciliation
  // result in memory for the whole of its own lifetime, so without this ack a
  // renderer reload (Ctrl+R) or an Electron relaunch against the same backend
  // would re-open this exact modal on every start until the backend itself
  // was restarted.
  try { await API.post('/operations/pending/ack', {}, apiTimeout()); } catch (_) { /* shown either way */ }
}
