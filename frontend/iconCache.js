/**
 * Pure helpers for the file-icon / shell-thumbnail bridge (Stage 2C Task 4;
 * extended Stage 2C pass 2 for the Windows-icon sharpness fix — see
 * docs/superpowers/specs/2026-09-14-stage-2c-pass-2-icon-design.md §2-4.1).
 *
 * No `electron` import here (unlike main.js) so this stays requirable from
 * plain node, including from a Playwright test — mirrors envToken.js.
 *
 * Dual-mode: a CommonJS export for the main process and node-run tests, and
 * `window.FpIconCache` for the renderer — index.html loads this file right
 * before src/icons.js, so the renderer's request key and the main process's
 * cache key are the same code, not two hand-kept twins.
 */

/** Bounded-count, bounded-byte LRU: `get` refreshes recency, `set` evicts the
 *  least-recently-used entries once `maxEntries` or `maxBytes` is exceeded.
 *  Backed by a Map, whose iteration order is insertion order — the first key
 *  is always the least-recently-used one.
 *
 *  `maxBytes` defaults to Infinity (the original Stage 2C Task 4 shape —
 *  count-only). Byte accounting is a soft budget: a data: URL is a one-
 *  byte-per-char V8 string, so `.length` is close enough to the real byte
 *  cost without walking the string. */
class LruCache {
  constructor(maxEntries, maxBytes = Infinity) {
    this.max = maxEntries;
    this.maxBytes = maxBytes;
    this._map = new Map();
    this._bytes = 0;
  }

  static _sizeOf(value) {
    if (value == null) return 0;
    // An explicit charge wins: icons.js stores a plain folder's entry by
    // reference to the shared generic string and charges it 0.
    if (typeof value.bytes === 'number') return value.bytes;
    if (typeof value === 'string') return value.length;
    if (typeof value.url === 'string') return value.url.length;
    return 0;
  }

  get bytes() {
    return this._bytes;
  }

  get(key) {
    if (!this._map.has(key)) return undefined;
    const value = this._map.get(key);
    // Refresh recency: delete + re-insert moves this key to the end.
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this._map.has(key)) {
      this._bytes -= LruCache._sizeOf(this._map.get(key));
      this._map.delete(key);
    }
    this._map.set(key, value);
    this._bytes += LruCache._sizeOf(value);
    while ((this._map.size > this.max || this._bytes > this.maxBytes) && this._map.size > 0) {
      const oldestKey = this._map.keys().next().value;
      this._bytes -= LruCache._sizeOf(this._map.get(oldestKey));
      this._map.delete(oldestKey);
    }
  }

  delete(key) {
    if (!this._map.has(key)) return false;
    this._bytes -= LruCache._sizeOf(this._map.get(key));
    this._map.delete(key);
    return true;
  }

  /** Deletes every entry for which `predicate(value, key)` is true; returns
   *  the number removed. Used by icons.js to drop cached "no icon" answers
   *  (null values) when the shell-icon route state changes. */
  deleteWhere(predicate) {
    let removed = 0;
    for (const [key, value] of [...this._map]) {
      if (predicate(value, key)) { this.delete(key); removed++; }
    }
    return removed;
  }

  get size() {
    return this._map.size;
  }

  /** Snapshot of [key, value] pairs, least- to most-recently used. Reading
   *  it does not refresh recency. */
  entries() {
    return [...this._map];
  }

  /** Replaces the value of an existing key in place — same recency, bytes
   *  re-charged. Returns false (and does nothing) for a missing key. */
  replace(key, value) {
    if (!this._map.has(key)) return false;
    this._bytes += LruCache._sizeOf(value) - LruCache._sizeOf(this._map.get(key));
    this._map.set(key, value);
    return true;
  }
}

/** Windows path normal form used for both cache keys and every shell call:
 *  forward slashes folded to back, runs of separators collapsed to one. Call
 *  this only AFTER isSafeLocalPath(raw) (which still accepts '/') — both
 *  SHCreateItemFromParsingName and nativeImage.createThumbnailFromPath
 *  reject a mixed-separator path like 'C:/a\b'. Keys lower-case the result
 *  themselves; the path hand to a shell call keeps its original case. */
function normalizeWinPath(p) {
  return String(p).replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
}

/** Clamp a requested bitmap size to a sane range; anything that doesn't
 *  parse to a finite number falls back to the list-row default (16). */
function clampPx(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(512, Math.max(8, n)) : 16;
}

// Stage 2D §4.3: the physical px every shell icon / thumbnail request goes out
// at. Snapping caps the number of distinct keys while the view size moves
// (48..256 logical) and keeps keys stable at a fractional devicePixelRatio;
// the <img> is CSS-sized to its logical box and the browser downsamples.
// At <= 32 logical px the snap is at most one step up, so the shell still
// picks its small, simplified resource (16/20/24/32) — §4.5.
const ICON_BUCKETS = [16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256];

