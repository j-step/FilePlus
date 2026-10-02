/**
 * FilePlus This PC page (Stage 2D §8): every drive on the PC as a card — the
 * drive's icon, its full name as Explorer writes it ("Label (C:)"), a usage
 * bar and "X free of Y" underneath.
 *
 * It lives in the Browser pane (#thispc-view, a sibling of #list-scroll) under
 * the path sentinel THISPC (browser.js): loadDirectory(THISPC) lands here, so
 * it is in history, in tab records and in the breadcrumb like any folder. It
 * never sends THISPC to the backend; the data is GET /drives.
 *
 * The drive model and its formatter (driveDisplayName, driveFreeText,
 * driveUsedFraction) are shared with the sidebar's This PC list
 * (app.js renderDriveItem) and the drive breadcrumb crumb, so the two can
 * never name or measure a drive differently.
 *
 * Loaded after browser.js (THISPC, formatSize, escapeHtml, nearestAcross,
 * pageTarget) and before app.js; only defines things at top level.
 */

// Ctrl+wheel order, smaller to larger: the details-style list, then tiles.
const THISPC_LAYOUTS = ['details', 'tiles'];
const THISPC_VIEW_KEY = 'ui.thispc_view';
// Above this share used, the bar turns --bad (Explorer turns it red at 90%).
const THISPC_FULL_SHARE = 0.9;
// The card icon in each layout (logical px).
const THISPC_ICON_PX = { tiles: 48, details: 16 };

// The drives on screen and the one selected card (by mount). Drive cards are
// single-select, and the selection is the keyboard cursor too.
const thisPcState = { drives: [], selected: null };

// ── The shared drive model ───────────────────────────────────────────────────

// What Explorer calls an unlabelled drive of each kind.
const DRIVE_KIND_NAMES = { fixed: 'Local Disk', removable: 'USB Drive', network: 'Network Drive', cdrom: 'CD Drive' };
// The details list's Type column.
const DRIVE_KIND_TYPES = { fixed: 'Local Disk', removable: 'Removable Disk', network: 'Network Drive', cdrom: 'CD Drive' };

/** "C:" from a /drives item. */
function driveLetterOf(d) {
  return String((d && (d.letter || d.mount)) || '').replace(/[\\/]+$/, '').toUpperCase();
}

/** The drive's name as Explorer writes it: "Label (C:)", or the kind's own
 * name when it has no label — "Local Disk (C:)". */
function driveDisplayName(d) {
  const label = String((d && d.label) || '').trim();
  return `${label || DRIVE_KIND_NAMES[d && d.kind] || DRIVE_KIND_NAMES.fixed} (${driveLetterOf(d)})`;
}

function driveTypeText(d) {
  return DRIVE_KIND_TYPES[d && d.kind] || DRIVE_KIND_TYPES.fixed;
}

/** True when the drive answered with its sizes (a disconnected network drive
 * comes back with nulls after the backend's probe timeout). */
function driveHasSize(d) {
  return !!d && Number.isFinite(d.total_bytes) && d.total_bytes > 0 && Number.isFinite(d.free_bytes);
}

/** Share of the drive in use, 0–1, or null when its sizes are unknown. */
function driveUsedFraction(d) {
  if (!driveHasSize(d)) return null;
  const used = Number.isFinite(d.used_bytes) ? d.used_bytes : d.total_bytes - d.free_bytes;
  return Math.min(1, Math.max(0, used / d.total_bytes));
}

/** "120.3 GB free of 237.0 GB", or "Unavailable". */
function driveFreeText(d) {
  return driveHasSize(d) ? `${formatSize(d.free_bytes)} free of ${formatSize(d.total_bytes)}` : 'Unavailable';
}

/** The bar's fill width in %, one decimal (0 when unknown). */
function drivePercentUsed(d) {
  const f = driveUsedFraction(d);
  return f == null ? 0 : Math.round(f * 1000) / 10;
}

function driveIsNearlyFull(d) {
  const f = driveUsedFraction(d);
  return f != null && f > THISPC_FULL_SHARE;
}

/** A card's usage bar and the muted "X free of Y" under it. */
function driveUsageMarkup(d) {
  const pct = drivePercentUsed(d);
  const known = driveUsedFraction(d) != null;
  const value = known ? ` aria-valuenow="${pct}" aria-valuetext="${pct}% used"` : ' aria-valuetext="Unavailable"';
  return `<div class="fp-drive-card__bar" role="meter" aria-label="Space used" aria-valuemin="0" aria-valuemax="100"${value}>`
    + `<div class="fp-drive-card__bar-fill${driveIsNearlyFull(d) ? ' fp-drive-card__bar-fill--full' : ''}" style="width:${pct}%"></div></div>`
    + `<span class="fp-drive-card__free">${escapeHtml(driveFreeText(d))}</span>`;
}

