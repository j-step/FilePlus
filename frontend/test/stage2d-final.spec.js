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
    // The inspector reads the file it shows (hash + preview); a delete in that
    // instant can meet Windows' "file in use" (WinError 32). Let it finish,
    // as a person would.
    await settled(page);

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
    // The drive's own icon (the This PC card's), never the folder sprite.
    expect(await page.locator('#inspector-preview use').first().getAttribute('href')).toBe('#fp-drive');
    // Disabled actions read as disabled: no accent fill, muted text.
    const btn = await page.evaluate(() => {
      const b = document.querySelector('#inspector [data-action="inspector-open"]');
      const probe = document.createElement('span');
      probe.style.cssText = 'color:var(--text-tertiary);background:var(--accent)';
      document.body.appendChild(probe);
      const p = getComputedStyle(probe), cs = getComputedStyle(b);
      const out = { bg: cs.backgroundColor, accent: p.backgroundColor, color: cs.color, muted: p.color, cursor: cs.cursor, title: b.title };
      probe.remove();
      return out;
    });
    expect(btn.bg).not.toBe(btn.accent);
    expect(btn.color).toBe(btn.muted);
    expect(btn.cursor).toBe('not-allowed');
    expect(btn.title).toMatch(/Select one item first/);
    await expect(page.locator('#inspector-filepath')).toHaveText(`${d.mount}\u200E`);
    // Reads "C:\" (not "\:C"): the mark keeps the drive path left-to-right.
    const pathRect = await page.evaluate(() => {
      const r = document.createRange();
      const t = document.getElementById('inspector-filepath').firstChild;
      r.setStart(t, 0); r.setEnd(t, 1);
      const first = r.getBoundingClientRect();
      r.setStart(t, 2); r.setEnd(t, 3);
      return { letter: first.left, slash: r.getBoundingClientRect().left };
    });
    expect(pathRect.letter).toBeLessThan(pathRect.slash);
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

// ── Visual fixes (QA Q1, Q6–Q17, Q20–Q25) ─────────────────────────────────
const fs = require('fs');
const path = require('path');
const { API, apiHeaders, SHOTS } = require('./harness/app');

