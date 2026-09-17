// frontend/test/api-contracts.spec.js
// Pure-logic regressions for the pass-2 "api-contracts" findings that live in
// the renderer (#25, #26, #27, #179, #181, #183).
//
// frontend/src/*.js are plain globals with no build step and no module
// system, so they cannot be require()d like iconCache.js. Each source file is
// instead evaluated in a fresh `vm` context whose globals are the stubs it
// reads (API, showToast, browserState, ...) — the same thing index.html does,
// minus the DOM. Only the pure functions are exercised; anything that paints
// is left to the Electron smoke test.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');

/** Evaluate `files` (in order) in one context seeded with `globals`.
 * Unknown identifiers are left to throw, exactly as they would in the app.
 *
 * `exports` names top-level `const`/`let` bindings to copy onto the context
 * object: a script's top-level const lives in the global *lexical*
 * environment, not on globalThis, so `fileops` and `searchState` are
 * invisible to the test without this hop (plain `function` declarations do
 * land on globalThis and need no help). */
function load(files, globals = {}, exports = []) {
  const ctx = vm.createContext(Object.assign({ console, setTimeout, clearTimeout, Promise }, globals));
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  if (exports.length) {
    vm.runInContext(`Object.assign(globalThis, { ${exports.join(', ')} });`, ctx, { filename: 'exports' });
  }
  return ctx;
}

/** Records every showToast/showSnackbar call a loaded module makes. */
function recorder() {
  const calls = { toasts: [], snackbars: [], refreshed: 0 };
  return {
    calls,
    showToast: (msg, kind) => calls.toasts.push({ msg, kind }),
    showSnackbar: (msg, label, fn) => calls.snackbars.push({ msg, label, fn }),
    refreshDirectory: async () => { calls.refreshed += 1; },
    formatApiError: (e) => String((e && e.message) || e),
  };
}

// ---------------------------------------------------------------------------
// #27 -- "Skip" in the paste-conflict dialog must say something
// ---------------------------------------------------------------------------

test.describe('fileops.run() and the batch `skipped` bucket (#27)', () => {
  test('a batch resolved entirely by Skip reports it', async () => {
    const rec = recorder();
    const ctx = load(['fileops.js'], Object.assign({ browserState: {}, API: {}, getSelectedPaths: () => [] }, rec), ['fileops']);
    await ctx.fileops.run('Copied', async () => ({
      batch_id: 'b1', ops: [], conflicts: [], errors: [], skipped: [{ src: 'a' }, { src: 'b' }],
    }));
    expect(rec.calls.toasts).toEqual([{ msg: 'Copied: skipped 2 items', kind: 'default' }]);
    expect(rec.calls.snackbars).toHaveLength(0);
    expect(rec.calls.refreshed).toBe(1);
  });

  test('a partly-skipped batch folds the count into the undo snackbar', async () => {
    const rec = recorder();
    const ctx = load(['fileops.js'], Object.assign({ browserState: {}, API: {}, getSelectedPaths: () => [] }, rec), ['fileops']);
    await ctx.fileops.run('Copied', async () => ({
      batch_id: 'b1', ops: [{ op_id: 1 }], conflicts: [], errors: [], skipped: [{ src: 'a' }],
    }));
    expect(rec.calls.snackbars.map(s => s.msg)).toEqual(['Copied (1, 1 skipped)']);
    expect(rec.calls.toasts).toHaveLength(0);
  });

  test('a plain success is unchanged', async () => {
    const rec = recorder();
    const ctx = load(['fileops.js'], Object.assign({ browserState: {}, API: {}, getSelectedPaths: () => [] }, rec), ['fileops']);
    await ctx.fileops.run('Moved', async () => ({ batch_id: 'b1', ops: [{ op_id: 1 }, { op_id: 2 }], conflicts: [], errors: [], skipped: [] }));
    expect(rec.calls.snackbars.map(s => s.msg)).toEqual(['Moved (2)']);
  });
});

// ---------------------------------------------------------------------------
// #26 -- redo must not swallow undo_batch's `errors` (nor drop the entry)
// ---------------------------------------------------------------------------

