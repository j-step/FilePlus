// frontend/test/stage2d-views.spec.js
// Stage 2D Task 5 (spec §3): the Explorer view ladder. Ctrl+wheel walks
// Content → Tiles → Details → List → Small icons → icons 48…256 one notch per
// step (the View menu check follows); List is column-major and scrolls
// sideways on a plain wheel; icon cells are s+28 wide with an s×s icon and a
// name that wraps (long words too) and clamps at 4 lines; no text is ever
// clipped at any app zoom; a size step never moves an icon after it lands;
// each folder remembers its view across restarts; arrow keys move
// geometrically.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, shot, apiGet, API, apiHeaders, SHOTS } = require('./harness/app');

test.setTimeout(300_000);

const LADDER = ['content', 'tiles', 'details', 'list', 'small',
  ...[48, 56, 64, 72, 80, 96, 112, 128, 160, 192, 224, 256].map((s) => `icons@${s}`)];
const NAMED = [
  ['content', 'content', null], ['tiles', 'tiles', null], ['details', 'details', null], ['list', 'list', null],
  ['small', 'small', null], ['medium', 'icons', 48], ['large', 'icons', 96], ['xl', 'icons', 256],
];
const UNBROKEN = 'AnExtremelyLongUnbrokenFileNameThatNeverOffersAWrapPoint60ch.txt';

/** The View-menu action the check mark must sit on for a ladder step. */
function menuActionFor(step) {
  const [view, size] = step.split('@');
  if (view !== 'icons') return `view-${view}`;
  const s = Number(size);
  return s < 80 ? 'view-medium' : (s < 192 ? 'view-large' : 'view-xl');
}

async function ctrlWheel(page, dy) {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, dy);
  await page.keyboard.up('Control');
}

/** A screenshot of the whole window as the user sees it. Playwright's own
 * page.screenshot() crops to the CSS viewport under Electron zoom. Mica is
 * switched off for the capture: its regions are transparent in the page and
 * capturePage() would save them as see-through pixels (white in a viewer),
 * which is not what the window looks like. */
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

async function setZoom(app, page, z) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
  await page.waitForFunction((f) => Math.abs(window.electronAPI.getZoom() - f) < 0.001, z);
  // Two frames: the resize observer (List rows) and layout have run.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function open(page, dir, minRows = 1) {
  await page.evaluate((p) => openBrowserAt(p), dir);
  await page.waitForFunction((n) => document.querySelectorAll('#list-scroll > .fp-row').length >= n
    && window.__fpLoadPending === 0, minRows);
}

const viewNow = (page) => page.evaluate(() => (browserState.view === 'icons'
  ? `icons@${browserState.iconSize}` : browserState.view));

