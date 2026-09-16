/**
 * FilePlus icon sprite helpers. Loaded right after icons-sprite.js (which
 * defines FP_ICON_SPRITE — see scripts/build_icons.js) and before every
 * other frontend/src module, so icon()/iconFor() are safe to call from any
 * later file's own top level (const FOO = icon('...') included).
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
 * (the real Windows shell icon for the file, via electronAPI.fileIcon).
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
 * extension itself as a small badge next to the blank page icon. */
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
    return icon('ft-generic', cls16) + `<span class="fp-ext-badge">${_fpEsc(label)}</span>`;
  }
  return icon('ft-' + fam, cls16);
}

// 1x1 transparent GIF: an <img> with no src renders the browser's broken-image
// glyph, so every lazily-filled image starts on this instead. It is also how
// "not resolved yet" is distinguished from "resolved" — a real shell icon or
// thumbnail always arrives as data:image/png.
const FP_BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Windows-shell icon placeholder for `entry`, resolved lazily through
 * electronAPI.fileIcon(path, ext, size). `fallbackSymbol` is the sprite
 * symbol rendered instead if the shell has no icon (or we are not running
 * under Electron at all). */
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
 * over it once the tile is in view (never for an off-screen tile). */
function fpFolderPeekBox(entry, cls = '') {
  return `<span class="fp-thumb-box${cls ? ' ' + cls : ''}" data-peek="${_fpEsc(entry.path)}">`
    + icon(_folderSymbol(entry), 'fp-icon--48')
    + '</span>';
}

/* ── Lazy shell icons / thumbnails / folder peeks ──────────────────────────
 * One IntersectionObserver drives all three. Elements are registered by the
 * MutationObserver below as soon as they enter the DOM (including while
 * display:none — a grid tile rendered under the list view simply never
 * intersects, so it costs nothing), and each request only fires when the
 * element is within 200px of the viewport. Scrolling an element back out
 * before the shell answers cancels it: _fpSeq no longer matches, the answer
 * is dropped, and the element stays registered so the request is retried if
 * it comes back. Answers are memoised per key on top of main.js's own LRU
 * caches, so a re-render (sort, theme switch, view toggle) repaints from
 * memory with no IPC at all.
 *
 * Sizing contract (pass 2 — icon-design.md §2): every request carries
 * px = clampPx(round(cssBox * devicePixelRatio)); the bitmap that comes back
 * is exactly px*px (thumbnails: longer edge == px); the <img> is pinned to
 * px/dpr CSS px so Chromium composites it 1:1 instead of stretching a
 * lower-resolution bitmap. */

// `_IC` is window.FpIconCache, loaded by index.html right before this file
// (frontend/iconCache.js, dual-mode: also the CommonJS module main.js and
// the pure-logic tests require). Sized to match main.js's own caches: a
// renderer only ever holds what it has actually painted, and px-in-key
// multiplies entries across zoom/scale steps, so the byte budget (not just
// the entry count) is the real bound.
const _IC = window.FpIconCache;
const _fpWinIconCache = new _IC.LruCache(2000, 8 * 1024 * 1024);
const _fpThumbCache = new _IC.LruCache(600, 32 * 1024 * 1024);
// key -> in-flight Promise, so two tiles of the same file (or the same tile
// re-observed after scrolling back) share one IPC/HTTP round trip.
const _fpThumbInFlight = new Map();
const _fpIconInFlight = new Map();
let _fpIconBatch = null; // { items: Map<key, {..., resolve}>, timer } | null
window.__fpIconStats = { requested: 0, keys: 0, batches: 0, tierB: 0 };
let _fpLazySeq = 0;
let _fpLazyObserver = null;

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

function _fpObserver() {
  if (_fpLazyObserver) return _fpLazyObserver;
  if (typeof IntersectionObserver !== 'function') return null;
  _fpLazyObserver = new IntersectionObserver((records, obs) => {
    for (const rec of records) {
      const el = rec.target;
      if (!el.isConnected) {
        // Removed by a re-render (sort, navigation, view switch) — stop
        // observing it rather than holding the detached node forever.
        obs.unobserve(el);
        el._fpObserved = false;
        continue;
      }
      if (rec.isIntersecting) {
        if (el.dataset.fpLazy === 'done' || el.dataset.fpLazy === 'pending') continue;
        el.dataset.fpLazy = 'pending';
        _fpStartLazy(el, rec.boundingClientRect);
      } else if (el.dataset.fpLazy === 'pending') {
        // Cancelled: drop whatever the shell eventually answers with.
        el.dataset.fpLazy = '';
        el._fpSeq = 0;
      }
    }
  }, { rootMargin: '200px' });
  return _fpLazyObserver;
}

function _fpObserve(el) {
  if (!el || el._fpObserved) return;
  el._fpObserved = true;
  const obs = _fpObserver();
  if (obs) obs.observe(el);
  else { el.dataset.fpLazy = 'pending'; _fpStartLazy(el); } // no IO: resolve eagerly
}

/** Registers every not-yet-registered lazy element under `root`. Called from
 * the MutationObserver (coalesced to one pass per frame) and once at init. */
