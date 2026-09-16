/**
 * FilePlus icon sprite helpers. Loaded right after icons-sprite.js (which
 * defines FP_ICON_SPRITE — see scripts/build_icons.js) and iconCache.js
 * (window.FpIconCache — the dual-mode key/LRU module main.js also requires),
 * and before every other frontend/src module, so icon()/iconFor() are safe
 * to call from any later file's own top level (const FOO = icon('...')
 * included).
 *
 * fpInstallSprite() inserts the sprite SVG once at the top of <body>. It
 * runs twice, both no-ops the second time (installed flag + a duplicate-id
 * guard): once synchronously below if <body> already exists (the case for
 * a classic <script> tag placed at the end of the document, after <body>'s
 * static markup — so static index.html markup can reference `#fp-*` symbols
 * directly, e.g. <svg class="fp-icon"><use href="#fp-home"></use></svg>,
 * and the sprite is already in the DOM before first paint), and again from
 * app.js's DOMContentLoaded handler as a belt-and-braces guard.
 */
let _fpSpriteInstalled = false;
function fpInstallSprite() {
  if (_fpSpriteInstalled || document.getElementById('fp-icon-sprite')) {
    _fpSpriteInstalled = true;
    return;
  }
  if (typeof FP_ICON_SPRITE !== 'string' || !document.body) return;
  const wrap = document.createElement('div');
  wrap.id = 'fp-icon-sprite';
  wrap.style.display = 'none';
  wrap.innerHTML = FP_ICON_SPRITE;
  document.body.insertBefore(wrap, document.body.firstChild);
  _fpSpriteInstalled = true;
}

/** Markup for one sprite-backed chrome icon. `cls` is appended to the class
 * list (e.g. a size modifier like 'fp-icon--20' or a component hook class). */
function icon(name, cls = '') {
  return `<svg class="fp-icon ${cls}" aria-hidden="true"><use href="#fp-${name}"></use></svg>`;
}

/** HTML-escape for attribute/text interpolation. browser.js exports the
 * canonical escapeHtml(), but that file loads AFTER this one — keeping a
 * private copy here means icons.js never depends on load order, including
 * for the top-level constants later files build out of icon(). */
function _fpEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 'fileplus' (the hand-authored family sprite, the default) or 'windows'
 * (the real Windows shell icon for the file: POST /shell/icons first, the
 * Electron bridge as the fallback — see the lazy section below).
 * Persisted as ui.icon_source — Settings ▸ Personalization ▸ File icons. */
function fpIconSource() {
  const v = window.__fpConfig && window.__fpConfig['ui.icon_source'];
  return v === 'windows' ? 'windows' : 'fileplus';
}

// Known-folder id -> its own sprite symbol. Everything else is the plain
// folder. The ids come straight from GET /known-folders (backend/winshell.py).
const FP_FOLDER_SPECIALS = {
  desktop: 'ft-folder-desktop',
  downloads: 'ft-folder-downloads',
  documents: 'ft-folder-documents',
  pictures: 'ft-folder-pictures',
  videos: 'ft-folder-videos',
  music: 'ft-folder-music',
  screenshots: 'ft-folder-screenshots',
};

/** Comparison form for a Windows path: forward slashes folded to back, any
 * trailing separator dropped, lower-cased (NTFS is case-insensitive). */
