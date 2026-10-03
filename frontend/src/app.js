// ── DOM references ─────────────────────��────────────────────────────────────
const shell              = document.getElementById('shell');
const sidebar            = document.getElementById('sidebar');
const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse');
const paletteScrim       = document.getElementById('palette-scrim');
const paletteInput       = document.getElementById('palette-input');

// ── Motion: the one switch (Stage 2D addendum §5.1) ──────────────────────────
// Settings › Personalization › "Animations" (ui.animations, default on) is the
// only thing that turns motion on or off — Windows' "Animation effects"
// (the reduced-motion media query) gates nothing (decision A-2). The switch
// is html[data-motion="on"|"off"]: styles.css gives everything under anything
// but "on" no animation and no transition, and every JS-driven animation asks
// fpMotionOn() (fpAnimate, the zoom ease, the spring-load pulse wait).
//
// Decided here, at app.js's first line, before anything can animate: a launch
// override (--fp-motion=on|off, the test harness) wins; otherwise the
// localStorage mirror of the last applied setting, so a user who turned it
// off sees no motion at boot either; the config value (the source of truth)
// is applied when it loads (applySettingsFromConfig). Until this runs the
// attribute is unset, which the CSS gate already treats as off.
const FP_MOTION_LS_KEY = 'fp-animations';
const FP_MOTION_DURATIONS = ['instant', 'fast', 'base', 'slow'];
const FP_MOTION_EASINGS = ['out', 'in', 'standard'];
const _fpMotionOverride = (() => {
  const o = window.electronAPI?.motionOverride?.();
  return o === 'on' || o === 'off' ? o : null;
})();
(function fpBootMotion() {
  let on = true;
  if (_fpMotionOverride) on = _fpMotionOverride === 'on';
  else {
    try { on = localStorage.getItem(FP_MOTION_LS_KEY) !== 'off'; } catch (_) { /* default on */ }
  }
  document.documentElement.dataset.motion = on ? 'on' : 'off';
})();

/** True while animations are on (html[data-motion="on"]). */
function fpMotionOn() {
  return document.documentElement.dataset.motion === 'on';
}

/** The launch override ('on' | 'off'), or null when the setting decides. */
function fpMotionOverride() {
  return _fpMotionOverride;
}

let _fpMotionTokens = null;
/** The --motion-* durations (ms) and --ease-* curves, read once from
 * styles.css's :root — the one source for CSS and JS motion alike. */
function fpMotionTokens() {
  if (_fpMotionTokens) return _fpMotionTokens;
  const cs = getComputedStyle(document.documentElement);
  const ms = (name, fallback) => {
    const raw = cs.getPropertyValue(name).trim();
    const n = parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    return /ms$/.test(raw) ? n : (/s$/.test(raw) ? n * 1000 : n);
  };
  const fallbackMs = { instant: 60, fast: 100, base: 140, slow: 200 };
  const durations = {};
  for (const n of FP_MOTION_DURATIONS) durations[n] = ms(`--motion-${n}`, fallbackMs[n]);
  const easings = {};
  for (const n of FP_MOTION_EASINGS) easings[n] = cs.getPropertyValue(`--ease-${n}`).trim() || 'ease-out';
  _fpMotionTokens = { durations, easings, ms };
  return _fpMotionTokens;
}

/** A --motion-* token in ms: fpMotionMs('fast') → 100; any other custom
 * property name ('--motion-spring') is read as given. */
function fpMotionMs(name) {
  const t = fpMotionTokens();
  if (t.durations[name] != null) return t.durations[name];
  return t.ms(name, t.durations.base);
}

// Animations fpAnimate() started that may still be running: cancelled the
// moment the switch goes off. Per element, one animation per key.
const _fpLiveAnimations = new Set();
const _fpAnimationsByEl = new WeakMap();   // el -> Map(key -> Animation)

/**
 * The one way JS animates (scripts/check_motion.js rejects any other call
 * to Element.animate). Decoration only (§5.1 rule 1): the caller has already
 * put the state, the DOM and focus where they belong; this only plays a
 * transition on top, and nothing may wait for it.
 *
 * A new call on the same element and key cancels the one before it (nothing
 * queues). Returns the Animation, or null when animations are off (any
 * previous one for that key is still cancelled).
 *
 *   duration: 'instant' | 'fast' | 'base' | 'slow' (default 'fast') or ms,
 *             clamped to --motion-slow (the ceiling); an unknown name or a
 *             NaN / negative / zero ms gets the default ('fast')
 *   easing:   'out' (default) | 'in' | 'standard'
 *   key:      names the animation slot on `el` (default 'default')
 *   delay:    ms before it starts (a stagger), clamped to 0..--motion-slow
 *   fill:     'none' (default) or 'backwards' only — state lives in the DOM,
 *             never in an animation's fill, so a finished animation leaves
 *             nothing behind (anything else is treated as 'none')
 */
function fpAnimate(el, keyframes, { duration = 'fast', easing = 'out', key = 'default', delay = 0, fill = 'none' } = {}) {
  if (!el) return null;
  let slots = _fpAnimationsByEl.get(el);
  const prev = slots && slots.get(key);
  if (prev) { slots.delete(key); _fpLiveAnimations.delete(prev); prev.cancel(); }
  if (!fpMotionOn() || typeof el.animate !== 'function') return null;
  const t = fpMotionTokens();
  const ceiling = t.durations.slow;
  let ms = t.durations.fast;
  if (typeof duration === 'number') {
    if (Number.isFinite(duration) && duration > 0) ms = Math.min(duration, ceiling);
  } else if (t.durations[duration] != null) {
    ms = t.durations[duration];
  }
  const wait = Number.isFinite(delay) ? Math.max(0, Math.min(delay, ceiling)) : 0;
  const anim = el.animate(keyframes, {
    duration: ms,
    easing: t.easings[easing] || t.easings.out,
    delay: wait,
    fill: fill === 'backwards' ? 'backwards' : 'none',
  });
  if (!slots) { slots = new Map(); _fpAnimationsByEl.set(el, slots); }
  slots.set(key, anim);
  _fpLiveAnimations.add(anim);
  const done = () => {
    _fpLiveAnimations.delete(anim);
    if (slots.get(key) === anim) slots.delete(key);
  };
  anim.addEventListener('finish', done);
  anim.addEventListener('cancel', done);
  return anim;
}

/**
 * Turns animations on or off at once (no restart): sets html[data-motion],
 * cancels whatever fpAnimate() still has running when it goes off, mirrors
 * the choice to localStorage (the boot read above), syncs the Settings
 * switch, fires `fpMotionChanged` on document ({detail: {on}}) when it
 * changed, and, unless {persist: false}, saves ui.animations.
 */
function fpSetMotion(on, { persist = true } = {}) {
  on = !!on;
  const was = fpMotionOn();
  document.documentElement.dataset.motion = on ? 'on' : 'off';
  if (!on) {
    for (const a of [..._fpLiveAnimations]) a.cancel();
    _fpLiveAnimations.clear();
  }
  try { localStorage.setItem(FP_MOTION_LS_KEY, on ? 'on' : 'off'); } catch (_) { /* boot falls back to on */ }
  const toggle = document.getElementById('settings-animations');
  if (toggle) toggle.checked = on;
  if (typeof zoomEaseMode === 'function') window.__fpZoomEase = zoomEaseMode();
  if (was !== on) document.dispatchEvent(new CustomEvent('fpMotionChanged', { detail: { on } }));
  if (persist) saveSetting('ui.animations', on);
}

// ── Screen switching ────────────────────────────────────────────────────────
// Only screens that work today are in index.html (Home, Browser, Settings).
// The Stage 3/4 mock-ups (File Tree, Scan, Review Bin, Everything Folder)
// were taken out of the DOM in Stage 2D Task 12a — no control may ship that
// does nothing — and live as design reference in
// docs/archive/2026-10-02-unbuilt-screens-markup.html until their stage
// builds them for real.

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
const CLOSED_TABS_MAX = 20; // Ctrl+Shift+T depth

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

/** Tab label for a browser-screen path: 'This PC' for the This PC page
 * (THISPC, or a tab with no folder yet), the bare drive letter for a drive
 * root ('C:' — the owner's pass-1 rule; the full name lives in the
 * breadcrumb), the folder's basename otherwise. (A Home tab's label comes from createTab's
 * own 'Home' default, not from here — this only ever runs for the browser
 * screen, from onNavigated().) */
function tabLabelFor(path) {
  if (!path || path === THISPC) return 'This PC';
  const norm = String(path).replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(norm)) return norm.toUpperCase();
  return pathBaseName(norm) || norm;
}

/** 'Seagate Barracuda 4tb HDD (D:)' from the cached /drives list
 * (window.__fpDrives, populated by loadDrives()) — 'Local Disk (D:)' when the
 * drive has no label, or the bare letter when the drive isn't in the cache
 * yet (e.g. a breadcrumb painted before loadDrives() has resolved). */
function driveDisplayLabel(letter) {
  const norm = String(letter || '').replace(/[\\/]+$/, '').toUpperCase();
  const drives = window.__fpDrives || [];
  const d = drives.find(x => driveLetterOf(x) === norm);
  // One formatter for every place a drive is named (thispc.js, Stage 2D §8).
  return d ? driveDisplayName(d) : norm;
}

/** Tab element icon: home for the Home screen, a drive glyph for a browser
 * tab sitting at a drive root, a plain folder for every other browser tab,
 * and the screen's own icon (falling back to a generic file glyph) for
 * anything else. In Windows-icon mode a browser tab shows the real shell
 * icon of its folder or drive (Stage 2D §4.6), at 16 px — a shell bucket —
 * where the chrome glyph keeps its 14. */
function tabIconFor(record) {
  if (record.screen === 'browser' && (!record.path || record.path === THISPC)) {
    // The This PC page is not a folder: the chrome glyph, never a shell
    // lookup of "thispc:".
    return icon('this-pc', 'fp-icon--14 fp-tab__icon');
  }
  if (record.screen === 'browser') {
    const norm = String(record.path || '').replace(/[\\/]+$/, '');
    const isDrive = /^[A-Za-z]:$/.test(norm);
    const item = record.path ? { path: isDrive ? norm + '\\' : record.path, is_dir: true } : null;
    return fpShellItemIcon(item, 16, isDrive ? 'drive' : 'folder', 'fp-tab__icon', 14);
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
  // The icon is the tab's first child: a chrome sprite glyph, or a shell image in
  // Windows-icon mode.
  const iconEl = el.querySelector(':scope > svg:first-child, :scope > img:first-child');
  if (iconEl) iconEl.outerHTML = tabIconFor(record);
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
  // Roving tabindex: the active tab is the strip's single tab stop, the rest
  // are reachable from it with the arrow keys. activateTab() moves the 0
  // along with aria-selected (pass 2 #158).
  el.setAttribute('tabindex', '-1');
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
    // This tab's own view and icon size (Stage 2D §3.1: tabs keep their own
    // view state), or null until it has had a listing of its own. The view
    // is global DOM state, so without per-tab values a Ctrl+wheel step in
    // one tab silently changed every other tab's listing on the next switch
    // (pass 2 #19).
    view: null,
    iconSize: null,
    scrollTop: 0,
    scrollLeft: 0,
    selection: [],
    // Task 14: this tab's own search (chips + text + the rendered results),
    // or null when it is showing a plain folder listing. Captured on every
    // deactivation and repainted on reactivation, so switching tabs and back
    // keeps the results without re-walking the tree.
    search: null,
    // Stage 2D §4.2: this tab's last folder listing ({path, entries, parent,
    // isRoot, truncated, fetchedAt}, entries by reference), painted at once
    // when the tab is activated again and then revalidated. null until the
    // tab has had a listing of its own.
    listing: null,
  };
  tabs.list.push(record);
  const el = createTabElement(record);
  const tabbar = document.getElementById('tabbar');
  const newTabBtn = document.getElementById('btn-new-tab');
  if (tabbar) tabbar.insertBefore(el, newTabBtn);
  initTabDrag(el);
  updateTabbarOverflow();
  return record;
}

/**
 * The tab strip is `overflow-x: auto` with its scrollbar hidden (styles.css's
 * .fp-tabbar), so once the tabs overflow it there is nothing on screen that
 * says so and nothing that brings a clipped tab back — a 12th Ctrl+T used to
 * create a tab (and push the "+" button) past the right edge where neither
 * could be seen or clicked (pass 2 #156). These two keep it reachable:
 * scrollTabIntoView() on every activation, and a wheel handler that maps a
 * vertical wheel onto scrollLeft (Chromium does not scroll an overflow-x
 * container from a plain wheel).
 */
function scrollTabIntoView(id) {
  const el = document.querySelector(`.fp-tab[data-tab-id="${id}"]`);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }
  updateTabbarOverflow();
}

/** Tab ids in the order they appear in the strip — the DOM is the authority on
 * order (drag-reorder never touches tabs.list, which is why closeTabById picks
 * its fallback neighbour off the DOM too). */
function tabsInStripOrder() {
  return [...document.querySelectorAll('.fp-tab')].map(t => t.dataset.tabId);
}

/** Activates the tab `step` places from the active one, wrapping at both ends
 * (Ctrl+Tab / Ctrl+Shift+Tab, and the tablist's Arrow keys). */
function cycleTab(step) {
  const order = tabsInStripOrder();
  if (order.length < 2) return;
  const at = order.indexOf(tabs.activeId);
  const next = ((at === -1 ? 0 : at + step) % order.length + order.length) % order.length;
  activateTab(order[next]);
  document.querySelector(`.fp-tab[data-tab-id="${order[next]}"]`)?.focus();
}

/** Marks the strip as having tabs clipped off its right edge, which is the
 * only hint the user gets that there are more (the scrollbar is hidden). */
function updateTabbarOverflow() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  const clipped = tabbar.scrollWidth - tabbar.clientWidth - tabbar.scrollLeft > 1;
  tabbar.classList.toggle('fp-tabbar--overflow', clipped);
}

/** Copies the live browserState/nav into the currently active tab's own
 * record — the record is the only place that state lives once this tab
 * stops being active (switched away from, closed, or duplicated). */
