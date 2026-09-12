/**
 * FilePlus Home screen: Recent + Favorites data loading/rendering, hover
 * actions (Open / Reveal in Browser / Copy path), the Favorites star
 * unfavorite+undo flow, drag-to-reorder for Favorites, and the small helpers
 * app.js's dispatch switch and context-menu wiring call into.
 *
 * Script load order is api.js → fileops.js → browser.js → inspector.js →
 * home.js → settings.js → app.js (see index.html) — this file can call
 * anything defined in api.js/browser.js at parse time (iconForExt,
 * escapeHtml, parentOfPath, formatModified, ICON_FOLDER, ApiError,
 * formatApiError), but anything defined later in app.js (showSnackbar,
 * showToast, openBrowserAt, pathBaseName, selectRow, contextMenuTarget) is
 * only safe to reference from inside functions that run after DOMContentLoaded,
 * never at this file's own top-level.
 */

// ── Favorites membership ──────────────────────────────────────────────────
// Kept in sync by loadFavorites() (full refresh) and the home-row context
// menu's add/remove toggle (optimistic single-path update). Read by
// getMenuTypeForTarget's context-menu label (Add vs Remove from Favorites).
const favoritesSet = new Set();

// ── Icons (hover-action buttons + favorite star) ──────────────────────────
const HOME_ICON_OPEN = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11 8v3H2V2h3M8 1h4v4M5 9l5.5-5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const HOME_ICON_REVEAL = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M1 6h12M4 3V1.5h6V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const HOME_ICON_COPY = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="4" y="4" width="8" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M2 10V2h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const HOME_ICON_STAR = `<svg width="14" height="14" viewBox="0 0 14 14" fill="var(--accent)" aria-hidden="true"><path d="M7 1l1.8 3.6L13 5.3l-3 2.9.7 4.1L7 10.4l-3.7 1.9.7-4.1-3-2.9 4.2-.7z"/></svg>`;

/** Recent/Favorites entries never carry an is_dir flag from the API (neither
 * /recent nor /favorites join the files table for it) — ext === '' is the
 * best available signal that a path is a folder rather than an
 * extension-less file, so it's used consistently for icon choice and for
 * deciding Open behavior (openPath vs loadDirectory). */
function homeIconFor(ext) {
  return ext === '' ? ICON_FOLDER : iconForExt(ext);
}

// ── Empty states (existing .fp-empty-state pattern) ───────────────────────
const HOME_RECENT_EMPTY_HTML = `<div class="fp-empty-state" role="status" aria-live="polite">
  <svg class="fp-empty-state__icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="2"/>
    <path d="M24 14v10l6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <p class="fp-empty-state__title">No recent files yet</p>
</div>`;

const HOME_FAVORITES_EMPTY_HTML = `<div class="fp-empty-state" role="status" aria-live="polite">
  <svg class="fp-empty-state__icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M24 4l5.4 10.9L42 17l-9 8.7 2.1 12.3L24 32.4l-11.1 5.6L15 25.7 6 17l12.6-2.1z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  </svg>
  <p class="fp-empty-state__title">No favorites yet — right-click a file or folder and choose Add to Favorites</p>
</div>`;

