// frontend/test/stage2d-sweep.spec.js
// Stage 2D Task 12b (spec §12): the sibling-oversight sweep. Each test pins a
// bug class the playtest exposed, at every place the sweep found it. Waits are
// on conditions (the app's own settle signals or expect.poll), never sleeps.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, shot, rowByName, apiGet, apiHeaders, API } = require('./harness/app');

test.setTimeout(120_000);

// A folder of its own, rebuilt per test, so renames and deletes here never
// touch a fixture another spec reads.
function sweepDir(root) {
  const dir = path.join(root, 'Sweep-2d');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  for (const n of ['sweep-a.txt', 'sweep-b.txt', 'sweep-c.txt']) fs.writeFileSync(path.join(dir, n), `${n}\n`);
  return dir;
}

async function openDir(page, dir, minRows = 1) {
  await page.evaluate((p) => openBrowserAt(p), dir);
  await page.waitForFunction(([d, n]) => fpNormalizePath(browserState.path) === fpNormalizePath(d)
    && !window.__fpLoadPending && document.querySelectorAll('#list-scroll .fp-row').length >= n, [dir, minRows]);
}

const inspectorSettled = (page) => page.waitForFunction(() => window.__fpInspectorPending === 0 && !window.__fpLoadPending);

test('inspector: never names an item that is not selected (navigation, click, trash, rename)', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const dir = sweepDir(root);
  try {
    const picsDir = `${root}\\_gen\\Pictures`;
    const name = page.locator('#inspector-filename');
    await openDir(page, dir, 3);
    await rowByName(page, 'sweep-a.txt').click();
    await expect(name).toHaveText('sweep-a.txt');
    await inspectorSettled(page);

    // 1. Navigating away empties the selection: the panel says so in the
    //    same task the new folder commits, not a debounce later (the smoke's
    //    browser-grid.png showed doc-00.txt over Pictures, "Nothing selected").
    const afterNav = await page.evaluate(async (p) => {
      await openBrowserAt(p);
      return { sel: browserState.selection.size, name: document.getElementById('inspector-filename').textContent };
    }, picsDir);
    expect(afterNav).toEqual({ sel: 0, name: 'No file selected' });
    // …and the tag field says why it is off in those terms.
    expect(await page.locator('#inspector-tag-input').getAttribute('placeholder')).toBe('Select a file to tag it');
    await openDir(page, dir, 3);
    await inspectorSettled(page);

    // 2. A discrete click shows the clicked item at once (leading edge); only
    //    a burst of changes waits for the selection to settle.
    const clicked = await page.evaluate((d) => {
      selectRow(`${d}\\sweep-b.txt`);
      return document.getElementById('inspector-filename').textContent;
    }, dir);
    expect(clicked).toBe('sweep-b.txt');
    await inspectorSettled(page);
    // A burst (arrow-key repeat) ends on the last item, and a refresh of the
    // same selection while the burst's timer is armed never pushes it back.
    const shownDuringRefreshes = await page.evaluate(async (d) => {
      selectRow(`${d}\\sweep-a.txt`);
      selectRow(`${d}\\sweep-c.txt`);
      const el = document.getElementById('inspector-filename');
      const start = performance.now();
      // Refresh patches re-announce the same selection every 30 ms; under a
      // plain trailing debounce each one reset the timer and the panel never
      // caught up (starved).
      while (el.textContent !== 'sweep-c.txt' && performance.now() - start < 1500) {
        onSelectionChanged();
        await new Promise((r) => setTimeout(r, 30));
      }
      return el.textContent;
    }, dir);
    expect(shownDuringRefreshes).toBe('sweep-c.txt');
    await inspectorSettled(page);
    await expect(name).toHaveText('sweep-c.txt');
    await expect(page.locator('#inspector-kind')).not.toHaveText('—');

    // 3. Deleting the inspected item empties the panel as soon as the delete
    //    lands — not after the refresh, not after a debounce.
    const afterTrash = await page.evaluate(async () => {
      await fileops.trashSelection();
      return document.getElementById('inspector-filename').textContent;
    });
    expect(afterTrash).toBe('No file selected');
    await inspectorSettled(page);

    // 4. A rename while the refresh is slow: the selection follows the item to
    //    its new name the moment the rename answers, so nothing asks the
    //    backend about the old (gone) path — that 404 was a console error
    //    the smoke could trip on — and the panel names the renamed item.
    await rowByName(page, 'sweep-a.txt').click();
    await expect(name).toHaveText('sweep-a.txt');
    await inspectorSettled(page);
    await page.evaluate(() => {
      window.__sweepOrigRefresh = refreshDirectory;
      window.__sweepGate = new Promise((r) => { window.__sweepRelease = r; });
      // eslint-disable-next-line no-global-assign
      refreshDirectory = async (...a) => { await window.__sweepGate; return window.__sweepOrigRefresh(...a); };
      window.__sweepRename = fileops.rename(`${browserState.path}\\sweep-a.txt`, 'sweep-renamed.txt');
    });
    await expect.poll(() => fs.existsSync(path.join(dir, 'sweep-renamed.txt'))).toBe(true);
    // The rename has answered; the listing still shows the old row. A click
    // anywhere in the list (any selection event) must not fetch the gone path.
    await page.waitForFunction(() => browserState.selection.has(`${browserState.path}\\sweep-renamed.txt`));
    await page.evaluate(() => onSelectionChanged());
    await inspectorSettled(page);
    await expect(name).toHaveText('sweep-renamed.txt');
    await page.evaluate(async () => {
      window.__sweepRelease();
      await window.__sweepRename;
      // eslint-disable-next-line no-global-assign
      refreshDirectory = window.__sweepOrigRefresh;
    });
    await inspectorSettled(page);
    await expect(rowByName(page, 'sweep-renamed.txt')).toHaveClass(/fp-row--selected/);
    await expect(name).toHaveText('sweep-renamed.txt');

    // 5. Undo follows it back, and the restored row stays selected.
    await page.evaluate(() => fileops.undoLast());
    await expect(rowByName(page, 'sweep-a.txt')).toHaveClass(/fp-row--selected/);
    await inspectorSettled(page);
    await expect(name).toHaveText('sweep-a.txt');
    await shot(page, 'sweep-inspector-follows-rename');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

// ── shared window helpers ───────────────────────────────────────────────────
const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
  step(k);
}), n);

