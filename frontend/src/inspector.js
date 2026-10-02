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
// Inspector work still to come: an armed selection debounce (browser.js
// onSelectionChanged) plus every showInspectorFor() / showInspectorMulti()
// fetch chain still running. Read by the Electron tests as the "inspector
// has settled" signal (like browser.js's __fpLoadPending), so they wait on it
// instead of sleeping.
window.__fpInspectorPending = 0;

// Currently-inspected file's DB id (null for folders, which can't be
// tagged) and the path History is showing, so the tag/undo handlers below
// (invoked later, from a click) know what they're acting on.
let _inspectorFileId = null;
let _inspectorHistoryPath = null;

// Revoked before a new one replaces it so blob: URLs don't leak.
let _inspectorPreviewUrl = null;
// path|modified|size of the file the preview box is showing. A re-fetch of
// the same, unchanged file (every listing refresh re-announces the
// selection) keeps the preview it has: rebuilding it swapped in a fresh
// blob: <img> that painted empty until it decoded — a flash (spec §12).
let _inspectorPreviewFor = null;

// The entry currently in the header, in the {name, path, ext, is_dir} shape
// iconFor() wants — so the "No preview" placeholder shows the file's own
// file-type icon (or its Windows shell icon) rather than a generic page.
// Cleared whenever the header leaves single-selection mode.
let _inspectorEntry = null;

