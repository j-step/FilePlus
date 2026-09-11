const API_BASE = 'http://127.0.0.1:9876';

// Attaches X-FilePlus-Token when main.js exposed one (FILEPLUS_API_TOKEN set);
// a no-op object when it didn't, so callers can always spread the result into
// a fetch() headers object. TODO(Task 1): move into frontend/src/api.js.
function apiHeaders(extra = {}) {
  const t = window.electronAPI?.apiToken?.();
  return t ? { 'X-FilePlus-Token': t, ...extra } : extra;
}

// ── DOM references ─────────────────────��────────────────────────────────────
const shell              = document.getElementById('shell');
const sidebar            = document.getElementById('sidebar');
const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse');
const paletteScrim       = document.getElementById('palette-scrim');
const paletteInput       = document.getElementById('palette-input');
const searchInput        = document.getElementById('search-input');

// ── Screen switching ────────────────────────────────────────────────────────
// Screens whose backend wiring is not yet complete — fire a stub toast on entry.
const STUB_SCREENS = {
  'review-bin':     'Review Bin: showing placeholder data — backend not wired yet.',
  'ftree':          'File Tree canvas: showing placeholder — snapshots backend not wired yet.',
  'scan-config':    'Scan: showing placeholder — scan pipeline not wired yet.',
  'scan-progress':  'Scan progress: showing placeholder.',
  'scan-results':   'Scan results: showing placeholder.',
  'everything':     'Everything Folder: showing placeholder — watcher not wired yet.',
  'settings':       'Settings: most settings persist locally only — backend wiring TODO.',
};

// Per-tab UI state model
// ─────────────────────
// Each tab is an independent state container — its current screen is held on
// the tab DOM element via data-tab-screen, and its label/title reflect that
// screen. Two tabs on the same screen are still distinct: clicking one only
// activates that single tab.
//
//   switchScreen(id)   — change the ACTIVE tab's screen in place. Sidebar
//                        navigation, keyboard shortcuts, and any other "go to
//                        screen X" entry point should call this. Tabs do NOT
//                        switch on their own.
//   switchToTab(tab)   — user clicked a tab; activate that specific tab and
//                        restore its screen. Other tabs are deactivated; their
//                        screen state is preserved on their DOM nodes.

// NOTE: 'browser' deliberately maps to 'Files' as a last-resort fallback —
// in practice every browser-tab entry point should pass an explicit label
// (a folder/drive name) to switchScreen(), so users see "Downloads" or
// "D:\\" or "Projects" rather than the meta-label "Browser".
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
  home:    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1 6.5L7 1l6 5.5V13H9V9H5v4H1V6.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  browser: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1 4a1 1 0 0 1 1-1h4l1.5 1.5H12a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
};
const DEFAULT_TAB_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/></svg>';

function getScreenLabel(id) { return SCREEN_LABELS[id] || id; }
function getScreenIcon(id)  { return SCREEN_ICONS[id]  || DEFAULT_TAB_ICON; }

function getActiveTab() {
  return document.querySelector('.fp-tab.fp-tab--active');
}

function pathBaseName(p) {
  if (!p) return '';
  // "C:\Users\Justin\Documents" → "Documents"; "D:\" → "D:"; "/" → ''
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(p);
}

function updateTabAppearance(tab, screenId, labelOverride) {
  if (!tab) return;
  const label = labelOverride || getScreenLabel(screenId);
  const labelEl = tab.querySelector('.fp-tab__label');
  if (labelEl) labelEl.textContent = label;
  // Replace the leading <svg> icon (first child) with the screen's icon.
  const firstSvg = tab.querySelector(':scope > svg');
  if (firstSvg) firstSvg.outerHTML = getScreenIcon(screenId);
  tab.setAttribute('title', label);
}

// Called whenever the active tab's path changes — keeps the tab title in
// sync with the current folder so each tab's label reflects its real state.
function syncActiveTabPath(path) {
  const active = getActiveTab();
  if (!active || active.dataset.tabScreen !== 'browser') return;
  const folderName = pathBaseName(path) || getScreenLabel('browser');
  updateTabAppearance(active, 'browser', folderName);
}

