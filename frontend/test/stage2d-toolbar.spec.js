// frontend/test/stage2d-toolbar.spec.js
// Stage 2D Task 7 (spec §6.1, §6.2): the toolbar.
// - The new-tab button is the plain "+" (fp-add) at 16 px in a 28 px square
//   ghost button, vertically centred with the tabs, styled by a class.
// - The breadcrumb starts at the LEFT of the bar (right after the nav group)
//   and grows rightward. As the bar narrows or the path grows, the search box
//   first shrinks from 280 to 180, then collapses fully to the magnifier, and
//   only then does the path overflow — at which point it right-anchors so the
//   current folder stays visible and the start caves in under the fade.
// - The collapsed magnifier (or Ctrl+F) opens search as an overlay over the
//   path without reflowing it; it folds back on blur/Escape when empty.
// - Keys on a focused toolbar control act on that control, never the list.
// - Sibling sweep (spec §12, fixed-constant layout row): status bar,
//   inspector header, tab strip and the Home header at the narrowest window
//   and at 150 %.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, apiGet, SHOTS } = require('./harness/app');

test.setTimeout(240_000);

const SEARCH_PREFERRED = 280;
const SEARCH_MIN = 180;
const DEEP = ['Deep', 'Client-Projects', 'Northwind-Archive', 'Quarterly-Reports', 'Finance-Review',
  'Year-End-Closing', 'Supporting-Files', 'Scanned-Receipts', 'Final-Approved'];

const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Whole-window capture as the user sees it (stage2d-views.spec.js): Mica
 * off so its transparent regions don't save as white. */
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

async function setSize(app, page, w, h = 760) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.w, s.h), { w, h });
  await page.waitForFunction((cw) => Math.abs(window.innerWidth * window.electronAPI.getZoom() - cw) <= 2, w, { timeout: 5000 });
  await twoFrames(page);
  await twoFrames(page);
}

async function setZoom(app, page, z) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
  await page.waitForFunction((f) => Math.abs(window.electronAPI.getZoom() - f) < 0.001
    && Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) - f) < 0.001
    && !window.__fpZoomBusy, z);
  await twoFrames(page);
  await twoFrames(page);
}

async function open(page, dir) {
  await page.evaluate((p) => openBrowserAt(p), dir);
  await page.waitForFunction((p) => window.__fpLoadPending === 0
    && document.querySelector('#breadcrumb .fp-breadcrumb__crumb--current')?.dataset.path?.replace(/\\$/, '') === p.replace(/\\$/, ''), dir);
  await twoFrames(page);
}

/** Everything the collapse-order invariants need, in one round trip. */
const state = (page) => page.evaluate(() => {
  const tb = document.getElementById('toolbar');
  const wrap = document.getElementById('breadcrumb-wrap');
  const crumbs = document.getElementById('breadcrumb');
  const sw = document.getElementById('search-wrap');
  const input = document.getElementById('search-input');
  const mag = document.getElementById('search-collapsed');
  const cur = crumbs.querySelector('.fp-breadcrumb__crumb--current');
  const first = crumbs.querySelector('.fp-breadcrumb__crumb, .fp-breadcrumb__search');
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right }; };
  const ctx = document.createElement('canvas').getContext('2d');
  const ics = getComputedStyle(input);
  ctx.font = `${ics.fontWeight} ${ics.fontSize} ${ics.fontFamily}`;
  const inputShown = input.getClientRects().length > 0 && ics.visibility !== 'hidden';
  const wcs = getComputedStyle(wrap);
  const mask = wcs.webkitMaskImage || wcs.maskImage || 'none';
  const lab = cur ? cur.querySelector('.fp-breadcrumb__label') : null;
  return {
    masked: mask !== 'none',
    curTruncated: !!lab && lab.scrollWidth > lab.clientWidth + 1,
    curEllipsis: !!lab && getComputedStyle(lab).textOverflow === 'ellipsis',
    curTitle: cur ? cur.getAttribute('title') : null,
    search: tb.dataset.search,
    narrowAttr: tb.hasAttribute('data-narrow'),
    of: wrap.classList.contains('is-overflowing'),
    tbScroll: tb.scrollWidth, tbClient: tb.clientWidth,
    wrap: r(wrap), first: first ? r(first) : null, cur: cur ? r(cur) : null,
    crumbNatural: crumbs.scrollWidth,
    sw: r(sw),
    inputShown,
    inputW: inputShown ? input.clientWidth : 0,
    placeholderW: ctx.measureText(input.placeholder).width,
    magShown: mag.getClientRects().length > 0,
    expanded: sw.classList.contains('fp-search--expanded'),
    hasContent: !!input.value || document.querySelectorAll('#search-chips .fp-search-chip').length > 0,
  };
});