function fpScanLazyIcons(root) {
  const scope = root || document.body;
  if (!scope || !scope.querySelectorAll) return;
  scope.querySelectorAll('[data-win-icon],[data-thumb],[data-peek]').forEach(_fpObserve);
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

function _fpSettle(el, seq, ok) {
  if (el._fpSeq !== seq || !el.isConnected) return false;
  el.dataset.fpLazy = 'done';
  if (ok) {
    const obs = _fpObserver();
    if (obs) obs.unobserve(el);
  }
  return true;
}

/** Replaces a failed Windows-shell <img> with the sprite symbol it recorded
 * as its fallback, in place, so the row never shows an empty box. */
function _fpWinIconFallback(el) {
  const sym = el.dataset.fallback || 'ft-generic';
  const keep = [...el.classList].filter(c => c !== 'fp-icon--win' && c !== 'fp-icon').join(' ');
  el.outerHTML = icon(sym, keep);
}

/** Resolves one Windows-shell <img> at the sizing contract's px (icon-design.md
 * §2): px = clampPx(round(css * dpr)), the bitmap that comes back is exactly
 * px*px, and the element is pinned to px/dpr CSS px so Chromium composites it
 * 1:1 instead of stretching a lower-resolution bitmap across a larger box.
 *
 * Tier B (electronAPI.fileIcon(s), an Electron IPC round trip) is the only
 * source in this landing step — Tier A (POST /shell/icons, the real shell
 * via IShellItemImageFactory) is a later step that has not added the route
 * to this backend yet, and probing an HTTP route that 404s logs a Chromium
 * "Failed to load resource" console message that cannot be suppressed from
 * JS, which would fail the smoke test's zero-console-errors gate — so this
 * landing step does not call it at all. shellIconKey (rather than the
 * narrower Tier-B iconCacheKey) is still the request identity because it is
 * also what a future Tier-A cache entry would be keyed by, keeping the two
 * steps' cache entries compatible without a migration. */
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
  if (!window.electronAPI) { paint(null); return; }
  window.__fpIconStats.requested++;
  fpTierBIconUrl(key, { path: p, ext, isDir, px }).then(paint);
}

/** One resolved Tier-B icon per key, shared by every element waiting on it
 * and memoised in _fpWinIconCache when it settles (including a definitive
 * null — a directory/no-ext/lnk/url refusal, or a path the shell has no
 * icon for — so a re-render never re-asks for it). Never rejects — resolves
 * to {url, px, exact} or null. Queues the request into the current
 * macrotask's batch, coalescing every icon asked for in one frame (a
 * viewport of list rows) into as few electronAPI.fileIcons IPC calls as
 * possible (<= 64 items each). */
function fpTierBIconUrl(key, item) {
  const pending = _fpIconInFlight.get(key);
  if (pending) return pending;
  const settled = new Promise((resolve) => {
    if (!_fpIconBatch) _fpIconBatch = { items: new Map(), timer: setTimeout(_fpFlushIconBatch, 0) };
    _fpIconBatch.items.set(key, { ...item, key, resolve });
  }).then((res) => {
    _fpWinIconCache.set(key, res);
    _fpIconInFlight.delete(key);
    return res;
  });
  _fpIconInFlight.set(key, settled);
  return settled;
}

async function _fpFlushIconBatch() {
  const items = [..._fpIconBatch.items.values()];
  _fpIconBatch = null;
  window.__fpIconStats.keys += items.length;
  window.__fpIconStats.batches++;
  await _fpTierB(items);
}

/** Chromium's IconLoader answers the system-drive glyph for every directory
 * and extension-less path, and one identical blank page for every .lnk/.url
 * regardless of target (probe/out2b.json) — the sprite fallback is more
 * honest than any of those, so those entries never reach electronAPI at
 * all. Resolves every item in `items` (each {path, ext, isDir, px, resolve}
 * from fpTierBIconUrl's batch) to {url, px, exact} or null; never rejects
 * an individual item. */
async function _fpTierB(items) {
  const api = window.electronAPI;
  const eligible = [], refused = [];
  for (const it of items) {
    const e = (it.ext || '').toLowerCase();
    (it.isDir || !e || e === 'lnk' || e === 'url' || !api || typeof api.fileIcons !== 'function')
      ? refused.push(it) : eligible.push(it);
  }
  refused.forEach((it) => it.resolve(null));
  for (let i = 0; i < eligible.length; i += 64) {
    const chunk = eligible.slice(i, i + 64);
    window.__fpIconStats.tierB += chunk.length;
    let out = [];
    try { out = await api.fileIcons(chunk.map((it) => ({ path: it.path, ext: it.ext, px: it.px }))); } catch (_) { out = []; }
    chunk.forEach((it, j) => it.resolve(out[j] || null));
  }
}