async function apiSend(method, route, body) {
  const r = await fetch(`${API}${route}`, {
    method, headers: apiHeaders({ 'Content-Type': 'application/json' }), body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}`);
  return r.json().catch(() => null);
}

async function setSize(app, page, w, h) {
  const same = await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [cw, ch] = win.getSize();
    return !win.isMaximized() && cw === s.w && ch === s.h;
  }, { w, h });
  if (same) return;
  await page.evaluate(() => {
    window.__finalResized = new Promise((r) => window.addEventListener('resize', () => r(), { once: true }));
  });
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setSize(s.w, s.h);
  }, { w, h });
  await page.evaluate(() => window.__finalResized);
  await frames(page);
}

async function setZoom(app, page, z) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
  await page.waitForFunction((f) => Math.abs(window.electronAPI.getZoom() - f) < 0.001
    && typeof appZoom !== 'undefined' && Math.abs(appZoom.current - f) < 0.001 && !window.__fpZoomBusy, z);
  await frames(page);
}

/** The whole window as the user sees it (page.screenshot crops to the CSS
 * viewport under zoom), Mica flattened. */
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
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'));
  } finally {
    await page.evaluate((m) => { if (m) document.documentElement.dataset.mica = m; }, mica);
  }
}

test('Q1/Q11/Q12/Q13/Q14/Q25: panels give the file list room; header, popout and dropdown stay inside the window', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await settled(page);
    // Q1 — 800 px, the sidebar dragged to 480, the inspector open: the file
    // list keeps 280 screen px and the inspector stays on the window.
    await setSize(app, page, 800, 600);
    await page.evaluate(() => setSidebarWidthVar(480));
    for (const z of [1, 1.5]) {
      await setZoom(app, page, z);
      const g = await page.evaluate(() => {
        const zf = window.electronAPI.getZoom();
        const list = document.getElementById('list-pane').getBoundingClientRect();
        const handle = document.getElementById('resizer').getBoundingClientRect();
        const insp = document.getElementById('inspector').getBoundingClientRect();
        return { list: (list.width + handle.width) * zf, inspRight: insp.right, inspW: insp.width * zf, vw: innerWidth };
      });
      // The list plus the 4 px inspector handle beside it make the file area.
      expect(g.list, JSON.stringify(g)).toBeGreaterThanOrEqual(279);
      expect(g.inspRight, JSON.stringify(g)).toBeLessThanOrEqual(g.vw + 0.5);
      expect(g.inspW, JSON.stringify(g)).toBeGreaterThanOrEqual(279);
      // Q14 — the header drops the same columns the rows dropped.
      const cols = await page.evaluate(() => ['size', 'modified'].map((c) => {
        const head = document.querySelector(`#list-head .list-col--${c}`);
        const cell = document.querySelector(`#list-scroll .fp-row .fp-row__${c}`);
        return [!!head.getClientRects().length, !!(cell && cell.getClientRects().length)];
      }));
      for (const [head, cell] of cols) expect(head).toBe(cell);
      if (z === 1.5) await windowShot(app, page, 'final-narrow-800-sidebar480-z150');
    }
    // N1 — a plain click on the inspector's handle (no movement) at this
    // clamped width saves nothing and changes nothing.
    const widthState = () => page.evaluate(() => [
      document.documentElement.style.getPropertyValue('--inspector-w-screen'),
      (window.__fpConfig || {})['ui.inspector_w'] ?? null]);
    const before = await widthState();
    const rb = await page.locator('#resizer').boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await widthState()).toEqual(before);
    // With the inspector closed the sidebar keeps its 480.
    await setZoom(app, page, 1);
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await frames(page);
    const side = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
    expect(Math.abs(side - 480)).toBeLessThanOrEqual(1);
    await page.evaluate(() => { setInspectorOpen(true, { persist: false }); setSidebarWidthVar(240); });

    // Q14 — List view in a narrow pane: a column never runs past the pane.
    await page.evaluate(() => setView('list'));
    await frames(page);
    const listFit = await page.evaluate(() => {
      const pane = document.getElementById('list-scroll').getBoundingClientRect();
      const row = document.querySelector('#list-scroll .fp-row').getBoundingClientRect();
      return { row: row.width, pane: pane.width };
    });
    expect(listFit.row).toBeLessThanOrEqual(listFit.pane);
    await page.evaluate(() => setView('details'));

    // Q11/Q25 — 500 px tall: the path line is whole inside the header, and
    // a picture's preview fills its box.
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Pictures`);
    await settled(page);
    await rowByName(page, 'IMG_0001.png').click();
    await settled(page);
    await setSize(app, page, 900, 500);
    for (const z of [1, 1.5]) {
      await setZoom(app, page, z);
      await page.waitForFunction(() => document.querySelector('#inspector-preview img')?.complete);
      const h = await page.evaluate(() => {
        const view = document.getElementById('inspector-scroll').getBoundingClientRect();
        const name = document.getElementById('inspector-filename').getBoundingClientRect();
        const p = document.getElementById('inspector-filepath').getBoundingClientRect();
        const box = document.getElementById('inspector-preview').getBoundingClientRect();
        const img = document.querySelector('#inspector-preview img').getBoundingClientRect();
        return { pathBottom: p.bottom, viewBottom: view.bottom, pathH: p.height, nameBottom: name.bottom,
          fill: Math.max(img.width / box.width, img.height / box.height) };
      });
      // The name is whole on screen; the path line is either whole too or
      // not shown at all (a very short window) — never cut in half.
      expect(h.nameBottom, JSON.stringify(h)).toBeLessThanOrEqual(h.viewBottom + 0.5);
      if (h.pathH > 0) expect(h.pathBottom, JSON.stringify(h)).toBeLessThanOrEqual(h.viewBottom + 0.5);
      if (z === 1) expect(h.pathH, JSON.stringify(h)).toBeGreaterThan(8);
      expect(h.fill, JSON.stringify(h)).toBeGreaterThan(0.6);
      await windowShot(app, page, `final-inspector-500px-z${z * 100}`);
    }

    // Q12/Q13 — 600 px at 150 %: the Ask popout and the search dropdown end
    // above the status bar; no lone "·" at the path's faded edge.
    await setSize(app, page, 800, 600);
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Views`);
    await settled(page);
    await frames(page);
    const statusTop = () => page.evaluate(() => document.getElementById('statusbar').getBoundingClientRect().top);
    await page.evaluate(() => openAskPopout());
    await frames(page);
    const ask = await page.locator('#ask-popout').boundingBox();
    expect(ask.y + ask.height).toBeLessThanOrEqual(await statusTop() + 0.5);
    const orphans = await page.evaluate(() => {
      const wrap = document.getElementById('breadcrumb-wrap').getBoundingClientRect();
      return [...document.querySelectorAll('#breadcrumb .fp-breadcrumb__sep')]
        .filter((s) => getComputedStyle(s).visibility !== 'hidden' && s.getBoundingClientRect().left < wrap.left + 24).length;
    });
    expect(orphans).toBe(0);
    await windowShot(app, page, 'final-ask-z150');
    await page.evaluate(() => closeAskPopout());
    await page.evaluate(() => { focusSearchInput(); openSearchDropdown(); });
    await frames(page);
    const dd = await page.locator('#search-dropdown').boundingBox();
    expect(dd.y + dd.height).toBeLessThanOrEqual(await statusTop() + 0.5);
    await windowShot(app, page, 'final-search-dropdown-z150');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await setZoom(app, page, 1);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('Q6/Q7/Q8: Home rows — hover buttons cover the time, a favourite lines up, narrow rows drop columns instead of stubs', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const dir = `${root}\\_gen\\Documents`;
    await apiSend('DELETE', '/recent');
    for (const n of ['doc-00.txt', 'doc-01.txt', 'doc-02.txt']) await apiSend('POST', '/recent', { path: `${dir}\\${n}`, action: 'opened' });
    await apiSend('POST', '/favorites', { path: `${dir}\\doc-01.txt` });
    await page.evaluate(() => switchScreen('home'));
    const rows = page.locator('#home-recent .fp-row[data-path]');
    await expect(rows).toHaveCount(3);
    await expect(page.locator('#home-recent .fp-row__star')).toHaveCount(1);
    // Q7 — the same x for every row's location and time, star or not.
    const xs = await rows.evaluateAll((els) => els.map((r) => [
      Math.round(r.querySelector('.fp-row__recent-path').getBoundingClientRect().left),
      Math.round(r.querySelector('.fp-row__recent-time').getBoundingClientRect().left)]));
    expect(new Set(xs.map(String)).size).toBe(1);
    // Q6 — hovered, the buttons sit on an opaque backing over the time.
    await rows.nth(1).hover();
    const backing = await rows.nth(1).locator('.fp-row__hover-actions').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(backing).toMatch(/gradient/);
    await setZoom(app, page, 1.5);
    await rows.nth(1).hover();
    await windowShot(app, page, 'final-home-hover-z150');
    // Q8 — narrow: a column is either gone or wide enough to say something;
    // the Recent / Favorites tabs never touch.
    for (const [w, z] of [[800, 1.5], [800, 1], [1100, 1]]) {
      await setSize(app, page, w, 700);
      await setZoom(app, page, z);
      const cells = await rows.evaluateAll((els) => els.flatMap((r) => ['.fp-row__recent-path', '.fp-row__recent-time']
        .map((s) => r.querySelector(s).getBoundingClientRect().width)));
      for (const c of cells) expect(c === 0 || c >= 36, `${w}@${z}: ${cells}`).toBe(true);
      const gap = await page.evaluate(() => {
        const t = [...document.querySelectorAll('#home-tabs .fp-tabs__item')].filter((e) => e.getClientRects().length);
        return t.length > 1 ? t[1].getBoundingClientRect().left - t[0].getBoundingClientRect().right : 99;
      });
      expect(gap).toBeGreaterThanOrEqual(3.9);
      if (w === 800 && z === 1.5) await windowShot(app, page, 'final-home-800-z150');
    }
    await setZoom(app, page, 1);
    await apiSend('DELETE', `/favorites?path=${encodeURIComponent(`${dir}\\doc-01.txt`)}`);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('Q9/Q15/Q16/Q17/Q23: Settings rows line up, controls never wrap, nav and accent read right, Writes is plain English; palette labels align', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => { applyTheme('dark'); switchScreen('settings'); });
    await page.locator('.settings-nav__item[data-pane="personalization"]').click();
    // Q16 — the notifications toggle sits at the right like the other toggles.
    const rightEdges = await page.evaluate(() => [...document.querySelectorAll('#settings-pane-personalization .fp-toggle')]
      .filter((t) => t.getClientRects().length).map((t) => Math.round(t.getBoundingClientRect().right)));
    expect(rightEdges.length).toBeGreaterThan(2);
    expect(new Set(rightEdges).size, String(rightEdges)).toBe(1);
    // …and an off toggle is outlined in a colour that reads on the dark card.
    const off = await page.evaluate(() => getComputedStyle(document.querySelector('#settings-show-notifications ~ .fp-toggle__track')).borderTopColor);
    expect(off).not.toBe('rgb(60, 62, 69)');
    await windowShot(app, page, 'final-settings-dark');
    // Q17 — the accent field names the accent of the theme in use.
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => applyTheme(t), theme);
      const a = await page.evaluate(() => ({
        hint: document.getElementById('settings-accent-hex').placeholder,
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase(),
      }));
      expect(a.hint).toBe(a.accent);
    }
    // …and in light a hovered nav item does not look like the open pane.
    await page.locator('.settings-nav__item[data-pane="data"]').hover();
    const bg = await page.evaluate(() => ({
      hover: getComputedStyle(document.querySelector('.settings-nav__item[data-pane="data"]')).backgroundColor,
      active: getComputedStyle(document.querySelector('.settings-nav__item--active')).backgroundColor,
    }));
    expect(bg.hover).not.toBe(bg.active);
    await windowShot(app, page, 'final-settings-light');
    await page.evaluate(() => applyTheme('dark'));
    // Q9 — at the narrowest Settings no segment wraps onto a second line.
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await setSize(app, page, 800, 700);
    await setZoom(app, page, 1.5);
    const wraps = await page.evaluate(() => [...document.querySelectorAll('#screen-settings .fp-segmented__opt')]
      .filter((o) => o.getClientRects().length)
      .filter((o) => o.getClientRects().length > 1 || o.scrollHeight > o.clientHeight + 1).map((o) => o.textContent.trim()));
    expect(wraps).toEqual([]);
    await windowShot(app, page, 'final-settings-narrow-z150');
    await setZoom(app, page, 1);
    await setSize(app, page, 1200, 800);
    // Q23 — the Writes line speaks plainly; the settings behind it are below.
    await page.locator('.settings-nav__item[data-pane="data"]').click();
    await expect(page.locator('#settings-writes-status')).not.toHaveText(/FILEPLUS_ENV|WRITE_UNLOCKED|\.env/);
    await expect(page.locator('#settings-writes-status')).toHaveText(/sandbox|drives/);
    await expect(page.locator('#settings-writes-detail')).toHaveText(/\.env/);
    await windowShot(app, page, 'final-settings-data');
    // Q15 — every palette command's label starts at the same x.
    await page.evaluate(() => openPalette());
    const xs = await page.evaluate(() => [...document.querySelectorAll('#palette-commands .fp-palette__item')]
      .map((b) => Math.round([...b.children].find((c) => c.tagName === 'SPAN').getBoundingClientRect().left)));
    expect(new Set(xs).size).toBe(1);
    await windowShot(app, page, 'final-palette');
    await page.keyboard.press('Escape');
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('Q10/Q20/Q21/Q24: Opens-with icon, star on the icon, a quiet collapsed rail, outlined thumbnails', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    // Q10 — the "Opens with" row never has an empty icon slot.
    await page.evaluate((p) => openProperties(p), `${root}\\Icons\\wide.png`);
    await expect(page.locator('#properties-modal')).toBeVisible();
    const app16 = await page.evaluate(async () => {
      const until = async (c) => { const end = Date.now() + 5000; while (!c() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); };
      const el = document.getElementById('properties-opens-with-icon');
      await until(() => el && (el.hidden || el.querySelector('img[src^="blob:"], img[src^="data:image/png"], svg')));
      const kid = el.querySelector('img, svg');
      return { hidden: el.hidden, named: !!(_propsData && _propsData.opens_with), w: kid ? kid.getBoundingClientRect().width : 0 };
    });
    if (app16.named) expect(app16.w).toBeGreaterThan(8);
    else expect(app16.hidden).toBe(true);
    await shot(page, 'final-properties-opens-with');
    await page.keyboard.press('Escape');

    // Q20 — the favourite star hangs on the icon's corner in Icons view.
    const doc = `${root}\\Views\\short.txt`;
    await apiSend('POST', '/favorites', { path: doc });
    await page.evaluate(() => loadFavorites());
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Views`);
    await settled(page);
    await page.evaluate(() => setView('icons', 96));
    await frames(page);
    const star = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.dataset.path.endsWith('short.txt'));
      const s = row.querySelector('.fp-row__star').getBoundingClientRect();
      const box = row.firstElementChild.getBoundingClientRect();
      return { starRight: s.right, starTop: s.top, iconLeft: box.left, iconTop: box.top, iconW: box.width };
    });
    // On the icon box's top-right corner (10% in, so it sits on the art).
    expect(Math.abs(star.starRight - (star.iconLeft + star.iconW * 0.9)), JSON.stringify(star)).toBeLessThanOrEqual(2);
    expect(star.starTop - star.iconTop, JSON.stringify(star)).toBeLessThanOrEqual(star.iconW * 0.15);
    await page.evaluate(() => [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.dataset.path.endsWith('short.txt')).scrollIntoView({ block: 'center' }));
    await frames(page);
    await windowShot(app, page, 'final-views-icons-star');
    await page.evaluate(() => setView('details'));
    await apiSend('DELETE', `/favorites?path=${encodeURIComponent(doc)}`);

    // Q24 — the thumbnail outline is drawn on the picture (inside its edge).
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Icons`);
    await settled(page);
    await page.evaluate(() => setView('icons', 96));
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll img.fp-thumb--ready').length >= 2, null, { timeout: 8000 });
    const outline = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#list-scroll img.fp-thumb--ready'));
      return [cs.outlineStyle, cs.outlineWidth, cs.outlineOffset];
    });
    expect(outline).toEqual(['solid', '1px', '-1px']);
    await windowShot(app, page, 'final-thumbs-outline-dark');
    await page.evaluate(() => setView('details'));

    // Q21 — collapsed, a pointer resting on the rail's edge shows no accent line.
    await page.evaluate(() => setSidebarCollapsed(true));
    await frames(page);
    const handle = page.locator('.fp-sidebar__resize-handle');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await frames(page);
    expect(await handle.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await windowShot(app, page, 'final-rail-at-rest');
    await page.mouse.move(600, 300);
    await page.evaluate(() => setSidebarCollapsed(false));
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});
