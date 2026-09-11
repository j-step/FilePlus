/**
 * FilePlus browser screen: folder navigation via /fs/list, directory list
 * rendering, view-mode/column-sort/marquee-selection UI, and the small
 * formatting helpers (icons, size, modified date, HTML escaping) the row
 * renderer needs. Navigation history (navHistory) stays in app.js — it is
 * also read by the sidebar active-state and dispatch code there.
 */

// ── Browser state ─────────────────────────────────────────────────────────────
// The last-loaded directory listing. `parent`/`isRoot` come straight from the
// /fs/list response so navUp() and the up-button never need to re-derive a
// parent by string-slicing the path. `showHidden` is seeded from
// config['ui.show_hidden'] by app.js's init sequence, before the first load.
const browserState = { path: null, entries: [], parent: null, isRoot: false, showHidden: false };

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

async function loadDirectory(absPath, opts = {}) {
  const { addToHistory = true } = opts;
  let data;
  try {
    data = absPath
      ? await API.get('/fs/list', { path: absPath, show_hidden: browserState.showHidden })
      : await API.get('/fs/list/root');
  } catch (err) {
    handleLoadError(err, absPath);
    return;
  }

  browserState.path = data.path;
  browserState.entries = data.entries;
  browserState.parent = data.parent;
  browserState.isRoot = data.is_root;

  renderDirectory(data);
  if (addToHistory) pushHistory(data.path);
  else refreshNavButtons();
  updateBreadcrumb(data.path);
  updateAddressBar(data.path);
  updateSidebarActive();
  syncActiveTabPath(data.path);
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
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  const truncatedHtml = data.truncated ? renderTruncatedBanner() : '';

  if (!data.entries || data.entries.length === 0) {
    listScroll.innerHTML = truncatedHtml + renderEmptyFolder();
    return;
  }

  listScroll.innerHTML = truncatedHtml + data.entries.map(entry => renderFsRow(entry, data.path)).join('');
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
  const childPath = parentPath.replace(/[\\\/]+$/, '') + '\\' + entry.name;
  const icon = entry.is_dir ? ICON_FOLDER : iconForExt(entry.ext);
  const sizeText = entry.is_dir ? '—' : formatSize(entry.size);
  const modifiedText = entry.error ? '—' : formatModified(entry.modified * 1000);
  const rowClass = `fp-row${entry.is_dir ? ' fp-row--folder' : ''}${entry.error ? ' fp-row--disabled' : ''}`;
  const titleAttr = entry.error ? ' title="Access denied"' : '';
  return `<div class="${rowClass}" role="option"
            data-path="${escapeHtml(childPath)}"
            data-type="${entry.is_dir ? 'folder' : 'file'}"${titleAttr}>
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