test.describe('fileops.redoLast() and undo_batch errors (#26)', () => {
  function ctxFor(response, rec) {
    return load(['fileops.js'], Object.assign({
      browserState: {}, getSelectedPaths: () => [],
      API: { post: async () => response },
    }, rec), ['fileops']);
  }

  test('a redo that failed for every op toasts and keeps the entry', async () => {
    const rec = recorder();
    const ctx = ctxFor({ batch_id: null, ops: [], errors: [{ op_id: 7, error: 'RefusedError: gone' }] }, rec);
    ctx.fileops.redoStack = ['r1'];
    await ctx.fileops.redoLast();
    expect(rec.calls.toasts).toEqual([{ msg: 'Redo: RefusedError: gone', kind: 'error' }]);
    expect(ctx.fileops.redoStack).toEqual(['r1']);
  });

  test('a redo that worked drops the entry and pushes the inverse onto undo', async () => {
    const rec = recorder();
    const ctx = ctxFor({ batch_id: 'inv', ops: [{ op_id: 1 }], errors: [] }, rec);
    ctx.fileops.redoStack = ['r1'];
    await ctx.fileops.redoLast();
    expect(rec.calls.toasts).toHaveLength(0);
    expect(ctx.fileops.redoStack).toEqual([]);
    expect(ctx.fileops.undoStack).toEqual(['inv']);
  });

  test('a stale entry (nothing to redo, nothing wrong) is dropped silently', async () => {
    const rec = recorder();
    const ctx = ctxFor({ batch_id: null, ops: [], errors: [] }, rec);
    ctx.fileops.redoStack = ['r1'];
    await ctx.fileops.redoLast();
    expect(rec.calls.toasts).toHaveLength(0);
    expect(ctx.fileops.redoStack).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #181 -- fire-and-forget fileops calls must not leave an unhandled rejection
// ---------------------------------------------------------------------------

test.describe('unguarded fileops call sites (#181)', () => {
  test('every bare call site attaches a rejection handler', () => {
    const sources = {
      'app.js': read('app.js'),
      'browser.js': read('browser.js'),
      'dragdrop.js': read('dragdrop.js'),
    };
    // Methods that go through fileops.run(), which toasts and then rethrows.
    const rethrowing = ['pasteInto', 'trashSelection', 'newFolder', 'newFile', 'moveTo'];
    const offenders = [];
    for (const [file, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, i) => {
        for (const m of rethrowing) {
          const at = line.indexOf(`fileops.${m}(`);
          if (at === -1) continue;
          const rest = line.slice(at);
          if (!/\.catch\(/.test(rest) && !/^\s*(await|return)\b/.test(line)) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('the shared handler exists and swallows exactly one rejection', async () => {
    const rec = recorder();
    const ctx = load(['fileops.js'], Object.assign({ browserState: {}, API: {}, getSelectedPaths: () => [] }, rec), ['fileops']);
    expect(typeof ctx.fileopsReported).toBe('function');
    await expect(Promise.reject(new Error('boom')).catch(ctx.fileopsReported)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// #25 -- a truncated folder walk's byte total is a lower bound, not a size
// ---------------------------------------------------------------------------

test.describe('formatPropSize and a truncated folder walk (#25)', () => {
  const ctx = () => load(['properties.js'], { document: undefined, window: {} });

  test('an exact size is unchanged', () => {
    expect(ctx().formatPropSize(2048)).toBe('2.00 KB (2,048 bytes)');
    expect(ctx().formatPropSize(512)).toBe('512 bytes');
    expect(ctx().formatPropSize(null)).toBe('—');
  });

  test('a partial size is hedged the same way Contains is', () => {
    expect(ctx().formatPropSize(2048, true)).toBe('≥ 2.00 KB (2,048 bytes)');
    expect(ctx().formatPropSize(512, true)).toBe('≥ 512 bytes');
  });

  test('Contains keeps its own hedge', () => {
    const c = ctx();
    expect(c.formatPropContains({ files: 3, folders: 1, truncated: true })).toBe('≥ 3 files, 1 folder');
    expect(c.formatPropContains({ files: 3, folders: 1, truncated: false })).toBe('3 files, 1 folder');
  });
});

// ---------------------------------------------------------------------------
// #179 / #183 -- search params and the index route's truncation signal
// ---------------------------------------------------------------------------

test.describe('search.js query building and result folding (#179, #183)', () => {
  function searchCtx(browserState) {
    return load(['search.js'], {
      browserState,
      document: { getElementById: () => null, querySelectorAll: () => [] },
      localStorage: { getItem: () => null, setItem: () => {} },
      window: {},
      resizeSearchInput: () => {},
      escapeHtml: (s) => String(s),
    }, ['searchState', 'SEARCH_LIMIT']);
  }

  test('the global show-hidden setting reaches the search routes (#179)', () => {
    const ctx = searchCtx({ path: 'C:\\w', showHidden: true });
    expect(ctx.buildParams().hidden).toBe(true);
  });

  test('without the setting or the chip, hidden is left off (#179)', () => {
    const ctx = searchCtx({ path: 'C:\\w', showHidden: false });
    expect(ctx.buildParams().hidden).toBeUndefined();
  });

  test('the hidden: chip still works on its own (#179)', () => {
    const ctx = searchCtx({ path: 'C:\\w', showHidden: false });
    ctx.searchState.chips = [{ key: 'hidden', value: 'true', label: 'Hidden' }];
    expect(ctx.buildParams().hidden).toBe(true);
  });

  test("the backend's truncated flag wins over the row-count guess (#183)", () => {
    const ctx = searchCtx({ path: 'C:\\w', showHidden: false });
    const rows = [{ path: 'C:\\w\\a.txt', filename: 'a.txt', extension: '.txt' }];
    expect(ctx.normalizeIndexResults({ results: rows, truncated: true }, 'a').truncated).toBe(true);
    expect(ctx.normalizeIndexResults({ results: rows, truncated: false }, 'a').truncated).toBe(false);
  });

  test('a response without the field falls back to the old guess (#183)', () => {
    const ctx = searchCtx({ path: 'C:\\w', showHidden: false });
    const rows = [{ path: 'C:\\w\\a.txt', filename: 'a.txt', extension: '.txt' }];
    expect(ctx.normalizeIndexResults({ results: rows }, 'a').truncated).toBe(false);
  });
});
