/**
 * FilePlus browser screen: folder navigation via /fs/list, directory list
 * rendering, view-mode/column-sort/marquee-selection UI, the selection model
 * + keyboard navigation, and the small formatting helpers (icons, size,
 * modified date, HTML escaping) the row renderer needs. Navigation history
 * (navHistory) stays in app.js — it is also read by the sidebar active-state
 * and dispatch code there.
 */

// ── Browser state ─────────────────────────────────────────────────────────────
// The last-loaded directory listing. `parent`/`isRoot` come straight from the
// /fs/list response so navUp() and the up-button never need to re-derive a
// parent by string-slicing the path. `showHidden` is seeded from
// config['ui.show_hidden'] by app.js's init sequence, before the first load.
// `sort` persists per session (sessionStorage['fp-sort']). `selection` is the
// set of absolute paths currently selected; `anchor` is the shift-range
// origin, `focus` is the last row acted on (keyboard/click).
const browserState = {
  path: null,
  entries: [],
  sort: readSavedSort(),
  selection: new Set(),
  anchor: null,
  focus: null,
  showHidden: false,
  parent: null,
  isRoot: false,
  truncated: false,
};

/** Reads a validated {key, dir} sort spec from sessionStorage, defaulting to name/asc. */
function readSavedSort() {
  try {
    const raw = sessionStorage.getItem('fp-sort');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && ['name', 'size', 'modified'].includes(parsed.key) && (parsed.dir === 'asc' || parsed.dir === 'desc')) {
        return { key: parsed.key, dir: parsed.dir };
      }
    }
  } catch (_) { /* corrupt/missing — fall through to default */ }
  return { key: 'name', dir: 'asc' };
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

/** Sets the active sort, persists it, and re-renders the current directory. */
function applySort(key, dir) {
  browserState.sort = { key, dir };
  try { sessionStorage.setItem('fp-sort', JSON.stringify(browserState.sort)); } catch (_) { /* storage unavailable */ }
  updateSortHeaderUI();
  renderDirectory();
}

/**
 * Returns browserState.entries sorted for display: folders always precede
 * files (regardless of direction), then each group is ordered by the active
 * sort key — name (natural, case-insensitive), size, or modified (numeric).
 */