function fpNormalizePath(p) {
  return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

/** Known-folder id ('desktop', 'downloads', …) for an absolute path, or null.
 * Null until fpLoadKnownFolders() has answered. */
function fpKnownFolderIdFor(path) {
  const map = window.__fpKnownFolders;
  if (!map || !path) return null;
  return map.get(fpNormalizePath(path)) || null;
}

/** Fetches GET /known-folders once and caches it as window.__fpKnownFolders,
 * a Map of normalised path -> known-folder id, plus the raw {id, name, path}
 * list as window.__fpKnownFolderList (Task 9's sidebar Quick Access section
 * and Settings › Personalization checkboxes read the list; icon lookups read
 * the map). app.js's init awaits this before the first listing renders. On
 * failure both are left unset, which keeps _folderSymbol on its name
 * heuristic rather than flattening every special folder to the plain icon. */
async function fpLoadKnownFolders() {
  if (window.__fpKnownFolders) return window.__fpKnownFolders;
  let folders;
  try {
    const data = await API.get('/known-folders', null, apiTimeout());
    folders = (data && data.folders) || [];
  } catch (_) {
    return null; // backend down / older build — name heuristic stays in force
  }
  const map = new Map();
  for (const f of folders) {
    if (f && f.path && f.id) map.set(fpNormalizePath(f.path), f.id);
  }
  window.__fpKnownFolders = map;
  window.__fpKnownFolderList = folders;
  return map;
}

/** Sprite symbol name for a directory entry.
 *
 * Identity is the PATH, not the name: only the user's real Desktop gets the
 * monitor glyph, and a project folder that happens to be called "Desktop"
 * gets the plain folder. The name heuristic is the fallback used only in the
 * window before GET /known-folders has answered (or if it never does), where
 * guessing from the name beats showing nothing special at all. */
function _folderSymbol(entry) {
  const path = entry && entry.path;
  if (window.__fpKnownFolders) {
    const id = fpKnownFolderIdFor(path);
    return (id && FP_FOLDER_SPECIALS[id]) || 'ft-folder';
  }
  const name = (entry && entry.name ? String(entry.name) : '').toLowerCase();
  return FP_FOLDER_SPECIALS[name] || 'ft-folder';
}

/** Row/tile icon for a file-system entry. `entry` is the shape used
 * throughout browser.js/home.js/app.js: {name, is_dir, ext, path, modified}.
 * `size` picks the .fp-icon--N modifier (default 16, the file-list row size);
 * `cls` is a component hook appended to the class list (e.g. 'fp-row__icon',
 * which carries the row's icon sizing/colour) and survives every branch,
 * including the Windows-shell <img> one.
 *
 * In 'windows' mode this returns a lazily-resolved <img> rather than a sprite
 * <use>: _winIcon renders it blank with the family symbol recorded as its
 * fallback, and the IntersectionObserver below fills in the real shell icon
 * once the row scrolls into view (swapping in the sprite icon if the shell
 * has none). A generic file with an extension we have no family for gets the
 * extension itself as a small badge next to the blank page icon — the pair
 * is ONE root element (.fp-icon-badged) so a centring container (a grid
 * tile's .fp-thumb-box) centres the icon, not the icon-plus-badge as a unit
 * (pass 2 #146). */
function iconFor(entry, size = 16, cls = '') {
  const cls16 = `fp-icon--${size}${cls ? ' ' + cls : ''}`;
  if (!entry) return icon('ft-generic', cls16);
  const source = fpIconSource();
  if (entry.is_dir) {
    const folderSym = _folderSymbol(entry);
    return source === 'windows'
      ? _winIcon(entry, size, folderSym, cls)
      : icon(folderSym, cls16);
  }
  const fam = fpFamilyFor(entry.ext);
  if (source === 'windows') return _winIcon(entry, size, 'ft-' + fam, cls);
  if (fam === 'generic' && entry.ext) {
    const label = String(entry.ext).replace(/^\./, '').slice(0, 3).toUpperCase();
    return `<span class="fp-icon-badged">${icon('ft-generic', cls16)}<span class="fp-ext-badge">${_fpEsc(label)}</span></span>`;
  }
  return icon('ft-' + fam, cls16);
}

// 1x1 transparent GIF: an <img> with no src renders the browser's broken-image
// glyph, so every lazily-filled image starts on this instead. It is also how
// "not resolved yet" is distinguished from "resolved" — a real shell icon or
// thumbnail always arrives as data:image/png.
const FP_BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Windows-shell icon placeholder for `entry`, resolved lazily by
 * _fpResolveWinIcon below. `fallbackSymbol` is the sprite symbol rendered
 * instead if neither shell tier has an icon (or we are not running under
 * Electron at all). */
function _winIcon(entry, size, fallbackSymbol, cls = '') {
  const cls16 = `fp-icon--${size}${cls ? ' ' + cls : ''}`;
  const p = entry && entry.path;
  if (!p) return icon(fallbackSymbol, cls16);
  const ext = String(entry.ext || '').replace(/^\./, '');
  const dirAttr = entry.is_dir ? ' data-dir=""' : '';
  return `<img class="fp-icon fp-icon--win ${cls16}" alt="" src="${FP_BLANK_PX}"`
    + ` data-win-icon="${_fpEsc(p)}" data-ext="${_fpEsc(ext)}" data-size="${size}"${dirAttr}`
    + ` data-fallback="${_fpEsc(fallbackSymbol)}">`;
}

/** Sprite icon + a shell thumbnail layered over it: the icon shows
 * immediately and the thumbnail fades in on top once the shell answers, so a
 * file whose content cannot be thumbnailed simply keeps its family icon
 * (.fp-thumb--failed hides the <img> again) instead of flashing a hole. */
function fpThumbBox(entry, size, cls = '') {
  const sym = entry.is_dir ? _folderSymbol(entry) : 'ft-' + fpFamilyFor(entry.ext);
  const ext = String(entry.ext || '').replace(/^\./, '');
  const mtime = Math.round(Number(entry.modified) || 0);
  const iconSize = size >= 64 ? 48 : (size >= 32 ? 24 : 16);
  const dirAttr = entry.is_dir ? ' data-dir=""' : '';
  return `<span class="fp-thumb-box${cls ? ' ' + cls : ''}">`
    + icon(sym, `fp-icon--${iconSize}`)
    + `<img class="fp-thumb" alt="" src="${FP_BLANK_PX}"`
    + ` data-thumb="${_fpEsc(entry.path)}" data-ext="${_fpEsc(ext)}"`
    + ` data-size="${size}" data-mtime="${mtime}"${dirAttr}>`
    + '</span>';
}

/** Grid tile visual for an entry with no thumbnail to show (a document, a
 * code file, an unreadable entry): the family/folder/shell icon centred in
 * the tile's thumbnail area, so every tile in the grid is the same size
 * whether or not the shell had a picture for it. */
function fpTileIcon(entry) {
  return `<span class="fp-thumb-box fp-tile__thumb">${iconFor(entry, 48)}</span>`;
}

/** Folder tile for grid view in 'fileplus' mode: the folder symbol, with
 * data-peek so GET /fs/peek can fan up to two of the folder's own pictures
 * over it once the tile is in view (never for an off-screen tile). The
 * folder's own mtime keys the peek cache (a folder's mtime changes when a
 * direct child is added/removed/renamed — exactly when the peek could). */
function fpFolderPeekBox(entry, cls = '') {
  const mtime = Math.round(Number(entry.modified) || 0);
  return `<span class="fp-thumb-box${cls ? ' ' + cls : ''}" data-peek="${_fpEsc(entry.path)}" data-mtime="${mtime}">`
    + icon(_folderSymbol(entry), 'fp-icon--48')
    + '</span>';
}

/* ── Lazy shell icons / thumbnails / folder peeks ──────────────────────────
 * IntersectionObservers drive all three: one per scroll container (the file
 * list, #list-scroll) plus one viewport observer for everything else, so
 * rootMargin really does preload rows just below the list's own clip edge
 * (an observer rooted at the viewport never sees a row the list has
 * clipped — pass 2 #141). Elements are registered by the MutationObserver
 * below as soon as they enter the DOM (including while display:none — a grid
 * tile rendered under the list view simply never intersects, so it costs
 * nothing), and each request only fires when the element is within 200px of
 * the viewport. Scrolling an element back out before the shell answers
 * cancels it: _fpSeq no longer matches, the answer is dropped, and the
 * element stays registered so the request is retried if it comes back.
 * Answers are memoised per key on top of main.js's own LRU caches, so a
 * re-render (sort, theme switch, view toggle) repaints from memory with no
 * IPC/HTTP at all.
 *
 * Sizing contract (pass 2 — icon design §2): every request carries
 * px = clampPx(round(cssBox * devicePixelRatio)); the bitmap that comes back
 * is exactly px*px (thumbnails: longer edge == px); the <img> is pinned to
 * px/dpr CSS px so Chromium composites it 1:1 instead of stretching a
 * lower-resolution bitmap.
 *
 * Two icon sources, one contract (design §0/§2):
 *   Tier A — POST /shell/icons (backend/winshell.shell_image,
 *            IShellItemImageFactory::GetImage at px): what Explorer draws —
 *            hinted resources at any px, real folder / known-folder /
 *            desktop.ini icons, shortcut-target icons, exact tile icons.
 *   Tier B — electronAPI.fileIcons (Chromium's app.getFileIcon): the
 *            fallback when the backend is down, too old for the route, or
 *            did not answer an item in time. Exact only at the shell's own
 *            16·S / 32·S reps; never asked for directories, extension-less
 *            files, .lnk or .url (it answers one system-drive glyph / one
 *            blank page for all of those — the sprite is more honest).
 * Design of record: docs/superpowers/specs/2026-09-14-stage-2c-pass-2-icon-design.md */

// `_IC` is window.FpIconCache, loaded by index.html right before this file
// (frontend/iconCache.js, dual-mode: also the CommonJS module main.js and
// the pure-logic tests require). Sized to match main.js's own caches: a
// renderer only ever holds what it has actually painted, and px-in-key
// multiplies entries across zoom/scale steps, so the byte budget (not just
// the entry count) is the real bound. A cached null (a definitive "no icon")
// costs 0 bytes but does count against the entry cap; fpShellIconRoute()
// drops every cached null when the route state changes so a tier that was
// unavailable gets its turn.
const _IC = window.FpIconCache;
const _fpWinIconCache = new _IC.LruCache(2000, 8 * 1024 * 1024);
const _fpThumbCache = new _IC.LruCache(600, 32 * 1024 * 1024);
const _fpPeekCache = new _IC.LruCache(300);
// key -> in-flight Promise, so two tiles of the same file (or the same tile
// re-observed after scrolling back) share one IPC/HTTP round trip.
const _fpThumbInFlight = new Map();
const _fpIconInFlight = new Map();
const _fpPeekInFlight = new Map();
let _fpIconBatch = null; // { items: Map<key, {..., resolve, waiters}> } | null
// 'unknown' | 'live' | 'absent' — see fpShellIconRoute.
let _fpShellRoute = 'unknown';
let _fpTierAInFlight = 0;
const _FP_TIER_A_MAX_ITEMS = 200;   // per POST (backend/api.py caps the same)
const _FP_TIER_A_MAX_INFLIGHT = 2;  // POSTs in flight; later flushes wait their turn
const _FP_TIER_B_MAX_ITEMS = 64;    // per electronAPI.fileIcons invoke (main.js slices the same)
window.__fpIconStats = { requested: 0, keys: 0, batches: 0, tierA: 0, tierB: 0, dropped: 0 };
let _fpLazySeq = 0;

/** px for a CSS box: round(css * devicePixelRatio), clamped to 8..512.
 * devicePixelRatio already folds in Electron's own webContents zoom, so
 * zoom is covered for free — see main.js's ZOOM_STEPS / setZoomFactor. */
function fpDevicePx(css) {
  return _IC.clampPx(Math.round(css * (window.devicePixelRatio || 1)));
}

/** The CSS width of the box a bitmap will fill: the IntersectionObserver
 * record's own boundingClientRect when available (free — no forced layout),
 * else a fresh getBoundingClientRect(), else `fallback` (the no-IO eager
 * path, or a rect measured as 0 before first layout). */
function _fpCssBox(el, rect, fallback) {
  const r = rect || el.getBoundingClientRect();
  return r && r.width > 0 ? r.width : fallback;
}

/** Route state for POST /shell/icons (Tier A). 'absent' means this backend
 * has no such route (an older build: a 404/405 on a batch, or /health
 * without the shell_icons capability flag) and the renderer stops paying an
 * HTTP round trip per batch; 'live' once /health advertises it or a batch
 * has answered; 'unknown' at startup. checkBackend (app.js) sets it from
 * /health's `shell_icons` flag on every state change of the backend pill, so
 * a restarted backend gets its turn without a failed request first.
 *
 * Changing the state drops every cached "no icon": a null that Tier B
 * answered while Tier A was absent (a folder, say — Tier B never renders
 * one) is not the final word once Tier A is live, and vice versa. Real
 * bitmaps stay cached — a key is per px and per identity, and both tiers
 * agree on what a key means. */
function fpShellIconRoute(state) {
  if (state !== undefined && state !== _fpShellRoute) {
    _fpShellRoute = state;
    _fpWinIconCache.deleteWhere((v) => v === null);
    _fpThumbCache.deleteWhere((v) => v === null);
  }
  return _fpShellRoute;
}

// ── IntersectionObservers, one per scroll root ─────────────────────────────

const _fpObserverByRoot = new Map(); // root element (or null = viewport) -> IntersectionObserver
function _fpRootFor(el) {
  return (el.closest && el.closest('#list-scroll')) || null;
}
function _fpObserverFor(el) {
  if (typeof IntersectionObserver !== 'function') return null;
  const root = _fpRootFor(el);
  let obs = _fpObserverByRoot.get(root);
  if (obs) return obs;
  obs = new IntersectionObserver((records, self) => {
    for (const rec of records) {
      const target = rec.target;
      if (!target.isConnected) {
        // Removed by a re-render (sort, navigation, view switch) — stop
        // observing it rather than holding the detached node forever.
        self.unobserve(target);
        target._fpObserved = false;
        continue;
      }
      if (rec.isIntersecting) {
        if (target.dataset.fpLazy === 'done' || target.dataset.fpLazy === 'pending') continue;
        target.dataset.fpLazy = 'pending';
        _fpStartLazy(target, rec.boundingClientRect);
      } else if (target.dataset.fpLazy === 'pending') {
        // Cancelled: drop whatever the shell eventually answers with.
        target.dataset.fpLazy = '';
        target._fpSeq = 0;
      }
    }
  }, { root, rootMargin: '200px' });
  _fpObserverByRoot.set(root, obs);
  return obs;
}

function _fpObserve(el) {
  if (!el || el._fpObserved) return;
  el._fpObserved = true;
  const obs = _fpObserverFor(el);
  if (obs) { el._fpObs = obs; obs.observe(el); }
  else { el.dataset.fpLazy = 'pending'; _fpStartLazy(el); } // no IO: resolve eagerly
}

function _fpUnobserve(el) {
  if (!el || !el._fpObserved) return;
  el._fpObserved = false;
  if (el._fpObs) { el._fpObs.unobserve(el); el._fpObs = null; }
}

const _FP_LAZY_SELECTOR = '[data-win-icon],[data-thumb],[data-peek]';

/** Registers every not-yet-registered lazy element under `root`. Called from
 * the MutationObserver (per added subtree, coalesced to one pass per frame)
 * and once at init. */
function fpScanLazyIcons(root) {
  const scope = root || document.body;
  if (!scope || !scope.querySelectorAll) return;
  if (scope.matches && scope.matches(_FP_LAZY_SELECTOR)) _fpObserve(scope);
  scope.querySelectorAll(_FP_LAZY_SELECTOR).forEach(_fpObserve);
}

/** Releases every lazy element under a subtree that just left the DOM. An
 * IntersectionObserver only delivers a record for a removed target when its
 * intersection state changes, so an off-screen row that never intersected
 * would otherwise stay observed (detached) forever — one leaked node per
 * off-screen row per re-render (pass 2 #34). */
function _fpReleaseLazyIcons(node) {
  if (!node || !node.querySelectorAll) return;
  if (node.matches && node.matches(_FP_LAZY_SELECTOR)) _fpUnobserve(node);
  node.querySelectorAll(_FP_LAZY_SELECTOR).forEach(_fpUnobserve);
}

function _fpStartLazy(el, rect) {
  const seq = ++_fpLazySeq;
  el._fpSeq = seq;
  if (el.dataset.winIcon !== undefined) return _fpResolveWinIcon(el, seq, rect);
  if (el.dataset.thumb !== undefined) {
    return fpRequestThumbnail(el, el.dataset.thumb, Number(el.dataset.size) || 96, Number(el.dataset.mtime) || 0, seq, rect);
  }
  if (el.dataset.peek !== undefined) return _fpResolveFolderPeek(el, seq);
}

/** True while `el` still wants the answer it asked for: its request was not
 * cancelled (scrolled out, invalidated, re-rendered). */
function _fpStillWanted(el) {
  return !!el && el.isConnected && el._fpSeq !== 0 && el.dataset.fpLazy === 'pending';
}

function _fpSettle(el, seq, ok) {
  if (el._fpSeq !== seq || !el.isConnected) return false;
  el.dataset.fpLazy = 'done';
  if (ok) _fpUnobserve(el);
  return true;
}

/** Replaces a failed Windows-shell <img> with the sprite symbol it recorded
 * as its fallback, in place, so the row never shows an empty box. */
function _fpWinIconFallback(el) {
  const sym = el.dataset.fallback || 'ft-generic';
  const keep = [...el.classList].filter(c => c !== 'fp-icon--win' && c !== 'fp-icon').join(' ');
  el.outerHTML = icon(sym, keep);
}

// ── Windows-shell icons: Tier A (backend) then Tier B (Electron) ───────────

/** Resolves one Windows-shell <img> at the sizing contract's px (design
 * §2): px = clampPx(round(css * dpr)), the bitmap that comes back is exactly
 * px*px, and the element is pinned to px/dpr CSS px so Chromium composites it
 * 1:1 instead of stretching a lower-resolution bitmap across a larger box. */
function _fpResolveWinIcon(el, seq, rect) {
  const p = el.dataset.winIcon, ext = el.dataset.ext || '', isDir = el.dataset.dir !== undefined;
  const dpr = window.devicePixelRatio || 1;
  const css = _fpCssBox(el, rect, Number(el.dataset.size) || 16);
  const px = fpDevicePx(css);
  const key = _IC.shellIconKey(p, ext, isDir, px);
  const paint = (res) => {
    if (!_fpSettle(el, seq, true)) return;
    if (!res || !res.url) { _fpWinIconFallback(el); return; }
    el.dataset.px = String(res.px); el.dataset.exact = res.exact ? '1' : '';
    el.style.width = el.style.height = (res.px / dpr) + 'px'; // device box == bitmap, always
    el.src = res.url;
  };
  const hit = _fpWinIconCache.get(key);
  if (hit !== undefined) { paint(hit); return; }
  window.__fpIconStats.requested++;
  fpShellIconUrl(key, { path: p, ext, isDir, px }, el).then(paint);
}

/** One resolved shell icon per key, shared by every element waiting on it.
 * Never rejects — resolves to {url, px, exact} or null. Queues the request
 * into the current macrotask's batch, coalescing every icon asked for in one
 * frame (a viewport of list rows) into one POST /shell/icons (Tier A) and, for
 * whatever that did not answer, as few electronAPI.fileIcons calls as
 * possible (Tier B).
 *
 * Caching rule (design §4.4 f): an answer is memoised in _fpWinIconCache only
 * when it is definitive — a bitmap from either tier, or a null after Tier A
 * really answered null (path missing / no image) or with the route known
 * absent. A Tier B answer obtained only because Tier A was unavailable for
 * THIS batch (network error, 5xx, an item the backend marked `pending`) is
 * painted but not cached, so the next scroll retries Tier A; a Tier B invoke
 * that threw is never cached either (review: a dropped IPC must not pin the
 * sprite for the session).
 *
 * `el` (optional) is the element that wants the answer; a key none of whose
 * waiters still want it by flush time (all scrolled out) is dropped before
 * any request is made (pass 2 #35). */
function fpShellIconUrl(key, item, el) {
  const pending = _fpIconInFlight.get(key);
  if (pending) {
    if (el && _fpIconBatch && _fpIconBatch.items.has(key)) _fpIconBatch.items.get(key).waiters.push(el);
    return pending;
  }
  const settled = new Promise((resolve) => {
    if (!_fpIconBatch) _fpIconBatch = { items: new Map(), timer: setTimeout(_fpFlushIconBatch, 0) };
    _fpIconBatch.items.set(key, { ...item, key, resolve, waiters: el ? [el] : [] });
  }).then((ans) => {                            // ans = {res, cache}
    if (ans.cache) _fpWinIconCache.set(key, ans.res);
    _fpIconInFlight.delete(key);
    return ans.res;
  });
  _fpIconInFlight.set(key, settled);
  return settled;
}

async function _fpFlushIconBatch() {
  const all = [..._fpIconBatch.items.values()];
  _fpIconBatch = null;
  window.__fpIconStats.batches++;
  // A key every waiter of which has been cancelled since it was queued (a
  // fast scroll past the rows) is not worth a shell call. A caller with no
  // element (Properties' "Opens with") always wants its answer.
  const items = [];
  for (const it of all) {
    if (it.waiters.length && !it.waiters.some(_fpStillWanted)) {
      window.__fpIconStats.dropped++;
      it.resolve({ res: null, cache: false });
    } else items.push(it);
  }
  window.__fpIconStats.keys += items.length;
  if (!items.length) return;
  let rest = [];
  if (_fpShellRoute !== 'absent') {
    for (let i = 0; i < items.length; i += _FP_TIER_A_MAX_ITEMS) {
      const chunk = items.slice(i, i + _FP_TIER_A_MAX_ITEMS);
      const answers = await _fpTierA(chunk);     // null = unavailable for this chunk
      chunk.forEach((it, j) => {
        const a = answers && answers[j];
        if (a && a.png) it.resolve({ res: { url: 'data:image/png;base64,' + a.png, px: it.px, exact: true }, cache: true });
        else rest.push({ it, transient: !answers || !!(a && a.pending) });
      });
    }
  } else {
    rest = items.map((it) => ({ it, transient: false }));
  }
  if (rest.length) await _fpTierB(rest);
}

/** POST /shell/icons for one chunk; resolves to the backend's `items` (in
 * order) or null when the route did not answer this time. A 404/405 marks
 * the route absent for the rest of the session (until /health says
 * otherwise); anything else — network error, 5xx, timeout — is transient. */
async function _fpTierA(items) {
  while (_fpTierAInFlight >= _FP_TIER_A_MAX_INFLIGHT) await new Promise((r) => setTimeout(r, 15));
  _fpTierAInFlight++;
  window.__fpIconStats.tierA += items.length;
  try {
    const data = await API.post('/shell/icons',
      { items: items.map(({ path, px, isDir }) => ({ path, px, is_dir: isDir })) },
      apiTimeout());
    _fpShellRoute = 'live';
    return (data && Array.isArray(data.items)) ? data.items : null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) fpShellIconRoute('absent');
    return null;
  } finally {
    _fpTierAInFlight--;
  }
}

