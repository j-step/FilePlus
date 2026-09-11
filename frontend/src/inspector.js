/**
 * FilePlus inspector panel: single/multi-selection detail view (real
 * metadata, preview, tags, history-with-undo), its tab switching, the
 * open/close toggle, and the drag-to-resize handle.
 */

// ── Selection → inspector data fetch guard ───────────────────────────────────
// Arrow-key navigation and marquee drags can change the selection many times
// a second; onSelectionChanged() debounces 120ms before calling into this
// file. _inspectorSeq is bumped by every entry point (showInspectorFor,
// showInspectorMulti, the empty-selection path) so an in-flight fetch from a
// selection that's since been superseded never overwrites the DOM with
// stale data — each async function captures its own seq and re-checks it
// after every await before touching anything.
let _inspectorSeq = 0;

// Currently-inspected file's DB id (null for folders, which can't be
// tagged) and the path History is showing, so the tag/undo handlers below
// (invoked later, from a click) know what they're acting on.
let _inspectorFileId = null;
let _inspectorHistoryPath = null;

// Revoked before a new one replaces it so blob: URLs don't leak.
let _inspectorPreviewUrl = null;

// ── Inspector update (A.3.2) — pane swap + header text only; data fetching
// and per-field rendering live in showInspectorFor/showInspectorMulti below.
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
      if (sizeEl)  sizeEl.textContent  = data.totalSize || '—';
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

// ── Single selection ──────────────────────────────────────────────────────────
// Fetches GET /file (metadata + tags), GET /preview (image/text/binary), and
// GET /files/history for `path`, rendering each into the inspector panes as
// it lands. Called by browser.js's onSelectionChanged (debounced 120ms).
async function showInspectorFor(path) {
  const seq = ++_inspectorSeq;

  // Optimistic header from what the row already told us — the real fetch
  // below can only confirm/replace it, never regress the UI to nothing.
  const entry = typeof entryForPath === 'function' ? entryForPath(path) : null;
  const name = entry ? entry.name : path.split(/[\\/]/).filter(Boolean).pop();
  updateInspector('single', { name, path });

  let data;
  try {
    data = await API.get('/file', { path });
  } catch (err) {
    if (seq !== _inspectorSeq) return;
    _inspectorFileId = null;
    renderInspectorMeta(null);
    renderTagChips([]);
    renderPreviewNone();
    renderInspectorHistory([]);
    return;
  }
  if (seq !== _inspectorSeq) return;

  _inspectorFileId = data.id ?? null;
  renderInspectorMeta(data);
  renderTagChips(data.tags || []);

  await loadInspectorPreview(path, seq);
  if (seq !== _inspectorSeq) return;

  await loadInspectorHistory(path, seq);
}

function renderInspectorMeta(data) {
  const kindEl     = document.getElementById('inspector-kind');
  const sizeEl     = document.getElementById('inspector-size');
  const modifiedEl = document.getElementById('inspector-modified');
  const createdEl  = document.getElementById('inspector-created');
  const hashEl     = document.getElementById('inspector-hash');
  const isFolder   = data && data.kind === 'Folder';

  if (kindEl)     kindEl.textContent     = (data && data.kind) || '—';
  if (sizeEl)     sizeEl.textContent     = (!data || isFolder || data.size == null) ? '—' : formatSize(data.size);
  if (modifiedEl) modifiedEl.textContent = (data && data.modified) ? formatModified(data.modified) : '—';
  if (createdEl)  createdEl.textContent  = (data && data.created) ? formatModified(data.created) : '—';
  if (hashEl) {
    if (!data || isFolder || !data.hash) {
      hashEl.textContent = '—';
      hashEl.removeAttribute('title');
    } else {
      const h = data.hash;
      const short = h.length > 12 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h;
      hashEl.textContent = `xxh64:${short}`;
      hashEl.title = `xxh64:${h}`;
    }
  }
}

// ── Preview ───────────────────────────────────────────────────────────────────
function previewContainer() { return document.getElementById('inspector-preview'); }

