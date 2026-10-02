/**
 * FilePlus Home screen: Recent + Favorites data loading/rendering, hover
 * actions (Open / Reveal in Browser / Copy path), the Favorites star
 * unfavorite+undo flow, drag-to-reorder for Favorites, and the small helpers
 * app.js's dispatch switch and context-menu wiring call into.
 *
 * Script load order is api.js → filetypes.js → icons-sprite.js →
 * iconCache.js → icons.js → fileops.js → browser.js → dragdrop.js →
 * search.js → inspector.js → home.js → settings.js → properties.js → app.js
 * (see index.html; CLAUDE.md's module-order bullet) — this file can
 * call anything defined in an earlier file at parse time (iconFor,
 * escapeHtml, parentOfPath, formatModified, ApiError,
 * formatApiError), but anything defined later in app.js (showSnackbar,
 * showToast, openBrowserAt, pathBaseName, selectRow, contextMenuTarget) is
 * only safe to reference from inside functions that run after DOMContentLoaded,
 * never at this file's own top-level.
 */

// ── Favorites membership ──────────────────────────────────────────────────
// Kept in sync by loadFavorites() (full refresh) and the home-row context
// menu's add/remove toggle (optimistic single-path update). Read by
// app.js's context-menu label/enabled predicates (Add vs Remove from
// Favorites) and by browser.js's renderFsRow (the row star).
//
// Both favoritesSet and favoritesPathToId are keyed by favoritesNormalize(p)
// (lowercased) so a Browser row's exact-case path (Windows paths are
// case-insensitive but not normalized on disk) still matches a favorite
// stored with whatever case it was first added under. Callers that need the
// exact-case path for an API call (DELETE /favorites?path=, POST /favorites)
// keep using the row's own dataset.path / entry.path — never a normalized one.
const favoritesSet = new Set();
const favoritesPathToId = new Map(); // normalized path -> favorite row id (GET /favorites)

function favoritesNormalize(path) { return String(path || '').toLowerCase(); }

/** True if `path` (any case) is currently favorited. The one function every
 * other module reuses (browser.js's row star, app.js's context-menu
 * enabled/label predicates, and per the Task 11 brief, Task 12's drag badge
 * and Task 14's search-result rows) instead of touching favoritesSet
 * directly. */
function favoritesHas(path) { return favoritesSet.has(favoritesNormalize(path)); }

/** The favorite row's own id for `path`, if it is favorited — sourced from
 * the same GET /favorites response that fills favoritesSet, so a caller
 * never needs a second fetch just to resolve a path to its favorites-table
 * row. (This app's DELETE /favorites route takes ?path=, not an id, so nothing
 * in this pass actually calls this for a delete — it's exposed alongside
 * favoritesHas for parity, and because callers that already have a path
 * shouldn't need to guess whether an id lookup requires re-fetching.) */
function favoritesIdFor(path) { return favoritesPathToId.get(favoritesNormalize(path)); }

/** Re-fetches /favorites (favoritesSet/favoritesPathToId + the Favorites
 * pane). Thin, named alias over loadFavorites() so callers outside this file
 * (app.js's cm-favorite handler) go through the documented contract name
 * rather than reaching for the loader function directly. */
function favoritesReload() { return loadFavorites(); }

/** Re-paints the favorite star on every ALREADY-RENDERED row that shows one —
 * Home's Recent rows and the Browser listing — from the current favoritesSet.
 *
 * loadFavorites() rewrites only #home-favorites, so a star toggled in one pane
 * used to leave the other pane's rows stale indefinitely (switchScreen
 * ('browser') deliberately does not re-fetch a tab that already has a path),
 * with the row and its own context-menu label contradicting each other
 * (pass 2 #52). This is markup surgery, not a re-fetch: those rows are already
 * correct apart from one glyph. */