/** IntersectionObserver-driven shell thumbnail for one <img>, sized per the
 * sizing contract (icon-design.md §2): px = clampPx(round(css * dpr)) where
 * css is measured from the BOX (the <img>'s parent .fp-thumb-box — the
 * <img> itself is a 1x1 GIF until it loads — except a peek mini, which has
 * its own explicit CSS size and is measured directly). Sets src and pins the
 * element to w/dpr x h/dpr device px on success; on a null answer falls back
 * to the shell icon at the same px (Windows mode only — see _fpFetchThumb),
 * and only then gives up with .fp-thumb--failed (hides the <img> so the
 * family icon layered beneath it shows through). Callers that already have
 * an element in the DOM can call this directly with just
 * (imgEl, path, size, mtime) — size is then the css-box fallback used only
 * before first layout. */
function fpRequestThumbnail(imgEl, path, size, mtime, seq, rect) {
  if (seq === undefined) { seq = ++_fpLazySeq; imgEl._fpSeq = seq; imgEl.dataset.fpLazy = 'pending'; }
  const isMini = imgEl.classList.contains('fp-thumb--mini');
  const boxEl = isMini ? imgEl : imgEl.parentElement;
  const css = _fpCssBox(boxEl, isMini ? rect : null, size);
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
 * null; never rejects. */
function _fpFetchThumb(key, path, px, mtime, ext, isDir) {
  const pending = _fpThumbInFlight.get(key);
  if (pending) return pending;
  const api = window.electronAPI;
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
      return fpTierBIconUrl(_IC.shellIconKey(path, ext, isDir, px), { path, ext, isDir, px })
        .then((r) => (r && r.url) ? { url: r.url, w: r.px, h: r.px } : null);
    });
  const settled = request.catch(() => null).then((res) => {
    _fpThumbCache.set(key, res || null);
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
  // A re-request after a DPR/scale change can revive a tile that previously
  // failed at a different px.
  imgEl.classList.remove('fp-thumb--failed');
  if (!res) { imgEl.classList.add('fp-thumb--failed'); return; }
  imgEl.src = res.url;
  imgEl.classList.add('fp-thumb--ready');
  imgEl.dataset.px = String(Math.max(res.w, res.h));
  // A real thumbnail replaces the placeholder icon outright — but a folder
  // preview's mini pictures are fanned OVER the folder icon, which has to
  // stay put, so only the tile's own full-size thumbnail retires it, and
  // only the full-size thumbnail is pinned (a mini keeps its CSS 40% size).
  if (!imgEl.classList.contains('fp-thumb--mini')) {
    const dpr = window.devicePixelRatio || 1;
    imgEl.style.width = (res.w / dpr) + 'px';
    imgEl.style.height = (res.h / dpr) + 'px';
    if (imgEl.parentElement) imgEl.parentElement.classList.add('fp-thumb-box--has-thumb');
  }
}

async function _fpResolveFolderPeek(el, seq) {
  const p = el.dataset.peek;
  let items;
  try {
    const data = await API.get('/fs/peek', { path: p, n: 2 });
    items = (data && data.items) || [];
  } catch (_) {
    if (_fpSettle(el, seq, true)) el.classList.add('fp-thumb-box--peeked');
    return;
  }
  if (!_fpSettle(el, seq, true)) return;
  if (!items.length) return;
  el.classList.add('fp-thumb-box--peeked');
  items.slice(0, 2).forEach((item, i) => {
    const img = document.createElement('img');
    img.className = `fp-thumb fp-thumb--mini fp-thumb--mini-${i + 1}`;
    img.alt = '';
    img.src = FP_BLANK_PX;
    img.dataset.thumb = item.path;
    img.dataset.size = '38';
    img.dataset.mtime = '0';
    img.dataset.ext = item.ext || '';
    el.appendChild(img);
    // Registered like any other lazy element (not called directly) so it
    // measures its OWN box (40% of the tile, styles.css) via the shared
    // IntersectionObserver instead of a hardcoded size, and is covered by
    // fpInvalidateLazyIcons on a DPR/zoom/list-scale change.
    _fpObserve(img);
  });
}

// Rows/tiles are painted by innerHTML assignment, so there is no single hook
// to call after each render — watch the document instead and coalesce a burst
// of mutations into one scan per frame.
// A timer, not requestAnimationFrame: an occluded or minimised window stops
// painting, and icons must still resolve so the next paint is already right.
let _fpScanQueued = false;
function _fpQueueScan() {
  if (_fpScanQueued) return;
  _fpScanQueued = true;
  setTimeout(() => { _fpScanQueued = false; fpScanLazyIcons(document.body); }, 16);
}

/** Re-resolves every settled shell icon / thumbnail under `root` at its
 * CURRENT box x devicePixelRatio. The old bitmap stays on screen until the
 * new one lands (no flash); keys differ by px so this never refetches an
 * already-seen size. Called on zoom / monitor-DPI change (below) and by
 * setListScale (browser.js) when --list-scale changes the row/tile box. */
function fpInvalidateLazyIcons(root) {
  (root || document.body).querySelectorAll('img.fp-icon--win[data-fp-lazy="done"], img.fp-thumb[data-fp-lazy="done"]').forEach((el) => {
    el.dataset.fpLazy = ''; el._fpSeq = 0; el._fpObserved = false;
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