// ── Time-label rules (ledger) ──────────────────────────────────────────────
// today/yesterday -> HH:mm (24h, local); this-week -> weekday name; every
// month/year bucket (earlier-this-month, last-month, earlier-this-year,
// year-<N>) -> "Mon D"; ancient -> "in YYYY". action_at is an ISO UTC
// timestamp from the backend; `new Date(iso)` converts it to local time.
function formatRecentTime(actionAt, bucketKey) {
  const d = new Date(actionAt);
  if (isNaN(d)) return '';
  if (bucketKey === 'today' || bucketKey === 'yesterday') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (bucketKey === 'this-week') {
    return d.toLocaleDateString([], { weekday: 'long' });
  }
  if (bucketKey === 'ancient') {
    return `in ${d.getFullYear()}`;
  }
  // earlier-this-month, last-month, earlier-this-year, year-<N>
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── Row/section templates ──────────────────────────────────────────────────
function renderRecentRow(entry, bucketKey) {
  const timeLabel = formatRecentTime(entry.action_at, bucketKey);
  const parentDisplay = parentOfPath(entry.path) + '\\';
  // Same show_extensions handling as browser.js's renderFsRow: folders (ext
  // === '', see homeIconFor's note above) never hide anything; files hide the
  // extension in the rendered label only, with the full name kept as a tooltip.
  const hideExt = entry.ext !== '' && browserState.showExtensions === false;
  const displayName = hideExt ? stemOf(entry.name) : entry.name;
  const nameTitleAttr = hideExt ? ` title="${escapeHtml(entry.name)}"` : '';
  return `<div class="fp-row fp-row--recent" role="option" tabindex="0"
       data-path="${escapeHtml(entry.path)}" data-ext="${escapeHtml(entry.ext)}" data-action="open-recent-file">
    ${homeIconFor(entry.ext)}
    <span class="fp-row__name"${nameTitleAttr}>${escapeHtml(displayName)}</span>
    <span class="fp-row__recent-path mono">${escapeHtml(parentDisplay)}</span>
    <span class="fp-row__recent-time mono">${escapeHtml(entry.action)} ${escapeHtml(timeLabel)}</span>
    <div class="fp-row__tags"></div>
    <div class="fp-row__hover-actions">
      <button class="fp-icon-btn fp-icon-btn--sm" data-action="open-file" title="Open">${HOME_ICON_OPEN}</button>
      <button class="fp-icon-btn fp-icon-btn--sm" data-action="reveal-file" title="Reveal in Browser">${HOME_ICON_REVEAL}</button>
      <button class="fp-icon-btn fp-icon-btn--sm" data-action="copy-path" title="Copy path">${HOME_ICON_COPY}</button>
    </div>
  </div>`;
}

function renderRecentSection(group) {
  const rows = (group.files || []).map(f => renderRecentRow(f, group.key)).join('');
  return `<div class="home-section">
    <div class="home-section__head"><span class="home-section__title">${escapeHtml(group.label)}</span></div>
    ${rows}
  </div>`;
}

function renderFavoriteRow(entry) {
  const parentDisplay = parentOfPath(entry.path) + '\\';
  const addedLabel = entry.created ? `Added ${formatModified(entry.created)}` : '';
  const hideExt = entry.ext !== '' && browserState.showExtensions === false;
  const displayName = hideExt ? stemOf(entry.name) : entry.name;
  const nameTitleAttr = hideExt ? ` title="${escapeHtml(entry.name)}"` : '';
  return `<div class="fp-row fp-row--recent" role="option" tabindex="0" draggable="true"
       data-path="${escapeHtml(entry.path)}" data-ext="${escapeHtml(entry.ext)}" data-action="open-recent-file">
    ${homeIconFor(entry.ext)}
    <span class="fp-row__name"${nameTitleAttr}>${escapeHtml(displayName)}</span>
    <span class="fp-row__recent-path mono">${escapeHtml(parentDisplay)}</span>
    <span class="fp-row__recent-time mono">${escapeHtml(addedLabel)}</span>
    <button class="fp-icon-btn fp-icon-btn--sm fp-row__fav-star" data-action="unfavorite-file"
            data-path="${escapeHtml(entry.path)}" title="Remove from favorites">
      ${HOME_ICON_STAR}
    </button>
  </div>`;
}

// ── Data loading ────────────────────────────────────────────────────────────
/** GET /recent?limit=200 -> sections per group, in payload order. Called
 * whenever the Home screen is shown (see app.js's showScreenDom) and once at
 * init. Failures render the empty state rather than a toast — a Home screen
 * that can't reach the backend should look empty, not throw an error at the
 * user for something they didn't do. */
async function loadRecent() {
  const container = document.getElementById('home-recent');
  if (!container) return;
  let data;
  try {
    data = await API.get('/recent', { limit: 200 });
  } catch (err) {
    container.innerHTML = HOME_RECENT_EMPTY_HTML;
    return;
  }
  const groups = (data && data.groups) || [];
  container.innerHTML = groups.length ? groups.map(renderRecentSection).join('') : HOME_RECENT_EMPTY_HTML;
}

/** GET /favorites -> flat, manually-ordered row list. Refreshes favoritesSet
 * every call so the home-row context menu's Add/Remove label stays accurate. */
async function loadFavorites() {
  const container = document.getElementById('home-favorites');
  if (!container) return;
  let data;
  try {
    data = await API.get('/favorites');
  } catch (err) {
    favoritesSet.clear();
    container.innerHTML = HOME_FAVORITES_EMPTY_HTML;
    return;
  }
  const files = (data && data.files) || [];
  favoritesSet.clear();
  files.forEach(f => favoritesSet.add(f.path));
  container.innerHTML = files.length ? files.map(renderFavoriteRow).join('') : HOME_FAVORITES_EMPTY_HTML;
}

// ── Open / Reveal / Copy path (hover actions + home-row context menu) ──────
/** Resolves the {path, ext} a hover-action button or the home-row context
 * menu should act on: the button's own row ancestor (hover-action buttons
 * live inside the row) falling back to the row the right-click landed on
 * (context-menu buttons render into #context-menu, outside the row, so they
 * carry no useful ancestor — contextMenuTarget, captured at contextmenu time
 * in app.js, is a descendant of the row itself). */
function resolveHomeRowTarget(btn) {
  const fromBtn = btn && btn.closest && btn.closest('.fp-row[data-path]');
  const fromContext = !fromBtn && typeof contextMenuTarget !== 'undefined' && contextMenuTarget
    && contextMenuTarget.closest && contextMenuTarget.closest('.fp-row[data-path]');
  const row = fromBtn || fromContext;
  return row ? { path: row.dataset.path, ext: row.dataset.ext || '' } : null;
}

/** Open behavior shared by double-click, Enter-when-focused, the Open hover
 * action, and the home-row context menu's Open item: folders navigate into
 * the Browser, files launch via the OS and get logged as a recent action. */
function homeOpenPath(path, ext) {
  if (!path) return;
  if (ext === '') {
    openBrowserAt(path, pathBaseName(path) || undefined);
    return;
  }
  const openPath = window.electronAPI?.openPath;
  if (openPath) {
    Promise.resolve(openPath(path)).then(result => { if (result) showToast(result, 'error'); })
      .catch(err => showToast(formatApiError(err), 'error'));
  }
  API.post('/recent', { path, action: 'opened' }).catch(() => { /* best-effort logging */ });
}

/** Reveal in Browser: opens the row's parent folder, then selects the row
 * once that directory listing has actually landed (loadDirectory returns
 * its promise via openBrowserAt). */
function homeRevealInBrowser(path) {
  if (!path) return;
  const parent = parentOfPath(path);
  const loaded = openBrowserAt(parent, pathBaseName(parent) || undefined);
  Promise.resolve(loaded).then(() => selectRow(path));
}

function homeCopyPath(path) {
  if (!path) return;
  window.electronAPI?.clipboardWriteText?.(path);
  showSnackbar('Path copied');
}

// ── Favorites: add/remove toggle (home-row context menu) ───────────────────
/** Adds or removes `path` from favorites depending on current membership.
 * Used by the home-row context menu's single "Add/Remove from Favorites"
 * item (label is set dynamically at contextmenu time — see app.js). */
function homeToggleFavorite(path) {
  if (!path) return;
  if (favoritesSet.has(path)) {
    favoritesSet.delete(path);
    API.del('/favorites', { path })
      .then(() => { showToast('Removed from Favorites', 'default'); loadFavorites(); })
      .catch(err => {
        favoritesSet.add(path);
        showToast(`Failed to remove favorite: ${formatApiError(err)}`, 'error');
      });
  } else {
    favoritesSet.add(path);
    API.post('/favorites', { path })
      .then(() => { showToast('Added to Favorites', 'default'); loadFavorites(); })
      .catch(err => {
        favoritesSet.delete(path);
        showToast(`Failed to favorite: ${formatApiError(err)}`, 'error');
      });
  }
}

/**
 * Visual+undo unfavorite handler for the Favorites star button.
 * On the 200ms removal timer: the row leaves the DOM and DELETE
 * /favorites?path= fires. Undo (before or after that timer) always restores
 * the row visually; if the DELETE had already gone out, Undo additionally
 * re-adds the favorite (POST /favorites) and restores its exact prior
 * position via POST /favorites/reorder against a snapshot captured before
 * removal. A DELETE failure is treated as its own implicit "undo": the row
 * and favoritesSet are restored and an error toast is shown.
 */
function unfavoriteFile(el) {
  const row = el?.closest('.fp-row');
  if (!row) return;
  const path = row.dataset.path;
  const parent = row.parentElement;
  const nextSibling = row.nextElementSibling;
  const filename = row.querySelector('.fp-row__name')?.textContent || 'File';
  const starPath = el.querySelector('svg path');
  const origFill = starPath?.getAttribute('fill');
  const origStroke = starPath?.getAttribute('stroke');
  const origStrokeWidth = starPath?.getAttribute('stroke-width');

  // Capture the full favorites order (including this row) BEFORE removal so
  // Undo can restore this row's exact position via /favorites/reorder.
  const orderSnapshot = [...document.querySelectorAll('#home-favorites .fp-row[data-path]')]
    .map(r => r.dataset.path);

  favoritesSet.delete(path);

  if (starPath) {
    starPath.setAttribute('fill', 'none');
    starPath.setAttribute('stroke', 'var(--accent)');
    starPath.setAttribute('stroke-width', '1.2');
  }
  row.classList.add('fp-row--unfavoriting');

  function restoreRow() {
    if (!row.parentElement) parent.insertBefore(row, nextSibling);
    row.classList.remove('fp-row--unfavoriting');
    if (starPath) {
      origFill === null ? starPath.removeAttribute('fill') : starPath.setAttribute('fill', origFill);
      origStroke === null ? starPath.removeAttribute('stroke') : starPath.setAttribute('stroke', origStroke);
      origStrokeWidth === null ? starPath.removeAttribute('stroke-width') : starPath.setAttribute('stroke-width', origStrokeWidth);
    }
  }

  let deleted = false;
  let _deletePromise = null;
  const removeTimer = setTimeout(() => {
    row.remove();
    deleted = true;
    _deletePromise = API.del('/favorites', { path });
    _deletePromise.catch(err => {
      // The server never dropped it — put it back and surface the failure
      // instead of silently leaving the UI out of sync with the backend.
      deleted = false;
      favoritesSet.add(path);
      restoreRow();
      showToast(`Failed to remove favorite: ${formatApiError(err)}`, 'error');
    });
  }, 200);

  // Script load order is api.js → fileops.js → browser.js → inspector.js →
  // home.js → settings.js → app.js (see index.html), so app.js's
  // function showSnackbar(message, undoLabel, onUndo) is already defined by
  // the time this runs. Call with the 3-arg signature.
  showSnackbar(`Removed "${filename}" from favorites`, 'Undo', async () => {
    clearTimeout(removeTimer);
    favoritesSet.add(path);
    restoreRow();
    if (deleted) {
      // The DELETE may still be in flight (Undo clicked right after the
      // 200ms timer fired) — wait for it to actually settle before
      // re-adding, otherwise a slow DELETE resolving after this POST would
      // wipe out the just-restored favorite. Its own .catch above already
      // reconciles `deleted`/favoritesSet/the row on failure; this await
      // just sequences after that, ignoring the rejection itself.
      if (_deletePromise) await _deletePromise.catch(() => {});
      if (!deleted) return; // the delete failed and already reconciled everything
      API.post('/favorites', { path })
        .then(() => API.post('/favorites/reorder', { paths: orderSnapshot }))
        .catch(err => showToast(`Failed to restore favorite: ${formatApiError(err)}`, 'error'));
    }
  });
}

// ── Favorites reorder: drag-and-drop + Alt+Up/Down ─────────────────────────
/** Persists the current DOM order of #home-favorites to the server. On
 * failure, the DOM has already moved (drag/drop and Alt+Up/Down both
 * reorder optimistically) but the server hasn't — re-pulling via
 * loadFavorites() resyncs the DOM back to the server's actual order rather
 * than leaving the UI showing an order that never took. */
function persistFavoritesOrder() {
  const paths = [...document.querySelectorAll('#home-favorites .fp-row[data-path]')].map(r => r.dataset.path);
  API.post('/favorites/reorder', { paths }).catch(err => {
    showToast(`Failed to save favorites order: ${formatApiError(err)}`, 'error');
    loadFavorites();
  });
}

function _clearFavoritesDropIndicators(container) {
  container.querySelectorAll('.fp-row--drop-before, .fp-row--drop-after').forEach(r => {
    r.classList.remove('fp-row--drop-before', 'fp-row--drop-after');
  });
}

/** HTML5 drag-and-drop reorder for Favorites rows. Delegated on the
 * container (not per-row) so it keeps working across loadFavorites()
 * re-renders without needing to be re-attached. */
function initFavoritesDragDrop() {
  const container = document.getElementById('home-favorites');
  if (!container) return;
  let dragPath = null;

  container.addEventListener('dragstart', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) { e.preventDefault(); return; }
    dragPath = row.dataset.path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragPath);
  });

  container.addEventListener('dragend', () => {
    dragPath = null;
    _clearFavoritesDropIndicators(container);
  });

  container.addEventListener('dragover', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row || row.dataset.path === dragPath) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    container.querySelectorAll('.fp-row[data-path]').forEach(r => {
      if (r !== row) r.classList.remove('fp-row--drop-before', 'fp-row--drop-after');
    });
    row.classList.toggle('fp-row--drop-before', before);
    row.classList.toggle('fp-row--drop-after', !before);
  });

  container.addEventListener('dragleave', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (row && !row.contains(e.relatedTarget)) row.classList.remove('fp-row--drop-before', 'fp-row--drop-after');
  });

  container.addEventListener('drop', e => {
    e.preventDefault();
    const row = e.target.closest('.fp-row[data-path]');
    const before = row?.classList.contains('fp-row--drop-before');
    _clearFavoritesDropIndicators(container);
    if (!row || !dragPath || row.dataset.path === dragPath) return;
    const draggedRow = [...container.querySelectorAll('.fp-row[data-path]')].find(r => r.dataset.path === dragPath);
    if (!draggedRow) return;
    if (before) container.insertBefore(draggedRow, row);
    else container.insertBefore(draggedRow, row.nextElementSibling);
    persistFavoritesOrder();
  });
}