function syncFavoriteStars() {
  const starHtml = `<span class="fp-row__star" title="In Favorites">${icon('star')}</span>`;
  document.querySelectorAll('#list-scroll .fp-row[data-path], #home-recent .fp-row[data-path]').forEach(row => {
    const has = favoritesHas(row.dataset.path);
    const existing = row.querySelector('.fp-row__star');
    if (has === !!existing) return;
    if (!has) { existing.remove(); return; }
    // Recent rows hang the star in their reserved .fp-row__tags cell; a
    // Browser row is a flex row whose star sits between the name and the size
    // column (see renderRecentRow / renderFsRow).
    const tagsCell = row.classList.contains('fp-row--recent') ? row.querySelector('.fp-row__tags') : null;
    const sizeCell = tagsCell ? null : row.querySelector('.fp-row__size');
    if (tagsCell) tagsCell.insertAdjacentHTML('beforeend', starHtml);
    else if (sizeCell) sizeCell.insertAdjacentHTML('beforebegin', starHtml);
    else row.insertAdjacentHTML('beforeend', starHtml);
  });
}

// ── Icons (hover-action buttons + favorite star) ──────────────────────────
const HOME_ICON_OPEN = icon('open', 'fp-icon--14');
const HOME_ICON_REVEAL = icon('reveal', 'fp-icon--14');
const HOME_ICON_COPY = icon('copy', 'fp-icon--14');
// Filled star, tinted accent (favorited state) — unfavoriteFile() below swaps
// this <use> to the outline 'star' symbol for its brief pre-removal animation.
const HOME_ICON_STAR = `<svg class="fp-icon fp-icon--14 fp-row__fav-star-icon" aria-hidden="true" style="color:var(--accent)"><use href="#fp-star-filled"></use></svg>`;

/** Recent/Favorites entries carry a real is_dir from the API (backend/
 * stores.py stats the path; a directory also answers ext '' whatever its
 * name — pass 2 #36: "my.folder" used to render as a file and share the
 * per-extension icon key with real ".folder" files). ext === '' stays the
 * fallback for an older backend that did not send the flag. The same
 * decision drives Open behaviour (openBrowserAt vs openPath). Everything
 * past that is iconFor()'s job (icons.js): the file-type family sprite, the
 * named folder variants, or a real Windows shell icon when ui.icon_source
 * says so. */
function homeIsDir(entry) {
  return typeof entry.is_dir === 'boolean' ? entry.is_dir : entry.ext === '';
}
function homeIconFor(entry) {
  // Asked for at the size the panes actually draw it (40 px tiles when a
  // pane is in its own grid layout, styles.css — never the Browser's view),
  // so a Windows-mode request is the bucket of the real box and its cache
  // lookup matches the lazy path's (Stage 2D §4.3).
  const size = document.querySelector('.home-pane[data-view="grid"]') ? 40 : 16;
  return iconFor({ ...entry, is_dir: homeIsDir(entry) }, size, 'fp-row__icon');
}

// ── Empty states (existing .fp-empty-state pattern) ───────────────────────
const HOME_RECENT_EMPTY_HTML = `<div class="fp-empty-state" role="status" aria-live="polite">
  ${icon('history', 'fp-icon--48 fp-empty-state__icon')}
  <p class="fp-empty-state__title">No recent files yet</p>
</div>`;

