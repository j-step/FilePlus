// frontend/test/icon-cache.spec.js
// Pure-logic test for iconCache.js -- no Electron/browser needed (mirrors
// env-token.spec.js). Covers the byte-budgeted LRU cache, the Tier-B and
// shell (Tier A / renderer request) cache-key shapes, clampPx/normalizeWinPath,
// and the path-safety gate the main process relies on before ever touching
// the filesystem or spawning a shell verb.
const { test, expect } = require('@playwright/test');
const { LruCache, iconCacheKey, shellIconKey, isSafeLocalPath, normalizeWinPath, clampPx, PER_PATH_EXTS, PER_PATH_SHELL_EXTS } = require('../iconCache');

test.describe('LruCache', () => {
  test('get/set round-trip', () => {
    const cache = new LruCache(2);
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(1);
  });

  test('get on a missing key returns undefined', () => {
    const cache = new LruCache(2);
    expect(cache.get('missing')).toBeUndefined();
  });

  test('evicts the oldest entry once capacity is exceeded', () => {
    const cache = new LruCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // 'a' is oldest -> evicted
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  test('get refreshes recency so a recently-read key survives eviction', () => {
    const cache = new LruCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' is now most-recently-used; 'b' becomes the oldest
    cache.set('c', 3); // evicts 'b', not 'a'
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  test('re-setting an existing key updates its value and its recency', () => {
    const cache = new LruCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // 'a' refreshed -> 'b' is now the oldest
    cache.set('c', 3); // evicts 'b'
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  test('delete removes a key and frees capacity', () => {
    const cache = new LruCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(1);
  });

  test('delete on a missing key returns false and does not touch bytes', () => {
    const cache = new LruCache(2, 100);
    expect(cache.delete('missing')).toBe(false);
    expect(cache.bytes).toBe(0);
  });

  test('byte budget evicts the oldest entry once maxBytes is exceeded', () => {
    const cache = new LruCache(10, 10);
    cache.set('a', 'xxxxxx'); // 6 bytes
    expect(cache.bytes).toBe(6);
    cache.set('b', 'xxxxxx'); // 6 + 6 = 12 > 10 -> 'a' evicted
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('xxxxxx');
    expect(cache.bytes).toBe(6);
  });

  test('byte budget charges an object value by its .url length', () => {
    const cache = new LruCache(10, 100);
    cache.set('a', { url: 'xxxx', px: 16 });
    expect(cache.bytes).toBe(4);
  });

  test('byte budget credits on delete', () => {
    const cache = new LruCache(10, 100);
    cache.set('a', 'xxxx');
    cache.delete('a');
    expect(cache.bytes).toBe(0);
  });

  test('a null value charges zero bytes', () => {
    const cache = new LruCache(10, 100);
    cache.set('a', null);
    expect(cache.bytes).toBe(0);
    expect(cache.get('a')).toBeNull();
  });

  test('deleteWhere removes every matching entry and credits their bytes', () => {
    const cache = new LruCache(10, 100);
    cache.set('a', { url: 'xxxx' });
    cache.set('b', null);
    cache.set('c', null);
    cache.set('d', 'yy');
    expect(cache.deleteWhere((v) => v === null)).toBe(2);
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ url: 'xxxx' });
    expect(cache.bytes).toBe(6);
    expect(cache.deleteWhere(() => false)).toBe(0);
  });

  test('default maxBytes is unbounded (count-only, Stage 2C Task 4 shape)', () => {
    const cache = new LruCache(2);
    cache.set('a', 'x'.repeat(10_000));
    cache.set('b', 'x'.repeat(10_000));
    expect(cache.size).toBe(2);
  });
});

test.describe('clampPx', () => {
  test('passes an in-range integer through unchanged', () => { expect(clampPx(24)).toBe(24); });
  test('rounds a fractional value', () => { expect(clampPx(24.6)).toBe(25); });
  test('a non-numeric string falls back to 16', () => { expect(clampPx('abc')).toBe(16); });
  test('undefined falls back to 16', () => { expect(clampPx(undefined)).toBe(16); });
  test('clamps below the minimum to 8', () => { expect(clampPx(2)).toBe(8); });
  test('clamps above the maximum to 512', () => { expect(clampPx(10000)).toBe(512); });
});

test.describe('normalizeWinPath', () => {
  test('folds forward slashes to back', () => {
    expect(normalizeWinPath('C:/a/b')).toBe('C:\\a\\b');
  });
  test('collapses repeated separators', () => {
    expect(normalizeWinPath('C:\\a\\\\b')).toBe('C:\\a\\b');
  });
});

test.describe('iconCacheKey (Tier B / main-process)', () => {
  test('is per-path for .exe', () => {
    const k1 = iconCacheKey('C:\\Windows\\a.exe', 'exe', 32);
    const k2 = iconCacheKey('C:\\Windows\\b.exe', 'exe', 32);
    expect(k1).not.toBe(k2);
  });

  test('is per-path for .dll', () => {
    const k1 = iconCacheKey('C:\\Windows\\a.dll', 'dll', 32);
    const k2 = iconCacheKey('C:\\Windows\\b.dll', 'dll', 32);
    expect(k1).not.toBe(k2);
  });

  test('is per-path for .ico', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.ico', 'ico', 32);
    const k2 = iconCacheKey('C:\\Users\\x\\b.ico', 'ico', 32);
    expect(k1).not.toBe(k2);
  });

  test('is per-extension (shared across paths) for .lnk -- Chromium answers one blank page for every target', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.lnk', 'lnk', 48);
    const k2 = iconCacheKey('C:\\Users\\x\\b.lnk', 'lnk', 48);
    expect(k1).toBe(k2);
  });

  test('is per-extension (shared across paths) for .txt', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 32);
    const k2 = iconCacheKey('C:\\Users\\x\\b.txt', 'txt', 32);
    expect(k1).toBe(k2);
  });

  test('per-extension keys differ by px', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 16);
    const k2 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 32);
    expect(k1).not.toBe(k2);
  });

  test('the empty extension is shared, not per-path', () => {
    const folder = iconCacheKey('C:\\Users\\x\\Projects', '', 16);
    const file = iconCacheKey('C:\\Users\\x\\Makefile', '', 16);
    expect(folder).toBe(file);
  });

  test('extension matching is case-insensitive and dot-tolerant', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 32);
    const k2 = iconCacheKey('C:\\Users\\x\\a.txt', '.TXT', 32);
    expect(k1).toBe(k2);
  });

  test('the path part is case-insensitive', () => {
    const k1 = iconCacheKey('C:\\Windows\\A.exe', 'exe', 32);
    const k2 = iconCacheKey('C:\\WINDOWS\\a.exe', 'exe', 32);
    expect(k1).toBe(k2);
  });
});