// ── Inspector update (A.3.2) — pane swap + header text only; data fetching
// and per-field rendering live in showInspectorFor/showInspectorMulti below.
// The panel's own visibility is never touched here — selection changes
// content only; setInspectorOpen (below) is the sole writer of
// .inspector--open (design spec §3.4: "selection never opens or closes it").
function updateInspector(mode, data = {}) {
  const inspector = document.getElementById('inspector');
  if (!inspector) return;
  syncInspectorActions();

  const singlePanes = inspector.querySelectorAll('.fp-inspector__pane:not([data-pane="multi"])');
  const multiPane   = inspector.querySelector('.fp-inspector__pane[data-pane="multi"]');
  const tabBar      = inspector.querySelector('.fp-tabs.fp-inspector__tabs');
  const preview     = document.getElementById('inspector-preview');
  const filenameEl  = document.getElementById('inspector-filename');
  const filepathEl  = document.getElementById('inspector-filepath');

  if (mode === 'multi') {
    _inspectorEntry = null;
    // The single-file identity goes with it. Leaving _inspectorFileId behind
    // meant a tag typed into the (single-file) Tags pane while several files
    // were selected posted to whichever file had been inspected LAST — a
    // silent write to the wrong record, with that file's own chips updating
    // as if it had worked (pass 2 #199).
    _inspectorFileId = null;
    _inspectorHistoryPath = null;
    // …and so do the chips that named that one file's tags: the Tags pane is
    // hidden here, but leaving a stale chip list behind means anything that
    // un-hides it (cm-add-tag's switchInspectorTab, a later tab click)
    // displays another file's tags under "N items selected" (pass 2 #149).
    const tagsEl = document.getElementById('inspector-tags');
    if (tagsEl) tagsEl.innerHTML = '';
    // Show multi-select aggregate; hide single-file UI
    singlePanes.forEach(p => { p.hidden = true; });
    if (tabBar)   tabBar.hidden = true;
    // The preview box carries an inline display:flex (index.html) that beats
    // the UA's [hidden]{display:none} — styles.css restates the rule for
    // .inspector__preview[hidden] so this actually hides it (pass 2 #148).
    // The last single selection's image blob goes with it.
    if (preview)  preview.hidden = true;
    if (_inspectorPreviewUrl) { URL.revokeObjectURL(_inspectorPreviewUrl); _inspectorPreviewUrl = null; }
    _inspectorPreviewFor = null;
    if (filenameEl) { filenameEl.textContent = `${data.count} items selected`; filenameEl.removeAttribute('title'); }
    if (filepathEl) filepathEl.textContent = '';
    if (multiPane) {
      multiPane.hidden = false;
      const countEl = multiPane.querySelector('#inspector-multi-count');
      const sizeEl  = multiPane.querySelector('#inspector-multi-size');
      if (countEl) countEl.textContent = data.count || 0;
      if (sizeEl)  sizeEl.textContent  = data.totalSize || '—';
    }
  } else if (mode === 'single') {
    // Restore single-file UI. Panes are shown one at a time by tab (Preview/
    // Tags/History) — never un-hide every pane here (that stacks Preview
    // meta + tag chips + History rows regardless of the active tab). Re-apply
    // whichever tab is currently active (default Preview) via the shared
    // switchInspectorTab helper (app.js, canonical — loaded after this file
    // so it wins), which also re-hides the multi pane.
    if (multiPane) multiPane.hidden = true;
    if (tabBar)    tabBar.hidden = false;
    if (preview)   preview.hidden = false;
    if (data.name && filenameEl) { filenameEl.textContent = data.name; filenameEl.title = data.name; }
    if (data.path && filepathEl) filepathEl.textContent = data.path;
    const activeTab = inspector.querySelector('.fp-inspector__tab.fp-tabs__item--active')?.dataset.tab || 'preview';
    switchInspectorTab(activeTab);
  } else {
    // Empty selection — render the "No file selected" state in place (same
    // fixed geometry as a real file: header/preview/meta never resize).
    _inspectorEntry = null;
    _inspectorFileId = null;
    _inspectorHistoryPath = null;
    if (multiPane) multiPane.hidden = true;
    if (tabBar)    tabBar.hidden = false;
    if (preview)   preview.hidden = false;
    if (filenameEl) { filenameEl.textContent = 'No file selected'; filenameEl.removeAttribute('title'); }
    if (filepathEl) filepathEl.textContent = '';
    renderInspectorEmptyPreview();
    renderInspectorMeta(null);
    const emptyHint = '<p style="font:400 var(--t-body) var(--font-ui);color:var(--text-tertiary);padding:8px 0">Select a file</p>';
    const tagsEl = document.getElementById('inspector-tags');
    if (tagsEl) tagsEl.innerHTML = emptyHint;
    const historyEl = document.getElementById('inspector-history');
    if (historyEl) historyEl.innerHTML = emptyHint;
    const activeTab = inspector.querySelector('.fp-inspector__tab.fp-tabs__item--active')?.dataset.tab || 'preview';
    switchInspectorTab(activeTab);
  }

  // 'single' leaves this to showInspectorFor, which only learns the file's
  // DB id (or null, for a folder) once GET /file answers.
  if (mode !== 'single') updateTagInputAvailability();
}

// ── Single selection ──────────────────────────────────────────────────────────
// Fetches GET /file (metadata + tags), GET /preview (image/text/binary), and
// GET /files/history for `path`, rendering each into the inspector panes as
// it lands. Called by browser.js's onSelectionChanged (debounced 120ms).
async function showInspectorFor(path) {
  window.__fpInspectorPending++;
  try {
    await _showInspectorFor(path);
  } finally {
    window.__fpInspectorPending--;
  }
}