/** Double-click on any Home row (Recent or Favorites) opens it — delegated
 * on #screen-home so it survives loadRecent()/loadFavorites() re-renders. */
function initHomeRowInteractions() {
  const screen = document.getElementById('screen-home');
  if (!screen) return;
  screen.addEventListener('dblclick', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) return;
    homeOpenPath(row.dataset.path, row.dataset.ext || '');
  });
}

/**
 * Home-screen keyboard shortcuts, called from app.js's global keydown
 * handler only when the Home screen is active and no input/textarea/
 * contenteditable has focus: Enter opens the focused row (Recent or
 * Favorites); Alt+Up/Down on a focused Favorites row swaps it with its
 * neighbor and persists the new order.
 */
function homeKeydown(e) {
  const active = document.activeElement;
  const row = active && active.closest && active.closest('.fp-row[data-path]');
  if (!row) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    homeOpenPath(row.dataset.path, row.dataset.ext || '');
    return;
  }
  if (e.altKey && row.closest('#home-favorites') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const sib = e.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
    if (!sib || !sib.classList.contains('fp-row')) return;
    if (e.key === 'ArrowUp') row.parentElement.insertBefore(row, sib);
    else row.parentElement.insertBefore(sib, row);
    row.focus();
    persistFavoritesOrder();
  }
}