/** The §6.2 invariants that must hold at EVERY width and zoom. */
function invariants(s, label) {
  const bad = [];
  if (s.search !== 'full' && s.search !== 'collapsed') bad.push(`data-search=${s.search}`);
  if (s.narrowAttr) bad.push('stale data-narrow');
  if (s.of && s.search === 'full') bad.push('path overflowing while search is full');
  if (s.search === 'full') {
    if (s.sw.w < SEARCH_MIN - 0.5) bad.push(`full search narrower than ${SEARCH_MIN}: ${s.sw.w}`);
    if (s.sw.w > SEARCH_PREFERRED + 0.5 && !s.hasContent) bad.push(`empty full search wider than ${SEARCH_PREFERRED}: ${s.sw.w}`);
    if (!s.inputShown || s.inputW + 1 < s.placeholderW) bad.push(`placeholder cut: input ${s.inputW} < ${s.placeholderW}`);
    if (s.magShown) bad.push('magnifier shown while full');
  } else if (!s.expanded) {
    if (!s.magShown) bad.push('collapsed without a magnifier');
    if (s.inputShown) bad.push('collapsed search still shows a partial input');
    if (s.sw.w > 28.5) bad.push(`collapsed search ${s.sw.w}px`);
  }
  if (!s.of && s.crumbNatural > s.wrap.w + 1) bad.push(`path clipped without is-overflowing: ${s.crumbNatural}>${s.wrap.w}`);
  if (!s.of && s.first && s.first.x - s.wrap.x > 12) bad.push(`path not left-anchored: ${s.first.x - s.wrap.x}`);
  // The current folder is always readable: its crumb lies wholly inside the
  // wrap, never under the leading fade, and if its text is cut it ends in an
  // ellipsis (with the full name as a tooltip). Overflowing, the path is
  // right-anchored on it.
  if (s.cur) {
    if (s.cur.r > s.wrap.r + 1 || s.cur.x < s.wrap.x - 1) bad.push(`current crumb outside the wrap: ${s.cur.x}..${s.cur.r} vs ${s.wrap.x}..${s.wrap.r}`);
    if (s.masked && s.cur.x < s.wrap.x + 24 - 1) bad.push(`current crumb under the fade: ${s.cur.x - s.wrap.x}px from the edge`);
    if (s.curTruncated && !(s.curEllipsis && s.curTitle)) bad.push('current crumb cut without an ellipsis + title');
    if (s.of && Math.abs(s.cur.r - s.wrap.r) > 1) bad.push(`overflowing path not right-anchored: ${s.cur.r} vs ${s.wrap.r}`);
  }
  if (s.tbScroll > s.tbClient + 1) bad.push(`toolbar overflows ${s.tbScroll}>${s.tbClient}`);
  return bad.map((b) => `${label}: ${b}`);
}

