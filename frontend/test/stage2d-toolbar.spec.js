// frontend/test/stage2d-toolbar.spec.js
// Stage 2D Task 7 (spec §6.1, §6.2): the toolbar.
// - The new-tab button is the plain "+" (fp-add) at 16 px in a 28 px square
//   ghost button, vertically centred with the tabs, styled by a class.
// - The breadcrumb starts at the LEFT of the bar (right after the nav group)
//   and grows rightward. As the bar narrows or the path grows, the search box
//   first shrinks from 280 to 120 (addendum §2: it fills the space up to the
//   end of the path), then collapses fully to the magnifier, and only then
//   does the path overflow — at which point it right-anchors so the current
//   folder stays visible and the start caves in under the fade.
// - The collapsed magnifier keeps the search field's lighter fill (addendum
//   §2), so it reads as the search control, not one more ghost button.
// - The collapsed magnifier (or Ctrl+F) opens search IN FLOW (addendum §2):
//   the bar grows over --motion-base and pushes the path left, never covers
//   it; it folds back on blur/Escape when empty. Instant with motion off.
// - The current folder's crumb is readable in every state: at least
//   CRUMB_FLOOR wide (or whole), ellipsized with a tooltip when cut. When
//   even the folded search (or the opened one, given way to 80 px) leaves it
//   less, the lowest-priority buttons move into the "…" (See more) button
//   (theme, refresh, inspector toggle, View/Sort — in that order); its menu
//   carries their actions. Nothing just vanishes.
// - Keys on a focused toolbar control act on that control, never the list.
// - Sibling sweep (spec §12, fixed-constant layout row): status bar,
//   inspector header, tab strip and the Home header at the narrowest window
//   and at 150 %.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, apiGet, SHOTS, windowShot } = require('./harness/app');

test.setTimeout(240_000);

const SEARCH_PREFERRED = 280;
const SEARCH_MIN = 120;      // addendum §2 ruling (was 180)
const CRUMB_FLOOR = 56;      // the current crumb's readable minimum (app.js TOOLBAR_CRUMB_FLOOR)
const INPUT_MIN = 40;        // a bar holding text still shows a usable input
const SEARCH_GIVE = 80;      // opened while collapsed, the bar gives way to this before buttons fold
const DEEP = ['Deep', 'Client-Projects', 'Northwind-Archive', 'Quarterly-Reports', 'Finance-Review',
  'Year-End-Closing', 'Supporting-Files', 'Scanned-Receipts', 'Final-Approved'];

