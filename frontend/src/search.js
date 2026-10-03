/**
 * FilePlus toolbar search (Stage 2C Task 14, design §8).
 *
 * One search surface: the toolbar bar. Focusing it opens #search-dropdown
 * (Filters + History); picking a filter adds a chip INSIDE the bar (Discord's
 * model); the text after the chips is the name query. Results render in the
 * Browser list (browser.js's renderSearchResults) with the matched substrings
 * wrapped in <mark>, never in a popup — so every row is a real .fp-row and
 * open / context menu / drag / favorites / properties / inspector all work on
 * a result exactly as they do on a folder listing.
 *
 * Two backends, one code path: scope `current`/a picked folder walks the tree
 * live (GET /fs/search); scope `pc` reads the index (GET /search), whose rows
 * are normalised into the live route's shape by normalizeIndexResults() so
 * the renderer never has to know which one answered.
 *
 * Load order note (CLAUDE.md): this file sits after browser.js and before
 * app.js, so browser.js's renderSearchResults/exitSearchResults are safe to
 * call at any time, while app.js's activeTab()/showToast()/switchScreen() are
 * only ever reached from inside a function that runs after DOMContentLoaded.
 */

// ── State ─────────────────────────────────────────────────────────────────────
// `scope` mirrors the `in:` chip: 'current' (browserState.path), 'pc' (the
// index), or an absolute folder path picked through "Choose folder…".
// `results`/`truncated`/`root`/`query` are the last rendered payload, kept here
// (not only in the DOM) so a tab switch can repaint them without re-fetching.
const searchState = {
  chips: [],            // [{key, value, label}] — at most one chip per key
  text: '',
  scope: 'current',     // 'current' | 'pc' | '<absolute path>'
  results: null,
  truncated: false,
  inflight: null,       // AbortController for the request in flight
  inflightQuery: null,  // {chips, text, scope} that request was for (failNavigation resumes it)
  historyKey: 'fp-search-history',
  root: null,           // what the last render searched ('*' for This PC)
  query: '',            // the q that produced searchState.results
  // Monotonic, bumped by every runSearch() before its first await. Paired
  // with tabs.activeId it is the same supersession guard loadDirectory()
  // carries: a response that resolves after a tab switch, or after a newer
  // search in the same tab, must not paint over whatever is current.
  _seq: 0,
};

const SEARCH_LIMIT = 500;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_HISTORY_MAX = 10;

// Chip values are always plain strings so a chip round-trips through
// localStorage (history) and the tab record untouched. The date/size presets
// below are resolved to real epoch/byte bounds by buildParams(), and a custom
// range from the More-filters modal is spelled '<from>..<to>' with either side
// allowed to be empty ('..1712345678' = "before only").
const SEARCH_TYPE_CHOICES = [
  'folder', 'image', 'video', 'audio', 'document', 'code', 'archive', 'executable', 'other',
];
const SEARCH_DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];
const SEARCH_SIZE_PRESETS = [
  { value: 'lt1mb', label: '< 1 MB', min: null, max: 1048576 },
  { value: '1to100mb', label: '1–100 MB', min: 1048576, max: 104857600 },
  { value: 'gt100mb', label: '> 100 MB', min: 104857600, max: null },
  { value: 'gt1gb', label: '> 1 GB', min: 1073741824, max: null },
];

/** Dropdown rows, in order. `choices` is resolved lazily when the row is
 * expanded (the tag list needs a fetch); `modal: true` opens More filters
 * instead of expanding. */
const SEARCH_FILTER_ROWS = [
  {
    id: 'in', icon: 'folder', title: 'In a specific folder',
    hint: 'in: current location / This PC / Choose folder…',
    choices: () => [
      { value: 'current', label: 'Current location' },
      { value: 'pc', label: 'This PC' },
      { value: '__pick', label: 'Choose folder…' },
    ],
  },
  {
    id: 'type', icon: 'file', title: 'Includes a specific type',
    hint: 'type: image, video, audio, document, code, archive, folder',
    choices: () => SEARCH_TYPE_CHOICES.map(v => ({ value: v, label: searchTitleCase(v) })),
  },
  {
    id: 'modified', icon: 'history', title: 'Modified',
    hint: 'modified: today, this week, this month, this year',
    choices: () => SEARCH_DATE_PRESETS.slice(),
  },
  {
    id: 'size', icon: 'drive', title: 'Size',
    hint: 'size: < 1 MB, 1–100 MB, > 100 MB, > 1 GB',
    choices: () => SEARCH_SIZE_PRESETS.map(p => ({ value: p.value, label: p.label })),
  },
  {
    id: 'tag', icon: 'tag', title: 'Tag',
    hint: 'tag: …',
    choices: () => searchTagChoices(),
  },
  {
    id: 'more', icon: 'filter', title: 'More filters',
    hint: 'dates, hidden items, whole words',
    modal: true,
  },
];

let _searchDebounceTimer = null;
let _searchExpandedRow = null;   // id of the dropdown row currently expanded