/** Chromium's IconLoader answers the system-drive glyph for every directory
 * and extension-less path, and one identical blank page for every .lnk/.url
 * regardless of target (measured — design §1) — the sprite fallback is more
 * honest than any of those, so those entries never reach electronAPI at all.
 * `rest` is [{it, transient}]; a refusal is cached only when it is
 * definitive (Tier A really said null / is absent), never when Tier A merely
 * did not answer this time. */
async function _fpTierB(rest) {
  const api = window.electronAPI;
  const eligible = [], refused = [];
  for (const r of rest) {
    const e = (r.it.ext || '').toLowerCase();
    (r.it.isDir || !e || e === 'lnk' || e === 'url' || !api || typeof api.fileIcons !== 'function')
      ? refused.push(r) : eligible.push(r);
  }
  refused.forEach((r) => r.it.resolve({ res: null, cache: !r.transient }));
  for (let i = 0; i < eligible.length; i += _FP_TIER_B_MAX_ITEMS) {
    const chunk = eligible.slice(i, i + _FP_TIER_B_MAX_ITEMS);
    window.__fpIconStats.tierB += chunk.length;
    let out = null;
    try { out = await api.fileIcons(chunk.map(({ it }) => ({ path: it.path, ext: it.ext, px: it.px }))); } catch (_) { out = null; }
    chunk.forEach((r, j) => {
      const res = (out && out[j]) || null;
      r.it.resolve({ res, cache: !!out && !r.transient });
    });
  }
}