// ── Layout (tiles / details) ─────────────────────────────────────────────────

function thisPcLayout() {
  return (window.__fpConfig || {})[THISPC_VIEW_KEY] === 'details' ? 'details' : 'tiles';
}

/** A View-menu choice on This PC: the list-like views mean the details list,
 * everything else the tiles. */
function thisPcLayoutForView(key) {
  return (key === 'details' || key === 'list' || key === 'small') ? 'details' : 'tiles';
}

function setThisPcLayout(layout) {
  const next = THISPC_LAYOUTS.includes(layout) ? layout : 'tiles';
  if (next === thisPcLayout()) return false;
  saveSetting(THISPC_VIEW_KEY, next);
  renderThisPC();
  focusThisPcCursor({ onlyIfInside: true });
  return true;
}

/** Ctrl+wheel on This PC: one notch up is tiles, one down the details list. */
function stepThisPcLayout(delta) {
  const at = THISPC_LAYOUTS.indexOf(thisPcLayout());
  const next = Math.max(0, Math.min(THISPC_LAYOUTS.length - 1, at + Math.sign(delta || 0)));
  if (next === at) return false;
  return setThisPcLayout(THISPC_LAYOUTS[next]);
}

// ── Showing the page ─────────────────────────────────────────────────────────

/** Shows the This PC page in the Browser pane (on) or the folder listing
 * (off). The two never show at once. */
function setThisPcShown(on) {
  const pane = document.getElementById('list-pane');
  if (pane) pane.classList.toggle('list-pane--thispc', !!on);
  const view = document.getElementById('thispc-view');
  if (view) view.hidden = !on;
}

function thisPcGrid() {
  return document.getElementById('thispc-drives');
}

function thisPcCards() {
  const grid = thisPcGrid();
  return grid ? [...grid.querySelectorAll(':scope > .fp-drive-card')] : [];
}

function thisPcCardFor(path) {
  return thisPcCards().find(c => c.dataset.path === path) || null;
}

function driveCardHtml(d, layout) {
  const path = String(d.mount || '');
  const name = driveDisplayName(d);
  const icon = fpShellItemIcon({ path, is_dir: true }, THISPC_ICON_PX[layout] || 48, 'drive');
  return `<div class="fp-drive-card" role="option" tabindex="-1" aria-selected="false"
      data-path="${escapeHtml(path)}" data-kind="${escapeHtml(d.kind || '')}" aria-label="${escapeHtml(name)}">
    <span class="fp-drive-card__icon">${icon}</span>
    <span class="fp-drive-card__name">${escapeHtml(name)}</span>
    <span class="fp-drive-card__type">${escapeHtml(driveTypeText(d))}</span>
    ${driveUsageMarkup(d)}
  </div>`;
}

/** Brings an existing card up to date without rebuilding it (its icon is
 * never touched, so it never repaints). */
function patchDriveCard(card, d) {
  const name = driveDisplayName(d);
  const setText = (sel, text) => { const el = card.querySelector(sel); if (el && el.textContent !== text) el.textContent = text; };
  setText('.fp-drive-card__name', name);
  setText('.fp-drive-card__type', driveTypeText(d));
  setText('.fp-drive-card__free', driveFreeText(d));
  if (card.getAttribute('aria-label') !== name) card.setAttribute('aria-label', name);
  card.dataset.kind = d.kind || '';
  const bar = card.querySelector('.fp-drive-card__bar');
  const fill = card.querySelector('.fp-drive-card__bar-fill');
  if (!bar || !fill) return;
  const pct = drivePercentUsed(d);
  const width = `${pct}%`;
  if (fill.style.width !== width) fill.style.width = width;
  fill.classList.toggle('fp-drive-card__bar-fill--full', driveIsNearlyFull(d));
  if (driveUsedFraction(d) != null) {
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuetext', `${pct}% used`);
  } else {
    bar.removeAttribute('aria-valuenow');
    bar.setAttribute('aria-valuetext', 'Unavailable');
  }
}

/**
 * Paints `drives` as cards in the current layout. When the same drives are
 * already on screen in the same layout, each card is patched in place (a
 * refresh, or the revalidation after a cached paint, never rebuilds a card
 * or repaints its icon); otherwise the cards are built once.
 */
