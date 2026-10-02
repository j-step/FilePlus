// frontend/test/stage2d-final.spec.js
// Stage 2D Task 14 — the final fix wave: regression tests for the code
// review's I1/I2/M1/M2/M5/M8 and QA's functional findings (Q2, Q3, Q4, Q18,
// Q19). Fixtures: <sandbox>/Final (global-setup.js). Waits are on
// conditions, never sleeps.
const { test, expect } = require('@playwright/test');
const { launchApp, shot, rowByName, apiGet } = require('./harness/app');

test.setTimeout(120_000);

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
  step(k);
}), n);

/** Nothing loading, no file operation or inspector work still to come. */
const settled = (page) => page.waitForFunction(() => !window.__fpLoadPending && window.__fpInspectorPending === 0
  && !fileops._trashInFlight && !fileops._inFlight);

async function finalDir(page, sub) {
  const root = (await apiGet('/fs/list/root')).path;
  const dir = `${root}\\Final\\${sub}`;
  await page.evaluate((p) => openBrowserAt(p), dir);
  await settled(page);
  return dir;
}

const names = (page) => page.locator('#list-scroll .fp-row .fp-row__name').allTextContents();

test('I1: a held Delete trashes only the selection; a second press in flight is a no-op; a held Ctrl+V pastes once', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await finalDir(page, 'Del');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(6);
    await rowByName(page, 'del-1.txt').click();

    // The real press trashes del-1 and selects the item that took its place.
    await page.keyboard.down('Delete');
    await expect(rowByName(page, 'del-1.txt')).toHaveCount(0);
    await settled(page);
    await page.waitForFunction(() => [...browserState.selection].some((p) => p.endsWith('del-2.txt')));

    // Holding the key: the auto-repeat events (repeat: true) act on nothing.
    for (let i = 0; i < 4; i++) await page.keyboard.down('Delete');
    expect(await page.evaluate(() => fileops._trashInFlight)).toBe(false);
    await page.keyboard.up('Delete');
    await settled(page);
    expect(await names(page)).toEqual(['del-2.txt', 'del-3.txt', 'del-4.txt', 'del-5.txt', 'del-6.txt']);

    // Two presses before the first request is back: one request, one item.
    const posts = await page.evaluate(async () => {
      let n = 0;
      const orig = API.post;
      API.post = function (route, ...rest) { if (route === '/fs/trash') n++; return orig.call(this, route, ...rest); };
      try {
        await Promise.all([fileops.trashSelection(), fileops.trashSelection()]);
      } finally { API.post = orig; }
      return n;
    });
    expect(posts).toBe(1);
    await settled(page);
    expect(await names(page)).toEqual(['del-3.txt', 'del-4.txt', 'del-5.txt', 'del-6.txt']);

    // Ctrl+V held down: one copy, not one per repeat.
    await rowByName(page, 'del-3.txt').click();
    await page.keyboard.press('Control+c');
    await finalDir(page, 'Paste');
    await page.locator('#list-scroll .fp-row').first().click();
    await page.keyboard.down('Control');
    await page.keyboard.down('v');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(2);
    await settled(page);
    for (let i = 0; i < 4; i++) await page.keyboard.down('v');
    await page.keyboard.up('v');
    await page.keyboard.up('Control');
    await settled(page);
    await frames(page);
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(2);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('I2: paging the inspector through 20 text files keeps one overlay scrollbar', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await finalDir(page, 'Texts');
    await rowByName(page, 't-01.txt').click();
    await settled(page);
    await expect(page.locator('#inspector-preview pre')).toHaveCount(1);
    const base = await page.evaluate(() => window.__fpOverlayScrollLive);
    for (let i = 2; i <= 20; i++) {
      await page.keyboard.press('ArrowDown');
      await settled(page);
      const want = `t-${String(i).padStart(2, '0')}.txt`;
      await page.waitForFunction((w) => _inspectorEntry && _inspectorEntry.path.endsWith(w)
        && document.querySelector('#inspector-preview pre'), want);
    }
    expect(await page.evaluate(() => window.__fpOverlayScrollLive)).toBe(base);
    await expect(page.locator('#inspector-preview .fp-oscroll')).toHaveCount(1);
    // Leaving the text preview takes its scrollbar with it.
    await page.evaluate(() => clearSelection());
    await settled(page);
    expect(await page.evaluate(() => window.__fpOverlayScrollLive)).toBe(base - 1);
    await expect(page.locator('#inspector-preview .fp-oscroll')).toHaveCount(0);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('M1: a refresh while a navigation loads does not cancel it', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const nav = await finalDir(page, 'Nav');
    const landed = await page.evaluate(async (dirA) => {
      const orig = API.get;
      let release;
      const gate = new Promise((r) => { release = r; });
      API.get = function (route, params, ...rest) {
        const p = orig.call(this, route, params, ...rest);
        return route === '/fs/list' && params && params.path === dirA ? gate.then(() => p) : p;
      };
      try {
        const going = openBrowserAt(dirA);    // the click into A, still loading…
        const refreshing = refreshAll();      // …when F5 lands
        release();
        await going;
        await refreshing;
      } finally { API.get = orig; }
      return { path: browserState.path, rows: browserState.entries.map((e) => e.name) };
    }, `${nav}\\A`);
    expect(landed.path).toBe(`${nav}\\A`);
    expect(landed.rows).toEqual(['in-a.txt']);
    await expect(page.locator('.fp-breadcrumb__crumb--current')).toHaveText('A');
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('M2/M5/M8: refresh diff ignores hidden dates; no migration on a stand-in config; selection totals use a map', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await finalDir(page, 'One');
    // M2 — only the date the row shows counts toward "changed".
    const sig = await page.evaluate(() => {
      const saved = browserState.sort;
      const e = { name: 'x.txt', is_dir: false, size: 1, modified: 10, created: 5, accessed: 20 };
      const out = {};
      browserState.sort = { key: 'name', dir: 'asc' };
      out.accessedIgnored = rowSignature(e) === rowSignature({ ...e, accessed: 99 });
      out.createdIgnored = rowSignature(e) === rowSignature({ ...e, created: 99 });
      out.modifiedCounts = rowSignature(e) !== rowSignature({ ...e, modified: 99 });
      browserState.sort = { key: 'accessed', dir: 'asc' };
      out.accessedCountsWhenShown = rowSignature(e) !== rowSignature({ ...e, accessed: 99 });
      browserState.sort = saved;
      return out;
    });
    expect(sig).toEqual({ accessedIgnored: true, createdIgnored: true, modifiedCounts: true, accessedCountsWhenShown: true });

    // M5 — the launch loaded the real config; a stand-in ({} after a failed
    // GET /config) never writes the migration flag back.
    const mig = await page.evaluate(() => {
      const calls = [];
      const origSave = window.saveSetting;
      const origDel = window.deleteSetting;
      const loaded = window.__fpConfigLoaded;
      window.saveSetting = (...a) => { calls.push(a); return Promise.resolve(); };
      window.deleteSetting = (...a) => { calls.push(a); return Promise.resolve(); };
      try {
        window.__fpConfigLoaded = false;
        migrateViewSettings({});
        const offline = calls.length;
        window.__fpConfigLoaded = true;
        migrateViewSettings({});
        return { loadedAtLaunch: loaded, offline, online: calls.length - offline };
      } finally {
        window.saveSetting = origSave;
        window.deleteSetting = origDel;
        window.__fpConfigLoaded = loaded;
      }
    });
    expect(mig).toEqual({ loadedAtLaunch: true, offline: 0, online: 1 });

    // M8 — "Select all" in a 10,000-item listing totals in well under a
    // frame budget's worth of lookups (it was ~50M string joins).
    const big = await page.evaluate(() => {
      const saved = { entries: browserState.entries, selection: browserState.selection };
      const entries = Array.from({ length: 10000 }, (_, i) => ({ name: `f${i}.txt`, is_dir: false, size: 2 }));
      browserState.entries = entries;
      browserState.selection = new Set(entries.map(entryPath));
      const t0 = performance.now();
      const total = selectionTotalSize();
      const ms = performance.now() - t0;
      const hit = entryForPath(entryPath(entries[9999])) === entries[9999];
      browserState.entries = saved.entries;
      browserState.selection = saved.selection;
      return { total, ms, hit };
    });
    expect(big.total).toBe(20000);
    expect(big.hit).toBe(true);
    expect(big.ms).toBeLessThan(250);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('Q2/Q3/Q4/Q19: inspector follows the screen and the selection kind at once; counts are pluralised; "N items selected" shown once', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    // Q4 — one item is "1 item".
    await finalDir(page, 'One');
    await expect(page.locator('#status-count')).toHaveText('1 item');
    expect(await page.evaluate(() => [countLabel(1, 'result'), countLabel(2, 'result'), countLabel(1200, 'file')]))
      .toEqual(['1 result', '2 results', '1,200 files']);

    // Q3 — one item, then a second within the settle window: the panel is
    // the multi summary in the same task, not 120 ms later.
    const dir = await finalDir(page, 'Texts');
    const at = await page.evaluate((d) => {
      selectRow(`${d}\\t-01.txt`);
      const one = document.getElementById('inspector-filename').textContent;
      selectRow(`${d}\\t-02.txt`, { ctrl: true });
      return { one, two: document.getElementById('inspector-filename').textContent, status: document.getElementById('status-selected').textContent };
    }, dir);
    expect(at.one).toBe('t-01.txt');
    expect(at.two).toBe('2 items selected');
    expect(at.status).toMatch(/^2 selected/);
    await settled(page);

    // Q19 — the count is written once; the single-file tab strip is gone.
    const multi = await page.evaluate(() => {
      const insp = document.getElementById('inspector');
      const visibleText = [...insp.querySelectorAll('*')].filter((el) => el.childNodes.length
        && [...el.childNodes].some((n) => n.nodeType === 3 && /items selected/.test(n.textContent))
        && el.getClientRects().length).length;
      return { visibleText, tabs: !!insp.querySelector('.fp-inspector__tabs').getClientRects().length,
        total: document.getElementById('inspector-multi-size').textContent };
    });
    expect(multi).toEqual({ visibleText: 1, tabs: false, total: expect.stringMatching(/B$/) });
    await shot(page, 'final-inspector-multi');

    // Q2 — Settings has no selection: the panel is neutral, actions off;
    // back on the Browser it shows the Browser's own selection again.
    await page.evaluate((d) => selectRow(`${d}\\t-03.txt`), dir);
    await settled(page);
    await page.evaluate(() => switchScreen('settings'));
    await expect(page.locator('#inspector-filename')).toHaveText('No file selected');
    await expect(page.locator('#inspector-preview pre')).toHaveCount(0);
    for (const a of ['inspector-open', 'open-file-with', 'inspector-reveal']) {
      await expect(page.locator(`#inspector [data-action="${a}"]`)).toHaveAttribute('aria-disabled', 'true');
    }
    await shot(page, 'final-inspector-settings-neutral');
    await page.evaluate(() => switchScreen('browser'));
    await expect(page.locator('#inspector-filename')).toHaveText('t-03.txt');
    await expect(page.locator('#inspector [data-action="inspector-open"]')).not.toHaveAttribute('aria-disabled', 'true');
    // Home with no row selected is neutral too.
    await page.evaluate(() => switchScreen('home'));
    await expect(page.locator('#inspector-filename')).toHaveText('No file selected');
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('Q18: a selected This PC drive card shows the drive in the inspector', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await page.click('[data-action="thispc-open"]');
    await expect(page.locator('#thispc-view')).toBeVisible();
    await expect(page.locator('#inspector-filename')).toHaveText('No file selected');
    const card = page.locator('#thispc-view .fp-drive-card').first();
    await card.click();
    await expect(page.locator('#status-selected')).toHaveText('1 selected');
    const d = await page.evaluate(() => {
      const drive = thisPcState.drives.find((x) => x.mount === thisPcSelectedPath());
      return { name: driveDisplayName(drive), mount: drive.mount, type: driveTypeText(drive), fs: drive.fs || '—', known: driveHasSize(drive) };
    });
    await expect(page.locator('#inspector-filename')).toHaveText(d.name);
    await expect(page.locator('#inspector-filepath')).toHaveText(d.mount);
    await expect(page.locator('.fp-inspector__pane[data-pane="drive"]')).toBeVisible();
    await expect(page.locator('#inspector-drive-type')).toHaveText(d.type);
    await expect(page.locator('#inspector-drive-fs')).toHaveText(d.fs);
    if (d.known) {
      await expect(page.locator('#inspector-drive-free')).toHaveText(/\d (B|KB|MB|GB|TB)$/);
      await expect(page.locator('#inspector-drive-bar')).toBeVisible();
    }
    await expect(page.locator('.fp-inspector__tabs')).toBeHidden();
    await shot(page, 'final-thispc-drive-inspector');
    // Deselected: the empty state again, with the tab strip back.
    await page.evaluate(() => clearThisPcSelection());
    await expect(page.locator('#inspector-filename')).toHaveText('No file selected');
    await expect(page.locator('.fp-inspector__pane[data-pane="drive"]')).toBeHidden();
    // A folder after This PC is the file inspector again.
    await finalDir(page, 'One');
    await rowByName(page, 'only.txt').click();
    await settled(page);
    await expect(page.locator('#inspector-filename')).toHaveText('only.txt');
    await expect(page.locator('.fp-inspector__pane[data-pane="drive"]')).toBeHidden();
    await expect(page.locator('.fp-inspector__tabs')).toBeVisible();
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});