// ── Thumbnails ─────────────────────────────────────────────────────────────

/** IntersectionObserver-driven shell thumbnail for one <img>, sized per the
 * sizing contract (design §2): px = clampPx(round(css * dpr)) where css is
 * measured from the BOX (the <img>'s parent .fp-thumb-box — the <img> itself
 * is a 1x1 GIF until it loads — except a peek mini, which has its own
 * explicit CSS size and is measured directly: offsetWidth, the layout box,
 * not a client rect, which for a mini would include its rotate() transform
 * and over-sample by ~15 %). Sets src and pins the element to w/dpr x h/dpr
 * device px on success; on a null answer falls back to the shell icon at the
 * same px (Windows mode only — see _fpFetchThumb), and only then gives up
 * with .fp-thumb--failed (hides the <img> so the family icon layered beneath
 * it shows through). Callers that already have an element in the DOM can
 * call this directly with just (imgEl, path, size, mtime) — size is then the
 * css-box fallback used only before first layout. */
function fpRequestThumbnail(imgEl, path, size, mtime, seq, rect) {
  if (seq === undefined) { seq = ++_fpLazySeq; imgEl._fpSeq = seq; imgEl.dataset.fpLazy = 'pending'; }
  const isMini = imgEl.classList.contains('fp-thumb--mini');
  const css = isMini
    ? (imgEl.offsetWidth || size)
    : _fpCssBox(imgEl.parentElement || imgEl, null, size);
  const px = fpDevicePx(css);
  const ext = imgEl.dataset.ext || '';
  const isDir = imgEl.dataset.dir !== undefined;
  const key = `${_IC.normalizeWinPath(path)}|${mtime}|${px}`;
  const hit = _fpThumbCache.get(key);
  if (hit !== undefined) { _fpApplyThumb(imgEl, seq, hit); return; }
  _fpFetchThumb(key, path, px, mtime, ext, isDir)
    .then((res) => _fpApplyThumb(imgEl, seq, res));
}