function renderThisPC(drives = thisPcState.drives) {
  thisPcState.drives = Array.isArray(drives) ? drives : [];
  const grid = thisPcGrid();
  if (!grid) return;
  const layout = thisPcLayout();
  const head = document.getElementById('thispc-head');
  if (head) head.hidden = layout !== 'details';
  const cards = thisPcCards();
  const mounts = thisPcState.drives.map(d => String(d.mount || ''));
  const same = grid.dataset.layout === layout && cards.length === mounts.length
    && cards.every((c, i) => c.dataset.path === mounts[i]);
  grid.dataset.layout = layout;
  if (same) {
    thisPcState.drives.forEach((d, i) => patchDriveCard(cards[i], d));
  } else if (thisPcState.drives.length) {
    grid.innerHTML = thisPcState.drives.map(d => driveCardHtml(d, layout)).join('');
  } else {
    grid.innerHTML = `<div class="fp-empty-state thispc-view__empty">
      <p class="fp-empty-state__title">No drives found</p>
      <p class="fp-empty-state__desc">Refresh (F5) to look again.</p>
    </div>`;
  }
  if (thisPcState.selected && !mounts.includes(thisPcState.selected)) thisPcState.selected = null;
  applyThisPcSelection();
  updateThisPcStatus();
}

/** Selection classes plus a roving tabindex: the selected card (or the first
 * one) is the page's single tab stop. */
function applyThisPcSelection() {
  const cards = thisPcCards();
  const stop = thisPcState.selected || (cards[0] && cards[0].dataset.path);
  cards.forEach(c => {
    const sel = c.dataset.path === thisPcState.selected;
    c.classList.toggle('fp-drive-card--selected', sel);
    c.setAttribute('aria-selected', sel ? 'true' : 'false');
    c.tabIndex = c.dataset.path === stop ? 0 : -1;
  });
}

function updateThisPcStatus() {
  const countEl = document.getElementById('status-count');
  const selEl = document.getElementById('status-selected');
  const n = thisPcState.drives.length;
  if (countEl) countEl.textContent = n === 1 ? '1 drive' : `${n} drives`;
  if (selEl) selEl.textContent = thisPcState.selected ? '1 selected' : 'Nothing selected';
}

function thisPcSelectedPath() { return thisPcState.selected; }

/** For the tab record: the selection as a list, the shape tabs keep. */
function thisPcSelectionList() { return thisPcState.selected ? [thisPcState.selected] : []; }

