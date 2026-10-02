// frontend/test/stage2d-thispc.spec.js
// Stage 2D Task 8 (spec §8): "This PC" opens a page of drive cards — the drive
// icon, its full name ("Label (C:)"), a usage bar and "X free of Y" — in the
// current tab, under the sentinel path `thispc:`, which is in history, labels
// the tab "This PC" and is the breadcrumb root. Plus the §12 sweep for the
// "navigation target ≠ label" class: every sidebar item and the breadcrumb
// root land where their label says.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp, apiGet, API, apiHeaders, SHOTS, expectNoErrors } = require('./harness/app');

test.setTimeout(240_000);

/** The whole window as the user sees it, with Mica flattened (its regions are
 * transparent in a capture). Same helper as stage2d-views.spec.js. */
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
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function ctrlWheel(page, dy) {
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, dy);
  await page.keyboard.up('Control');
}

const settled = (page) => page.waitForFunction(() => window.__fpLoadPending === 0);
const crumbCurrent = (page) => page.locator('#breadcrumb .fp-breadcrumb__crumb--current');

/** Where the active tab is, as the user can read it: tab label, current crumb
 * text and path, and which of the two views is showing. */
const location = (page) => page.evaluate(() => ({
  path: activeTab().path,
  label: activeTab().label,
  tabText: document.querySelector('.fp-tab.fp-tab--active .fp-tab__label')?.textContent,
  crumb: document.querySelector('#breadcrumb .fp-breadcrumb__crumb--current')?.textContent.trim(),
  crumbPath: document.querySelector('#breadcrumb .fp-breadcrumb__crumb--current')?.dataset.path,
  thispc: !!document.getElementById('thispc-view')?.getClientRects().length,
  list: !!document.getElementById('list-scroll')?.getClientRects().length,
}));

