const API_BASE = 'http://127.0.0.1:9876';

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

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${id}`);
  if (target) target.classList.add('active');

  // Stub-toast for screens whose backend wiring isn't complete
  if (STUB_SCREENS[id] && typeof showToast === 'function') {
    showToast(STUB_SCREENS[id], 'accent');
  }

  // Update tab bar active state
  document.querySelectorAll('.fp-tab[data-tab-screen]').forEach(tab => {
    tab.classList.toggle('fp-tab--active', tab.dataset.tabScreen === id);
    tab.setAttribute('aria-selected', tab.dataset.tabScreen === id ? 'true' : 'false');
  });

  // When entering the Browser screen, load the sandbox root if we haven't already.
  if (id === 'browser' && navHistory.stack.length === 0) {
    loadDirectory(null); // null → calls /fs/list/root
  }

  // Store in session for persistence
  sessionStorage.setItem('fp-active-screen', id);

  // Coherent sidebar active state (screen-based for non-browser; path-based for browser)
  updateSidebarActive();
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

  // 1. Clear every item (both class names, for safety).
  items.forEach(it => {
    it.classList.remove('fp-sidebar__item--active');
    it.classList.remove('active');
  });

  const screen = sessionStorage.getItem('fp-active-screen') || 'home';

  if (screen !== 'browser') {
    // Screen-based: highlight the item whose data-screen matches AND has no data-path.
    items.forEach(it => {
      if (it.dataset.screen === screen && !it.dataset.path) {
        it.classList.add('fp-sidebar__item--active');
      }
    });
    return;
  }

  // Browser screen: highlight the path-bound item that is the longest prefix of currentPath.
  const currentPath = (navHistory.stack[navHistory.idx] || '').toLowerCase();
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
const SIDEBAR_COLLAPSED_THRESHOLD = 110; // px below this → snap to collapsed
const SIDEBAR_EXPANDED_DEFAULT    = 240;
const SIDEBAR_COLLAPSED_WIDTH     = 52;

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
    const w = (saved && saved >= 180 && saved <= 480) ? saved : SIDEBAR_EXPANDED_DEFAULT;
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
  let startX   = 0;
  let startWidth = 0;

  handle.addEventListener('pointerdown', e => {
    dragging = true;
    handle.classList.add('fp-sidebar__resize-handle--active');
    sidebar.classList.add('fp-sidebar--dragging');
    shell.classList.add('sidebar-dragging');
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const newWidth = Math.max(40, Math.min(480, startWidth + dx));
    document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
    // Live snap visual hint
    if (newWidth < SIDEBAR_COLLAPSED_THRESHOLD) {
      sidebar.classList.add('fp-sidebar--collapsing-preview');
    } else {
      sidebar.classList.remove('fp-sidebar--collapsing-preview');
    }
  });

  handle.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('fp-sidebar__resize-handle--active');
    sidebar.classList.remove('fp-sidebar--dragging', 'fp-sidebar--collapsing-preview');
    shell.classList.remove('sidebar-dragging');
    const finalWidth = sidebar.getBoundingClientRect().width;
    if (finalWidth < SIDEBAR_COLLAPSED_THRESHOLD) {
      setSidebarCollapsed(true);
    } else {
      localStorage.setItem('fp-sidebar-width', String(Math.round(finalWidth)));
      setSidebarCollapsed(false); // picks up the saved width
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

// ── Responsive toolbar search ─────────────────────────────────────────────────
function initToolbarResponsive() {
  const toolbar     = document.querySelector('.fp-toolbar');
  const breadcrumb  = document.getElementById('breadcrumb');
  const searchWrap  = document.getElementById('search-wrap');
  if (!toolbar || !breadcrumb || !searchWrap) return;

  function recalc() {
    // Reset to natural state to measure
    searchWrap.classList.remove('fp-toolbar__search--narrow', 'fp-toolbar__search--icon');
    breadcrumb.classList.remove('fp-breadcrumb--scroll');
    // Force layout flush
    void breadcrumb.offsetWidth;
    const breadcrumbScroll = breadcrumb.scrollWidth;
    const breadcrumbClient = breadcrumb.clientWidth;
    if (breadcrumbScroll > breadcrumbClient) {
      // Step 1: shrink search to narrow
      searchWrap.classList.add('fp-toolbar__search--narrow');
      void breadcrumb.offsetWidth;
      if (breadcrumb.scrollWidth > breadcrumb.clientWidth) {
        // Step 2: collapse search to icon
        searchWrap.classList.remove('fp-toolbar__search--narrow');
        searchWrap.classList.add('fp-toolbar__search--icon');
        void breadcrumb.offsetWidth;
        if (breadcrumb.scrollWidth > breadcrumb.clientWidth) {
          // Step 3: scroll breadcrumb (left side falls off)
          breadcrumb.classList.add('fp-breadcrumb--scroll');
          // Scroll to the end so the rightmost (current) segment stays visible
          breadcrumb.scrollLeft = breadcrumb.scrollWidth;
        }
      }
    }
  }

  const ro = new ResizeObserver(recalc);
  ro.observe(toolbar);

  const mo = new MutationObserver(recalc);
  mo.observe(breadcrumb, { childList: true, characterData: true, subtree: true });

  // Click on collapsed icon → expand and focus (capture phase so it beats focus-search → openPalette)
  searchWrap.addEventListener('click', e => {
    if (searchWrap.classList.contains('fp-toolbar__search--icon')) {
      e.preventDefault();
      e.stopPropagation();
      searchWrap.classList.remove('fp-toolbar__search--icon');
      const input = document.getElementById('search-input');
      if (input) setTimeout(() => input.focus(), 50);
    }
  }, true /* capture */);

  recalc();
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
function toggleTheme() {
  const html = document.documentElement;
  const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
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

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('fp-theme', theme);
  // Sync segmented controls in personalization pane
  document.querySelectorAll('[data-action="settings-set-theme"]').forEach(btn => {
    const v = btn.dataset.theme || btn.dataset.val;
    btn.classList.toggle('active', v === theme);
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
const DEFAULT_ACCENT = '#E8965E';

function isValidHex(s) {
  return typeof s === 'string' && HEX_RE.test(s.trim());
}

function applyAccentHex(rawHex) {
  const hex = (rawHex || '').trim();
  const errorEl = document.getElementById('settings-accent-error');
  if (!isValidHex(hex)) {
    if (errorEl) {
      errorEl.textContent = 'Enter a valid hex color (e.g. #E8965E or #abc).';
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

function applyAccentGlow(enabled) {
  if (enabled) {
    document.documentElement.setAttribute('data-accent-glow', 'on');
    localStorage.setItem('fp-accent-glow', 'on');
  } else {
    document.documentElement.removeAttribute('data-accent-glow');
    localStorage.setItem('fp-accent-glow', 'off');
  }
  const checkbox = document.getElementById('settings-accent-glow');
  if (checkbox) checkbox.checked = !!enabled;
}

function restoreSettings() {
  const theme = localStorage.getItem('fp-theme');
  if (theme) applyTheme(theme);
  const density = localStorage.getItem('fp-density');
  if (density) applyDensity(density);
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
      // Invalid (e.g., 'lavender' from pre-A4 sessions) — purge so default amber wins
      console.warn(`[fp-accent] Discarding invalid persisted value: ${savedAccent}`);
      localStorage.removeItem('fp-accent');
    }
  }
  const fontScale = localStorage.getItem('fp-font-scale');
  if (fontScale) document.documentElement.style.fontSize = fontScale + 'px';
  const savedGlow = localStorage.getItem('fp-accent-glow');
  if (savedGlow === 'on') applyAccentGlow(true);
}

// ── Zoom (font-scale based) ───────────────────────────────────────────────────
const ZOOM_STEPS  = [10, 11, 12, 13, 14, 15, 16, 18, 20];
const ZOOM_DEFAULT = 13;
function getCurrentZoom() {
  const raw = parseFloat(document.documentElement.style.fontSize) ||
              parseFloat(getComputedStyle(document.documentElement).fontSize) ||
              ZOOM_DEFAULT;
  return raw;
}
function zoomIn() {
  const cur = getCurrentZoom();
  const next = ZOOM_STEPS.find(s => s > cur) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
  document.documentElement.style.fontSize = next + 'px';
  localStorage.setItem('fp-font-scale', next);
}
function zoomOut() {
  const cur = getCurrentZoom();
  const prev = [...ZOOM_STEPS].reverse().find(s => s < cur) || ZOOM_STEPS[0];
  document.documentElement.style.fontSize = prev + 'px';
  localStorage.setItem('fp-font-scale', prev);
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
function showSnackbar(message, undoLabel, onUndo) {
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
    const r = await fetch(url);
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
    const r = await fetch(`${API_BASE}/fs/list?path=${encodeURIComponent(path)}`);
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
  } catch (err) {
    showErrorBanner(`Couldn't reach backend: ${err.message}`);
  }
  refreshNavButtons();
}

