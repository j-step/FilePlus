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
// Bumped by every open and close: a GET /fs/properties that answers after a
// newer open (Alt+Enter on another item) or after the panel was closed must
// not paint — or re-open — the panel for the earlier item (spec §12 sweep).
let _propsSeq = 0;
// The folder type the panel LOADED (renderFolderTypeSelect's own `current`),
// not whatever the <select> resolved to. desktop.ini can hold a FolderType
// outside the five options below, in which case no <option> is selected and
// the element reports 'Generic' — which propertiesApply() then read as "the
// user picked Generic" and wrote over the real value (pass 2 #78).
let _propsFolderTypeLoaded = null;

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
 * round, so no parenthetical duplicate).
 *
 * `partial` prefixes '≥ ', for a folder whose recursive walk hit
 * winshell.contains_counts' time budget: the byte total that comes back is
 * whatever it had summed so far (the same partial sum `Contains` already
 * hedges with '≥'), and printing it as an exact grouped byte count claimed a
 * precision the backend never had — a re-open gave a different "exact"
 * number depending on disk speed. */
function formatPropSize(bytes, partial) {
  if (bytes == null) return '—';
  const n = Number(bytes);
  const prefix = partial ? '≥ ' : '';
  const grouped = `${n.toLocaleString()} bytes`;
  if (n < 1024) return `${prefix}${grouped}`;
  let label;
  if (n < 1048576) label = `${(n / 1024).toFixed(2)} KB`;
  else if (n < 1073741824) label = `${(n / 1048576).toFixed(2)} MB`;
  else label = `${(n / 1073741824).toFixed(2)} GB`;
  return `${prefix}${label} (${grouped})`;
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
  // A /fs/list entry carries only its name: without the path a Windows-mode
  // icon has nothing to ask the shell about and fell back to the FilePlus
  // sprite (Stage 2D §4.6).
  if (existing) return { ...existing, path: props.path };
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

  const seq = ++_propsSeq;
  let props;
  try {
    props = await API.get('/fs/properties', { path });
  } catch (err) {
    if (seq !== _propsSeq) return;
    showToast(`Failed to load properties: ${formatApiError(err)}`, 'error');
    return;
  }
  if (seq !== _propsSeq) return;

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
  fpSetScrim(scrim, true);
  // Re-measure now the modal is actually laid out: offsetLeft/offsetWidth are
  // 0 while it is display:none, so the reset above could only park the
  // underline at width 0.
  moveTabIndicator(document.getElementById('properties-tabs'));
}

function closeProperties() {
  const scrim = document.getElementById('properties-modal-scrim');
  if (!scrim) return;
  fpSetScrim(scrim, false);
  _propsSeq++;
  _propsPath = null;
  _propsData = null;
  _propsEntry = null;
  _propsFolderTypeLoaded = null;
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
  // Keep the accent underline with the active class -- this function is also
  // called programmatically (openProperties resets to General), where no
  // click ever reaches initUnderlineTabs' own listener.
  moveTabIndicator(document.getElementById('properties-tabs'));
  if (name === 'details' && !_propsDetailsLoaded) loadPropertiesDetails();
}

// ── General tab ──────────────────────────────────────────────────────────────

function renderPropertiesHeader() {
  const nameInput = document.getElementById('properties-name-input');
  paintPropertiesIcon();
  if (nameInput) nameInput.value = _propsData.name;
}

/** The header icon: the item's TYPE icon at 32 px, never its thumbnail
 * (Stage 2D §4.6) — a .png shows the PNG file-type icon. In Windows mode it
 * is resolved at once (fpResolveIconsNow) rather than by the lazy observer,
 * which cannot be trusted inside this dialog. */
function paintPropertiesIcon() {
  const iconEl = document.getElementById('properties-icon');
  if (!iconEl) return;
  iconEl.innerHTML = fpTypeIconFor(_propsEntry, 32);
  fpResolveIconsNow(iconEl);
}

/** Repaints the header icon (and the "Opens with" icon) of an open panel
 * after ui.icon_source changed — called by refreshIconSurfaces (settings.js).
 * No-op when the panel is closed. */