test.describe('shellIconKey (Tier A / renderer request identity)', () => {
  test('a directory and a file at the same path differ', () => {
    const dir = shellIconKey('C:\\Users\\x\\Projects', '', true, 16);
    const file = shellIconKey('C:\\Users\\x\\Projects', '', false, 16);
    expect(dir).not.toBe(file);
  });

  test('two different directories differ (per-path, unlike iconCacheKey)', () => {
    const k1 = shellIconKey('C:\\Users\\x\\Projects', '', true, 16);
    const k2 = shellIconKey('C:\\Users\\x\\Documents', '', true, 16);
    expect(k1).not.toBe(k2);
  });

  test('.lnk is per-path (wider than PER_PATH_EXTS -- the shell resolves the target)', () => {
    const k1 = shellIconKey('C:\\Users\\x\\a.lnk', 'lnk', false, 32);
    const k2 = shellIconKey('C:\\Users\\x\\b.lnk', 'lnk', false, 32);
    expect(k1).not.toBe(k2);
  });

  test('.url is per-path', () => {
    const k1 = shellIconKey('C:\\Users\\x\\a.url', 'url', false, 32);
    const k2 = shellIconKey('C:\\Users\\x\\b.url', 'url', false, 32);
    expect(k1).not.toBe(k2);
  });

  test('.txt is shared across paths', () => {
    const k1 = shellIconKey('C:\\Users\\x\\a.txt', 'txt', false, 16);
    const k2 = shellIconKey('C:\\Users\\x\\b.txt', 'txt', false, 16);
    expect(k1).toBe(k2);
  });

  test('px is part of the key', () => {
    const k1 = shellIconKey('C:\\Users\\x\\a.txt', 'txt', false, 16);
    const k2 = shellIconKey('C:\\Users\\x\\a.txt', 'txt', false, 24);
    expect(k1).not.toBe(k2);
  });
});

test.describe('PER_PATH_EXTS / PER_PATH_SHELL_EXTS', () => {
  test('PER_PATH_SHELL_EXTS is a strict superset of PER_PATH_EXTS', () => {
    for (const e of PER_PATH_EXTS) expect(PER_PATH_SHELL_EXTS.has(e)).toBe(true);
    expect(PER_PATH_SHELL_EXTS.size).toBeGreaterThan(PER_PATH_EXTS.size);
  });
});

test.describe('module export shape', () => {
  test('exposes all eight names', () => {
    const mod = require('../iconCache');
    for (const name of ['LruCache', 'iconCacheKey', 'shellIconKey', 'isSafeLocalPath', 'normalizeWinPath', 'clampPx', 'PER_PATH_EXTS', 'PER_PATH_SHELL_EXTS']) {
      expect(mod[name]).toBeDefined();
    }
  });
});

test.describe('isSafeLocalPath', () => {
  test('accepts a plain absolute drive path', () => {
    expect(isSafeLocalPath('C:\\Users\\x\\a.txt')).toBe(true);
  });

  test('rejects a UNC path', () => {
    expect(isSafeLocalPath('\\\\server\\share\\a')).toBe(false);
  });

  test('rejects a .. component (backslash form)', () => {
    expect(isSafeLocalPath('C:\\a\\..\\b')).toBe(false);
  });

  test('rejects a .. component (forward-slash form)', () => {
    expect(isSafeLocalPath('C:/a/../b')).toBe(false);
  });

  test('rejects a trailing .. component', () => {
    expect(isSafeLocalPath('C:/a/..')).toBe(false);
  });

  test('rejects an embedded NUL', () => {
    expect(isSafeLocalPath('C:\\a\\b' + String.fromCharCode(0) + '.txt')).toBe(false);
  });

  test('rejects an embedded newline', () => {
    expect(isSafeLocalPath('C:\\a\\b\n.txt')).toBe(false);
  });

  test('rejects an embedded tab', () => {
    expect(isSafeLocalPath('C:\\a\\b\t.txt')).toBe(false);
  });

  test('rejects the \\\\?\\ extended-length prefix', () => {
    expect(isSafeLocalPath('\\\\?\\C:\\a')).toBe(false);
  });

  test('rejects a relative path', () => {
    expect(isSafeLocalPath('relative\\a')).toBe(false);
  });

  test('rejects a path at/over MAX_PATH_LENGTH', () => {
    expect(isSafeLocalPath('C:\\' + 'a'.repeat(40000))).toBe(false);
  });

  test('rejects null', () => {
    expect(isSafeLocalPath(null)).toBe(false);
  });

  test('rejects undefined', () => {
    expect(isSafeLocalPath(undefined)).toBe(false);
  });
});