function refreshNavButtons() {
  const back = document.querySelector('[data-action="nav-back"]');
  const fwd  = document.querySelector('[data-action="nav-forward"]');
  if (back) back.disabled = navHistory.idx <= 0;
  if (fwd)  fwd.disabled  = navHistory.idx >= navHistory.stack.length - 1;
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
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showSnackbar(`Scan complete — ${data.count} file${data.count !== 1 ? 's' : ''} indexed`);
    switchScreen('browser');
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
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
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
  // Initialise with first active tab
  const first = container.querySelector('.fp-tabs__item--active') || tabs[0];
  if (first) { setActive(first); }
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
  'switch-home-tab', 'switch-inspector-tab',
  'open-palette', 'close-palette', 'palette-set-mode',
  'modal-cancel', 'modal-confirm', 'modal-confirm-type',
  'ef-filter', 'ef-sort', 'ef-toggle-pause-ai', 'ef-toggle-moving-card',
  'scan-config-switch-mode', 'scan-baseline-confirm',
  'settings-nav', 'settings-set-theme', 'settings-set-density', 'settings-set-accent',
  'settings-set-accent-hex', 'settings-reset-accent', 'settings-set-accent-glow',
  'settings-set-font-scale', 'settings-reset-shortcuts',
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
      // Mark the clicked item as visually active immediately (don't wait for fetch)
      document.querySelectorAll('.fp-sidebar__item').forEach(it => {
        it.classList.remove('fp-sidebar__item--active');
      });
      btn.classList.add('fp-sidebar__item--active');
      // Pre-seed history stack to prevent switchScreen's auto-load from racing with our explicit load.
      if (navPath && navHistory.stack.length === 0) navHistory.stack.push(null);
      switchScreen('browser');
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
      switchScreen(btn.dataset.tabScreen);
      break;
    case 'close-tab':
      e.stopPropagation();
      closeCurrentTab();
      break;
    case 'new-tab':
      openNewTab();
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
        // INTEGRATION: onConfirm → POST /api/scan/start (after POST /api/snapshots/baseline)
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
      document.documentElement.style.fontSize = scale + 'px';
      localStorage.setItem('fp-font-scale', scale);
      break;
    }
    case 'settings-reset-shortcuts':
      // INTEGRATION: reset to default keybindings
      break;
    case 'switch-home-tab': {
      const container = btn.closest('.fp-tabs');
      if (container) {
        container.querySelectorAll('.fp-tabs__item').forEach(t => t.classList.remove('fp-tabs__item--active'));
        btn.classList.add('fp-tabs__item--active');
        const ind = container.querySelector('.fp-tabs__indicator');
        if (ind) { ind.style.left = `${btn.offsetLeft}px`; ind.style.width = `${btn.offsetWidth}px`; }
        const pane = btn.dataset.tab;
        document.querySelectorAll('.home-pane').forEach(p => {
          p.style.display = p.dataset.pane === pane ? 'flex' : 'none';
        });
      }
      break;
    }
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

