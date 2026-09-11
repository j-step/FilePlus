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

/** Returns the parent folder of an absolute path (string-only; no filesystem
 * lookup) — used by "Open in new tab" on a file row, which may belong to a
 * directory that isn't the currently loaded one (e.g. a Home/Recent row). */
function parentOfPath(p) {
  const norm = String(p || '').replace(/[\\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('\\'), norm.lastIndexOf('/'));
  return idx > 0 ? norm.slice(0, idx) : norm;
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

/** Re-fetches the current directory, keeping selection/anchor/focus where the paths still exist.
 * Returns loadDirectory's promise so callers (fileops.run(), inline rename) can await the
 * re-render actually landing before touching the DOM again. */
function refreshDirectory() {
  if (!browserState.path) return;
  return loadDirectory(browserState.path, { addToHistory: false, preserveSelection: true });
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
  return `<div class="${rowClass}" role="option" draggable="true"
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

// ── Drag and drop (Task 4) ─────────────────────────────────────────────────────
// Rows are drag SOURCES (dragstart, set in renderFsRow via draggable="true");
// folder rows, sidebar drives/pins/Downloads, and breadcrumb crumbs are drop
// TARGETS. The MIME type carries the whole selection as JSON so a drag of a
// multi-selection moves/copies every selected item, not just the row that
// was physically dragged.
const FP_DRAG_MIME = 'application/x-fileplus-paths';

// The dragged selection, tracked separately from dataTransfer: per the HTML5
// DnD spec, dataTransfer.getData() only returns real data during the 'drop'
// event — during 'dragover'/'dragenter' it reads back empty for security
// reasons, even within the same page. dragover needs to know what's being
// dragged (to skip highlighting an invalid target), so dragstart mirrors the
// paths here too; dragend clears it.
let _draggingPaths = [];

/** Why `destDir` is not a valid drop target for `paths`, or null if it's fine.
 *  'self'       — destDir is (case-insensitively) one of the dragged paths
 *  'current'    — destDir is the directory already open
 *  'descendant' — destDir is nested inside one of the dragged folders */
function dropViolation(destDir, paths) {
  if (!destDir || !paths || !paths.length) return 'self';
  const norm = p => String(p).replace(/[\\\/]+$/, '').toLowerCase();
  const destLower = norm(destDir);
  if (paths.some(p => norm(p) === destLower)) return 'self';
  if (destLower === norm(browserState.path || '')) return 'current';
  if (paths.some(p => destLower.startsWith(norm(p) + '\\'))) return 'descendant';
  return null;
}

/** Shared drop handler for every drop target (folder rows, sidebar items,
 * breadcrumb crumbs). */
function handleFsDrop(e, destDir) {
  let paths;
  try { paths = JSON.parse(e.dataTransfer.getData(FP_DRAG_MIME) || '[]'); }
  catch (_) { paths = []; }
  const violation = dropViolation(destDir, paths);
  if (violation === 'descendant') { showToast('Cannot move a folder into itself', 'error'); return; }
  if (violation) return; // 'self' (dropped onto a dragged item) / 'current' (the open folder) — silent no-op
  fileops.moveTo(paths, destDir, e.ctrlKey);
}

/** Shared dragover handler. A 'self'/'current' violation is not a drop
 * target at all — skip preventDefault() entirely so the browser shows its
 * native "not allowed" cursor and 'drop' never fires (nothing to refuse; a
 * dragged item never paints as its own drop target). A 'descendant'
 * violation DOES need preventDefault() — 'drop' must still fire so
 * handleFsDrop can refuse it with the "Cannot move a folder into itself"
 * toast — but it's never highlighted, matching the "not highlighted" rule
 * for a target that will just bounce. */
function dragOverTarget(e, el, destDir, dragTargetClass) {
  const violation = dropViolation(destDir, _draggingPaths);
  if (violation === 'self' || violation === 'current') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
  if (!violation) el.classList.add(dragTargetClass);
}

function initRowDragDrop() {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  listScroll.addEventListener('dragstart', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) { e.preventDefault(); return; }
    if (!browserState.selection.has(row.dataset.path)) selectRow(row.dataset.path, {});
    const paths = getSelectedPaths();
    _draggingPaths = paths;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(FP_DRAG_MIME, JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
  });
  listScroll.addEventListener('dragend', () => { _draggingPaths = []; });

  listScroll.addEventListener('dragover', e => {
    const row = e.target.closest('.fp-row[data-type="folder"][data-path]');
    if (!row) return;
    dragOverTarget(e, row, row.dataset.path, 'fp-row--drag-target');
  });
  listScroll.addEventListener('dragleave', e => {
    const row = e.target.closest('.fp-row[data-type="folder"][data-path]');
    if (row && !row.contains(e.relatedTarget)) row.classList.remove('fp-row--drag-target');
  });
  listScroll.addEventListener('drop', e => {
    const row = e.target.closest('.fp-row[data-type="folder"][data-path]');
    if (!row) return;
    e.preventDefault();
    row.classList.remove('fp-row--drag-target');
    handleFsDrop(e, row.dataset.path);
  });
}

function initSidebarDragDrop() {
  const sidebarEl = document.getElementById('sidebar');
  if (!sidebarEl) return;

  sidebarEl.addEventListener('dragover', e => {
    const item = e.target.closest('.fp-sidebar__item[data-path]');
    if (!item) return;
    dragOverTarget(e, item, item.dataset.path, 'fp-sidebar__item--drag-target');
  });
  sidebarEl.addEventListener('dragleave', e => {
    const item = e.target.closest('.fp-sidebar__item[data-path]');
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('fp-sidebar__item--drag-target');
  });
  sidebarEl.addEventListener('drop', e => {
    const item = e.target.closest('.fp-sidebar__item[data-path]');
    if (!item) return;
    e.preventDefault();
    item.classList.remove('fp-sidebar__item--drag-target');
    handleFsDrop(e, item.dataset.path);
  });
}

function initBreadcrumbDragDrop() {
  const crumb = document.getElementById('breadcrumb');
  if (!crumb) return;

  crumb.addEventListener('dragover', e => {
    const btn = e.target.closest('.fp-breadcrumb__crumb[data-path]');
    if (!btn) return;
    dragOverTarget(e, btn, btn.dataset.path, 'fp-breadcrumb__crumb--drag-target');
  });
  crumb.addEventListener('dragleave', e => {
    const btn = e.target.closest('.fp-breadcrumb__crumb[data-path]');
    if (btn && !btn.contains(e.relatedTarget)) btn.classList.remove('fp-breadcrumb__crumb--drag-target');
  });
  crumb.addEventListener('drop', e => {
    const btn = e.target.closest('.fp-breadcrumb__crumb[data-path]');
    if (!btn) return;
    e.preventDefault();
    btn.classList.remove('fp-breadcrumb__crumb--drag-target');
    handleFsDrop(e, btn.dataset.path);
  });
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
  updateStatusBar();
  clearTimeout(_inspectorDebounceTimer);
  _inspectorDebounceTimer = setTimeout(() => {
    const n = browserState.selection.size;
    if (n === 0) {
      _inspectorSeq++; // invalidate any fetch still in flight from the prior selection
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
  // Never act on Browser shortcuts while a modal or the command palette has
  // focus/visibility — e.g. Ctrl+Z while a paste-conflict modal is open must
  // not also undo the last file op behind it, and typing in the palette
  // search box must not trigger F2/Delete/etc.
  const modalScrim = document.getElementById('modal-scrim');
  const paletteOpen = paletteScrim && paletteScrim.style.display !== 'none';
  if ((modalScrim && modalScrim.style.display !== 'none') || paletteOpen) return;

  const key = e.key;
  const ctrl = e.ctrlKey || e.metaKey;

  if (e.altKey) {
    if (key === 'ArrowUp')         { e.preventDefault(); navUp(); }
    else if (key === 'ArrowLeft')  { e.preventDefault(); navBack(); }
    else if (key === 'ArrowRight') { e.preventDefault(); navForward(); }
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
  if (ctrl && key.toLowerCase() === 'v') { e.preventDefault(); if (browserState.path) fileops.pasteInto(browserState.path); return; }
  if (key === 'F2') { e.preventDefault(); if (browserState.focus) startInlineRename(browserState.focus); return; }
  if (key === 'Delete') { e.preventDefault(); fileops.trashSelection(); return; }

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