const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

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
  // The search field's own fill, resolved the way the browser paints it.
  const probe = document.createElement('div');
  probe.style.background = 'var(--bg-raised)';
  document.body.appendChild(probe);
  const fieldFill = getComputedStyle(probe).backgroundColor;
  probe.remove();
  const swcs = getComputedStyle(sw);
  const foldable = [...tb.querySelectorAll(':scope > [data-fold]')];
  return {
    swBg: swcs.backgroundColor,
    swBorder: swcs.borderTopColor,
    fieldFill,
    folded: foldable.filter((el) => el.getClientRects().length === 0).map((el) => el.id || el.dataset.fold),
    foldable: foldable.length,
    moreShown: document.getElementById('btn-toolbar-more').getClientRects().length > 0,
    // The bar's own content ends inside it (the dropdown and the ruler hang
    // outside by design)…
    swContentR: Math.max(0, ...[...sw.children]
      .filter((c) => c.id !== 'search-dropdown' && c.id !== 'search-measure' && c.getClientRects().length)
      .map((c) => c.getBoundingClientRect().right)),
    // …and nothing covers a toolbar control: what is under each visible
    // button's centre is that button.
    overlapped: [...tb.querySelectorAll('.fp-icon-btn, #search-collapsed')]
      .filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
      .filter((b) => {
        const bb = b.getBoundingClientRect();
        const hit = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
        return !hit || hit.closest('button') !== b;
      })
      .map((b) => b.id || b.className),
    hInput: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--h-input')),
    curNatural: cur ? cur.getBoundingClientRect().width + (lab ? Math.max(0, lab.scrollWidth - lab.clientWidth) : 0) : 0,
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
  // The input: an empty bar shows its whole placeholder; one holding text or
  // chips still has a usable input beside them and the clear ×.
  const inputOk = (where) => {
    if (!s.inputShown) bad.push(`${where}: no input`);
    else if (!s.hasContent && s.inputW + 1 < s.placeholderW) bad.push(`${where}: placeholder cut: input ${s.inputW} < ${s.placeholderW}`);
    else if (s.hasContent && s.inputW < INPUT_MIN) bad.push(`${where}: input ${s.inputW} < ${INPUT_MIN}`);
  };
  if (s.search === 'full') {
    if (s.sw.w < SEARCH_MIN - 0.5) bad.push(`full search narrower than ${SEARCH_MIN}: ${s.sw.w}`);
    if (s.sw.w > SEARCH_PREFERRED + 0.5 && !s.hasContent) bad.push(`empty full search wider than ${SEARCH_PREFERRED}: ${s.sw.w}`);
    inputOk('full');
    if (s.magShown) bad.push('magnifier shown while full');
    if (s.folded.length) bad.push(`buttons folded while search is full: ${s.folded}`);
  } else if (!s.expanded) {
    if (!s.magShown) bad.push('collapsed without a magnifier');
    if (s.inputShown) bad.push('collapsed search still shows a partial input');
    // An --h-input square: the field's own height, so folding never snaps.
    if (s.sw.w > s.hInput + 0.5) bad.push(`collapsed search ${s.sw.w}px wide`);
    if (Math.abs(s.sw.h - s.hInput) > 0.5) bad.push(`collapsed search ${s.sw.h}px tall, not ${s.hInput}`);
    // It keeps the field's lighter fill and edge: it reads as the search
    // control, not one more ghost button (addendum §2).
    if (s.swBg !== s.fieldFill) bad.push(`collapsed magnifier lost the field fill: ${s.swBg} vs ${s.fieldFill}`);
    if (/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(s.swBorder)) bad.push('collapsed magnifier has no edge');
  } else {
    // Expanded from collapsed: in flow, beside the path — never over it.
    if (s.sw.x < s.wrap.r - 0.5) bad.push(`expanded search overlaps the path: ${s.sw.x} < ${s.wrap.r}`);
    if (s.magShown) bad.push('magnifier shown while expanded');
    if (s.sw.w < SEARCH_GIVE - 0.5 && s.folded.length < s.foldable) bad.push(`expanded search narrower than ${SEARCH_GIVE}: ${s.sw.w}`);
    if (s.sw.w >= SEARCH_MIN - 0.5) inputOk('expanded');
    else if (!s.inputShown || s.inputW < 24) bad.push(`expanded (given way): input ${s.inputW}`);
  }
  if (s.swContentR > s.sw.r + 0.5) bad.push(`bar content spills past its edge: ${s.swContentR} > ${s.sw.r}`);
  if (s.overlapped.length) bad.push(`toolbar controls covered: ${s.overlapped}`);
  // Buttons never vanish: anything folded lives in the "…" menu, and the
  // "…" shows only then.
  if (s.folded.length && !s.moreShown) bad.push(`folded ${s.folded} without the "…" button`);
  if (!s.folded.length && s.moreShown) bad.push('"…" shown with nothing folded');
  if (s.folded.length && s.folded.length < 2) bad.push('one button folded alone (the "…" takes its slot: no gain)');
  // The current folder is readable in every state: whole, or at least
  // CRUMB_FLOOR wide (an ellipsized name, never squeezed to nothing).
  if (s.cur && s.cur.w + 1 < Math.min(s.curNatural, CRUMB_FLOOR)) bad.push(`current crumb squeezed: ${s.cur.w} < ${Math.min(s.curNatural, CRUMB_FLOOR)}`);
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

    // A longer path (the sandbox root: the %TEMP% prefix, ~640 px of
    // crumbs): step 1 — the search gives up width, the path stays whole.
    // The root's crumbs are not a fixed width — the run's temp folder has a
    // random name (os.mkdtemp), and proportional glyphs make it a few px
    // wider or narrower each run — so the window width where this stage
    // shows is found by stepping down from one where the bar is surely at its
    // preferred width, not assumed to be 1400 (Task 11: 1400 was sometimes
    // already past it, collapsed).
    await open(page, root);
    let shrunkAt = null;
    for (let w = 1700; w >= 1100 && shrunkAt === null; w -= 10) {
      await setSize(app, page, w);
      s = await state(page);
      expect(invariants(s, `root ${w}`)).toEqual([]);
      if (w === 1700) expect(s.sw.w).toBeCloseTo(SEARCH_PREFERRED, 0);   // the start is above the band
      if (s.search === 'full' && s.sw.w < SEARCH_PREFERRED - 0.5) shrunkAt = w;
      else expect(s.search, `root ${w}: collapsed before shrinking`).toBe('full');
    }
    expect(shrunkAt).not.toBeNull();
    expect(s.of).toBe(false);
    await windowShot(app, page, 'toolbar-longer-path-search-shrunk');
    await setSize(app, page, 1400, 800);

    // The path changing (not the window) re-runs the layout: the deep path
    // collapses the search first, then caves in.
    await open(page, deepDir);
    s = await state(page);
    expect(invariants(s, '1400 deep')).toEqual([]);
    expect(s.search).toBe('collapsed');
    expect(s.of).toBe(true);

    // Sweep the window down and back up on the sandbox root, which passes
    // through every stage: the invariants hold at every width. (From 1700:
    // the root's width varies a little per run, see above.)
    await open(page, root);
    const offenders = [];
    const seen = new Set();
    for (const w of [1700, 1600, 1500, 1400, 1380, 1360, 1340, 1320, 1300, 1280, 1240, 1200, 1180, 1160, 1120, 1080, 1040, 980, 920, 860, 800]) {
      await setSize(app, page, w);
      s = await state(page);
      offenders.push(...invariants(s, `down ${w}`));
      seen.add(`${s.search}/${s.of}`);
    }
    // Up past 1400: the This PC root crumb (Stage 2D §8) leaves the fixture's
    // root path less than the 24px hysteresis short of re-expanding at 1400.
    for (const w of [840, 920, 1000, 1080, 1160, 1200, 1240, 1280, 1320, 1360, 1400, 1440, 1480, 1600, 1700]) {
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
    const { collapseAt, lastFull } = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const tb = document.getElementById('toolbar');
      let last = null;
      for (let sb = 240; sb <= 900; sb += 2) {
        document.documentElement.style.setProperty('--sidebar-w-screen', `${sb}px`);
        await raf();
        if (tb.dataset.search === 'collapsed') return { collapseAt: sb, lastFull: last };
        last = document.getElementById('search-wrap').getBoundingClientRect().width;
      }
      return { collapseAt: null, lastFull: last };
    });
    expect(collapseAt).not.toBeNull();
    // It used the room up to the end of the path before folding: the last
    // full width is the 120 minimum (within one 2 px step), not 180 (§2).
    expect(lastFull).toBeGreaterThanOrEqual(SEARCH_MIN - 0.5);
    expect(lastFull).toBeLessThan(SEARCH_MIN + 4);
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