// Load a screen's DOM into view (no tab-state changes — caller owns those).
function showScreenDom(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${id}`);
  if (target) target.classList.add('active');
  if (STUB_SCREENS[id] && typeof showToast === 'function') {
    showToast(STUB_SCREENS[id], 'accent');
  }
  if (id === 'browser' && navHistory.stack.length === 0) {
    loadDirectory(null);
  }
  sessionStorage.setItem('fp-active-screen', id);
  updateSidebarActive();
}

function switchScreen(id, labelOverride) {
  // Mutate the ACTIVE tab's screen state — never switch tabs from here.
  // labelOverride lets callers pin the tab title to a meaningful string
  // (e.g. the folder/drive name) so browser tabs don't briefly read "Files".
  const active = getActiveTab();
  if (active) {
    active.dataset.tabScreen = id;
    updateTabAppearance(active, id, labelOverride);
  }
  showScreenDom(id);
}

function switchToTab(tab) {
  if (!tab) return;
  document.querySelectorAll('.fp-tab').forEach(t => {
    const isActive = t === tab;
    t.classList.toggle('fp-tab--active', isActive);
    t.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  showScreenDom(tab.dataset.tabScreen || 'home');
}

// ── Sidebar active-state machinery ────────────────────────────────────────────
// Exactly ONE sidebar item carries --active at any time.
//
// Two modes:
//   Screen-only items  — active when data-screen matches the current screen
//                        AND they have no data-path (they are not path-bound).
//   Path-bound items   — active when the current screen is "browser" AND their
//                        data-path is the longest prefix of the current nav path.
//
// All --active classes are cleared first so only one item can be set.
function updateSidebarActive() {
  const items = document.querySelectorAll('.fp-sidebar__item');
  const screen = sessionStorage.getItem('fp-active-screen') || 'home';

  if (screen !== 'browser') {
    // Screen-based: clear all (including manual-active flag) then highlight the current screen item.
    items.forEach(it => {
      it.classList.remove('fp-sidebar__item--active');
      it.classList.remove('active');
      it.removeAttribute('data-manual-active');
    });
    items.forEach(it => {
      if (it.dataset.screen === screen && !it.dataset.path) {
        it.classList.add('fp-sidebar__item--active');
      }
    });
    return;
  }

  // Browser screen: highlight the path-bound item that is the longest prefix of currentPath.
  // If data-manual-active is set (from a recent navigate-path click), it stays
  // until a real path is loaded and prefix-matching runs below.
  const currentPath = (navHistory.stack[navHistory.idx] || '').toLowerCase();
  // If we have no real path yet, keep the manual click-active state (if any).
  if (!currentPath) {
    // Nothing loaded yet — manual active (if set) remains; nothing else to do.
    return;
  }

  // We have a real path — clear manual flag and re-match by path prefix.
  items.forEach(it => {
    it.classList.remove('fp-sidebar__item--active');
    it.classList.remove('active');
    it.removeAttribute('data-manual-active');
  });

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

// ── Responsive toolbar search ─────────────────────────────────────────────────
// Continuous-resize model: search bar is as wide as possible up to MAX. As the
// breadcrumb (which has flex:1) grows, search shrinks to make room. Below the
// short-placeholder threshold we swap the placeholder to "Search…". Below the
// icon threshold we collapse to the magnifier icon. When room reappears, we
// re-expand smoothly. The cave fade tracks actual breadcrumb overflow only.
const SEARCH_MAX_WIDTH                  = 220; // px; expanded full width
const SEARCH_MIN_FULL_PLACEHOLDER       = 170; // px; below this, swap to short placeholder "Search…"
const SEARCH_MIN_SHORT_PLACEHOLDER      = 110; // px; below this, collapse to icon
const SEARCH_ICON_WIDTH                 = 28;  // px; collapsed icon width
const SEARCH_RESIZE_DEAD_ZONE           = 0;   // px; pixel-for-pixel response

const PLACEHOLDER_FULL  = 'Search files…';
const PLACEHOLDER_SHORT = 'Search…';

function initToolbarResponsive() {
  const toolbar    = document.querySelector('.fp-toolbar');
  const breadcrumb = document.getElementById('breadcrumb');
  const searchWrap = document.getElementById('search-wrap');
  const input      = document.getElementById('search-input');
  if (!toolbar || !breadcrumb || !searchWrap) return;

  let moRafId = null;
  let lastAppliedWidth = SEARCH_MAX_WIDTH;
  let lastAppliedState = 'full'; // 'full' | 'short' | 'icon'
  let iconEnteredAt = 0;          // performance.now() when state became 'icon'
  let caveDelayTimer = null;      // pending setTimeout for deferred cave-show
  const CAVE_REVEAL_DELAY_MS = 10;

  function applyContinuous(width, state) {
    // Track entry into icon state for the cave-reveal delay.
    if (state === 'icon' && lastAppliedState !== 'icon') {
      iconEnteredAt = performance.now();
    }
    if (state === 'icon') {
      searchWrap.classList.add('fp-toolbar__search--icon');
      searchWrap.style.width = '';
      // Icon state: breadcrumb may be pushed into the cave. Allow it to shrink
      // (basis:0, shrink:1) so it claims remaining space and overflow-scrolls.
      breadcrumb.style.flex = '1 1 0';
      breadcrumb.style.minWidth = '0';
    } else {
      searchWrap.classList.remove('fp-toolbar__search--icon');
      searchWrap.style.width = width + 'px';
      // Non-icon: PIN breadcrumb at its natural content width. shrink:0 means
      // flex layout will NOT clip the path; grow:1 still lets it absorb empty
      // space when the toolbar is wider than needed. Search absorbs all the
      // shrink as the toolbar narrows — the path stays put until search has
      // collapsed to the icon.
      breadcrumb.style.flex = '1 0 auto';
      breadcrumb.style.minWidth = '';
      if (input) {
        const desired = state === 'full' ? PLACEHOLDER_FULL : PLACEHOLDER_SHORT;
        if (input.placeholder !== desired) input.placeholder = desired;
      }
    }
    lastAppliedWidth = width;
    lastAppliedState = state;
  }

  function actualRecalc() {
    // Compute the toolbar's available width MINUS every fixed-width child
    // (back/forward/up nav, view toggle, inspector toggle, theme toggle) MINUS
    // breadcrumb's NATURAL desired width. The remainder is what search can claim.
    //
    // CRITICAL: breadcrumb.scrollWidth is NOT a reliable "natural width" — when
    // content fits inside the breadcrumb container, scrollWidth == clientWidth
    // (the full allocated flex space). To get the true natural desired width,
    // sum the breadcrumb's children's actual rendered widths plus the gaps.
    const breadcrumbStyle = getComputedStyle(breadcrumb);
    const bcGap           = parseFloat(breadcrumbStyle.gap || 0);
    let breadcrumbNatural = 0;
    let bcVisibleChildren = 0;
    for (const child of breadcrumb.children) {
      const w = child.getBoundingClientRect().width;
      if (w > 0) {
        breadcrumbNatural += w;
        bcVisibleChildren++;
      }
    }
    if (bcVisibleChildren > 1) breadcrumbNatural += bcGap * (bcVisibleChildren - 1);

    const toolbarStyle   = getComputedStyle(toolbar);
    const toolbarPadding = parseFloat(toolbarStyle.paddingLeft || 0) + parseFloat(toolbarStyle.paddingRight || 0);
    const toolbarGap     = parseFloat(toolbarStyle.gap || 0);

    let otherWidths = 0;
    let visibleChildren = 0;
    for (const child of toolbar.children) {
      if (child === searchWrap || child === breadcrumb) continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0) {
        otherWidths += r.width;
        visibleChildren++;
      }
    }
    // Total gaps in toolbar = (visibleChildren + 2 [search + breadcrumb]) - 1
    const totalGaps = toolbarGap * Math.max(0, (visibleChildren + 2) - 1);

    const availableForSearch = toolbar.clientWidth - toolbarPadding - otherWidths - totalGaps - breadcrumbNatural;

    let targetWidth, targetState;
    if (availableForSearch >= SEARCH_MIN_SHORT_PLACEHOLDER) {
      targetWidth = Math.min(SEARCH_MAX_WIDTH, Math.max(SEARCH_MIN_SHORT_PLACEHOLDER, availableForSearch));
      targetState = targetWidth >= SEARCH_MIN_FULL_PLACEHOLDER ? 'full' : 'short';
    } else {
      targetWidth = SEARCH_ICON_WIDTH;
      targetState = 'icon';
    }

    // Pixel-for-pixel: apply if width or state changed at all
    const widthChanged = targetWidth !== lastAppliedWidth;
    const stateChanged = targetState !== lastAppliedState;
    if (widthChanged || stateChanged) {
      applyContinuous(targetWidth, targetState);
    }

    // Cave fade only appears when search has collapsed to the icon AND a short
    // delay has passed since the collapse — the delay prevents same-frame
    // visual coupling between the search shrinking and the cave appearing.
    // Until both conditions are met, the breadcrumb is pinned and cannot show
    // a cave. The path is only "pushed back" once the search has nowhere
    // left to give AND the eye has registered the collapse.
    const bcOverflow = breadcrumb.scrollWidth - breadcrumb.clientWidth;
    const isIcon = lastAppliedState === 'icon';
    const elapsed = isIcon ? performance.now() - iconEnteredAt : 0;
    const delayPassed = elapsed >= CAVE_REVEAL_DELAY_MS;
    const showCave = isIcon && delayPassed && (bcOverflow > 1);

    breadcrumb.classList.toggle('fp-breadcrumb--scroll', showCave);
    if (showCave) {
      breadcrumb.scrollLeft = breadcrumb.scrollWidth;
    }

    // If we're in icon state and would show the cave but the delay hasn't
    // elapsed yet, schedule a deferred recalc so the cave appears right after
    // the delay window closes.
    if (isIcon && !delayPassed && (bcOverflow > 1)) {
      if (caveDelayTimer === null) {
        const remaining = Math.max(0, CAVE_REVEAL_DELAY_MS - elapsed) + 1;
        caveDelayTimer = setTimeout(() => {
          caveDelayTimer = null;
          actualRecalc();
        }, remaining);
      }
    } else if (caveDelayTimer !== null && !isIcon) {
      // Left icon state during the delay window — cancel the deferred reveal.
      clearTimeout(caveDelayTimer);
      caveDelayTimer = null;
    }
  }

  // ResizeObserver fires post-layout, pre-paint — call actualRecalc directly
  // (no rAF wrap) so the search width updates in the SAME frame as the toolbar
  // resize. Wrapping in rAF would push the update to the NEXT frame, which the
  // user perceives as "smoothing" / lag during fast drags.
  const ro = new ResizeObserver(() => actualRecalc());
  ro.observe(toolbar);

  // MutationObserver can fire synchronously many times (e.g. breadcrumb rebuilds);
  // coalesce those into one rAF to avoid layout thrashing.
  function moRecalc() {
    if (moRafId !== null) return;
    moRafId = requestAnimationFrame(() => { moRafId = null; actualRecalc(); });
  }
  const mo = new MutationObserver(moRecalc);
  mo.observe(breadcrumb, { childList: true, characterData: true, subtree: true });

  // Click on collapsed icon → open command palette (do NOT expand inline).
  searchWrap.addEventListener('click', e => {
    if (searchWrap.classList.contains('fp-toolbar__search--icon')) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof openPalette === 'function') openPalette();
    }
  }, true /* capture */);

  actualRecalc();
}

// ── View modes ────────────────────────────────────────────────────────────────
function setViewMode(mode) {
  // v2 segmented opts
  document.querySelectorAll('.fp-segmented__opt[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  // legacy buttons
  document.querySelectorAll('.tool-group__btn[data-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  const listScroll = document.getElementById('list-scroll');
  const listHead   = document.getElementById('list-head');
  if (listScroll) {
    // Suppress layout flicker by hiding briefly during the layout swap
    listScroll.style.opacity = '0';
    listScroll.dataset.view = mode;
    // Show/hide column header in grid mode (A.3.1)
    if (listHead) listHead.classList.toggle('list-head--grid-hidden', mode === 'grid');
    // Restore opacity on next paint — batches DOM updates before repaint
    requestAnimationFrame(() => {
      listScroll.style.opacity = '';
    });
  }
  // Home — Recent and Favorites panes share the same view-mode toggle
  document.querySelectorAll('.home-pane').forEach(pane => {
    pane.dataset.view = mode;
  });
  sessionStorage.setItem('fp-view-mode', mode);
}

// ── Column sort cycling (A.3.1) ───────────────────────────────────────────────
function initColumnSort() {
  document.querySelectorAll('.fp-sortable[data-sort]').forEach(col => {
    col.style.cursor = 'pointer';
    col.addEventListener('click', () => {
      const currentSort = col.dataset.sort;
      const wasActive = col.classList.contains('active');
      const wasAsc = col.classList.contains('asc');
      // Cycle: inactive → asc → desc → inactive
      document.querySelectorAll('.fp-sortable').forEach(c => {
        c.classList.remove('active', 'asc');
      });
      if (!wasActive) {
        col.classList.add('active', 'asc');
      } else if (wasAsc) {
        col.classList.add('active'); // desc (no asc class)
      }
      // else was desc → now inactive (neither class)
      // INTEGRATION: sort file list by col.dataset.sort direction
    });
  });
}

// ── Marquee selection (A.3.1) ─────────────────────────────────────────────────
function initMarqueeSelection() {
  const listScroll = document.getElementById('list-scroll');
  const marqueeRect = document.getElementById('marquee-rect');
  if (!listScroll || !marqueeRect) return;
  let dragging = false, startX = 0, startY = 0;

  listScroll.addEventListener('mousedown', e => {
    if (e.target.closest('.fp-row, .fp-row__icon, .fp-row__name')) return;
    if (e.button !== 0) return;
    dragging = true;
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
    // Highlight intersecting rows
    const mr = { left: x, right: x + w, top: y, bottom: y + h };
    listScroll.querySelectorAll('.fp-row').forEach(row => {
      const rr = row.getBoundingClientRect();
      const hit = rr.left < mr.right && rr.right > mr.left &&
                  rr.top  < mr.bottom && rr.bottom > mr.top;
      row.classList.toggle('fp-row--selected', hit);
    });
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    marqueeRect.style.display = 'none';
    // INTEGRATION: selected set drives inspector aggregate view
    const selected = listScroll.querySelectorAll('.fp-row--selected');
    if (selected.length > 1) updateInspector('multi', { count: selected.length });
  });
}

// ── Inspector update (A.3.2) ─────────────────────────────────────────────────
function updateInspector(mode, data = {}) {
  const inspector = document.getElementById('inspector');
  if (!inspector) return;

  const singlePanes = inspector.querySelectorAll('.fp-inspector__pane:not([data-pane="multi"])');
  const multiPane   = inspector.querySelector('.fp-inspector__pane[data-pane="multi"]');
  const tabBar      = inspector.querySelector('.fp-tabs.fp-inspector__tabs');
  const preview     = document.getElementById('inspector-preview');
  const filenameEl  = document.getElementById('inspector-filename');
  const filepathEl  = document.getElementById('inspector-filepath');

  if (mode === 'multi') {
    // Show multi-select aggregate; hide single-file UI
    singlePanes.forEach(p => { p.style.display = 'none'; });
    if (tabBar)   tabBar.style.display = 'none';
    if (preview)  preview.style.display = 'none';
    if (filenameEl) filenameEl.textContent = `${data.count} items selected`;
    if (filepathEl) filepathEl.textContent = '';
    if (multiPane) {
      multiPane.style.display = '';
      const countEl = multiPane.querySelector('#inspector-multi-count');
      const sizeEl  = multiPane.querySelector('#inspector-multi-size');
      if (countEl) countEl.textContent = data.count || 0;
      if (sizeEl)  sizeEl.textContent  = data.totalSize || '—'; // INTEGRATION: real sum
    }
    if (!inspector.classList.contains('inspector--open')) toggleInspector();
  } else if (mode === 'single') {
    // Restore single-file UI
    singlePanes.forEach(p => { p.style.display = ''; });
    if (multiPane) multiPane.style.display = 'none';
    if (tabBar)    tabBar.style.display = '';
    if (preview)   preview.style.display = '';
    if (data.name && filenameEl) filenameEl.textContent = data.name;
    if (data.path && filepathEl) filepathEl.textContent = data.path;
    if (!inspector.classList.contains('inspector--open')) toggleInspector();
  } else {
    // Empty selection — collapse inspector
    if (inspector.classList.contains('inspector--open')) toggleInspector();
  }
}

// ── Inspector tabs ────────────────────────────────────────────────────────────
function switchInspectorTab(name) {
  document.querySelectorAll('.fp-inspector__tab, .inspector__tab').forEach(tab => {
    tab.classList.toggle('active', (tab.dataset.tab || tab.dataset.pane) === name);
  });
  document.querySelectorAll('.fp-inspector__pane, .inspector__pane').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.pane === name);
  });
}

// ── Inspector toggle ───────────────────────────────��───────────────────────��──
function toggleInspector() {
  const inspector = document.getElementById('inspector');
  const toggleBtn = document.getElementById('btn-inspector-toggle');
  if (!inspector) return;
  const isOpen = inspector.classList.toggle('inspector--open');
  toggleBtn?.classList.toggle('fp-icon-btn--active', isOpen);
  // Notify: used by Browser screen to compact columns
  document.dispatchEvent(new CustomEvent('fp:inspector-toggle', { detail: { open: isOpen } }));
}

// ── Command palette ───────────────────────────────���──────────────────────��─────
function openPalette() {
  if (!paletteScrim) return;
  paletteScrim.style.display = 'flex';
  paletteScrim.removeAttribute('aria-hidden');
  if (paletteInput) { paletteInput.value = ''; paletteInput.focus(); }
}

function closePalette() {
  if (!paletteScrim) return;
  paletteScrim.style.display = 'none';
  paletteScrim.setAttribute('aria-hidden', 'true');
}

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

// ── Confirmation modal (A.11.3) ───────────────────────────────────────────────
function openModal(type, config = {}) {
  const scrim   = document.getElementById('modal-scrim');
  const icon    = document.getElementById('modal-icon');
  const title   = document.getElementById('modal-title');
  const body    = document.getElementById('modal-body');
  const confirm = document.getElementById('modal-confirm');
  const confirmRow = document.getElementById('modal-confirm-input-row');
  const confirmWord = document.getElementById('modal-confirm-word');
  if (!scrim) return;

  // Icon: danger uses alert-octagon in bad, warn uses alert-triangle in warn
  const isDanger = type === 'danger';
  if (icon) {
    icon.style.color = isDanger ? 'var(--bad)' : 'var(--warn)';
    icon.innerHTML = isDanger
      ? '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
      : '<path d="M12 3L2 21h20L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 10v5M12 17.5v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>';
  }
  if (title)   title.textContent  = config.title   || 'Confirm';
  if (body)    body.textContent   = config.body    || '';
  if (confirm) {
    confirm.textContent = config.confirmLabel || (isDanger ? 'Delete' : 'Confirm');
    confirm.className = `fp-btn fp-btn--sm ${isDanger ? 'fp-btn--danger' : 'fp-btn--primary'}`;
    if (config.onConfirm) confirm.onclick = () => { config.onConfirm(); closeModal(); };
    else confirm.onclick = closeModal;
  }
  // Typed confirmation (optional)
  if (config.confirmWord && confirmRow && confirmWord) {
    confirmWord.textContent = config.confirmWord;
    confirmRow.style.display = '';
  } else if (confirmRow) {
    confirmRow.style.display = 'none';
  }

  scrim.style.display = 'flex';
  scrim.removeAttribute('aria-hidden');
}

function closeModal() {
  const scrim = document.getElementById('modal-scrim');
  if (!scrim) return;
  scrim.style.display = 'none';
  scrim.setAttribute('aria-hidden', 'true');
}

// ── Theme toggle ─────────��─────────────────────────────────────────────────────
const THEME_MODES = ['dark', 'light', 'system'];
const _systemDark = window.matchMedia('(prefers-color-scheme: dark)');
let _systemListenerAttached = false;

function resolveTheme(mode) {
  return mode === 'system' ? (_systemDark.matches ? 'dark' : 'light') : mode;
}

function toggleTheme() {
  const current = localStorage.getItem('fp-theme') || 'system';
  const next = THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
  applyTheme(next);
}

// ── Settings: pane switching + persistence ────────────────────────────────────

function switchSettingsPane(pane) {
  if (!pane) return;
  document.querySelectorAll('.settings-nav__item').forEach(btn => {
    btn.classList.toggle('settings-nav__item--active', btn.dataset.pane === pane);
  });
  document.querySelectorAll('.settings-pane').forEach(p => {
    p.style.display = p.dataset.pane === pane ? '' : 'none';
  });
  sessionStorage.setItem('fp-settings-pane', pane);
}

function applyTheme(mode) {
  if (!THEME_MODES.includes(mode)) mode = 'system';
  const html = document.documentElement;
  html.dataset.theme = resolveTheme(mode);
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
}

function applyDensity(density) {
  document.documentElement.dataset.density = density;
  localStorage.setItem('fp-density', density);
  document.querySelectorAll('[data-action="settings-set-density"]').forEach(btn => {
    const v = btn.dataset.density || btn.dataset.val;
    btn.classList.toggle('active', v === density);
  });
}

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const DEFAULT_ACCENT = '#4CC2FF';

function isValidHex(s) {
  return typeof s === 'string' && HEX_RE.test(s.trim());
}

function applyAccentHex(rawHex) {
  const hex = (rawHex || '').trim();
  const errorEl = document.getElementById('settings-accent-error');
  if (!isValidHex(hex)) {
    if (errorEl) {
      errorEl.textContent = 'Enter a valid hex color (e.g. #4CC2FF or #abc).';
      errorEl.hidden = false;
    }
    return false;
  }
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  // Write to --accent-custom so the canonical cascade picks it up
  document.documentElement.style.setProperty('--accent-custom', hex);
  // Update swatch
  const swatch = document.getElementById('settings-accent-swatch');
  if (swatch) swatch.style.background = hex;
  localStorage.setItem('fp-accent', hex);
  return true;
}

function resetAccentToDefault() {
  document.documentElement.style.removeProperty('--accent-custom');
  const swatch = document.getElementById('settings-accent-swatch');
  if (swatch) swatch.style.background = `var(--accent)`;
  const input = document.getElementById('settings-accent-hex');
  if (input) input.value = '';
  const errorEl = document.getElementById('settings-accent-error');
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  localStorage.removeItem('fp-accent');
}

// Legacy compatibility — accept hex through old name too
function applyAccent(value) {
  if (isValidHex(value)) applyAccentHex(value);
}

function restoreSettings() {
  if (window.electronAPI?.micaAvailable?.()) document.documentElement.dataset.mica = 'on';
  applyTheme(localStorage.getItem('fp-theme') || 'system');
  const density = localStorage.getItem('fp-density');
  if (density) applyDensity(density);
  // One-time migration: drop the retired amber default (#E8965E) that older
  // sessions re-saved to localStorage, so the new blue accent takes over.
  const RETIRED_AMBER_ACCENT = '#E8965E';
  const persistedAccent = localStorage.getItem('fp-accent');
  if (persistedAccent && persistedAccent.toLowerCase() === RETIRED_AMBER_ACCENT.toLowerCase()) {
    localStorage.removeItem('fp-accent');
    console.info('[fp-accent] Dropped retired amber default; using the new blue accent.');
  }
  const savedAccent = localStorage.getItem('fp-accent');
  if (savedAccent) {
    if (isValidHex(savedAccent)) {
      // Valid hex — apply via --accent-custom hook
      document.documentElement.style.setProperty('--accent-custom', savedAccent);
      const input = document.getElementById('settings-accent-hex');
      if (input) input.value = savedAccent;
      const swatch = document.getElementById('settings-accent-swatch');
      if (swatch) swatch.style.background = savedAccent;
    } else {
      // Invalid (e.g., 'lavender' from pre-A4 sessions) — purge so the default accent wins
      console.warn(`[fp-accent] Discarding invalid persisted value: ${savedAccent}`);
      localStorage.removeItem('fp-accent');
    }
  }
  // Zoom is now handled by Electron webContents.setZoomFactor (no CSS zoom persistence needed).
  // Legacy fp-zoom in localStorage is intentionally ignored — Electron persists zoom separately.
  // Stage 1: glow feature removed
  localStorage.removeItem('fp-accent-glow');
  // Notifications setting — defaults to OFF if unset
  const checkbox = document.getElementById('settings-show-notifications');
  if (checkbox) checkbox.checked = notificationsEnabled();
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

// ── Context menu ──────────────────────────────────────────────────────────────
// A.10: five menu type definitions (items rendered dynamically into #context-menu)
const CONTEXT_MENUS = {
  // A.10.1 — File context menu
  file: [
    { label: 'Open',            action: 'cm-open',            icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M5 5l4 2-4 2V5z" fill="currentColor"/></svg>' },
    { label: 'Open with…',      action: 'cm-open-with' },
    { label: 'Open in new tab', action: 'cm-open-new-tab',    icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/></svg>' },
    { label: 'Reveal in Browser', action: 'cm-reveal-browser' },
    'sep',
    { label: 'Cut',    action: 'cm-cut',    kbd: 'Ctrl+X' },
    { label: 'Copy',   action: 'cm-copy',   kbd: 'Ctrl+C' },
    { label: 'Paste',  action: 'cm-paste',  kbd: 'Ctrl+V' },
    { label: 'Rename', action: 'cm-rename', kbd: 'F2' },
    { label: 'Delete', action: 'cm-delete', kbd: 'Del', danger: true, icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6v5M8.5 6v5M3 4l.8 8h6.4L11 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    'sep',
    { label: 'Add tag…',         action: 'cm-add-tag',     icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 8.5L7.5 3l3.5 3.5L5.5 12 2 8.5z" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="5" r="1" fill="currentColor"/></svg>' },
    { label: 'Reclassify',       action: 'cm-reclassify' },
    { label: 'Add to Favorites', action: 'cm-favorite' },
    'sep',
    { label: 'Compress to .zip',       action: 'cm-compress' },
    { label: 'Properties',             action: 'cm-properties' },
    { label: 'Show in Windows Explorer', action: 'cm-reveal-explorer' },
  ],

  // A.10.2 — Folder context menu
  folder: [
    { label: 'Open',             action: 'cm-open', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3.5a1 1 0 0 1 1-1h3l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>' },
    { label: 'Open in new tab',  action: 'cm-open-new-tab' },
    { label: 'Open in new window', action: 'cm-open-new-window' },
    'sep',
    { label: 'Cut',    action: 'cm-cut',    kbd: 'Ctrl+X' },
    { label: 'Copy',   action: 'cm-copy',   kbd: 'Ctrl+C' },
    { label: 'Paste',  action: 'cm-paste',  kbd: 'Ctrl+V' },
    { label: 'Rename', action: 'cm-rename', kbd: 'F2' },
    { label: 'Delete', action: 'cm-delete', kbd: 'Del', danger: true, icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 4h10M5 4V2.5h4V4M5.5 6v5M8.5 6v5M3 4l.8 8h6.4L11 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
    'sep',
    { label: 'New folder inside', action: 'cm-new-folder' },
    { label: 'New file',          action: 'cm-new-file' },
    'sep',
    { label: 'Add to Favorites',   action: 'cm-favorite' },
    { label: 'Pin to sidebar',     action: 'cm-pin-sidebar' },
    { label: 'Reclassify contents', action: 'cm-reclassify-folder' },
    'sep',
    { label: 'Properties',              action: 'cm-properties' },
    { label: 'Show in Windows Explorer', action: 'cm-reveal-explorer' },
  ],

  // A.10.3 — Empty area context menu
  'empty-area': [
    { label: 'New folder', action: 'cm-new-folder', icon: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 3.5a1 1 0 0 1 1-1h3l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>' },
    { label: 'New file',   action: 'cm-new-file' },
    { label: 'Paste',      action: 'cm-paste',      kbd: 'Ctrl+V' },
    { label: 'Refresh',    action: 'cm-refresh',    kbd: 'F5' },
    'sep',
    { label: 'View → List',       action: 'cm-view-list' },
    { label: 'View → Grid',       action: 'cm-view-grid' },
    { label: 'Sort by → name',    action: 'cm-sort-name' },
    { label: 'Sort by → modified', action: 'cm-sort-modified' },
    { label: 'Group by → type',   action: 'cm-group-type' },
    { label: 'Group by → none',   action: 'cm-group-none' },
    'sep',
    { label: 'Show hidden files', action: 'cm-toggle-hidden' },
    { label: 'Properties',        action: 'cm-properties' },
  ],

  // A.10.4 — Tab context menu
  tab: [
    { label: 'New tab',            action: 'cm-new-tab' },
    { label: 'Duplicate tab',      action: 'cm-duplicate-tab' },
    { label: 'Close tab',          action: 'cm-close-tab',  kbd: 'Ctrl+W' },
    { label: 'Close other tabs',   action: 'cm-close-other-tabs' },
    'sep',
    { label: 'Pin tab',            action: 'cm-pin-tab' },
    { label: 'Rename tab',         action: 'cm-rename-tab' },
  ],

  // A.10.5 — Sidebar item context menu
  'sidebar-item': [
    { label: 'Open in new tab',    action: 'cm-open-new-tab' },
    { label: 'Unpin',              action: 'cm-unpin-sidebar' },
    { label: 'Pin to top',         action: 'cm-pin-top' },
    { label: 'Rename label',       action: 'cm-rename-sidebar-item' },
    { label: 'Remove from sidebar', action: 'cm-remove-sidebar', danger: true },
  ],
};

function getMenuTypeForTarget(target) {
  if (target.closest('.fp-tab')) return 'tab';
  if (target.closest('.fp-sidebar__item, .fp-sidebar__section')) return 'sidebar-item';
  if (target.closest('.fp-row[data-type="folder"], .ef-row[data-type="folder"]')) return 'folder';
  if (target.closest('.fp-row, .ef-row, .rb-row, .home-row')) return 'file';
  return 'empty-area';
}

const contextMenu = document.getElementById('context-menu');

function showContextMenu(x, y, items) {
  if (!contextMenu) return;
  contextMenu.innerHTML = '';
  items.forEach(item => {
    if (item === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'fp-context-menu__sep';
      contextMenu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'fp-context-menu__item' + (item.danger ? ' fp-context-menu__item--danger' : '');
    btn.setAttribute('data-action', item.action || '');
    btn.setAttribute('role', 'menuitem');
    if (item.icon) btn.innerHTML = item.icon;
    btn.innerHTML += `<span>${item.label}</span>`;
    if (item.kbd) {
      const kbd = document.createElement('span');
      kbd.className = 'fp-context-menu__kbd';
      kbd.textContent = item.kbd;
      btn.appendChild(kbd);
    }
    if (item.onClick) btn.addEventListener('click', () => { item.onClick(); hideContextMenu(); });
    else btn.addEventListener('click', hideContextMenu);
    contextMenu.appendChild(btn);
  });
  contextMenu.style.display = 'block';
  // Position within viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  contextMenu.style.left = `${Math.min(x, vw - 200)}px`;
  contextMenu.style.top  = `${Math.min(y, vh - contextMenu.offsetHeight - 8)}px`;
}

function hideContextMenu() {
  if (contextMenu) contextMenu.style.display = 'none';
}

document.addEventListener('click', e => {
  if (!contextMenu?.contains(e.target)) hideContextMenu();
});

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
  el.innerHTML = `<span>${message}</span>`;
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
  el.innerHTML = `<span>${message}</span>`;
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

// Expose for actions.js
window.__appShowSnackbar = showSnackbar;
window.__appShowToast    = showToast;

// ── File list loading ─────────────────────────────────────────────────────────

const ICON_FILE = `<svg class="fp-row__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="1" width="9" height="13" rx="1.5" fill="var(--bg-raised)" stroke="var(--border-subtle)" stroke-width="0.8"/><path d="M11 1v4h3" stroke="var(--border-subtle)" stroke-width="0.8" stroke-linejoin="round"/></svg>`;
const ICON_IMG  = `<svg class="fp-row__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1" y="2" width="14" height="12" rx="1.5" fill="var(--bg-raised)" stroke="var(--border-subtle)" stroke-width="0.8"/><circle cx="5.5" cy="7" r="1.5" stroke="var(--text-tertiary)" stroke-width="0.8"/><path d="M1 12l4-4 4 4 2-2 4 2" stroke="var(--text-tertiary)" stroke-width="0.8" stroke-linejoin="round"/></svg>`;
const ICON_TXT  = `<svg class="fp-row__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="1" width="9" height="13" rx="1.5" fill="var(--bg-raised)" stroke="var(--border-subtle)" stroke-width="0.8"/><path d="M11 1v4h3" stroke="var(--border-subtle)" stroke-width="0.8" stroke-linejoin="round"/><path d="M5 6h6M5 8.5h6M5 11h4" stroke="var(--text-tertiary)" stroke-width="0.8" stroke-linecap="round"/></svg>`;
const ICON_FOLDER = `<svg class="fp-row__icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1 4a1 1 0 0 1 1-1h4l1.5 1.5H14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4z" fill="var(--accent)" opacity=".75" stroke="var(--accent-edge)" stroke-width="0.8"/></svg>`;

const EXT_IMG   = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.webp','.heic','.svg','.tiff']);
const EXT_TXT   = new Set(['.txt','.md','.csv','.log','.json','.xml','.yaml','.yml','.toml','.ini','.cfg','.html','.css','.js','.ts','.py','.rs','.go','.java','.c','.cpp','.h']);

function iconForExt(ext) {
  if (EXT_IMG.has(ext)) return ICON_IMG;
  if (EXT_TXT.has(ext)) return ICON_TXT;
  return ICON_FILE;
}

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

// ── Folder navigation via /fs/list (read-only) ────────────────────────────────
// Maintains a client-side history stack for back/forward.
const navHistory = { stack: [], idx: -1 };

async function loadDirectory(absPath) {
  const url = absPath
    ? `${API_BASE}/fs/list?path=${encodeURIComponent(absPath)}`
    : `${API_BASE}/fs/list/root`;

  let data;
  try {
    const r = await fetch(url, { headers: apiHeaders() });
    if (r.status === 403) {
      showErrorBanner(`Path is outside the sandbox: ${absPath}`);
      return;
    }
    if (r.status === 404) {
      showErrorBanner(`Folder not found: ${absPath}`);
      return;
    }
    if (!r.ok) {
      showErrorBanner(`Failed to load folder (HTTP ${r.status}).`);
      return;
    }
    data = await r.json();
  } catch (err) {
    showErrorBanner(`Couldn't reach backend: ${err.message}`);
    return;
  }

  renderDirectory(data);
  pushHistory(data.path);
  updateBreadcrumb(data.path);
  updateAddressBar(data.path);
  updateSidebarActive();
  syncActiveTabPath(data.path);
}

function pushHistory(path) {
  // If we navigated forward from a non-tail position, drop the forward stack.
  if (navHistory.idx < navHistory.stack.length - 1) {
    navHistory.stack = navHistory.stack.slice(0, navHistory.idx + 1);
  }
  if (navHistory.stack[navHistory.idx] !== path) {
    navHistory.stack.push(path);
    navHistory.idx = navHistory.stack.length - 1;
  }
  refreshNavButtons();
}

function navBack() {
  if (navHistory.idx <= 0) return;
  navHistory.idx -= 1;
  const path = navHistory.stack[navHistory.idx];
  fetchAndRender(path);
}

function navForward() {
  if (navHistory.idx >= navHistory.stack.length - 1) return;
  navHistory.idx += 1;
  const path = navHistory.stack[navHistory.idx];
  fetchAndRender(path);
}

function navUp() {
  const cur = navHistory.stack[navHistory.idx];
  if (!cur) return;
  // Compute parent: strip last path segment. Keep the drive-letter root intact.
  const parent = cur.replace(/[\\\/]+[^\\\/]+[\\\/]?$/, '') || cur;
  if (parent === cur) return; // Already at root.
  loadDirectory(parent);
}

async function fetchAndRender(path) {
  try {
    const r = await fetch(`${API_BASE}/fs/list?path=${encodeURIComponent(path)}`, { headers: apiHeaders() });
    if (!r.ok) {
      showErrorBanner(`Failed to load folder (HTTP ${r.status}).`);
      refreshNavButtons();
      return;
    }
    const data = await r.json();
    renderDirectory(data);
    updateBreadcrumb(data.path);
    updateAddressBar(data.path);
    updateSidebarActive();
    syncActiveTabPath(data.path);
  } catch (err) {
    showErrorBanner(`Couldn't reach backend: ${err.message}`);
  }
  refreshNavButtons();
}

function refreshNavButtons() {
  const back = document.querySelector('[data-action="nav-back"]');
  const fwd  = document.querySelector('[data-action="nav-forward"]');
  const up   = document.querySelector('[data-action="nav-up"]');
  if (back) back.disabled = navHistory.idx <= 0;
  if (fwd)  fwd.disabled  = navHistory.idx >= navHistory.stack.length - 1;
  if (up) {
    const cur = navHistory.stack[navHistory.idx];
    if (!cur) {
      up.disabled = true;
    } else {
      // At sandbox root if stripping the last path segment returns the same string or empty
      const parent = cur.replace(/[\\\/]+[^\\\/]+[\\\/]?$/, '');
      up.disabled = !parent || parent === cur;
    }
  }
}

function renderDirectory(data) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  if (!data.entries || data.entries.length === 0) {
    listScroll.innerHTML = renderEmptyFolder();
    return;
  }

  listScroll.innerHTML = data.entries.map(entry => renderFsRow(entry, data.path)).join('');
}

