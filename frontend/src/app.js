// ── DOM references ─────────────────────��────────────────────────────────────
const shell              = document.getElementById('shell');
const sidebar            = document.getElementById('sidebar');
const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse');
const paletteScrim       = document.getElementById('palette-scrim');
const paletteInput       = document.getElementById('palette-input');
const searchInput        = document.getElementById('search-input');

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
  home:    icon('home', 'fp-icon--14'),
  browser: icon('folder', 'fp-icon--14'),
};
const DEFAULT_TAB_ICON = icon('file', 'fp-icon--14');

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
  // Replace the leading SVG icon (first child) with the screen's icon.
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
  if (id === 'browser' && navHistory.stack.length === 0) {
    loadDirectory(null);
  }
  if (id === 'home') {
    loadRecent();
    loadFavorites();
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

// Shared by the 'navigate-path' dispatch case and the sidebar pin's "Open in
// new tab" context-menu action: pre-seed navHistory before switching to the
// browser screen, so showScreenDom's automatic loadDirectory(null) (sandbox
// root, fired when navHistory.stack is still empty) can never race this
// call's own explicit loadDirectory(path) for a real target path. Extracted
// so the guard can't be forgotten by a future third caller.
function openBrowserAt(path, label) {
  if (path && navHistory.stack.length === 0) navHistory.stack.push(null);
  switchScreen('browser', label);
  if (path) return loadDirectory(path);
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
  clearTimeout(_paletteSearchTimer);
  _paletteSearchSeq++; // invalidate any in-flight search response
}

// ── Palette search mode (A.11.1 / Task 6) ─────────────────────────────────
// Below the 2-char threshold (including empty), the static Commands group is
// shown and search results are cleared. At 2+ chars, input is debounced
// 150ms then GET /search?q=&limit=30 fires; results replace the Commands
// group until the query drops back below the threshold.
// Palette result icons come from the same iconFor() the file list uses, so a
// hit reads as the same kind of thing in both places (and follows the
// FilePlus/Windows icon-source setting). Built per result rather than hoisted
// into a constant: the file icon depends on the hit's own extension.
const paletteFileIcon = (hit) => iconFor({ name: hit.filename, path: hit.path, ext: extOfPath(hit.filename), is_dir: false }, 14, 'fp-palette__item-icon');
const paletteFolderIcon = (dirPath) => iconFor({ name: pathBaseName(dirPath), path: dirPath, is_dir: true }, 14, 'fp-palette__item-icon');

/** '.txt' for 'notes.txt', '' for an extension-less name (matches the `ext`
 * a /fs/list entry carries, which is what fpFamilyFor() expects). */
function extOfPath(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot > 0 ? String(name).slice(dot) : '';
}
const PALETTE_MIN_CHARS = 2;
const PALETTE_DEBOUNCE_MS = 150;
let _paletteSearchTimer = null;
let _paletteSearchSeq = 0;

/** Every visible (not display:none-ancestor'd), non-disabled palette item —
 * whichever group (Commands or search results) is currently shown. */
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
  clearTimeout(_paletteSearchTimer);
  _paletteSearchSeq++; // invalidate any in-flight search response
  const resultsEl = document.getElementById('palette-search-results');
  const commandsEl = document.getElementById('palette-commands');
  if (resultsEl) resultsEl.innerHTML = '';
  if (commandsEl) commandsEl.style.display = '';
  paletteSelectFirst();
}