function sortedEntries() {
  const { key, dir } = browserState.sort;
  const sign = dir === 'desc' ? -1 : 1;
  return [...browserState.entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    let cmp;
    if (key === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
    else if (key === 'modified') cmp = (a.modified ?? 0) - (b.modified ?? 0);
    else cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
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

/** Joins a parent directory path and a child name into an absolute path. */
function joinPath(parentPath, name) {
  return parentPath.replace(/[\\\/]+$/, '') + '\\' + name;
}

async function loadDirectory(absPath, opts = {}) {
  const { addToHistory = true, preserveSelection = false } = opts;
  let data;
  try {
    data = absPath
      ? await API.get('/fs/list', { path: absPath, show_hidden: browserState.showHidden })
      : await API.get('/fs/list/root');
  } catch (err) {
    handleLoadError(err, absPath);
    return;
  }

  const prevSelection = preserveSelection ? new Set(browserState.selection) : null;
  const prevAnchor    = preserveSelection ? browserState.anchor : null;
  const prevFocus      = preserveSelection ? browserState.focus : null;

  browserState.path = data.path;
  browserState.entries = data.entries;
  browserState.parent = data.parent;
  browserState.isRoot = data.is_root;

  if (preserveSelection && prevSelection) {
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
  if (addToHistory) pushHistory(data.path);
  else refreshNavButtons();
  updateBreadcrumb(data.path);
  updateAddressBar(data.path);
  updateSidebarActive();
  syncActiveTabPath(data.path);
  onSelectionChanged();
}

/** Re-fetches the current directory, keeping selection/anchor/focus where the paths still exist. */
function refreshDirectory() {
  if (!browserState.path) return;
  loadDirectory(browserState.path, { addToHistory: false, preserveSelection: true });
}

function handleLoadError(err, absPath) {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      showErrorBanner(`Access denied: ${absPath}`, { actionLabel: 'Go back', actionName: 'nav-retreat' });
      return;
    }
    if (err.status === 404) {
      showErrorBanner('Folder not found');
      return;
    }
    if (err.status === 400) {
      showErrorBanner('Invalid path');
      return;
    }
    showErrorBanner(formatApiError(err));
    return;
  }
  showErrorBanner(`Couldn't reach backend: ${formatApiError(err)}`);
}

// Re-display the last successfully loaded directory — used by the "Go back"
// action on the access-denied banner. The failed path was never pushed onto
// navHistory, so this is a reload of the current head, not a stack pop.
function retreatFromError() {
  if (browserState.path) loadDirectory(browserState.path, { addToHistory: false });
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
  loadDirectory(navHistory.stack[navHistory.idx], { addToHistory: false });
}

function navForward() {
  if (navHistory.idx >= navHistory.stack.length - 1) return;
  navHistory.idx += 1;
  loadDirectory(navHistory.stack[navHistory.idx], { addToHistory: false });
}

function navUp() {
  if (browserState.isRoot || !browserState.parent) return;
  loadDirectory(browserState.parent);
}

function refreshNavButtons() {
  const back = document.querySelector('[data-action="nav-back"]');
  const fwd  = document.querySelector('[data-action="nav-forward"]');
  const up   = document.querySelector('[data-action="nav-up"]');
  if (back) back.disabled = navHistory.idx <= 0;
  if (fwd)  fwd.disabled  = navHistory.idx >= navHistory.stack.length - 1;
  if (up)   up.disabled   = !browserState.path || browserState.isRoot || !browserState.parent;
}

function renderDirectory(data) {
  if (data) browserState.truncated = !!data.truncated;
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  const truncatedHtml = browserState.truncated ? renderTruncatedBanner() : '';

  if (!browserState.entries || browserState.entries.length === 0) {
    listScroll.innerHTML = truncatedHtml + renderEmptyFolder();
    updateStatusBar();
    return;
  }

  listScroll.innerHTML = truncatedHtml + sortedEntries().map(entry => renderFsRow(entry, browserState.path)).join('');
  applySelectionState();
  updateStatusBar();
}

function renderTruncatedBanner() {
  return `<div class="fp-error-banner fp-error-banner--info" role="status">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
    <span class="fp-body" style="color: var(--text-primary)">Showing the first 10,000 entries</span>
  </div>`;
}

function renderFsRow(entry, parentPath) {
  const childPath = joinPath(parentPath, entry.name);
  const icon = entry.is_dir ? ICON_FOLDER : iconForExt(entry.ext);
  const sizeText = (entry.is_dir || entry.error) ? '—' : formatSize(entry.size);
  const modifiedText = entry.error ? '—' : formatModified(entry.modified * 1000);
  const rowClass = `fp-row${entry.is_dir ? ' fp-row--folder' : ''}${entry.error ? ' fp-row--disabled' : ''}`;
  const titleAttr = entry.error ? ' title="Access denied"' : '';
  return `<div class="${rowClass}" role="option"
            data-path="${escapeHtml(childPath)}"
            data-type="${entry.is_dir ? 'folder' : 'file'}" tabindex="-1"${titleAttr}>
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

function showErrorBanner(message, opts = {}) {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;
  const actionHtml = opts.actionLabel
    ? `<button class="fp-error-banner__action fp-btn fp-btn--ghost" data-action="${escapeHtml(opts.actionName || 'nav-back')}">${escapeHtml(opts.actionLabel)}</button>`
    : '';
  listScroll.innerHTML = `<div class="fp-error-banner" role="alert">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <span class="fp-body" style="color: var(--text-primary)">${escapeHtml(message)}</span>
    ${actionHtml}
  </div>`;
}

// ── Selection model (Task 3) ─────────────────────────────────────────────────

/** Returns the current selection as an array of absolute paths. */
function getSelectedPaths() { return [...browserState.selection]; }

/** Looks up the entry object for an absolute path in the current directory, or null. */
function entryForPath(path) {
  if (!browserState.path) return null;
  return browserState.entries.find(e => joinPath(browserState.path, e.name) === path) || null;
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
  const order = sortedEntries().map(e => joinPath(browserState.path, e.name));

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
  const order = sortedEntries().map(e => joinPath(browserState.path, e.name));
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
  const order = sortedEntries().map(e => joinPath(browserState.path, e.name));
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

/** Opens a directory entry: folder navigates into it, file opens via the OS. */
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

/**
 * Hook called whenever the selection changes. Task 3 wires it to the status
 * bar and a minimal inspector call; Task 5 replaces the inspector calls with
 * the real metadata/preview fetches, keeping this function name.
 */
function onSelectionChanged() {
  const n = browserState.selection.size;
  if (n === 0) {
    updateInspector('none');
  } else if (n === 1) {
    const path = [...browserState.selection][0];
    const entry = entryForPath(path);
    const name = entry ? entry.name : path.split(/[\\\/]/).filter(Boolean).pop();
    updateInspector('single', { name, path });
  } else {
    updateInspector('multi', { count: n, totalSize: formatSize(selectionTotalSize()) });
  }
  updateStatusBar();
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
  if (countEl) countEl.textContent = `${browserState.entries.length} items`;
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
  const key = e.key;

  if (e.altKey) {
    if (key === 'ArrowUp')         { e.preventDefault(); navUp(); }
    else if (key === 'ArrowLeft')  { e.preventDefault(); navBack(); }
    else if (key === 'ArrowRight') { e.preventDefault(); navForward(); }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAll();
    return;
  }

  switch (key) {
    case 'ArrowDown': e.preventDefault(); moveFocus(1, { shift: e.shiftKey }); break;
    case 'ArrowUp':   e.preventDefault(); moveFocus(-1, { shift: e.shiftKey }); break;
    case 'Home':      e.preventDefault(); moveFocus('home', { shift: e.shiftKey }); break;
    case 'End':       e.preventDefault(); moveFocus('end', { shift: e.shiftKey }); break;
    case 'Enter':     e.preventDefault(); openFocused(); break;
    case 'Backspace': e.preventDefault(); navUp(); break;
    case 'F5':        e.preventDefault(); refreshDirectory(); break;
    default: break;
  }
}
