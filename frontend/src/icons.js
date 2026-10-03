/**
 * FilePlus icon sprite helpers. Loaded after icons-sprite.js (which
 * defines FP_ICON_SPRITE — see scripts/build_icons.js), iconCache.js
 * (window.FpIconCache — the dual-mode key/LRU module main.js also requires)
 * and overlayscroll.js, and before every other frontend/src module, so
 * icon()/iconFor() are safe
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

/** Every chrome symbol that reaches icon() / fpShellItemIcon() through a
 * variable — a data table or a lookup — rather than as a literal at the call
 * site: search.js's filter rows (`icon: '…'`) and app.js's QUICK_ACCESS_ICON
 * (plus its 'folder' fallback). scripts/check_icons.js (verify) requires each
 * name to resolve to a sprite symbol, and every value of those tables to be
 * listed here — add a name here when a table gains one. (A literal icon() name
 * is checked where it is written; ft-* family and folder symbols are checked
 * against filetypes.js and FP_FOLDER_SPECIALS.) */
const FP_DYNAMIC_ICON_SYMBOLS = Object.freeze([
  'folder', 'file', 'history', 'drive', 'tag', 'filter', // search.js filter rows
  'desktop', 'download', 'screenshots',                   // app.js QUICK_ACCESS_ICON
]);

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
 * (pass 2 #146).
 *
 * Small sizes (Stage 2D §4.5): at <= 32 logical px a FilePlus-mode icon is
 * the compact variant (.fp-icon--compact — the family glyph alone; CSS hides
 * the extension badge). In Windows mode the same simplification comes from
 * asking the shell for the true physical px (fpDevicePx), which picks its
 * own small, simplified resource. */
function iconFor(entry, size = 16, cls = '') {
  const compact = size <= 32;
  const cls16 = `fp-icon--${size}${compact ? ' fp-icon--compact' : ''}${cls ? ' ' + cls : ''}`;
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
    return `<span class="fp-icon-badged${compact ? ' fp-icon-badged--compact' : ''}">${icon('ft-generic', cls16)}<span class="fp-ext-badge">${_fpEsc(label)}</span></span>`;
  }
  return icon('ft-' + fam, cls16);
}

/** The item's TYPE icon at `logicalPx`, never its thumbnail (Stage 2D §4.6):
 * the shell icon for the extension (an `ext:` key) for an ordinary file, the
 * per-path icon for a per-path kind (.exe, .lnk, …), the folder icon for a
 * directory — or the family sprite in FilePlus mode. Properties' header uses
 * it, and so does a thumbnail slot while its thumbnail is unresolved (an
 * image's type icon is a truthful stand-in). */
function fpTypeIconFor(entry, logicalPx, cls = '') {
  return iconFor(entry, logicalPx, cls);
}

/** An ITEM icon at a site whose FilePlus-mode look is a chrome glyph (a tab,
 * a sidebar folder or drive, the breadcrumb's drive crumb): the real Windows
 * shell icon for `entry` in Windows mode (Stage 2D §4.6), the chrome symbol
 * `chromeSym` otherwise (at `chromeSize`, which defaults to `size`). */
function fpShellItemIcon(entry, size, chromeSym, cls = '', chromeSize = size) {
  if (fpIconSource() === 'windows' && entry && entry.path) return _winIcon(entry, size, chromeSym, cls);
  return icon(chromeSym, `fp-icon--${chromeSize}${cls ? ' ' + cls : ''}`);
}

// 1x1 transparent GIF: an <img> with no src renders the browser's broken-image
// glyph, so every lazily-filled image starts on this instead. It is also how
// "not resolved yet" is distinguished from "resolved" — a real shell icon or
// thumbnail always arrives as data:image/png.
const FP_BLANK_PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Windows-shell icon for `entry` at `size` logical px (Stage 2D §4.2).
 *
 * Synchronous cache paint first: the renderer LRU is looked up with the
 * exact key the lazy path would ask for (fpDevicePx(size) — the px bucket),
 * and a hit is emitted already settled (src set, data-fp-lazy="done", never
 * registered with an observer, no transition), so a revisited folder or tab
 * paints its real icons in the same frame as its rows. A cached null (both
 * tiers definitively had nothing) paints the sprite at once.
 *
 * On a miss, a per-path kind (a folder, .exe, .lnk, …) paints the shell's
 * generic icon for that kind when one is known (data-generic="1"); the lazy
 * per-path answer replaces it only if its bytes differ, so a plain folder
 * never visibly changes. Anything else is an empty slot of its exact size
 * (the 1x1 blank GIF), resolved lazily by _fpResolveWinIcon below, which
 * fades the bitmap in. `fallbackSymbol` is the sprite symbol rendered only
 * when neither shell tier has an icon (or we are not running under Electron
 * at all). Sizing is CSS's job (the .fp-icon--N modifier, or the row/tile
 * box from --icon-size); the bitmap is the px bucket and the browser
 * downsamples (§4.3). */