function syncActiveTabRecord() {
  const tab = activeTab();
  if (!tab) return;
  tab.path = browserState.path;
  tab.view = browserState.view;
  tab.iconSize = browserState.iconSize;
  // On the This PC page the selection is a drive card (thispc.js).
  const onThisPc = thisPcActive();
  tab.selection = onThisPc ? thisPcSelectionList() : [...browserState.selection];
  tab.historyIndex = nav.index;
  // The live search bar + its results, or null when this tab is showing a
  // plain listing (search.js's captureSearchState).
  tab.search = typeof captureSearchState === 'function' ? captureSearchState() : null;
  // The folder listing this tab shows, for the synchronous repaint when it is
  // activated again (Stage 2D §4.2). Search results are not a folder listing:
  // the tab keeps the one committed before the search started.
  if (typeof rememberTabListing === 'function') rememberTabListing();
  const scroller = document.getElementById(onThisPc ? 'thispc-view' : 'list-scroll');
  if (scroller) { tab.scrollTop = scroller.scrollTop; tab.scrollLeft = scroller.scrollLeft; }
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
    t.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  nav.history = incoming.history;
  nav.index = incoming.historyIndex;
  // Read the incoming tab's search snapshot NOW: loadDirectory()'s synchronous
  // prefix calls leaveSearchMode(), which clears `activeTab().search` — and
  // tabs.activeId is already this tab, so it would wipe the very snapshot the
  // resume check below is about to look for (pass 2 #14).
  const pendingSearch = incoming.search;
  // A new tab created past the right edge of the strip is invisible (the
  // scrollbar is hidden) until something scrolls it in — nothing did (pass 2 #156).
  scrollTabIntoView(id);

  if (incoming.screen === 'browser' && pendingSearch && pendingSearch.results
      && typeof restoreSearchResultsForTab === 'function') {
    // This tab was showing search results: repaint them from the tab's own
    // snapshot rather than re-running the walk. browserState.path stays the
    // folder the tab was in before the search, which is where the breadcrumb's
    // × (exitSearchResults) returns to.
    showScreenDom('browser');
    browserState.path = incoming.path;
    browserState.parent = null;
    browserState.isRoot = false;
    // Apply the INCOMING tab's own view before repainting its results —
    // otherwise renderDirectory() (called from inside restoreSearchResultsForTab
    // → renderSearchResults) paints them with whatever view the OUTGOING tab
    // left behind (e.g. a Large-icons Pictures tab making another tab's
    // results render as icons). Mirrors the listing branch's restore.view
    // handling below. render:false — the results render right below is the
    // only render (Stage 2D §4.2).
    setView(incoming.view || 'details', incoming.iconSize, { render: false });
    // This tab's own selection + scroll offset come back with its results, the
    // same two things the folder branch below restores (pass 2 #153).
    restoreSearchResultsForTab(pendingSearch, {
      selection: incoming.selection,
      scrollTop: incoming.scrollTop,
      scrollLeft: incoming.scrollLeft,
    });
    updateSidebarActive(incoming.path);
    refreshNavButtons();
  } else if (incoming.screen === 'browser') {
    const cached = cachedListingFor(incoming);
    if (!cached) {
      // Nothing of this tab's own to paint yet (a tab staged in the
      // background): #list-scroll still holds another tab's rows, which must
      // not be shown under this tab while its first fetch is in flight.
      // The state goes with the rows: entries, selection, anchor, focus and
      // path all belonged to the outgoing tab, and Delete / F2 / Ctrl+C /
      // Ctrl+X / Ctrl+R would otherwise act on that folder's invisible rows.
      // Until this tab's listing commits it has none (browserHasOwnListing).
      clearBrowserListing();
    }
    showScreenDom('browser');
    if (typeof searchResetBar === 'function') searchResetBar();
    const loaded = loadDirectory(incoming.path, {
      // Empty history means this tab was staged in the background (openBrowserAt
      // on an inactive tab) and is only now getting its first real fetch — treat
      // that as a real navigation (push it) rather than a pure restore.
      addToHistory: incoming.history.length === 0,
      restore: {
        scrollTop: incoming.scrollTop,
        scrollLeft: incoming.scrollLeft,
        selection: incoming.selection,
        view: incoming.view,
        iconSize: incoming.iconSize,
      },
      // Stale-while-revalidate (Stage 2D §4.2): the tab's own last listing is
      // painted synchronously — rows, scroll and selection in this same task,
      // no empty frame — and the fetch only patches what changed.
      cached,
    });
    // A search this tab had typed but not finished (its request was aborted
    // when it was switched away) re-runs once the folder listing underneath it
    // has landed — running the two concurrently would let the listing paint
    // over the results.
    if (pendingSearch && typeof resumeSearchForTab === 'function') {
      Promise.resolve(loaded).then(() => resumeSearchForTab(pendingSearch, incoming.id));
    }
  } else {
    showScreenDom(incoming.screen);
    updateSidebarActive(incoming.screen);
    // browserState is global: a Home/Settings tab must not inherit the
    // OUTGOING tab's search mode. It used to, and the first query typed on the
    // new tab was swallowed whole — searchEnsureBrowser()'s loadDirectory()
    // called leaveSearchMode(), which reset the bar and bumped the sequence
    // runSearch() checks, so the run superseded itself (pass 2 #89). Safe to
    // call here and not in resetToolbarForNonBrowser(): that one is shared
    // with switchScreen(), whose Browser branch restores a same-tab search
    // from exactly this flag.
    if (typeof leaveSearchMode === 'function') leaveSearchMode();
    // The toolbar is outside .screen, so the outgoing tab's breadcrumb, search
    // bar and nav-button state would otherwise stay on display — and stay
    // clickable — over this tab's Home/Settings screen (pass 2 #12).
    resetToolbarForNonBrowser(incoming.screen);
  }
  updateTabElementAppearance(incoming);
}

/** The tab's cached listing when it still describes the folder the tab is
 * at, else null (Stage 2D §4.2). */
function cachedListingFor(tab) {
  const l = tab && tab.listing;
  return (l && l.path && l.path === tab.path && Array.isArray(l.entries)) ? l : null;
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
  // The inspector describes the screen on display too (Task 14 Q2): off the
  // Browser it starts neutral — Settings has no selection at all, and Home's
  // rows are re-rendered unselected — never the item another screen had
  // selected. The Browser repaints it from its own selection when it commits.
  if (id !== 'browser' && typeof showInspectorNeutral === 'function') showInspectorNeutral();
  // The status bar describes the screen on display (browser.js).
  if (typeof updateStatusBar === 'function') updateStatusBar();
}

/**
 * Takes the Browser's chrome off the toolbar when a non-Browser screen
 * becomes the visible one.
 *
 * The toolbar (nav group, breadcrumb, search bar) is a sibling of `.screens`,
 * not a child of any `.screen`, so leaving the Browser screen leaves all of it
 * on display — describing, and still acting on, a listing the user can no
 * longer see (pass 2 #12). refreshNavButtons() now reads the active screen
 * itself, so calling it here is what actually disables Back/Forward/Up.
 */
function resetToolbarForNonBrowser(screenId) {
  if (typeof searchResetBar === 'function') searchResetBar();
  const crumb = document.getElementById('breadcrumb');
  if (crumb) {
    // A plain (non-interactive) label, not a data-action="navigate-crumb"
    // button: there is no path here to navigate to. The text sits in its own
    // .fp-breadcrumb__label like a folder crumb's, so a too-narrow bar
    // ellipsizes it and layoutToolbar() can measure what the ellipsis hides —
    // without it the layout flipped .is-tight every frame (Task 11).
    const label = typeof getScreenLabel === 'function' ? getScreenLabel(screenId) : '';
    crumb.innerHTML = label
      ? `<span class="fp-breadcrumb__crumb fp-breadcrumb__crumb--current"><span class="fp-breadcrumb__label">${escapeHtml(label)}</span></span>`
      : '';
  }
  if (typeof refreshNavButtons === 'function') refreshNavButtons();
}

function switchScreen(id, labelOverride) {
  // Mutate the ACTIVE tab's screen state — never switch tabs from here.
  const tab = activeTab();
  if (!tab) return;
  // A screen that is not in the DOM (one of the unbuilt Stage 3/4 screens
  // taken out in Task 12a, named by a stale caller) would leave the tab
  // showing nothing at all: stay where we are instead.
  if (!document.getElementById(`screen-${id}`)) return;
  tab.screen = id;
  if (id === 'browser') {
    if (tab.searchResume && browserState.mode === 'search' && typeof resumeSearchForTab === 'function') {
      // A search a failed navigation stopped while this tab was off the
      // Browser (failNavigation): run it again now that it is shown.
      const snap = tab.searchResume;
      tab.searchResume = null;
      showScreenDom('browser');
      updateSidebarActive(tab.path);
      resumeSearchForTab(snap, tab.id);
      return;
    }
    tab.searchResume = null;
    if (tab.path === null) {
      // This tab has never shown Browser before — open This PC (Stage 2D
      // §8). The Browser screen appears when that page commits, never
      // before with rows left over from another tab.
      loadDirectory(THISPC);
    } else if (browserState.mode === 'search' && tab.search && tab.search.results
               && typeof restoreSearchResultsForTab === 'function') {
      // This tab left the Browser screen mid-search. #list-scroll still holds
      // its results (screens are hidden, not torn down), but
      // resetToolbarForNonBrowser() took the bar and the "Search in x"
      // breadcrumb with it — put those back rather than painting a folder
      // breadcrumb over a results listing.
      showScreenDom('browser');
      const listEl = document.getElementById('list-scroll');
      restoreSearchResultsForTab(tab.search, {
        selection: [...browserState.selection],
        scrollTop: listEl ? listEl.scrollTop : 0,
        scrollLeft: listEl ? listEl.scrollLeft : 0,
      });
      updateSidebarActive(tab.path);
      if (typeof refreshNavButtons === 'function') refreshNavButtons();
    } else if (browserState.path !== tab.path || browserState.listingStale) {
      // #list-scroll is DOM shared by every tab, so what is sitting in it may
      // belong to ANOTHER tab (this tab was on Home while that one browsed) or
      // have been fetched with settings a Settings toggle has since changed
      // (browserState.listingStale, pass 2 #155). Re-fetch rather than reveal
      // somebody else's listing. commitListing() reveals the Browser screen
      // together with the rows (at once when the tab has a cached listing).
      loadDirectory(tab.path, {
        addToHistory: false,
        restore: {
          scrollTop: tab.scrollTop,
          scrollLeft: tab.scrollLeft,
          selection: tab.selection,
          view: tab.view,
          iconSize: tab.iconSize,
        },
        // A listing fetched before a settings change (listingStale) is not
        // worth painting first: the fetch would replace most of it.
        cached: browserState.listingStale ? null : cachedListingFor(tab),
      });
    } else {
      // Already has a folder loaded, still sitting in #list-scroll from
      // earlier in this tab's life (screens are hidden, not torn down) — just
      // reveal it, no re-fetch.
      tab.label = labelOverride || tabLabelFor(tab.path);
      updateTabElementAppearance(tab);
      showScreenDom('browser');
      updateSidebarActive(tab.path);
      updateBreadcrumb(tab.path);
      if (typeof refreshNavButtons === 'function') refreshNavButtons();
      // Nothing re-fetches on this path (the listing is already in
      // #list-scroll), so the inspector is whatever the last writer left —
      // including a Home row the user clicked while this screen was hidden.
      // Repaint it from THIS listing's own selection (pass 2 #75).
      if (typeof syncInspectorToBrowserSelection === 'function') syncInspectorToBrowserSelection();
    }
    return;
  }
  // A Browser navigation still in flight for this tab must not pull it back
  // to the Browser once it lands.
  if (typeof browserState !== 'undefined') browserState._loadSeq++;
  tab.label = labelOverride || getScreenLabel(id);
  updateTabElementAppearance(tab);
  showScreenDom(id);
  updateSidebarActive(id);
  resetToolbarForNonBrowser(id);
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
    target.path = path ?? THISPC;
    target.label = tabLabelFor(target.path);
    updateTabElementAppearance(target);
    return Promise.resolve();
  }
  // The current screen (Home, Settings, …) stays up until the folder has
  // loaded; commitListing() then switches screen, chrome and rows in one go,
  // and a failure leaves the user where they were with an error toast.
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
  // The listing is dropped (a reopened tab revalidates from scratch anyway)
  // and the stack is capped, so closed tabs never pin whole folder listings.
  _closedTabs.push({ ...record, listing: null });
  if (_closedTabs.length > CLOSED_TABS_MAX) _closedTabs.splice(0, _closedTabs.length - CLOSED_TABS_MAX);

  if (tabs.list.length === 0) {
    const fresh = createTab({ screen: 'home', label: 'Home' });
    activateTab(fresh.id);
  } else if (wasActive) {
    activateTab(neighborEl ? neighborEl.dataset.tabId : tabs.list[0].id);
  }
  updateTabbarOverflow();
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
  restored.iconSize = record.iconSize;
  restored.scrollTop = record.scrollTop;
  restored.scrollLeft = record.scrollLeft || 0;
  restored.selection = record.selection;
  // The closed record carried its search (closeTabById pushes the whole thing,
  // syncActiveTabRecord having just refreshed it) — createTab() starts every
  // tab at search:null, so it has to be carried across explicitly or Ctrl+W /
  // Ctrl+Shift+T silently drops the results (pass 2 #18).
  restored.search = record.search;
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
  copy.iconSize = source.iconSize;
  copy.selection = source.selection.slice();
  copy.scrollTop = source.scrollTop;
  copy.scrollLeft = source.scrollLeft || 0;
  // Duplicating a results tab duplicates the results, not the folder under
  // them — deep-cloned so the two tabs' snapshots never alias (pass 2 #18).
  copy.search = source.search ? JSON.parse(JSON.stringify(source.search)) : null;
  // Listings are never mutated in place, so the two tabs can share one.
  copy.listing = source.listing || null;
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
  const record = { id, screen: 'home', label: 'Home', path: null, history: [], historyIndex: -1, view: null, iconSize: null, scrollTop: 0, scrollLeft: 0, selection: [], search: null, listing: null };
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
// browser-screen path, including THISPC for the This PC page) and from
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
  // The This PC section head is the This PC page's sidebar entry (Stage 2D §8).
  const thisPcHead = document.querySelector('#sb-thispc .fp-sidebar__section-head');
  if (thisPcHead) {
    thisPcHead.classList.remove('fp-sidebar__section-head--active');
    thisPcHead.removeAttribute('aria-current');
  }
  if (pathOrScreen === THISPC) {
    if (thisPcHead) {
      thisPcHead.classList.add('fp-sidebar__section-head--active');
      thisPcHead.setAttribute('aria-current', 'page');
    }
    return;
  }

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

  // A real filesystem path (THISPC — the This PC page — matches no
  // data-path, so nothing is highlighted) — match the longest data-path prefix.
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
// Every width and threshold here is SCREEN px (Stage 2D §5): the panel's CSS
// width is --sidebar-w-screen / --app-zoom, so it keeps its size on screen at
// any app zoom, and the pointer's CSS x is multiplied by the zoom before it
// is compared. ui.sidebar_w (config) holds the expanded width; the
// fp-sidebar-width localStorage copy only lets the first paint use it before
// config has loaded.
const SIDEBAR_WIDTH_MAX        = 480; // px; absolute maximum draggable width
const SIDEBAR_WIDTH_MIN        = 180; // px; minimum expanded width (lock position)
const SIDEBAR_COLLAPSE_TRIGGER = 100; // px; cursor X — going IN past this collapses, going OUT past this expands
const SIDEBAR_EXPANDED_DEFAULT = 240;
const SIDEBAR_COLLAPSED_WIDTH  = 52;

function setSidebarWidthVar(px) {
  document.documentElement.style.setProperty('--sidebar-w-screen', px + 'px');
}

/** The saved expanded width (screen px), or the default when none is valid. */
function savedSidebarWidth() {
  const cfg = window.__fpConfig || {};
  const fromCfg = Number(cfg['ui.sidebar_w']);
  const saved = Number.isFinite(fromCfg) && fromCfg > 0 ? fromCfg : parseInt(localStorage.getItem('fp-sidebar-width'), 10);
  return (saved && saved >= SIDEBAR_WIDTH_MIN && saved <= SIDEBAR_WIDTH_MAX) ? saved : SIDEBAR_EXPANDED_DEFAULT;
}