/** One shell round trip per key, shared by every element waiting on it and
 * memoised in _fpThumbCache when it settles. Resolves to {url, w, h} or
 * null; never rejects. A null that came from the icon fallback while Tier A
 * was unavailable is not memoised (same rule as fpShellIconUrl). */
function _fpFetchThumb(key, path, px, mtime, ext, isDir) {
  const pending = _fpThumbInFlight.get(key);
  if (pending) return pending;
  const api = window.electronAPI;
  let cacheable = true;
  const request = (!api || typeof api.thumbnail !== 'function')
    ? Promise.resolve(null)
    : Promise.resolve(api.thumbnail(path, px, mtime)).then((res) => {
      if (res) return res;
      // No content thumbnail (a .txt, an unreadable image, an empty folder,
      // a non-image the shell can't picture) — in Windows mode the shell's
      // per-type icon at the same px is still better than nothing; in
      // FilePlus mode the family sprite already underneath is the type icon
      // (spec §6.1), so this deliberately returns null rather than painting
      // a shell PNG over it.
      if (fpIconSource() !== 'windows') return null;
      const ikey = _IC.shellIconKey(path, ext, isDir, px);
      return fpShellIconUrl(ikey, { path, ext, isDir, px }).then((r) => {
        if (r && r.url) return { url: r.url, w: r.px, h: r.px };
        cacheable = _fpWinIconCache.get(ikey) === null; // the icon layer only memoises a definitive null
        return null;
      });
    });
  const settled = request.catch(() => { cacheable = false; return null; }).then((res) => {
    if (res || cacheable) _fpThumbCache.set(key, res || null);
    _fpThumbInFlight.delete(key);
    return res || null;
  });
  _fpThumbInFlight.set(key, settled);
  return settled;
}