async function runPaletteSearch(q) {
  const seq = ++_paletteSearchSeq;
  const resultsEl = document.getElementById('palette-search-results');
  if (!resultsEl) return;
  let hits = [];
  try {
    const res = await API.get('/search', { q, limit: 30 });
    hits = Array.isArray(res) ? res : (res && res.results) || []; // Stage 2C Task 2 wraps the response in {results, indexed_roots}; Task 14 replaces this call entirely
  } catch (err) {
    hits = [];
  }
  if (seq !== _paletteSearchSeq) return; // a newer query has since superseded this response

  if (!hits || hits.length === 0) {
    resultsEl.innerHTML = `<button class="fp-palette__item" role="option" disabled aria-disabled="true">
      <span>No matches in the index — index folders from the sidebar (right-click a folder → Index for search)</span>
    </button>`;
    return;
  }

  const fileItems = hits.map(hit => `
    <button class="fp-palette__item" role="option" data-action="palette-open-file" data-path="${escapeHtml(hit.path)}">
      ${paletteFileIcon(hit)}
      <span>${escapeHtml(hit.filename)}</span>
      <span class="fp-palette__item-meta fp-mono">${escapeHtml(parentOfPath(hit.path))}</span>
    </button>`).join('');

  // One folder item per distinct parent of the first 5 hits.
  const seenParents = new Set();
  const folderItems = [];
  for (const hit of hits.slice(0, 5)) {
    const parent = parentOfPath(hit.path);
    if (seenParents.has(parent)) continue;
    seenParents.add(parent);
    folderItems.push(`
      <button class="fp-palette__item" role="option" data-action="palette-open-folder" data-path="${escapeHtml(parent)}">
        ${paletteFolderIcon(parent)}
        <span>Open folder ${escapeHtml(pathBaseName(parent))}</span>
        <span class="fp-palette__item-meta fp-mono">${escapeHtml(parent)}</span>
      </button>`);
  }

  resultsEl.innerHTML = `<div class="fp-palette__section">Files</div>${fileItems}`
    + (folderItems.length ? `<div class="fp-palette__section">Folders</div>${folderItems.join('')}` : '');
  paletteSelectFirst();
}