test('narrowest bar: collapsed + overflowing, current folder visible; Ctrl+F / magnifier expand the bar in flow, pushing the path left (§6.2, addendum §2)', async () => {
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
    // The expanded bar is in flow: beside the path, which it pushed left —
    // the current folder ends where the bar begins and is still readable.
    const pushed = (st, label) => {
      expect(invariants(st, label)).toEqual([]);
      expect(st.expanded).toBe(true);
      expect(st.search).toBe('collapsed');                    // the mode itself does not change
      expect(st.inputShown).toBe(true);
      expect(st.sw.x).toBeGreaterThanOrEqual(st.wrap.r - 0.5); // search ∩ path = ∅
      expect(st.cur.r).toBeLessThanOrEqual(st.sw.x + 0.5);
      expect(st.cur.w + 1).toBeGreaterThanOrEqual(Math.min(st.curNatural, CRUMB_FLOOR));
    };

    // Ctrl+F (renderer-handled; there is no application menu).
    await page.locator('#list-scroll .fp-row').first().click();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-input')).toBeFocused();
    await twoFrames(page);
    s = await state(page);
    pushed(s, 'narrow Ctrl+F');
    expect(s.inputW + 1).toBeGreaterThanOrEqual(s.placeholderW);
    expect(await crumbRects()).not.toEqual(before);           // the path moved over
    await windowShot(app, page, 'toolbar-narrow-search-expanded');
    // The bar's own dropdown (filters incl. the This PC scope) is usable.
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
    await twoFrames(page);
    expect(await crumbRects()).toEqual(before);               // and the path comes back exactly
    expect(invariants(await state(page), 'narrow folded again')).toEqual([]);

    // The magnifier does the same, and a typed query keeps the bar open on blur.
    await page.locator('#search-collapsed').click();
    await expect(page.locator('#search-input')).toBeFocused();
    await twoFrames(page);
    pushed(await state(page), 'narrow magnifier');
    await page.keyboard.type('deep');
    await page.keyboard.press('Escape');                      // closes the dropdown; text keeps it open
    await page.evaluate(() => document.activeElement.blur());
    await twoFrames(page);
    await expect(page.locator('#search-wrap')).toHaveClass(/fp-search--expanded/);
    pushed(await state(page), 'narrow typed + blurred');
    await page.evaluate(() => clearSearch());
    await expect(page.locator('#search-wrap')).not.toHaveClass(/fp-search--expanded/);
    await expect(page.locator('#search-collapsed')).toBeVisible();
    await twoFrames(page);
    expect(await crumbRects()).toEqual(before);

    // An ACTIVE search on the collapsed bar: the bar carries its own clear ×
    // (the path's "Search in … ×" may be caved in beside it). One click ends
    // the search, brings the listing back and folds the bar.
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

test('collapsed and expanded at 1400/1100/900/800 px and 100/150 %: invariants hold, the path is pushed not covered; 280 px sidebar at 200 % keeps the current crumb readable (addendum §2)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const deepDir = [root, ...DEEP].join('\\');
    const offenders = [];
    // Returns what was folded into the "…" in each state it saw.
    const check = async (label, shotName) => {
      const folded = await state(page);
      offenders.push(...invariants(folded, `${label} folded`));
      if (folded.search !== 'collapsed') return { rest: folded.folded, open: [], back: folded.folded };
      if (shotName) await windowShot(app, page, `${shotName}-collapsed`);
      await page.evaluate(() => focusSearchInput({ keepDropdownClosed: true }));
      await twoFrames(page);
      const opened = await state(page);
      offenders.push(...invariants(opened, `${label} expanded`));
      if (!opened.expanded) offenders.push(`${label}: Ctrl+F did not expand`);
      if (shotName) await windowShot(app, page, `${shotName}-expanded`);
      // Text typed into the opened (possibly given-way) bar: icon, text and
      // the clear × all fit inside it; nothing spills onto the buttons.
      await page.evaluate(() => setSearchText('quarterly report draft'));
      await twoFrames(page);
      const typed = await state(page);
      offenders.push(...invariants(typed, `${label} expanded + text`));
      if (shotName) await windowShot(app, page, `${shotName}-typed`);
      await page.evaluate(() => setSearchText(''));
      await twoFrames(page);
      await page.evaluate(() => document.activeElement?.blur());
      await twoFrames(page);
      const back = await state(page);
      offenders.push(...invariants(back, `${label} folded again`));
      if (back.expanded) offenders.push(`${label}: did not fold back on blur`);
      // Per-mode fold counts: folding back restores the rest state exactly.
      if (back.folded.join() !== folded.folded.join()) offenders.push(`${label}: folded ${back.folded} after fold-back, ${folded.folded} before`);
      return { rest: folded.folded, open: opened.folded, back: back.folded };
    };
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    for (const z of [1, 1.5]) {
      await setZoom(app, page, z);
      for (const w of [1400, 1100, 900, 800]) {
        await setSize(app, page, w, 800);
        await open(page, deepDir);
        await check(`${w}px @${z}`, `toolbar-search-${w}-zoom${Math.round(z * 100)}`);
      }
    }
    // Inspector open. At the default 1200×800 nothing folds at 100 % or
    // 125 %, at rest or opened; at 150 % anything folded is in the "…" menu
    // (the invariants check that), never just gone.
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    for (const [w, z] of [[1200, 1], [1200, 1.25], [1200, 1.5], [1100, 1.5]]) {
      await setZoom(app, page, z);
      await setSize(app, page, w, 800);
      await open(page, deepDir);
      const seen = await check(`${w}px @${z} inspector open`, `toolbar-search-${w}-zoom${Math.round(z * 100)}-inspector`);
      if (w === 1200 && z < 1.5) {
        if (seen.rest.length || seen.open.length || seen.back.length) offenders.push(`1200 @${z} inspector open folded ${JSON.stringify(seen)}`);
      }
    }
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    // The pre-existing edge (Stage 2D Task 7 review): a saved 280 px sidebar,
    // a 900 px window and 200 % zoom left the current crumb 0 px wide.
    await setZoom(app, page, 1);
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '280px'));
    await setSize(app, page, 900, 700);
    await setZoom(app, page, 2);
    for (const dir of [deepDir, `${root}\\Views`]) {
      await open(page, dir);
      await check(`edge 900/280 @2 ${path.basename(dir)}`, dir === deepDir ? 'toolbar-edge-900-sb280-zoom200' : null);
    }
    // ...and with the sidebar at its 480 px maximum on the 800 px minimum window.
    await setZoom(app, page, 1);
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '480px'));
    await setSize(app, page, 800, 700);
    await open(page, deepDir);
    await check('edge 800/480', 'toolbar-edge-800-sb480');
    expect(offenders).toEqual([]);
  } finally {
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px')).catch(() => {});
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('expand/fold animates the bar width over --motion-base (ease-out) with motion on, instantly with it off; interruptible (addendum §2, §5.1)', async () => {
  const settled = (page) => page.waitForFunction(() => {
    const slot = document.getElementById('search-slot');
    return !document.getAnimations().some((a) => a.effect && a.effect.target
      && (a.effect.target === slot || slot.contains(a.effect.target)));
  });
  for (const motion of [true, false]) {
    const { page, app, errors } = await launchApp({ motion });
    try {
      const root = (await apiGet('/fs/list/root')).path;
      await setSize(app, page, 1100, 760);
      await page.evaluate(() => setInspectorOpen(false, { persist: false }));
      await open(page, [root, ...DEEP].join('\\'));
      expect((await state(page)).search).toBe('collapsed');
      const tokens = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { base: parseFloat(cs.getPropertyValue('--motion-base')), ease: cs.getPropertyValue('--ease-out').trim() };
      });
      // Expand: the state is there at once (focus, class), the width eases.
      const p0 = await page.evaluate(() => {
        document.getElementById('search-collapsed').click();
        const slot = document.getElementById('search-slot');
        return {
          focused: document.activeElement?.id === 'search-input',
          expanded: document.getElementById('search-wrap').classList.contains('fp-search--expanded'),
          w: slot.getBoundingClientRect().width,
          anims: document.getAnimations()
            .filter((a) => a.effect && a.effect.target === slot)
            .map((a) => ({ d: a.effect.getComputedTiming().duration, e: a.effect.getTiming().easing })),
        };
      });
      expect(p0.focused).toBe(true);
      expect(p0.expanded).toBe(true);
      if (motion) {
        expect(p0.anims.length).toBe(1);
        expect(p0.anims[0].d).toBeGreaterThan(0);
        expect(p0.anims[0].d).toBeLessThanOrEqual(tokens.base);
        const norm = (e) => e.replace(/\s/g, '').replace(/(^|[^\d])0\./g, '$1.');
        expect(norm(p0.anims[0].e)).toBe(norm(tokens.ease));
      } else {
        expect(p0.anims).toEqual([]);
        expect(p0.w).toBeGreaterThanOrEqual(SEARCH_MIN - 0.5);   // already at its final width
      }
      await settled(page);
      const open1 = await state(page);
      expect(invariants(open1, `motion ${motion} expanded`)).toEqual([]);
      const fullW = open1.sw.w;
      // Fold (the dropdown closed first, as a click elsewhere does): instant
      // state, eased width back to the --h-input magnifier.
      await page.evaluate(() => { closeSearchDropdown(); document.activeElement.blur(); });
      await settled(page);
      let s = await state(page);
      expect(invariants(s, `motion ${motion} folded`)).toEqual([]);
      expect(s.sw.w).toBeLessThanOrEqual(s.hInput + 0.5);
      // Interrupted: expand and blur in the same task, then expand and blur
      // again one frame in — it ends folded, never at a half width.
      await page.evaluate(() => {
        document.getElementById('search-collapsed').click();
        closeSearchDropdown();
        document.activeElement.blur();
      });
      await page.evaluate(() => document.getElementById('search-collapsed').click());
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      await page.evaluate(() => { closeSearchDropdown(); document.activeElement.blur(); });
      await settled(page);
      s = await state(page);
      expect(invariants(s, `motion ${motion} interrupted`)).toEqual([]);
      expect(s.expanded).toBe(false);
      expect(s.sw.w).toBeLessThanOrEqual(s.hInput + 0.5);
      expect(await page.evaluate(() => document.getElementById('search-wrap').className)).not.toMatch(/fp-search--(folding|sizing)/);
      // ...and expand-and-stay lands on the same width as before. The ease
      // never feeds the layout back into itself: a handful of passes (the
      // click, the observers, the ease's end), not one per frame.
      await page.evaluate(() => {
        window.__tbRuns = 0;
        window.__tbOrig = window.layoutToolbar;
        window.layoutToolbar = function (...a) { window.__tbRuns++; return window.__tbOrig.apply(this, a); };
        document.getElementById('search-collapsed').click();
      });
      await settled(page);
      await twoFrames(page);
      const runs = await page.evaluate(() => { window.layoutToolbar = window.__tbOrig; return window.__tbRuns; });
      expect(runs).toBeLessThanOrEqual(4);
      s = await state(page);
      expect(Math.abs(s.sw.w - fullW)).toBeLessThanOrEqual(1);
      await page.evaluate(() => { closeSearchDropdown(); document.activeElement.blur(); });
      await settled(page);
    } finally {
      await app.close();
    }
    expect(errors).toEqual([]);
  }
});