/** Paints one resolved thumbnail onto its <img>, unless that element has
 * since been superseded, removed, or scrolled out of view. */
function _fpApplyThumb(imgEl, seq, res) {
  if (!_fpSettle(imgEl, seq, true)) return;
  const isMini = imgEl.classList.contains('fp-thumb--mini');
  // A re-request after a DPR/scale change can revive a tile that previously
  // failed at a different px — and the reverse: a tile that once had a
  // thumbnail and now resolves null must show its sprite again, not an
  // empty box (pass 2 #142).
  imgEl.classList.remove('fp-thumb--failed');
  if (!res) {
    imgEl.classList.add('fp-thumb--failed');
    imgEl.classList.remove('fp-thumb--ready');
    imgEl.style.width = imgEl.style.height = '';
    if (!isMini && imgEl.parentElement) imgEl.parentElement.classList.remove('fp-thumb-box--has-thumb');
    return;
  }
  imgEl.src = res.url;
  imgEl.classList.add('fp-thumb--ready');
  imgEl.dataset.px = String(Math.max(res.w, res.h));
  // A real thumbnail replaces the placeholder icon outright — but a folder
  // preview's mini pictures are fanned OVER the folder icon, which has to
  // stay put, so only the tile's own full-size thumbnail retires it, and
  // only the full-size thumbnail is pinned (a mini keeps its CSS 40% size).
  if (!isMini) {
    const dpr = window.devicePixelRatio || 1;
    imgEl.style.width = (res.w / dpr) + 'px';
    imgEl.style.height = (res.h / dpr) + 'px';
    if (imgEl.parentElement) imgEl.parentElement.classList.add('fp-thumb-box--has-thumb');
  }
}

