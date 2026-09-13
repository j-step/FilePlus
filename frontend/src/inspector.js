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
    // Restore single-file UI. Panes are shown one at a time by tab (Preview/
    // Tags/History) — never un-hide every pane here (that stacks Preview
    // meta + tag chips + History rows regardless of the active tab). Re-apply
    // whichever tab is currently active (default Preview) via the shared
    // switchInspectorTab helper (app.js, canonical — loaded after this file
    // so it wins), which also re-hides the multi pane.
    if (multiPane) multiPane.style.display = 'none';
    if (tabBar)    tabBar.style.display = '';
    if (preview)   preview.style.display = '';
    if (data.name && filenameEl) filenameEl.textContent = data.name;
    if (data.path && filepathEl) filepathEl.textContent = data.path;
    const activeTab = inspector.querySelector('.fp-inspector__tab.fp-tabs__item--active')?.dataset.tab || 'preview';
    switchInspectorTab(activeTab);
    if (!inspector.classList.contains('inspector--open')) toggleInspector();
  } else {
    // Empty selection — collapse inspector. Also revoke any preview blob:
    // URL here (not just in browser.js's onSelectionChanged) since
    // updateInspector('none') can be reached from other callers too.
    renderPreviewNone();
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
    ${icon('file', 'fp-icon--40')}
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
  // Each basename carries the full path in `title` so hovering a truncated
  // or ambiguous name (two files with the same basename in different
  // folders) discloses exactly what it refers to.
  let summary;
  if (srcName && destName && srcName !== destName) {
    summary = `<span title="${escapeHtml(row.source_path)}">${escapeHtml(srcName)}</span> → <span title="${escapeHtml(row.dest_path)}">${escapeHtml(destName)}</span>`;
  } else {
    const singleName = destName || srcName;
    const singlePath = row.dest_path || row.source_path;
    summary = singleName ? `<span title="${escapeHtml(singlePath)}">${escapeHtml(singleName)}</span>` : '—';
  }

  const canUndo = !!row.executed && !row.undone && !row.error && !String(row.op_type || '').endsWith(':final');
  const undoBtn = canUndo
    ? `<button class="fp-btn fp-btn--ghost fp-btn--sm" data-action="inspector-undo-op" data-op-id="${row.id}" data-batch-id="${escapeHtml(row.batch_id || '')}">Undo</button>`
    : '';
  const reasonHtml = row.reason
    ? `<div class="mono" style="font-size:10px;color:var(--text-tertiary)">${escapeHtml(row.reason)}</div>`
    : '';
  const errorHtml = row.error
    ? `<div class="mono" style="font-size:10px;color:var(--bad)">${escapeHtml(row.error)}</div>`
    : '';

  return `<div class="inspector-history__row" style="display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--border-hairline)">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span style="font:500 var(--t-compact) var(--font-ui);color:var(--text-primary)">${escapeHtml(row.op_type || '')}</span>
      <span class="mono" style="font-size:10px;color:var(--text-tertiary);flex-shrink:0">${escapeHtml(formatModified(row.timestamp))}</span>
    </div>
    <div class="mono" style="font-size:11px;color:var(--text-secondary);word-break:break-all">${summary}</div>
    ${reasonHtml}
    ${errorHtml}
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

/** Re-fetches and renders History for `path`, independent of the debounced
 * selection → inspector pipeline (used when undo keeps the same file
 * selected, so nothing else is already about to reload it). */
async function reloadInspectorHistoryFor(path) {
  _inspectorHistoryPath = path;
  try {
    const rows = await API.get('/files/history', { path });
    renderInspectorHistory(rows);
  } catch (_) { /* history refresh is best-effort */ }
}

async function inspectorUndoOp(opId, batchId) {
  // POST /operations/{id}/undo returns the INVERSE operation's own result —
  // {op_id, op_type, status, src, dest, batch_id} — so res.dest is where the
  // undo actually left the item (the restored/original path for a
  // move/rename/trash undo; a .FilePlusTrash path for a copy/mkdir/touch
  // undo, which won't appear in a normal folder listing).
  let res;
  try {
    res = await API.post(`/operations/${opId}/undo`);
  } catch (err) {
    showToast(formatApiError(err), 'error');
    return;
  }
  // Keep fileops's undo/redo stacks consistent with this per-op undo: drop
  // the row's own batch id from undoStack (so a following Ctrl+Z can't post
  // a batch undo that finds nothing left to do and still reports "Undone"),
  // and push the inverse's batch id onto redoStack so Ctrl+Y can redo it.
  if (typeof fileops !== 'undefined' && fileops.noteExternalUndo) {
    fileops.noteExternalUndo(batchId, res && res.batch_id);
  }
  if (typeof refreshDirectory === 'function') await refreshDirectory();

  const destPath = res && res.dest;
  const destExists = !!(destPath && typeof entryForPath === 'function' && entryForPath(destPath));
  const currentPath = browserState.selection.size === 1 ? [...browserState.selection][0] : null;
  const currentStillValid = !!(currentPath && typeof entryForPath === 'function' && entryForPath(currentPath));

  if (destExists) {
    // The undone item now lives at a different identity (e.g. a rename/move
    // was reversed) — follow it: selecting it re-runs the full inspector
    // (meta/preview/tags/History) for its restored path.
    if (typeof selectRow === 'function') selectRow(destPath);
    else await reloadInspectorHistoryFor(destPath);
  } else if (currentStillValid) {
    // The current selection survived the refresh as-is (the undone op
    // didn't change this file's identity/path) — just reload History.
    await reloadInspectorHistoryFor(currentPath);
  } else {
    // Neither the restored path nor the prior selection exists in the
    // current listing (e.g. undoing a copy/mkdir/touch sends the item to
    // .FilePlusTrash, off-screen) — nothing left to inspect.
    _inspectorSeq++;
    updateInspector('none');
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
// switchInspectorTab itself lives in app.js (toggles fp-tabs__item--active +
// inline pane display) — that's the version loaded last and the one every
// click and updateInspector('single') actually runs; no divergent copy here.

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