test('This PC: drive cards with icon, name, usage bar and free-of-total; history, refresh, keyboard, menus, layouts', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => applyTheme('dark'));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const root = (await apiGet('/fs/list/root')).path;
    const drives = await apiGet('/drives');
    expect(drives.length).toBeGreaterThan(0);

    // ── The sidebar's This PC header opens the page, not the sandbox ───────
    await page.click('[data-action="thispc-open"]');
    await expect(page.locator('#thispc-view')).toBeVisible();
    await expect(page.locator('#list-scroll')).toBeHidden();
    await expect(page.locator('#list-head')).toBeHidden();
    await expect(page.locator('#thispc-view .thispc-view__heading')).toHaveText('Devices and drives');
    const cards = page.locator('#thispc-view .fp-drive-card');
    await expect(cards).toHaveCount(drives.length);
    const c = cards.first();
    await expect(c.locator('.fp-drive-card__name')).toHaveText(/\([A-Z]:\)$/);
    await expect(c.locator('.fp-drive-card__free')).toHaveText(/free of/);
    const bar = await c.locator('.fp-drive-card__bar-fill').evaluate((el) => parseFloat(el.style.width));
    expect(bar).toBeGreaterThan(0);
    expect(await page.evaluate(() => activeTab().label)).toBe('This PC');
    expect(await page.evaluate(() => activeTab().path)).toBe('thispc:');
    await expect(crumbCurrent(page)).toHaveText('This PC');
    // The names are Explorer's, from the shared formatter the sidebar uses.
    const names = await page.evaluate(() => window.__fpDrives.map(driveDisplayName));
    await expect(cards.locator('.fp-drive-card__name')).toHaveText(names);
    await expect(page.locator('#sb-drives .fp-sidebar__item__label')).toHaveText(names);
    // The card's free text and bar share the sidebar's numbers (one model).
    const first = drives[0];
    const freeText = await page.evaluate((d) => driveFreeText(d), first);
    expect(freeText).toMatch(/^\d+(\.\d)? (B|KB|MB|GB|TB) free of \d+(\.\d)? (B|KB|MB|GB|TB)$/);
    await expect(c.locator('.fp-drive-card__free')).toHaveText(freeText);
    // Card icons are the drive glyph in FilePlus mode.
    expect(await c.locator('.fp-drive-card__icon use').getAttribute('href')).toBe('#fp-drive');
    await page.waitForTimeout(300);
    await windowShot(app, page, 'thispc');

    // ── Null sizes (a disconnected network drive) and a nearly full drive ──
    const edge = await page.evaluate(() => {
      const offline = { letter: 'Z:', mount: 'Z:\\', label: '', kind: 'network', fs: '', total_bytes: null, free_bytes: null, used_bytes: null };
      const full = { letter: 'Y:', mount: 'Y:\\', label: 'Backup', kind: 'removable', fs: 'exFAT', total_bytes: 1000 * 1073741824, free_bytes: 50 * 1073741824, used_bytes: 950 * 1073741824 };
      const t = document.createElement('template');
      t.innerHTML = driveUsageMarkup(offline) + driveUsageMarkup(full);
      return {
        offlineName: driveDisplayName(offline),
        offlineFree: driveFreeText(offline),
        offlineMarkup: driveUsageMarkup(offline),
        sidebar: renderDriveItem(offline),
        fullName: driveDisplayName(full),
        fullDanger: !!t.content.querySelectorAll('.fp-drive-card__bar-fill--full').length,
        offlineWidth: t.content.querySelector('.fp-drive-card__bar-fill').style.width,
        fullFree: driveFreeText(full),
      };
    });
    expect(edge.offlineName).toBe('Network Drive (Z:)');
    expect(edge.offlineFree).toBe('Unavailable');
    expect(edge.offlineWidth).toBe('0%');
    for (const s of [edge.offlineMarkup, edge.sidebar]) expect(s).not.toMatch(/NaN|undefined|null/);
    expect(edge.fullName).toBe('Backup (Y:)');
    expect(edge.fullDanger).toBe(true);
    expect(edge.fullFree).toBe('50.0 GB free of 1000.0 GB');

    // ── Click selects, Enter opens, Back returns, Alt+Up from a root ───────
    await c.click();
    await expect(c).toHaveClass(/fp-drive-card--selected/);
    await c.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#list-scroll')).toBeVisible();      // drive opened
    await expect(page.locator('#thispc-view')).toBeHidden();
    await settled(page);
    expect(await page.evaluate(() => activeTab().path)).toBe(first.mount);
    // The drive root's tab label is its full name, like its crumb.
    expect(await page.evaluate(() => activeTab().label)).toBe(names[0]);
    // The breadcrumb root is This PC, then the drive.
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb').first()).toHaveAttribute('aria-label', 'This PC');
    await page.click('#btn-back');
    await expect(page.locator('#thispc-view')).toBeVisible();      // in history
    await expect(page.locator('#list-scroll')).toBeHidden();
    expect(await page.evaluate(() => activeTab().label)).toBe('This PC');
    await page.click('#btn-forward');
    await expect(page.locator('#list-scroll')).toBeVisible();
    await settled(page);
    await expect(page.locator('#btn-up')).toBeEnabled();           // a drive root has somewhere to go up to
    await page.locator('#list-scroll').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('#thispc-view')).toBeVisible();
    expect(await page.evaluate(() => activeTab().path)).toBe('thispc:');
    await expect(page.locator('#btn-up')).toBeDisabled();
    // The selection came back with the page.
    await expect(cards.first()).toHaveClass(/fp-drive-card--selected/);

    // ── Ctrl+R re-reads the drives in place, no reload, no error ───────────
    const fetches = await page.evaluate(() => {
      window.__drivesFetches = 0;
      const orig = API.get;
      API.get = function (route, ...rest) { if (route === '/drives') window.__drivesFetches++; return orig.call(this, route, ...rest); };
      return 0;
    });
    const nodeBefore = await page.evaluate(() => { const n = document.querySelector('#thispc-view .fp-drive-card'); n.__keep = 1; return true; });
    await page.keyboard.press('Control+r');
    await page.waitForFunction(() => window.__drivesFetches >= 1 && window.__fpLoadPending === 0);
    await expect(cards).toHaveCount(drives.length);
    expect(await page.evaluate(() => document.querySelector('#thispc-view .fp-drive-card').__keep)).toBe(1); // patched, not rebuilt
    await expect(cards.first()).toHaveClass(/fp-drive-card--selected/);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(fetches).toBe(0);
    expect(nodeBefore).toBe(true);

    // ── Arrow keys move the selection between cards ────────────────────────
    if (drives.length > 1) {
      await cards.first().click();
      await page.keyboard.press('ArrowRight');
      await expect(cards.nth(1)).toHaveClass(/fp-drive-card--selected/);
      await expect(cards.nth(1)).toBeFocused();
      await page.keyboard.press('Home');
      await expect(cards.first()).toHaveClass(/fp-drive-card--selected/);
    }

    // ── Context menu: Open, Open in new tab, Properties ─────────────────────
    await cards.first().click({ button: 'right' });
    const menu = page.locator('#context-menu');
    await expect(menu).toBeVisible();
    await expect(menu.locator('button[data-menu-label="Open"]')).toHaveCount(1);
    await expect(menu.locator('button').filter({ hasText: 'Open in new tab' })).toHaveCount(1);
    await expect(menu.locator('button').filter({ hasText: 'Properties' })).toHaveCount(1);
    await expect(menu.locator('button').filter({ hasText: /New folder|Paste/ })).toHaveCount(0);
    const tabsBefore = await page.locator('.fp-tab').count();
    await menu.locator('button').filter({ hasText: 'Open in new tab' }).click();
    await expect(page.locator('.fp-tab')).toHaveCount(tabsBefore + 1);
    await settled(page);
    expect(await page.evaluate(() => activeTab().path)).toBe(first.mount);
    await page.keyboard.press('Control+w');
    await expect(page.locator('.fp-tab')).toHaveCount(tabsBefore);
    await expect(page.locator('#thispc-view')).toBeVisible();
    // The empty space of the page has its own menu: no New folder / Paste
    // into a "folder" that is not one.
    const viewBox = await page.locator('#thispc-view').boundingBox();
    await page.mouse.click(viewBox.x + viewBox.width - 12, viewBox.y + viewBox.height - 12, { button: 'right' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('button').filter({ hasText: /New folder|New file|Paste/ })).toHaveCount(0);
    await expect(menu.locator('button').filter({ hasText: 'Refresh' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Ctrl+V / Delete / F2 on the page act on nothing (no request for "thispc:").
    await cards.first().click();
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Delete');
    await page.keyboard.press('F2');

    // ── Ctrl+wheel: tiles <-> a details-style list, never the folder ladder ─
    const ladderBefore = await page.evaluate(() => [browserState.view, browserState.iconSize]);
    const grid = page.locator('#thispc-drives');
    await expect(grid).toHaveAttribute('data-layout', 'tiles');
    await page.mouse.move(viewBox.x + viewBox.width / 2, viewBox.y + viewBox.height - 20);
    await ctrlWheel(page, 100);
    await expect(grid).toHaveAttribute('data-layout', 'details');
    await expect(cards).toHaveCount(drives.length);
    await expect(cards.first().locator('.fp-drive-card__free')).toHaveText(freeText);
    await windowShot(app, page, 'thispc-details');
    await ctrlWheel(page, 100);                                     // already the smaller end: stays
    await expect(grid).toHaveAttribute('data-layout', 'details');
    await ctrlWheel(page, -100);
    await expect(grid).toHaveAttribute('data-layout', 'tiles');
    expect(await page.evaluate(() => [browserState.view, browserState.iconSize])).toEqual(ladderBefore);
    // The View menu names the layout, and choosing Details sets it.
    await page.click('#btn-view-menu');
    await expect(menu.locator('button[data-action="view-tiles"] .fp-context-menu__check svg')).toHaveCount(1);
    await expect(menu.locator('button[data-action^="view-"] .fp-context-menu__check svg')).toHaveCount(1);
    await menu.locator('button[data-action="view-details"]').click();
    await expect(grid).toHaveAttribute('data-layout', 'details');
    await page.click('#btn-view-menu');
    await menu.locator('button[data-action="view-large"]').click();
    await expect(grid).toHaveAttribute('data-layout', 'tiles');
    expect(await page.evaluate(() => [browserState.view, browserState.iconSize])).toEqual(ladderBefore);

    // ── Tabs: a folder tab and a This PC tab never show each other's view ──
    const thisPcTab = await page.evaluate(() => tabs.activeId);
    await page.keyboard.press('Control+t');
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen`);
    await settled(page);
    await expect(page.locator('#list-scroll')).toBeVisible();
    await expect(page.locator('#thispc-view')).toBeHidden();
    const folderTab = await page.evaluate(() => tabs.activeId);
    const rowCount = await page.locator('#list-scroll > .fp-row').count();
    expect(rowCount).toBeGreaterThan(0);
    await page.locator(`.fp-tab[data-tab-id="${thisPcTab}"]`).click();
    const onThisPc = await location(page);
    expect(onThisPc).toMatchObject({ label: 'This PC', crumb: 'This PC', thispc: true, list: false });
    await expect(cards).toHaveCount(drives.length);
    await page.locator(`.fp-tab[data-tab-id="${folderTab}"]`).click();
    const onFolder = await location(page);
    expect(onFolder).toMatchObject({ label: '_gen', crumb: '_gen', thispc: false, list: true });
    await expect(page.locator('#list-scroll > .fp-row')).toHaveCount(rowCount);
    await page.keyboard.press('Control+w');
    await expect(page.locator('#thispc-view')).toBeVisible();

    // ── Search from This PC searches This PC (the index), never "thispc:" ──
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      input.value = 'doc-0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => browserState.mode === 'search' && window.__fpLoadPending === 0, null, { timeout: 8000 });
    await expect(page.locator('#thispc-view')).toBeHidden();
    await expect(page.locator('#breadcrumb')).toContainText('Search in This PC');
    await page.evaluate(() => exitSearchResults());
    await expect(page.locator('#thispc-view')).toBeVisible();
    await expect(cards).toHaveCount(drives.length);

    // ── Light theme, then narrow + zoomed: nothing overflows sideways ──────
    await page.evaluate(() => applyTheme('light'));
    await page.waitForTimeout(200);
    await windowShot(app, page, 'thispc-light');
    await page.evaluate(() => applyTheme('dark'));
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(700, 600); });
    await setZoom(app, page, 1.5);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => {
      const v = document.getElementById('thispc-view');
      const vr = v.getBoundingClientRect();
      const cardsOut = [...v.querySelectorAll('.fp-drive-card')].filter((el) => el.getBoundingClientRect().right > vr.right + 1).length;
      const wide = [...v.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > vr.right + 1)
        .map((el) => `${el.className}:${Math.round(el.getBoundingClientRect().width)}`).slice(0, 5);
      return { scroll: v.scrollWidth - v.clientWidth, cardsOut, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, width: v.clientWidth, wide };
    });
    await windowShot(app, page, 'thispc-narrow');
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(1);
    expect(overflow.cardsOut).toBe(0);
    expect(overflow.doc).toBeLessThanOrEqual(1);
    await setZoom(app, page, 1);
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 800); });
  } finally {
    await fetch(`${API}/config/ui.thispc_view`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
  expectNoErrors(errors);
});

test('This PC in Windows-icon mode: every card carries the shell drive icon', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    await page.click('[data-action="thispc-open"]');
    await expect(page.locator('#thispc-view')).toBeVisible();
    const icons = page.locator('#thispc-view .fp-drive-card__icon img[data-win-icon]');
    const drives = await apiGet('/drives');
    await expect(icons).toHaveCount(drives.length);
    await expect(icons.first()).toHaveAttribute('src', /^data:image\/png/, { timeout: 8000 });
    expect(await page.locator('#thispc-view .fp-drive-card__icon svg').count()).toBe(0);
    // The tab and the breadcrumb root never ask the shell about "thispc:".
    expect(await page.locator('[data-win-icon="thispc:"]').count()).toBe(0);
    await page.waitForTimeout(300);
    await windowShot(app, page, 'thispc-windows-icons');
  } finally {
    await fetch(`${API}/config/ui.icon_source`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
  expectNoErrors(errors);
});

test('sweep (§12): every sidebar item and the breadcrumb root land where their label says', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.waitForFunction(() => document.querySelectorAll('#sb-drives .fp-sidebar__item').length > 0);

    // Every path-bound sidebar item: Quick Access folders, pins, drives.
    const items = await page.evaluate(() => [...document.querySelectorAll('#sidebar .fp-sidebar__item[data-action="navigate-path"]')]
      .map((el) => el.dataset.path));
    expect(items.length).toBeGreaterThan(0);
    for (const p of items) {
      await page.locator(`#sidebar .fp-sidebar__item[data-action="navigate-path"][data-path="${p.replace(/\\/g, '\\\\')}"]`).click();
      await page.waitForFunction((want) => activeTab().path && activeTab().path.replace(/\\$/, '').toLowerCase() === want.replace(/\\$/, '').toLowerCase()
        && window.__fpLoadPending === 0, p);
      const loc = await location(page);
      const want = await page.evaluate((q) => tabLabelFor(q), loc.path);
      expect(loc.label, p).toBe(want);
      expect(loc.tabText, p).toBe(want);
      expect(loc.crumbPath.replace(/\\$/, '').toLowerCase(), p).toBe(loc.path.replace(/\\$/, '').toLowerCase());
      expect(loc.list, p).toBe(true);
      expect(loc.thispc, p).toBe(false);
      // A drive root names itself the way the sidebar and the crumb do.
      if (/^[A-Za-z]:\\?$/.test(p)) {
        const name = await page.evaluate((q) => driveDisplayName(window.__fpDrives.find((d) => d.mount === q)), p);
        expect(loc.label).toBe(name);
        expect(loc.crumb).toBe(name);
      }
    }

    // The This PC header: the page, labelled This PC.
    await page.click('[data-action="thispc-open"]');
    await expect(page.locator('#thispc-view')).toBeVisible();
    expect(await location(page)).toMatchObject({ path: 'thispc:', label: 'This PC', tabText: 'This PC', crumb: 'This PC', thispc: true, list: false });

    // Home: the Home screen, labelled Home.
    await page.locator('#sidebar .fp-sidebar__item[data-screen="home"]').click();
    expect(await page.evaluate(() => [activeTab().screen, activeTab().label])).toEqual(['home', 'Home']);

    // The breadcrumb root is This PC — from a drive root, where the whole
    // path fits (a long path scrolls its leading crumbs under the fade), and
    // it is the first crumb of a deep path too.
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await settled(page);
    await expect(crumbCurrent(page)).toHaveText('Documents');
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb').first()).toHaveAttribute('data-path', 'thispc:');
    const drive = (await apiGet('/drives'))[0];
    await page.evaluate((p) => openBrowserAt(p), drive.mount);
    await settled(page);
    await expect(crumbCurrent(page)).toHaveText(await page.evaluate((d) => driveDisplayName(d), drive));
    const rootCrumb = page.locator('#breadcrumb .fp-breadcrumb__crumb').first();
    await expect(rootCrumb).toHaveAttribute('aria-label', 'This PC');
    await rootCrumb.click();
    await expect(page.locator('#thispc-view')).toBeVisible();
    expect(await location(page)).toMatchObject({ path: 'thispc:', label: 'This PC', crumb: 'This PC', thispc: true, list: false });

    // The palette's "Files" entry on a fresh tab (no folder yet) opens This PC
    // and says so — never the sandbox under a "This PC" label.
    await page.keyboard.press('Control+t');
    await page.evaluate(() => switchScreen('browser'));
    await expect(page.locator('#thispc-view')).toBeVisible();
    expect(await location(page)).toMatchObject({ path: 'thispc:', label: 'This PC', crumb: 'This PC' });
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});