function setSidebarCollapsed(collapsed) {
  if (!shell || !sidebar) return;
  if (collapsed) {
    shell.classList.add('sidebar-collapsed');
    sidebar.classList.add('fp-sidebar--collapsed');
    setSidebarWidthVar(SIDEBAR_COLLAPSED_WIDTH);
  } else {
    shell.classList.remove('sidebar-collapsed');
    sidebar.classList.remove('fp-sidebar--collapsed');
    setSidebarWidthVar(savedSidebarWidth());
  }
  localStorage.setItem('fp-sidebar-collapsed', collapsed ? 'on' : 'off');
  // The rail's This PC square has no visible label, so it gets a tooltip;
  // the expanded header shows "This PC" itself and needs none.
  const thisPcHead = document.querySelector('#sb-thispc .fp-sidebar__section-head');
  if (thisPcHead) {
    if (collapsed) thisPcHead.title = 'This PC';
    else thisPcHead.removeAttribute('title');
  }
  // Rail icons are bigger (Stage 2D §9.2): shell bitmaps re-resolve at the
  // size they are now drawn at instead of being stretched.
  if (typeof fpInvalidateLazyIcons === 'function') fpInvalidateLazyIcons(sidebar);
}

/** The px a sidebar row's icon is drawn at — --sidebar-icon, or the rail's
 * --sidebar-rail-icon while collapsed (styles.css is the one source). */
function sidebarIconPx() {
  const collapsed = !!sidebar && sidebar.classList.contains('fp-sidebar--collapsed');
  const v = getComputedStyle(document.documentElement).getPropertyValue(collapsed ? '--sidebar-rail-icon' : '--sidebar-icon');
  return parseInt(v, 10) || (collapsed ? 22 : 18);
}

function toggleSidebar() {
  const isCollapsed = sidebar && sidebar.classList.contains('fp-sidebar--collapsed');
  setSidebarCollapsed(!isCollapsed);
}

function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  if (!handle || !sidebar) return;

  let dragging = false;

  // Hover intent (Task 14 Q21): the line shows once the pointer has rested
  // on the handle for --timer-resize-intent — a class on a timer, not a
  // transition delay, so it holds the same with animations off.
  let intentTimer = 0;
  const clearIntent = () => {
    clearTimeout(intentTimer);
    intentTimer = 0;
    handle.classList.remove('fp-sidebar__resize-handle--intent');
  };
  const armIntent = () => {
    clearTimeout(intentTimer);
    intentTimer = setTimeout(() => {
      intentTimer = 0;
      handle.classList.add('fp-sidebar__resize-handle--intent');
    }, fpMotionMs('--timer-resize-intent'));
  };
  handle.addEventListener('pointerenter', armIntent);
  handle.addEventListener('pointerleave', () => { if (!dragging) clearIntent(); });

  handle.addEventListener('pointerdown', e => {
    dragging = true;
    clearIntent();
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
    const cursorX = e.clientX * appZoom.current;          // screen px
    const isCollapsed = sidebar.classList.contains('fp-sidebar--collapsed');

    if (isCollapsed) {
      if (cursorX >= SIDEBAR_COLLAPSE_TRIGGER) {
        // Cursor crossed back over the trigger — snap to expanded at MIN
        setSidebarCollapsed(false);
        setSidebarWidthVar(SIDEBAR_WIDTH_MIN);
      }
      // else: stay collapsed, no visual change
    } else {
      if (cursorX < SIDEBAR_COLLAPSE_TRIGGER) {
        // Crossed below trigger while expanded — snap to collapsed
        setSidebarCollapsed(true);
      } else if (cursorX <= SIDEBAR_WIDTH_MIN) {
        // Dead zone — lock at MIN regardless of cursor position
        setSidebarWidthVar(SIDEBAR_WIDTH_MIN);
      } else {
        // Cursor past MIN — width follows cursor 1:1, capped at MAX
        setSidebarWidthVar(Math.min(SIDEBAR_WIDTH_MAX, cursorX));
      }
    }
  });

  handle.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('fp-sidebar__resize-handle--active');
    sidebar.classList.remove('fp-sidebar--dragging');
    shell.classList.remove('sidebar-dragging');
    if (handle.matches(':hover')) armIntent();
    // Persist final width if expanded (screen px; one write per drag)
    if (!sidebar.classList.contains('fp-sidebar--collapsed')) {
      const finalWidth = sidebar.getBoundingClientRect().width * appZoom.current;
      const w = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(finalWidth)));
      localStorage.setItem('fp-sidebar-width', String(w));
      setSidebarWidthVar(w);
      if (typeof saveSetting === 'function') saveSetting('ui.sidebar_w', w);
    }
    handle.releasePointerCapture(e.pointerId);
  });
}

/** First paint: collapsed state + the localStorage copy of the width.
 * applySidebarWidthFromConfig re-applies ui.sidebar_w once config loads. */
function restoreSidebarState() {
  if (localStorage.getItem('fp-sidebar-collapsed') === 'on') setSidebarCollapsed(true);
  else setSidebarWidthVar(savedSidebarWidth());
}

function applySidebarWidthFromConfig() {
  const w = Number((window.__fpConfig || {})['ui.sidebar_w']);
  if (!Number.isFinite(w) || w < SIDEBAR_WIDTH_MIN || w > SIDEBAR_WIDTH_MAX) return;
  localStorage.setItem('fp-sidebar-width', String(w));
  if (sidebar && !sidebar.classList.contains('fp-sidebar--collapsed')) setSidebarWidthVar(w);
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

  // The name as it stood when this edit began: Escape restores THIS, not the
  // name from app start, which threw away a rename made earlier in the
  // session (pass 2 #59).
  let before = el.textContent;
  el.addEventListener('dblclick', () => {
    before = el.textContent;
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
    if (e.key === 'Escape') { e.preventDefault(); el.textContent = before; el.blur(); }
  });
}

// ── Toolbar layout (Stage 2D §6.2) ─────────────────────────────────
// The path and the search bar share the bar. The path starts at the left
// (right after the nav group) and grows rightward. As the bar narrows, or
// the path grows, the order is fixed:
//   1. the search bar shrinks from its preferred width (280, or wider while
//      chips and text need it, up to 60% of the free space) to its 180 min;
//   2. it collapses fully to the 28px magnifier;
//   3. only then does the path overflow: #breadcrumb-wrap.is-overflowing
//      right-anchors it under the leading fade, current folder in view.
// Every decision uses the path's MEASURED natural width against the free
// space — never a fixed constant — so a short path keeps a full search bar
// on a narrow window and a deep one collapses it on a wide window. Nothing
// measured depends on the mode it decides (the two flexible children are
// excluded from `fixed`, the gap never changes), so it cannot oscillate; the
// 24px hysteresis keeps a window drag across the threshold from flickering.
// Runs from a ResizeObserver (toolbar and path), a MutationObserver on the
// crumbs, updateBreadcrumb(), every zoom change, font loads and search
// content changes — never per frame.
const TOOLBAR_SEARCH_PREFERRED = 280;
const TOOLBAR_SEARCH_MIN       = 180;
const TOOLBAR_SEARCH_COLLAPSED = 28;
const TOOLBAR_SEARCH_GROW_MAX  = 0.6;   // share of the free space content may grow the bar to
const TOOLBAR_HYSTERESIS       = 24;
const TOOLBAR_FADE             = 24;    // the path's leading fade (styles.css .is-overflowing)

/** The width the search bar's content wants: its chrome, the chips and the
 * typed text (or the placeholder). Measured off the hidden ruler span, so it
 * never depends on the width the bar currently has. */
function searchContentWidth() {
  const wrap = document.getElementById('search-wrap');
  const input = document.getElementById('search-input');
  const ruler = document.getElementById('search-measure');
  const chips = document.getElementById('search-chips');
  if (!wrap || !input || !ruler) return 0;
  const cs = getComputedStyle(wrap);
  const px = (v) => parseFloat(v) || 0;
  const gap = px(cs.columnGap);
  ruler.textContent = input.value || input.placeholder || '';
  const text = Math.ceil(ruler.getBoundingClientRect().width) + 4;   // + caret
  const chipsW = chips && chips.childElementCount ? chips.scrollWidth + gap : 0;
  const icon = wrap.querySelector('.fp-search__icon');
  const iconW = icon ? icon.getBoundingClientRect().width || 14 : 14;
  const clear = wrap.classList.contains('fp-search--has-content')
    ? (document.getElementById('search-clear-inline')?.offsetWidth || 20) + gap : 0;
  return px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth)
    + iconW + gap + chipsW + text + clear;
}

let _layoutToolbarDepth = 0;
function layoutToolbar() {
  const toolbar = document.getElementById('toolbar');
  const wrap = document.getElementById('breadcrumb-wrap');
  const crumbs = document.getElementById('breadcrumb');
  const slot = document.getElementById('search-slot');
  if (!toolbar || !wrap || !crumbs || !slot) return;
  const width = toolbar.getBoundingClientRect().width;
  if (!width) return;                     // not laid out (hidden window)

  const style = getComputedStyle(toolbar);
  const gap = parseFloat(style.columnGap) || 0;
  let fixed = 0;
  let visible = 0;
  for (const child of toolbar.children) {
    if (child === wrap || child === slot) { visible++; continue; }
    const w = child.getBoundingClientRect().width;
    if (!w) continue;
    visible++;
    fixed += w;
  }
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  // The room the path and the search slot share.
  const free = width - padding - fixed - gap * Math.max(0, visible - 1);
  // The path's natural width — with back whatever an ellipsized current
  // crumb (.is-tight below) is hiding, so that cap never feeds back here.
  const current = crumbs.querySelector('.fp-breadcrumb__crumb--current');
  // A crumb with no label span (none is built that way today) is measured
  // itself, so a capped crumb can never read as "fits" and flip back.
  const label = current ? (current.querySelector('.fp-breadcrumb__label') || current) : null;
  const hidden = label ? Math.max(0, label.scrollWidth - label.clientWidth) : 0;
  const crumbNatural = Math.max(crumbs.scrollWidth, crumbs.getBoundingClientRect().width) + hidden;

  const room = free - crumbNatural;       // what the search may take beside the whole path
  const wasCollapsed = toolbar.dataset.search === 'collapsed';
  const collapsed = room < TOOLBAR_SEARCH_MIN + (wasCollapsed ? TOOLBAR_HYSTERESIS : 0);
  const preferred = Math.max(TOOLBAR_SEARCH_PREFERRED,
    Math.min(Math.ceil(searchContentWidth()), Math.floor(free * TOOLBAR_SEARCH_GROW_MAX)));
  const slotW = collapsed ? TOOLBAR_SEARCH_COLLAPSED : Math.floor(Math.min(preferred, room));

  if (collapsed && !wasCollapsed) {
    // A bar that is in use when the toolbar collapses stays open as the
    // overlay rather than vanishing from under the caret (search.js).
    const sw = document.getElementById('search-wrap');
    const inUse = (sw && sw.contains(document.activeElement))
      || (typeof searchState !== 'undefined' && (searchState.text.trim() || searchState.chips.length));
    if (inUse && typeof expandSearchBar === 'function') expandSearchBar();
  }
  toolbar.dataset.search = collapsed ? 'collapsed' : 'full';
  if (!collapsed) slot.style.setProperty('--search-slot-w', `${slotW}px`);
  // The overlay grows leftward from the slot up to the path's left edge.
  const overlayW = Math.floor(Math.min(preferred, free - gap));
  slot.style.setProperty('--search-overlay-w', `${Math.max(TOOLBAR_SEARCH_COLLAPSED, overlayW)}px`);
  // The path overflows only when it does not fit beside what the slot takes.
  const overflowing = crumbNatural > free - slotW + 0.5;
  wrap.classList.toggle('is-overflowing', overflowing);
  // A separator under the fade has lost the crumb before it: alone at the
  // path's left edge it read as a stray "·" (Task 14 Q12).
  const wrapLeft = wrap.getBoundingClientRect().left;
  crumbs.querySelectorAll('.fp-breadcrumb__sep').forEach((sep) => {
    sep.classList.toggle('is-orphan', overflowing && sep.getBoundingClientRect().left < wrapLeft + TOOLBAR_FADE);
  });
  // The current folder is never under the fade: when the wrap cannot hold it
  // plus the 24px fade, the fade goes and the crumb ellipsizes to the wrap.
  const wrapW = Math.max(0, Math.floor(free - slotW));
  const currentW = current ? current.getBoundingClientRect().width + hidden : 0;
  const tight = overflowing && currentW + TOOLBAR_FADE > wrapW;
  wrap.classList.toggle('is-tight', tight);
  wrap.style.setProperty('--crumb-current-max', `${wrapW}px`);
  if (current) {
    if (tight) current.title = label ? label.textContent : current.textContent;
    else current.removeAttribute('title');
  }
  // The Filters/History dropdown hangs leftward from the bar's right edge;
  // on a narrow bar it must not run past the toolbar's left edge, where the
  // main column clips it (styles.css .fp-search-dd).
  const ddRoom = slot.getBoundingClientRect().right - toolbar.getBoundingClientRect().left - 4;
  slot.style.setProperty('--search-dd-room', `${Math.max(0, Math.floor(ddRoom))}px`);
  // …and it hangs no lower than the status bar: styles.css caps its height at
  // the room from here to there (Task 14 Q13).
  slot.style.setProperty('--search-dd-top', `${Math.ceil(slot.getBoundingClientRect().bottom)}px`);
  // A flip changes what is measurable (chips are display:none while folded):
  // one more pass settles it.
  if (collapsed !== wasCollapsed && _layoutToolbarDepth === 0) {
    _layoutToolbarDepth++;
    try { layoutToolbar(); } finally { _layoutToolbarDepth--; }
  }
}

function initToolbarLayout() {
  const toolbar = document.getElementById('toolbar');
  const crumbs = document.getElementById('breadcrumb');
  if (!toolbar || !crumbs) return;
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => layoutToolbar());
    ro.observe(toolbar);
    ro.observe(crumbs);                   // the path's natural width (crumbs, font, zoom)
  }
  // Crumb changes from anywhere (updateBreadcrumb, the search header, Home):
  // re-laid out before the next paint.
  new MutationObserver(() => layoutToolbar())
    .observe(crumbs, { childList: true, subtree: true, characterData: true });
  if (document.fonts) {
    document.fonts.ready.then(() => layoutToolbar());
    document.fonts.addEventListener?.('loadingdone', () => layoutToolbar());
  }
  layoutToolbar();
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
  const edge = menuEdgePx();
  // Never over the status bar (Task 14 Q12): the popout fits between the
  // title bar and the status bar, and scrolls inside itself when even that
  // is too short (a 500 px window at 150 %).
  const status = document.querySelector('.fp-statusbar, #statusbar');
  const bottom = (status ? status.getBoundingClientRect().top : vh) - edge;
  const top = Math.max(edge, document.querySelector('.fp-titlebar')?.getBoundingClientRect().bottom || edge);
  popout.style.maxHeight = `${Math.max(0, bottom - top)}px`;
  popout.style.left = `${Math.min(r.left, vw - popout.offsetWidth - edge)}px`;
  popout.style.top  = `${Math.max(top, Math.min(r.bottom + 6, bottom - popout.offsetHeight))}px`;
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
  if (typeof syncAccentField === 'function') syncAccentField();
}