// ── Folder peeks ───────────────────────────────────────────────────────────

/** GET /fs/peek for one folder, memoised per (path, mtime) and de-duplicated
 * while in flight (pass 2 #41) — every re-render rebuilds the tile, and a
 * peek is a directory walk on the backend. Resolves to the items list ([] on
 * failure); never rejects. */
function _fpFetchPeek(key, path) {
  const pending = _fpPeekInFlight.get(key);
  if (pending) return pending;
  const settled = API.get('/fs/peek', { path, n: 2 })
    .then((data) => (data && data.items) || [])
    .catch(() => null)
    .then((items) => {
      if (items) _fpPeekCache.set(key, items); // a failed request is retried next time
      _fpPeekInFlight.delete(key);
      return items || [];
    });
  _fpPeekInFlight.set(key, settled);
  return settled;
}

async function _fpResolveFolderPeek(el, seq) {
  const p = el.dataset.peek;
  const key = `${_IC.normalizeWinPath(p)}|${Number(el.dataset.mtime) || 0}`;
  const hit = _fpPeekCache.get(key);
  const items = hit !== undefined ? hit : await _fpFetchPeek(key, p);
  if (!_fpSettle(el, seq, true)) return;
  el.classList.add('fp-thumb-box--peeked');
  if (!items.length) return;
  items.slice(0, 2).forEach((item, i) => {
    const img = document.createElement('img');
    img.className = `fp-thumb fp-thumb--mini fp-thumb--mini-${i + 1}`;
    img.alt = '';
    img.src = FP_BLANK_PX;
    img.dataset.thumb = item.path;
    img.dataset.size = '38';
    // The peeked picture's own mtime keys its thumbnail (pass 2 #143) —
    // a constant would serve a stale mini for the life of the session.
    img.dataset.mtime = String(Math.round(Number(item.modified) || 0));
    img.dataset.ext = item.ext || '';
    el.appendChild(img);
    // Registered like any other lazy element (not called directly) so it
    // measures its OWN box (40% of the tile, styles.css) via the shared
    // IntersectionObserver instead of a hardcoded size, and is covered by
    // fpInvalidateLazyIcons on a DPR/zoom/list-scale change.
    _fpObserve(img);
  });
}