async function _showInspectorFor(path) {
  const seq = ++_inspectorSeq;

  // Optimistic header from what the row already told us — the real fetch
  // below can only confirm/replace it, never regress the UI to nothing.
  const entry = typeof entryForPath === 'function' ? entryForPath(path) : null;
  const name = entry ? entry.name : path.split(/[\\/]/).filter(Boolean).pop();
  updateInspector('single', { name, path });
  // Set AFTER updateInspector — its 'multi'/'none' branches null this out.
  _inspectorEntry = { ...(entry || {}), name, path };

  let data;
  try {
    data = await API.get('/file', { path });
  } catch (err) {
    if (seq !== _inspectorSeq) return;
    _inspectorFileId = null;
    updateTagInputAvailability();
    renderInspectorMeta(null);
    renderTagChips([]);
    renderPreviewNone();
    renderInspectorHistory([]);
    return;
  }
  if (seq !== _inspectorSeq) return;

  _inspectorFileId = data.id ?? null;
  updateTagInputAvailability();
  renderInspectorMeta(data);
  renderTagChips(data.tags || []);

  // GET /preview 400s for a directory by design (backend/api.py) — Task 13
  // surfaced this via a folder's own Properties command, which selects it
  // the same way a click does. A folder never has a preview to show, so skip
  // the doomed fetch entirely rather than let it round-trip into a console
  // error every time a folder is selected.
  const previewKey = `${path}|${data.modified}|${data.size}`;
  if (data.kind === 'Folder') renderPreviewNone();
  else if (previewKey !== _inspectorPreviewFor) {
    // Only real content is kept: the "No preview" type icon repaints, so an
    // icon-source change (refreshBackendData) still reaches it.
    const shown = await loadInspectorPreview(path, seq);
    if (seq !== _inspectorSeq) return;
    if (shown) _inspectorPreviewFor = previewKey;
  }

  await loadInspectorHistory(path, seq);
}

/** The panel for an item that no longer exists where it was (a Home row
 * whose file was moved or deleted): its name and old location, "Moved or
 * deleted" as its kind, nothing fetched (Stage 2D §12 sweep). */
function showInspectorMissing(path) {
  _inspectorSeq++;
  const name = basenameOf(path);
  updateInspector('single', { name, path });
  _inspectorEntry = { name, path, is_dir: false, ext: '' };
  _inspectorFileId = null;
  _inspectorHistoryPath = null;
  updateTagInputAvailability();
  renderInspectorMeta({ kind: 'Moved or deleted' });
  renderTagChips([]);
  renderPreviewNone();
  renderInspectorHistory([]);
}

function renderInspectorMeta(data) {
  const kindEl     = document.getElementById('inspector-kind');
  const sizeEl     = document.getElementById('inspector-size');
  const modifiedEl = document.getElementById('inspector-modified');
  const createdEl  = document.getElementById('inspector-created');
  const hashEl     = document.getElementById('inspector-hash');
  const isFolder   = data && data.kind === 'Folder';

  if (kindEl) {
    kindEl.textContent = (data && data.kind) || '—';
    if (data && data.kind) kindEl.title = data.kind; else kindEl.removeAttribute('title');
  }
  if (sizeEl)     sizeEl.textContent     = (!data || isFolder || data.size == null) ? '—' : formatSize(data.size);
  // GET /file's dates are epoch seconds, like every listing's.
  if (modifiedEl) modifiedEl.textContent = (data && data.modified) ? formatModified(data.modified * 1000) : '—';
  if (createdEl)  createdEl.textContent  = (data && data.created) ? formatModified(data.created * 1000) : '—';
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

/** Preview box for updateInspector('none') — a generic, dimmed file glyph.
 * Distinct from renderPreviewNone() below (used when an actual selected
 * file simply has nothing to preview, which keeps that file's own
 * type icon at full opacity): here there is no file at all. */
function renderInspectorEmptyPreview() {
  const el = previewContainer();
  if (!el) return;
  _inspectorPreviewFor = null;
  if (_inspectorPreviewUrl) { URL.revokeObjectURL(_inspectorPreviewUrl); _inspectorPreviewUrl = null; }
  el.style.display = 'flex';
  el.style.flexDirection = 'row';
  el.innerHTML = `<span style="opacity:.4;display:flex">${icon('file', 'fp-icon--40')}</span>`;
}

function renderPreviewNone() {
  const el = previewContainer();
  if (!el) return;
  _inspectorPreviewFor = null;
  if (_inspectorPreviewUrl) { URL.revokeObjectURL(_inspectorPreviewUrl); _inspectorPreviewUrl = null; }
  el.style.display = 'flex';
  el.style.flexDirection = 'row'; // back to the container's default centering (a text preview sets 'column')
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-tertiary)">
    ${iconFor(_inspectorEntry, 40)}
    <span class="inspector__preview-note" style="font:400 var(--t-compact) var(--font-ui)">No preview</span>
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
    try { blob = await res.blob(); } catch (_) {
      // Same guard as every other await here: a superseded request's decode
      // failure must not revoke the LIVE selection's blob: URL (leaving a
      // broken <img>) or repaint the box with another file's icon (pass 2 #85).
      if (seq !== _inspectorSeq) return;
      renderPreviewNone();
      return;
    }
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
    return true;
  }

  let data;
  try { data = await res.json(); } catch (_) {
    if (seq !== _inspectorSeq) return;   // pass 2 #85, as above
    renderPreviewNone();
    return;
  }
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
    // The panel's overlay scrollbar, not a permanent native bar (§9.3 / §12).
    if (typeof fpOverlayScroll === 'function') fpOverlayScroll(pre, { hoverRoot: el });
    if (data.truncated) {
      const footer = document.createElement('div');
      footer.className = 'mono';
      footer.style.cssText = 'flex-shrink:0;padding:4px 8px;font-size:10px;color:var(--text-tertiary);' +
        'border-top:1px solid var(--border-hairline)';
      footer.textContent = `truncated · ${formatSize(data.total_size)} total`;
      el.appendChild(footer);
    }
    return true;
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