// Accent glow toggle (change event, not click)
document.addEventListener('change', e => {
  const t = e.target;
  if (t && t.dataset && t.dataset.action === 'settings-set-accent-glow') {
    applyAccentGlow(t.checked);
  }
});

// ── Tab management (A.1.2) ────────────────────────────────────────────────────
let _closedTabs = []; // stack of { screen, label, icon }

function openNewTab() {
  const tabbar = document.getElementById('tabbar');
  if (!tabbar) return;
  const newBtn = document.createElement('button');
  newBtn.className = 'fp-tab';
  newBtn.setAttribute('role', 'tab');
  newBtn.setAttribute('aria-selected', 'false');
  newBtn.setAttribute('data-tab-screen', 'home');
  newBtn.setAttribute('data-action', 'switch-tab');
  newBtn.setAttribute('title', 'New tab');
  newBtn.setAttribute('draggable', 'true');
  newBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M1 6.5L7 1l6 5.5V13H9V9H5v4H1V6.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg><span class="fp-tab__label">Home</span><button class="fp-tab__close" data-action="close-tab" title="Close tab" tabindex="-1"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>`;
  // Insert before new-tab button
  const newTabBtn = document.getElementById('btn-new-tab');
  tabbar.insertBefore(newBtn, newTabBtn);
  initTabDrag(newBtn);
  newBtn.click();
  showSnackbar('New tab opened', null, null);
}

function closeCurrentTab() {
  const active = document.querySelector('.fp-tab--active');
  if (!active) return;
  _closedTabs.push({
    screen: active.dataset.tabScreen,
    label: active.querySelector('.fp-tab__label')?.textContent,
    icon: active.querySelector('svg')?.outerHTML,
  });
  const prev = active.previousElementSibling;
  const next = active.nextElementSibling;
  const neighbor = (prev && prev.classList.contains('fp-tab')) ? prev
                 : (next && next.classList.contains('fp-tab')) ? next : null;
  active.remove();
  if (neighbor) neighbor.click();
  showSnackbar('Tab closed · Ctrl+Shift+T to reopen', null, null);
}

function reopenLastTab() {
  if (!_closedTabs.length) { showToast('No recently closed tabs', 'warn'); return; }
  const tab = _closedTabs.pop();
  const newBtn = document.createElement('button');
  newBtn.className = 'fp-tab';
  newBtn.setAttribute('role', 'tab');
  newBtn.setAttribute('aria-selected', 'false');
  newBtn.setAttribute('data-tab-screen', tab.screen || 'home');
  newBtn.setAttribute('data-action', 'switch-tab');
  newBtn.setAttribute('title', tab.label || 'Tab');
  newBtn.setAttribute('draggable', 'true');
  newBtn.innerHTML = `${tab.icon || ''}<span class="fp-tab__label">${tab.label || 'Home'}</span><button class="fp-tab__close" data-action="close-tab" title="Close tab" tabindex="-1"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>`;
  const newTabBtn = document.getElementById('btn-new-tab');
  document.getElementById('tabbar')?.insertBefore(newBtn, newTabBtn);
  initTabDrag(newBtn);
  newBtn.click();
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
    // INTEGRATION: POST /api/ui/tabs with new order for persistence
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
  if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); document.documentElement.style.fontSize = ZOOM_DEFAULT + 'px'; localStorage.setItem('fp-font-scale', ZOOM_DEFAULT); }
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
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  initWindowControls();
  initResizer();
  initSidebarResize();
  restoreSidebarState();
  initToolbarResponsive();
  checkBackend();
  setInterval(checkBackend, 30_000);

  // Sidebar collapse button
  btnSidebarCollapse?.addEventListener('click', toggleSidebar);

  // Theme button
  document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);

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

  // Init column sort cycling and marquee selection (A.3.1)
  initColumnSort();
  initMarqueeSelection();

  // Restore saved view mode
  const savedView = sessionStorage.getItem('fp-view-mode');
  if (savedView) setViewMode(savedView);

  // Init underline tabs in any pre-existing tab containers
  document.querySelectorAll('.fp-tabs').forEach(initUnderlineTabs);

  // Restore persisted settings (theme, density, accent, font scale)
  restoreSettings();

  // Restore last active screen
  const last = sessionStorage.getItem('fp-active-screen') || 'home';
  switchScreen(last);

  // ── A.17 Edge case INTEGRATION stubs ──────────────────────────────────────
  // #2  External folder missing on navigation → show fp-error-banner "This folder no longer exists"
  //     INTEGRATION: catch 404/ENOENT from GET /api/ls?path=... → toggle .fp-error-banner in browser screen
  // #6  Files added to Everything Folder while tray is closed → update count badge on next open
  //     INTEGRATION: GET /api/ef/count on tray show event → update #tray-rb-badge
  // #8  Drop file onto sidebar folder → accept drag event, call POST /api/move (requires approval)
  //     INTEGRATION: sidebar items need dragover + drop listeners → openModal('move', {src, dest})
  // #9  Inspector opened on a file that has been deleted externally → show preview fail state
  //     INTEGRATION: GET /api/file/preview?path=... → on 404 show commented preview-fail HTML
  // #12 Scan starts while one is already running → show toast "Scan already in progress"
  //     INTEGRATION: POST /api/scan/start → if 409 response → showToast('Scan already running', 'warn')
  // #13 Ollama model not downloaded when classification starts → show error banner with install CTA
  //     INTEGRATION: GET /api/ai/status → if model_status !== 'ready' → show #banner-ai-offline

  // Crash recovery check on startup
  // INTEGRATION: on app init, call GET /api/crash-recovery → if crash_detected → uncomment + show #crash-modal-scrim

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