// ── App zoom (Stage 2D §5, decision D2D-1) ─────────────────────────────────
// The zoom is Electron's page zoom (webContents.setZoomFactor: it scales the
// whole viewport and Electron persists it across restarts). The renderer
// publishes the factor in effect as --app-zoom on :root; the sidebar, the
// collapsed rail and the inspector size themselves as screen px divided by
// it, so they keep their width on screen while the text and icons inside
// them grow (styles.css, --sidebar-w-screen / --inspector-w-screen).
//
// The step list is main.js's ZOOM_STEPS (read once over IPC). A step eases
// in through electronAPI.zoomTo (preload.js) — unless animations are off
// (fpMotionOn), or one of the first two eased steps of the session had a frame over
// ZOOM_EASE_FRAME_LIMIT_MS (spec §5 fallback ruling), after which every step
// is instant. window.__fpZoomEase says which mode is in effect and
// window.__fpZoomFrames keeps the measured frame times.
//
// --app-zoom follows the zoom the page has actually APPLIED: it is set in a
// capture-phase `resize` listener, which runs in the frame the new zoom first
// lays out in, before any layout of it — so no frame shows a panel at the
// old width. A zoom change always changes devicePixelRatio, so a resize that
// leaves it alone (the user dragging the window edge) costs nothing; a
// matchMedia(resolution) watcher catches a monitor-DPI move that fires no
// resize. Mid-ease the factor comes from devicePixelRatio over the display
// scale (renderer-local truth, re-read before every step); asking the main
// process then could answer with a step the page has not drawn yet.
const ZOOM_DEFAULT = 1.0;
const ZOOM_EASE_FRAME_LIMIT_MS = 32;
const ZOOM_PILL_FADE_MS = 1200;
const appZoom = {
  current: 1, target: null, busy: 0, scale: null, dpr: null, steps: null,
  measured: [], dropped: false, pillTimer: 0, pillHideTimer: 0, settleRaf: 0,
};
window.__fpZoomFrames = [];
window.__fpZoomBusy = false;

function zoomSteps() {
  if (!appZoom.steps) {
    const steps = window.electronAPI?.zoomSteps?.();
    appZoom.steps = Array.isArray(steps) && steps.length ? steps : [ZOOM_DEFAULT];
  }
  return appZoom.steps;
}

/** The zoom factor the main process holds (the target of a running ease). */
function getCurrentZoom() {
  return Number(window.electronAPI?.getZoom?.()) || ZOOM_DEFAULT;
}

/** The 32 ms fallback test for one eased step's rAF-to-rAF frame times. The
 * session's first eased step skips its first two frames: its first factor
 * goes out in the first frame and is drawn in the next, and the first frame
 * a page ever draws at a new zoom can take 100+ ms while the GPU warms up
 * (measured: 108–129 ms on a fresh profile, never again after) — that one
 * frame must not switch the whole session to instant steps. */
function zoomFramesTooSlow(frames, firstOfSession) {
  return frames.slice(firstOfSession ? 2 : 0).some((ms) => ms > ZOOM_EASE_FRAME_LIMIT_MS);
}

function zoomEaseMode() {
  return (appZoom.dropped || !fpMotionOn()) ? 'instant' : 'eased';
}

/** Publishes the applied zoom as --app-zoom. Panel width transitions are
 * held off for the frame so the panels never animate toward their new CSS
 * width (that is exactly the "closing in" the owner disliked). */
function syncAppZoom(force = false) {
  const dpr = window.devicePixelRatio || 1;
  const root = document.documentElement;
  const first = !root.style.getPropertyValue('--app-zoom');
  if (!force && !first && dpr === appZoom.dpr) return;   // a plain window resize
  appZoom.dpr = dpr;
  let z;
  if (appZoom.busy && appZoom.scale) {
    z = Math.round((dpr / appZoom.scale) * 1e6) / 1e6;
  } else {
    z = getCurrentZoom();
    if (force && appZoom.scale && Math.abs(dpr / appZoom.scale - z) > 0.001) {
      // The step's reply beat its first frame: the page still draws the old
      // zoom. Publishing now would size the panels for a zoom not drawn yet;
      // the resize that comes with it publishes instead.
      appZoom.dpr = null;
      return;
    }
    appZoom.scale = dpr / z;
  }
  const moved = first || Math.abs(z - appZoom.current) >= 0.00005;
  // Always keep the exact factor, even when only float noise moved (the
  // mid-ease devicePixelRatio estimate vs the settled IPC value): the wheel
  // code multiplies by it, and 0.99999994 × 100 is one notch short of a step.
  appZoom.current = z;
  if (root.style.getPropertyValue('--app-zoom') === String(z)) return;
  root.classList.add('fp-zoom-changing');
  root.style.setProperty('--app-zoom', String(z));
  // The toolbar's collapse order re-runs at the new zoom in this same frame
  // (the panels just changed the toolbar's CSS width) — Stage 2D §5/§6.2.
  layoutToolbar();
  cancelAnimationFrame(appZoom.settleRaf);
  appZoom.settleRaf = requestAnimationFrame(() => {
    appZoom.settleRaf = requestAnimationFrame(() => root.classList.remove('fp-zoom-changing'));
  });
  // Startup at 100% is not a change: no pill. Startup zoomed shows it once.
  if (moved && !appZoom.busy && !(first && Math.abs(z - ZOOM_DEFAULT) < 0.005)) updateZoomPill(z);
}
window.addEventListener('resize', () => syncAppZoom(), true);
// Re-armed against the new ratio after every change (matchMedia's `change`
// fires once per crossing) — same pattern as icons.js's _fpWatchDpr.
function watchAppZoomDpr() {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  mq.addEventListener('change', () => { syncAppZoom(); watchAppZoomDpr(); }, { once: true });
}
syncAppZoom();
watchAppZoomDpr();
window.__fpZoomEase = zoomEaseMode();

// Status-bar zoom pill (spec §5): shows the percentage on every change and
// fades 1.2 s after the last one. Away from 100% the faded pill keeps its
// place and comes back on hover / focus, so it stays the click-to-reset
// target; at 100% it leaves the status bar once faded.
function updateZoomPill(z = appZoom.target ?? appZoom.current) {
  const pill = document.getElementById('status-zoom-pill');
  const sep  = document.getElementById('status-zoom-sep');
  if (!pill) return;
  pill.textContent = Math.round(z * 100) + '%';
  // Treat 99.5–100.5% as "100%" to absorb floating-point drift.
  const atDefault = Math.abs(z - ZOOM_DEFAULT) < 0.005;
  for (const el of [pill, sep]) {
    if (!el) continue;
    el.style.display = '';
    el.classList.remove('is-faded');
  }
  clearTimeout(appZoom.pillTimer);
  clearTimeout(appZoom.pillHideTimer);
  appZoom.pillTimer = setTimeout(() => {
    pill.classList.add('is-faded');
    sep?.classList.add('is-faded');
    if (atDefault) {
      const fadeMs = parseFloat(getComputedStyle(pill).transitionDuration) * 1000 || 0;
      appZoom.pillHideTimer = setTimeout(() => {
        pill.style.display = 'none';
        if (sep) sep.style.display = 'none';
      }, fadeMs + 50);
    }
  }, ZOOM_PILL_FADE_MS);
}

/** Zooms the app to `target` (clamped to the step list): eased or instant
 * per zoomEaseMode(). Key repeats step on from the running step's target,
 * so a burst of presses lands exactly that many steps on. */
async function setAppZoom(target) {
  const api = window.electronAPI;
  if (!api?.zoomTo) return;
  const steps = zoomSteps();
  const t = Math.min(steps[steps.length - 1], Math.max(steps[0], Number(target) || ZOOM_DEFAULT));
  appZoom.target = t;
  updateZoomPill(t);
  const ease = zoomEaseMode() === 'eased';
  // The display scale is re-read before every step that starts from rest
  // (the window may have moved to a monitor with another DPI since): the
  // mid-ease --app-zoom is devicePixelRatio over it.
  if (!appZoom.busy) appZoom.scale = (window.devicePixelRatio || 1) / getCurrentZoom();
  appZoom.busy += 1;
  window.__fpZoomBusy = true;
  let r = null;
  try {
    r = await api.zoomTo(t, ease ? fpMotionMs('--motion-zoom') : 0);
  } catch (_e) {
    r = null;
  } finally {
    appZoom.busy -= 1;
  }
  if (ease && r && !r.superseded && r.frames && r.frames.length && appZoom.measured.length < 2) {
    const firstOfSession = appZoom.measured.length === 0;
    appZoom.measured.push(r.frames);
    window.__fpZoomFrames = appZoom.measured.map((f) => f.slice());
    if (zoomFramesTooSlow(r.frames, firstOfSession)) appZoom.dropped = true;
  }
  window.__fpZoomEase = zoomEaseMode();
  if (!appZoom.busy) {
    appZoom.target = null;
    syncAppZoom(true);       // exact final factor (and the pill) from the main process
    window.__fpZoomBusy = false;
  }
}

function zoomStep(dir) {
  const steps = zoomSteps();
  const cur = appZoom.target ?? appZoom.current;
  const next = dir > 0
    ? (steps.find((s) => s > cur + 0.001) ?? steps[steps.length - 1])
    : ([...steps].reverse().find((s) => s < cur - 0.001) ?? steps[0]);
  setAppZoom(next);
}
function zoomIn()  { zoomStep(1); }
function zoomOut() { zoomStep(-1); }
function zoomReset() { setAppZoom(ZOOM_DEFAULT); }

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
/** Paste: only when the clipboard actually holds something — and only when
 * the directory it would paste into is the one on screen (see
 * cmTargetDirVisible). */
function cmClipboardEnabled(ctx) { return (ctx.clipboard || 0) > 0 && cmTargetDirVisible(); }
/** True when contextTargetDir() resolves to a directory the user can actually
 * see. The folder menu names its own right-clicked folder, so it always can;
 * every other menu type falls back to browserState.path, which in search mode
 * is the pre-search folder hidden behind a result set — creating or pasting
 * there mutated an off-screen directory and showed nothing for it (pass 2
 * #51). New folder / New file / Paste are disabled instead. */
function cmTargetDirVisible() {
  return browserState.mode !== 'search' || contextMenuType === 'folder';
}
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
    // Single selection only: the item just focuses the Inspector's tag input,
    // and the Inspector only ever tags ONE file — the one it is showing. From
    // a multi-selection it used to tag whichever file was inspected last
    // (pass 2 #199). A real batch-tag path is backlog, not a silent lie.
    { label: 'Add tag…',         action: 'cm-add-tag',     icon: icon('tag', 'fp-icon--14'), enabled: cmSingleEnabled },
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
    { label: 'New folder', action: 'cm-new-folder', icon: icon('folder-add', 'fp-icon--14'), enabled: cmTargetDirVisible },
    { label: 'New file',   action: 'cm-new-file',  enabled: cmTargetDirVisible },
    { label: 'Paste',      action: 'cm-paste',      kbd: 'Ctrl+V', enabled: cmClipboardEnabled },
    { label: 'Refresh',    action: 'cm-refresh',    kbd: 'F5' },
    'sep',
    // The same eight views as the toolbar's View menu, as a flyout (§3.1).
    // Written out (not viewMenuItems()) so check_menu_cases.js can see every
    // cm-* action in this block.
    { label: 'View', items: [
      { label: 'Extra large icons', action: 'cm-view-xl',      checked: () => viewMenuKey() === 'xl' },
      { label: 'Large icons',       action: 'cm-view-large',   checked: () => viewMenuKey() === 'large' },
      { label: 'Medium icons',      action: 'cm-view-medium',  checked: () => viewMenuKey() === 'medium' },
      { label: 'Small icons',       action: 'cm-view-small',   checked: () => viewMenuKey() === 'small' },
      { label: 'List',              action: 'cm-view-list',    checked: () => viewMenuKey() === 'list' },
      { label: 'Details',           action: 'cm-view-details', checked: () => viewMenuKey() === 'details' },
      { label: 'Tiles',             action: 'cm-view-tiles',   checked: () => viewMenuKey() === 'tiles' },
      { label: 'Content',           action: 'cm-view-content', checked: () => viewMenuKey() === 'content' },
    ] },
    { label: 'Sort by → name',    action: 'cm-sort-name' },
    { label: 'Sort by → modified', action: 'cm-sort-modified' },
    'sep',
    { label: ctx => browserState.showHidden ? 'Hide hidden files' : 'Show hidden files', action: 'cm-toggle-hidden' },
    { label: 'Properties',        action: 'cm-properties' },
  ],

  // Stage 2D §8 — a drive (This PC card or sidebar drive row).
  drive: [
    { label: 'Open',            action: 'cm-drive-open', icon: icon('open', 'fp-icon--14') },
    { label: 'Open in new tab', action: 'cm-drive-open-tab' },
    'sep',
    { label: 'Properties',      action: 'cm-drive-properties' },
  ],

  // Stage 2D §8 — the open space of the This PC page: nothing to create or
  // paste into (it is not a folder), its two layouts, and Refresh.
  thispc: [
    { label: 'Refresh', action: 'cm-refresh', kbd: 'F5' },
    'sep',
    { label: 'View', items: [
      { label: 'Tiles',   action: 'cm-thispc-view-tiles',   checked: () => thisPcLayout() === 'tiles' },
      { label: 'Details', action: 'cm-thispc-view-details', checked: () => thisPcLayout() === 'details' },
    ] },
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
/** The eight views, top to bottom as Explorer lists them (Stage 2D §3.1).
 * The check sits on the item viewMenuKey() (browser.js) names: the view
 * itself, or for icons the nearest named size — so every Ctrl+wheel step
 * checks exactly one item (pass 2 #202). Built twice: the toolbar View menu
 * (view-*) and the empty-area menu's View flyout (cm-view-*). */
function viewMenuItems(prefix) {
  return [
    ['Extra large icons', 'xl'], ['Large icons', 'large'], ['Medium icons', 'medium'], ['Small icons', 'small'],
    ['List', 'list'], ['Details', 'details'], ['Tiles', 'tiles'], ['Content', 'content'],
  ].map(([label, key]) => ({ label, action: `${prefix}${key}`, checked: () => viewMenuKey() === key }));
}

const VIEW_MENU_ITEMS = [
  ...viewMenuItems('view-'),
  'sep',
  { label: 'Show hidden files',    action: 'toggle-show-hidden',     checked: ctx => ctx.showHidden },
  { label: 'Show file extensions', action: 'toggle-show-extensions', checked: ctx => ctx.showExtensions },
  { label: 'Dynamic media view',   action: 'toggle-dynamic-media',   checked: ctx => ctx.dynamicMediaView },
];

const SORT_MENU_ITEMS = [
  { label: 'Name',          action: 'sort-name',     checked: ctx => ctx.sortKey === 'name' },
  { label: 'Date…', checked: ctx => ['created', 'modified', 'accessed'].includes(ctx.sortKey), items: [
    { label: 'Date created',  action: 'sort-created',  checked: ctx => ctx.sortKey === 'created' },
    { label: 'Date modified', action: 'sort-modified', checked: ctx => ctx.sortKey === 'modified' },
    { label: 'Date accessed', action: 'sort-accessed', checked: ctx => ctx.sortKey === 'accessed' },
  ] },
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
    iconSize: browserState.iconSize,
    showHidden: browserState.showHidden,
    showExtensions: browserState.showExtensions,
    dynamicMediaView: cfg['ui.dynamic_media_view'] !== false,
    sortKey: browserState.sort.key,
    sortDir: browserState.sort.dir,
  };
}