const HOME_FAVORITES_EMPTY_HTML = `<div class="fp-empty-state" role="status" aria-live="polite">
  ${icon('star', 'fp-icon--48 fp-empty-state__icon')}
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
  // parentOfPath() already ends a drive root in a separator ("C:\"), so
  // appending one unconditionally spelled it "C:\\" (pass 2 #166).
  const parentRaw = parentOfPath(entry.path);
  const parentDisplay = parentRaw.endsWith('\\') ? parentRaw : parentRaw + '\\';
  // Same show_extensions handling as browser.js's renderFsRow: folders (see
  // homeIsDir's note above) never hide anything; files hide the extension
  // in the rendered label only, with the full name kept as a tooltip.
  const isDir = homeIsDir(entry);
  const hideExt = !isDir && entry.ext !== '' && browserState.showExtensions === false;
  const displayName = hideExt ? stemOf(entry.name) : entry.name;
  const nameTitleAttr = hideExt ? ` title="${escapeHtml(entry.name)}"` : '';
  const dirAttr = isDir ? ' data-dir=""' : '';
  // Recent rows show the same favorite star as Browser rows (Task 11,
  // playtest pass 1 §4.3) — rendered into .fp-row__tags (already an empty,
  // flex-laid-out cell reserved for this row's own grid-template-columns)
  // rather than as a new grid child, so no column count/width changes.
  const starHtml = favoritesHas(entry.path)
    ? `<span class="fp-row__star" title="In Favorites">${icon('star')}</span>`
    : '';
  // tabindex -1 on the row and its buttons: homeRovingSync() makes ONE row
  // per pane the tab stop, and the hover buttons (invisible until hover) are
  // never Tab targets — the row's context menu carries the same actions
  // (pass 2 #170).
  return `<div class="fp-row fp-row--recent" role="option" tabindex="-1"
       data-path="${escapeHtml(entry.path)}" data-ext="${escapeHtml(entry.ext)}"${dirAttr} data-action="open-recent-file">
    ${homeIconFor(entry)}
    <span class="fp-row__name" data-full="${escapeHtml(entry.name)}"${nameTitleAttr}>${escapeHtml(displayName)}</span>
    <span class="fp-row__recent-path mono">${escapeHtml(parentDisplay)}</span>
    <span class="fp-row__recent-time mono">${escapeHtml(entry.action)} ${escapeHtml(timeLabel)}</span>
    <div class="fp-row__tags">${starHtml}</div>
    <div class="fp-row__hover-actions">
      <button class="fp-icon-btn fp-icon-btn--sm" tabindex="-1" data-action="open-file" title="Open">${HOME_ICON_OPEN}</button>
      <button class="fp-icon-btn fp-icon-btn--sm" tabindex="-1" data-action="reveal-file" title="Reveal in Browser">${HOME_ICON_REVEAL}</button>
      <button class="fp-icon-btn fp-icon-btn--sm" tabindex="-1" data-action="copy-path" title="Copy path">${HOME_ICON_COPY}</button>
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
  // parentOfPath() already ends a drive root in a separator ("C:\"), so
  // appending one unconditionally spelled it "C:\\" (pass 2 #166).
  const parentRaw = parentOfPath(entry.path);
  const parentDisplay = parentRaw.endsWith('\\') ? parentRaw : parentRaw + '\\';
  const addedLabel = entry.created ? `Added ${formatModified(entry.created)}` : '';
  const isDir = homeIsDir(entry);
  const hideExt = !isDir && entry.ext !== '' && browserState.showExtensions === false;
  const displayName = hideExt ? stemOf(entry.name) : entry.name;
  const nameTitleAttr = hideExt ? ` title="${escapeHtml(entry.name)}"` : '';
  const dirAttr = isDir ? ' data-dir=""' : '';
  return `<div class="fp-row fp-row--recent" role="option" tabindex="-1" draggable="true"
       data-path="${escapeHtml(entry.path)}" data-ext="${escapeHtml(entry.ext)}"${dirAttr} data-action="open-recent-file">
    ${homeIconFor(entry)}
    <span class="fp-row__name" data-full="${escapeHtml(entry.name)}"${nameTitleAttr}>${escapeHtml(displayName)}</span>
    <span class="fp-row__recent-path mono">${escapeHtml(parentDisplay)}</span>
    <span class="fp-row__recent-time mono">${escapeHtml(addedLabel)}</span>
    <button class="fp-icon-btn fp-icon-btn--sm fp-row__fav-star" tabindex="-1" data-action="unfavorite-file"
            data-path="${escapeHtml(entry.path)}" title="Remove from favorites">
      ${HOME_ICON_STAR}
    </button>
  </div>`;
}