test('ladder: Ctrl+wheel walks the eight views in order, the menu check follows, List scrolls sideways', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const viewsDir = `${root}\\Views`;
    await open(page, viewsDir, 20);

    const ladder = await page.evaluate(() => VIEW_LADDER.map((s) => s.view + (s.size ? `@${s.size}` : '')));
    expect(ladder).toEqual(LADDER);

    // A plain folder opens in Details (spec §3.1).
    expect(await viewNow(page)).toBe('details');

    await page.evaluate(() => setView('content', null, { manual: true }));
    const box = await page.locator('#list-scroll').boundingBox();
    await page.mouse.move(box.x + box.width - 30, box.y + box.height - 20); // empty space counts
    const zoomBefore = await page.evaluate(() => window.electronAPI.getZoom());
    for (let i = 1; i < LADDER.length; i++) {
      await ctrlWheel(page, -100);
      await expect.poll(() => page.evaluate(() => currentViewStep())).toBe(i);
      const checked = await page.evaluate(() => VIEW_MENU_ITEMS
        .filter((it) => it !== 'sep' && /^view-/.test(it.action) && it.checked(menuContext()))
        .map((it) => it.action));
      expect(checked, LADDER[i]).toEqual([menuActionFor(LADDER[i])]);
      expect(await page.locator('#list-scroll').getAttribute('data-view')).toBe(LADDER[i].split('@')[0]);
    }
    // Clamps at the top; the wheel never zooms the app.
    await ctrlWheel(page, -100);
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => currentViewStep())).toBe(LADDER.length - 1);
    expect(await page.evaluate(() => window.electronAPI.getZoom())).toBe(zoomBefore);
    // Wheel down steps back; half notches accumulate into one step.
    await ctrlWheel(page, 100);
    await expect.poll(() => viewNow(page)).toBe('icons@224');
    await ctrlWheel(page, 50);
    await page.waitForTimeout(100);
    expect(await viewNow(page)).toBe('icons@224');
    await ctrlWheel(page, 50);
    await expect.poll(() => viewNow(page)).toBe('icons@192');

    // The View menu lists the eight views Explorer's way, top to bottom, and
    // picking one applies it (named sizes 48 / 96 / 256).
    await page.locator('#btn-view-menu').click();
    const labels = await page.locator('#context-menu > .fp-context-menu__item').allTextContents();
    expect(labels.slice(0, 8).map((s) => s.trim())).toEqual(
      ['Extra large icons', 'Large icons', 'Medium icons', 'Small icons', 'List', 'Details', 'Tiles', 'Content']);
    await page.locator('#context-menu [data-menu-label="Medium icons"]').click();
    expect(await viewNow(page)).toBe('icons@48');

    // The empty-area menu's View entry is a flyout with the same eight.
    const lb = await page.locator('#list-scroll').boundingBox();
    await page.mouse.click(lb.x + lb.width - 12, lb.y + lb.height - 12, { button: 'right' });
    const viewItem = page.locator('#context-menu [data-menu-label="View"]');
    await expect(viewItem).toBeVisible();
    await viewItem.hover();
    const fly = page.locator('.fp-context-menu--flyout');
    await expect(fly).toBeVisible();
    await expect(fly.locator('.fp-context-menu__item')).toHaveText(
      ['Extra large icons', 'Large icons', 'Medium icons', 'Small icons', 'List', 'Details', 'Tiles', 'Content']);
    await fly.locator('.fp-context-menu__item', { hasText: 'Tiles' }).click();
    expect(await viewNow(page)).toBe('tiles');

    // List: column-major (the second row sits under the first, the column
    // after it starts at the top again), and a plain wheel scrolls sideways.
    await page.evaluate(() => setView('list', null, { manual: true }));
    const flow = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#list-scroll > .fp-row')];
      const r = rows.map((el) => el.getBoundingClientRect());
      const perCol = Number(getComputedStyle(document.getElementById('list-scroll')).getPropertyValue('--list-rows'));
      return { n: rows.length, perCol, sameColumn: Math.abs(r[1].left - r[0].left) < 0.5 && r[1].top > r[0].top,
        nextColumnTop: perCol < rows.length ? Math.abs(r[perCol].top - r[0].top) < 0.5 && r[perCol].left > r[0].left : null,
        scrollW: document.getElementById('list-scroll').scrollWidth, clientW: document.getElementById('list-scroll').clientWidth,
        overflowY: document.getElementById('list-scroll').scrollHeight - document.getElementById('list-scroll').clientHeight };
    });
    expect(flow.sameColumn).toBe(true);
    expect(flow.perCol).toBeGreaterThan(1);
    expect(flow.overflowY).toBeLessThanOrEqual(1);
    // Make the listing wider than the pane so there is somewhere to scroll.
    await page.evaluate(() => { const ls = document.getElementById('list-scroll'); ls.scrollLeft = 0; });
    if (flow.scrollW > flow.clientW) {
      expect(flow.nextColumnTop).toBe(true);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const before = await page.evaluate(() => document.getElementById('list-scroll').scrollLeft);
      await page.mouse.wheel(0, 300);
      await expect.poll(() => page.evaluate(() => document.getElementById('list-scroll').scrollLeft)).toBeGreaterThan(before);
    }
    // Bulk (240 rows) always overflows sideways in List.
    await open(page, `${root}\\Bulk`, 100);
    await page.evaluate(() => setView('list', null, { manual: false }));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const beforeBulk = await page.evaluate(() => document.getElementById('list-scroll').scrollLeft);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => document.getElementById('list-scroll').scrollLeft)).toBeGreaterThan(beforeBulk);
    // Ctrl+R keeps the sideways scroll in List.
    const keptLeft = await page.evaluate(() => document.getElementById('list-scroll').scrollLeft);
    await page.evaluate(() => refreshAll());
    expect(await page.evaluate(() => document.getElementById('list-scroll').scrollLeft)).toBe(keptLeft);
    await shot(page, 'views-list-bulk');
  } finally {
    await fetch(`${API}/config/ui.folder_views`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('icon cells: s+28 wide, s×s icon, names wrap inside and clamp at 4 lines; nothing clips at any zoom', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\Views`, 20);

    await page.evaluate(() => setView('icons', 96, { manual: false }));
    const cells = await page.evaluate((unbroken) => [...document.querySelectorAll('#list-scroll > .fp-row')].map((row) => {
      const r = row.getBoundingClientRect();
      const ic = row.querySelector('.fp-tile__thumb').getBoundingClientRect();
      const nm = row.querySelector('.fp-row__name');
      const n = nm.getBoundingClientRect();
      return { name: nm.textContent, w: r.width, iconW: ic.width, iconH: ic.height,
        lines: Math.round(nm.clientHeight / parseFloat(getComputedStyle(nm).lineHeight)),
        inside: n.left >= r.left - 0.5 && n.right <= r.right + 0.5, hOverflow: nm.scrollWidth - nm.clientWidth,
        unbroken: nm.textContent === unbroken };
    }), UNBROKEN);
    for (const c of cells) {
      expect(Math.abs(c.w - 124), c.name).toBeLessThan(0.01);
      expect(Math.abs(c.iconW - 96), c.name).toBeLessThan(0.01);
      expect(Math.abs(c.iconH - 96), c.name).toBeLessThan(0.01);
      expect(c.lines, c.name).toBeLessThanOrEqual(4);
      expect(c.inside, c.name).toBe(true);
      expect(c.hOverflow, c.name).toBeLessThanOrEqual(1);
    }
    expect(cells.find((c) => c.unbroken).lines).toBeGreaterThan(1);   // the long word wrapped
    expect(cells.some((c) => c.lines === 4)).toBe(true);                // and something clamped
    // Selected AND focused shows the whole name; the cell grows downward.
    const grown = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list-scroll > .fp-row')]
        .find((r) => r.querySelector('.fp-row__name').textContent.startsWith('A long multi-word'));
      const before = row.getBoundingClientRect();
      selectRow(row.dataset.path, {});
      const after = row.getBoundingClientRect();
      const nm = row.querySelector('.fp-row__name');
      return { grewDown: after.height > before.height && Math.abs(after.top - before.top) < 0.5,
        full: nm.scrollHeight <= nm.clientHeight + 1 };
    });
    expect(grown.grewDown).toBe(true);
    expect(grown.full).toBe(true);
    await page.evaluate(() => clearSelection());

    // Tooltips only on names that are actually cut short (Explorer).
    const tips = await page.evaluate(() => {
      const byName = (t) => [...document.querySelectorAll('#list-scroll > .fp-row .fp-row__name')].find((n) => n.textContent.startsWith(t));
      const hover = (el) => { el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return el.getAttribute('title'); };
      return { long: hover(byName('A long multi-word')), short: hover(byName('short.txt')) };
    });
    expect(tips.long).toMatch(/^A long multi-word.*\.docx$/);
    expect(tips.short).toBeNull();

    // The no-clip sweep: every named view at every app zoom step, with the
    // inspector closed so the file area is at its widest at 2x.
    // stage2d-zoom.spec.js runs the same check with the inspector open at
    // 125% and 150% (it keeps its screen width there — Stage 2D §5).
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    const offenders = [];
    for (const z of [0.8, 1, 1.25, 1.5, 2]) {
      await setZoom(app, page, z);
      for (const [label, view, size] of NAMED) {
        await page.evaluate(([v, s]) => setView(v, s, { manual: false }), [view, size]);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const bad = await page.evaluate(() => {
          const out = [];
          for (const row of document.querySelectorAll('#list-scroll > .fp-row')) {
            if (row.scrollHeight > row.clientHeight + 1) out.push(`row ${row.dataset.path} ${row.scrollHeight}>${row.clientHeight}`);
            for (const nm of row.querySelectorAll('.fp-row__name, .fp-row__line, .fp-row__meta')) {
              const cs = getComputedStyle(nm);
              // Tooltips are decided on hover (only cut-short text gets one).
              nm.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
              const titled = !!nm.getAttribute('title');
              if (nm.scrollWidth > nm.clientWidth + 1 && !(cs.textOverflow === 'ellipsis' && titled)) {
                out.push(`h-clip ${nm.className} "${nm.textContent}"`);
              }
              if (nm.scrollHeight > nm.clientHeight + 1 && !(cs.webkitLineClamp !== 'none' && titled)) {
                out.push(`v-clip ${nm.className} "${nm.textContent}" ${nm.scrollHeight}>${nm.clientHeight}`);
              }
              // An ellipsis is fine; a name squeezed to (almost) nothing is not.
              if (nm.classList.contains('fp-row__name') && nm.clientWidth < Math.min(nm.scrollWidth, 48)) {
                out.push(`squeezed ${nm.className} "${nm.textContent}" ${nm.clientWidth}px`);
              }
            }
          }
          // No two cells overlap (a squeezed grid row would stack them).
          const rects = [...document.querySelectorAll('#list-scroll > .fp-row')].map((r) => r.getBoundingClientRect());
          for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
              const a = rects[i], b = rects[j];
              if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(`overlap ${i}/${j}`);
            }
          }
          const ls = document.getElementById('list-scroll');
          if (browserState.view === 'list' && ls.scrollHeight > ls.clientHeight + 1) out.push('list overflows vertically');
          return out;
        });
        offenders.push(...bad.map((b) => `${label}@${z}: ${b}`));
        if (z === 1 || z === 1.5) await windowShot(app, page, `views-${label}-z${Math.round(z * 100)}`);
      }
    }
    expect(offenders).toEqual([]);
    await setZoom(app, page, 1);
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));

    // The image folder decides Large icons on its own; shots of every view there too.
    await open(page, `${root}\\Views\\Gallery`, 10);
    expect(await viewNow(page)).toBe('icons@96');
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll img.fp-thumb--ready').length >= 6, null, { timeout: 10_000 });
    for (const [label, view, size] of NAMED) {
      await page.evaluate(([v, s]) => setView(v, s, { manual: false }), [view, size]);
      await page.waitForTimeout(400);
      await shot(page, `views-gallery-${label}`);
    }
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('a size step never moves an icon after it lands; a large folder steps fast', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\Views\\Gallery`, 10);
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll img.fp-thumb--ready').length >= 6, null, { timeout: 10_000 });
    // Pointer over the third cell: it is the scroll anchor.
    const cellBox = await page.locator('#list-scroll > .fp-row').nth(2).boundingBox();
    await page.mouse.move(cellBox.x + cellBox.width / 2, cellBox.y + 20);
    const samples = await page.evaluate(async () => {
      const row = document.querySelectorAll('#list-scroll > .fp-row')[0];
      const els = [row.querySelector('.fp-tile__thumb'), row.querySelector('img.fp-thumb--ready') || row.querySelector('.fp-tile__thumb > *')];
      const rec = () => els.map((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height, el.isConnected]; });
      const out = [];
      const t0 = performance.now();
      stepView(1);
      out.push({ at: 0, rects: rec(), ms: performance.now() - t0 });
      await new Promise((r) => setTimeout(r, 50));
      out.push({ at: 50, rects: rec() });
      await new Promise((r) => setTimeout(r, 250));
      out.push({ at: 300, rects: rec() });
      return { out, view: `${browserState.view}@${browserState.iconSize}` };
    });
    expect(samples.view).toBe('icons@112');
    expect(Math.abs(samples.out[0].rects[0][0] - 112)).toBeLessThan(0.01);
    for (const s of samples.out) expect(s.rects).toEqual(samples.out[0].rects);

    // Large folder at icons@256: every step's work is well under 250 ms.
    await open(page, `${root}\\Bulk`, 100);
    const times = await page.evaluate(() => {
      const t = (fn) => { const a = performance.now(); fn(); return performance.now() - a; };
      return {
        toXl: t(() => setView('icons', 256, { manual: false })),
        down: t(() => stepView(-1)),
        up: t(() => stepView(1)),
        smallToIcons: (setView('small', null, { manual: false }), t(() => stepView(1))),
      };
    });
    for (const [k, v] of Object.entries(times)) expect(v, k).toBeLessThan(250);

    // ~5,000 entries (generated in memory, rendered through the real path):
    // Small -> icons@48 and icons@256 -> Tiles each re-render the listing once.
    const big = await page.evaluate(() => {
      const now = Date.now() / 1000;
      browserState.entries = Array.from({ length: 5000 }, (_, i) => ({
        name: `generated-entry-${String(i).padStart(4, '0')}.txt`, ext: '.txt', is_dir: false,
        is_hidden: false, size: 1000 + i, modified: now - i * 60, created: now - i * 60, accessed: now,
      }));
      setView('small', null, { manual: false });
      const t = (fn) => { const a = performance.now(); fn(); document.body.offsetHeight; return performance.now() - a; };
      const smallToIcons48 = t(() => stepView(1));
      setView('icons', 256, { manual: false });
      const icons256ToTiles = t(() => setView('tiles', null, { manual: false }));
      setView('small', null, { manual: false });
      const smallToList = t(() => stepView(-1));
      return { smallToList, rows: document.querySelectorAll('#list-scroll > .fp-row').length, smallToIcons48, icons256ToTiles };
    });
    console.log(`5,000-entry view changes (ms, incl. layout): ${JSON.stringify(big)}`);
    expect(big.rows).toBe(5000);
    expect(big.smallToIcons48).toBeLessThan(1000);
    expect(big.icons256ToTiles).toBeLessThan(1000);
    expect(big.smallToList).toBeLessThan(1000);
  } finally {
    await fetch(`${API}/config/ui.folder_views`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('scroll anchoring: the item under the pointer keeps its place across a Ctrl+wheel step', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\Bulk`, 100);
    await page.evaluate(() => setView('icons', 64, { manual: false }));
    await page.evaluate(() => { document.getElementById('list-scroll').scrollTop = 600; });
    const lb = await page.locator('#list-scroll').boundingBox();
    const px = lb.x + lb.width / 2, py = lb.y + lb.height / 2;
    const under = await page.evaluate(([x, y]) => {
      const row = document.elementFromPoint(x, y)?.closest('.fp-row[data-path]');
      return row ? { path: row.dataset.path, top: row.getBoundingClientRect().top } : null;
    }, [px, py]);
    expect(under).not.toBeNull();
    await page.mouse.move(px, py);
    await ctrlWheel(page, -100);
    await expect.poll(() => viewNow(page)).toBe('icons@72');
    const after = await page.evaluate((p) => {
      const row = [...document.querySelectorAll('#list-scroll > .fp-row')].find((r) => r.dataset.path === p);
      return row.getBoundingClientRect().top;
    }, under.path);
    expect(Math.abs(after - under.top)).toBeLessThan(1.5);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('per-folder view memory survives a restart; image folders default to Large, plain ones to Details', async () => {
  let { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const pics = `${root}\\_gen\\Pictures`;
  const docs = `${root}\\_gen\\Documents`;
  try {
    await open(page, pics, 6);
    expect(await viewNow(page)).toBe('icons@96');
    await page.locator('#btn-view-menu').click();
    await page.locator('#context-menu [data-menu-label="Medium icons"]').click();
    expect(await viewNow(page)).toBe('icons@48');
    // A menu choice is saved at once: nothing is left pending.
    expect(await page.evaluate(() => [Object.keys(_folderViewsPending).length, _folderViewsSaveTimer])).toEqual([0, 0]);
    await open(page, docs, 10);
    expect(await viewNow(page)).toBe('details');
    await page.locator('#btn-view-menu').click();
    await page.locator('#context-menu [data-menu-label="Large icons"]').click();
    expect(await viewNow(page)).toBe('icons@96');
    await expect.poll(async () => {
      const fv = (await apiGet('/config'))['ui.folder_views'] || {};
      return [fv[pics.toLowerCase()]?.view, fv[pics.toLowerCase()]?.size, fv[docs.toLowerCase()]?.view, fv[docs.toLowerCase()]?.size];
    }).toEqual(['icons', 48, 'icons', 96]);

    // Ctrl+wheel saves once the run stops; a config reload landing inside
    // that window loses nothing — the entry is merged into the CURRENT config.
    const lb = await page.locator('#list-scroll').boundingBox();
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await ctrlWheel(page, -100);
    await expect.poll(() => viewNow(page)).toBe('icons@112');
    const mid = await page.evaluate(async () => {
      const pending = Object.keys(_folderViewsPending).length;
      await loadConfig();   // the server does not have the step yet
      return { pending, seen: folderViewFor(browserState.path) };
    });
    expect(mid.pending).toBe(1);
    expect(mid.seen).toEqual({ view: 'icons', size: 112 });
    await expect.poll(async () => (await apiGet('/config'))['ui.folder_views']?.[docs.toLowerCase()]?.size).toBe(112);
    expect(await page.evaluate((k) => [window.__fpConfig['ui.folder_views'][k].size,
      window.__fpConfig['ui.folder_views'][Object.keys(window.__fpConfig['ui.folder_views']).find((x) => x.endsWith('pictures'))].size],
    docs.toLowerCase())).toEqual([112, 48]);

    // A step whose debounce has not fired is flushed when the page goes away.
    await ctrlWheel(page, -100);
    await expect.poll(() => viewNow(page)).toBe('icons@128');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    expect(await page.evaluate(() => Object.keys(_folderViewsPending).length)).toBe(0);
    await expect.poll(async () => (await apiGet('/config'))['ui.folder_views']?.[docs.toLowerCase()]?.size).toBe(128);

    // ...and by a real close straight after a step.
    await ctrlWheel(page, -100);
    await expect.poll(() => viewNow(page)).toBe('icons@160');
    expect(errors).toEqual([]);
    await app.close();

    ({ app, page, errors } = await launchApp());
    // The saved config has loaded (app init) before the first navigation.
    await page.waitForFunction(() => !!(window.__fpConfig && window.__fpConfig['ui.folder_views']));
    await open(page, pics, 6);
    expect(await viewNow(page)).toBe('icons@48');
    await open(page, docs, 10);
    expect(await viewNow(page)).toBe('icons@160');
    await open(page, `${root}\\_gen\\Projects`, 1);
    expect(await viewNow(page)).toBe('details');
    expect(errors).toEqual([]);
  } finally {
    await fetch(`${API}/config/ui.folder_views`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
});

test('old ui.view_mode / ui.list_scale are dropped once; an unremembered folder still opens in Details', async () => {
  const post = (key, value) => fetch(`${API}/config`, { method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ key, value }) });
  const del = (key) => fetch(`${API}/config/${key}`, { method: 'DELETE', headers: apiHeaders() });
  await del('ui.view_migrated_2d');
  await post('ui.view_mode', 'list');
  await post('ui.list_scale', 1.125);
  const { app, page, errors } = await launchApp();
  try {
    await expect.poll(async () => {
      const cfg = await apiGet('/config');
      return [cfg['ui.view_migrated_2d'], 'ui.view_mode' in cfg, 'ui.list_scale' in cfg, 'ui.view_default' in cfg];
    }).toEqual([true, false, false, false]);
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\_gen\\Projects`, 1);
    expect(await viewNow(page)).toBe('details');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Home keeps its own layout; Ctrl+wheel over the column header steps too; search results in List start at the left', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const homeViews = () => page.evaluate(() => [...document.querySelectorAll('.home-pane')].map((p) => p.dataset.view || null));
    const before = await homeViews();
    await open(page, `${root}\\Views\\Gallery`, 10);
    expect(await viewNow(page)).toBe('icons@96');
    await page.evaluate(() => switchScreen('home'));
    expect(await homeViews()).toEqual(before);
    await shot(page, 'views-home-after-large-icons');

    // The Details column header is part of the file area for Ctrl+wheel.
    await open(page, `${root}\\Bulk`, 100);
    expect(await viewNow(page)).toBe('details');
    const hb = await page.locator('#list-head').boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await ctrlWheel(page, 100);
    await expect.poll(() => viewNow(page)).toBe('tiles');

    // A new search result set in List starts scrolled to the left; a tab's
    // stored results come back at its own sideways scroll.
    await page.evaluate(() => setView('list', null, { manual: false }));
    const ls = page.locator('#list-scroll');
    await page.evaluate(() => { document.getElementById('list-scroll').scrollLeft = 400; });
    expect(await ls.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const left = await page.evaluate((r) => {
      const results = browserState.entries.map((e) => ({ ...e, path: joinPath(browserState.path, e.name) }));
      renderSearchResults({ results, truncated: false }, { query: 'bulk', root: r });
      const fresh = document.getElementById('list-scroll').scrollLeft;
      const snapshot = { chips: [], text: 'bulk', scope: 'current', results, truncated: false, root: r, query: 'bulk' };
      restoreSearchResultsForTab(snapshot, { selection: [], scrollTop: 0, scrollLeft: 300 });
      return { fresh, restored: document.getElementById('list-scroll').scrollLeft };
    }, `${root}\\Bulk`);
    expect(left.fresh).toBe(0);
    expect(left.restored).toBe(300);
    await page.evaluate(() => clearSearch());
    expect(errors).toEqual([]);
  } finally {
    await fetch(`${API}/config/ui.folder_views`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
});

test('arrow keys move geometrically in every view', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\Bulk`, 100);
    const focusIdx = () => page.evaluate(() => [...document.querySelectorAll('#list-scroll > .fp-row')]
      .findIndex((r) => r.dataset.path === browserState.focus));
    const rects = () => page.evaluate(() => [...document.querySelectorAll('#list-scroll > .fp-row')].map((r) => {
      const b = r.getBoundingClientRect(); return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2, top: b.top, left: b.left };
    }));
    const startAt = async (i) => {
      await page.evaluate((k) => { const r = document.querySelectorAll('#list-scroll > .fp-row')[k]; selectRow(r.dataset.path, {}); }, i);
    };

    for (const view of ['icons', 'tiles', 'small']) {
      await page.evaluate((v) => setView(v, v === 'icons' ? 96 : null, { manual: false }), view);
      await startAt(1);
      await page.keyboard.press('ArrowRight');
      expect(await focusIdx(), `${view} right`).toBe(2);
      await page.keyboard.press('ArrowLeft');
      expect(await focusIdx(), `${view} left`).toBe(1);
      const r = await rects();
      await page.keyboard.press('ArrowDown');
      const down = await focusIdx();
      // The cell below: the next row's top, nearest centre x.
      const nextTop = Math.min(...r.filter((c) => c.top > r[1].top + 1).map((c) => c.top));
      const rowBelow = r.map((c, i) => [c, i]).filter(([c]) => Math.abs(c.top - nextTop) < 1);
      const want = rowBelow.sort((a, b) => Math.abs(a[0].x - r[1].x) - Math.abs(b[0].x - r[1].x))[0][1];
      expect(down, `${view} down`).toBe(want);
      await page.keyboard.press('ArrowUp');
      expect(await focusIdx(), `${view} up`).toBe(1);
      // Right at the end of a row wraps to the next row's first cell.
      const perRow = r.filter((c) => Math.abs(c.top - r[0].top) < 1).length;
      await startAt(perRow - 1);
      await page.keyboard.press('ArrowRight');
      expect(await focusIdx(), `${view} wrap`).toBe(perRow);
    }

    // List: ↓ moves within the column, → jumps to the next column at the same row.
    await page.evaluate(() => setView('list', null, { manual: false }));
    await startAt(1);
    await page.keyboard.press('ArrowDown');
    expect(await focusIdx()).toBe(2);
    const lr = await rects();
    await page.keyboard.press('ArrowRight');
    const right = await focusIdx();
    expect(Math.abs(lr[right].y - lr[2].y)).toBeLessThan(1);
    expect(lr[right].left).toBeGreaterThan(lr[2].left);
    await page.keyboard.press('ArrowLeft');
    expect(await focusIdx()).toBe(2);
    // The focused cell is scrolled into view.
    await page.keyboard.press('End');
    const inView = await page.evaluate(() => {
      const ls = document.getElementById('list-scroll').getBoundingClientRect();
      const r = [...document.querySelectorAll('#list-scroll > .fp-row')].find((x) => x.dataset.path === browserState.focus).getBoundingClientRect();
      return r.left >= ls.left - 1 && r.right <= ls.right + 1;
    });
    expect(inView).toBe(true);

    // Details / Content: ↑/↓ only; ←/→ leave the focus alone.
    for (const view of ['details', 'content']) {
      await page.evaluate((v) => setView(v, null, { manual: false }), view);
      await startAt(3);
      await page.keyboard.press('ArrowRight');
      expect(await focusIdx(), `${view} right`).toBe(3);
      await page.keyboard.press('ArrowDown');
      expect(await focusIdx(), `${view} down`).toBe(4);
      await page.keyboard.press('PageDown');
      expect(await focusIdx(), `${view} pagedown`).toBeGreaterThan(5);
      await page.keyboard.press('Home');
      expect(await focusIdx(), `${view} home`).toBe(0);
      await page.keyboard.press('Shift+ArrowDown');
      expect(await page.evaluate(() => browserState.selection.size)).toBe(2);
    }
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