test('folded buttons live in the "…" (See more) menu: icons, View/Sort flyouts, the inspector check, every action works (addendum §2, fix round 1)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const deepDir = [root, ...DEEP].join('\\');
    await page.evaluate(() => {
      setInspectorOpen(false, { persist: false });
      document.documentElement.style.setProperty('--sidebar-w-screen', '480px');
    });
    await setSize(app, page, 800, 700);
    await open(page, deepDir);
    // Opened in this cramped bar, everything folds (the bar takes the row).
    await page.evaluate(() => focusSearchInput({ keepDropdownClosed: true }));
    await twoFrames(page);
    let s = await state(page);
    expect(invariants(s, 'cramped opened')).toEqual([]);
    expect(s.folded.length).toBe(s.foldable);
    await page.evaluate(() => { closeSearchDropdown(); document.activeElement.blur(); });
    await twoFrames(page);
    s = await state(page);
    expect(invariants(s, 'cramped rest')).toEqual([]);
    expect(s.folded.length).toBeGreaterThanOrEqual(2);
    expect(s.moreShown).toBe(true);
    // The "…" sits where the first folded button was: the end of the row.
    expect(await page.evaluate(() => {
      const shown = [...document.getElementById('toolbar').children].filter((c) => c.getClientRects().length);
      return shown[shown.length - 1].id;
    })).toBe('btn-toolbar-more');
    await windowShot(app, page, 'toolbar-more-button');

    const openMore = async () => {
      await page.locator('#btn-toolbar-more').click();
      await expect(page.locator('#context-menu')).toBeVisible();
    };
    const labels = () => page.evaluate(() => [...document.querySelectorAll('#context-menu .fp-context-menu__item')]
      .map((b) => ({ label: b.dataset.menuLabel, icon: !!b.querySelector('svg:not(.fp-context-menu__chevron)'), checked: !!b.querySelector('.fp-context-menu__check svg') })));
    await openMore();
    const items = await labels();
    const byFold = { 'btn-theme': 'Toggle theme', 'btn-refresh': 'Refresh', 'btn-inspector-toggle': 'Inspector', 'toolbar-view-sort': 'View' };
    for (const id of s.folded) expect(items.map((i) => i.label)).toContain(byFold[id]);
    expect(items.length).toBe(s.folded.length + (s.folded.includes('toolbar-view-sort') ? 1 : 0));
    for (const it of items) expect(it.icon, `${it.label} has an icon`).toBe(true);
    await windowShot(app, page, 'toolbar-more-menu');
    await page.keyboard.press('Escape');
    await expect(page.locator('#context-menu')).toBeHidden();

    // Fold everything (the sidebar wider still is not possible: open the bar
    // with text so it stays open) — then every entry is there to try.
    await page.locator('#search-collapsed').click();
    await page.keyboard.type('zz');
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement.blur());
    await twoFrames(page);
    s = await state(page);
    expect(s.folded.length).toBe(s.foldable);
    await openMore();
    const all = await labels();
    expect(all.map((i) => i.label)).toEqual(['Refresh', 'View', 'Sort', 'Inspector', 'Toggle theme']);
    expect(all.find((i) => i.label === 'Inspector').checked).toBe(false);   // its on/off state
    // View: the same flyout the View button opens; picking Details applies it.
    await page.locator('#context-menu [data-menu-label="View"]').click();
    const flyout = page.locator('.fp-context-menu--flyout');
    await expect(flyout).toBeVisible();
    await expect(flyout.locator('[data-menu-label="Details"]')).toBeVisible();
    await expect(flyout.locator('[data-menu-label="Show hidden files"]')).toBeVisible();
    await flyout.locator('[data-menu-label="List"]').click();
    await expect.poll(() => page.evaluate(() => viewMenuKey())).toBe('list');
    // Sort: the Sort button's flyout.
    await openMore();
    await page.locator('#context-menu [data-menu-label="Sort"]').click();
    await expect(page.locator('.fp-context-menu--flyout [data-menu-label="Size"]')).toBeVisible();
    await page.locator('.fp-context-menu--flyout [data-menu-label="Size"]').click();
    await expect.poll(() => page.evaluate(() => browserState.sort.key)).toBe('size');
    // Inspector: toggles, and the menu shows it on next time.
    await openMore();
    await page.locator('#context-menu [data-menu-label="Inspector"]').click();
    await expect.poll(() => page.evaluate(() => document.getElementById('inspector').classList.contains('inspector--open'))).toBe(true);
    await twoFrames(page);
    if (await page.locator('#btn-toolbar-more').isVisible() && (await state(page)).folded.includes('btn-inspector-toggle')) {
      await openMore();
      expect((await labels()).find((i) => i.label === 'Inspector').checked).toBe(true);
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await twoFrames(page);
    // Theme: toggles the theme.
    const theme0 = await page.evaluate(() => document.documentElement.dataset.theme);
    await openMore();
    await page.locator('#context-menu [data-menu-label="Toggle theme"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(theme0);
    await page.evaluate(() => toggleTheme());
    // Refresh: re-lists the folder.
    const renders = await page.evaluate(() => window.__fpRenderCount || 0);
    await openMore();
    await page.locator('#context-menu [data-menu-label="Refresh"]').click();
    await expect.poll(() => page.evaluate(() => window.__fpLoadPending === 0 && (window.__fpRenderCount || 0) > 0)).toBe(true);
    expect(await page.evaluate(() => window.__fpLoadPending)).toBe(0);
    void renders;
    await page.evaluate(() => clearSearch());
  } finally {
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px')).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('fold counts are kept per mode: folding the bar back restores the rest state, even inside the hysteresis band (fix round 1)', async () => {
  const { page, app, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await setSize(app, page, 800, 700);
    await open(page, [root, ...DEEP].join('\\'));
    // Narrow the bar from the sidebar until the free room sits in the band
    // [need, need + 24): no fold at rest, but one that would never come back
    // if the opened bar's fold count leaked into the rest state.
    const band = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let sb = 240; sb <= 480; sb += 2) {
        document.documentElement.style.setProperty('--sidebar-w-screen', `${sb}px`);
        await raf();
        const l = window.__fpToolbarLayout;
        const need = l.floor + l.collapsedW;
        if (document.getElementById('toolbar').dataset.search === 'collapsed' && l.free >= need && l.free < need + 24) {
          return { sb, free: l.free, need };
        }
      }
      return null;
    });
    expect(band).not.toBeNull();
    const before = await state(page);
    expect(invariants(before, 'band rest')).toEqual([]);
    expect(before.folded).toEqual([]);
    await page.evaluate(() => focusSearchInput({ keepDropdownClosed: true }));
    await twoFrames(page);
    const opened = await state(page);
    expect(invariants(opened, 'band opened')).toEqual([]);
    expect(before.folded).toEqual([]);
    expect(opened.folded.length).toBeGreaterThan(0);          // the case under test: opening folds
    await page.evaluate(() => document.activeElement.blur());
    await twoFrames(page);
    const after = await state(page);
    expect(invariants(after, 'band folded back')).toEqual([]);
    expect(after.folded).toEqual(before.folded);
  } finally {
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px')).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('folding the bar never clips its open dropdown: the dropdown closes first (fix round 1)', async () => {
  const { page, app, errors } = await launchApp({ motion: true });
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await setSize(app, page, 1100, 760);
    await open(page, [root, ...DEEP].join('\\'));
    expect((await state(page)).search).toBe('collapsed');
    await page.locator('#search-collapsed').click();
    await expect(page.locator('#search-dropdown')).toBeVisible();
    // A clear that folds the bar while its dropdown is open (the in-bar ×
    // takes focus from the input, whose blur leaves the dropdown alone).
    await page.keyboard.type('q');
    await expect(page.locator('#search-dropdown')).toBeVisible();
    const atFold = await page.evaluate(() => {
      document.getElementById('search-clear-inline').focus();
      clearSearch();
      const wrap = document.getElementById('search-wrap');
      return { folding: wrap.classList.contains('fp-search--folding'), ddOpen: !document.getElementById('search-dropdown').hidden, expanded: wrap.classList.contains('fp-search--expanded') };
    });
    expect(atFold.expanded).toBe(false);
    expect(atFold.ddOpen).toBe(false);
    await page.waitForFunction(() => !document.getElementById('search-slot').getAnimations().length);
    await expect(page.locator('#search-collapsed')).toBeVisible();
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('motion on, cramped bar: while the opened bar eases back the "…" holds its buttons and nothing is covered; then the rest-mode buttons return (fix round 3)', async () => {
  const { page, app, errors } = await launchApp({ motion: true });
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await setSize(app, page, 800, 700);
    await open(page, [root, ...DEEP].join('\\'));
    // A width where nothing folds at rest but opening the bar folds buttons.
    const found = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let sb = 240; sb <= 480; sb += 2) {
        document.documentElement.style.setProperty('--sidebar-w-screen', `${sb}px`);
        await raf();
        const l = window.__fpToolbarLayout;
        const restFolds = document.querySelectorAll('#toolbar > [data-fold].is-folded').length;
        if (document.getElementById('toolbar').dataset.search === 'collapsed' && restFolds === 0
          && l.free < l.floor + 80) return sb;
      }
      return null;
    });
    expect(found).not.toBeNull();
    await page.waitForFunction(() => !document.getAnimations().length);
    const before = await state(page);
    expect(invariants(before, 'rest')).toEqual([]);
    await page.locator('#search-collapsed').click();
    await page.waitForFunction(() => !document.getElementById('search-slot').getAnimations().length);
    const opened = await state(page);
    expect(invariants(opened, 'opened')).toEqual([]);
    expect(opened.folded.length).toBeGreaterThan(0);          // the case under test
    // Fold back, sampling every frame of the ease.
    const frames = await page.evaluate(async () => {
      const slot = document.getElementById('search-slot');
      const tb = document.getElementById('toolbar');
      closeSearchDropdown();
      document.activeElement.blur();
      const out = [];
      while (slot.getAnimations().length) {
        const covered = [...tb.querySelectorAll('.fp-icon-btn, #search-collapsed')]
          .filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
          .filter((b) => {
            const bb = b.getBoundingClientRect();
            const hit = document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
            return !hit || hit.closest('button') !== b;
          }).map((b) => b.id || b.className);
        out.push({
          w: Math.round(slot.getBoundingClientRect().width),
          more: document.getElementById('btn-toolbar-more').getClientRects().length > 0,
          covered,
          overflow: tb.scrollWidth > tb.clientWidth + 1,
          folded: [...tb.querySelectorAll(':scope > [data-fold]')].filter((el) => !el.getClientRects().length).map((el) => el.id),
        });
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    expect(frames.length).toBeGreaterThan(0);                 // the ease ran and was sampled
    for (const [i, f] of frames.entries()) {
      expect(f.more, `frame ${i} (${f.w}px): "…" gone mid-ease`).toBe(true);
      expect(f.covered, `frame ${i} (${f.w}px)`).toEqual([]);
      expect(f.overflow, `frame ${i} (${f.w}px): row overflows`).toBe(false);
      // The opened bar's folds are held until it is the magnifier again.
      expect(f.folded, `frame ${i} (${f.w}px): buttons came back mid-ease`).toEqual(opened.folded);
    }
    // Settled: the rest-mode buttons are back, exactly as before opening.
    await page.waitForFunction(() => !document.getAnimations().length);
    await twoFrames(page);
    const after = await state(page);
    expect(invariants(after, 'folded back')).toEqual([]);
    expect(after.folded).toEqual(before.folded);
    expect(after.moreShown).toBe(before.moreShown);
    expect(await page.evaluate(() => window.__fpToolbarLayout.open)).toBe(0);
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

test('a screen-name crumb (Settings) that has to ellipsize settles: no layout loop, ellipsis + title (Task 11 flake hunt, §6.2)', async () => {
  // Found by the renderer.log error gate (pass 2 #106): at 800 px and 150 %
  // with the inspector open, Settings' plain-text crumb had no label span, so
  // layoutToolbar() could not see what the ellipsis hid — it flipped
  // .is-tight on and off every frame ("ResizeObserver loop completed with
  // undelivered notifications", hundreds a second).
  const { page, app, errors } = await launchApp();
  try {
    await setSize(app, page, 800, 600);
    await setZoom(app, page, 1.5);
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await page.evaluate(() => switchScreen('settings'));
    await twoFrames(page);
    const idleCheck = () => page.evaluate(async () => {
      let runs = 0;
      let loops = 0;
      const orig = window.layoutToolbar;
      window.layoutToolbar = function (...a) { runs++; return orig.apply(this, a); };
      const onErr = (e) => { if (/ResizeObserver loop/.test(e.message)) loops++; };
      window.addEventListener('error', onErr);
      for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
      window.layoutToolbar = orig;
      window.removeEventListener('error', onErr);
      return { runs, loops };
    });
    // The original configuration (800 × 600, 150 %, inspector open) settles.
    expect(await idleCheck()).toEqual({ runs: 0, loops: 0 });
    expect(invariants(await state(page), 'settings 800 @1.5 inspector open')).toEqual([]);
    // The current crumb now keeps a readable floor (addendum §2: buttons fold
    // before it goes below it), so where it is cut-but-readable depends on
    // the run's fonts: widen the sidebar until it is (inspector closed, so
    // the sidebar is what takes the room).
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    const cutAt = await page.evaluate(async () => {
      const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let sb = 240; sb <= 480; sb += 2) {
        document.documentElement.style.setProperty('--sidebar-w-screen', `${sb}px`);
        await raf();
        const lab = document.querySelector('#breadcrumb .fp-breadcrumb__crumb--current .fp-breadcrumb__label');
        if (lab && lab.scrollWidth > lab.clientWidth + 1) return sb;
      }
      return null;
    });
    expect(cutAt).not.toBeNull();
    await twoFrames(page);
    const idle = await page.evaluate(async () => {
      let runs = 0;
      let loops = 0;
      const orig = window.layoutToolbar;
      window.layoutToolbar = function (...a) { runs++; return orig.apply(this, a); };
      const onErr = (e) => { if (/ResizeObserver loop/.test(e.message)) loops++; };
      window.addEventListener('error', onErr);
      for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
      window.layoutToolbar = orig;
      window.removeEventListener('error', onErr);
      return { runs, loops };
    });
    expect(idle).toEqual({ runs: 0, loops: 0 });
    const s = await state(page);
    expect(invariants(s, 'settings 800 @1.5')).toEqual([]);
    expect(s.curTruncated).toBe(true);   // the case under test: the crumb is cut…
    expect(s.curEllipsis).toBe(true);    // …with an ellipsis…
    expect(s.curTitle).toBe('Settings'); // …and the full name as its tooltip
  } finally {
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '240px')).catch(() => {});
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
    // A navigation Enter starts its load synchronously in the key
    // handler, so once no load is pending it has landed (or none started).
    await page.keyboard.press('Enter');
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
      // The "+" sits after the scrolling strip (Task 8 Q4): always on screen
      // and hit where it is drawn, however far the strip is scrolled.
      const plus = await page.evaluate(() => {
        const strip = document.getElementById('tabbar');
        strip.scrollLeft = 0;
        const btn = document.getElementById('btn-new-tab');
        const b = btn.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { inside: !strip.contains(btn) && b.right <= innerWidth && !!hit && (hit === btn || btn.contains(hit)) };
      });
      if (!plus.inside) offenders.push(`@${z}: + button not on screen beside the tab strip`);
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