function renderFsRow(entry, parentPath) {
  const childPath = parentPath.replace(/[\\\/]+$/, '') + '\\' + entry.name;
  const icon = entry.is_dir ? ICON_FOLDER : iconForExt(entry.ext);
  const sizeText = entry.is_dir ? '—' : formatSize(entry.size);
  const modifiedText = formatModified(entry.modified * 1000);
  return `<div class="fp-row${entry.is_dir ? ' fp-row--folder' : ''}" role="option"
            data-path="${escapeHtml(childPath)}"
            data-type="${entry.is_dir ? 'folder' : 'file'}">
    ${icon}
    <span class="fp-row__name">${escapeHtml(entry.name)}</span>
    <span class="fp-row__size mono">${sizeText}</span>
    <span class="fp-row__modified mono">${modifiedText}</span>
    <div class="fp-row__tags"></div>
  </div>`;
}

function renderEmptyFolder() {
  return `<div class="fp-empty-state" role="status" aria-live="polite">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
    </svg>
    <h3 class="t-title-sm">This folder is empty</h3>
    <p class="t-body" style="color: var(--text-secondary)">Drop files here or right-click to create new ones.</p>
  </div>`;
}

function updateAddressBar(path) {
  const addressEl = document.getElementById('address-bar-text') || document.querySelector('.fp-address-bar__text');
  if (addressEl) addressEl.textContent = path;
}

