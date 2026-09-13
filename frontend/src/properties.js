/**
 * FilePlus Properties panel — General/Details tabs for a single file or
 * folder (design spec §5.1), replacing the old openModal('warn', …) stub
 * that showed a warning icon and a plain key: value dump.
 *
 * openProperties(path) is the sole entry point: in `windows` mode
 * (ui.properties_mode) it hands off to the native dialog via
 * electronAPI.showProperties(); otherwise it fetches GET /fs/properties,
 * renders the General tab, and opens #properties-modal-scrim. The Details
 * tab lazy-loads GET /fs/properties/details on its first activation.
 *
 * Event wiring (click delegation, change delegation for the checkboxes/
 * select, the backdrop click, Escape) lives in app.js alongside every other
 * data-action case — this file owns rendering, fetching and the Apply
 * sequence only. propertiesMarkDirty()/switchPropertiesTab() are called
 * from app.js's delegated handlers.
 */

// ── Module state — the single item currently shown ─────────────────────────
let _propsPath = null;     // GET /fs/properties's own `path` (updates after a rename)
let _propsData = null;     // last-fetched /fs/properties response
let _propsEntry = null;    // {name, path, is_dir, ext} for iconFor()
let _propsDetailsLoaded = false;

const PROPS_FOLDER_TYPES = [
  { value: 'Generic',   label: 'General items' },
  { value: 'Documents', label: 'Documents' },
  { value: 'Pictures',  label: 'Pictures' },
  { value: 'Videos',    label: 'Videos' },
  { value: 'Music',     label: 'Music' },
];

// ── Formatting (Explorer-style — distinct from browser.js's row formatters,
// which are tuned for a narrow list column rather than a Properties row) ───

/** '1.23 MB (1,289,748 bytes)' — under 1 KB is just 'N bytes' (nothing to
 * round, so no parenthetical duplicate). */
function formatPropSize(bytes) {
  if (bytes == null) return '—';
  const n = Number(bytes);
  const grouped = `${n.toLocaleString()} bytes`;
  if (n < 1024) return grouped;
  let label;
  if (n < 1048576) label = `${(n / 1024).toFixed(2)} KB`;
  else if (n < 1073741824) label = `${(n / 1048576).toFixed(2)} MB`;
  else label = `${(n / 1073741824).toFixed(2)} GB`;
  return `${label} (${grouped})`;
}

/** 'Thursday, September 11, 2026, 4:12:03 PM' from an epoch-seconds float
 * (GET /fs/properties's created/modified/accessed). */