paletteInput?.addEventListener('input', () => {
  const q = paletteInput.value.trim();
  clearTimeout(_paletteSearchTimer);
  if (q.length < PALETTE_MIN_CHARS) {
    paletteResetToCommands();
    return;
  }
  const commandsEl = document.getElementById('palette-commands');
  if (commandsEl) commandsEl.style.display = 'none';
  _paletteSearchTimer = setTimeout(() => runPaletteSearch(q), PALETTE_DEBOUNCE_MS);
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

function toggleTheme() {
  const current = localStorage.getItem('fp-theme') || 'system';
  const next = THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
  applyTheme(next);
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
    { label: 'Open',            action: 'cm-open',            icon: icon('open', 'fp-icon--14') },
    { label: 'Open with…',      action: 'cm-open-with' },
    { label: 'Open in new tab', action: 'cm-open-new-tab',    icon: icon('new-tab', 'fp-icon--14') },
    'sep',
    { label: 'Cut',    action: 'cm-cut',    kbd: 'Ctrl+X' },
    { label: 'Copy',   action: 'cm-copy',   kbd: 'Ctrl+C' },
    { label: 'Paste',  action: 'cm-paste',  kbd: 'Ctrl+V' },
    { label: 'Rename', action: 'cm-rename', kbd: 'F2' },
    { label: 'Delete', action: 'cm-delete', kbd: 'Del', danger: true, icon: icon('delete', 'fp-icon--14') },
    'sep',
    { label: 'Add tag…',         action: 'cm-add-tag',     icon: icon('tag', 'fp-icon--14') },
    { label: 'Add to Favorites', action: 'cm-favorite' },
    'sep',
    { label: 'Properties',             action: 'cm-properties' },
    { label: 'Show in Windows Explorer', action: 'cm-reveal-explorer' },
  ],

  // A.10.2 — Folder context menu
  folder: [
    { label: 'Open',             action: 'cm-open', icon: icon('folder', 'fp-icon--14') },
    { label: 'Open in new tab',  action: 'cm-open-new-tab' },
    'sep',
    { label: 'Cut',    action: 'cm-cut',    kbd: 'Ctrl+X' },
    { label: 'Copy',   action: 'cm-copy',   kbd: 'Ctrl+C' },
    { label: 'Paste',  action: 'cm-paste',  kbd: 'Ctrl+V' },
    { label: 'Rename', action: 'cm-rename', kbd: 'F2' },
    { label: 'Delete', action: 'cm-delete', kbd: 'Del', danger: true, icon: icon('delete', 'fp-icon--14') },
    'sep',
    { label: 'New folder inside', action: 'cm-new-folder' },
    { label: 'New file',          action: 'cm-new-file' },
    'sep',
    { label: 'Add to Favorites',   action: 'cm-favorite' },
    { label: 'Pin to sidebar',     action: 'cm-pin-sidebar' },
    { label: 'Index for search',   action: 'cm-index-folder' },
    'sep',
    { label: 'Properties',              action: 'cm-properties' },
    { label: 'Show in Windows Explorer', action: 'cm-reveal-explorer' },
  ],

  // A.10.3 — Empty area context menu
  'empty-area': [
    { label: 'New folder', action: 'cm-new-folder', icon: icon('folder-add', 'fp-icon--14') },
    { label: 'New file',   action: 'cm-new-file' },
    { label: 'Paste',      action: 'cm-paste',      kbd: 'Ctrl+V' },
    { label: 'Refresh',    action: 'cm-refresh',    kbd: 'F5' },
    'sep',
    { label: 'View → List',       action: 'cm-view-list' },
    { label: 'View → Grid',       action: 'cm-view-grid' },
    { label: 'Sort by → name',    action: 'cm-sort-name' },
    { label: 'Sort by → modified', action: 'cm-sort-modified' },
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

  // A.10.5 — Sidebar item context menu (pinned folders only — see getMenuTypeForTarget)
  'sidebar-item': [
    { label: 'Open in new tab',    action: 'cm-open-new-tab' },
    { label: 'Unpin',              action: 'cm-unpin-sidebar' },
    { label: 'Rename label',       action: 'cm-rename-sidebar-item' },
  ],

  // A.10.6 — Home row context menu (Recent + Favorites rows). "Add/Remove
  // from Favorites" label is set dynamically at contextmenu time (see the
  // listener below) based on home.js's favoritesSet.
  'home-row': [
    { label: 'Open',               action: 'open-file' },
    { label: 'Reveal in Browser',  action: 'reveal-file' },
    { label: 'Copy path',          action: 'copy-path' },
    'sep',
    { label: 'Add to Favorites',   action: 'home-toggle-favorite' },
  ],
};

function getMenuTypeForTarget(target) {
  if (target.closest('.fp-tab')) return 'tab';
  // Only user pins carry data-pin-id — Home/Downloads/drives are not pins
  // and fall through to the empty-area menu instead.
  if (target.closest('.fp-sidebar__item[data-pin-id]')) return 'sidebar-item';
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

// ── Folder navigation via /fs/list (read-only) ────────────────────────────────
// Maintains a client-side history stack for back/forward.
const navHistory = { stack: [], idx: -1 };

async function triggerScan(path) {
  showToast('Scanning…', 'default');
  try {
    const data = await API.post('/scan', path ? { path } : {}, { signal: AbortSignal.timeout(60000) });
    showSnackbar(`Scan complete — ${data.count} file${data.count !== 1 ? 's' : ''} indexed`);
    switchScreen('browser', pathBaseName(data.path) || undefined);
    await loadDirectory(data.path);
  } catch (err) {
    showToast(`Scan failed: ${formatApiError(err)}`, 'error');
  }
}

// ── Backend health ─────────────────────��──────────────────────���───────────────
async function checkBackend() {
  const el = document.getElementById('status-backend');
  if (!el) return;
  const dot = el.querySelector('.fp-statusbar__backend-dot');
  const label = el.querySelector('.fp-statusbar__backend-label');
  try {
    const data = await API.get('/health', null, { signal: AbortSignal.timeout(2000) });
    el.dataset.state = 'ok';
    if (label) label.textContent = 'Backend';
    window.__fpHealth = data; // read by settings.js's Data-pane "Writes" line
    setWriteLockHint(data.write_unlocked === false);
    if (typeof updateWritesStatusLine === 'function') updateWritesStatusLine();
    return true;
  } catch (err) {
    // ApiError means the backend answered but with a non-2xx status; any
    // other rejection (network error, the 2s AbortSignal firing) means it
    // didn't answer at all.
    if (err instanceof ApiError) {
      el.dataset.state = 'error';
      if (label) label.textContent = 'Backend error';
    } else {
      el.dataset.state = 'offline';
      if (label) label.textContent = 'Backend offline';
    }
    return false;
  }
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
    driveList = await API.get('/drives');
  } catch (err) {
    console.warn('[fp-drives] failed to load drives:', formatApiError(err));
    return;
  }
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
    pinList = await API.get('/pins');
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

// Downloads' data-path is resolved once at startup: config['paths.downloads']
// when the user configured one, else the real OS Downloads folder (main.js's
// get-home-dir bridge), never the old hardcoded sandbox-relative guess.
function applyDownloadsPath() {
  const el = document.getElementById('nav-downloads');
  if (!el) return;
  const configured = window.__fpConfig && window.__fpConfig['paths.downloads'];
  const home = window.electronAPI?.homeDir?.();
  const path = configured || (home ? `${home}\\Downloads` : null);
  if (path) el.dataset.path = path;
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
  'palette-open-file', 'palette-open-folder',
  'open-palette', 'close-palette', 'palette-set-mode',
  'modal-cancel', 'modal-confirm', 'modal-confirm-type',
  'ef-filter', 'ef-sort', 'ef-toggle-pause-ai', 'ef-toggle-moving-card',
  'scan-config-switch-mode', 'scan-baseline-confirm',
  'settings-nav', 'settings-set-theme', 'settings-set-density', 'settings-set-accent',
  'settings-set-accent-hex', 'settings-reset-accent',
  'settings-set-show-notifications', 'settings-toggle', 'settings-set-click-mode',
  'settings-set-icon-source',
  'settings-empty-trash',
  'settings-set-font-scale', 'settings-reset-shortcuts',
  'zoom-reset',
  // File operations (Task 4) — context-menu actions wired in the switch below.
  'cm-open', 'cm-open-with', 'cm-reveal-explorer',
  'cm-cut', 'cm-copy', 'cm-paste', 'cm-paste-here', 'cm-rename', 'cm-delete',
  'cm-new-folder', 'cm-new-file', 'cm-refresh',
  'cm-favorite', 'cm-pin-sidebar', 'cm-index-folder', 'cm-properties', 'cm-toggle-hidden',
  'cm-view-list', 'cm-view-grid', 'cm-sort-name', 'cm-sort-modified',
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
  inspector.querySelectorAll('.fp-inspector__pane').forEach(p => {
    p.style.display = p.dataset.pane === name ? '' : 'none';
  });
}

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
      // Pre-set the tab label to the sidebar item's text (e.g. "Downloads",
      // "Projects") or the path's basename — so the tab never flashes "Files"
      // before the async loadDirectory() call lands.
      const sidebarLabelEl = btn.querySelector('.fp-sidebar__item__label');
      const initialLabel = (sidebarLabelEl?.textContent || '').trim()
                        || pathBaseName(navPath || '')
                        || undefined;
      openBrowserAt(navPath, initialLabel);
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
      const loaded = openBrowserAt(parent, pathBaseName(parent) || undefined);
      Promise.resolve(loaded).then(() => selectRow(path));
      break;
    }
    case 'palette-open-folder': {
      const path = btn.dataset.path;
      if (!path) break;
      closePalette();
      openBrowserAt(path, pathBaseName(path) || undefined);
      break;
    }
    // Tab context menu (A.10.4) — only new-tab/close-tab are built; duplicate/
    // pin/rename/close-other-tabs have no underlying tab-state support yet
    // and fall through to the stub toast below (see scripts/check_menu_cases.js).
    case 'cm-new-tab':
      openNewTab();
      break;
    case 'cm-close-tab': {
      const tab = contextMenuTarget?.closest ? contextMenuTarget.closest('.fp-tab') : null;
      if (tab) closeTab(tab);
      break;
    }
    // Sidebar pinned-item context menu (A.10.5). These are only reachable
    // through the 'sidebar-item' menu type (see getMenuTypeForTarget), which
    // is raised solely for elements with data-pin-id — so any other menu
    // (file/folder/tab/empty-area) still falls through to the stub below.
    case 'cm-open-new-tab': {
      if (contextMenuType === 'sidebar-item' && contextMenuTarget) {
        const pinPath = contextMenuTarget.dataset.path;
        if (pinPath) {
          const labelEl = contextMenuTarget.querySelector('.fp-sidebar__item__label');
          const label = (labelEl?.textContent || '').trim() || pathBaseName(pinPath) || undefined;
          openNewTab();
          openBrowserAt(pinPath, label);
        }
      } else if (contextMenuType === 'file' || contextMenuType === 'folder') {
        // Folder → open that folder; file → open its parent folder.
        const path = contextTargetPath();
        if (path) {
          const targetDir = contextMenuType === 'folder' ? path : parentOfPath(path);
          openNewTab();
          openBrowserAt(targetDir, pathBaseName(targetDir) || undefined);
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
    // ── File operations context-menu wiring (Task 4) ─────────────────────────
    case 'cm-open': {
      const path = contextTargetPath();
      if (!path) break;
      if (contextMenuType === 'folder') { loadDirectory(path); break; }
      const openPath = window.electronAPI?.openPath;
      if (openPath) {
        Promise.resolve(openPath(path)).then(result => { if (result) showToast(result, 'error'); })
          .catch(err => showToast(formatApiError(err), 'error'));
      }
      API.post('/recent', { path, action: 'opened' }).catch(() => { /* best-effort logging */ });
      break;
    }
    case 'cm-open-with': {
      const path = contextTargetPath();
      if (path) window.electronAPI?.openWith?.(path);
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
      fileops.pasteInto(contextTargetDir());
      break;
    case 'cm-rename': {
      const path = contextTargetPath();
      if (path && typeof startInlineRename === 'function') startInlineRename(path);
      break;
    }
    case 'cm-delete':
      fileops.trashSelection();
      break;
    case 'cm-new-folder':
      fileops.newFolder(contextTargetDir());
      break;
    case 'cm-new-file':
      fileops.newFile(contextTargetDir());
      break;
    case 'cm-refresh':
      refreshDirectory();
      break;
    case 'cm-favorite': {
      const path = contextTargetPath();
      if (!path) break;
      API.post('/favorites', { path })
        .then(() => showToast('Added to Favorites', 'default'))
        .catch(err => showToast(`Failed to favorite: ${formatApiError(err)}`, 'error'));
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
      if (!path) break;
      API.get('/file', { path })
        .then(data => {
          const rows = [
            ['Kind', data.kind || '—'],
            ['Size', data.size != null ? formatSize(data.size) : '—'],
            ['Modified', data.modified ? formatModified(data.modified) : '—'],
            ['Created', data.created ? formatModified(data.created) : '—'],
            ['Hash', data.hash || '—'],
            ['Path', data.path || path],
          ];
          openModal('warn', {
            title: pathBaseName(path) || 'Properties',
            body: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
            confirmLabel: 'Close',
          });
        })
        .catch(err => showToast(`Failed to load properties: ${formatApiError(err)}`, 'error'));
      break;
    }
    case 'cm-toggle-hidden': {
      const next = !browserState.showHidden;
      browserState.showHidden = next;
      refreshDirectory();
      saveSetting('ui.show_hidden', next);
      break;
    }
    case 'cm-view-list':
      setViewMode('list');
      break;
    case 'cm-view-grid':
      setViewMode('grid');
      break;
    case 'cm-sort-name':
      applySort('name', (browserState.sort.key === 'name' && browserState.sort.dir === 'asc') ? 'desc' : 'asc');
      break;
    case 'cm-sort-modified':
      applySort('modified', (browserState.sort.key === 'modified' && browserState.sort.dir === 'asc') ? 'desc' : 'asc');
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
  return `${getScreenIcon(screen)}<span class="fp-tab__label">${getScreenLabel(screen)}</span><span class="fp-tab__close" role="button" data-action="close-tab" title="Close tab" tabindex="-1" aria-label="Close tab">${icon('close', 'fp-icon--10')}</span>`;
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
  // Browser-screen keyboard nav (selection, sort-order arrows, Enter, F5,
  // Ctrl+A, Alt+arrows) only applies when that screen is active and the
  // user isn't typing into an input/textarea/contenteditable element.
  const activeEl = document.activeElement;
  const activeTag = activeEl && activeEl.tagName;
  const isEditableTarget = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (activeEl && activeEl.isContentEditable);
  const browserScreenActive = document.getElementById('screen-browser')?.classList.contains('active');
  if (browserScreenActive && !isEditableTarget && typeof browserKeydown === 'function') {
    browserKeydown(e);
  }
  const homeScreenActive = document.getElementById('screen-home')?.classList.contains('active');
  if (homeScreenActive && !isEditableTarget && typeof homeKeydown === 'function') {
    homeKeydown(e);
  }
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
  contextMenuType = getMenuTypeForTarget(e.target);
  contextMenuTarget = contextMenuType === 'sidebar-item' ? e.target.closest('.fp-sidebar__item[data-pin-id]') : e.target;
  // Right-click on a row that isn't already selected selects it alone before
  // the menu opens; right-click within an existing multi-selection leaves it
  // untouched so batch actions (Task 4) apply to the whole selection.
  if (contextMenuType === 'file' || contextMenuType === 'folder') {
    const row = e.target.closest('.fp-row[data-path]');
    if (row && typeof ensureRowSelected === 'function') ensureRowSelected(row.dataset.path);
  }
  let items = CONTEXT_MENUS[contextMenuType] || CONTEXT_MENUS.file;

  // Home row menu: select the row (mirrors the plain-click select+inspect
  // behavior) and relabel the favorite toggle to reflect current membership.
  if (contextMenuType === 'home-row') {
    const row = e.target.closest('.fp-row[data-path]');
    if (row) {
      const pane = row.closest('.home-pane');
      pane?.querySelectorAll('.fp-row--selected').forEach(r => { if (r !== row) r.classList.remove('fp-row--selected'); });
      row.classList.add('fp-row--selected');
      const isFav = typeof favoritesSet !== 'undefined' && favoritesSet.has(row.dataset.path);
      items = items.map(i => (i !== 'sep' && i.action === 'home-toggle-favorite')
        ? { ...i, label: isFav ? 'Remove from Favorites' : 'Add to Favorites' }
        : i);
    }
  }

  // Empty-area menu's "Show hidden files" reflects current state.
  if (contextMenuType === 'empty-area') {
    items = items.map(i => (i !== 'sep' && i.action === 'cm-toggle-hidden')
      ? { ...i, label: browserState.showHidden ? 'Hide hidden files' : 'Show hidden files' }
      : i);
  }

  showContextMenu(e.clientX, e.clientY, items);
});

// ── Init ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Idempotent belt-and-braces: icons.js already installs the sprite
  // synchronously at parse time (see its own DOMContentLoaded fallback for
  // the case this script somehow ran before <body> existed); calling again
  // here is a guaranteed no-op unless that path was somehow skipped.
  fpInstallSprite();

  // Restore theme from localStorage
  const savedTheme = localStorage.getItem('fp-theme');
  if (THEME_MODES.includes(savedTheme)) document.documentElement.dataset.theme = resolveTheme(savedTheme);

  initWindowControls();
  initResizer();
  initInspectorTagInput();
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

  // Init column sort cycling, marquee selection, and row click/dblclick (A.3.1, Task 3)
  initColumnSort();
  initMarqueeSelection();
  initRowInteractions();

  // Drag and drop: rows onto folder rows / sidebar items / breadcrumb crumbs (Task 4)
  initRowDragDrop();
  initSidebarDragDrop();
  initBreadcrumbDragDrop();

  // Home: double-click to open (Task 6) + Favorites drag-to-reorder
  initHomeRowInteractions();
  initFavoritesDragDrop();

  // Restore saved view mode
  const savedView = sessionStorage.getItem('fp-view-mode');
  if (savedView) setViewMode(savedView);

  // Init underline tabs in any pre-existing tab containers
  document.querySelectorAll('.fp-tabs').forEach(initUnderlineTabs);

  // Restore persisted settings (theme, density, accent, font scale)
  restoreSettings();

  // Load the config cache, then everything that reads from it — Downloads'
  // real path and the show-hidden default — followed by the sidebar's live
  // drives/pins. Sequenced (not Promise.all'd) per the plan's init order;
  // each step degrades to a harmless no-op on backend failure.
  await loadConfig();
  applySettingsFromConfig();
  applyDownloadsPath();
  await loadDrives();
  await loadPins();
  await checkCrashRecovery();

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
  try { rows = await API.get('/operations/pending'); } catch (_) { return; }
  if (!rows || !rows.length) return;
  const body = rows.map(r => `${r.op_type}: ${r.source_path || '—'} → ${r.dest_path || '—'} (${r.resolution || 'unresolved'})`).join('\n');
  openModal('warn', { title: 'Recovered operations', body, confirmLabel: 'OK' });
}