function renderPreviewNone() {
  const el = previewContainer();
  if (!el) return;
  if (_inspectorPreviewUrl) { URL.revokeObjectURL(_inspectorPreviewUrl); _inspectorPreviewUrl = null; }
  el.style.display = 'flex';
  el.style.flexDirection = 'row'; // back to the container's default centering (a text preview sets 'column')
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-tertiary)">
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect x="5" y="3" width="23" height="33" rx="3" fill="var(--bg-raised)" stroke="var(--border-subtle)" stroke-width="1.2"/><path d="M28 3v10h10" stroke="var(--border-subtle)" stroke-width="1.2" stroke-linejoin="round"/><path d="M12 17h16M12 22h16M12 27h10" stroke="var(--text-tertiary)" stroke-width="1.5" stroke-linecap="round"/></svg>
    <span style="font:400 var(--t-compact) var(--font-ui)">No preview</span>
  </div>`;
}

async function loadInspectorPreview(path, seq) {
  const el = previewContainer();
  if (!el) return;
  let res;
  try {
    res = await API.blob('/preview', { path });
  } catch (_) {
    if (seq !== _inspectorSeq) return;
    renderPreviewNone();
    return;
  }
  if (seq !== _inspectorSeq) return;

  const ct = res.headers.get('content-type') || '';
  if (ct.startsWith('image/')) {
    let blob;
    try { blob = await res.blob(); } catch (_) { renderPreviewNone(); return; }
    if (seq !== _inspectorSeq) return;
    if (_inspectorPreviewUrl) URL.revokeObjectURL(_inspectorPreviewUrl);
    _inspectorPreviewUrl = URL.createObjectURL(blob);
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.innerHTML = '';
    const img = document.createElement('img');
    img.src = _inspectorPreviewUrl;
    img.alt = '';
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
    el.appendChild(img);
    return;
  }

  let data;
  try { data = await res.json(); } catch (_) { renderPreviewNone(); return; }
  if (seq !== _inspectorSeq) return;

  if (data.kind === 'text') {
    if (_inspectorPreviewUrl) { URL.revokeObjectURL(_inspectorPreviewUrl); _inspectorPreviewUrl = null; }
    el.innerHTML = '';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    const pre = document.createElement('pre');
    pre.className = 'mono';
    pre.style.cssText = 'flex:1;min-height:0;width:100%;margin:0;padding:8px;overflow:auto;' +
      'white-space:pre-wrap;word-break:break-word;text-align:left;font-size:11px;color:var(--text-secondary)';
    pre.textContent = data.content;
    el.appendChild(pre);
    if (data.truncated) {
      const footer = document.createElement('div');
      footer.className = 'mono';
      footer.style.cssText = 'flex-shrink:0;padding:4px 8px;font-size:10px;color:var(--text-tertiary);' +
        'border-top:1px solid var(--border-hairline)';
      footer.textContent = `truncated · ${formatSize(data.total_size)} total`;
      el.appendChild(footer);
    }
  } else {
    // 'binary' or 'too-large'
    renderPreviewNone();
  }
}

// ── Tags ───────────────────────────────────────────────────────────────────────
function renderTagChips(tags) {
  const container = document.getElementById('inspector-tags');
  if (!container) return;
  container.innerHTML = tags.map(t => `<span class="fp-chip">${escapeHtml(t.name)}<button class="fp-chip__remove" data-action="inspector-remove-tag" data-tag-id="${t.id}" aria-label="Remove tag ${escapeHtml(t.name)}">×</button></span>`).join('');
}

async function refreshInspectorTags() {
  if (_inspectorFileId == null) return;
  try {
    const tags = await API.get(`/files/${_inspectorFileId}/tags`);
    renderTagChips(tags);
  } catch (_) { /* leave the chips as they were */ }
}

async function addInspectorTag(name) {
  if (_inspectorFileId == null || !name) return;
  try {
    await API.post(`/files/${_inspectorFileId}/tags`, { name });
    await refreshInspectorTags();
  } catch (err) {
    showToast(`Failed to add tag: ${formatApiError(err)}`, 'error');
  }
}

async function inspectorRemoveTag(tagId) {
  if (_inspectorFileId == null) return;
  try {
    await API.del(`/files/${_inspectorFileId}/tags/${tagId}`);
    await refreshInspectorTags();
  } catch (err) {
    showToast(`Failed to remove tag: ${formatApiError(err)}`, 'error');
  }
}

async function loadInspectorTagSuggestions(q) {
  const datalist = document.getElementById('inspector-tag-suggestions');
  if (!datalist) return;
  if (!q) { datalist.innerHTML = ''; return; }
  try {
    const tags = await API.get('/tags', { q, limit: 10 });
    datalist.innerHTML = tags.map(t => `<option value="${escapeHtml(t.name)}"></option>`).join('');
  } catch (_) { /* suggestions are best-effort */ }
}

/** Wires the tag-add input once at startup (the element persists across
 * renders — only its datalist/chip siblings are rebuilt per selection). */
function initInspectorTagInput() {
  const input = document.getElementById('inspector-tag-input');
  if (!input) return;
  let debounceTimer = null;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    debounceTimer = setTimeout(() => loadInspectorTagSuggestions(q), 150);
  });
  input.addEventListener('keydown', e => {
    e.stopPropagation(); // never let browser.js's shortcut handling see keys typed here
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      input.value = '';
      addInspectorTag(name);
    }
  });
}

// ── History ───────────────────────────────────────────────────────────────────
function basenameOf(p) { return p ? (String(p).split(/[\\/]/).filter(Boolean).pop() || p) : ''; }

function renderInspectorHistory(rows) {
  const container = document.getElementById('inspector-history');
  if (!container) return;
  if (!rows || !rows.length) {
    container.innerHTML = `<p style="font:400 var(--t-body) var(--font-ui);color:var(--text-tertiary);padding:8px 0">No history available yet.</p>`;
    return;
  }
  container.innerHTML = rows.map(renderHistoryRow).join('');
}

function renderHistoryRow(row) {
  const srcName  = basenameOf(row.source_path);
  const destName = basenameOf(row.dest_path);
  let summary;
  if (srcName && destName && srcName !== destName) summary = `${escapeHtml(srcName)} → ${escapeHtml(destName)}`;
  else summary = escapeHtml(destName || srcName || '—');

  const canUndo = !!row.executed && !row.undone && !row.error && !String(row.op_type || '').endsWith(':final');
  const undoBtn = canUndo
    ? `<button class="fp-btn fp-btn--ghost fp-btn--sm" data-action="inspector-undo-op" data-op-id="${row.id}">Undo</button>`
    : '';

  return `<div class="inspector-history__row" style="display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--border-hairline)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span style="font:500 var(--t-compact) var(--font-ui);color:var(--text-primary)">${escapeHtml(row.op_type || '')}</span>
      <span class="mono" style="font-size:10px;color:var(--text-tertiary);flex-shrink:0">${escapeHtml(formatModified(row.timestamp))}</span>
    </div>
    <div class="mono" style="font-size:11px;color:var(--text-secondary);word-break:break-all">${summary}</div>
    ${undoBtn}
  </div>`;
}

async function loadInspectorHistory(path, seq) {
  _inspectorHistoryPath = path;
  let rows;
  try {
    rows = await API.get('/files/history', { path });
  } catch (_) {
    if (seq !== _inspectorSeq) return;
    renderInspectorHistory([]);
    return;
  }
  if (seq !== _inspectorSeq) return;
  renderInspectorHistory(rows);
}

async function inspectorUndoOp(opId) {
  try {
    await API.post(`/operations/${opId}/undo`);
  } catch (err) {
    showToast(formatApiError(err), 'error');
    return;
  }
  if (typeof refreshDirectory === 'function') await refreshDirectory();
  if (_inspectorHistoryPath) {
    try {
      const rows = await API.get('/files/history', { path: _inspectorHistoryPath });
      renderInspectorHistory(rows);
    } catch (_) { /* history refresh is best-effort */ }
  }
}

// ── Multi-selection ───────────────────────────────────────────────────────────
// Count + total size come straight from browserState (no fetch needed); the
// tag union is built from GET /file per selected path, capped at 50 so a
// huge marquee selection can't fire hundreds of requests. A tag shared by
// every fetched file renders full-opacity; a tag only some of them carry
// renders at partial opacity.
async function showInspectorMulti(paths) {
  const seq = ++_inspectorSeq;
  updateInspector('multi', { count: paths.length, totalSize: formatSize(selectionTotalSize()) });

  const capped = paths.slice(0, 50);
  const results = await Promise.all(capped.map(p => API.get('/file', { path: p }).catch(() => null)));
  if (seq !== _inspectorSeq) return;

  const counts = new Map();
  let consulted = 0;
  results.forEach(r => {
    if (!r) return;
    consulted += 1;
    const seen = new Set();
    (r.tags || []).forEach(t => {
      if (seen.has(t.name)) return;
      seen.add(t.name);
      counts.set(t.name, (counts.get(t.name) || 0) + 1);
    });
  });

  const container = document.getElementById('inspector-multi-tags');
  if (!container) return;
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  container.innerHTML = names.map(name => {
    const shared = consulted > 0 && counts.get(name) === consulted;
    const style = shared ? '' : ' style="opacity:.5"';
    return `<span class="fp-chip"${style}>${escapeHtml(name)}</span>`;
  }).join('');
}

// ── Actions row: Open / Reveal ────────────────────────────────────────────────
function inspectorOpenSelected() {
  const path = browserState.selection.size ? [...browserState.selection][0] : null;
  if (!path) return;
  const openPath = window.electronAPI?.openPath;
  if (openPath) {
    Promise.resolve(openPath(path)).then(result => { if (result) showToast(result, 'error'); })
      .catch(err => showToast(formatApiError(err), 'error'));
  }
  API.post('/recent', { path, action: 'opened' }).catch(() => { /* best-effort */ });
}

function inspectorRevealSelected() {
  const path = browserState.selection.size ? [...browserState.selection][0] : null;
  if (!path) return;
  window.electronAPI?.showItemInFolder?.(path);
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

// ── Inspector toggle ───────────────────────────────────────────────────────────
function toggleInspector() {
  const inspector = document.getElementById('inspector');
  const toggleBtn = document.getElementById('btn-inspector-toggle');
  if (!inspector) return;
  const isOpen = inspector.classList.toggle('inspector--open');
  toggleBtn?.classList.toggle('fp-icon-btn--active', isOpen);
  // Notify: used by Browser screen to compact columns
  document.dispatchEvent(new CustomEvent('fp:inspector-toggle', { detail: { open: isOpen } }));
}


// ── Resizer (inspector drag handle) ────────────────────────────────────────────
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