function formatPropDate(epochSeconds) {
  if (epochSeconds == null) return '—';
  const d = new Date(epochSeconds * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

/** '12 files, 3 folders' ('≥ …' once the walk hit its time budget). */
function formatPropContains(contains) {
  if (!contains) return '—';
  const prefix = contains.truncated ? '≥ ' : '';
  const files = `${contains.files} file${contains.files === 1 ? '' : 's'}`;
  const folders = `${contains.folders} folder${contains.folders === 1 ? '' : 's'}`;
  return `${prefix}${files}, ${folders}`;
}

/** The {name, path, is_dir, ext} shape iconFor() wants. Prefers the already-
 * loaded browser row (browser.js's entryForPath) so a Windows-icon-source
 * header repaints the same way a row would; falls back to deriving `ext`
 * from the name for a target outside the current listing (e.g. a Home row,
 * or the Inspector's "…" menu after navigating away). */
function propsEntryFrom(props) {
  const existing = typeof entryForPath === 'function' ? entryForPath(props.path) : null;
  if (existing) return existing;
  const dot = props.name.lastIndexOf('.');
  const ext = !props.is_dir && dot > 0 ? props.name.slice(dot) : '';
  return { name: props.name, path: props.path, is_dir: props.is_dir, ext };
}

/** The path of the item the panel currently shows, or null — read by app.js's
 * 'props-open-with'/'props-advanced' cases instead of reaching into this
 * file's own _propsPath directly (kept private, like inspector.js's
 * _inspectorFileId/_inspectorEntry). */
function propertiesCurrentPath() { return _propsPath; }

// ── Open / close ─────────────────────────────────────────────────────────────

/** Entry point for every "Properties" affordance (context menus, the
 * Inspector's "…" menu, Alt+Enter). `ui.properties_mode === 'windows'`
 * routes to the native dialog instead of fetching/rendering anything here. */
async function openProperties(path) {
  if (!path) return;
  const cfg = window.__fpConfig || {};
  if (cfg['ui.properties_mode'] === 'windows') {
    const ok = await window.electronAPI?.showProperties?.(path);
    if (!ok) showToast('Failed to open Properties', 'error');
    return;
  }

  let props;
  try {
    props = await API.get('/fs/properties', { path });
  } catch (err) {
    showToast(`Failed to load properties: ${formatApiError(err)}`, 'error');
    return;
  }

  _propsPath = props.path;
  _propsData = props;
  _propsEntry = propsEntryFrom(props);
  _propsDetailsLoaded = false;
  const detailsEl = document.getElementById('properties-details-content');
  if (detailsEl) detailsEl.innerHTML = '';

  renderPropertiesHeader();
  renderGeneral(props);
  switchPropertiesTab('general');
  const applyBtn = document.getElementById('properties-apply');
  if (applyBtn) applyBtn.disabled = true;

  const scrim = document.getElementById('properties-modal-scrim');
  if (scrim) { scrim.style.display = 'flex'; scrim.removeAttribute('aria-hidden'); }
}

function closeProperties() {
  const scrim = document.getElementById('properties-modal-scrim');
  if (!scrim) return;
  scrim.style.display = 'none';
  scrim.setAttribute('aria-hidden', 'true');
  _propsPath = null;
  _propsData = null;
  _propsEntry = null;
}

/** Enables Apply — called from app.js's delegated 'input'/'change' handlers
 * the moment the name field, an attribute checkbox, or the folder-type
 * select is touched. "Touched" (not "differs from the loaded value") is
 * deliberate: it matches Explorer's own Apply/OK behaviour and needs no
 * per-field before/after diff just to light the button up — propertiesApply()
 * itself still only sends the fields that actually changed. */
function propertiesMarkDirty() {
  const applyBtn = document.getElementById('properties-apply');
  if (applyBtn) applyBtn.disabled = false;
}

function switchPropertiesTab(name) {
  const modal = document.getElementById('properties-modal');
  if (!modal) return;
  modal.querySelectorAll('.fp-properties__tab').forEach(t => {
    t.classList.toggle('fp-tabs__item--active', t.dataset.tab === name);
  });
  modal.querySelectorAll('.properties__pane').forEach(p => {
    p.hidden = p.dataset.pane !== name;
  });
  if (name === 'details' && !_propsDetailsLoaded) loadPropertiesDetails();
}

// ── General tab ──────────────────────────────────────────────────────────────

function renderPropertiesHeader() {
  const iconEl = document.getElementById('properties-icon');
  const nameInput = document.getElementById('properties-name-input');
  if (iconEl) iconEl.innerHTML = iconFor(_propsEntry, 24);
  if (nameInput) nameInput.value = _propsData.name;
}

function renderAttributesCell(props, keys, includeAdvanced) {
  const labels = { read_only: 'Read-only', hidden: 'Hidden', archive: 'Archive' };
  const boxes = keys.map(k => `
    <label class="properties__attr">
      <span class="fp-checkbox">
        <input type="checkbox" data-action="props-attr-toggle" data-attr="${k}"${props.attributes[k] ? ' checked' : ''}>
        <span class="fp-checkbox__mark"></span>
      </span>
      <span class="properties__attr-label">${escapeHtml(labels[k])}</span>
    </label>`).join('');
  const advanced = includeAdvanced
    ? `<button type="button" class="fp-btn fp-btn--secondary fp-btn--sm" data-action="props-advanced">Advanced…</button>`
    : '';
  return `<div class="properties__attrs">${boxes}${advanced}</div>`;
}

function renderOpensWithCell(props) {
  const label = escapeHtml(props.opens_with || 'Unknown application');
  return `<div class="properties__opens-with">` +
    `<span class="properties__opens-with-icon" id="properties-opens-with-icon"></span>` +
    `<span class="properties__opens-with-label" title="${label}">${label}</span>` +
    `<button type="button" class="fp-btn fp-btn--secondary fp-btn--sm" data-action="props-open-with">Change…</button>` +
    `</div>`;
}

/** Fills in the "Opens with" app icon once electronAPI.fileIcon resolves —
 * separate from the lazy IntersectionObserver system in icons.js (this is a
 * single explicit icon, not a scrolling list of rows). Guards against a
 * since-closed or since-replaced modal before touching the DOM. */
function loadOpensWithIcon(props) {
  const el = document.getElementById('properties-opens-with-icon');
  if (!el || !props.opens_with_exe || !window.electronAPI?.fileIcon) return;
  window.electronAPI.fileIcon(props.opens_with_exe, 'exe', 16).then(dataUrl => {
    if (!dataUrl || _propsPath !== props.path) return;
    const el2 = document.getElementById('properties-opens-with-icon');
    if (!el2) return;
    el2.innerHTML = '';
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '';
    el2.appendChild(img);
  }).catch(() => { /* best-effort */ });
}

function renderFolderTypeSelect(props) {
  const current = props.folder_type || props.folder_type_detected;
  const isDetected = !props.folder_type;
  const options = PROPS_FOLDER_TYPES.map(t => {
    const label = (isDetected && t.value === current) ? `${t.label} (detected)` : t.label;
    const selected = t.value === current ? ' selected' : '';
    return `<option value="${t.value}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
  return `<select class="fp-input" id="properties-folder-type-select" data-action="props-folder-type-select">${options}</select>`;
}

function renderGeneral(props) {
  const grid = document.getElementById('properties-general-grid');
  if (!grid) return;
  const rows = [];
  const row = (label, valueHtml) => rows.push(`<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`);

  if (props.is_dir) {
    row('Type', escapeHtml(props.type_description || 'File folder'));
    row('Location', escapeHtml(props.location));
    row('Size', escapeHtml(formatPropSize(props.size)));
    row('Size on disk', escapeHtml(formatPropSize(props.size_on_disk)));
    row('Contains', escapeHtml(formatPropContains(props.contains)));
    row('Created', escapeHtml(formatPropDate(props.created)));
    row('Attributes', renderAttributesCell(props, ['read_only', 'hidden', 'archive'], false));
    row('Optimize this folder for', renderFolderTypeSelect(props));
  } else {
    row('Type of file', escapeHtml(props.type_description || '—'));
    row('Opens with', renderOpensWithCell(props));
    row('Location', escapeHtml(props.location));
    row('Size', escapeHtml(formatPropSize(props.size)));
    row('Size on disk', escapeHtml(formatPropSize(props.size_on_disk)));
    row('Created', escapeHtml(formatPropDate(props.created)));
    row('Modified', escapeHtml(formatPropDate(props.modified)));
    row('Accessed', escapeHtml(formatPropDate(props.accessed)));
    row('Attributes', renderAttributesCell(props, ['read_only', 'hidden'], true));
  }

  grid.innerHTML = rows.join('');
  if (!props.is_dir) loadOpensWithIcon(props);
}

// ── Details tab ──────────────────────────────────────────────────────────────

async function loadPropertiesDetails() {
  const container = document.getElementById('properties-details-content');
  if (!container || !_propsPath) return;
  const path = _propsPath;
  container.innerHTML = `<p class="properties__details-empty">Loading…</p>`;
  let res;
  try {
    res = await API.get('/fs/properties/details', { path });
  } catch (err) {
    if (_propsPath !== path) return; // modal moved on to a different item
    _propsDetailsLoaded = true;
    const msg = (err instanceof ApiError && err.status === 503)
      ? 'Details need pywin32 on this PC'
      : `Failed to load details: ${formatApiError(err)}`;
    container.innerHTML = `<p class="properties__details-empty">${escapeHtml(msg)}</p>`;
    return;
  }
  if (_propsPath !== path) return;
  _propsDetailsLoaded = true;
  renderDetails(res.details || []);
}

function renderDetails(details) {
  const container = document.getElementById('properties-details-content');
  if (!container) return;
  if (!details || !details.length) {
    container.innerHTML = `<p class="properties__details-empty">No details available.</p>`;
    return;
  }
  const groups = new Map();
  details.forEach(row => {
    const g = row.group || 'General';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(row);
  });
  let html = '';
  groups.forEach((rows, group) => {
    html += `<div class="properties__details-group">${escapeHtml(group)}</div>`;
    html += `<dl class="properties__details-list">`;
    rows.forEach(r => {
      html += `<div class="properties__details-row"><dt>${escapeHtml(r.name)}</dt><dd>${escapeHtml(String(r.value))}</dd></div>`;
    });
    html += `</dl>`;
  });
  container.innerHTML = html;
}

// ── Apply ────────────────────────────────────────────────────────────────────

/** Re-fetches and re-renders the panel for `path` — used both after Apply
 * (design spec: "modal stays open with refreshed data") and nowhere else,
 * since nothing but Apply changes the item out from under an open panel. */
async function reloadProperties(path) {
  let fresh;
  try {
    fresh = await API.get('/fs/properties', { path });
  } catch (err) {
    showToast(`Failed to refresh properties: ${formatApiError(err)}`, 'error');
    return;
  }
  _propsPath = fresh.path;
  _propsData = fresh;
  _propsEntry = propsEntryFrom(fresh);
  renderPropertiesHeader();
  renderGeneral(fresh);
  const applyBtn = document.getElementById('properties-apply');
  if (applyBtn) applyBtn.disabled = true;
}

/**
 * Apply sequence (design spec §5.1/§5.4): rename first (fileops.rename, so
 * it's undoable and the listing/selection follow it the same way F2 does),
 * then attributes, then folder-type — each awaited, each routed through
 * fileops.run() so a batch id lands on the undo stack and Ctrl+Z/History
 * work exactly like every other mutation. A step that fails is toasted (by
 * fileops.run itself) and simply skipped; the remaining steps still run
 * against whatever the current path is (only a successful rename moves it).
 */
async function propertiesApply() {
  if (!_propsData || !_propsPath) return;
  const applyBtn = document.getElementById('properties-apply');
  if (applyBtn) applyBtn.disabled = true;

  let currentPath = _propsPath;

  const nameInput = document.getElementById('properties-name-input');
  const newName = nameInput ? nameInput.value.trim() : '';
  if (newName && newName !== _propsData.name) {
    try {
      const res = await fileops.rename(currentPath, newName);
      const dest = res && res.ops && res.ops[0] && res.ops[0].dest;
      if (dest) currentPath = dest;
    } catch (_err) { /* fileops.run already toasted */ }
  }

  const attrKeys = _propsData.is_dir ? ['read_only', 'hidden', 'archive'] : ['read_only', 'hidden'];
  const attrPayload = {};
  document.querySelectorAll('#properties-general-grid input[data-action="props-attr-toggle"]').forEach(inp => {
    const key = inp.dataset.attr;
    if (attrKeys.includes(key) && inp.checked !== _propsData.attributes[key]) attrPayload[key] = inp.checked;
  });
  if (Object.keys(attrPayload).length) {
    try {
      await fileops.run('Changed attributes', async () => {
        const res = await API.post('/fs/attributes', { path: currentPath, ...attrPayload });
        return { batch_id: res.batch_id, ops: res.op ? [res.op] : [] };
      });
    } catch (_err) { /* fileops.run already toasted */ }
  }

  if (_propsData.is_dir) {
    const select = document.getElementById('properties-folder-type-select');
    const currentType = _propsData.folder_type || _propsData.folder_type_detected;
    if (select && select.value && select.value !== currentType) {
      try {
        await fileops.run('Set folder type', async () => {
          const res = await API.post('/fs/folder-type', { path: currentPath, type: select.value });
          return { batch_id: res.batch_id, ops: res.op ? [res.op] : [] };
        });
      } catch (_err) { /* fileops.run already toasted */ }
    }
  }

  if (typeof refreshDirectory === 'function') await refreshDirectory();
  await reloadProperties(currentPath);
}