/** Enables/disables "Add tag…" to match what the panel can actually do.
 * GET /file returns id: null for a directory, so addInspectorTag() below can
 * only no-op for a folder — and the Enter handler had already cleared the
 * field by then, so the pane silently ate whatever was typed (pass 2 #81).
 * A disabled field with a plain-language placeholder says why instead. */
function updateTagInputAvailability() {
  const input = document.getElementById('inspector-tag-input');
  if (!input) return;
  const taggable = _inspectorFileId != null;
  input.disabled = !taggable;
  // Why it is off, in the panel's own terms: nothing selected said "Only
  // files can be tagged" under "No file selected" (Stage 2D §12 sweep).
  let why = 'Only files can be tagged';
  if (!_inspectorEntry) why = 'Select a file to tag it';
  else if (_inspectorEntry.is_dir === false) why = 'This file can’t be tagged';
  input.placeholder = taggable ? 'Add tag…' : why;
  if (!taggable) input.value = '';
}

async function refreshInspectorTags() {
  if (_inspectorFileId == null) return;
  // The chips land after a round-trip: if the panel has moved on to another
  // item by then, they are that earlier file's tags and must not be painted
  // under the new one's name (Stage 2D §12 sweep).
  const seq = _inspectorSeq;
  const id = _inspectorFileId;
  try {
    const tags = await API.get(`/files/${id}/tags`);
    if (seq !== _inspectorSeq || id !== _inspectorFileId) return;
    renderTagChips(tags);
  } catch (_) { /* leave the chips as they were */ }
}

async function addInspectorTag(name) {
  if (_inspectorFileId == null || !name) return;
  try {
    await API.post(`/files/${_inspectorFileId}/tags`, { name });
    await refreshInspectorTags();
    // The sidebar's Tags section and search.js's Tag filter both read the
    // same GET /tags counts (Task 14) — re-fetch so a tag added here shows up
    // there without a restart.
    if (typeof loadSidebarTags === 'function') loadSidebarTags();
  } catch (err) {
    showToast(`Failed to add tag: ${formatApiError(err)}`, 'error');
  }
}