function _winIcon(entry, size, fallbackSymbol, cls = '') {
  const cached = fpCachedIconImg(entry, size, cls, fallbackSymbol);
  if (cached) return cached;
  const compact = size <= 32 ? ' fp-icon--compact' : '';
  const cls16 = `fp-icon--${size}${cls ? ' ' + cls : ''}`;
  const p = entry && entry.path;
  if (!p) return icon(fallbackSymbol, cls16 + compact);
  const attrs = _fpWinIconAttrs(entry, size, fallbackSymbol);
  const px = fpDevicePx(size);
  const gk = fpGenericKey(entry, px);
  const generic = gk ? _fpGenerics.get(gk) : null;
  const ext = String(entry.ext || '').replace(/^\./, '');
  if (_fpWinIconCache.get(_IC.shellIconKey(p, ext, !!entry.is_dir, px)) === null) {
    // Both tiers definitively had nothing (for a folder: Tier A absent, and
    // Tier B never renders one). A folder keeps the shell's generic folder —
    // the same icon it showed while it was a miss, so it never flips from
    // generic to sprite between renders; anything else gets the sprite.
    if (generic) {
      return `<img class="fp-icon fp-icon--win ${cls16} is-settled" alt="" src="${_fpEsc(generic)}"${attrs}`
        + ' data-generic="1" data-fp-lazy="done">';
    }
    return icon(fallbackSymbol, cls16 + compact);
  }
  if (generic) {
    return `<img class="fp-icon fp-icon--win ${cls16} is-settled" alt="" src="${_fpEsc(generic)}"${attrs} data-generic="1">`;
  }
  return `<img class="fp-icon fp-icon--win ${cls16}" alt="" src="${FP_BLANK_PX}"${attrs}>`;
}

function _fpWinIconAttrs(entry, size, fallbackSymbol) {
  const ext = String(entry.ext || '').replace(/^\./, '');
  return ` data-win-icon="${_fpEsc(entry.path)}" data-ext="${_fpEsc(ext)}" data-size="${size}"${entry.is_dir ? ' data-dir=""' : ''}`
    + ` data-fallback="${_fpEsc(fallbackSymbol)}"`;
}

/** Same markup as a Windows-mode iconFor(), whatever ui.icon_source says —
 * for the one place that always shows the shell's own icon (Properties'
 * "Opens with" app). */
function fpShellIconMarkup(entry, size, fallbackSymbol, cls = '') {
  return _winIcon(entry, size, fallbackSymbol, cls);
}

/** Synchronous markup for a cached shell icon of `entry` at `logicalPx` —
 * the settled <img> (src set, data-fp-lazy="done", never registered with an
 * observer, no transition) — or null when the renderer cache has no bitmap
 * for that exact key yet. The one implementation of the cache paint:
 * _winIcon starts here. */
function fpCachedIconImg(entry, logicalPx, cls = '', fallbackSymbol = null) {
  if (!entry || !entry.path) return null;
  const ext = String(entry.ext || '').replace(/^\./, '');
  const key = _IC.shellIconKey(entry.path, ext, !!entry.is_dir, fpDevicePx(logicalPx));
  const hit = _fpWinIconCache.get(key);
  if (!hit || !hit.url) return null;
  const fallback = fallbackSymbol || (entry.is_dir ? 'ft-folder' : 'ft-generic');
  return `<img class="fp-icon fp-icon--win fp-icon--${logicalPx}${cls ? ' ' + cls : ''} is-settled" alt=""`
    + ` src="${_fpEsc(hit.url)}"${_fpWinIconAttrs(entry, logicalPx, fallback)}`
    + ` data-key="${_fpEsc(key)}" data-px="${hit.px}" data-exact="${hit.exact ? '1' : ''}" data-fp-lazy="done">`;
}

/** The cache key of the shell's GENERIC icon for a per-path kind at `px`
 * (Stage 2D §4.2): `dir:*:<px>` for a folder, `ext:.<ext>:<px>` for .exe,
 * .lnk, .url, .ico and the other per-path extensions; null for an ordinary
 * file, whose `ext:` key is already shared. Only the folder generic is ever
 * filled (see _fpVoteGeneric): the shell draws an .exe / .lnk / .ico from
 * the file itself, so no bitmap the renderer can obtain is that kind's true
 * generic — those slots stay empty until the per-path answer arrives. */
function fpGenericKey(entry, px) {
  if (!entry) return null;
  // A drive root is drawn as a drive, never as a folder: no generic for it.
  if (entry.is_dir) return _fpIsDriveRoot(entry.path) ? null : `dir:*:${px}`;
  const e = String(entry.ext || '').replace(/^\./, '').toLowerCase();
  return _IC.PER_PATH_SHELL_EXTS.has(e) ? `ext:.${e}:${px}` : null;
}