// ── Roving focus (pass 2 #170) ─────────────────────────────────────────────
// Each pane (Recent, Favorites) is ONE tab stop: the row last focused there,
// else its first row. Up/Down/Home/End move between rows (homeKeydown).
// Before this every row and every hidden hover button was a tab stop — up to
// 800 presses to cross the Recent pane.
function homePaneRows(pane) {
  return pane ? [...pane.querySelectorAll('.fp-row[data-path]')] : [];
}
function homeRovingSync(pane, stop) {
  const rows = homePaneRows(pane);
  const target = (stop && rows.includes(stop)) ? stop : rows[0];
  for (const r of rows) r.tabIndex = r === target ? 0 : -1;
}
/** Replaces a pane's rows, keeping its tab stop (and DOM focus, when it was
 * on one of the rows) on the same path. */
function homeRerender(container, html) {
  const active = document.activeElement;
  const hadFocus = !!active && container.contains(active);
  const stopPath = container.querySelector('.fp-row[data-path][tabindex="0"]')?.dataset.path;
  container.innerHTML = html;
  const stop = stopPath ? homePaneRows(container).find(r => r.dataset.path === stopPath) : null;
  homeRovingSync(container, stop);
  if (hadFocus) (stop || homePaneRows(container)[0])?.focus({ preventScroll: true });
}

/** Row text cut short by its column gets the full text as a tooltip; text
 * that fits gets none (Explorer's rule, as browser.js's syncTruncationTitle
 * does for the file list — pass 2 #60). A name whose extension is hidden
 * always shows the full name (data-full). */
function homeSyncTruncationTitle(el) {
  const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  const shown = el.textContent.trim();
  const full = el.dataset.full || shown;
  if (cut || full !== shown) el.title = full;
  else el.removeAttribute('title');
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
  homeRerender(container, groups.length ? groups.map(renderRecentSection).join('') : HOME_RECENT_EMPTY_HTML);
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
    favoritesPathToId.clear();
    container.innerHTML = HOME_FAVORITES_EMPTY_HTML;
    return;
  }
  const files = (data && data.files) || [];
  favoritesSet.clear();
  favoritesPathToId.clear();
  files.forEach(f => {
    const norm = favoritesNormalize(f.path);
    favoritesSet.add(norm);
    favoritesPathToId.set(norm, f.id);
  });
  homeRerender(container, files.length ? files.map(renderFavoriteRow).join('') : HOME_FAVORITES_EMPTY_HTML);
  // Every other pane that draws a star reads favoritesSet at render time, so
  // whoever just changed it has to repaint them (pass 2 #52).
  syncFavoriteStars();
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
  return row ? { path: row.dataset.path, ext: row.dataset.ext || '', is_dir: homeRowIsDir(row) } : null;
}

/** A rendered Home row's directory-ness: the data-dir the API's is_dir put
 * there, else the ext === '' heuristic (an older backend). */
function homeRowIsDir(row) {
  return row.dataset.dir !== undefined || (row.dataset.ext || '') === '';
}

/** Open behavior shared by double-click, Enter-when-focused, the Open hover
 * action, and the home-row context menu's Open item: folders navigate into
 * the Browser, files launch via the OS and get logged as a recent action. */
