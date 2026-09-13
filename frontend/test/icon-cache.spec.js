// frontend/test/icon-cache.spec.js
// Pure-logic test for iconCache.js -- no Electron/browser needed (mirrors
// env-token.spec.js). Covers the LRU cache, the icon cache key shape, and
// the path-safety gate the main process relies on before ever touching the
// filesystem or spawning a shell verb.
const { test, expect } = require('@playwright/test');
const { LruCache, iconCacheKey, isSafeLocalPath } = require('../iconCache');

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
});

test.describe('iconCacheKey', () => {
  test('is per-path for .exe', () => {
    const k1 = iconCacheKey('C:\\Windows\\a.exe', 'exe', 32);
    const k2 = iconCacheKey('C:\\Windows\\b.exe', 'exe', 32);
    expect(k1).not.toBe(k2);
  });

  test('is per-path for .lnk', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.lnk', 'lnk', 48);
    const k2 = iconCacheKey('C:\\Users\\x\\b.lnk', 'lnk', 48);
    expect(k1).not.toBe(k2);
  });

  test('is per-extension (shared across paths) for .txt', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 32);
    const k2 = iconCacheKey('C:\\Users\\x\\b.txt', 'txt', 32);
    expect(k1).toBe(k2);
  });

  test('per-extension keys differ by size', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 16);
    const k2 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 32);
    expect(k1).not.toBe(k2);
  });

  test('extension matching is case-insensitive and dot-tolerant', () => {
    const k1 = iconCacheKey('C:\\Users\\x\\a.txt', 'txt', 32);
    const k2 = iconCacheKey('C:\\Users\\x\\a.txt', '.TXT', 32);
    expect(k1).toBe(k2);
  });
});

test.describe('isSafeLocalPath', () => {
  test('accepts an absolute Windows drive path', () => {
    expect(isSafeLocalPath('C:\\Users\\x\\a.txt')).toBe(true);
  });

  test('rejects a UNC path', () => {
    expect(isSafeLocalPath('\\\\server\\share\\a')).toBe(false);
  });

  test('rejects a path with a ".." component', () => {
    expect(isSafeLocalPath('C:\\a\\..\\b')).toBe(false);
  });

  test('rejects the \\\\?\\ extended-length prefix', () => {
    expect(isSafeLocalPath('\\\\?\\C:\\a')).toBe(false);
  });

  test('rejects a relative path', () => {
    expect(isSafeLocalPath('relative\\a')).toBe(false);
  });

  test('rejects an over-long string', () => {
    expect(isSafeLocalPath('C:\\' + 'a'.repeat(40000))).toBe(false);
  });

  test('rejects a non-string', () => {
    expect(isSafeLocalPath(null)).toBe(false);
    expect(isSafeLocalPath(undefined)).toBe(false);
  });
});