function updateBreadcrumb(path) {
  const crumb = document.getElementById('breadcrumb');
  if (!crumb) return;
  // Split on \ or /, drop empties. First part is drive letter (e.g. "C:") — keep with backslash for nav.
  const parts = path.split(/[\\\/]+/).filter(Boolean);
  let cumulative = '';
  const html = parts.map((part, i) => {
    cumulative = i === 0 ? part + '\\' : cumulative + part + '\\';
    const isLast = i === parts.length - 1;
    const cls = isLast ? 'fp-breadcrumb__crumb fp-breadcrumb__crumb--current' : 'fp-breadcrumb__crumb';
    return `<button class="${cls}" data-action="navigate-crumb" data-path="${escapeHtml(cumulative)}">${escapeHtml(part)}</button>`;
  }).join('<span class="fp-breadcrumb__sep">·</span>');
  crumb.innerHTML = html;
}

function showErrorBanner(message) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  listScroll.innerHTML = `<div class="fp-error-banner" role="alert">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span class="fp-body" style="color: var(--text-primary)">${escapeHtml(message)}</span>
  </div>`;
}

async function triggerScan(path) {
  const body = path ? JSON.stringify({ path }) : '{}';
  showToast('Scanning…', 'default');
  try {
    const res = await fetch(`${API_BASE}/scan`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showSnackbar(`Scan complete — ${data.count} file${data.count !== 1 ? 's' : ''} indexed`);
    switchScreen('browser', pathBaseName(data.path) || undefined);
    await loadDirectory(data.path);
  } catch (err) {
    showToast(`Scan failed: ${err.message}`, 'error');
  }
}

// ── Backend health ─────────────────────��──────────────────────���───────────────
async function checkBackend() {
  const el = document.getElementById('status-backend');
  if (!el) return;
  const dot = el.querySelector('.fp-statusbar__backend-dot');
  const label = el.querySelector('.fp-statusbar__backend-label');
  try {
    const res = await fetch(`${API_BASE}/health`, { headers: apiHeaders(), signal: AbortSignal.timeout(2000) });
    el.dataset.state = res.ok ? 'ok' : 'error';
    if (label) label.textContent = res.ok ? 'Backend' : 'Backend error';
    return res.ok;
  } catch (_) {
    el.dataset.state = 'offline';
    if (label) label.textContent = 'Backend offline';
    return false;
  }
}

// ── Resizer (inspector drag handle) ────────────────────��───────────────────────
function initResizer() {
  const resizer   = document.getElementById('resizer');
  const listPane  = document.getElementById('list-pane');
  const inspector = document.getElementById('inspector');
  if (!resizer || !listPane || !inspector) return;

  let startX, startW;
  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = inspector.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = ev => {
      const delta = startX - ev.clientX;
      const newW  = Math.max(280, Math.min(520, startW + delta));
      inspector.style.width = `${newW}px`;
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

// ── Window controls (Electron IPC) ────────────────────────���───────────────────
function initWindowControls() {
  const api = window.electronAPI;
  if (!api) return;
  document.getElementById('btn-minimize')?.addEventListener('click', () => api.minimize?.());
  document.getElementById('btn-maximize')?.addEventListener('click', () => api.maximize?.());
  document.getElementById('btn-close')?.addEventListener('click', () => api.close?.());
}

// ── Home > Recent/Favorites: prune empty sections + toggle empty states ───────
// Each .home-section in Recent renders only when it has at least one
// .fp-row--recent. Order is preserved (Today → Yesterday → This week →
// Earlier this month → Older); the first non-empty group naturally lands at
// the top. Additionally, .fp-empty-state[data-empty-for="recent"|"favorites"]
// elements toggle visible iff their pane has zero .fp-row--recent rows.
function pruneEmptyHomeSections() {
  document.querySelectorAll('.home-pane[data-pane="recent"] .home-section').forEach(s => {
    s.style.display = s.querySelector('.fp-row--recent') ? '' : 'none';
  });
  document.querySelectorAll('.fp-empty-state.home-pane__empty[data-empty-for]').forEach(es => {
    const key  = es.dataset.emptyFor;
    const pane = document.querySelector(`.home-pane[data-pane="${key}"]`);
    const empty = !!pane && !pane.querySelector('.fp-row--recent');
    es.style.display = empty ? '' : 'none';
  });
}

// ── Underline tab indicator (sub-tabs within screens) ─────────────��──────────
function initUnderlineTabs(container) {
  if (!container) return;
  const tabs     = container.querySelectorAll('.fp-tabs__item');
  const indicator = container.querySelector('.fp-tabs__indicator');
  function setActive(tab) {
    tabs.forEach(t => t.classList.toggle('fp-tabs__item--active', t === tab));
    if (indicator && tab) {
      indicator.style.left  = `${tab.offsetLeft}px`;
      indicator.style.width = `${tab.offsetWidth}px`;
    }
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
  'toggle-sidebar', 'toggle-inspector', 'toggle-theme', 'set-view-mode',
  'focus-search', 'filter-by-tag', 'open-tag-canvas', 'close-tag-canvas',
  'tag-canvas-select',
  'nav-back', 'nav-forward', 'nav-up', 'navigate-crumb',
  'open-review-bin',
  'switch-inspector-tab',
  'unfavorite-file', 'open-recent-file',
  'open-palette', 'close-palette', 'palette-set-mode',
  'modal-cancel', 'modal-confirm', 'modal-confirm-type',
  'ef-filter', 'ef-sort', 'ef-toggle-pause-ai', 'ef-toggle-moving-card',
  'scan-config-switch-mode', 'scan-baseline-confirm',
  'settings-nav', 'settings-set-theme', 'settings-set-density', 'settings-set-accent',
  'settings-set-accent-hex', 'settings-reset-accent',
  'settings-set-show-notifications',
  'settings-set-font-scale', 'settings-reset-shortcuts',
  'zoom-reset',
]);

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'navigate-screen':
      switchScreen(btn.dataset.screen || btn.dataset.target);
      break;
    case 'navigate-path': {
      const navPath = btn.dataset.path;
      // Mark the clicked item as visually active immediately (don't wait for fetch).
      // Set data-manual-active so updateSidebarActive() won't override it until a real path loads.
      document.querySelectorAll('.fp-sidebar__item').forEach(it => {
        it.classList.remove('fp-sidebar__item--active');
        it.removeAttribute('data-manual-active');
      });
      btn.classList.add('fp-sidebar__item--active');
      btn.setAttribute('data-manual-active', 'true');
      // Pre-seed history stack to prevent switchScreen's auto-load from racing with our explicit load.
      if (navPath && navHistory.stack.length === 0) navHistory.stack.push(null);
      // Pre-set the tab label to the sidebar item's text (e.g. "Downloads",
      // "Projects") or the path's basename — so the tab never flashes "Files"
      // before the async loadDirectory() call lands.
      const sidebarLabelEl = btn.querySelector('.fp-sidebar__item__label');
      const initialLabel = (sidebarLabelEl?.textContent || '').trim()
                        || pathBaseName(navPath || '')
                        || undefined;
      switchScreen('browser', initialLabel);
      if (navPath) loadDirectory(navPath);
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
    case 'switch-tab':
      // User explicitly clicked a tab — activate THAT tab specifically.
      switchToTab(btn);
      break;
    case 'close-tab': {
      e.stopPropagation();
      // The X button is a child of a .fp-tab — close THAT tab, not whichever
      // happens to be active.
      const targetTab = btn.closest('.fp-tab');
      if (targetTab) closeTab(targetTab);
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
    case 'set-view-mode':
      setViewMode(btn.dataset.view);
      break;
    case 'focus-search':
      openPalette();
      break;
    case 'filter-by-tag':
      switchScreen('browser');
      // INTEGRATION: apply tag filter
      break;
    case 'open-tag-canvas':
      openTagCanvas();
      break;
    case 'close-tag-canvas':
      closeTagCanvas();
      break;
    case 'tag-canvas-select':
      // INTEGRATION: highlight tag in canvas, filter file grid
      break;
    case 'palette-set-mode':
      setPaletteMode(btn.dataset.mode || 'search');
      break;
    case 'modal-cancel':
      closeModal();
      break;
    case 'modal-confirm':
      closeModal();
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
      break;
    case 'settings-set-theme':
      applyTheme(btn.dataset.theme || btn.dataset.val);
      break;
    case 'settings-set-density':
      applyDensity(btn.dataset.density || btn.dataset.val);
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
    case 'switch-inspector-tab': {
      const inspector = document.getElementById('inspector');
      inspector?.querySelectorAll('.fp-inspector__tab').forEach(t => {
        t.classList.toggle('fp-tabs__item--active', t === btn);
      });
      inspector?.querySelectorAll('.fp-inspector__pane').forEach(p => {
        p.style.display = p.dataset.pane === btn.dataset.tab ? '' : 'none';
      });
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
    applyAccentHex(t.value);
  }
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t && t.dataset && t.dataset.action === 'settings-set-show-notifications') {
    setNotificationsEnabled(t.checked);
  }
});

function setNotificationsEnabled(enabled) {
  localStorage.setItem('fp-notifications-enabled', enabled ? 'on' : 'off');
  const checkbox = document.getElementById('settings-show-notifications');
  if (checkbox) checkbox.checked = !!enabled;
}

// ── Tab management (A.1.2) ────────────────────────────────────────────────────
let _closedTabs = []; // stack of { screen, label, icon }
let _tabIdSeq   = 1;  // unique id generator (HTML seeds the first tab as tab-1)

function nextTabId() {
  _tabIdSeq += 1;
  return `tab-${_tabIdSeq}`;
}

function buildTabHtml(screen) {
  // Close affordance is a <span role="button"> — see HTML for the seed tab
  // for why nesting <button> would silently break the layout.
  return `${getScreenIcon(screen)}<span class="fp-tab__label">${getScreenLabel(screen)}</span><span class="fp-tab__close" role="button" data-action="close-tab" title="Close tab" tabindex="-1" aria-label="Close tab"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>`;
}

function createTabElement(screen) {
  const btn = document.createElement('button');
  btn.className = 'fp-tab';
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', 'false');
  btn.setAttribute('data-tab-id', nextTabId());
  btn.setAttribute('data-tab-screen', screen);
  btn.setAttribute('data-action', 'switch-tab');
  btn.setAttribute('title', getScreenLabel(screen));
  btn.setAttribute('draggable', 'true');
  btn.innerHTML = buildTabHtml(screen);
  return btn;
}

function openNewTab() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  const newBtn = createTabElement('home');
  const newTabBtn = document.getElementById('btn-new-tab');
  tabbar.insertBefore(newBtn, newTabBtn);
  initTabDrag(newBtn);
  switchToTab(newBtn);
  showSnackbar('New tab opened', null, null);
}

function closeTab(tab) {
  if (!tab) return;
  _closedTabs.push({
    screen: tab.dataset.tabScreen,
    label:  tab.querySelector('.fp-tab__label')?.textContent,
    icon:   tab.querySelector(':scope > svg')?.outerHTML,
  });
  const tabbar = document.getElementById('tabbar');
  const allTabs = tabbar?.querySelectorAll('.fp-tab') || [];
  // Last remaining tab → quit the app entirely (per spec: closing the only
  // tab closes the window).
  if (allTabs.length <= 1) {
    if (window.electronAPI?.close) {
      window.electronAPI.close();
    } else {
      window.close();
    }
    return;
  }
  const wasActive = tab.classList.contains('fp-tab--active');
  const prev = tab.previousElementSibling;
  const next = tab.nextElementSibling;
  const neighbor = (prev && prev.classList.contains('fp-tab')) ? prev
                 : (next && next.classList.contains('fp-tab')) ? next : null;
  tab.remove();
  if (wasActive && neighbor) switchToTab(neighbor);
  showSnackbar('Tab closed · Ctrl+Shift+T to reopen', null, null);
}

// Backwards compat — keyboard shortcut(s) call this name.
function closeCurrentTab() { closeTab(getActiveTab()); }

function reopenLastTab() {
  if (!_closedTabs.length) { showToast('No recently closed tabs', 'warn'); return; }
  const last = _closedTabs.pop();
  const screen = last.screen || 'home';
  const newBtn = createTabElement(screen);
  // Use the closed tab's saved label/icon if they differed from the screen default.
  if (last.label) {
    const labelEl = newBtn.querySelector('.fp-tab__label');
    if (labelEl) labelEl.textContent = last.label;
    newBtn.setAttribute('title', last.label);
  }
  if (last.icon) {
    const firstSvg = newBtn.querySelector(':scope > svg');
    if (firstSvg) firstSvg.outerHTML = last.icon;
  }
  const tabbar = document.getElementById('tabbar');
  const newTabBtn = document.getElementById('btn-new-tab');
  tabbar?.insertBefore(newBtn, newTabBtn);
  initTabDrag(newBtn);
  switchToTab(newBtn);
}

// Tab drag-reorder (A.1.2)
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
  }
  if (e.altKey && e.key === 'ArrowLeft')  { e.preventDefault(); /* nav back stub */ }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); /* nav forward stub */ }
  if (e.altKey && e.key === 'ArrowUp')    { e.preventDefault(); /* nav up stub */ }
});