test('new-tab button is a plain 16px "+" in a 28px ghost square centred with the tabs (§6.1)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const btn = page.locator('#btn-new-tab');
    await expect(page.locator('#btn-new-tab use')).toHaveAttribute('href', '#fp-add');
    await expect(btn).toHaveClass(/\bfp-tab-new\b/);
    expect(await btn.getAttribute('style')).toBeNull();
    const geo = await page.evaluate(() => {
      const b = document.getElementById('btn-new-tab').getBoundingClientRect();
      const svg = document.querySelector('#btn-new-tab svg').getBoundingClientRect();
      const tab = document.querySelector('.fp-tab').getBoundingClientRect();
      const cs = getComputedStyle(document.getElementById('btn-new-tab'));
      return { w: b.width, h: b.height, cy: b.y + b.height / 2, tabCy: tab.y + tab.height / 2,
        sw: svg.width, sh: svg.height, bg: cs.backgroundColor, drag: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region') };
    });
    expect(geo.w).toBeCloseTo(28, 0);
    expect(geo.h).toBeCloseTo(28, 0);
    expect(geo.sw).toBeCloseTo(16, 0);
    expect(geo.sh).toBeCloseTo(16, 0);
    expect(Math.abs(geo.cy - geo.tabCy)).toBeLessThanOrEqual(1);
    expect(geo.bg).toBe('rgba(0, 0, 0, 0)');   // ghost: no fill at rest
    expect(geo.drag).toBe('no-drag');
    await btn.click();
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await windowShot(app, page, 'toolbar-new-tab-plus');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('path grows from the left; search shrinks then collapses BEFORE the path caves in; 24px hysteresis (§6.2)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const driveRoot = root.slice(0, 3);                 // "C:\" — one crumb
    const deepDir = [root, ...DEEP].join('\\');
    await setSize(app, page, 1400, 800);
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));

    // 1400 px, short path: search at its preferred width, crumbs from the left edge.
    await open(page, driveRoot);
    let s = await state(page);
    expect(invariants(s, '1400 drive')).toEqual([]);
    expect(s.search).toBe('full');
    expect(s.sw.w).toBeCloseTo(SEARCH_PREFERRED, 0);
    expect(s.first.x - s.wrap.x).toBeLessThan(12);
    expect(s.of).toBe(false);
    await windowShot(app, page, 'toolbar-1400');

    // A long query grows the bar past 280 into the free space (never into
    // the path); clearing it gives the width back.
    // setSearchText: the bar's text without the debounced search a typed
    // query would start (a real walk of the system drive).
    await page.evaluate(() => {
      focusSearchInput({ keepDropdownClosed: true });
      setSearchText('a fairly long query that wants more room than the bar has');
    });
    await twoFrames(page);
    s = await state(page);
    expect(invariants(s, '1400 drive typing')).toEqual([]);
    expect(s.sw.w).toBeGreaterThan(SEARCH_PREFERRED + 40);
    expect(s.inputW).toBeGreaterThan(300);
    await windowShot(app, page, 'toolbar-1400-long-query');
    await page.evaluate(() => { searchResetBar(); document.activeElement?.blur(); });
    await twoFrames(page);
    s = await state(page);
    expect(s.sw.w).toBeCloseTo(SEARCH_PREFERRED, 0);

    // Same width, a longer path (the sandbox root: the %TEMP% prefix, ~640 px
    // of crumbs): step 1 — the search gives up width, the path stays whole.
    await open(page, root);
    s = await state(page);
    expect(invariants(s, '1400 root')).toEqual([]);
    expect(s.search).toBe('full');
    expect(s.sw.w).toBeLessThan(SEARCH_PREFERRED);
    expect(s.of).toBe(false);
    await windowShot(app, page, 'toolbar-1400-longer-path');

    // The path changing (not the window) re-runs the layout: the deep path
    // collapses the search first, then caves in.
    await open(page, deepDir);
    s = await state(page);
    expect(invariants(s, '1400 deep')).toEqual([]);
    expect(s.search).toBe('collapsed');
    expect(s.of).toBe(true);

    // Sweep the window down and back up on the sandbox root, which passes
    // through every stage: the invariants hold at every width.
    await open(page, root);
    const offenders = [];
    const seen = new Set();
    for (const w of [1400, 1380, 1360, 1340, 1320, 1300, 1280, 1240, 1200, 1180, 1160, 1120, 1080, 1040, 980, 920, 860, 800]) {
      await setSize(app, page, w);
      s = await state(page);
      offenders.push(...invariants(s, `down ${w}`));
      seen.add(`${s.search}/${s.of}`);
    }
    for (const w of [840, 920, 1000, 1080, 1160, 1200, 1240, 1280, 1320, 1360, 1400]) {
      await setSize(app, page, w);
      s = await state(page);
      offenders.push(...invariants(s, `up ${w}`));
      seen.add(`${s.search}/${s.of}`);
    }
    expect(offenders).toEqual([]);
    // The sweep went through every stage, and never 'full/true'.
    expect([...seen].sort()).toEqual(['collapsed/false', 'collapsed/true', 'full/false']);

    // 900 px, deep path: the brief's own check.
    await open(page, deepDir);
    await setSize(app, page, 900, 700);
    s = await state(page);
    expect(!(s.of && s.search === 'full')).toBe(true);
    expect(s.search).toBe('collapsed');
    await windowShot(app, page, 'toolbar-900');

    // Hysteresis: find where the bar collapses on a slow shrink of the free
    // space, then give back less than 24 px (stays collapsed) and then more
    // (expands again). Driven by the sidebar width so the step is exact.
    await setSize(app, page, 1400, 800);
    await open(page, driveRoot);
    const collapseAt = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const tb = document.getElementById('toolbar');
      for (let sb = 240; sb <= 900; sb += 2) {
        document.documentElement.style.setProperty('--sidebar-w-screen', `${sb}px`);
        await raf();
        if (tb.dataset.search === 'collapsed') return sb;
      }
      return null;
    });
    expect(collapseAt).not.toBeNull();
    const at = async (sb) => {
      await page.evaluate((v) => document.documentElement.style.setProperty('--sidebar-w-screen', `${v}px`), sb);
      await twoFrames(page);
      return page.evaluate(() => document.getElementById('toolbar').dataset.search);
    };
    expect(await at(collapseAt - 12)).toBe('collapsed');   // 12 px back: inside the band
    expect(await at(collapseAt - 30)).toBe('full');        // 30 px back: out of it
    expect(await at(collapseAt)).toBe('collapsed');
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px'));
  } finally {
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px')).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('narrowest bar: collapsed + overflowing, current folder visible; Ctrl+F / magnifier open an overlay that never reflows the path (§6.2)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const deepDir = [root, ...DEEP].join('\\');
    await setSize(app, page, 800, 700);   // the app's minimum window width (main.js minWidth)
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '360px'));
    await open(page, deepDir);
    await twoFrames(page);
    let s = await state(page);
    expect(invariants(s, 'narrow')).toEqual([]);
    expect(s.search).toBe('collapsed');
    expect(s.of).toBe(true);
    // The current folder is the visible end of the path.
    expect(s.cur.r).toBeLessThanOrEqual(s.wrap.r + 1);
    expect(s.cur.x).toBeGreaterThanOrEqual(s.wrap.x);
    await windowShot(app, page, 'toolbar-narrowest-deep');

    const crumbRects = () => page.evaluate(() =>
      [...document.querySelectorAll('#breadcrumb > *')].map((c) => { const b = c.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.width)]; }));
    const before = await crumbRects();

    // Ctrl+F (renderer-handled; there is no application menu).
    await page.locator('#list-scroll .fp-row').first().click();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-input')).toBeFocused();
    await twoFrames(page);
    s = await state(page);
    expect(s.expanded).toBe(true);
    expect(s.search).toBe('collapsed');                      // the mode itself does not change
    expect(s.inputShown).toBe(true);
    expect(s.inputW + 1).toBeGreaterThanOrEqual(s.placeholderW);
    expect(s.sw.x).toBeGreaterThanOrEqual(s.wrap.x - 1);     // the overlay stays over the path
    expect(await crumbRects()).toEqual(before);               // and never reflows it
    await windowShot(app, page, 'toolbar-narrow-search-overlay');
    // The overlay's own dropdown (filters incl. the This PC scope) is usable.
    await expect(page.locator('#search-dropdown')).toBeVisible();
    // ...and never runs past the toolbar's left edge (the main column clips there).
    const dd = await page.evaluate(() => {
      const d = document.getElementById('search-dropdown').getBoundingClientRect();
      const t = document.getElementById('toolbar').getBoundingClientRect();
      const row = document.querySelector('#search-dropdown .fp-search-dd__title');
      return { left: d.left, tLeft: t.left, right: d.right, tRight: t.right, rowClipped: row ? row.scrollWidth > row.clientWidth + 1 : false };
    });
    expect(dd.left).toBeGreaterThanOrEqual(dd.tLeft - 1);
    expect(dd.right).toBeLessThanOrEqual(dd.tRight + 1);
    expect(dd.rowClipped).toBe(false);
    await page.keyboard.press('Escape');                      // closes the dropdown, empty bar folds
    await expect(page.locator('#search-collapsed')).toBeVisible();
    await expect(page.locator('#search-input')).toBeHidden();
    expect(await crumbRects()).toEqual(before);

    // The magnifier does the same, and a typed query keeps the overlay open on blur.
    await page.locator('#search-collapsed').click();
    await expect(page.locator('#search-input')).toBeFocused();
    expect(await crumbRects()).toEqual(before);
    await page.keyboard.type('deep');
    await page.keyboard.press('Escape');                      // closes the dropdown; text keeps it open
    await page.evaluate(() => document.activeElement.blur());
    await twoFrames(page);
    await expect(page.locator('#search-wrap')).toHaveClass(/fp-search--expanded/);
    expect(await crumbRects()).toEqual(before);
    await page.evaluate(() => clearSearch());
    await expect(page.locator('#search-wrap')).not.toHaveClass(/fp-search--expanded/);
    await expect(page.locator('#search-collapsed')).toBeVisible();

    // An ACTIVE search on the collapsed bar: the overlay covers the path's
    // "Search in … ×", so the bar carries its own clear ×. One click ends
    // the search, brings the listing back and folds the overlay.
    await page.locator('#search-collapsed').click();
    await page.keyboard.type('deep');
    await page.keyboard.press('Enter');
    await expect(page.locator('#list-search-header')).toBeVisible({ timeout: 6000 });
    await page.evaluate(() => document.activeElement?.blur());
    const clearX = page.locator('#search-clear-inline');
    await expect(clearX).toBeVisible();
    await expect(clearX).toHaveAttribute('aria-label', 'Clear search');
    await windowShot(app, page, 'toolbar-narrow-active-search');
    await clearX.click();
    await expect(page.locator('#list-search-header')).toBeHidden();
    await expect(page.locator('#search-input')).toHaveValue('');
    await expect(page.locator('#list-scroll .fp-row[data-path$="deep-note.txt"]')).toBeVisible();
    await expect(page.locator('#search-wrap')).not.toHaveClass(/fp-search--expanded/);
    await expect(page.locator('#search-collapsed')).toBeVisible();
    await expect(clearX).toBeHidden();
    // ...and focus is back on the list, not on the hidden ×.
    expect(await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && (a.id === 'list-scroll' || a.classList.contains('fp-row'));
    })).toBe(true);
    expect(await crumbRects()).toEqual(before);
  } finally {
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px')).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('every zoom step, inspector closed and open: search is never partially visible, the collapse order holds (§5, §6.2)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const deepDir = [root, ...DEEP].join('\\');
    const steps = await page.evaluate(() => window.electronAPI.zoomSteps());
    const offenders = [];
    for (const [w, dir] of [[1400, `${root}\\Views`], [1100, deepDir], [900, `${root}\\Views`]]) {
      await setSize(app, page, w, 800);
      await open(page, dir);
      for (const z of [...new Set([...steps, 1.25])].sort((a, b) => a - b)) {
        await setZoom(app, page, z);
        for (const o of [false, true]) {
          await page.evaluate((v) => setInspectorOpen(v, { persist: false }), o);
          await twoFrames(page);
          await twoFrames(page);
          offenders.push(...invariants(await state(page), `${w}px ${path.basename(dir)} @${z} inspector ${o ? 'open' : 'closed'}`));
        }
        if (z === 1.5 && w !== 1100) await windowShot(app, page, `toolbar-${w}-zoom150`);
      }
      await setZoom(app, page, 1);
    }
    expect(offenders).toEqual([]);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('Enter/Space on a focused toolbar button act on that button, not the focused file row (Task 2 leftover)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const viewsDir = `${root}\\Views`;
    await setSize(app, page, 1400, 800);
    await open(page, viewsDir);
    // A FOLDER row has focus — Enter in the list would open it. The toolbar
    // button gets KEYBOARD focus (Tab), the case the divert is for.
    await page.locator('#list-scroll .fp-row[data-path$="Folder One"]').click();
    await page.locator('#btn-view-menu').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#btn-sort-menu')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#context-menu')).toBeVisible();
    expect(await page.evaluate(() => activeTab().path)).toBe(viewsDir);
    await page.keyboard.press('Escape');
    await expect(page.locator('#context-menu')).toBeHidden();

    await page.locator('#list-scroll .fp-row[data-path$="Folder One"]').click();
    await page.locator('#btn-sort-menu').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#btn-view-menu')).toBeFocused();
    await page.keyboard.press(' ');
    await expect(page.locator('#context-menu')).toBeVisible();
    expect(await page.evaluate(() => activeTab().path)).toBe(viewsDir);
    await page.keyboard.press('Escape');

    // A breadcrumb crumb is a toolbar control too: Enter navigates THERE.
    await page.locator('#list-scroll .fp-row[data-path$="Folder One"]').click();
    await page.evaluate((p) => {
      const crumbs = [...document.querySelectorAll('#breadcrumb .fp-breadcrumb__crumb')];
      const i = crumbs.findIndex((c) => c.dataset.path === p);
      crumbs[i - 1].focus();
    }, `${root}\\`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, root);

    // KEYBOARD users: Tab to Up, Enter fires Up.
    await open(page, `${viewsDir}\\Folder One`);
    await page.locator('#breadcrumb .fp-breadcrumb__crumb').first().focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#btn-up')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, viewsDir);

    // MOUSE users (Explorer's model): a click on Up runs Up but leaves
    // keyboard focus where it was, so an Enter RIGHT AFTER (no arrow first)
    // opens the list's focused row — or does nothing — and never re-fires Up.
    await open(page, `${viewsDir}\\Folder One`);
    await page.evaluate(() => document.activeElement?.blur());   // focus is in the page, not on Up
    await page.locator('#btn-up').click();                     // -> Views
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, viewsDir);
    expect(await page.evaluate(() => document.activeElement?.closest('#toolbar, #tabbar, #sidebar') ? document.activeElement.id || 'chrome' : null)).toBeNull();
    const cursorAfterUp = await page.evaluate(() => browserState.focus);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.waitForFunction(() => window.__fpLoadPending === 0);
    const afterEnter = await page.evaluate(() => activeTab().path);
    expect(afterEnter).not.toBe(root);                          // Up did not fire again
    expect([viewsDir, cursorAfterUp]).toContain(afterEnter);
    // Same for Refresh and for a tab click.
    await open(page, viewsDir);
    await page.locator('#list-scroll .fp-row[data-path$="Folder Two"]').click();
    await page.locator('#btn-refresh').click();
    await page.waitForFunction(() => window.__fpLoadPending === 0);
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, `${viewsDir}\\Folder Two`);
    await open(page, viewsDir);
    await page.locator('#list-scroll .fp-row[data-path$="Folder Two"]').click();
    await page.locator('.fp-tab--active').click();
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, `${viewsDir}\\Folder Two`);

    // An open search dropdown owns the cursor keys: ArrowDown walks into it,
    // never the list cursor behind it; Escape hands the caret back.
    await open(page, viewsDir);
    await page.locator('#list-scroll .fp-row[data-path$="Folder One"]').click();
    const cursor0 = await page.evaluate(() => browserState.focus);
    await page.locator('#search-wrap').click();
    await expect(page.locator('#search-dropdown')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.getElementById('search-dropdown').contains(document.activeElement))).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => browserState.focus)).toBe(cursor0);
    await expect(page.locator('#search-dropdown')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-dropdown')).toBeHidden();
    await expect(page.locator('#search-input')).toBeFocused();
    await page.evaluate(() => document.activeElement.blur());

    // MOUSE users, arrows first: arrowing hands DOM focus to the row.
    await open(page, `${viewsDir}\\Folder One`);
    await page.locator('#btn-up').click();                   // -> Views
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, viewsDir);
    await page.keyboard.press('Home');                         // cursor on the first row: a folder
    const firstFolder = await page.evaluate(() => browserState.focus);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('fp-row'))).toBe(true);
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, firstFolder);

    await open(page, viewsDir);
    await page.locator('#btn-refresh').click();
    await page.waitForFunction(() => window.__fpLoadPending === 0);
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');                    // second row: a folder too
    const secondFolder = await page.evaluate(() => browserState.focus);
    await page.keyboard.press('Enter');
    await page.waitForFunction((p) => activeTab().path === p && window.__fpLoadPending === 0, secondFolder);

    // Ctrl+F never steals focus from another text field (inline rename).
    await open(page, viewsDir);
    await page.locator('#list-scroll .fp-row[data-path$="readme.md"]').click();
    await page.keyboard.press('F2');
    const renameFocused = () => page.evaluate(() => {
      const a = document.activeElement;
      return !!a && a.tagName === 'INPUT' && a.id !== 'search-input';
    });
    await expect.poll(renameFocused).toBe(true);
    await page.keyboard.press('Control+f');
    expect(await renameFocused()).toBe(true);
    await page.keyboard.press('Escape');
    // ...but from the list it does focus search.
    await page.locator('#list-scroll .fp-row[data-path$="readme.md"]').click();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-input')).toBeFocused();
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('sibling sweep: status bar, inspector header, tab strip and Home header never overflow or clip at the narrowest window and 150% (§12)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const deepDir = [root, ...DEEP].join('\\');
    const clips = () => page.evaluate(() => {
      const out = [];
      const roots = ['#statusbar', '.inspector__header', '#tabbar', '#home-tabs', '#toolbar'];
      for (const sel of roots) {
        const rootEl = document.querySelector(sel);
        if (!rootEl || !rootEl.getClientRects().length) continue;
        const rb = rootEl.getBoundingClientRect();
        // The tab strip scrolls (its overflow fade says so); the others must fit.
        if (sel !== '#tabbar' && rootEl.scrollWidth > rootEl.clientWidth + 1) out.push(`${sel} overflows ${rootEl.scrollWidth}>${rootEl.clientWidth}`);
        for (const el of rootEl.querySelectorAll('*')) {
          if (!el.getClientRects().length) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden') continue;
          const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (hasText && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') {
            out.push(`${sel} h-clip ${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}"`);
          }
          if (sel === '#tabbar' || sel === '#toolbar') continue;
          // Everything else stays inside its bar (no child sticking out past the edge).
          const b = el.getBoundingClientRect();
          if (b.width && (b.right > rb.right + 1 || b.left < rb.left - 1)) {
            out.push(`${sel} child out of bounds ${el.className || el.tagName} "${(el.textContent || '').trim().slice(0, 20)}" ${Math.round(b.left)}..${Math.round(b.right)} vs ${Math.round(rb.left)}..${Math.round(rb.right)}`);
          }
        }
      }
      return out;
    });
    const offenders = [];
    for (const z of [1, 1.5]) {
      await setSize(app, page, 800, 700);
      await setZoom(app, page, z);
      // Home header
      await page.evaluate(() => switchScreen('home'));
      await twoFrames(page);
      offenders.push(...(await clips()).map((c) => `home @${z}: ${c}`));
      await windowShot(app, page, `toolbar-sweep-home-800-zoom${Math.round(z * 100)}`);
      // Browser with a selection (status bar's longest text) and the inspector open.
      await open(page, deepDir);
      await page.locator('#list-scroll .fp-row').first().click();
      await page.evaluate(() => setInspectorOpen(true, { persist: false }));
      // Many tabs: the strip overflows into its fade, the + stays reachable.
      for (let i = 0; i < 9; i++) await page.keyboard.press('Control+t');
      await twoFrames(page);
      const plus = await page.evaluate(() => {
        const strip = document.getElementById('tabbar');
        document.getElementById('btn-new-tab').scrollIntoView({ inline: 'nearest' });
        const b = document.getElementById('btn-new-tab').getBoundingClientRect();
        const s = strip.getBoundingClientRect();
        return { inside: b.right <= s.right + 1 && b.left >= s.left - 1, overflowFade: strip.classList.contains('fp-tabbar--overflow') || strip.scrollWidth <= strip.clientWidth };
      });
      if (!plus.inside) offenders.push(`@${z}: + button not reachable in the tab strip`);
      await page.evaluate(() => activateTab(tabs.list[0].id));
      await open(page, deepDir);
      await page.locator('#list-scroll .fp-row').first().click();
      await twoFrames(page);
      offenders.push(...(await clips()).map((c) => `browser @${z}: ${c}`));
      await windowShot(app, page, `toolbar-sweep-800-zoom${Math.round(z * 100)}`);
      // Close the extra tabs again.
      await page.evaluate(() => { for (const t of tabs.list.slice(1)) closeTabById(t.id); });
      await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    }
    expect(offenders).toEqual([]);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});