// ── Registration, invalidation, DPR watch ──────────────────────────────────

// Rows/tiles are painted by innerHTML assignment, so there is no single hook
// to call after each render — watch the document instead and coalesce a burst
// of mutations into one pass per frame, scoped to the subtrees that actually
// changed (the parents that gained nodes) rather than the whole document:
// two of the three resolution paths are themselves childList mutations (the
// sprite fallback's outerHTML swap, a peek's appended minis), so a document-
// wide rescan per settled row was O(rows²) on a large Windows-mode listing
// (pass 2 #145). Removed subtrees release their observers (pass 2 #34).
// A timer, not requestAnimationFrame: an occluded or minimised window stops
// painting, and icons must still resolve so the next paint is already right.
let _fpScanQueued = false;
const _fpScanTargets = new Set();
function _fpQueueScan(records) {
  if (records) {
    for (const rec of records) {
      if (rec.removedNodes && rec.removedNodes.length) rec.removedNodes.forEach(_fpReleaseLazyIcons);
      if (rec.addedNodes && rec.addedNodes.length) _fpScanTargets.add(rec.target);
    }
  } else {
    _fpScanTargets.add(document.body);
  }
  if (_fpScanQueued) return;
  _fpScanQueued = true;
  setTimeout(() => {
    _fpScanQueued = false;
    const targets = [..._fpScanTargets];
    _fpScanTargets.clear();
    for (const t of targets) if (t.isConnected) fpScanLazyIcons(t);
  }, 16);
}

/** Re-resolves every shell icon / thumbnail under `root` — settled AND still
 * pending — at its CURRENT box x devicePixelRatio. A pending one is
 * cancelled first (its in-flight answer would settle at the old px and pin
 * the stale box). The old bitmap stays on screen until the new one lands (no
 * flash); keys differ by px so this never refetches an already-seen size.
 * Called on zoom / monitor-DPI change (below) and by setListScale
 * (browser.js) when --list-scale changes the row/tile box. */
function fpInvalidateLazyIcons(root) {
  (root || document.body).querySelectorAll(
    'img.fp-icon--win[data-fp-lazy="done"], img.fp-icon--win[data-fp-lazy="pending"], '
    + 'img.fp-thumb[data-fp-lazy="done"], img.fp-thumb[data-fp-lazy="pending"]'
  ).forEach((el) => {
    el.dataset.fpLazy = ''; el._fpSeq = 0;
    _fpUnobserve(el);
    el.style.width = el.style.height = ''; // let CSS re-lay the box before it is measured again
    _fpObserve(el);
  });
}

/** Watches for a devicePixelRatio change (Electron zoom via
 * webContents.setZoomFactor, or the window moving to a monitor with a
 * different scale) and invalidates every lazy icon/thumbnail so it re-
 * resolves at the new px instead of Chromium silently resampling the old
 * bitmap. matchMedia's `change` fires once per crossing, so this re-arms
 * itself against the new dpr after each fire. */
function _fpWatchDpr() {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  mq.addEventListener('change', () => { fpInvalidateLazyIcons(document.body); _fpWatchDpr(); }, { once: true });
}

function fpInstallLazyIconWatcher() {
  if (!document.body || typeof MutationObserver !== 'function') return;
  new MutationObserver(_fpQueueScan).observe(document.body, { childList: true, subtree: true });
  fpScanLazyIcons(document.body);
  _fpWatchDpr();
}

// Install as early as possible. index.html loads every frontend/src module
// as a classic, parser-blocking <script src> placed inside <body> — by the
// time THIS script tag runs, the parser has already created the <body>
// element (document.body is truthy) even though document.readyState is
// still 'loading' (parsing hasn't reached </html> yet) and it hasn't
// finished parsing every element after this tag. Check document.body
// itself, not readyState, so the sprite installs synchronously at that
// point rather than waiting for DOMContentLoaded. The DOMContentLoaded
// fallback below only matters if this script were ever loaded before
// <body> starts (e.g. moved into <head>) — a no-op belt-and-braces path.
if (document.body) {
  fpInstallSprite();
  fpInstallLazyIconWatcher();
} else {
  document.addEventListener('DOMContentLoaded', () => { fpInstallSprite(); fpInstallLazyIconWatcher(); });
}