/** Smallest bucket >= physPx, capped at 256; a value that does not parse
 *  falls back to 16 (the list-row size, like clampPx). */
function fpIconBucket(physPx) {
  const n = Number(physPx);
  if (!Number.isFinite(n)) return 16;
  for (const b of ICON_BUCKETS) if (n <= b) return b;
  return ICON_BUCKETS[ICON_BUCKETS.length - 1];
}

// Extensions whose Tier-B (Chromium app.getFileIcon) icon is content-specific
// rather than one glyph shared by every file of that extension — measured
// (scratchpad probe/out2b.json): .exe/.dll differ per path, but a .lnk or
// .url gets ONE identical blank page regardless of target (Chromium's own
// IconLoader groups those by extension too, unlike the real shell) — so they
// are deliberately NOT in this set; a per-path key for them would only
// multiply cache entries of the same shared blank glyph.
const PER_PATH_EXTS = new Set(['exe', 'dll', 'ico']);

// The shell (Tier A, and the renderer's own request identity) DOES resolve a
// shortcut/link icon per target, so shellIconKey uses this wider set.
const PER_PATH_SHELL_EXTS = new Set(['exe', 'dll', 'ico', 'lnk', 'url', 'cpl', 'scr']);

function normalizeExt(ext) {
  if (typeof ext !== 'string') return '';
  let e = ext.trim().toLowerCase();
  if (e.startsWith('.')) e = e.slice(1);
  return e;
}

/** Cache key for the Tier-B request (main-process / electronAPI.fileIcon(s))
 *  — mirrors what Chromium's IconLoader actually groups per path: per-path
 *  for PER_PATH_EXTS, per-extension (shared) otherwise, always keyed by the
 *  physical pixel size (px, not a coarse 'small'/'normal'/'large' enum).
 *
 *  The empty extension is shared (`ext::px`): app.getFileIcon answers the
 *  identical system-drive glyph for EVERY extension-less path, whether it is
 *  a directory or a plain file (probe/out2b.json) — so a per-path key here
 *  could never have made the Tier-B fallback correct, and in practice a
 *  directory never reaches this key at all: icons.js keeps every directory
 *  out of Tier B entirely (see shellIconKey and _fpTierB below). */
function iconCacheKey(path, ext, px) {
  const e = normalizeExt(ext);
  const p = normalizeWinPath(path).toLowerCase();
  if (PER_PATH_EXTS.has(e)) return `path:${p}:${px}`;
  return `ext:${e}:${px}`;
}

/** Cache key for the renderer's own request identity and for Tier A
 *  (POST /shell/icons — the real shell, which DOES resolve folders,
 *  known-folder glyphs, and shortcut/link targets per path). A directory is
 *  always per-path (desktop.ini custom icons, known-folder glyphs);
 *  PER_PATH_SHELL_EXTS is wider than PER_PATH_EXTS because the shell
 *  resolves a .lnk/.url per target even though Chromium's own icon loader
 *  does not — a per-extension key here would paint one shortcut's target
 *  icon onto every shortcut in the listing once Tier A answers. */
function shellIconKey(path, ext, isDir, px) {
  const p = normalizeWinPath(path).toLowerCase();
  if (isDir) return `dir:${p}:${px}`;
  const e = normalizeExt(ext);
  if (PER_PATH_SHELL_EXTS.has(e)) return `path:${p}:${px}`;
  return `ext:${e}:${px}`;
}

const MAX_PATH_LENGTH = 32767;

/** True iff `p` is an absolute Windows drive-letter path with no `..`
 *  component, no `\\?\` extended prefix, no UNC (`\\server\share`) form, and
 *  no control characters. Gates every path the main process passes to
 *  `app.getFileIcon`, `nativeImage.createThumbnailFromPath`, or a spawned
 *  shell verb. */
function isSafeLocalPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length >= MAX_PATH_LENGTH) return false;
  // Reject C0 control characters and DEL -- a NUL, newline, or tab embedded
  // in a path has no legitimate reason to reach a spawned shell verb.
  if (/[\x00-\x1f\x7f]/.test(p)) return false;
  // Extended-length (`\\?\...`) and UNC (`\\server\share`) paths both start
  // with a double separator — reject before the drive-letter check so the
  // reason is explicit rather than incidental.
  if (/^[\\/]{2}/.test(p)) return false;
  if (!/^[A-Za-z]:[\\/]/.test(p)) return false;
  const parts = p.split(/[\\/]+/);
  if (parts.some((part) => part === '..')) return false;
  return true;
}

const _exports = { LruCache, iconCacheKey, shellIconKey, isSafeLocalPath, normalizeWinPath, clampPx, fpIconBucket, ICON_BUCKETS, PER_PATH_EXTS, PER_PATH_SHELL_EXTS };
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
else if (typeof window !== 'undefined') window.FpIconCache = _exports;