// ── Small helpers ─────────────────────────────────────────────────────────────
function searchTitleCase(s) {
  const str = String(s || '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** The tag list the Tag filter row offers — the cache the sidebar's own Tags
 * section fills (app.js's loadSidebarTags), so expanding the row never blocks
 * on a fetch. Only tags something actually carries are offered: a zero-count
 * tag can only ever return an empty result set. */
function searchTagChoices() {
  const tags = Array.isArray(window.__fpTags) ? window.__fpTags : [];
  return tags
    .filter(t => (t.count || 0) > 0)
    // GET /tags answers in NAME order, so a plain slice(0, 20) offered the
    // alphabetically-first tags while the sidebar chips the user actually
    // clicks are the top 8 BY COUNT — a chip whose tag fell outside those 20
    // was silently dropped by More filters' Apply (pass 2 #90). Sort the copy
    // .filter() already made, the same way loadSidebarTags does.
    .sort((a, b) => (b.count || 0) - (a.count || 0)
      || String(a.name || '').localeCompare(String(b.name || '')))
    .slice(0, 20)
    .map(t => ({ value: t.name, label: `${t.name} (${t.count})` }));
}

/** Epoch-seconds start of a `modified:`/`created:` preset — computed in the
 * renderer (design §8.1) so the backend only ever sees absolute bounds. */
function searchPresetAfter(preset) {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'today') return Math.floor(midnight.getTime() / 1000);
  if (preset === 'week') {
    // ISO weeks: Monday is day 0 of the week, JS's getDay() calls Sunday 0.
    const backToMonday = (midnight.getDay() + 6) % 7;
    // Built with the Date constructor, like the month/year branches below:
    // subtracting a fixed 86400000 ms per day lands an hour off true local
    // midnight in any week containing a DST change (pass 2 #95).
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - backToMonday);
    return Math.floor(monday.getTime() / 1000);
  }
  if (preset === 'month') return Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  if (preset === 'year') return Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  return null;
}

/** {after, before} epoch seconds for a date chip value — a preset name, or a
 * custom '<fromEpoch>..<toEpoch>' range with either side optionally empty. */
function searchDateBounds(value) {
  const v = String(value || '');
  if (v.includes('..')) {
    const [from, to] = v.split('..');
    return { after: from ? Number(from) : null, before: to ? Number(to) : null };
  }
  return { after: searchPresetAfter(v), before: null };
}

/** {min, max} bytes for a size chip value — a preset name, or '<min>..<max>'. */
function searchSizeBounds(value) {
  const v = String(value || '');
  if (v.includes('..')) {
    const [min, max] = v.split('..');
    return { min: min ? Number(min) : null, max: max ? Number(max) : null };
  }
  const preset = SEARCH_SIZE_PRESETS.find(p => p.value === v);
  return preset ? { min: preset.min, max: preset.max } : { min: null, max: null };
}

/** The value of the single chip with this key, or null. */
function searchChipValue(key) {
  const chip = searchState.chips.find(c => c.key === key);
  return chip ? chip.value : null;
}

/** Mirror of backend.searcher.match_spans — only needed for GET /search
 * (index) rows, which carry no spans of their own because SQL LIKE has no
 * concept of one. Returns [] (render the name unhighlighted) rather than null
 * when a word is missing: the backend already decided this row matches. */
function searchMatchSpans(name, words, wholeWord) {
  const lname = String(name || '').toLowerCase();
  const spans = [];
  for (const word of words) {
    const lw = String(word).toLowerCase();
    if (!lw) continue;
    let start;
    if (wholeWord) {
      const m = new RegExp(`\\b${lw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(lname);
      if (!m) return [];
      start = m.index;
    } else {
      start = lname.indexOf(lw);
      if (start === -1) return [];
    }
    spans.push([start, start + lw.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

// ── Chips ─────────────────────────────────────────────────────────────────────
/** Adds (or replaces — one chip per key) a filter chip and re-runs the search.
 * The `in` chip additionally drives searchState.scope, which is what picks
 * between the live-walk and index routes. */
function addChip(key, value, label) {
  const chip = { key, value: String(value), label: String(label) };
  const at = searchState.chips.findIndex(c => c.key === key);
  if (at >= 0) searchState.chips[at] = chip;
  else searchState.chips.push(chip);
  if (key === 'in') searchState.scope = chip.value;
  renderSearchChips();
  focusSearchInput({ keepDropdownClosed: true });
  runSearch();
}

/** Removes the chip at index `i` (Backspace on empty text, or a click on the
 * chip itself). Dropping the last chip with no text left standing clears the
 * whole search rather than firing an empty query. */
function removeChip(i) {
  const chip = searchState.chips[i];
  if (!chip) return;
  searchState.chips.splice(i, 1);
  if (chip.key === 'in') searchState.scope = 'current';
  renderSearchChips();
  if (!searchState.chips.length && !searchState.text.trim()) clearSearch();
  else runSearch();
}

function renderSearchChips() {
  const host = document.getElementById('search-chips');
  if (!host) return;
  host.innerHTML = searchState.chips.map((chip, i) => `
    <button type="button" class="fp-chip fp-search-chip" data-action="search-remove-chip"
            data-chip-index="${i}" title="Remove filter ${escapeHtml(chip.key)}: ${escapeHtml(chip.label)}">
      <span class="fp-search-chip__key">${escapeHtml(chip.key)}:</span>
      <span class="fp-search-chip__value">${escapeHtml(chip.label)}</span>
    </button>`).join('');
  const wrap = document.getElementById('search-wrap');
  if (wrap) wrap.classList.toggle('fp-search--has-chips', searchState.chips.length > 0);
  syncSearchHasContent();
  resizeSearchInput();
  // Chips widen the bar's content: the toolbar re-lays out (app.js, §6.2).
  if (typeof layoutToolbar === 'function') layoutToolbar();
}

/** .fp-search--has-content shows the in-bar clear × while the bar holds text
 * or chips. */
function syncSearchHasContent() {
  const wrap = document.getElementById('search-wrap');
  if (!wrap) return;
  wrap.classList.toggle('fp-search--has-content', !!(searchState.text.trim() || searchState.chips.length));
}

// ── Query building ────────────────────────────────────────────────────────────
/** The exact query string GET /fs/search (or GET /search) is called with.
 * `root` is omitted for the This PC scope — that route searches the index, not
 * a tree. Every other key maps one chip to one documented backend parameter. */
/** "in: current location" means THIS tab's folder. browserState is global
 * and still holds whichever tab last listed something, so reading it directly
 * silently scopes the search to another tab's folder (pass 2 #15). */
function searchCurrentRoot() {
  const tab = typeof activeTab === 'function' ? activeTab() : null;
  return (tab && tab.path) || browserState.path || '';
}

/** Does this search go to the index (GET /search) rather than walk a folder?
 * The This PC scope does — and so does "current location" while the tab is
 * on the This PC page (Stage 2D §8): its location is every drive, never a
 * folder called "thispc:". */
function searchUsesIndex() {
  if (searchState.scope === 'pc') return true;
  return searchState.scope === 'current' && typeof THISPC !== 'undefined' && searchCurrentRoot() === THISPC;
}

function buildParams() {
  const params = { q: searchState.text.trim(), limit: SEARCH_LIMIT };

  if (!searchUsesIndex()) {
    params.root = searchState.scope === 'current' ? searchCurrentRoot() : searchState.scope;
  }

  const type = searchChipValue('type');
  if (type) params.type = type;

  const ext = searchChipValue('ext');
  if (ext) params.ext = String(ext).replace(/^\./, '').toLowerCase();

  const modified = searchChipValue('modified');
  if (modified) {
    const { after, before } = searchDateBounds(modified);
    if (after != null) params.modified_after = after;
    if (before != null) params.modified_before = before;
  }

  const created = searchChipValue('created');
  if (created) {
    const { after, before } = searchDateBounds(created);
    if (after != null) params.created_after = after;
    if (before != null) params.created_before = before;
  }

  const size = searchChipValue('size');
  if (size) {
    const { min, max } = searchSizeBounds(size);
    if (min != null) params.min_size = min;
    if (max != null) params.max_size = max;
  }

  const tag = searchChipValue('tag');
  if (tag) params.tag = tag;

  // The `hidden:` chip is a per-search override *on top of* the global
  // ui.show_hidden setting GET /fs/list is always called with — without the
  // browserState half, a hidden file the user can see in the listing was
  // unfindable one keystroke later.
  if (browserState.showHidden || searchChipValue('hidden')) params.hidden = true;
  if (searchChipValue('whole_word')) params.whole_word = true;

  return params;
}

/** Folds a GET /search (index) response into the GET /fs/search shape the
 * renderer expects: `filename`/`extension` become `name`/`ext`, the ISO
 * date strings the indexer stores become epoch seconds (what renderFsRow's
 * formatModified() takes), and the match spans SQL LIKE never produced are
 * computed here from the same words the backend matched on. */
function normalizeIndexResults(payload, query) {
  const words = String(query || '').split(/\s+/).filter(Boolean);
  const wholeWord = !!searchChipValue('whole_word');
  const toEpoch = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? null : parsed / 1000;
  };
  const results = (payload.results || []).map(row => {
    const name = row.name || row.filename || pathBaseName(row.path);
    const ext = String(row.ext != null ? row.ext : (row.extension || '')).replace(/^\./, '');
    return {
      path: row.path,
      name,
      is_dir: !!row.is_dir,
      size: row.size,
      modified: toEpoch(row.modified),
      created: toEpoch(row.created),
      ext,
      match: Array.isArray(row.match) ? row.match : searchMatchSpans(name, words, wholeWord),
    };
  });
  return {
    results,
    // GET /search reports truncation for real (it asks for one row past the
    // limit, and knows when the whole_word pass ran against a capped scan
    // window). The `results.length >= SEARCH_LIMIT` guess below is only the
    // fallback for a backend that predates the field.
    truncated: typeof payload.truncated === 'boolean'
      ? payload.truncated
      : results.length >= SEARCH_LIMIT,
    indexed_roots: payload.indexed_roots || [],
  };
}

// ── Running a search ──────────────────────────────────────────────────────────
/** Search results live in the Browser list, so a search fired from Home or
 * from the palette has to get there first (and, on a tab that has never
 * listed anything, resolve a real folder for the `in: current location`
 * scope). */
async function searchEnsureBrowser() {
  const browserActive = document.getElementById('screen-browser')?.classList.contains('active');
  const tab = typeof activeTab === 'function' ? activeTab() : null;
  // browserState is global: on a tab that has never listed anything (or one
  // that was on Home while another tab browsed), browserState.path is the
  // OTHER tab's folder. Testing it instead of this tab's own record is what
  // let a search run silently against a folder this tab never opened (pass 2
  // #15) — compare the two and load when they disagree.
  const stale = !browserState.path || (tab && browserState.path !== tab.path);
  if (browserActive && !stale) return;
  if (tab) tab.screen = 'browser';
  showScreenDom('browser');
  if (stale) await loadDirectory(tab ? tab.path : null);
}

/**
 * Runs the current bar (chips + text). Aborts whatever is still in flight
 * first — typing cancels the previous request rather than racing it — and
 * ignores a response that a newer call has already superseded.
 *
 * `pushHistory: false` is for a re-run that is not a new search (the Refresh
 * button / a file operation's post-op refresh in search mode), which must not
 * push a duplicate history entry. `preserveSelection: true` (refreshDirectory's
 * search-mode branch) carries the current selection into the re-rendered
 * results the same way a browse-mode refresh does.
 */
async function runSearch({ pushHistory = true, preserveSelection = false } = {}) {
  if (searchState.inflight) {
    searchState.inflight.abort();
    searchState.inflight = null;
  }
  const query = searchState.text.trim();
  if (!query && !searchState.chips.length) {
    clearSearch();
    return;
  }

  // Same supersession guard loadDirectory() carries, for the same reason: an
  // unawaited search left running while the user switches tabs (or types
  // again) must not paint its results over whatever is current by then, nor
  // write them onto the wrong tab record.
  const reqTabId = tabs.activeId;
  const reqSeq = ++searchState._seq;
  const superseded = () => tabs.activeId !== reqTabId || searchState._seq !== reqSeq;

  await searchEnsureBrowser();
  if (superseded()) return;

  const usePc = searchUsesIndex();
  const params = buildParams();
  if (!usePc && !params.root) {
    showToast('Open a folder first, or pick "This PC" to search the index', 'error');
    return;
  }

  const ctrl = new AbortController();
  searchState.inflight = ctrl;
  searchState.inflightQuery = {
    chips: searchState.chips.map(c => ({ ...c })), text: searchState.text, scope: searchState.scope,
  };
  showSearchPending(query, usePc ? '*' : params.root);

  let payload;
  try {
    payload = usePc
      ? await API.get('/search', params, { signal: ctrl.signal })
      : await API.get('/fs/search', params, { signal: ctrl.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') return;   // superseded by a newer query, or a tab switch
    if (searchState.inflight === ctrl) searchState.inflight = null;
    if (superseded()) return;
    const reason = formatApiError(err);
    showToast(`Search failed: ${reason}`, 'error');
    setSearchHeader('Search failed');
    // showSearchPending() blanked #list-scroll on the way into search mode, so
    // without a body of its own the failure left a completely empty pane —
    // indistinguishable from "this folder is gone" and with nothing to click
    // (pass 2 #96). Same banner a browse-mode load failure renders.
    if (typeof showErrorBanner === 'function') {
      showErrorBanner(`Search failed: ${reason}`, {
        actions: [
          { label: 'Retry', name: 'search-retry' },
          { label: 'Clear search', name: 'search-clear' },
        ],
      });
    }
    return;
  }
  if (searchState.inflight === ctrl) searchState.inflight = null;
  if (superseded()) return;        // a newer query, or another tab, owns the list now

  const normalized = usePc ? normalizeIndexResults(payload, query) : payload;
  searchState.results = normalized.results || [];
  searchState.truncated = !!normalized.truncated;
  searchState.root = usePc ? '*' : params.root;
  searchState.query = query;

  renderSearchResults(normalized, { query, root: searchState.root, preserveSelection });
  if (pushHistory) pushSearchHistory();
  syncSearchToTab();
  if (usePc) {
    // superseded() travels with the hint: GET /drives can take seconds, and
    // the header it decorates may belong to a different search (or a different
    // tab) by the time it answers (pass 2 #93 / #162).
    await renderUnindexedDrivesHint(normalized.indexed_roots || [], superseded);
  }
}

/** Cancels whatever request is in flight without touching the bar — called by
 * activateTab()'s deactivate path, so a tab the user has switched away from
 * stops fetching. Its chips and text survive on the tab record and re-run on
 * re-activation (resumeSearchForTab) if no results had landed yet. */
function abortSearch() {
  // The queued keystroke is as much "this search still running" as the fetch
  // is: it carries no tab binding, so a timer left armed across a tab switch
  // re-issued the OTHER tab's query 300 ms later (pass 2 #98).
  cancelSearchDebounce();
  if (!searchState.inflight) return;
  searchState.inflight.abort();
  searchState.inflight = null;
}

/** Drops the pending debounced runSearch(), if any. Called by every path that
 * ends or hands off the current search: abortSearch() (tab switch, leaving
 * search mode), clearSearch() and searchResetBar(). */
function cancelSearchDebounce() {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = null;
}

/** Wipes the bar and returns the Browser to the folder the tab was showing. */
function clearSearch() {
  cancelSearchDebounce();
  if (searchState.inflight) {
    searchState.inflight.abort();
    searchState.inflight = null;
  }
  searchResetBar();
  closeSearchDropdown();
  if (typeof exitSearchResults === 'function') exitSearchResults({ barCleared: true });
}

/** Resets the bar's own state and DOM only — no listing side effects. Called
 * by clearSearch() (which then restores the folder listing itself) and by
 * browser.js's leaveSearchMode() (where loadDirectory is already repainting). */
function searchResetBar() {
  cancelSearchDebounce();
  searchState.chips = [];
  searchState.text = '';
  searchState.scope = 'current';
  searchState.results = null;
  searchState.truncated = false;
  searchState.root = null;
  searchState.query = '';
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  renderSearchChips();
  // In the collapsed toolbar the bar is only expanded while it has something in
  // it. Nothing else folds it back after a clear that didn't come from a blur
  // or Escape (the breadcrumb ×, leaving search mode), which left it wedged
  // open over the breadcrumb for the rest of the session (pass 2 #165).
  if (input !== document.activeElement) maybeCollapseSearchBar();
}

/** Sets the bar's text without running anything — the palette's "Search files
 * for '<text>'" command's first half. */
function setSearchText(text) {
  searchState.text = String(text || '');
  const input = document.getElementById('search-input');
  if (input) input.value = searchState.text;
  syncSearchHasContent();
  resizeSearchInput();
  if (typeof layoutToolbar === 'function') layoutToolbar();
}

// ── Results header extras ─────────────────────────────────────────────────────
/** This PC scope only: name the fixed drives GET /search's `indexed_roots`
 * doesn't cover yet, with an "Index now" button that indexes them in turn. */
async function renderUnindexedDrivesHint(indexedRoots, superseded = null) {
  let drives = [];
  try { drives = await API.get('/drives'); } catch (_) { return; }
  // /drives enumerates volumes (seconds on a machine with a slow one): the
  // header this decorates may belong to a newer search, or to another tab,
  // by now — appendSearchHeaderHint only checks that SOME header is showing.
  if (typeof superseded === 'function' && superseded()) return;
  const normalise = (p) => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
  const indexed = (indexedRoots || []).map(normalise);
  const missing = (drives || [])
    .map(d => d.mount || `${d.letter}\\`)
    .filter(mount => !indexed.some(root => normalise(mount) === root || root.startsWith(normalise(mount) + '\\')));
  if (!missing.length) return;
  window.__fpUnindexedDrives = missing;
  appendSearchHeaderHint(
    `${missing.length} ${missing.length === 1 ? 'drive is' : 'drives are'} not indexed`,
    'Index now', 'search-index-drives');
}

/** Writes the drive hint's own text (and parks its button) — the ONLY place
 * indexing progress can be seen from the search screen. showToast is gated
 * off by default (CLAUDE.md's notifications rule), so a multi-minute scan
 * driven from here used to produce no observable change at all (pass 2 #87);
 * the header hint the button lives in is not transient, so it can say so. */
function setDriveHintState(text, { busy = false } = {}) {
  const label = document.getElementById('list-search-header-hint-text');
  if (label) label.textContent = text;
  const btn = document.getElementById('list-search-header-hint-btn');
  if (btn) {
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
}

// True while indexMissingDrives() is walking its list — a second click would
// POST /index into a live scan and collect the backend's 409 as if the first
// click had failed.
let _indexingDrives = false;

/** POST /index for every drive the hint named, one at a time — the backend
 * refuses a second concurrent index with 409, so these cannot be fired off
 * in parallel. Progress and failure both land in the header hint. */
async function indexMissingDrives() {
  const drives = window.__fpUnindexedDrives || [];
  if (!drives.length || _indexingDrives) return;
  _indexingDrives = true;
  const fail = (msg) => {
    showToast(msg, 'error');
    setDriveHintState(msg, { busy: false });
  };
  try {
    for (let i = 0; i < drives.length; i++) {
      const progress = `Indexing ${drives[i]} (${i + 1} of ${drives.length})…`;
      setDriveHintState(progress, { busy: true });
      showToast(progress, 'default');
      try {
        await API.post('/index', { path: drives[i] });
        // The scan runs in the background, so its failure arrives as
        // /index/status's `error`, not as a rejection here.
        const outcome = await waitForIndexIdle();
        if (!outcome.idle) {
          // Never POST the next drive on a guess: the backend answers 409
          // while a scan is live, which used to abandon every remaining drive
          // (pass 2 #88).
          fail(`Still indexing ${drives[i]} — ${outcome.reason === 'status-unavailable'
            ? 'the index status is unavailable'
            : 'stopped waiting'}. Try the rest later.`);
          return;
        }
        if (outcome.status && outcome.status.error) {
          fail(`Failed to index ${drives[i]}: ${outcome.status.error}`);
          return;
        }
      } catch (err) {
        fail(`Failed to index ${drives[i]}: ${formatApiError(err)}`);
        return;
      }
    }
    setDriveHintState('Indexing finished', { busy: true });
    showToast('Indexing finished', 'default');
    window.__fpUnindexedDrives = [];
    if (typeof loadIndexStatus === 'function') loadIndexStatus();
  } finally {
    _indexingDrives = false;
  }
}

/**
 * Polls GET /index/status until the running scan finishes — POST /index
 * answers 409 while one is in flight, so a sequence of them has to wait
 * between calls.
 *
 * Returns {idle, status, reason}: `idle` is true ONLY when a non-running
 * status was actually observed. The old version returned the same `null` for
 * "finished", "gave up after 5 minutes" and "GET /index/status threw once",
 * so the caller fired the next POST into a live scan and collected a 409 —
 * the exact thing the wait exists to prevent (pass 2 #88). A real C:\ scan
 * routinely runs longer than any fixed cap, so there is no cap by default;
 * a run of failed status reads (a stopped backend) ends the wait instead.
 */
async function waitForIndexIdle({ tries = Infinity, intervalMs = 500, maxStatusErrors = 5 } = {}) {
  let statusErrors = 0;
  for (let i = 0; i < tries; i++) {
    let status;
    try {
      status = await API.get('/index/status');
      statusErrors = 0;
    } catch (_) {
      if (++statusErrors >= maxStatusErrors) return { idle: false, status: null, reason: 'status-unavailable' };
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      continue;
    }
    if (!status || !status.running) return { idle: true, status: status || null, reason: null };
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return { idle: false, status: null, reason: 'timeout' };
}

// ── History ───────────────────────────────────────────────────────────────────
function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(searchState.historyKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/** Identity of a history entry: the same chips (in any order) plus the same
 * text is the same search, and re-running it moves it to the top rather than
 * adding a duplicate. */
function searchHistoryKeyOf(entry) {
  const chips = (entry.chips || []).map(c => `${c.key}=${c.value}`).sort().join('|');
  return `${chips}::${(entry.text || '').trim().toLowerCase()}`;
}

function pushSearchHistory() {
  const entry = {
    chips: searchState.chips.map(c => ({ ...c })),
    text: searchState.text.trim(),
    scope: searchState.scope,
  };
  const key = searchHistoryKeyOf(entry);
  const next = [entry, ...loadSearchHistory().filter(e => searchHistoryKeyOf(e) !== key)]
    .slice(0, SEARCH_HISTORY_MAX);
  try { localStorage.setItem(searchState.historyKey, JSON.stringify(next)); } catch (_) { /* private mode */ }
}

function clearSearchHistory() {
  try { localStorage.removeItem(searchState.historyKey); } catch (_) { /* private mode */ }
  renderSearchDropdown();
}

/** Runs the stored search with this identity key (searchHistoryKeyOf). The
 * dropdown is only rebuilt while hidden, so the positional data-index it used
 * to carry went stale the moment anything pushed a new entry underneath it and
 * the click ran a neighbouring search instead (pass 2 #159). */
function restoreSearchHistoryEntry(key) {
  const history = loadSearchHistory();
  const entry = history.find(e => searchHistoryKeyOf(e) === key);
  if (!entry) return;
  searchState.chips = (entry.chips || []).map(c => ({ ...c }));
  searchState.scope = entry.scope || 'current';
  setSearchText(entry.text || '');
  renderSearchChips();
  closeSearchDropdown();
  runSearch();
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function searchDropdownEl() { return document.getElementById('search-dropdown'); }

/** The dropdown's focusable entries, in order (filter rows, their choices,
 * history entries, the clear-history button). */
function searchDropdownItems() {
  const el = searchDropdownEl();
  if (!el || el.hidden) return [];
  return [...el.querySelectorAll('button:not([disabled])')].filter((b) => b.getClientRects().length);
}

function openSearchDropdown() {
  const el = searchDropdownEl();
  if (!el) return;
  // Only (re)build while closed: re-rendering under a live pointer would
  // replace the very button the pending click is travelling to, and the click
  // would never land.
  if (el.hidden) renderSearchDropdown();
  el.hidden = false;
  document.getElementById('search-input')?.setAttribute('aria-expanded', 'true');
}

function closeSearchDropdown() {
  const el = searchDropdownEl();
  if (!el) return;
  el.hidden = true;
  _searchExpandedRow = null;
  document.getElementById('search-input')?.setAttribute('aria-expanded', 'false');
}

function toggleSearchFilterRow(id) {
  _searchExpandedRow = _searchExpandedRow === id ? null : id;
  renderSearchDropdown();
}

function renderSearchDropdown() {
  const el = searchDropdownEl();
  if (!el) return;
  const rows = SEARCH_FILTER_ROWS.map(row => {
    const expanded = _searchExpandedRow === row.id && !row.modal;
    const choices = expanded ? (row.choices ? row.choices() : []) : [];
    const choicesHtml = expanded
      ? `<div class="fp-search-dd__choices">${
          choices.length
            ? choices.map(c => `<button type="button" class="fp-search-dd__choice"
                 data-action="search-pick-filter" data-filter="${escapeHtml(row.id)}"
                 data-value="${escapeHtml(c.value)}" data-label="${escapeHtml(c.label)}">${escapeHtml(c.label)}</button>`).join('')
            : '<span class="fp-search-dd__empty">Nothing to pick yet</span>'
        }</div>`
      : '';
    return `<div class="fp-search-dd__row-wrap">
      <button type="button" class="fp-search-dd__row${expanded ? ' fp-search-dd__row--open' : ''}"
              data-action="${row.modal ? 'search-more-filters' : 'search-expand-filter'}"
              data-filter="${escapeHtml(row.id)}" aria-expanded="${expanded ? 'true' : 'false'}">
        ${icon(row.icon, 'fp-icon--14 fp-search-dd__icon')}
        <span class="fp-search-dd__title">${escapeHtml(row.title)}</span>
        <span class="fp-search-dd__hint">${escapeHtml(row.hint)}</span>
      </button>
      ${choicesHtml}
    </div>`;
  }).join('');

  const history = loadSearchHistory();
  const historyHtml = history.length
    ? history.map((entry) => {
        const chips = (entry.chips || []).map(c => `${c.key}: ${c.label}`).join('  ');
        const text = (entry.text || '').trim();
        return `<button type="button" class="fp-search-dd__history"
                  data-action="search-history-run"
                  data-history-key="${escapeHtml(searchHistoryKeyOf(entry))}">
          ${icon('history', 'fp-icon--14 fp-search-dd__icon')}
          <span class="fp-search-dd__title">${escapeHtml(text || chips || '(filters only)')}</span>
          ${text && chips ? `<span class="fp-search-dd__hint">${escapeHtml(chips)}</span>` : ''}
        </button>`;
      }).join('')
    : '<div class="fp-search-dd__empty">No recent searches</div>';

  el.innerHTML = `
    <div class="fp-search-dd__section">Filters</div>
    ${rows}
    <div class="fp-search-dd__section fp-search-dd__section--history">
      <span>History</span>
      <button type="button" class="fp-icon-btn fp-icon-btn--sm" data-action="search-history-clear"
              title="Clear search history" aria-label="Clear search history">${icon('delete', 'fp-icon--12')}</button>
    </div>
    ${historyHtml}`;
}

/** A dropdown choice was clicked: turn it into a chip (or, for
 * `in: Choose folder…`, ask the shell for one first). */
async function pickSearchFilter(filterId, value, label) {
  if (filterId === 'in' && value === '__pick') {
    const picked = await (window.electronAPI?.pickFolder?.() || Promise.resolve(null));
    if (!picked) return;
    closeSearchDropdown();
    addChip('in', picked, pathBaseName(picked) || picked);
    return;
  }
  if (filterId === 'in' && value === 'current') {
    // "Current location" is the default scope — drop any `in:` chip instead of
    // pinning one that says nothing.
    const at = searchState.chips.findIndex(c => c.key === 'in');
    closeSearchDropdown();
    if (at >= 0) { removeChip(at); return; }
    searchState.scope = 'current';
    runSearch();
    return;
  }
  closeSearchDropdown();
  addChip(filterId, value, label);
}

// ── More filters modal ────────────────────────────────────────────────────────
/** Opens #search-filters-scrim with every filter at once, seeded from the
 * chips already in the bar. Apply replaces the chip set wholesale. */
function openMoreFilters() {
  const scrim = document.getElementById('search-filters-scrim');
  if (!scrim) return;
  closeSearchDropdown();

  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
  const check = (id, value) => { const el = document.getElementById(id); if (el) el.checked = value; };
  const dateOf = (chipValue, side) => {
    const bounds = searchDateBounds(chipValue);
    const epoch = bounds[side];
    if (epoch == null) return '';
    const d = new Date(epoch * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const mbOf = (chipValue, side) => {
    const bounds = searchSizeBounds(chipValue);
    return bounds[side] == null ? '' : String(bounds[side] / 1048576);
  };

  const typeSelect = document.getElementById('search-filter-type');
  if (typeSelect) {
    typeSelect.innerHTML = '<option value="">Any</option>' +
      SEARCH_TYPE_CHOICES.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(searchTitleCase(v))}</option>`).join('');
    typeSelect.value = searchChipValue('type') || '';
  }
  const tagSelect = document.getElementById('search-filter-tag');
  if (tagSelect) {
    const choices = searchTagChoices();
    const current = searchChipValue('tag') || '';
    // The offered list is capped at 20: a chip whose tag isn't among them
    // would leave the select at '' and Apply would silently drop the filter
    // (pass 2 #90). Carry the current value into the list so it can't be lost.
    if (current && !choices.some(c => String(c.value) === current)) {
      choices.unshift({ value: current, label: current });
    }
    tagSelect.innerHTML = '<option value="">Any</option>' +
      choices.map(c => `<option value="${escapeHtml(c.value)}">${escapeHtml(c.label)}</option>`).join('');
    tagSelect.value = current;
  }

  set('search-filter-ext', searchChipValue('ext') || '');
  set('search-filter-modified-from', dateOf(searchChipValue('modified'), 'after'));
  set('search-filter-modified-to', dateOf(searchChipValue('modified'), 'before'));
  set('search-filter-created-from', dateOf(searchChipValue('created'), 'after'));
  set('search-filter-created-to', dateOf(searchChipValue('created'), 'before'));
  set('search-filter-min-mb', mbOf(searchChipValue('size'), 'min'));
  set('search-filter-max-mb', mbOf(searchChipValue('size'), 'max'));
  check('search-filter-hidden', !!searchChipValue('hidden'));
  check('search-filter-whole-word', !!searchChipValue('whole_word'));

  fpSetScrim(scrim, true);
  // closeSearchDropdown() above hid the button that had focus, so without this
  // document.activeElement falls back to <body> — which app.js's global
  // keydown does not treat as "typing", sending Delete/F2/Ctrl+Z straight
  // through to the selection behind the open dialog (pass 2 #86).
  document.getElementById('search-filter-type')?.focus();
}

function closeMoreFilters() {
  const scrim = document.getElementById('search-filters-scrim');
  if (!scrim) return;
  fpSetScrim(scrim, false);
}

/** Reads the modal back into the chip set. The `in:` chip is untouched — the
 * modal has no scope control, so a scope already picked in the dropdown
 * survives an Apply. */
function applyMoreFilters() {
  const val = (id) => (document.getElementById(id)?.value || '').trim();
  const checked = (id) => !!document.getElementById(id)?.checked;
  const dayStart = (s) => (s ? Math.floor(new Date(`${s}T00:00:00`).getTime() / 1000) : '');
  const dayEnd = (s) => (s ? Math.floor(new Date(`${s}T23:59:59`).getTime() / 1000) : '');

  // Keys the modal actually owns — and only while their control is really in
  // the DOM. Every OTHER chip (the `in:` scope, anything a later filter row
  // adds without a control here) is carried forward rather than wiped by an
  // Apply that never saw it (pass 2 #90).
  const MODAL_CONTROLS = {
    type: 'search-filter-type', ext: 'search-filter-ext',
    modified: 'search-filter-modified-from', created: 'search-filter-created-from',
    size: 'search-filter-min-mb', tag: 'search-filter-tag',
    hidden: 'search-filter-hidden', whole_word: 'search-filter-whole-word',
  };
  const owned = new Set(Object.keys(MODAL_CONTROLS).filter(k => document.getElementById(MODAL_CONTROLS[k])));
  searchState.chips = searchState.chips.filter(c => !owned.has(c.key));

  const push = (key, value, label) => searchState.chips.push({ key, value: String(value), label: String(label) });

  const type = val('search-filter-type');
  if (type) push('type', type, searchTitleCase(type));

  const ext = val('search-filter-ext').replace(/^\./, '').toLowerCase();
  if (ext) push('ext', ext, `.${ext}`);

  const modFrom = val('search-filter-modified-from');
  const modTo = val('search-filter-modified-to');
  if (modFrom || modTo) {
    push('modified', `${dayStart(modFrom)}..${dayEnd(modTo)}`,
      `${modFrom || 'any'} → ${modTo || 'any'}`);
  }

  const madeFrom = val('search-filter-created-from');
  const madeTo = val('search-filter-created-to');
  if (madeFrom || madeTo) {
    push('created', `${dayStart(madeFrom)}..${dayEnd(madeTo)}`,
      `${madeFrom || 'any'} → ${madeTo || 'any'}`);
  }

  const minMb = val('search-filter-min-mb');
  const maxMb = val('search-filter-max-mb');
  if (minMb || maxMb) {
    const min = minMb ? Math.round(Number(minMb) * 1048576) : '';
    const max = maxMb ? Math.round(Number(maxMb) * 1048576) : '';
    push('size', `${min}..${max}`, `${minMb || '0'}–${maxMb || '∞'} MB`);
  }

  const tag = val('search-filter-tag');
  if (tag) push('tag', tag, tag);

  if (checked('search-filter-hidden')) push('hidden', 'true', 'shown');
  if (checked('search-filter-whole-word')) push('whole_word', 'true', 'on');

  closeMoreFilters();
  renderSearchChips();
  runSearch();
}

// ── Bar sizing ────────────────────────────────────────────────────────────────
// `field-sizing: content` does the whole job on Chromium 123+ (Electron 41).
// The measuring-span fallback below exists for a runtime without it: the
// input's width is set from a hidden span rendered in the same font.
const SEARCH_INPUT_MIN_CH = 11;
const _searchSupportsFieldSizing = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

function resizeSearchInput() {
  if (_searchSupportsFieldSizing) return;
  const input = document.getElementById('search-input');
  const ruler = document.getElementById('search-measure');
  if (!input || !ruler) return;
  ruler.textContent = input.value || input.placeholder || '';
  const width = Math.ceil(ruler.getBoundingClientRect().width) + 4;
  input.style.width = `${Math.max(width, SEARCH_INPUT_MIN_CH * 7)}px`;
}

// Set for the duration of a focus() that must NOT pop the dropdown open —
// addChip() returns the caret to the text after a pick, and having the panel
// spring back over the results it just produced reads as a bug.
let _searchSuppressDropdown = false;

function focusSearchInput({ keepDropdownClosed = false } = {}) {
  const input = document.getElementById('search-input');
  if (!input) return;
  expandSearchBar();           // only visible while the toolbar is collapsed
  _searchSuppressDropdown = keepDropdownClosed;
  input.focus();               // dispatches 'focus' synchronously
  _searchSuppressDropdown = false;
  const end = input.value.length;
  try { input.setSelectionRange(end, end); } catch (_) { /* not a text input */ }
}

// ── Tab persistence ───────────────────────────────────────────────────────────
/** A serializable snapshot of the live bar + its rendered results, or null
 * when no search is showing. Stored on the tab record (app.js) so switching
 * tabs and back repaints the same results without re-walking the tree. */
function captureSearchState() {
  // A search whose request was still in flight when the tab was switched away
  // has no results yet but is still a search: keep the chips and text so
  // re-activating the tab can re-run it rather than silently dropping it.
  const hasQuery = !!(searchState.text.trim() || searchState.chips.length);
  if (!searchState.results && !hasQuery) return null;
  return {
    chips: searchState.chips.map(c => ({ ...c })),
    text: searchState.text,
    scope: searchState.scope,
    results: searchState.results,
    truncated: searchState.truncated,
    root: searchState.root,
    query: searchState.query,
  };
}

/** Writes the snapshot onto whichever tab is active right now — called after
 * every render so a tab switch never has to ask the search for its state. */
function syncSearchToTab() {
  const tab = typeof activeTab === 'function' ? activeTab() : null;
  if (tab) tab.search = captureSearchState();
}

/** Repaints a tab's stored search (bar + results) with no network call.
 *
 * `restore` ({selection, scrollTop, scrollLeft}) carries the same per-tab view state a
 * folder tab gets back through loadDirectory()'s `restore` option — without it
 * a results tab came back scrolled to the top with nothing selected and a
 * blank Inspector, while the identical round-trip on a folder tab restored
 * both (pass 2 #153). */
function restoreSearchResultsForTab(snapshot, restore = null) {
  if (!snapshot) { searchResetBar(); return; }
  searchState.chips = (snapshot.chips || []).map(c => ({ ...c }));
  searchState.text = snapshot.text || '';
  searchState.scope = snapshot.scope || 'current';
  searchState.results = snapshot.results || [];
  searchState.truncated = !!snapshot.truncated;
  searchState.root = snapshot.root || null;
  searchState.query = snapshot.query || '';
  const input = document.getElementById('search-input');
  if (input) input.value = searchState.text;
  renderSearchChips();
  // Seed the selection BEFORE the render and ask it to preserve what it finds:
  // renderSearchResults() filters it down to the paths actually present in the
  // snapshot, exactly as loadDirectory()'s restore branch does for a folder.
  const wanted = restore && Array.isArray(restore.selection) ? restore.selection : null;
  if (wanted) {
    browserState.selection = new Set(wanted);
    browserState.anchor = wanted.length ? wanted[0] : null;
    browserState.focus = wanted.length ? wanted[wanted.length - 1] : null;
  }
  renderSearchResults(
    { results: searchState.results, truncated: searchState.truncated },
    { query: searchState.query, root: searchState.root, preserveSelection: !!wanted },
  );
  if (restore && (restore.scrollTop || restore.scrollLeft)) {
    const listScroll = document.getElementById('list-scroll');
    if (listScroll) {
      listScroll.scrollTop = restore.scrollTop || 0;
      listScroll.scrollLeft = restore.scrollLeft || 0;
    }
  }
}

/** Re-runs a tab's unfinished search after its folder listing has landed.
 * Called by activateTab() only for a snapshot with no cached results; bails if
 * the user has switched tabs again while the listing was loading. */
function resumeSearchForTab(snapshot, tabId) {
  if (!snapshot || tabs.activeId !== tabId) return;
  searchState.chips = (snapshot.chips || []).map(c => ({ ...c }));
  searchState.scope = snapshot.scope || 'current';
  setSearchText(snapshot.text || '');
  renderSearchChips();
  runSearch({ pushHistory: false });
}

// ── Collapsed toolbar: the bar opens in flow ─────────────────────────────────
// When the path needs the room (app.js's layoutToolbar sets
// #toolbar[data-search="collapsed"], Stage 2D §6.2) the bar folds into a
// single magnifier button. Clicking it (the data-action="focus-search" button
// inside the bar) or Ctrl+F opens it again IN FLOW (addendum §2): the bar
// grows over --motion-base and pushes the path left — never covers it;
// leaving it with nothing typed and no chips folds it back the same way.
// The class is the state and flips at once; layoutToolbar({animate}) only
// eases the width on top (instant with animations off).
function expandSearchBar() {
  const wrap = document.getElementById('search-wrap');
  if (!wrap || wrap.classList.contains('fp-search--expanded')) return;
  wrap.classList.add('fp-search--expanded');
  // Its chips are measurable only now (display:none while folded): the
  // bar's width is re-derived from them (app.js, §6.2).
  if (typeof layoutToolbar === 'function') layoutToolbar({ animate: true });
}

function maybeCollapseSearchBar() {
  if (searchState.text.trim() || searchState.chips.length) return;
  const wrap = document.getElementById('search-wrap');
  if (!wrap || !wrap.classList.contains('fp-search--expanded')) return;
  // The folding bar clips its content (.fp-search--folding) — its own
  // dropdown included, which hangs below it: never fold with it open.
  if (document.getElementById('toolbar')?.dataset.search === 'collapsed') closeSearchDropdown();
  wrap.classList.remove('fp-search--expanded');
  if (typeof layoutToolbar === 'function') layoutToolbar({ animate: true });
}

// ── Wiring ────────────────────────────────────────────────────────────────────
/**
 * Wires the bar: the dropdown opens on focus (and on a click anywhere in the
 * bar), typing debounces a search 300 ms, Enter runs it immediately, Escape
 * only closes the dropdown (never clears — design §8.2), and Backspace on
 * empty text eats the last chip. Clicking outside closes the dropdown and
 * leaves chips, text and results exactly where they are.
 */
function initSearch() {
  const wrap = document.getElementById('search-wrap');
  const input = document.getElementById('search-input');
  if (!wrap || !input) return;

  input.addEventListener('focus', () => {
    if (_searchSuppressDropdown) return;
    openSearchDropdown();
  });
  wrap.addEventListener('mousedown', e => {
    // A click on the chrome (icon, padding) focuses the input rather than
    // stealing focus away from it — but a click on a chip or inside the open
    // dropdown belongs to that element's own data-action, and must not be
    // intercepted (or have the panel re-rendered out from under it).
    // The in-bar clear × likewise: its click clears and, on a collapsed bar,
    // folds the opened bar — focusing the input first would hold it open.
    if (e.target.closest('.fp-search-chip, #search-dropdown, .fp-search__clear')) return;
    if (e.target !== input) { e.preventDefault(); focusSearchInput(); }
    openSearchDropdown();
  });

  input.addEventListener('input', () => {
    searchState.text = input.value;
    syncSearchHasContent();
    resizeSearchInput();
    if (typeof layoutToolbar === 'function') layoutToolbar();
    clearTimeout(_searchDebounceTimer);
    // pushHistory:false — a 300 ms pause mid-word is not a search the user
    // asked to remember. Pushing one per pause stored "q", "qu", "qua", … and
    // flushed all ten real history slots with prefixes of one word (pass 2
    // #161). History is written by the deliberate commits instead: Enter, a
    // chip pick, the palette, re-running a history row.
    _searchDebounceTimer = setTimeout(() => {
      // Fired: nothing is queued any more (cancelSearchDebounce and the tests
      // read the handle as "a keystroke is still waiting").
      _searchDebounceTimer = null;
      runSearch({ pushHistory: false });
    }, SEARCH_DEBOUNCE_MS);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(_searchDebounceTimer);
      closeSearchDropdown();
      runSearch();
      return;
    }
    // ArrowDown from the field walks into the open dropdown (a combobox);
    // it never reaches the file list behind it.
    if (e.key === 'ArrowDown') {
      const dd = searchDropdownEl();
      const first = dd && !dd.hidden ? searchDropdownItems()[0] : null;
      if (first) { e.preventDefault(); e.stopPropagation(); first.focus(); }
      return;
    }
    if (e.key === 'Escape') {
      // Escape in the bar closes the dropdown and nothing else — the results,
      // chips and text all stay (design §8.2). stopPropagation keeps the
      // global Escape handler from closing unrelated overlays behind it.
      e.preventDefault();
      e.stopPropagation();
      closeSearchDropdown();
      // In the collapsed toolbar an empty bar folds back into its magnifier.
      if (!searchState.text.trim() && !searchState.chips.length) {
        maybeCollapseSearchBar();
        input.blur();
      }
      return;
    }
    // Backspace with the caret at the very start (an empty field included)
    // eats the last chip — Discord's gesture. Every other key is left alone:
    // the global keydown handler already skips the Browser's own shortcuts
    // while an <input> has focus, and swallowing everything here would also
    // kill ⌘K/⌘B/⌘I from inside the bar.
    if (e.key === 'Backspace' && input.selectionStart === 0 && input.selectionEnd === 0
        && searchState.chips.length) {
      e.preventDefault();
      removeChip(searchState.chips.length - 1);
    }
  });

  // Cursor keys inside the open dropdown move between its entries; Escape
  // hands the caret back to the field. Nothing here reaches the file list.
  searchDropdownEl()?.addEventListener('keydown', e => {
    const items = searchDropdownItems();
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === 'ArrowDown') next = items[(cur + 1) % items.length];
    else if (e.key === 'ArrowUp') {
      if (cur <= 0) { e.preventDefault(); e.stopPropagation(); focusSearchInput({ keepDropdownClosed: true }); return; }
      next = items[cur - 1];
    } else if (e.key === 'Home' || e.key === 'PageUp') next = items[0];
    else if (e.key === 'End' || e.key === 'PageDown') next = items[items.length - 1];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); return; }
    else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeSearchDropdown();
      focusSearchInput({ keepDropdownClosed: true });
      return;
    }
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    next.focus();
  });

  // Clicking anywhere outside the bar closes the dropdown but keeps the search.
  document.addEventListener('mousedown', e => {
    const dropdown = searchDropdownEl();
    if (!dropdown || dropdown.hidden) return;
    if (wrap.contains(e.target)) return;
    closeSearchDropdown();
  });

  input.addEventListener('blur', () => {
    // Never fold the bar away while its own dropdown is open — blur fires on
    // the way to a dropdown choice, which still needs the bar to exist.
    const dropdown = searchDropdownEl();
    if (dropdown && !dropdown.hidden) return;
    maybeCollapseSearchBar();
  });

  renderSearchChips();
  resizeSearchInput();
}