function homeOpenPath(path, ext, isDir) {
  if (!path) return;
  if (isDir === undefined ? ext === '' : isDir) {
    openBrowserAt(path);
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
  const loaded = openBrowserAt(parent);
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
  const norm = favoritesNormalize(path);
  if (favoritesSet.has(norm)) {
    favoritesSet.delete(norm);
    API.del('/favorites', { path })
      .then(() => { showToast('Removed from Favorites', 'default'); favoritesReload(); })
      .catch(err => {
        favoritesSet.add(norm);
        showToast(`Failed to remove favorite: ${formatApiError(err)}`, 'error');
      });
  } else {
    favoritesSet.add(norm);
    API.post('/favorites', { path })
      .then(() => { showToast('Added to Favorites', 'default'); favoritesReload(); })
      .catch(err => {
        favoritesSet.delete(norm);
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
  // Filled -> outline star swap (the sprite's two-symbol favorited/not-favorited
  // pair) stands in for the old fill/stroke-attribute animation on a single
  // hand-drawn <path>.
  const starUse = el.querySelector('svg.fp-icon use');
  const norm = favoritesNormalize(path);

  // Capture the full favorites order (including this row) BEFORE removal so
  // Undo can restore this row's exact position via /favorites/reorder.
  const orderSnapshot = [...document.querySelectorAll('#home-favorites .fp-row[data-path]')]
    .map(r => r.dataset.path);

  favoritesSet.delete(norm);

  if (starUse) starUse.setAttribute('href', '#fp-star');
  row.classList.add('fp-row--unfavoriting');

  function restoreRow() {
    if (!row.parentElement) parent.insertBefore(row, nextSibling);
    row.classList.remove('fp-row--unfavoriting');
    if (starUse) starUse.setAttribute('href', '#fp-star-filled');
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
      favoritesSet.add(norm);
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
    favoritesSet.add(norm);
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

/** Clears the Home screen's row selection (Recent + Favorites panes both —
 * only one row is ever selected at a time today, see the 'open-recent-file'
 * click case in app.js) and collapses the inspector back to its "No file
 * selected" state. Home has no selection Set of its own (a row's
 * .fp-row--selected class IS its selection state), so this is a plain DOM
 * sweep — the deselect-anywhere handler (app.js) calls it for the Home
 * screen the same way browser.js's clearSelection() covers Browser. */
function homeClearSelection() {
  document.querySelectorAll('#screen-home .fp-row--selected').forEach(r => r.classList.remove('fp-row--selected'));
  // The inspector belongs to the Browser screen: resetting it to "No file
  // selected" from here wiped a live Browser selection's panel even though
  // that selection had not changed. Hand it back to whatever the Browser has
  // selected instead (pass 2 #75) — which IS updateInspector('none') when the
  // Browser has nothing selected.
  if (typeof syncInspectorToBrowserSelection === 'function') syncInspectorToBrowserSelection();
  else if (typeof updateInspector === 'function') updateInspector('none');
}

/** Double-click on any Home row (Recent or Favorites) opens it — delegated
 * on #screen-home so it survives loadRecent()/loadFavorites() re-renders. */
function initHomeRowInteractions() {
  const screen = document.getElementById('screen-home');
  if (!screen) return;
  screen.addEventListener('dblclick', e => {
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) return;
    homeOpenPath(row.dataset.path, row.dataset.ext || '', homeRowIsDir(row));
  });
  // A row that gets focus (click, arrow, Tab) becomes its pane's tab stop.
  screen.addEventListener('focusin', e => {
    const row = e.target.closest && e.target.closest('.fp-row[data-path]');
    if (row && e.target === row) homeRovingSync(row.closest('#home-recent, #home-favorites'), row);
  });
  screen.addEventListener('pointerover', e => {
    const el = e.target.closest && e.target.closest('.fp-row__name, .fp-row__recent-path, .fp-row__recent-time');
    if (el && screen.contains(el)) homeSyncTruncationTitle(el);
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
  // Inert behind any dialog, like the Browser's keys (pass 2 #53).
  if (typeof anyScrimOpen === 'function' && anyScrimOpen()) return;
  // A button inside the row (reachable by mouse only now) acts as itself.
  if (active !== row) return;
  if (!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const pane = row.closest('#home-recent, #home-favorites');
    const rows = homePaneRows(pane);
    const i = rows.indexOf(row);
    const grid = !!row.closest('.home-pane[data-view="grid"]');
    let next = null;
    if (e.key === 'ArrowDown' || (grid && e.key === 'ArrowRight')) next = rows[i + 1];
    else if (e.key === 'ArrowUp' || (grid && e.key === 'ArrowLeft')) next = rows[i - 1];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows[rows.length - 1];
    if (next !== null) {
      e.preventDefault();
      if (next) { homeRovingSync(pane, next); next.focus(); next.scrollIntoView({ block: 'nearest' }); }
      return;
    }
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    homeOpenPath(row.dataset.path, row.dataset.ext || '', homeRowIsDir(row));
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