// Ctrl + scroll wheel — step through ZOOM_STEPS, one step per gesture.
// Throttled because trackpads (and high-resolution wheels) emit dozens of
// wheel events per swipe; without a cooldown a single flick would jump
// straight to the min/max zoom. ~80ms matches the natural pacing of one
// "notch" of a physical wheel without making intentional fast scrolls
// feel sluggish.
{
  let lastWheelAt = 0;
  const COOLDOWN_MS = 80;
  document.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); // suppress the default page-scroll while zooming
    const now = performance.now();
    if (now - lastWheelAt < COOLDOWN_MS) return;
    lastWheelAt = now;
    if (e.deltaY < 0)      zoomIn();
    else if (e.deltaY > 0) zoomOut();
  }, { passive: false });
}

// ── Context menu event listener (A.10) ────────────────────────────────────────
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  const type = getMenuTypeForTarget(e.target);
  const items = CONTEXT_MENUS[type] || CONTEXT_MENUS.file;
  showContextMenu(e.clientX, e.clientY, items);
});

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restore theme from localStorage
  const savedTheme = localStorage.getItem('fp-theme');
  if (THEME_MODES.includes(savedTheme)) document.documentElement.dataset.theme = resolveTheme(savedTheme);

  initWindowControls();
  initResizer();
  initSidebarResize();
  restoreSidebarState();
  initToolbarResponsive();
  checkBackend();
  const _backendPollId = setInterval(checkBackend, 30_000);
  window.addEventListener('beforeunload', () => clearInterval(_backendPollId), { once: true });

  // NOTE: sidebar-collapse and theme-toggle are wired via data-action delegation
  // (see the click switch above). Direct addEventListener calls were removed
  // because they fired in addition to the delegated handler, causing each click
  // to toggle twice (visible no-op).

  // View mode via segmented control (new)
  document.querySelectorAll('.fp-segmented__opt[data-view]').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  });

  // Palette — open when search focused
  searchInput?.addEventListener('focus', e => { e.preventDefault(); openPalette(); });

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

  // Palette item clicks
  document.querySelectorAll('.fp-palette__item, .palette__item').forEach(btn => {
    btn.addEventListener('click', () => handlePaletteAction(btn));
  });

  // Init tab drag-reorder for existing tabs (A.1.2)
  document.querySelectorAll('.fp-tab[draggable]').forEach(initTabDrag);

  // Sidebar device name — load saved name or fall back to OS hostname
  initDeviceName();

  // Sync the status-bar zoom pill with Electron's persisted zoom factor
  updateZoomPill();

  // Init column sort cycling and marquee selection (A.3.1)
  initColumnSort();
  initMarqueeSelection();

  // Restore saved view mode
  const savedView = sessionStorage.getItem('fp-view-mode');
  if (savedView) setViewMode(savedView);

  // Init underline tabs in any pre-existing tab containers
  document.querySelectorAll('.fp-tabs').forEach(initUnderlineTabs);

  // Hide empty Recent home-sections — first non-empty group becomes the
  // top header. INTEGRATION: re-run after /recent updates row markup.
  pruneEmptyHomeSections();

  // Restore persisted settings (theme, density, accent, font scale)
  restoreSettings();

  // Always start on Home — the previous "restore last active screen"
  // behaviour landed users on whatever they last visited (often Browser),
  // which was disorienting on cold start. Tabs preserve their own state
  // through `switchToTab()`; this only sets the initial paint.
  switchScreen('home');

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

  // Crash recovery check on startup
  // INTEGRATION: on app init, call GET /crash-recovery → if crash_detected → uncomment + show #crash-modal-scrim

  // Delegated file row click — works for both static and dynamically rendered rows
  document.getElementById('list-scroll')?.addEventListener('click', e => {
    const row = e.target.closest('.fp-row');
    if (!row) return;
    // Folder click → navigate into it (read-only).
    if (row.dataset.type === 'folder' && row.dataset.path) {
      loadDirectory(row.dataset.path);
      return;
    }
    const listScroll = document.getElementById('list-scroll');
    listScroll?.querySelectorAll('.fp-row').forEach(r => {
      r.classList.remove('fp-row--selected');
      r.removeAttribute('aria-selected');
    });
    row.classList.add('fp-row--selected');
    row.setAttribute('aria-selected', 'true');
    const name = row.querySelector('.fp-row__name')?.textContent;
    const path = row.dataset.path;
    updateInspector('single', { name, path });
    const statusSel = document.getElementById('status-selected');
    if (statusSel) statusSel.textContent = name ? `"${name}" selected` : 'Nothing selected';
  });
});