async function inspectorRemoveTag(tagId) {
  if (_inspectorFileId == null) return;
  try {
    await API.del(`/files/${_inspectorFileId}/tags/${tagId}`);
    await refreshInspectorTags();
    if (typeof loadSidebarTags === 'function') loadSidebarTags();
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

// Windows file-attribute bits, for the attr-set rows below. mover.py logs
// attr-set's before/after as raw bit masks (FILE_ATTRIBUTE_READONLY = 1,
// _HIDDEN = 2, _ARCHIVE = 32) — the only three the Properties panel offers.
const INSPECTOR_ATTR_BITS = [[1, 'Read-only'], [2, 'Hidden'], [32, 'Archive']];

/** The History row's subtitle. `reason` is a human string for most ops
 * ('undo of #12', 'replaced'), but the Properties panel's two op types write
 * their undo payload into it as JSON — attr-set's bit masks and, worse,
 * folder-type-set's base64 copy of the whole desktop.ini, which the panel
 * rendered verbatim (pass 2 #77). Parse those two into a sentence; anything
 * that isn't the JSON we expect falls back to the raw string, so a reason
 * this function has never heard of is still shown rather than swallowed. */
function humanizeHistoryReason(row) {
  const raw = row && row.reason ? String(row.reason) : '';
  const opType = String((row && row.op_type) || '');
  if (!raw || (opType !== 'attr-set' && opType !== 'folder-type-set')) return raw;
  let data;
  try { data = JSON.parse(raw); } catch (_) { return raw; }
  if (!data || typeof data !== 'object') return raw;
  if (opType === 'folder-type-set') {
    return data.after ? `Folder type → ${data.after}` : raw;
  }
  const before = Number(data.before), after = Number(data.after);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return raw;
  const changed = INSPECTOR_ATTR_BITS
    .filter(([bit]) => ((before ^ after) & bit) !== 0)
    .map(([bit, label]) => `${label} ${(after & bit) ? 'on' : 'off'}`);
  return changed.length ? changed.join(', ') : 'Attributes unchanged';
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
  // word-break matches the summary line above: the panel is ~340px wide and
  // an unbroken value (a path, or a reason we could not parse) overflowed it.
  const reasonText = humanizeHistoryReason(row);
  const reasonHtml = reasonText
    ? `<div class="mono" style="font-size:10px;color:var(--text-tertiary);word-break:break-all">${escapeHtml(reasonText)}</div>`
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
  const seq = _inspectorSeq;
  try {
    const rows = await API.get('/files/history', { path });
    // Same guard as the selection pipeline's own History load.
    if (seq !== _inspectorSeq || _inspectorHistoryPath !== path) return;
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
  // The selection and the clipboard follow the inverse the same way they
  // follow every other operation (a rename undone keeps its row selected).
  if (res && typeof fileops !== 'undefined' && fileops.followOps) fileops.followOps([res]);
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
    // didn't change this file's identity/path) — reload History, and the tag
    // chips with it: tag-add/tag-remove are ordinary operations_log rows, so
    // undoing one from this very list changed what the Tags pane is showing
    // (and the sidebar's TAGS counts) without anything repainting them
    // (pass 2 #80).
    await reloadInspectorHistoryFor(currentPath);
    await refreshInspectorTags();
    if (typeof loadSidebarTags === 'function') loadSidebarTags();
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
  window.__fpInspectorPending++;
  try {
    await _showInspectorMulti(paths);
  } finally {
    window.__fpInspectorPending--;
  }
}

async function _showInspectorMulti(paths) {
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
  // Full opacity means "every selected item carries this tag". The 50-path
  // cap above makes that claim unprovable for a bigger selection — the sample
  // says nothing about items 51..N — so past the cap every chip renders at
  // partial opacity and a note says what was actually looked at (pass 2 #152).
  const sampled = capped.length < paths.length;
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const chips = names.map(name => {
    const shared = !sampled && consulted > 0 && counts.get(name) === consulted;
    const style = shared ? '' : ' style="opacity:.5"';
    return `<span class="fp-chip"${style}>${escapeHtml(name)}</span>`;
  }).join('');
  const note = (sampled && names.length)
    ? `<p style="font:400 var(--t-compact) var(--font-ui);color:var(--text-tertiary);margin:6px 0 0">Sampled from the first ${capped.length} of ${paths.length} items</p>`
    : '';
  container.innerHTML = chips + note;
}

/** Repaints the inspector from the BROWSER's current selection — the one
 * thing that owns the panel. Home's own row clicks write into the same
 * (browser-screen) panel, so returning to the Browser used to reveal another
 * screen's file over a listing selecting something else (pass 2 #75). Same
 * three-way branch as browser.js's onSelectionChanged, minus the debounce. */
function syncInspectorToBrowserSelection() {
  const selection = (typeof browserState !== 'undefined' && browserState.selection) || null;
  const n = selection ? selection.size : 0;
  if (n === 0) {
    _inspectorSeq++;   // invalidate any fetch still in flight
    updateInspector('none');
  } else if (n === 1) {
    showInspectorFor([...selection][0]);
  } else {
    showInspectorMulti(typeof getSelectedPaths === 'function' ? getSelectedPaths() : [...selection]);
  }
}

// ── Actions row: Open / Open with… / Reveal ──────────────────────────────────
// They act on the Browser's single selection, so with anything else (nothing
// selected, several items, the This PC page's drive cards) they are disabled
// — aria-disabled, not [disabled], so the tooltip can still say why.

/** The one selected Browser item the action row acts on, or null. */
function inspectorSelectedPath() {
  const sel = (typeof browserState !== 'undefined' && browserState.selection) || null;
  return sel && sel.size === 1 ? [...sel][0] : null;
}

const INSPECTOR_ACTION_TITLES = {
  'inspector-open': 'Open the selected item',
  'open-file-with': 'Choose the app to open the selected file with',
  'inspector-reveal': 'Show the selected item in Windows Explorer',
};

/** Enables the action row for exactly one selected item (Open with… for a
 * file only) and disables it otherwise. */
function syncInspectorActions() {
  const path = inspectorSelectedPath();
  const entry = path && typeof entryForPath === 'function' ? entryForPath(path) : null;
  document.querySelectorAll('#inspector .inspector__actions [data-action]').forEach(btn => {
    const action = btn.dataset.action;
    if (!(action in INSPECTOR_ACTION_TITLES)) return;
    let why = path ? '' : 'Select one item first';
    if (!why && action === 'open-file-with' && entry && entry.is_dir) why = 'Open with… is for files';
    if (why) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    btn.title = why ? `${INSPECTOR_ACTION_TITLES[action]} — ${why}` : INSPECTOR_ACTION_TITLES[action];
  });
}

function inspectorOpenSelected() {
  const path = inspectorSelectedPath();
  if (!path) return;
  const openPath = window.electronAPI?.openPath;
  if (openPath) {
    Promise.resolve(openPath(path)).then(result => { if (result) showToast(result, 'error'); })
      .catch(err => showToast(formatApiError(err), 'error'));
  }
  API.post('/recent', { path, action: 'opened' }).catch(() => { /* best-effort */ });
}

function inspectorRevealSelected() {
  const path = inspectorSelectedPath();
  if (!path) return;
  window.electronAPI?.showItemInFolder?.(path);
}

/** Open with… — the native Windows "Open with" dialog for the selected file
 * (pass 2 #185: the button used to be a dead stub). */
function inspectorOpenWithSelected() {
  const path = inspectorSelectedPath();
  if (!path) return;
  const entry = typeof entryForPath === 'function' ? entryForPath(path) : null;
  if (entry && entry.is_dir) return;
  Promise.resolve(window.electronAPI?.openWithDialog?.(path)).then(ok => {
    if (!ok) showToast('Failed to open the Open With dialog', 'error');
  }).catch(err => showToast(`Failed to open the Open With dialog: ${formatApiError(err)}`, 'error'));
}

// ── Inspector tabs ────────────────────────────────────────────────────────────
// switchInspectorTab itself lives in app.js (toggles fp-tabs__item--active +
// each pane's `hidden` attribute) — that's the version loaded last and the
// one every click and updateInspector('single'/'none') actually runs; no
// divergent copy here.

// ── Inspector toggle (a switch — design spec §3.4) ───────────────────────────
// setInspectorOpen is the ONLY writer of .inspector--open: ui.inspector_open
// (config, default on — see settings.js's applySettingsFromConfig, which
// calls this with {persist: false} on startup) plus Ctrl+I / the toolbar
// button (via toggleInspector) are the only things that open or close the
// panel. Selection changes (updateInspector above) never do.
function setInspectorOpen(open, { persist = true } = {}) {
  const inspector = document.getElementById('inspector');
  const toggleBtn = document.getElementById('btn-inspector-toggle');
  if (!inspector) return;
  inspector.classList.toggle('inspector--open', open);
  toggleBtn?.classList.toggle('fp-icon-btn--active', open);
  // The panel is display:none while closed, so its tab underline could not be
  // measured until now (moveTabIndicator, app.js, skips a zero-width tab).
  if (open) moveTabIndicator(inspector.querySelector('.fp-inspector__tabs'));
  if (persist && typeof saveSetting === 'function') saveSetting('ui.inspector_open', open);
}

function toggleInspector() {
  const inspector = document.getElementById('inspector');
  if (!inspector) return;
  setInspectorOpen(!inspector.classList.contains('inspector--open'));
}


// ── Panel width (resizer + the Settings slider) ───────────────────────────────
// ONE bound, in one place: the drag clamp, the Settings slider's min/max and
// .inspector's CSS max-width all used to disagree (the drag ran 40px past a
// 480px CSS cap, and the slider was wired to nothing at all — pass 2 #82/#83).
// The CSS side is --w-inspector-min / --w-inspector-max in styles.css.
// Widths are SCREEN px (Stage 2D §5): the panel's CSS width is
// --inspector-w-screen / --app-zoom, so it keeps its size on screen at any
// app zoom while its contents grow; ui.inspector_w stores the screen px.
const INSPECTOR_WIDTH_MIN = 280;
const INSPECTOR_WIDTH_MAX = 520;

/** Sets the panel's width (screen px) and keeps the Settings slider + its px
 * label with it, whichever of the two moved. `persist` writes
 * ui.inspector_w, which applySettingsFromConfig (settings.js) re-applies on
 * the next start. */
function applyInspectorWidth(px, { persist = false } = {}) {
  const n = Number(px);
  if (!Number.isFinite(n)) return null;
  const width = Math.round(Math.max(INSPECTOR_WIDTH_MIN, Math.min(INSPECTOR_WIDTH_MAX, n)));
  document.documentElement.style.setProperty('--inspector-w-screen', `${width}px`);
  const slider = document.getElementById('slider-inspector-width');
  if (slider) slider.value = String(width);
  const label = document.getElementById('val-inspector-width');
  if (label) label.textContent = `${width}px`;
  if (persist && typeof saveSetting === 'function') saveSetting('ui.inspector_w', width);
  return width;
}

function initResizer() {
  const resizer   = document.getElementById('resizer');
  const listPane  = document.getElementById('list-pane');
  const inspector = document.getElementById('inspector');
  if (!resizer || !listPane || !inspector) return;

  let startX, startW;
  resizer.addEventListener('mousedown', e => {
    // Pointer travel is CSS px; × the app zoom it is screen px, the unit the
    // width is kept in (appZoom lives in app.js — read at drag time only).
    const zoom = (typeof appZoom !== 'undefined' && appZoom.current) || 1;
    startX = e.clientX;
    startW = inspector.getBoundingClientRect().width * zoom;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    let lastW = startW;
    const onMove = ev => {
      lastW = applyInspectorWidth(startW + (startX - ev.clientX) * zoom) ?? lastW;
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // One write per drag, at the end — not one per mousemove.
      applyInspectorWidth(lastW, { persist: true });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}