/** Inline size for a resolved (non-mini) thumbnail: its own box, at the
 * picture's aspect ratio, as a share of the s×s slot — so it scales with
 * --icon-size in the same frame as its cell and never needs re-pinning. */
function _fpThumbBoxSize(res) {
  const m = Math.max(res.w, res.h) || 1;
  return { width: `${(res.w / m) * 100}%`, height: `${(res.h / m) * 100}%` };
}
function _fpThumbBoxStyle(res) {
  const s = _fpThumbBoxSize(res);
  return `width:${s.width};height:${s.height}`;
}

/** Thumbnail slot (Stage 2D §4.4): the item's TYPE icon (the shell icon in
 * Windows mode — cached, generic or an empty slot, never the FilePlus
 * sprite; the family sprite in FilePlus mode, where it IS the type icon)
 * with the shell thumbnail layered over it. The thumbnail crossfades in over
 * the type icon once the shell answers; a file whose content cannot be
 * thumbnailed keeps its type icon (.fp-thumb--failed hides the <img>).
 *
 * Cache paint: a cached thumbnail is emitted already settled, alone (no type
 * icon under it); a cached "no thumbnail" emits the type icon alone. */
function fpThumbBox(entry, size, cls = '') {
  const sym = entry.is_dir ? _folderSymbol(entry) : 'ft-' + fpFamilyFor(entry.ext);
  const ext = String(entry.ext || '').replace(/^\./, '');
  const mtime = Math.round(Number(entry.modified) || 0);
  const dirAttr = entry.is_dir ? ' data-dir=""' : '';
  const boxCls = `fp-thumb-box${cls ? ' ' + cls : ''}`;
  const thumbAttrs = ` data-thumb="${_fpEsc(entry.path)}" data-ext="${_fpEsc(ext)}"`
    + ` data-size="${size}" data-mtime="${mtime}"${dirAttr}`;
  const px = fpDevicePx(size);
  const hit = entry.path ? _fpThumbCache.get(_fpThumbKey(entry.path, mtime, px)) : undefined;
  if (hit && hit.url) {
    return `<span class="${boxCls} fp-thumb-box--has-thumb">`
      + `<img class="fp-thumb fp-thumb--ready is-settled" alt="" src="${_fpEsc(hit.url)}" style="${_fpThumbBoxStyle(hit)}"`
      + `${thumbAttrs} data-px="${Math.max(hit.w, hit.h)}" data-fp-lazy="done">`
      + '</span>';
  }
  const typeIcon = fpIconSource() === 'windows'
    ? _winIcon(entry, size, sym, 'fp-thumb-box__type')
    : icon(sym, `fp-icon--${size >= 64 ? 48 : (size >= 32 ? 24 : 16)} fp-thumb-box__type`);
  if (hit === null) return `<span class="${boxCls}">${typeIcon}</span>`;
  return `<span class="${boxCls}">${typeIcon}`
    + `<img class="fp-thumb" alt="" src="${FP_BLANK_PX}"${thumbAttrs}>`
    + '</span>';
}

/** Grid tile visual for an entry with no thumbnail to show (a document, a
 * code file, an unreadable entry): the family/folder/shell icon centred in
 * the tile's thumbnail area, so every tile in the grid is the same size
 * whether or not the shell had a picture for it. `size` is the tile's
 * logical icon size (the --icon-size of the grid); a Windows shell icon
 * fills the whole s×s box, as Explorer's own large icons do. */