function getMenuTypeForTarget(target) {
  if (target.closest('.fp-tab')) return 'tab';
  // A drive — a This PC card or a sidebar drive row — has its own menu
  // (Stage 2D §8); the open space of the This PC page has another.
  if (target.closest('.fp-drive-card[data-path], #sb-drives .fp-sidebar__item[data-path]')) return 'drive';
  if (target.closest('#thispc-view')) return 'thispc';
  // User pins (data-pin-id) and Quick Access known folders (data-known-id)
  // both get the sidebar-item menu — Home and drives are neither and fall
  // through to the empty-area menu instead.
  if (target.closest('.fp-sidebar__item[data-pin-id], .fp-sidebar__item[data-known-id]')) return 'sidebar-item';
  // Home's Recent/Favorites rows get their own menu — checked before the
  // generic folder/file checks below so a Home row never falls into those.
  if (target.closest('.fp-row--recent')) return 'home-row';
  if (target.closest('.fp-row[data-type="folder"]')) return 'folder';
  if (target.closest('.fp-row')) return 'file';
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
    if (row) selection = [{ path: row.dataset.path, ext: row.dataset.ext || '', is_dir: homeRowIsDir(row) }];
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
  closeContextFlyouts(0);
  clearTimeout(cmTimer);
  cmPrevFocus = document.activeElement;
  cmKbdPointer = null;
  contextMenu.innerHTML = '';
  buildContextMenuItems(cmMakeScroller(contextMenu), items, opts.ctx, 0);
  contextMenu.style.display = 'block';
  // Position within the viewport using the MEASURED size (pass 2 #61: the old
  // hardcoded 200px/220px let a wide menu spill off the right edge), and never
  // past the top or left edge either.
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = contextMenu.offsetWidth, h = contextMenu.offsetHeight;
  let left, top;
  if (opts.anchor) {
    const r = opts.anchor.getBoundingClientRect();
    left = r.left;
    top = r.bottom + 4;
  } else {
    left = x;
    top = y;
  }
  const edge = menuEdgePx();
  contextMenu.style.left = `${Math.max(0, Math.min(left, vw - w - edge))}px`;
  contextMenu.style.top  = `${Math.max(0, Math.min(top, vh - h - edge))}px`;
  cmSyncScrollCue(cmScroller(contextMenu));
  armContextMenuScrollClose();
}

/** --menu-edge: the gap a menu or popover keeps from the window edge (CSS
 * token, read once; the menus' max-height uses the same one). */
let _menuEdgePx = null;
function menuEdgePx() {
  if (_menuEdgePx === null) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-edge'));
    _menuEdgePx = Number.isFinite(v) ? v : 8;
  }
  return _menuEdgePx;
}

/** Items live in an inner scroller, so a menu too tall for the window
 * scrolls inside its own border and shadow (pass 2 #61), and the scroll-cue
 * fade masks only the items, never the menu's frame. */
function cmMakeScroller(menu) {
  const scroller = document.createElement('div');
  scroller.className = 'fp-context-menu__scroll fp-oscroll-host--fade';
  scroller.setAttribute('role', 'none');
  menu.appendChild(scroller);
  return scroller;
}
function cmScroller(menu) {
  return menu.querySelector(':scope > .fp-context-menu__scroll') || menu;
}
function cmSyncScrollCue(scroller) {
  const over = scroller.scrollHeight > scroller.clientHeight + 1;
  scroller.classList.toggle('is-scroll-top', over && scroller.scrollTop > 1);
  scroller.classList.toggle('is-scroll-bottom', over && scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1);
}

// ── Menus and popovers never float at stale coordinates (pass 2 #175) ──────
// The context menu, the View / Sort dropdowns (the same element) and the Ask
// File+ popout are position:fixed, placed once from viewport coordinates. A
// window resize (app zoom included) closes them, and so does any scroll of
// what is under them (the list, the sidebar, a pane) — Windows' rule for
// menus. A scroll inside the menu itself never closes it. The scroll close
// is armed two frames after the menu opens, so the scroll-into-view that
// right-clicking a half-hidden row can cause does not close the menu it just
// opened.
let cmScrollArmed = false;
let cmScrollArmRaf = 0;
function armContextMenuScrollClose() {
  cmScrollArmed = false;
  cancelAnimationFrame(cmScrollArmRaf);
  cmScrollArmRaf = requestAnimationFrame(() => {
    cmScrollArmRaf = requestAnimationFrame(() => { cmScrollArmed = true; });
  });
}
/** Closes the menu for a resize / scroll. When the keyboard was inside it,
 * focus goes back where it was before the menu opened (as after an
 * activation) instead of dropping to <body>. */
function closeContextMenuForLayout() {
  if (document.activeElement?.closest?.('.fp-context-menu')) closeContextMenuAfterActivation();
  else hideContextMenu();
}
window.addEventListener('resize', () => {
  if (contextMenuIsOpen()) closeContextMenuForLayout();
  if (askPopoutOpen()) closeAskPopout();
});
document.addEventListener('scroll', e => {
  const t = e.target;
  if (t instanceof Element && t.classList.contains('fp-context-menu__scroll')) { cmSyncScrollCue(t); return; }
  if (t instanceof Element && t.closest('.fp-context-menu')) return;
  if (cmScrollArmed && contextMenuIsOpen()) closeContextMenuForLayout();
}, true);

// ── Flyout submenus (Stage 2D §6.3) ────────────────────────────────────────
// An item with `items: [...]` renders a trailing chevron and opens a child
// menu (.fp-context-menu--flyout) built by the same builder. One flyout per
// level: cmFlyouts[d] is the flyout opened from a row of menu level d (0 is
// #context-menu itself), so the deepest open menu is the last one.
const CM_FLYOUT_OPEN_DELAY = 250;    // hover this long on a parent row to open
const CM_FLYOUT_CLOSE_GRACE = 300;   // sibling hover shorter than this keeps it open
let cmFlyouts = [];                  // [{ menu, owner }]
let cmTimer = null;                  // the one pending hover open/close
let cmPrevFocus = null;              // focus to give back when the menu closes by keyboard / activation
// Hover is ignored while the keyboard drives the menu: set to the pointer's
// position when a menu key is handled, cleared by the first pointerenter that
// arrives at a DIFFERENT position (a layout shift under a stationary pointer
// fires pointerenter with the same coordinates and must not close a flyout the
// user opened with the arrow keys).
let cmKbdPointer = null;
// null until the pointer has been seen: a keyboard-opened menu then learns
// where the (stationary) pointer is from the first pointerenter instead of
// treating it as movement — an invented -1,-1 made that first layout-shift
// pointerenter close the flyout the keys had just opened (§12 sweep).
let cmLastPointer = null;

function cmOpenMenus() { return [contextMenu, ...cmFlyouts.map(f => f.menu)]; }

function cmFocusableItems(menu) {
  return [...cmScroller(menu).children].filter(el =>
    el.classList.contains('fp-context-menu__item') && !el.classList.contains('fp-context-menu__item--disabled'));
}

/** Closes every flyout opened from level `depth` or deeper. */
function closeContextFlyouts(depth) {
  for (let i = cmFlyouts.length - 1; i >= depth; i--) {
    const { menu, owner } = cmFlyouts[i];
    menu.remove();
    owner.classList.remove('fp-context-menu__item--open');
    owner.setAttribute('aria-expanded', 'false');
  }
  cmFlyouts.length = Math.min(cmFlyouts.length, depth);
}