function selectThisPcCard(path, { focus = true } = {}) {
  const card = thisPcCardFor(path);
  if (!card) return;
  thisPcState.selected = path;
  applyThisPcSelection();
  updateThisPcStatus();
  if (focus && document.activeElement !== card) card.focus({ preventScroll: true });
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function clearThisPcSelection() {
  if (!thisPcState.selected) return;
  thisPcState.selected = null;
  applyThisPcSelection();
  updateThisPcStatus();
}

/** Puts DOM focus on the card under the cursor. `onlyIfInside`: only when
 * focus already sat in the page (a layout change rebuilt the cards). */
function focusThisPcCursor({ onlyIfInside = false } = {}) {
  const view = document.getElementById('thispc-view');
  const active = document.activeElement;
  if (onlyIfInside && !(active === document.body || (view && view.contains(active)))) return;
  const card = (thisPcState.selected && thisPcCardFor(thisPcState.selected)) || thisPcCards()[0];
  if (card && active !== card) card.focus({ preventScroll: true });
}

/** Opens a drive in this tab. */
function openThisPcDrive(path) {
  if (path) loadDirectory(path);
}

/** The native drive Properties dialog (Explorer's own, with its pie chart). */
function thisPcProperties(path) {
  if (!path) return;
  Promise.resolve(window.electronAPI?.showProperties?.(path)).then(ok => {
    if (!ok) showToast('Failed to open Properties', 'error');
  }).catch(err => showToast(`Failed to open Properties: ${formatApiError(err)}`, 'error'));
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * loadDirectory(THISPC): commits the page. Drives already known (the sidebar
 * fetched them at startup) are painted at once — no empty frame on a tab
 * switch or Back — and GET /drives then brings them up to date in place.
 * Without them, the page commits when /drives answers; a failure is a failed
 * navigation like any other (failNavigation: the user keeps what they had).
 */
function loadThisPc({ addToHistory = true, restore = null, historyIndex = null, reqTabId, superseded, ownSearch = false, searchWasInFlight = false }) {
  const cached = Array.isArray(window.__fpDrives) ? window.__fpDrives : null;
  if (cached) commitThisPc(cached, { addToHistory, restore, historyIndex });
  window.__fpLoadPending++;
  return API.get('/drives', null, apiTimeout()).then(list => {
    if (!Array.isArray(list)) list = [];
    if (superseded()) { setDriveList(list); return; }
    if (cached) { setDriveList(list); return; }
    commitThisPc(list, { addToHistory, restore, historyIndex });
    setDriveList(list);
  }, err => {
    if (superseded()) return;
    browserState._pendingHistory = null;
    browserState._pendingExit = null;
    if (cached) { showToast(loadErrorMessage(err, THISPC), 'error'); return; }
    failNavigation(err, THISPC, { reqTabId, ownSearch, searchWasInFlight });
  }).finally(() => { window.__fpLoadPending--; });
}

/** Makes the This PC page the active tab's location: browserState, the tab
 * record, the chrome (label, breadcrumb, history) and one paint of the
 * cards. Mirrors commitListing() in browser.js. */
function commitThisPc(drives, { addToHistory = true, restore = null, historyIndex = null } = {}) {
  const from = browserState.listingTabId === tabs.activeId ? browserState.path : null;
  const pane = document.getElementById('list-pane');
  const hadFocus = !!(pane && pane.contains(document.activeElement));

  leaveSearchMode();
  if (!browserScreenActive()) showScreenDom('browser');
  // No folder rows wait under the page: a later folder paints from its own
  // tab record, never from what was left here.
  document.getElementById('list-scroll')?.replaceChildren();
  setListNotice('');

  browserState.path = THISPC;
  browserState.entries = [];
  browserState.parent = null;
  browserState.isRoot = true;
  browserState.truncated = false;
  browserState.fetchedAt = Date.now();
  browserState.listingTabId = tabs.activeId;
  browserState.listingStale = false;
  browserState._pendingHistory = null;
  browserState._pendingExit = null;
  browserState._orderDirty = false;
  browserState.selection = new Set();
  browserState.anchor = null;
  browserState.focus = null;

  const tab = activeTab();
  if (tab) {
    tab.path = THISPC;
    tab.screen = 'browser';
    tab.listing = null;
    tab.stale = false;
  }

  // What is selected: the tab's own selection when it is being restored;
  // else the drive just come up from (Up / Back from C:\ selects C:, as in
  // Explorer); else nothing.
  const mounts = (drives || []).map(d => String(d.mount || ''));
  const onDrive = (p) => mounts.find(m => p && fpNormalizePath(p).startsWith(fpNormalizePath(m))) || null;
  const restored = restore && Array.isArray(restore.selection) ? restore.selection.find(p => mounts.includes(p)) : null;
  thisPcState.selected = restored || (from && from !== THISPC ? onDrive(from) : null) || null;

  setThisPcShown(true);
  renderThisPC(drives);
  onNavigated(THISPC);
  if (historyIndex !== null && historyIndex >= 0 && historyIndex < nav.history.length) {
    nav.index = historyIndex;
    refreshNavButtons();
  } else if (addToHistory) pushHistory(THISPC);
  else refreshNavButtons();
  onSelectionChanged();

  const view = document.getElementById('thispc-view');
  if (view) view.scrollTop = restore ? (restore.scrollTop || 0) : 0;
  if (hadFocus) focusThisPcCursor();
}

/** Ctrl+R / F5 / Refresh on This PC: re-reads the drives and patches the
 * cards in place (selection and scroll stay). A failure keeps the cards and
 * says why. */
function refreshThisPc() {
  const reqTabId = tabs.activeId;
  const reqSeq = ++browserState._loadSeq;
  window.__fpLoadPending++;
  return API.get('/drives', null, apiTimeout()).then(list => {
    setDriveList(Array.isArray(list) ? list : []);
  }, err => {
    if (tabs.activeId !== reqTabId || browserState._loadSeq !== reqSeq) return;
    showToast(loadErrorMessage(err, THISPC), 'error');
  }).finally(() => { window.__fpLoadPending--; });
}

// ── Mouse and keyboard ───────────────────────────────────────────────────────

/** Arrow keys over the cards, by their rendered positions (spec §3.3): in
 * tiles ←/→ step through the cards and ↑/↓ go to the nearest card in the row
 * above/below; in the details list only ↑/↓ move. */
function moveThisPcCursor(dir, { focus = true } = {}) {
  const cards = thisPcCards();
  if (!cards.length) return;
  const cur = cards.findIndex(c => c.dataset.path === thisPcState.selected);
  if (cur === -1) { selectThisPcCard(cards[0].dataset.path, { focus }); return; }
  const tiles = thisPcLayout() === 'tiles';
  const rects = new Array(cards.length);
  const rectOf = (i) => rects[i] || (rects[i] = cards[i].getBoundingClientRect());
  const step = (d) => Math.max(0, Math.min(cards.length - 1, cur + d));
  let target = cur;
  if (dir === 'home') target = 0;
  else if (dir === 'end') target = cards.length - 1;
  else if (dir === 'left' || dir === 'right') {
    if (!tiles) return;
    target = step(dir === 'right' ? 1 : -1);
  } else if (dir === 'up' || dir === 'down') {
    target = tiles ? nearestAcross(cards.length, cur, rectOf, dir === 'down' ? 1 : -1, false) : step(dir === 'down' ? 1 : -1);
  } else if (dir === 'pageup' || dir === 'pagedown') {
    const view = document.getElementById('thispc-view');
    const page = Math.max(1, (view ? view.clientHeight : 0) - rectOf(cur).height);
    target = pageTarget(cards.length, cur, rectOf, dir === 'pagedown' ? 1 : -1, false, page);
  }
  if (target === cur || target < 0) { if (focus) focusThisPcCursor(); return; }
  selectThisPcCard(cards[target].dataset.path, { focus });
}

/** browserKeydown() hands every key here while This PC is on screen. The
 * file shortcuts (Ctrl+A/C/X/V, F2, Delete) have nothing to act on and are
 * left alone; undo / redo still reach the file history. */
function thisPcKeydown(e) {
  const key = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  const lower = key.toLowerCase();
  if (ctrl && !e.shiftKey && lower === 'z' && !e.repeat) { e.preventDefault(); fileops.undoLast(); return; }
  if (ctrl && !e.repeat && ((lower === 'y' && !e.shiftKey) || (lower === 'z' && e.shiftKey))) {
    e.preventDefault(); fileops.redoLast(); return;
  }
  // Ctrl+A has no files to select — and must not select the page's text.
  if (ctrl && lower === 'a') { e.preventDefault(); return; }
  if (ctrl) return;
  const dirs = {
    ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right',
    PageDown: 'pagedown', PageUp: 'pageup', Home: 'home', End: 'end',
  };
  if (dirs[key]) {
    // A key the tab strip already took still moves the cursor, but leaves
    // DOM focus on the strip (browserKeydown's rule for the file list).
    const keepFocus = e.defaultPrevented;
    e.preventDefault();
    moveThisPcCursor(dirs[key], { focus: !keepFocus });
    return;
  }
  if (key === 'Enter') { e.preventDefault(); openThisPcDrive(thisPcState.selected); return; }
  // Nothing sits above This PC, and there is nothing here to rename or delete.
  if (key === 'Backspace' || key === 'F2' || key === 'Delete') e.preventDefault();
}

/** Clicks, double-clicks, keyboard focus and the truncation tooltip on the
 * cards — wired once at startup (app.js). */
function initThisPcView() {
  const view = document.getElementById('thispc-view');
  if (!view) return;
  view.addEventListener('click', e => {
    const card = e.target.closest('.fp-drive-card[data-path]');
    if (!card) return;
    const clickMode = window.__fpConfig && window.__fpConfig['ui.click_mode'];
    if (clickMode === 'single' && !(e.ctrlKey || e.shiftKey || e.metaKey)) { openThisPcDrive(card.dataset.path); return; }
    selectThisPcCard(card.dataset.path);
  });
  view.addEventListener('dblclick', e => {
    const card = e.target.closest('.fp-drive-card[data-path]');
    if (card) openThisPcDrive(card.dataset.path);
  });
  // A card reached with Tab (or focused any other way) is the cursor.
  view.addEventListener('focusin', e => {
    const card = e.target.closest && e.target.closest('.fp-drive-card[data-path]');
    if (card && card.dataset.path !== thisPcState.selected) selectThisPcCard(card.dataset.path, { focus: false });
  });
  view.addEventListener('pointerover', e => {
    const el = e.target.closest && e.target.closest('.fp-drive-card__name, .fp-drive-card__free');
    if (el && view.contains(el)) syncTruncationTitle(el);
  });
}