function propertiesRefreshIcon() {
  if (!_propsPath || !_propsEntry) return;
  paintPropertiesIcon();
  if (_propsData && !_propsData.is_dir) loadOpensWithIcon(_propsData);
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

/** Fills in the "Opens with" app icon: always the Windows shell icon of the
 * associated .exe, through the same pipeline and cache as a row icon (Tier A,
 * then the Electron bridge; the executable sprite only if both fail), at the
 * 16-px box's px bucket. Resolved at once, like the header icon — the lazy
 * observer cannot be trusted inside this dialog. */
let _propsAppIconUrl = null;
function loadOpensWithIcon(props) {
  const el = document.getElementById('properties-opens-with-icon');
  if (!el) return;
  if (_propsAppIconUrl) { URL.revokeObjectURL(_propsAppIconUrl); _propsAppIconUrl = null; }
  if (props.opens_with_exe) {
    el.innerHTML = fpShellIconMarkup({ path: props.opens_with_exe, ext: 'exe', is_dir: false }, 16, 'ft-executable');
    fpResolveIconsNow(el);
    return;
  }
  // No app at all: no icon slot (the label says "Unknown application").
  el.hidden = !props.opens_with;
  if (!props.opens_with) return;
  // A Store app (Photos, Media Player) has no executable: the generic app
  // glyph at once, swapped for the app's own icon image when the backend
  // named one (Task 14 Q10 — the slot used to stay empty).
  el.innerHTML = icon('ft-executable', 'fp-icon--16 fp-icon--compact');
  if (!props.opens_with_icon) return;
  const want = props.path;
  API.blob('/preview', { path: props.opens_with_icon }).then(async (res) => {
    if (!(res.headers.get('content-type') || '').startsWith('image/')) return;
    const blob = await res.blob();
    if (!_propsData || _propsData.path !== want || !el.isConnected) return;
    _propsAppIconUrl = URL.createObjectURL(blob);
    el.innerHTML = `<img alt="" src="${_propsAppIconUrl}">`;
  }).catch(() => { /* the glyph stays */ });
}

function renderFolderTypeSelect(props) {
  const current = props.folder_type || props.folder_type_detected || 'Generic';
  const isDetected = !props.folder_type;
  _propsFolderTypeLoaded = current;
  let options = PROPS_FOLDER_TYPES.map(t => {
    const label = (isDetected && t.value === current) ? `${t.label} (detected)` : t.label;
    const selected = t.value === current ? ' selected' : '';
    return `<option value="${t.value}"${selected}>${escapeHtml(label)}</option>`;
  }).join('');
  // Windows accepts any FolderType string (Contacts, Music.Artist, a custom
  // GUID-backed template…). Report the truth as its own selected option
  // instead of silently showing "General items" for it.
  if (!PROPS_FOLDER_TYPES.some(t => t.value === current)) {
    options += `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}${isDetected ? ' (detected)' : ''}</option>`;
  }
  return `<select class="fp-input" id="properties-folder-type-select" data-action="props-folder-type-select">${options}</select>`;
}

function renderGeneral(props) {
  const grid = document.getElementById('properties-general-grid');
  if (!grid) return;
  const rows = [];
  const row = (label, valueHtml) => rows.push(`<dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd>`);

  if (props.is_dir) {
    // A truncated walk makes size, size_on_disk and contains all lower
    // bounds — they come from the same abandoned sum.
    const partial = !!(props.contains && props.contains.truncated);
    row('Type', escapeHtml(props.type_description || 'File folder'));
    row('Location', escapeHtml(props.location));
    row('Size', escapeHtml(formatPropSize(props.size, partial)));
    row('Size on disk', escapeHtml(formatPropSize(props.size_on_disk, partial)));
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
    // Latch only the permanent answer: 503 means pywin32 is missing on this
    // PC and no re-activation can change that. A 502 (a COM failure on a
    // locked file, say) is transient — leaving the latch set meant the tab
    // never retried for the life of the modal (pass 2 #151).
    const permanent = (err instanceof ApiError && err.status === 503);
    _propsDetailsLoaded = permanent;
    const msg = permanent
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
  const seq = _propsSeq;
  let fresh;
  try {
    fresh = await API.get('/fs/properties', { path });
  } catch (err) {
    if (seq !== _propsSeq) return;
    showToast(`Failed to refresh properties: ${formatApiError(err)}`, 'error');
    return;
  }
  // Closed (or re-opened on another item) while Apply's refresh was out.
  if (seq !== _propsSeq) return;
  _propsPath = fresh.path;
  _propsData = fresh;
  _propsEntry = propsEntryFrom(fresh);
  // The Details tab caches its fetch behind _propsDetailsLoaded. After an
  // Apply that renamed the item, that cache described the OLD path and
  // switchPropertiesTab('details') refused to re-fetch, so Details kept
  // showing the pre-rename file — Name, Item type and all (pass 2 #151).
  _propsDetailsLoaded = false;
  const detailsEl = document.getElementById('properties-details-content');
  if (detailsEl) detailsEl.innerHTML = '';
  renderPropertiesHeader();
  renderGeneral(fresh);
  // Re-fetch now if Details is the pane the user is actually looking at —
  // otherwise the next activation does it.
  const detailsPane = document.querySelector('.properties__pane[data-pane="details"]');
  if (detailsPane && !detailsPane.hidden) loadPropertiesDetails();
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
    // Compare against what the select was RENDERED with (pass 2 #78), never
    // against props alone: an unrepresented value used to leave the element
    // reporting the first option, which read as a change the user never made.
    const currentType = _propsFolderTypeLoaded;
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
