/**
 * Pure helpers for the file-icon / shell-thumbnail bridge (Stage 2C Task 4).
 *
 * No `electron` import here (unlike main.js) so this stays requirable from
 * plain node, including from a Playwright test — mirrors envToken.js.
 */

/** Minimal LRU cache: `get` refreshes recency, `set` evicts the oldest entry
 *  once `max` is exceeded. Backed by a Map, whose iteration order is
 *  insertion order — the first key is always the least-recently-used one. */
class LruCache {
  constructor(max) {
    this.max = max;
    this._map = new Map();
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
      this._map.delete(key);
    } else if (this._map.size >= this.max) {
      // Evict the least-recently-used entry (first in iteration order).
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
    this._map.set(key, value);
  }

  delete(key) {
    return this._map.delete(key);
  }

  get size() {
    return this._map.size;
  }
}

// Extensions whose icon is content-specific (a shortcut's target, an exe's
// embedded icon, ...) rather than a generic per-extension glyph — these must
// be cached per-path. Everything else shares one cached icon per extension.
const PER_PATH_EXTS = new Set(['exe', 'lnk', 'url', 'ico', 'cpl', 'scr']);

function normalizeExt(ext) {
  if (typeof ext !== 'string') return '';
  let e = ext.trim().toLowerCase();
  if (e.startsWith('.')) e = e.slice(1);
  return e;
}

/** Cache key for `fileIcon(path, ext, size)` — per-path for extensions whose
 *  icon varies file-to-file, per-extension (shared) otherwise.
 *
 *  The empty extension is per-path too (Stage 2C Task 6): it covers BOTH
 *  directories and extension-less files, which the shell gives entirely
 *  different icons, so one shared key would paint a folder over a Makefile
 *  (or the reverse) in the same listing. */
function iconCacheKey(path, ext, size) {
  const e = normalizeExt(ext);
  if (e === '' || PER_PATH_EXTS.has(e)) {
    return `path:${path}:${size}`;
  }
  return `ext:${e}:${size}`;
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

module.exports = { LruCache, iconCacheKey, isSafeLocalPath };