async function setSize(app, page, w, h) {
  const same = await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [cw, ch] = win.getSize();
    return !win.isMaximized() && cw === s.w && ch === s.h;
  }, { w, h });
  if (same) return;
  await page.evaluate(() => {
    window.__sweepResized = new Promise((r) => window.addEventListener('resize', () => r(), { once: true }));
  });
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setSize(s.w, s.h);
  }, { w, h });
  await page.evaluate(() => window.__sweepResized);
  await frames(page);
}

async function setZoom(app, page, z) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
  await page.waitForFunction((f) => Math.abs(window.electronAPI.getZoom() - f) < 0.001
    && typeof appZoom !== 'undefined' && Math.abs(appZoom.current - f) < 0.001 && !window.__fpZoomBusy, z);
  await frames(page);
}

// Mica is a live desktop material that captures as transparent pixels under
// the harness; flatten it for the capture (as stage2d-views.spec.js does).
async function windowShot(app, page, name) {
  const mica = await page.evaluate(async () => {
    const was = document.documentElement.dataset.mica || null;
    delete document.documentElement.dataset.mica;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return was;
  });
  try {
    const b64 = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    const { SHOTS } = require('./harness/app');
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'));
  } finally {
    await page.evaluate((m) => { if (m) document.documentElement.dataset.mica = m; }, mica);
  }
}