function fpTileIcon(entry, size = 96) {
  return `<span class="fp-thumb-box fp-tile__thumb">${iconFor(entry, size)}</span>`;
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
 * Sizing contract (Stage 2D §4.3, refining pass 2's icon design §2): every
 * request carries px = fpDevicePx(box) — round(box * devicePixelRatio)
 * snapped up to a px bucket; the bitmap that comes back is exactly px*px
 * (thumbnails: longer edge == px); the <img> is CSS-sized to its logical box
 * and the browser downsamples, so a bitmap landing never changes a box.
 *
 * No flash (Stage 2D §4.2): markup is built from the cache first — a hit is
 * painted settled with its row, a per-path miss paints the shell's generic
 * for its kind, any other miss is an empty slot; the FilePlus sprite reaches
 * an item in Windows mode only after both tiers failed for it.
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
// Icon budget sized for the largest bucket (Stage 2D fix round): a 256-px
// shell icon measured 3.6-85 KB as a data URL (median 13 KB, p90 81 KB over
// folders, .exe, .dll, .lnk and documents), so a 300-item folder of distinct
// per-path icons at 256 is at most ~300 x 85 KB = 25.5 MB. 32 MiB holds that
// with room for the 16-48 px entries of the sidebar, tabs and other views.
// Plain folders cost nothing extra: their entries share the generic's string
// and are charged 0 bytes (see fpShellIconUrl).
const _fpWinIconCache = new _IC.LruCache(2000, 32 * 1024 * 1024);
const _fpThumbCache = new _IC.LruCache(600, 32 * 1024 * 1024);
const _fpPeekCache = new _IC.LruCache(300);
// key -> in-flight Promise, so two tiles of the same file (or the same tile
// re-observed after scrolling back) share one IPC/HTTP round trip.
const _fpThumbInFlight = new Map();
const _fpIconInFlight = new Map();
const _fpPeekInFlight = new Map();
// Generic icons for per-path kinds (Stage 2D §4.2): generic key ->
// data URL. Never evicted (one per px bucket). See _fpVoteGeneric.
const _fpGenerics = new Map();
const _fpGenericVotes = new Map(); // generic key -> Map<url, count>
let _fpIconBatch = null; // { items: Map<key, {..., resolve, waiters}> } | null
// 'unknown' | 'live' | 'absent' — see fpShellIconRoute.
let _fpShellRoute = 'unknown';
let _fpTierAInFlight = 0;
const _FP_TIER_A_MAX_ITEMS = 200;   // per POST (backend/api.py caps the same)
const _FP_TIER_A_MAX_INFLIGHT = 2;  // POSTs in flight; later flushes wait their turn
const _FP_TIER_B_MAX_ITEMS = 64;    // per electronAPI.fileIcons invoke (main.js slices the same)
window.__fpIconStats = { requested: 0, keys: 0, batches: 0, tierA: 0, tierB: 0, dropped: 0 };
let _fpLazySeq = 0;
let _fpDecodeSwaps = 0; // _fpSwapAfterDecode swaps still waiting on decode()
/** Nothing in the icon pipeline is still on its way: no batch queued, no
 * shell icon / thumbnail / peek request unanswered, no decoded swap pending.
 * The Electron tests' settle signal (instead of sleeping past it). */
window.__fpIconsIdle = () => !_fpIconBatch && _fpIconInFlight.size === 0 && _fpThumbInFlight.size === 0
  && _fpPeekInFlight.size === 0 && _fpDecodeSwaps === 0;

/** The physical px every shell icon / thumbnail request for a `css`-px box
 * goes out at (Stage 2D §4.3): round(css * devicePixelRatio) snapped UP to
 * the next px bucket (fpIconBucket, iconCache.js), capped at 256. The <img>
 * stays CSS-sized to its logical box and the browser downsamples; at <= 32
 * logical px the snap is at most one step, so the shell still picks its own
 * small, simplified resource. devicePixelRatio already folds in Electron's
 * webContents zoom — see main.js's ZOOM_STEPS / setZoomFactor. */
function fpDevicePx(css) {
  return _IC.fpIconBucket(Math.round(css * (window.devicePixelRatio || 1)));
}

/** The logical size of the box a bitmap will fill: the IntersectionObserver
 * record's own boundingClientRect when available (free — no forced layout),
 * else a fresh getBoundingClientRect(), else `declared` (the element's own
 * data-size: the no-IO eager path, or a rect measured as 0 before first
 * layout). A measurement within 10% of `declared` IS the declared size — a
 * transient transform (a drag target's scale(1.05)) or sub-pixel layout must
 * not move a request into another bucket, and the markup's synchronous cache
 * paint looked the key up at the declared size. */
function _fpCssBox(el, rect, declared) {
  const r = rect || el.getBoundingClientRect();
  const w = r && r.width > 0 ? r.width : 0;
  if (!w) return declared;
  return declared && Math.abs(w - declared) <= declared * 0.1 ? declared : w;
}

function _fpThumbKey(path, mtime, px) {
  return `${_IC.normalizeWinPath(path)}|${mtime}|${px}`;
}

function _fpIsDriveRoot(p) {
  return /^[A-Za-z]:[\\/]?$/.test(String(p || ''));
}

/** Learns the shell's generic folder icon at `px` from the per-path answers
 * themselves (Stage 2D §4.2). The shell draws every plain folder (no
 * desktop.ini icon, not a known folder) byte-identically, empty or not
 * (measured), so the most frequent bitmap among ordinary folders at a px IS
 * the generic. A vote, so one custom-icon folder cannot make every folder
 * flash its icon: a bitmap is adopted only once at least two different
 * folders agree on it, each folder votes once per px, known folders and
 * drive roots never vote, and nothing votes until GET /known-folders has
 * answered (before that a Desktop or Downloads would count as ordinary).
 * Returns the generic url for `px` (or null). */
const _FP_GENERIC_MIN_VOTES = 2;
const _fpGenericVoters = new Set(); // per-path keys that have voted
function _fpVoteGeneric(path, px, url) {
  const gk = `dir:*:${px}`;
  if (!url || !window.__fpKnownFolders || _fpIsDriveRoot(path) || fpKnownFolderIdFor(path)) {
    return _fpGenerics.get(gk) || null;
  }
  const voter = _IC.shellIconKey(path, '', true, px);
  if (_fpGenericVoters.has(voter)) return _fpGenerics.get(gk) || null;
  _fpGenericVoters.add(voter);
  let votes = _fpGenericVotes.get(gk);
  if (!votes) { votes = new Map(); _fpGenericVotes.set(gk, votes); }
  votes.set(url, (votes.get(url) || 0) + 1);
  let best = null, n = 0;
  for (const [u, c] of votes) if (c > n) { best = u; n = c; }
  // Bounded: a folder of custom icons adds one single-vote entry each.
  if (votes.size > 32) for (const [u, c] of [...votes]) if (c === 1 && u !== best) votes.delete(u);
  if (n < _FP_GENERIC_MIN_VOTES) return _fpGenerics.get(gk) || null;
  if (_fpGenerics.get(gk) !== best) {
    _fpGenerics.set(gk, best);
    _fpShareGenericEntries(px, best);
  }
  return best;
}

/** Re-points every cached per-path folder entry at `px` whose bitmap is the
 * generic at the generic's own string, charged 0 bytes — one copy of the
 * bytes for all plain folders (Stage 2D fix round, cache budget). */
function _fpShareGenericEntries(px, url) {
  const suffix = `:${px}`;
  for (const [k, v] of _fpWinIconCache.entries()) {
    if (v && v.url === url && v.bytes !== 0 && k.startsWith('dir:') && k.endsWith(suffix)) {
      _fpWinIconCache.replace(k, { ...v, url, bytes: 0 });
    }
  }
}

// Sample folders for prewarming the generic folder icon before any listing
// has been seen: the root listing's own sub-folders (GET /fs/list/root),
// fetched once.
let _fpGenericSampleDirs = null;
function _fpGenericSamples() {
  if (!_fpGenericSampleDirs) {
    _fpGenericSampleDirs = API.get('/fs/list/root', null, apiTimeout())
      .then((d) => {
        const base = String((d && d.path) || '').replace(/[\\/]+$/, '');
        return ((d && d.entries) || []).filter((e) => e.is_dir && !e.error).slice(0, 4)
          .map((e) => `${base}\\${e.name}`);
      })
      .catch(() => { _fpGenericSampleDirs = null; return []; });
  }
  return _fpGenericSampleDirs;
}

/** Resolves the generic folder icon at the bucket of `logicalPx` once, ahead
 * of the first listing that needs it (Stage 2D §4.2 "Prewarm"): at startup,
 * when Windows mode is switched on, and on every icon-size bucket change.
 * The open folder's own ordinary sub-folders are the samples when there are
 * any, else the root listing's. No-op outside Windows mode, without Tier A
 * (Tier B never renders a folder), or once the generic is known. */
async function fpPrewarmGenerics(logicalPx) {
  // 'live' only: no request while the route is still 'unknown' (checkBackend
  // turning it live prewarms again), and none before the known-folder map has
  // loaded, since votes wait for it (app.js init prewarms right after it).
  if (fpIconSource() !== 'windows' || _fpShellRoute !== 'live' || !window.__fpKnownFolders) return;
  const px = fpDevicePx(logicalPx);
  if (_fpGenerics.has(`dir:*:${px}`)) return;
  let samples = [];
  if (typeof browserState !== 'undefined' && browserState.path && Array.isArray(browserState.entries)) {
    const base = String(browserState.path).replace(/[\\/]+$/, '');
    samples = browserState.entries.filter((e) => e.is_dir && !e.error).slice(0, 4).map((e) => `${base}\\${e.name}`)
      .filter((p) => !fpKnownFolderIdFor(p));
  }
  if (!samples.length) samples = await _fpGenericSamples();
  for (const p of samples) {
    const key = _IC.shellIconKey(p, '', true, px);
    const hit = _fpWinIconCache.get(key);
    // Already answered (perhaps before votes were open): vote with it now.
    if (hit && hit.url) { _fpVoteGeneric(p, px, hit.url); continue; }
    if (hit === null) continue;
    fpShellIconUrl(key, { path: p, ext: '', isDir: true, px });
  }
}

/** Prewarms the generic folder icon for every size on screen: 16 px (rows,
 * sidebar, tabs) and the Browser's current icon size (browser.js
 * fpListIconSize — loaded later, so looked up at call time). */
function fpPrewarmIconSizes() {
  fpPrewarmGenerics(16);
  if (typeof fpListIconSize === 'function') fpPrewarmGenerics(fpListIconSize());
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
    if (state === 'live') fpPrewarmIconSizes();
  }
  return _fpShellRoute;
}

/** Settings › Data › "Clear icon and thumbnail cache" (Stage 2D Task 12a):
 * empties this renderer's shell-icon, thumbnail and folder-peek LRUs and
 * returns how many entries went (settings.js clears the main process's and
 * the backend's too). The learned generic folder bitmaps (_fpGenerics) stay:
 * the shell draws them identically all session, and dropping them would
 * bring back the folder flash §4.2 removed. Icons on screen re-resolve
 * through fpInvalidateLazyIcons, which swaps only once a new bitmap has
 * decoded — nothing blanks. */
function fpClearIconCaches() {
  const n = _fpWinIconCache.clear() + _fpThumbCache.clear() + _fpPeekCache.clear();
  fpInvalidateLazyIcons(document.body);
  return n;
}

/** Entry counts of the renderer's icon LRUs (diagnostics and tests). */
function fpIconCacheSizes() {
  return { icons: _fpWinIconCache.size, thumbnails: _fpThumbCache.size, peeks: _fpPeekCache.size };
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
  // A settled element (painted from cache with its markup, or resolved
  // already) has nothing left to ask for until fpInvalidateLazyIcons resets it.
  if (!el || el._fpObserved || el.dataset.fpLazy === 'done') return;
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
 * as its fallback, in place, so the row never shows an empty box. This is
 * the ONLY way the FilePlus sprite reaches an item in Windows mode: after
 * both shell tiers have failed for it (Stage 2D §4.2). */
function _fpWinIconFallback(el) {
  const sym = el.dataset.fallback || 'ft-generic';
  const size = Number(el.dataset.size) || 16;
  const keep = [...el.classList].filter(c => c !== 'fp-icon--win' && c !== 'fp-icon'
    && c !== 'is-settled' && c !== 'fp-icon--fade-in');
  if (size <= 32) keep.push('fp-icon--compact');
  el.outerHTML = icon(sym, keep.join(' '));
}

/** True when `img` already shows a real bitmap (a generic, or the previous
 * bucket's icon) rather than the blank placeholder. */
function _fpHasBitmap(img) {
  return !!img.getAttribute('src') && !img.getAttribute('src').startsWith('data:image/gif');
}

/** Assigns `url` to `img` only after it has decoded on a detached Image, so
 * the swap shows no blank frame (Stage 2D §4.3) — the box is CSS-sized and
 * never changes. `stillWanted()` is re-checked after the decode. */
function _fpSwapAfterDecode(img, url, stillWanted, after) {
  const pre = new Image();
  pre.src = url;
  _fpDecodeSwaps++;
  const swap = () => {
    _fpDecodeSwaps--;
    if (!stillWanted()) return;
    img.src = url;
    if (after) after();
  };
  pre.decode().then(swap, swap);
}

// ── Windows-shell icons: Tier A (backend) then Tier B (Electron) ───────────

/** Resolves one Windows-shell <img> at the px bucket of its logical box
 * (Stage 2D §4.3; design §2): px = fpDevicePx(box). The <img> stays CSS-sized
 * to its box (the browser downsamples the bucket's bitmap).
 *
 * How the answer lands depends on what the slot shows now:
 *  - the same bitmap (a generic that turned out right, or a re-request that
 *    hit the same key) — nothing moves;
 *  - another real bitmap (a generic for a special folder, the previous
 *    bucket after a size change) — swapped after decode(), no blank frame;
 *  - the empty placeholder — painted with a --motion-fast fade-in (none
 *    when animations are off).
 * A null answer keeps a bitmap already on screen and otherwise falls back to
 * the sprite. */
function _fpResolveWinIcon(el, seq, rect) {
  const p = el.dataset.winIcon, ext = el.dataset.ext || '', isDir = el.dataset.dir !== undefined;
  const css = _fpCssBox(el, rect, Number(el.dataset.size) || 16);
  const px = fpDevicePx(css);
  const key = _IC.shellIconKey(p, ext, isDir, px);
  const paint = (res) => {
    if (!_fpSettle(el, seq, true)) return;
    const showing = _fpHasBitmap(el);
    if (!res || !res.url) {
      if (showing) return; // a generic (or the previous bucket) stays
      const gk = isDir ? fpGenericKey({ is_dir: true, path: p }, px) : null;
      const generic = gk ? _fpGenerics.get(gk) : null;
      if (generic) {
        el.src = generic;
        el.dataset.generic = '1';
        el.classList.add('fp-icon--fade-in');
        return;
      }
      _fpWinIconFallback(el);
      return;
    }
    el.dataset.key = key;
    el.dataset.px = String(res.px);
    el.dataset.exact = res.exact ? '1' : '';
    if (el.getAttribute('src') === res.url) { delete el.dataset.generic; return; }
    if (showing) {
      _fpSwapAfterDecode(el, res.url, () => el.isConnected && el._fpSeq === seq,
        () => { delete el.dataset.generic; });
      return;
    }
    el.src = res.url;
    el.classList.add('fp-icon--fade-in');
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
    if (ans.cache && ans.res && ans.res.url && item.isDir) {
      // A plain folder's bitmap IS the generic: keep one copy of its bytes —
      // the entry (and the <img>) use the generic's own string, charged 0.
      const generic = _fpVoteGeneric(item.path, item.px, ans.res.url);
      if (generic && generic === ans.res.url) ans.res = { ...ans.res, url: generic, bytes: 0 };
    }
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

/** IntersectionObserver-driven shell thumbnail for one <img>, requested at
 * fpDevicePx(box) (Stage 2D §4.3) where the box is the <img>'s parent
 * .fp-thumb-box (the <img> itself is a 1x1 GIF until it loads) — except a
 * peek mini, which has its own explicit CSS size and is measured directly:
 * offsetWidth, the layout box, not a client rect, which for a mini would
 * include its rotate() transform and over-sample by ~15 %. On success the
 * thumbnail gets its freeform box (the picture's aspect ratio, as a share of
 * the slot) and crossfades over the slot's type icon; on a null answer it is
 * hidden (.fp-thumb--failed) and the type icon stays — in Windows mode the
 * shell's own type icon, never the sprite. Callers that already have an
 * element in the DOM can call this directly with just (imgEl, path, size,
 * mtime) — size is then the declared box, used only before first layout. */
function fpRequestThumbnail(imgEl, path, size, mtime, seq, rect) {
  if (seq === undefined) { seq = ++_fpLazySeq; imgEl._fpSeq = seq; imgEl.dataset.fpLazy = 'pending'; }
  const isMini = imgEl.classList.contains('fp-thumb--mini');
  const css = isMini
    ? (imgEl.offsetWidth || size)
    : _fpCssBox(imgEl.parentElement || imgEl, null, size);
  const px = fpDevicePx(css);
  const key = _fpThumbKey(path, mtime, px);
  const hit = _fpThumbCache.get(key);
  if (hit !== undefined) { _fpApplyThumb(imgEl, seq, hit); return; }
  _fpFetchThumb(key, path, px, mtime)
    .then((res) => _fpApplyThumb(imgEl, seq, res));
}

/** One shell round trip per key, shared by every element waiting on it and
 * memoised in _fpThumbCache when it settles. Resolves to {url, w, h} or
 * null; never rejects. No content thumbnail (a .txt, an unreadable image, an
 * empty folder) is a definitive null: the slot's own type icon, already
 * under the thumbnail <img>, is the answer in both icon modes (Stage 2D
 * §4.4) — a bridge call that threw is not memoised. */
function _fpFetchThumb(key, path, px, mtime) {
  const pending = _fpThumbInFlight.get(key);
  if (pending) return pending;
  const api = window.electronAPI;
  let cacheable = true;
  const request = (!api || typeof api.thumbnail !== 'function')
    ? Promise.resolve(null)
    : Promise.resolve(api.thumbnail(path, px, mtime));
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
  if (!res) {
    imgEl.classList.add('fp-thumb--failed');
    imgEl.classList.remove('fp-thumb--ready');
    imgEl.style.width = imgEl.style.height = '';
    if (!isMini && imgEl.parentElement) _fpRestoreTypeIcon(imgEl.parentElement);
    return;
  }
  const wasReady = imgEl.classList.contains('fp-thumb--ready');
  const apply = () => {
    imgEl.classList.remove('fp-thumb--failed');
    imgEl.src = res.url;
    imgEl.classList.add('fp-thumb--ready');
    imgEl.dataset.px = String(Math.max(res.w, res.h));
    // A real thumbnail crossfades over the type icon and retires it — but a
    // folder preview's mini pictures are fanned OVER the folder icon, which
    // has to stay put, so only the tile's own full-size thumbnail retires
    // it, and only the full-size thumbnail gets the freeform box (a mini
    // keeps its CSS 40% size).
    if (!isMini) {
      // A sharper bucket of the SAME picture comes back with its sides
      // rounded at another px (a 3:2 photo is 96x64 at one bucket, 128x85 at
      // the next): keep the box the picture already has, so nothing changes
      // size after a size change has settled (Stage 2D §3.5).
      const oldW = parseFloat(imgEl.style.width), oldH = parseFloat(imgEl.style.height);
      const sameShape = wasReady && oldW > 0 && oldH > 0
        && Math.abs((res.w / res.h) / (oldW / oldH) - 1) < 0.03;
      if (!sameShape) {
        const box = _fpThumbBoxSize(res);
        imgEl.style.width = box.width;
        imgEl.style.height = box.height;
      }
      if (imgEl.parentElement) imgEl.parentElement.classList.add('fp-thumb-box--has-thumb');
    }
  };
  // A thumbnail already on screen (a size change re-requested it at another
  // bucket) is swapped only once the new one has decoded — no blank frame.
  if (imgEl.classList.contains('fp-thumb--ready') && _fpHasBitmap(imgEl) && imgEl.getAttribute('src') !== res.url) {
    _fpSwapAfterDecode(imgEl, res.url, () => imgEl.isConnected && imgEl._fpSeq === seq, apply);
    return;
  }
  apply();
}

/** A thumbnail slot whose thumbnail turned out not to exist (any more): its
 * type icon has to show. A slot painted from the thumbnail cache carries no
 * type icon at all, so one is added — never the sprite in Windows mode. */
function _fpRestoreTypeIcon(box) {
  box.classList.remove('fp-thumb-box--has-thumb');
  if (box.querySelector(':scope > .fp-thumb-box__type')) return;
  const img = box.querySelector(':scope > img.fp-thumb');
  if (!img) return;
  const entry = {
    path: img.dataset.thumb, ext: img.dataset.ext || '', is_dir: img.dataset.dir !== undefined,
    name: String(img.dataset.thumb || '').split(/[\\/]/).pop(),
  };
  const size = Number(img.dataset.size) || 96;
  const sym = entry.is_dir ? _folderSymbol(entry) : 'ft-' + fpFamilyFor(entry.ext);
  box.insertAdjacentHTML('afterbegin', fpIconSource() === 'windows'
    ? _winIcon(entry, size, sym, 'fp-thumb-box__type')
    : icon(sym, `fp-icon--${size >= 64 ? 48 : (size >= 32 ? 24 : 16)} fp-thumb-box__type`));
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
    // fpInvalidateLazyIcons on a DPR/zoom/icon-size change.
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
  // A microtask (Stage 2D §4.2 — it was a 16 ms timer): a miss is
  // registered, and its request can start, in the same turn as its render.
  // The MutationObserver callback is itself a microtask, so this still
  // coalesces a whole render's mutations into one pass, and it still runs
  // in an occluded window (no rAF).
  queueMicrotask(() => {
    _fpScanQueued = false;
    const targets = [..._fpScanTargets];
    _fpScanTargets.clear();
    for (const t of targets) if (t.isConnected) fpScanLazyIcons(t);
  });
}

/** Re-resolves every shell icon / thumbnail under `root` — settled AND still
 * pending — at its CURRENT box (Stage 2D §4.3). Debounced: it runs 120 ms
 * after the LAST size change (a Ctrl+wheel run is one re-resolve, not one
 * per step), and only rows in view (plus the observers' 200 px margin) ask
 * for anything — everything else is re-registered and resolves when it
 * scrolls in. Nothing is cleared: the old bitmap stays in its CSS-sized box
 * and the new bucket's swaps in after decode() (_fpSwapAfterDecode), so a
 * size change never blanks an icon or moves a box. Keys are per px bucket,
 * so a re-request inside the same bucket is answered from cache and leaves
 * the image untouched. Called on zoom / monitor-DPI change (below) and by
 * setView (browser.js) on an icon-size step. Prewarms the generic folder icon for the new
 * bucket too. */
let _fpInvalidateTimer = 0;
const _fpInvalidateRoots = new Set();
function fpInvalidateLazyIcons(root) {
  _fpInvalidateRoots.add(root || document.body);
  clearTimeout(_fpInvalidateTimer);
  _fpInvalidateTimer = setTimeout(_fpRunInvalidate, 120);
}

function _fpRunInvalidate() {
  const roots = [..._fpInvalidateRoots];
  _fpInvalidateRoots.clear();
  for (const root of roots) {
    if (!root.isConnected) continue;
    root.querySelectorAll(
      'img.fp-icon--win[data-fp-lazy="done"], img.fp-icon--win[data-fp-lazy="pending"], '
      + 'img.fp-thumb[data-fp-lazy="done"], img.fp-thumb[data-fp-lazy="pending"]'
    ).forEach((el) => {
      el.dataset.fpLazy = ''; el._fpSeq = 0;
      _fpUnobserve(el);
      _fpObserve(el);
    });
  }
  fpPrewarmIconSizes();
}

/** Resolves every shell icon under `root` NOW, without waiting for an
 * IntersectionObserver — for a surface the observer cannot be trusted with
 * (Properties' header and "Opens with" row live in a dialog that is laid out
 * after the markup goes in; an observer record taken before that reads "not
 * intersecting" and cancels the request). Marked as observed first so the
 * MutationObserver scan leaves them alone. */
function fpResolveIconsNow(root) {
  if (!root) return;
  root.querySelectorAll('img[data-win-icon]').forEach((el) => {
    if (el.dataset.fpLazy === 'done' || el.dataset.fpLazy === 'pending') return;
    el._fpObserved = true;
    el.dataset.fpLazy = 'pending';
    _fpStartLazy(el);
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