/** Opens the flyout for parent row `btn` (a row of menu level `depth`). */
function openContextFlyout(item, btn, depth, ctx, focusFirst) {
  if (cmFlyouts[depth] && cmFlyouts[depth].owner === btn) {
    if (focusFirst) cmFocusableItems(cmFlyouts[depth].menu)[0]?.focus();
    return;
  }
  closeContextFlyouts(depth);
  const parentMenu = cmOpenMenus()[depth];
  const menu = document.createElement('div');
  menu.className = 'fp-context-menu fp-context-menu--flyout';
  menu.setAttribute('role', 'menu');
  menu.addEventListener('pointerenter', () => clearTimeout(cmTimer));
  buildContextMenuItems(cmMakeScroller(menu), item.items, ctx, depth + 1);
  document.body.appendChild(menu);
  cmFlyouts[depth] = { menu, owner: btn };
  btn.classList.add('fp-context-menu__item--open');
  btn.setAttribute('aria-expanded', 'true');
  // Right edge of the parent menu (flip to its left edge when that would
  // overflow the viewport); top aligned with the parent row, clamped.
  const vw = window.innerWidth, vh = window.innerHeight;
  const pr = parentMenu.getBoundingClientRect();
  const rr = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const edge = menuEdgePx();
  let left = pr.right - 2;
  if (left + w > vw - edge / 2) left = pr.left - w + 2;
  const top = Math.max(0, Math.min(rr.top - 5, vh - h - edge));
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${top}px`;
  cmSyncScrollCue(cmScroller(menu));
  if (focusFirst) cmFocusableItems(menu)[0]?.focus();
}

function buildContextMenuItems(menuEl, items, ctx, depth) {
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
      menuEl.appendChild(sep);
      return;
    }
    const isEnabled = typeof item.enabled !== 'function' || !!item.enabled(ctx);
    const label = typeof item.label === 'function' ? item.label(ctx) : item.label;
    const hasChildren = Array.isArray(item.items) && item.items.length > 0;
    const btn = document.createElement('button');
    btn.className = 'fp-context-menu__item'
      + (item.danger ? ' fp-context-menu__item--danger' : '')
      + (!isEnabled ? ' fp-context-menu__item--disabled' : '');
    // A parent row carries no data-action: clicking it only opens its flyout.
    if (!hasChildren) btn.setAttribute('data-action', item.action || '');
    btn.setAttribute('data-menu-label', String(label).replace(/<[^>]*>/g, ''));
    btn.setAttribute('role', 'menuitem');
    if (hasChildren) {
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
    }
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
    if (hasChildren) btn.insertAdjacentHTML('beforeend', icon('chevron-right', 'fp-icon--14 fp-context-menu__chevron'));
    // A disabled item gets no click listener at all — CSS's pointer-events:
    // none on .fp-context-menu__item--disabled already keeps the click from
    // ever reaching this button (see styles.css), so this is belt-and-braces
    // against that CSS being bypassed some other way, not the only guard.
    if (isEnabled) {
      if (hasChildren) btn.addEventListener('click', () => { clearTimeout(cmTimer); openContextFlyout(item, btn, depth, ctx, false); });
      else if (item.onClick) btn.addEventListener('click', () => { closeContextMenuAfterActivation(); item.onClick(); });
      else btn.addEventListener('click', closeContextMenuAfterActivation);
      btn._cmItem = hasChildren ? item : null;
      btn._cmCtx = ctx;
      btn._cmDepth = depth;
    }
    // Hover: a parent row opens its flyout after 250 ms; entering any other
    // row while a flyout is open closes it only after a 300 ms grace, so the
    // pointer can cross a sibling on its way to the flyout (safe triangle) —
    // entering the flyout (or coming back to the parent row) cancels that.
    btn.addEventListener('pointerenter', e => {
      if (cmKbdPointer) {
        if (cmKbdPointer.unknown) { cmKbdPointer = { x: e.clientX, y: e.clientY }; return; }
        if (e.clientX === cmKbdPointer.x && e.clientY === cmKbdPointer.y) return;
        cmKbdPointer = null;
      }
      clearTimeout(cmTimer);
      const open = cmFlyouts[depth];
      if (hasChildren && isEnabled) {
        if (open && open.owner === btn) return;
        cmTimer = setTimeout(() => openContextFlyout(item, btn, depth, ctx, false), CM_FLYOUT_OPEN_DELAY);
      } else if (open) {
        cmTimer = setTimeout(() => closeContextFlyouts(depth), CM_FLYOUT_CLOSE_GRACE);
      }
    });
    menuEl.appendChild(btn);
  });
}

function hideContextMenu() {
  clearTimeout(cmTimer);
  closeContextFlyouts(0);
  if (contextMenu) contextMenu.style.display = 'none';
}

/** Closes the menu because an item was activated (mouse or keyboard) and gives
 * focus back to where it was before the menu opened — the focused item was
 * about to be removed, which would drop focus to <body>. This runs BEFORE the
 * item's action, so an action that moves focus itself (a re-sorted list, an
 * inline rename, a dialog) still wins. */
function closeContextMenuAfterActivation() {
  const prev = cmPrevFocus;
  hideContextMenu();
  if (prev && prev.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
}

/** The keyboard closes (Tab, Escape on the root menu) give focus back the
 * same way — one copy of the rule, so the body guard cannot drift. */
function closeContextMenuByKeyboard() {
  closeContextMenuAfterActivation();
}

function contextMenuIsOpen() {
  return !!contextMenu && contextMenu.style.display === 'block';
}

document.addEventListener('click', e => {
  if (!e.target.closest?.('.fp-context-menu')) hideContextMenu();
});

// Keyboard for the open menu (it had none before): Up/Down/Home/End move
// through the innermost open menu, Right/Enter on a parent row opens its
// flyout, Left or Escape closes only the innermost flyout, and Escape on the
// root menu closes everything. Capture phase + stopPropagation so the keys
// never also reach the file list (arrow selection, Enter to open) or the
// global Escape handler behind the menu.
for (const type of ['pointermove', 'pointerdown', 'pointerover']) {
  document.addEventListener(type, e => { cmLastPointer = { x: e.clientX, y: e.clientY }; }, true);
}

// Tab leaves the menu: close it all and put focus back, so Tab then continues
// from where the user was. Focus moving to anything outside the menu tree by
// other means (focusout with a real target) closes it too; relatedTarget null
// is the menu removing its own focused item and is ignored.
document.addEventListener('focusout', e => {
  if (!contextMenuIsOpen()) return;
  const to = e.relatedTarget;
  if (to && !to.closest?.('.fp-context-menu')) hideContextMenu();
});

document.addEventListener('keydown', e => {
  if (!contextMenuIsOpen()) return;
  const key = e.key;
  if (key === 'Tab') {
    closeContextMenuByKeyboard();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Home', 'End'].includes(key)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  cmKbdPointer = cmLastPointer ? { ...cmLastPointer } : { unknown: true };
  const menus = cmOpenMenus();
  const active = menus[menus.length - 1];
  const items = cmFocusableItems(active);
  const cur = items.indexOf(document.activeElement);
  const focused = cur >= 0 ? items[cur] : null;
  if (key === 'ArrowDown') items[(cur + 1) % items.length]?.focus();
  else if (key === 'ArrowUp') items[cur <= 0 ? items.length - 1 : cur - 1]?.focus();
  else if (key === 'Home') items[0]?.focus();
  else if (key === 'End') items[items.length - 1]?.focus();
  else if (key === 'ArrowRight') {
    if (focused?._cmItem) openContextFlyout(focused._cmItem, focused, focused._cmDepth, focused._cmCtx, true);
  } else if (key === 'Enter') {
    if (!focused) return;
    if (focused._cmItem) openContextFlyout(focused._cmItem, focused, focused._cmDepth, focused._cmCtx, true);
    else focused.click();
  } else if (cmFlyouts.length) {
    // ArrowLeft / Escape: the innermost flyout first.
    const { owner } = cmFlyouts[cmFlyouts.length - 1];
    closeContextFlyouts(cmFlyouts.length - 1);
    owner.focus();
  } else if (key === 'Escape') {
    closeContextMenuByKeyboard();
  }
}, true);

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
  '.fp-sidebar__item, .fp-context-menu, .modal, .palette, .fp-inspector__tab, .fp-chip, .fp-drive-card';

function deselectOnOpenSpace(target) {
  if (target?.closest?.(DESELECT_INTERACTIVE_SELECTOR)) return;
  if (target?.closest?.('#list-scroll')) return;
  const screen = activeTab()?.screen;
  if (screen === 'browser') {
    clearSelection();
    if (thisPcActive()) clearThisPcSelection();
  }
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
  capNoticeStack(container, '.fp-snackbar');
  // --timer-snackbar is also its progress bar's duration (styles.css).
  setTimeout(() => el.remove(), fpMotionMs('--timer-snackbar'));
}

// At most this many snackbars / toasts show at once (pass 2 #62/#63). An
// error is never evicted to make room for anything but another error: the
// oldest non-error goes first (the new one included), and only an error
// arriving with nothing but errors on screen pushes the oldest error out.
// An error toast leaves on its own after --timer-toast-error — long enough to read
// a path in it, short enough that repeated failures cannot bury the window —
// paused while the pointer or focus is on it, and has a dismiss button.
// The lives are --timer-toast / --timer-toast-error and the least time left
// after a pause --timer-toast-resume (styles.css, read through fpMotionMs).
const NOTICE_MAX = 3;
function capNoticeStack(container, sel, isKeep = () => false) {
  let items = [...container.querySelectorAll(sel)];
  while (items.length > NOTICE_MAX) {
    const victim = items.find(el => !isKeep(el)) || items[0];
    victim.remove();
    items = items.filter(el => el !== victim);
  }
}
/** Removes `el` after `ms`; with `pausable`, the clock stops while the
 * pointer is over it or focus is inside it, and restarts (at least
 * --timer-toast-resume) once both have left. */
function scheduleNoticeRemoval(el, ms, pausable) {
  let remaining = ms;
  let started = performance.now();
  let timer = setTimeout(() => el.remove(), ms);
  if (!pausable) return;
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    remaining -= performance.now() - started;
  };
  const resume = () => {
    if (timer || !el.isConnected || el.matches(':hover') || el.contains(document.activeElement)) return;
    started = performance.now();
    remaining = Math.max(remaining, fpMotionMs('--timer-toast-resume'));
    timer = setTimeout(() => el.remove(), remaining);
  };
  el.addEventListener('pointerenter', pause);
  el.addEventListener('focusin', pause);
  el.addEventListener('pointerleave', resume);
  el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) setTimeout(resume, 0); });
}

// ── Toast ────────────────────────────────────────────────────────────────────────
function showToast(message, variant = '') {
  // Errors bypass the gate so failures are never silently swallowed.
  if (variant !== 'error' && !notificationsEnabled()) return;
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'fp-toast' + (variant ? ` fp-toast--${variant}` : '');
  if (variant === 'error') el.setAttribute('role', 'alert');
  // message is frequently API error text (formatApiError()) now that fileops
  // routes every failure through here — escape it before inserting.
  el.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (variant === 'error') {
    const btn = document.createElement('button');
    btn.className = 'fp-btn fp-btn--ghost fp-btn--sm fp-toast__dismiss';
    btn.textContent = '✕';
    btn.title = 'Dismiss';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.addEventListener('click', () => el.remove());
    el.appendChild(btn);
  }
  container.appendChild(el);
  capNoticeStack(container, '.fp-toast', t => t.classList.contains('fp-toast--error'));
  if (el.isConnected) {
    scheduleNoticeRemoval(el, fpMotionMs(variant === 'error' ? '--timer-toast-error' : '--timer-toast'), variant === 'error');
  }
}

// ── Refresh (Stage 2D §7) ─────────────────────────────────────────────────────
// One 360° spin of the toolbar icon and one quick opacity dip of the list.
// Classes come off on a timer (not animationend), so they never stick when
// the motion gate removes the animation (animations off). Durations come
// from the CSS tokens (--motion-refresh-spin / -dip) so the timers that take
// the classes off can never disagree with the animations.
function refreshFxMs() {
  return { spin: fpMotionMs('--motion-refresh-spin'), dip: fpMotionMs('--motion-refresh-dip') };
}
const _refreshFxTimers = { spin: 0, dip: 0 };

function restartClassAnimation(el, cls, ms, timerKey) {
  if (!el) return;
  clearTimeout(_refreshFxTimers[timerKey]);
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation when it is already running
  el.classList.add(cls);
  _refreshFxTimers[timerKey] = setTimeout(() => el.classList.remove(cls), ms);
}

/**
 * The single entry point for Ctrl+R, F5, the toolbar Refresh button and the
 * empty-area menu's Refresh (Stage 2D §7.1). Re-lists what the active tab
 * shows, in place: a folder is re-fetched and patched (scroll, selection,
 * anchor, focus, view and size stay), search results are re-run, Home
 * re-fetches its data. Every other tab is marked stale and revalidates when
 * it is next activated.
 */
async function refreshAll() {
  const tab = activeTab();
  if (!tab) return;
  // Other tabs need no mark: activating a tab always revalidates its
  // listing (activateTab), so a refresh reaches them when they are shown.
  const onBrowser = browserScreenActive();
  restartClassAnimation(document.getElementById('btn-refresh'), 'is-spinning', refreshFxMs().spin, 'spin');
  if (onBrowser) {
    // This PC re-reads the drives and patches the cards in place (§7.1 #4).
    if (thisPcActive()) {
      restartClassAnimation(document.getElementById('thispc-view'), 'is-refreshing', refreshFxMs().dip, 'dip');
      await refreshThisPc();
      return;
    }
    restartClassAnimation(document.getElementById('list-scroll'), 'is-refreshing', refreshFxMs().dip, 'dip');
    await refreshDirectory();
  } else if (tab.screen === 'home') {
    await Promise.all([loadRecent(), loadFavorites()]);
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
    window.__fpHealth = data; // read by settings.js's Data-pane "Writes" line and About pane
    if (document.getElementById('settings-pane-about')?.offsetParent) renderAboutPane();
    // /health is the ONE route the backend's token middleware exempts, so a
    // 200 here does not prove our X-FilePlus-Token is the one it wants. It
    // does report whether auth is on; when it is and the bridge handed us no
    // token, every other route 401s -- say so instead of painting a green
    // pill over an app that can't fetch anything.
    if (data && data.auth && !apiToken()) {
      paint('error', 'Backend auth');
      return false;
    }
    // Windows-icon mode's Tier A (POST /shell/icons) is advertised by
    // /health's shell_icons flag: tell icons.js whether to ask for it, so a
    // backend that is too old for the route is never asked (a 404 logs an
    // unsuppressible console error even when caught) and a restarted, newer
    // backend gets its turn without a failed request first. Only on a change
    // of the pill's state, so the poll does not churn the icon caches.
    if (prev !== 'ok' && typeof fpShellIconRoute === 'function') {
      fpShellIconRoute(data && data.shell_icons ? 'live' : 'absent');
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
  // The generic folder bitmap is learned by the prewarm (icons.js), which
  // skips folders until the known-folders map exists: a map that failed at
  // startup and arrives only now must prewarm again (Stage 2D §12 sweep).
  if (await fpLoadKnownFolders()) fpPrewarmIconSizes();
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
  setDriveList(driveList);
}

/**
 * The one drive model (Stage 2D §8): the sidebar's This PC list, the This PC
 * page and the drive crumb all read window.__fpDrives.
 * When the same drives come back (only their free space moved), every row and
 * card is patched in place — no icon repaints, no lost highlight.
 */
function setDriveList(list) {
  window.__fpDrives = list; // driveDisplayLabel() reads this synchronously
  const container = document.getElementById('sb-drives');
  if (container) {
    const rows = [...container.querySelectorAll(':scope > .fp-sidebar__drive-item')];
    const same = rows.length === list.length && rows.every((r, i) => {
      const item = r.querySelector('.fp-sidebar__item');
      return item && item.dataset.path === list[i].mount
        && item.querySelector('.fp-sidebar__item__label')?.textContent === driveDisplayName(list[i]);
    });
    if (same) rows.forEach((r, i) => patchDriveItem(r, list[i]));
    else {
      container.innerHTML = list.map(renderDriveItem).join('');
      const tab = activeTab();
      if (tab) updateSidebarActive(tab.screen === 'browser' ? tab.path : tab.screen);
    }
  }
  if (thisPcActive()) renderThisPC(list);
}

/** A sidebar drive row: the shared name, a 3px usage bar (--bad above 90%)
 * tucked under the label, and a tooltip of the full name over "X free of Y"
 * — the page's own numbers. */
function renderDriveItem(d) {
  const letter = driveLetterOf(d);
  const labelText = driveDisplayName(d);
  const full = driveIsNearlyFull(d) ? ' fp-sidebar__drive-bar__fill--full' : '';
  return `<div class="fp-sidebar__drive-item">
    <button class="fp-sidebar__item" data-screen="browser" data-path="${escapeHtml(d.mount)}"
            data-action="navigate-path" title="${escapeHtml(driveItemTitle(d))}">
      ${fpShellItemIcon({ path: d.mount, is_dir: true }, sidebarIconPx(), 'drive', 'fp-sidebar__drive-icon')}
      <span class="fp-sidebar__drive-letter" aria-hidden="true">${escapeHtml(letter)}</span>
      <span class="fp-sidebar__item__label">${escapeHtml(labelText)}</span>
    </button>
    <div class="fp-sidebar__drive-bar" aria-hidden="true">
      <div class="fp-sidebar__drive-bar__fill${full}" style="width:${drivePercentUsed(d)}%"></div>
    </div>
  </div>`;
}

/** "Label (C:)" over "X GB free of Y GB" (the bar under the label paints
 * over the item's bottom edge, so it carries no tooltip of its own). */
function driveItemTitle(d) {
  return `${driveDisplayName(d)}\n${driveFreeText(d)}`;
}

function patchDriveItem(row, d) {
  const item = row.querySelector('.fp-sidebar__item');
  const fill = row.querySelector('.fp-sidebar__drive-bar__fill');
  if (item) item.title = driveItemTitle(d);
  if (!fill) return;
  const width = `${drivePercentUsed(d)}%`;
  if (fill.style.width !== width) fill.style.width = width;
  fill.classList.toggle('fp-sidebar__drive-bar__fill--full', driveIsNearlyFull(d));
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
    ${fpShellItemIcon({ path: pin.path, is_dir: true }, sidebarIconPx(), 'folder')}
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
  const divider = document.getElementById('sb-tags-divider');
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
    if (divider) divider.hidden = true;
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
  if (divider) divider.hidden = empty;
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
    ${fpShellItemIcon({ path: f.path, is_dir: true }, sidebarIconPx(), symbol)}
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

// ── Overlay scrollbars (Stage 2D §9.3) ────────────────────────────────────────
/** The panels scroll under fpOverlayScroll (overlayscroll.js) instead of a
 * native bar: the sidebar, the inspector body and the Properties body (the
 * §9.3 ruling), and Settings' nav and content (§12 sweep). Each element is static
 * markup, so attaching once at startup is enough — the component's observers
 * follow everything rendered into them later, and a panel shown from
 * display:none re-measures through its ResizeObserver. */
function initOverlayScrollbars() {
  for (const el of [
    document.querySelector('#sidebar .fp-sidebar__scroll'),
    document.getElementById('inspector-body'),
    document.querySelector('#properties-modal .properties__body'),
    document.querySelector('#screen-settings .settings-nav'),
    // Settings content, and the whole layout, which is what scrolls when a
    // narrow screen stacks the nav above the content (styles.css).
    document.querySelector('#screen-settings .settings-content'),
    document.querySelector('#screen-settings .settings-layout'),
  ]) {
    if (el) fpOverlayScroll(el);
  }
  // The search dropdown scrolls inside itself when the window is short
  // (Task 14 Q13): the overlay bar, not a permanent native one — and no fade
  // cue, which would dissolve the popover's own bottom edge and background.
  const searchDd = document.getElementById('search-dropdown');
  if (searchDd) fpOverlayScroll(searchDd, { fade: false });
  // Everything above the inspector's action row scrolls as one only when even
  // a shrunk preview leaves the body no room (a short window at high zoom).
  const inspectorScroll = document.getElementById('inspector-scroll');
  if (inspectorScroll) fpOverlayScroll(inspectorScroll, { hoverRoot: document.getElementById('inspector') });
}

// ── Window controls (Electron IPC) ───────────────────────────────────────────
function initWindowControls() {
  const api = window.electronAPI;
  if (!api) return;
  document.getElementById('btn-minimize')?.addEventListener('click', () => api.minimize?.());
  document.getElementById('btn-maximize')?.addEventListener('click', () => api.maximize?.());
  document.getElementById('btn-close')?.addEventListener('click', () => api.close?.());
  // Maximize <-> Restore: glyph, label and tooltip follow the window's real
  // state, pushed by main on every maximize / unmaximize (pass 2 #174).
  if (typeof api.isMaximized === 'function') setMaximizeButtonState(!!api.isMaximized());
  api.onMaximizedChange?.(setMaximizeButtonState);
}

function setMaximizeButtonState(maximized) {
  const btn = document.getElementById('btn-maximize');
  if (!btn) return;
  const label = maximized ? 'Restore' : 'Maximize';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.querySelector('use')?.setAttribute('href', maximized ? '#fp-window-restore' : '#fp-window-maximize');
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
    // Home's status bar counts the visible pane.
    if (container.closest('#screen-home') && typeof updateStatusBar === 'function') updateStatusBar();
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
  // Items can change width after that (Home's sub-tabs shrink in a narrow
  // file area, Stage 2D §12): the underline follows the active one.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => moveTabIndicator(container)).observe(container);
  }
}

// ── data-action global delegation ─────────────────────────────────────────────
// In-scope actions are handled here; out-of-scope show "not implemented" stub.
const IN_SCOPE_ACTIONS = new Set([
  'navigate-screen', 'navigate-path', 'switch-tab', 'close-tab', 'new-tab',
  'toggle-sidebar', 'toggle-inspector', 'toggle-theme', 'retry-backend-connect',
  'focus-search', 'filter-by-tag', 'open-tag-canvas', 'close-tag-canvas',
  'tag-canvas-select',
  // Ask File+ (Task 15) — shell only, no model wired until Stage 3.
  'ask-open', 'ask-close', 'ask-example',
  'nav-back', 'nav-forward', 'nav-up', 'navigate-crumb', 'nav-retry',
  // 'sort-by' is handled by initColumnSort()'s own listener (browser.js);
  // listed here purely so the data-action bubble to the global switch is a
  // silent no-op instead of a "not yet implemented" toast.
  'sort-by',
  // Handled by their own listeners (the titlebar buttons by id, the Home
  // sub-tabs by initUnderlineTabs, the Settings theme segmented control by
  // its settings-set-theme buttons) — silent here, not a stub toast on every
  // click (pass 2 #186).
  'window-minimize', 'window-maximize', 'window-close',
  'switch-home-tab', 'settings-theme',
  'cm-open-new-tab', 'cm-unpin-sidebar', 'cm-rename-sidebar-item',
  'switch-inspector-tab',
  'inspector-open', 'inspector-reveal', 'inspector-remove-tag', 'inspector-undo-op',
  'unfavorite-file', 'open-recent-file',
  'open-file', 'reveal-file', 'copy-path', 'home-toggle-favorite',
  'palette-open-file', 'palette-open-folder', 'palette-search-files',
  // Toolbar search (Task 14)
  'search-clear', 'search-clear-inline', 'search-remove-chip', 'search-expand-filter', 'search-pick-filter',
  'search-more-filters', 'search-more-apply', 'search-more-cancel',
  'search-history-run', 'search-history-clear', 'search-index-drives', 'search-retry',
  // Settings › Scan & Index (Task 14)
  'settings-index-add', 'settings-index-reindex', 'settings-index-remove',
  'modal-cancel', 'modal-confirm', 'modal-confirm-type',
  'settings-nav', 'settings-set-theme', 'settings-set-density', 'settings-set-accent',
  'settings-set-accent-hex', 'settings-reset-accent',
  'settings-set-show-notifications', 'settings-set-animations', 'settings-toggle', 'settings-set-click-mode',
  'settings-set-icon-source', 'settings-quick-access-toggle', 'settings-set-backspace-deletes',
  'settings-empty-trash',
  // Settings › About / Data (Task 12a)
  'settings-open-logs', 'settings-clear-icon-cache', 'settings-clear-recent',
  // Handled by the 'input'/'change' listeners at the bottom of this file, not
  // by a click case — listed so a click on the slider is a silent no-op.
  'settings-inspector-width',
  'zoom-reset',
  // File operations (Task 4) — context-menu actions wired in the switch below.
  'cm-open', 'cm-open-with', 'cm-reveal-explorer',
  'cm-cut', 'cm-copy', 'cm-paste', 'cm-paste-here', 'cm-rename', 'cm-delete',
  'cm-new-folder', 'cm-new-file', 'cm-refresh', 'refresh-directory',
  'cm-favorite', 'cm-pin-sidebar', 'cm-index-folder', 'cm-properties', 'cm-toggle-hidden',
  'cm-view-xl', 'cm-view-large', 'cm-view-medium', 'cm-view-small',
  'cm-view-list', 'cm-view-details', 'cm-view-tiles', 'cm-view-content', 'cm-sort-name', 'cm-sort-modified',
  // View/Sort toolbar dropdowns + their checked items (Task 10)
  'open-view-menu', 'open-sort-menu',
  'view-xl', 'view-large', 'view-medium', 'view-small', 'view-list', 'view-details', 'view-tiles', 'view-content',
  'toggle-show-hidden', 'toggle-show-extensions', 'toggle-dynamic-media',
  'sort-name', 'sort-created', 'sort-modified', 'sort-accessed', 'sort-type', 'sort-size', 'sort-asc', 'sort-desc',
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
  // Switching to a single-file pane also restores the chrome that multi mode
  // hid (updateInspector('multi') hides both) — otherwise the Inspector ends
  // up showing a lone pane with no tab strip and no way back (pass 2 #200).
  if (name !== 'multi') {
    const tabBar = inspector.querySelector('.fp-tabs.fp-inspector__tabs');
    const preview = document.getElementById('inspector-preview');
    if (tabBar) tabBar.hidden = false;
    if (preview) preview.hidden = false;
  }
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
  // A disabled control now takes the pointer (its tooltip and not-allowed
  // cursor show, pass 2 #58), so a click that does reach one — a synthetic
  // click, a descendant hit — is refused here as well as by the browser.
  if (btn.disabled) return;
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
    // opens the This PC page (Stage 2D §8, tab label "This PC");
    // thispc-toggle sits on the nested chevron button, so a click there is
    // caught by this case first (closest() returns the innermost match) and
    // never falls through to thispc-open.
    case 'thispc-open':
      openBrowserAt(THISPC);
      break;
    case 'thispc-toggle': {
      const expanded = btn.getAttribute('aria-expanded') !== 'false';
      setThisPcOpen(!expanded);
      break;
    }
    // The whole nav group + breadcrumb + Refresh live in the toolbar, which
    // sits OUTSIDE .screen and is therefore painted (and clickable) on Home,
    // Settings and every stub screen. refreshNavButtons() disables the three
    // buttons off the Browser screen; these guards are the second half of the
    // same rule, for the paths a disabled attribute cannot cover (the error
    // banner's own Go back / Retry, a crumb left over from a previous screen).
    // Without them the load lands in a hidden #list-scroll while onNavigated()
    // silently turns the visible Home/Settings tab into a folder tab (#11).
    case 'nav-back':
      if (browserScreenActive()) navBack();
      break;
    case 'nav-forward':
      if (browserScreenActive()) navForward();
      break;
    case 'nav-up':
      if (browserScreenActive()) navUp();
      break;
    case 'navigate-crumb':
      // isAbsolutePath rejects the sentinels a crumb can carry (index.html
      // seeds "home" before the first real updateBreadcrumb) — loadDirectory()
      // would relabel the tab and flip it to the Browser screen synchronously,
      // before the backend's 400 for a driveless path is even known (#13).
      // The This PC crumb carries the THISPC sentinel (Stage 2D §8).
      if (browserScreenActive() && (isAbsolutePath(btn.dataset.path) || btn.dataset.path === THISPC)) loadDirectory(btn.dataset.path);
      break;
    case 'nav-retry':
      if (browserScreenActive()) retryLoad();
      break;
    case 'refresh-directory':
      refreshAll();
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
      // In the collapsed toolbar the chips are display:none until the bar is
      // expanded, so the two chips that define this search were invisible and
      // unremovable (pass 2 #97). Same call addChip() makes after every pick.
      focusSearchInput({ keepDropdownClosed: true });
      runSearch();
      break;
    }
    // ── Toolbar search (Task 14) ──────────────────────────────────
    case 'search-clear':
      clearSearch();
      break;
    case 'search-clear-inline':
      // The bar's own ×: clears and, on a full bar, leaves the caret in it
      // (Explorer); on a collapsed bar the empty overlay folds away.
      clearSearch();
      if (document.getElementById('toolbar')?.dataset.search !== 'collapsed') {
        focusSearchInput({ keepDropdownClosed: true });
      } else {
        // The × just folded away with the overlay: focus goes back to the
        // list, never left on a hidden button.
        const row = browserState.focus ? findListRow(browserState.focus) : null;
        if (row) row.focus({ preventScroll: true });
        else focusListContainer();
      }
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
    case 'search-retry':
      // The Retry button on the in-list "Search failed" banner (pass 2 #96) —
      // pushHistory:false, it is the same search, not a new one.
      runSearch({ pushHistory: false });
      break;
    case 'search-history-run':
      restoreSearchHistoryEntry(btn.dataset.historyKey);
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
    case 'settings-nav':
      switchSettingsPane(btn.dataset.pane);
      if (btn.dataset.pane === 'scan-index') loadIndexStatus();
      break;
    // Settings › About / Data (Stage 2D Task 12a) — settings.js.
    case 'settings-open-logs':
      openLogsFolder();
      break;
    case 'settings-clear-icon-cache':
      clearIconCachesEverywhere();
      break;
    case 'settings-clear-recent':
      clearRecentList();
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
    // 'settings-set-accent-hex' has no click case on purpose: clicking INTO
    // the field resolved this data-action and ran applyAccentHex('') — the
    // red "Enter a valid hex color" error, announced by its aria-live, before
    // a single character was typed (pass 2 #79). The 'input' listener at the
    // bottom of this file is the one that applies and persists the value, and
    // only when it parses; the action stays in IN_SCOPE_ACTIONS so the click
    // is a deliberate silent no-op.
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
    case 'switch-inspector-tab':
      switchInspectorTab(btn.dataset.tab);
      break;
    // The Inspector's action row: aria-disabled (no single selection) keeps
    // the tooltip but does nothing.
    case 'inspector-open':
      if (btn.getAttribute('aria-disabled') !== 'true') inspectorOpenSelected();
      break;
    case 'open-file-with':
      if (btn.getAttribute('aria-disabled') !== 'true') inspectorOpenWithSelected();
      break;
    case 'inspector-reveal':
      if (btn.getAttribute('aria-disabled') !== 'true') inspectorRevealSelected();
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
      updateStatusBar();
      // Populate the (browser-screen) inspector through the SAME pipeline a
      // Browser selection uses. updateInspector('single', …) only rewrote the
      // header: the meta grid, preview, tag chips and History stayed on the
      // previously-inspected file, and _inspectorFileId with them — so the
      // Tags pane then tagged that other file (pass 2 #75). An item that is
      // gone since gets the panel's own "moved or deleted" state, no fetch.
      if (row.hasAttribute('data-missing')) showInspectorMissing(path);
      else showInspectorFor(path);
      break;
    }
    // Home hover actions (Recent + Favorites rows) and the home-row context
    // menu's Open/Reveal/Copy path — resolveHomeRowTarget (home.js) resolves
    // the acting row whether `btn` is the hover-action button itself (nested
    // inside the row) or a context-menu popup button (rendered outside the
    // row; falls back to contextMenuTarget, captured at right-click time).
    case 'open-file': {
      const target = resolveHomeRowTarget(btn);
      if (target) homeOpenPath(target.path, target.ext, target.is_dir);
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
    // The three "act on the target directory" actions share one guard: in
    // search mode contextTargetDir() falls back to the invisible pre-search
    // folder, so they are refused rather than mutating a directory the user
    // cannot see (pass 2 #51). The menu items are already disabled — this
    // covers every other way the case can be reached.
    case 'cm-paste':
    case 'cm-paste-here':
      if (!cmTargetDirVisible()) { showToast('Leave search results to paste here', 'error'); break; }
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
      if (!cmTargetDirVisible()) { showToast('Leave search results to create here', 'error'); break; }
      fileops.newFolder(contextTargetDir()).catch(fileopsReported);
      break;
    case 'cm-new-file':
      if (!cmTargetDirVisible()) { showToast('Leave search results to create here', 'error'); break; }
      fileops.newFile(contextTargetDir()).catch(fileopsReported);
      break;
    case 'cm-refresh':
      refreshAll();
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
      // allSettled, not all: one rejected request used to abort the whole
      // batch's settle(), leaving the stars and the Add/Remove label stale for
      // the entries that HAD changed server-side (pass 2 #201). Resync
      // unconditionally, then report only what actually failed.
      const verb = allFav ? 'remove' : 'add';
      const request = p => (allFav ? API.del('/favorites', { path: p }) : API.post('/favorites', { path: p }));
      Promise.allSettled(paths.map(request)).then(async results => {
        await settle();
        const failed = results.filter(r => r.status === 'rejected');
        if (!failed.length) {
          showToast(allFav ? 'Removed from Favorites' : 'Added to Favorites', 'default');
        } else if (failed.length === paths.length) {
          showToast(`Failed to ${verb} favorite: ${formatApiError(failed[0].reason)}`, 'error');
        } else {
          showToast(`Failed to ${verb} ${failed.length} of ${paths.length}: ${formatApiError(failed[0].reason)}`, 'error');
        }
      });
      break;
    }
    case 'cm-add-tag': {
      // Single selection only — see the menu item's cmSingleEnabled above.
      if (browserState.selection.size !== 1) break;
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
    // A drive's menu (Stage 2D §8): the card or sidebar row right-clicked.
    case 'cm-drive-open':
      if (contextMenuTarget?.dataset?.path) openBrowserAt(contextMenuTarget.dataset.path);
      break;
    case 'cm-drive-open-tab': {
      const drivePath = contextMenuTarget?.dataset?.path;
      if (drivePath) { openNewTab(); openBrowserAt(drivePath); }
      break;
    }
    case 'cm-drive-properties':
      thisPcProperties(contextMenuTarget?.dataset?.path);
      break;
    case 'cm-thispc-view-tiles':
      setThisPcLayout('tiles');
      break;
    case 'cm-thispc-view-details':
      setThisPcLayout('details');
      break;
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
    // The empty-area menu's View flyout — the same eight as the View menu.
    case 'cm-view-xl': case 'cm-view-large': case 'cm-view-medium': case 'cm-view-small':
    case 'cm-view-list': case 'cm-view-details': case 'cm-view-tiles': case 'cm-view-content':
      applyViewChoice(action.slice('cm-view-'.length));
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
    case 'view-xl': case 'view-large': case 'view-medium': case 'view-small':
    case 'view-list': case 'view-details': case 'view-tiles': case 'view-content':
      applyViewChoice(action.slice('view-'.length));
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
    case 'sort-created':
      applySort('created', browserState.sort.dir);
      break;
    case 'sort-modified':
      applySort('modified', browserState.sort.dir);
      break;
    case 'sort-accessed':
      applySort('accessed', browserState.sort.dir);
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
        // Unreachable from any shipped control: scripts/check_menu_cases.js
        // fails verify on a data-action with no case, and
        // stage2d-placeholders.spec.js clicks every visible control and
        // asserts this counter stays 0 (Stage 2D Task 12a).
        window.__fpStubHits = (window.__fpStubHits || 0) + 1;
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
  // Inspector width slider (Settings › Personalization): live while dragging,
  // persisted on 'change' below so one drag is one POST /config (pass 2 #83).
  if (t && t.dataset && t.dataset.action === 'settings-inspector-width') {
    applyInspectorWidth(t.value);
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
  if (t.dataset.action === 'settings-set-animations') {
    fpSetMotion(t.checked);
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
  // Range input: 'change' fires once the drag ends — persist there, so the
  // live 'input' updates above stay local (pass 2 #83).
  if (t.dataset.action === 'settings-inspector-width') {
    applyInspectorWidth(t.value, { persist: true });
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
// Set by the drop handler when it actually moves a tab. dragend fires for
// every drag — including one cancelled with Escape or released over nothing —
// so without this flag the strip claimed a reorder that never happened
// (pass 2 #157). The message no longer claims persistence either: nothing
// writes the order anywhere yet (see the INTEGRATION note below).
let _tabDragReordered = false;

function initTabDrag(tab) {
  tab.addEventListener('dragstart', e => {
    _dragTab = tab;
    _tabDragReordered = false;
    tab.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
  });
  tab.addEventListener('dragend', () => {
    _dragTab = null;
    tab.style.opacity = '';
    document.querySelectorAll('.fp-tab').forEach(t => {
      t.classList.remove('fp-tab--drag-over-before', 'fp-tab--drag-over-after');
    });
    if (_tabDragReordered) showSnackbar('Tab moved', null, null);
    _tabDragReordered = false;
    updateTabbarOverflow();
    // INTEGRATION: POST /ui/tabs with new order for persistence — until that
    // exists the new order lives only in the DOM and is gone on next launch,
    // which is why the snackbar above does not say "saved".
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
    const ref = e.clientX < rect.left + rect.width / 2 ? tab : tab.nextSibling;
    // A drop that leaves the dragged tab exactly where it already sat (it is
    // the reference node, or already immediately before it) is not a reorder —
    // don't announce one (pass 2 #157).
    if (ref !== _dragTab && _dragTab.nextSibling !== ref) {
      tabbar.insertBefore(_dragTab, ref);
      _tabDragReordered = true;
    }
    tab.classList.remove('fp-tab--drag-over-before', 'fp-tab--drag-over-after');
  });
}

// The strip only scrolls horizontally and its scrollbar is hidden, so a plain
// vertical wheel (which Chromium does not apply to an overflow-x container)
// has to be mapped onto scrollLeft by hand — otherwise clipped tabs are
// reachable only by a Shift+wheel or a trackpad swipe (pass 2 #156).
function initTabbarScroll() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  tabbar.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) return;          // Ctrl+wheel is the list zoom
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    if (tabbar.scrollWidth <= tabbar.clientWidth) return;
    e.preventDefault();
    tabbar.scrollLeft += delta;
  }, { passive: false });
  tabbar.addEventListener('scroll', updateTabbarOverflow);
  window.addEventListener('resize', updateTabbarOverflow);
  // Tablist keyboard model (pass 2 #158): the active tab is the single tab
  // stop (roving tabindex, createTabElement/activateTab), Arrow keys move
  // along the strip, Home/End jump to its ends, Delete closes.
  tabbar.addEventListener('keydown', e => {
    const tabEl = e.target.closest?.('.fp-tab');
    if (!tabEl) return;
    const order = tabsInStripOrder();
    if (e.key === 'ArrowRight') { e.preventDefault(); cycleTab(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); cycleTab(-1); }
    else if (e.key === 'Home' && order.length) {
      e.preventDefault(); activateTab(order[0]);
      document.querySelector(`.fp-tab[data-tab-id="${order[0]}"]`)?.focus();
    } else if (e.key === 'End' && order.length) {
      const last = order[order.length - 1];
      e.preventDefault(); activateTab(last);
      document.querySelector(`.fp-tab[data-tab-id="${last}"]`)?.focus();
    } else if (e.key === 'Delete') {
      e.preventDefault(); closeTabById(tabEl.dataset.tabId);
    }
  });
  updateTabbarOverflow();
}

// ── Mouse presses on chrome keep keyboard focus (Explorer's model) ───────────
// A click on a toolbar, tab-strip or sidebar control acts (its click handler
// runs as usual) but does not take keyboard focus from where it was — the
// file list, usually — so the next Enter or arrow key still goes to the list
// (Stage 2D Task 7). Done by handing focus straight back when a press
// focuses such a control, not by cancelling mousedown: the tabs are native
// HTML5 drag sources, which a cancelled mousedown would never start. Text
// fields (the search bar, an inline tab rename) take focus as normal. A
// keyboard user who Tabs to a control still activates it with Enter/Space.
const CHROME_FOCUS_REGIONS = '#toolbar, #tabbar, #sidebar';
let _chromePressPrevFocus = undefined;
function initChromeMouseFocus() {
  document.addEventListener('mousedown', e => {
    _chromePressPrevFocus = undefined;
    const t = e.target;
    if (!(t instanceof Element) || !t.closest(CHROME_FOCUS_REGIONS)) return;
    if (t.closest('input, textarea, select, [contenteditable="true"], #search-wrap')) return;
    _chromePressPrevFocus = document.activeElement;
  }, true);
  document.addEventListener('focusin', e => {
    if (_chromePressPrevFocus === undefined) return;
    const prev = _chromePressPrevFocus;
    _chromePressPrevFocus = undefined;
    const t = e.target;
    if (!(t instanceof Element) || !t.closest(CHROME_FOCUS_REGIONS)) return;
    if (prev && prev !== t && prev !== document.body && prev.isConnected && !prev.closest?.(CHROME_FOCUS_REGIONS)) {
      prev.focus({ preventScroll: true });
      // prev can refuse focus (hidden, disabled or inert since the press):
      // then the control still must not keep it (Stage 2D §12 sweep).
      if (document.activeElement === t) t.blur();
    } else {
      t.blur();
    }
  }, true);
  // A press is over when the button comes up — or when it became a native
  // drag (a tab), which swallows the mouseup: a record left behind would
  // pull a LATER keyboard focus on the chrome back to the list.
  const endPress = () => { _chromePressPrevFocus = undefined; };
  for (const type of ['mouseup', 'pointerup', 'dragstart', 'dragend']) document.addEventListener(type, endPress, true);
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Ctrl+R / F5 — refresh in place (Stage 2D §7.1). There is no Electron menu
  // any more, so nothing else would reload the page; preventDefault anyway so
  // the keys never reach anything but refreshAll(). A modal dialog keeps them.
  const ctrlR = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R');
  if (ctrlR || e.key === 'F5') {
    e.preventDefault();
    if (!e.repeat && !(typeof anyScrimOpen === 'function' && anyScrimOpen())) refreshAll();
    return;
  }
  // ⌘K / Ctrl+K — command palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openPalette(); }
  // Ctrl+F — the search bar (Explorer's key). In the collapsed toolbar it
  // opens as the overlay over the path (Stage 2D §6.2). Not behind a dialog.
  // Never from another text field (inline rename, Ask File+, Settings):
  // Ctrl+F there belongs to that field.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    const t = document.activeElement;
    const editable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (!editable || t.id === 'search-input') {
      e.preventDefault();
      if (!(typeof anyScrimOpen === 'function' && anyScrimOpen())) focusSearchInput();
      return;
    }
  }
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
  // Ctrl+, — Settings (the sidebar's Settings tooltip and the status bar
  // both advertise it). Not behind a dialog.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === ',') {
    e.preventDefault();
    if (!(typeof anyScrimOpen === 'function' && anyScrimOpen())) switchScreen('settings');
  }
  // Ctrl+T — new tab
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 't') { e.preventDefault(); openNewTab(); }
  // Ctrl+W — close current tab
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'w') { e.preventDefault(); closeCurrentTab(); }
  // Ctrl+Shift+T — reopen last closed tab
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') { e.preventDefault(); reopenLastTab(); }
  // Ctrl+1..8 jump to that tab position, Ctrl+9 to the last one (every
  // browser's rule, and what docs/UI-SPEC.md already documented); Ctrl+Tab /
  // Ctrl+Shift+Tab cycle. Until pass 2 #158 none of this existed — a keyboard
  // user could open and close tabs but never switch between them.
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    const order = tabsInStripOrder();
    const target = e.key === '9' ? order[order.length - 1] : order[Number(e.key) - 1];
    if (target) activateTab(target);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Tab') {
    e.preventDefault();
    cycleTab(e.shiftKey ? -1 : 1);
  }
  // Escape — close all overlays
  if (e.key === 'Escape') {
    closePalette();
    hideContextMenu();
    closeModal();
    closeTagCanvas();
    closeProperties();
    closeAskPopout();
    // The search More-filters dialog was the one overlay in the app with
    // neither an Escape nor a backdrop-click way out (pass 2 #92).
    if (typeof closeMoreFilters === 'function') closeMoreFilters();
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
  // The same holds for a focused toolbar or tab-strip control (a View/Sort
  // button, a crumb, the new-tab "+", a tab): Enter/Space act on THAT
  // control (Stage 2D Task 7) — browserKeydown's preventDefault used to
  // swallow the button's own click and open the focused row instead. Such a
  // control only ever holds focus because the KEYBOARD put it there: a mouse
  // press on chrome leaves focus where it was (initChromeMouseFocus below),
  // so after clicking Up, Enter still opens the list's row.
  const controlKeyActivation = (e.key === 'Enter' || e.key === ' ')
    && !!activeEl?.closest?.(CHROME_FOCUS_REGIONS);
  const browserScreenActive = document.getElementById('screen-browser')?.classList.contains('active');
  // An open search Filters/History dropdown owns the cursor keys: they never
  // move the list cursor hidden behind it (search.js navigates inside it when
  // it has focus; anywhere else the keys just close it).
  const searchDd = document.getElementById('search-dropdown');
  if (searchDd && !searchDd.hidden && LIST_CURSOR_KEYS.has(e.key)) {
    if (!searchDd.contains(activeEl) && activeEl?.id !== 'search-input') closeSearchDropdown();
    return;
  }
  if (browserScreenActive && !isEditableTarget && !controlKeyActivation && typeof browserKeydown === 'function') {
    browserKeydown(e);
  }
  const homeScreenActive = document.getElementById('screen-home')?.classList.contains('active');
  if (homeScreenActive && !isEditableTarget && !controlKeyActivation && typeof homeKeydown === 'function') {
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

// Ctrl + scroll wheel over the file list — walks the view ladder (Stage 2D
// §3.1): anywhere over #list-scroll (empty space included), the Details
// column header or the listing notice, one step per 100
// units of deltaY (wheel up = larger, down = smaller). Deltas accumulate, so
// a trackpad's or a high-resolution wheel's small deltas add up to steps
// instead of each firing one, and a fast flick is as many steps as notches —
// no cooldown. It never zooms the app (that is Ctrl+=/-/0 only). Chromium
// reports deltas in CSS px, which app zoom shrinks: they are scaled back to
// screen units (× appZoom.current, the factor behind --app-zoom) so one
// notch is one step at every zoom. The row under the
// pointer is the scroll anchor.
//
// List view (column-major, horizontal scroll): a plain vertical wheel
// scrolls sideways — Chromium would otherwise do nothing.
{
  let wheelAcc = 0;
  const screenDelta = (e) => {
    const unit = e.deltaMode === 1 ? 100 / 3 : (e.deltaMode === 2 ? 300 : 1);
    // Rounded to 1/1000: a 100-unit notch at 110% arrives as 90.9090907 CSS px,
    // and × 1.1 that is 99.9999997 — one hair short of a step without it.
    return Math.round(e.deltaY * unit * (e.deltaMode === 0 ? appZoom.current : 1) * 1000) / 1000;
  };
  document.addEventListener('wheel', e => {
    const listScroll = e.target.closest && e.target.closest('#list-scroll');
    if (e.ctrlKey || e.metaKey) {
      // The file area is the listing plus the strips above it that belong to
      // it: the Details column header and the listing notice.
      // The This PC page too: there it switches tiles <-> details (§8).
      if (!listScroll && !(e.target.closest && e.target.closest('#list-head, #list-notice, #thispc-view'))) return;
      e.preventDefault();
      wheelAcc += screenDelta(e);
      while (wheelAcc <= -100) { wheelAcc += 100; stepView(1, { anchorEl: e.target }); }
      while (wheelAcc >= 100) { wheelAcc -= 100; stepView(-1, { anchorEl: e.target }); }
      return;
    }
    wheelAcc = 0;
    if (listScroll && browserState.view === 'list' && !e.deltaX && e.deltaY) {
      e.preventDefault();
      listScroll.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 100 / 3 : (e.deltaMode === 2 ? listScroll.clientWidth : 1));
    }
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
    : contextMenuType === 'drive'
      ? e.target.closest('.fp-drive-card[data-path], .fp-sidebar__item[data-path]')
      : e.target;
  // Right-click on a This PC card selects it, like a click.
  if (contextMenuType === 'drive' && contextMenuTarget?.classList.contains('fp-drive-card')) {
    selectThisPcCard(contextMenuTarget.dataset.path);
  }
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
      updateStatusBar();
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
  initOverlayScrollbars();
  initSearch();
  initToolbarLayout();
  initChromeMouseFocus();
  // Tab strip: wheel-to-scrollLeft, the overflow hint, and the tablist's own
  // keyboard model (pass 2 #156/#158). The seed tab is already in the DOM, so
  // this also has to run after seedInitialTab().
  initTabbarScroll();
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

  // Search "More filters" backdrop click closes (pass 2 #92)
  document.getElementById('search-filters-scrim')?.addEventListener('click', e => {
    if (e.target === document.getElementById('search-filters-scrim')) closeMoreFilters();
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
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBrowserAt(THISPC); }
  });

  // (The zoom pill and --app-zoom were synced from Electron's persisted zoom
  // factor when app.js loaded — syncAppZoom, above.)

  // Init column sort cycling, marquee selection, and row click/dblclick (A.3.1, Task 3)
  initColumnSort();
  initMarqueeSelection();
  initRowInteractions();
  initThisPcView();
  // View ladder layout: List's rows-per-column follows the pane's height.
  initViewLayout();

  // Drag and drop: rows onto folder rows / sidebar items / breadcrumb crumbs /
  // the Up button, on pointer events (Task 12 — dragdrop.js; the three HTML5
  // initialisers this replaced are gone).
  initDragDrop();

  // Home: double-click to open (Task 6) + Favorites drag-to-reorder
  initHomeRowInteractions();
  initFavoritesDragDrop();

  // The view is decided per folder on every navigation (browser.js
  // decideView — ui.folder_views, the media share, else Details); the old
  // global ui.view_mode/ui.list_scale are deleted once in
  // applySettingsFromConfig.

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
  // Static markup only — no data needed, so a failed load cannot skip it.
  initSettingsNavSelect();
  try {
    await loadConfig();
    applySettingsFromConfig();
    restoreSettingsPane();
    // Before the first listing renders: iconFor() decides the special folder
    // icons (Desktop, Downloads, …) by matching a path against this map, and
    // falls back to guessing from the folder's name until it has loaded.
    await fpLoadKnownFolders();
    // Windows-icon mode: learn the generic folder icon before the first
    // listing needs it (Stage 2D §4.2). Its votes wait for the known-folder
    // map above, and /health's own prewarm may have run before the saved
    // icon source or that map was known.
    fpPrewarmIconSizes();
    await Promise.allSettled([loadDrives(), loadPins(), loadSidebarTags()]);
    loadQuickAccess();
    await checkCrashRecovery();
  } catch (err) {
    // Nothing above is supposed to reject (each loader swallows its own
    // failure), but an unhandled one here would silently abort the rest of
    // init with no trace at all.
    console.warn('[fp-init] startup data load failed:', err);
  }
  // Startup has finished applying what it loaded (config, known folders,
  // drives, pins, tags, Quick Access). The Electron harness waits for this
  // before a test acts: acting earlier raced the config landing — a settings
  // re-apply or a sidebar re-render under a click (Task 11 flakes).
  window.__fpInitDone = true;

  // ── A.17 Edge case INTEGRATION stubs ──────────────────────────────────────
  // (#2 missing folder on navigation and #8 drop onto a sidebar folder are
  // built: failNavigation / showErrorBanner in browser.js, dragdrop.js.)
  // #6  Files added to Everything Folder while tray is closed → update count badge on next open
  //     INTEGRATION: GET /ef/count on tray show event → update #tray-rb-badge
  // #9  Inspector opened on a file that has been deleted externally → show preview fail state
  //     INTEGRATION: GET /preview?path=... → on 404 show commented preview-fail HTML
  // #12 Scan starts while one is already running → show toast "Scan already in progress"
  //     INTEGRATION: POST /scan → if 409 response → showToast('Scan already running', 'warn')
  // #13 Ollama model not downloaded when classification starts → show error banner with install CTA
  //     INTEGRATION: GET /ai/status → if model_status !== 'ready' → show #banner-ai-offline
});

/**
 * Crash recovery (Task 4): GET /operations/pending returns whatever the
 * backend's startup reconciliation classified as left mid-flight by an
 * abnormal shutdown ([] when nothing was pending). reconcile_pending() runs
 * on every startup, inside the API's lifespan (backend/api.py).
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