async function apiSend(method, route, body) {
  const r = await fetch(`${API}${route}`, {
    method, headers: apiHeaders({ 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}`);
  return r.json().catch(() => null);
}

test('Home: the name keeps priority at narrow widths, the status bar counts Home, a gone item is marked', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const dir = sweepDir(root);
  try {
    const kept = path.join(dir, 'sweep-a.txt');
    const gone = path.join(dir, 'sweep-gone-recent.txt');
    fs.writeFileSync(gone, 'gone\n');
    await apiSend('DELETE', '/recent');
    await apiSend('POST', '/recent', { path: gone, action: 'opened' });
    await apiSend('POST', '/recent', { path: kept, action: 'opened' });
    fs.rmSync(gone);
    await page.evaluate(() => { setInspectorOpen(true, { persist: false }); switchScreen('home'); });
    const rows = page.locator('#home-recent .fp-row[data-path]');
    await expect(rows).toHaveCount(2);
    // The status bar describes Home, not the hidden Browser listing.
    await expect(page.locator('#status-count')).toHaveText('2 items');
    await expect(page.locator('#status-selected')).toHaveText('Nothing selected');

    for (const [w, z] of [[1100, 1], [800, 1], [800, 1.5], [1400, 1.5]]) {
      await setSize(app, page, w, 760);
      await setZoom(app, page, z);
      if (w === 1100 && z === 1) await windowShot(app, page, 'sweep-home-recent-1100');
      if (w === 800 && z === 1.5) await windowShot(app, page, 'sweep-home-recent-800-z150');
      const widths = await rows.evaluateAll((els) => els.map((r) => {
        const box = (sel) => r.querySelector(sel).getBoundingClientRect().width;
        const cs = getComputedStyle(r);
        const content = r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { name: box('.fp-row__name'), path: box('.fp-row__recent-path'), time: box('.fp-row__recent-time'),
          content, text: r.querySelector('.fp-row__name').textContent.trim() };
      }));
      for (const r of widths) {
        const label = `${w}px @${z}: ${JSON.stringify(r)}`;
        // The name is never the column that gives way: it keeps ~8 characters
        // (or all the row has, past the icon and gaps), and never less than
        // the location or the time.
        expect(r.name, label).toBeGreaterThanOrEqual(Math.min(60, r.content - 48) - 1);
        expect(r.name, label).toBeGreaterThanOrEqual(r.path);
        if (r.content >= 300) expect(r.name, label).toBeGreaterThanOrEqual(r.time);
      }
    }
    await setZoom(app, page, 1);

    // A gone item is marked, and clicking it shows that without a fetch (a
    // GET /file for it would 404: a console error).
    const goneRow = page.locator('#home-recent .fp-row[data-missing]');
    await expect(goneRow).toHaveCount(1);
    await goneRow.click();
    await expect(page.locator('#inspector-filename')).toHaveText('sweep-gone-recent.txt');
    await expect(page.locator('#inspector-kind')).toHaveText('Moved or deleted');
    await expect(page.locator('#status-selected')).toHaveText('1 selected');
    await page.locator('#home-recent .fp-row:not([data-missing])').click();
    await expect(page.locator('#inspector-kind')).not.toHaveText('Moved or deleted');
    await inspectorSettled(page);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('inspector stays usable at the 500px minimum height, at 100% and 150%', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  try {
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await openDir(page, `${root}\\_gen\\Pictures`, 6);
    await rowByName(page, 'IMG_0001.png').click();
    await inspectorSettled(page);
    for (const z of [1, 1.5]) {
      await setSize(app, page, 900, 500);
      await setZoom(app, page, z);
      const m = await page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const insp = document.getElementById('inspector');
        insp.scrollTop = insp.scrollHeight;
        const actions = insp.querySelector('.inspector__actions').getBoundingClientRect();
        const box = insp.getBoundingClientRect();
        return {
          body: document.getElementById('inspector-body').clientHeight,
          preview: r('inspector-preview').height,
          actionsInside: actions.bottom <= box.bottom + 1 && actions.top >= box.top - 1,
        };
      });
      // The whole metadata table (5 × 24px rows + 12px) shows, the preview
      // gave up height first, and the action row can be reached.
      expect(m.body, JSON.stringify(m)).toBeGreaterThanOrEqual(131);
      expect(m.preview, JSON.stringify(m)).toBeGreaterThanOrEqual(55);
      expect(m.actionsInside, JSON.stringify(m)).toBe(true);
      await windowShot(app, page, `sweep-inspector-500px-z${z * 100}`);
      await page.evaluate(() => { document.getElementById('inspector').scrollTop = 0; });
    }
    await setZoom(app, page, 1);
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('inspector preview: a refresh of the same, unchanged file keeps its preview (no blank flash)', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  try {
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await openDir(page, `${root}\\_gen\\Pictures`, 6);
    await rowByName(page, 'IMG_0002.png').click();
    await inspectorSettled(page);
    await expect(page.locator('#inspector-preview img')).toHaveCount(1);
    await page.evaluate(() => { window.__sweepImg = document.querySelector('#inspector-preview img'); });
    // F5 / an operation's refresh re-announces the same selection.
    await page.evaluate(() => refreshDirectory());
    await inspectorSettled(page);
    expect(await page.evaluate(() => document.querySelector('#inspector-preview img') === window.__sweepImg)).toBe(true);
    // Another file still gets its own preview.
    await rowByName(page, 'IMG_0003.png').click();
    await inspectorSettled(page);
    expect(await page.evaluate(() => document.querySelector('#inspector-preview img') !== window.__sweepImg)).toBe(true);
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('settings persistence: one POST per key at a time (last click wins); the window-close flush fits a keepalive', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const configBefore = await apiGet('/config');
  try {
    // ── Rapid toggles of one setting: never two requests for the key in
    //    flight, and the stored value is the last one asked for.
    const flights = await page.evaluate(async () => {
      const orig = API.post.bind(API);
      let live = 0; let peak = 0; let sent = 0;
      API.post = async (route, body, opts) => {
        if (route !== '/config' || body.key !== 'ui.sweep_probe') return orig(route, body, opts);
        live++; sent++; peak = Math.max(peak, live);
        try { return await orig(route, body, opts); } finally { live--; }
      };
      const saves = [];
      for (let i = 1; i <= 12; i++) saves.push(saveSetting('ui.sweep_probe', i));
      await Promise.all(saves);
      API.post = orig;
      return { peak, sent };
    });
    expect(flights.peak).toBe(1);
    // The first goes at once; the eleven made while it flew collapse into one.
    expect(flights.sent).toBe(2);
    expect((await apiGet('/config'))['ui.sweep_probe']).toBe(12);

    // ── A Ctrl+wheel run still pending when the window goes away is saved
    //    even with a folder-view map far past a keepalive's 64 KB cap.
    const big = {};
    for (let i = 0; i < 499; i++) {
      big[`c:\\users\\somebody\\documents\\a fairly long folder name for padding the map ${i}\\and a second level ${i}`] =
        { view: 'list', size: null, t: 1_000 + i };
    }
    await apiPostConfig('ui.folder_views', big);
    await page.evaluate(() => loadConfig());
    const docs = `${root}\\_gen\\Documents`;
    await openDir(page, docs, 5);
    expect(await page.evaluate(() => JSON.stringify(window.__fpConfig['ui.folder_views']).length)).toBeGreaterThan(70_000);
    await page.evaluate(() => { setView('icons', 128, { manual: false }); rememberViewChoice({ debounce: true }); });
    await page.evaluate(() => flushFolderViewsOnExit());
    await expect.poll(async () => (await apiGet('/config'))['ui.folder_views']?.[docs.toLowerCase()]?.size).toBe(128);
    const saved = (await apiGet('/config'))['ui.folder_views'];
    expect(Object.keys(saved).length).toBe(500);
  } finally {
    await apiPostConfig('ui.folder_views', configBefore['ui.folder_views'] || {});
    await fetch(`${API}/config/ui.sweep_probe`, { method: 'DELETE', headers: apiHeaders() });
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

async function apiPostConfig(key, value) {
  return apiSend('POST', '/config', { key, value });
}

test('chrome mouse focus: a drag ends the press; a target that refuses focus leaves the control unfocused', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  try {
    await openDir(page, `${root}\\_gen\\Documents`, 5);
    await rowByName(page, 'doc-00.txt').click();
    // A press on a tab that became a native drag: the drag swallows the
    // mouseup, and the record of that press must not survive it — or the next
    // keyboard focus on the chrome is sent back to the list.
    const afterDrag = await page.evaluate(() => {
      const tab = document.querySelector('#tabbar .fp-tab');
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      const dataTransfer = new DataTransfer();
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      tab.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      const btn = document.querySelector('#toolbar [data-action="nav-up"]');
      btn.focus();                         // later, by keyboard
      return document.activeElement === btn;
    });
    expect(afterDrag).toBe(true);
    // A press whose earlier focus can no longer take it back (made inert):
    // the chrome control still does not keep focus.
    const refused = await page.evaluate(() => {
      const list = document.getElementById('list-scroll');
      list.focus();
      const btn = document.querySelector('#toolbar [data-action="nav-up"]');
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      list.inert = true;
      btn.focus();
      const kept = document.activeElement === btn;
      list.inert = false;
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return kept;
    });
    expect(refused).toBe(false);
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('reconnect: a known-folder map that arrives late prewarms the folder icons', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const calls = await page.evaluate(async () => {
      const orig = fpPrewarmIconSizes;
      let n = 0;
      // eslint-disable-next-line no-global-assign
      fpPrewarmIconSizes = () => { n++; };
      try { await refreshBackendData(); } finally {
        // eslint-disable-next-line no-global-assign
        fpPrewarmIconSizes = orig;
      }
      return { n, map: !!window.__fpKnownFolders };
    });
    expect(calls).toEqual({ n: 1, map: true });
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('search: a search stopped by a failed open from Home runs again when the Browser is back', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  try {
    await openDir(page, `${root}\\_gen\\Documents`, 5);
    // Hold the search request so it is still in flight when the user leaves.
    await page.evaluate(() => {
      window.__sweepSearchGate = new Promise((r) => { window.__sweepSearchRelease = r; });
      const orig = API.get.bind(API);
      window.__sweepOrigGet = orig;
      API.get = async (route, params, opts) => {
        if (route === '/fs/search' && window.__sweepSearchGate) await window.__sweepSearchGate;
        return orig(route, params, opts);
      };
      setSearchText('doc-0');
      runSearch();
    });
    await page.waitForFunction(() => !!searchState.inflight);
    await page.evaluate(() => switchScreen('home'));
    await page.evaluate((p) => openBrowserAt(p).catch(() => {}), `${root}\\Nowhere-sweep-2d`);
    await page.waitForFunction(() => !window.__fpLoadPending);
    await expect(page.locator('#screen-home')).toHaveClass(/active/);
    await page.evaluate(() => { window.__sweepSearchGate = null; window.__sweepSearchRelease(); });
    await page.evaluate(() => switchScreen('browser'));
    await page.waitForFunction(() => browserState.mode === 'search' && !searchState.inflight
      && searchState.results && searchState.results.length > 0, null, { timeout: 10_000 });
    expect(await page.evaluate(() => searchState.query)).toBe('doc-0');
    await expect(page.locator('#search-input')).toHaveValue('doc-0');
    // The debounce handle is cleared once it has fired.
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      input.value = 'doc-01';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => _searchDebounceTimer === null && !searchState.inflight
      && searchState.query === 'doc-01', null, { timeout: 10_000 });
    await page.evaluate(() => { API.get = window.__sweepOrigGet; });
  } finally {
    await app.close();
  }
  // The open of a folder that is not there is the one expected 404.
  const unexpected = errors.filter((e) => !(/status of 404/.test(e) && /Nowhere-sweep-2d/.test(e)));
  expect(unexpected, unexpected.join('\n')).toEqual([]);
});

test('Settings › Data cache clear empties the layers the renderer refills from first, and says so when one fails', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const order = await page.evaluate(async () => {
      const seen = [];
      const origDel = API.del.bind(API);
      const origClear = fpClearIconCaches;
      API.del = async (route, ...rest) => { if (route === '/shell/icons/cache') seen.push('backend'); return origDel(route, ...rest); };
      // eslint-disable-next-line no-global-assign
      fpClearIconCaches = () => { seen.push('renderer'); return origClear(); };
      try { await clearIconCachesEverywhere(); } finally {
        API.del = origDel;
        // eslint-disable-next-line no-global-assign
        fpClearIconCaches = origClear;
      }
      return seen;
    });
    expect(order).toEqual(['backend', 'renderer']);
    const failed = await page.evaluate(async () => {
      const origDel = API.del.bind(API);
      API.del = async (route, ...rest) => {
        if (route === '/shell/icons/cache') throw new ApiError(503, 'down');
        return origDel(route, ...rest);
      };
      try { await clearIconCachesEverywhere(); } finally { API.del = origDel; }
      return { status: document.getElementById('settings-cache-status')?.textContent || '', failed: window.__fpLastCacheClear.failed };
    });
    expect(failed.failed).toEqual(['the backend’s']);
    expect(failed.status).toContain('couldn’t clear the backend’s cache');
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Settings › Personalization: the inspector width slider shows its track on the card', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => { switchScreen('settings'); switchSettingsPane('personalization'); });
    const slider = page.locator('#slider-inspector-width');
    await slider.scrollIntoViewIfNeeded();
    await expect(slider).toBeVisible();
    await frames(page);
    const box = await slider.boundingBox();
    const px = await app.evaluate(async ({ BrowserWindow }, b) => {
      const win = BrowserWindow.getAllWindows()[0];
      const f = win.webContents.getZoomFactor();
      const rect = { x: Math.round(b.x * f), y: Math.round(b.y * f), width: Math.round(b.width * f), height: Math.round(b.height * f) };
      const img = await win.webContents.capturePage(rect);
      const { width, height } = img.getSize();
      const bmp = img.toBitmap();
      const at = (x, y) => { const i = (y * width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
      const mid = Math.floor(height / 2);
      // Far right end of the track (the thumb sits at 340 of 280-520, left
      // of centre), and the card above the track.
      return { track: at(width - 4, mid), card: at(width - 4, 0) };
    }, box);
    const diff = Math.max(...px.track.map((v, i) => Math.abs(v - px.card[i])));
    expect(diff, JSON.stringify(px)).toBeGreaterThan(12);
    await shot(page, 'sweep-settings-slider-track');
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('places: Back/Forward return to the scroll and selection; Up selects the folder it left; paste and undo select what landed', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const dir = sweepDir(root);
  fs.mkdirSync(path.join(dir, 'Dest'));
  try {
    const bulk = `${root}\\Bulk`;
    const docs = `${root}\\_gen\\Documents`;
    const scrollTop = () => page.evaluate(() => document.getElementById('list-scroll').scrollTop);
    const selection = () => page.evaluate(() => [...browserState.selection]);
    await openDir(page, bulk, 100);
    await page.evaluate((p) => { selectRow(p); document.getElementById('list-scroll').scrollTop = 900; }, `${bulk}\\bulk-100.txt`);
    expect(await scrollTop()).toBe(900);
    await openDir(page, docs, 5);
    expect(await scrollTop()).toBe(0);

    // Back: where the user left Bulk.
    await page.evaluate(() => navBack());
    await page.waitForFunction((p) => fpNormalizePath(browserState.path) === fpNormalizePath(p) && !window.__fpLoadPending, bulk);
    expect(await scrollTop()).toBe(900);
    expect(await selection()).toEqual([`${bulk}\\bulk-100.txt`]);
    await inspectorSettled(page);
    await expect(page.locator('#inspector-filename')).toHaveText('bulk-100.txt');
    // Forward: Documents as it was left (nothing selected, at the top).
    await page.evaluate(() => navForward());
    await page.waitForFunction((p) => fpNormalizePath(browserState.path) === fpNormalizePath(p) && !window.__fpLoadPending, docs);
    expect(await selection()).toEqual([]);

    // Up: the folder it came out of is selected (and in view).
    await page.evaluate(() => navUp());
    await page.waitForFunction((p) => fpNormalizePath(browserState.path) === fpNormalizePath(p) && !window.__fpLoadPending, `${root}\\_gen`);
    expect(await selection()).toEqual([`${root}\\_gen\\Documents`]);
    await expect(rowByName(page, 'Documents')).toHaveClass(/fp-row--selected/);

    // Paste selects the pasted item; an undone delete selects it again.
    await openDir(page, dir, 4);
    await page.evaluate((d) => { selectRow(`${d}\\sweep-a.txt`); fileops.copySelection(); }, dir);
    await openDir(page, path.join(dir, 'Dest'), 0);
    await page.evaluate(() => fileops.pasteInto(browserState.path));
    await expect(rowByName(page, 'sweep-a.txt')).toHaveClass(/fp-row--selected/);
    await page.evaluate(() => fileops.trashSelection());
    await expect(rowByName(page, 'sweep-a.txt')).toHaveCount(0);
    expect(await selection()).toEqual([]);
    await page.evaluate(() => fileops.undoLast());
    await expect(rowByName(page, 'sweep-a.txt')).toHaveClass(/fp-row--selected/);
    await inspectorSettled(page);
    await expect(page.locator('#inspector-filename')).toHaveText('sweep-a.txt');
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
