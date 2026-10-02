// frontend/test/stage2d-menus.spec.js
// Stage 2D Task 2 (spec §6.3): context-menu flyout submenus, the Sort menu's
// "Date…" flyout (created / modified / accessed) and a Details date column
// that follows the date sort.
const { test, expect } = require('@playwright/test');
const { launchApp, shot, rowByName, apiGet, apiHeaders, API } = require('./harness/app');

test.setTimeout(120_000);

test('sort Date… flyout, date column, keyboard and persistence', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await expect(page.locator('#list-scroll .fp-row').first()).toBeVisible();

    // The default column is the modified date.
    const head = page.locator('#list-head [data-col="date"]');
    await expect(head).toHaveText(/Date modified/);

    await page.click('[data-action="open-sort-menu"]');
    const dateItem = page.locator('.fp-context-menu [data-menu-label="Date…"]');
    await expect(dateItem).toBeVisible();
    await dateItem.hover();
    const fly = page.locator('.fp-context-menu--flyout');
    await expect(fly).toBeVisible();
    await expect(fly.locator('.fp-context-menu__item')).toHaveText(['Date created', 'Date modified', 'Date accessed']);
    // Only one flyout exists, and it sits beside the root menu (right edge, or
    // flipped to the left edge when the sort button is near the window edge).
    await expect(fly).toHaveCount(1);
    const rootBox = await page.locator('#context-menu').boundingBox();
    const flyBox = await fly.boundingBox();
    expect(flyBox.x >= rootBox.x + rootBox.width - 4 || flyBox.x + flyBox.width <= rootBox.x + 4).toBe(true);
    await shot(page, 'menus-sort-date-flyout');

    await fly.locator('text=Date created').click();
    await expect(page.locator('.fp-context-menu:visible')).toHaveCount(0);
    await expect(head).toHaveText(/Date created/);
    await expect(head).toHaveClass(/active/);
    // Row cells follow the same field and show real values, not dashes.
    const firstCell = page.locator('#list-scroll .fp-row .fp-row__modified').first();
    await expect(firstCell).not.toHaveText('—');
    // The choice persists as ui.sort.
    await expect.poll(async () => (await apiGet('/config'))['ui.sort']).toEqual({ key: 'created', dir: 'asc' });

    // Date accessed, then Date modified, through the same flyout.
    await page.click('[data-action="open-sort-menu"]');
    await page.locator('.fp-context-menu [data-menu-label="Date…"]').click();   // click opens it too
    await expect(fly).toBeVisible();
    await fly.locator('text=Date accessed').click();
    await expect(head).toHaveText(/Date accessed/);
    await expect.poll(async () => (await apiGet('/config'))['ui.sort'].key).toBe('accessed');
    expect(await page.evaluate(() => dateFieldForSort())).toBe('accessed');

    // A non-date sort puts the column back on "modified".
    await page.click('[data-action="open-sort-menu"]');
    await page.locator('.fp-context-menu [data-menu-label="Size"]').click();
    await expect(head).toHaveText(/Date modified/);
    expect(await page.evaluate(() => dateFieldForSort())).toBe('modified');

    // Keyboard: ArrowDown x2 reaches "Date…", ArrowRight opens the flyout with
    // its first item focused, Escape closes only the flyout, a second Escape
    // closes the whole menu.
    await page.click('[data-action="open-sort-menu"]');
    await page.keyboard.press('ArrowDown');            // Name
    await page.keyboard.press('ArrowDown');            // Date…
    await expect(page.locator('.fp-context-menu [data-menu-label="Date…"]')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(fly).toBeVisible();
    await expect(fly.locator('.fp-context-menu__item').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(fly.locator('.fp-context-menu__item').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(fly).toHaveCount(0);
    await expect(page.locator('#context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fp-context-menu:visible')).toHaveCount(0);

    // Keyboard: Enter on a flyout item applies it; ArrowLeft closes the flyout.
    await page.click('[data-action="open-sort-menu"]');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');                // opens the flyout
    await expect(fly).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(fly).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');                // Date created
    await expect(head).toHaveText(/Date created/);
    await expect(page.locator('.fp-context-menu:visible')).toHaveCount(0);

    // A click outside closes the menu and its flyout together.
    await page.click('[data-action="open-sort-menu"]');
    await page.locator('.fp-context-menu [data-menu-label="Date…"]').click();
    await expect(fly).toBeVisible();
    await page.mouse.click(5, 400);
    await expect(page.locator('.fp-context-menu:visible')).toHaveCount(0);
    await expect(fly).toHaveCount(0);

  } finally {
    try { await fetch(`${API}/config/ui.sort`, { method: 'DELETE', headers: apiHeaders() }); } catch { /* best effort */ }
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('flyout flips left at the right edge; root menu stays on screen', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const items = [
      { label: 'Alpha', action: 'sort-name' },
      { label: 'Group', items: [{ label: 'Child one', action: 'sort-name' }, { label: 'Child two', action: 'sort-name' }] },
    ];
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    // Far bottom-right corner: root menu is pulled back inside the viewport.
    await page.evaluate(([x, y, it]) => showContextMenu(x, y, it, {}), [vw - 2, vh - 2, items]);
    const rootBox = await page.locator('#context-menu').boundingBox();
    expect(rootBox.x + rootBox.width).toBeLessThanOrEqual(vw);
    expect(rootBox.y + rootBox.height).toBeLessThanOrEqual(vh);
    expect(rootBox.x).toBeGreaterThanOrEqual(0);
    expect(rootBox.y).toBeGreaterThanOrEqual(0);
    await page.locator('#context-menu [data-menu-label="Group"]').click();
    const fly = page.locator('.fp-context-menu--flyout');
    await expect(fly).toBeVisible();
    const flyBox = await fly.boundingBox();
    expect(flyBox.x + flyBox.width).toBeLessThanOrEqual(rootBox.x + 4);   // flipped to the left
    expect(flyBox.y + flyBox.height).toBeLessThanOrEqual(vh);
    await shot(page, 'menus-flyout-flipped');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Menu opened at (0,0)-ish never leaves the top/left edge either.
    await page.evaluate((it) => showContextMenu(-30, -30, it, {}), items);
    const topLeft = await page.locator('#context-menu').boundingBox();
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('keyboard activation keeps focus working; selection and focus survive a sort', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await expect(page.locator('#list-scroll .fp-row').first()).toBeVisible();

    // Make the list taller than its viewport so "scrolled into view" is real.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1200, 460); });
    await page.waitForFunction(() => {
      const ls = document.getElementById('list-scroll');
      return ls.scrollHeight > ls.clientHeight + 40;
    });

    // Select the first FILE row (name ascending: right after the folder). A
    // descending name sort moves it to the very bottom, out of view.
    const target = rowByName(page, 'café menu.txt');
    await target.click();
    const targetPath = await page.evaluate(() => browserState.focus);
    expect(targetPath).toMatch(/caf.+menu\.txt$/);

    // Selection + focus persist across a sort, and the row is scrolled in.
    await page.evaluate(() => { document.getElementById('list-scroll').scrollTop = 0; });
    await page.evaluate(() => applySort('name', 'desc'));
    const after = await page.evaluate((p) => {
      const ls = document.getElementById('list-scroll').getBoundingClientRect();
      const row = [...document.querySelectorAll('#list-scroll .fp-row')].find(r => r.dataset.path === p);
      const r = row.getBoundingClientRect();
      return {
        selected: browserState.selection.has(p), focus: browserState.focus === p,
        rowSelected: row.classList.contains('fp-row--selected'), rowFocused: row.classList.contains('fp-row--focused'),
        scrollTop: document.getElementById('list-scroll').scrollTop,
        inView: r.top >= ls.top - 1 && r.bottom <= ls.bottom + 1,
        active: document.activeElement === row,
      };
    }, targetPath);
    expect(after).toMatchObject({ selected: true, focus: true, rowSelected: true, rowFocused: true, inView: true, active: true });
    expect(after.scrollTop).toBeGreaterThan(0);
    await page.evaluate(() => applySort('name', 'asc'));

    // Sort chosen entirely by keyboard, then arrow keys still move the list.
    await page.locator('[data-action="open-sort-menu"]').focus();
    await page.keyboard.press('Space');                 // native button activation opens the menu
    await expect(page.locator('#context-menu')).toBeVisible();
    await page.keyboard.press('ArrowDown');             // Name
    await page.keyboard.press('ArrowDown');             // Date…
    await page.keyboard.press('ArrowRight');            // flyout, first item (Date created) focused
    await page.keyboard.press('Enter');                 // choose it
    await expect(page.locator('#list-head [data-col="date"]')).toHaveText(/Date created/);
    await expect(page.locator('.fp-context-menu:visible')).toHaveCount(0);
    const focusedBefore = await page.evaluate(() => browserState.focus);
    expect(await page.evaluate(() => document.activeElement.classList.contains('fp-row--focused'))).toBe(true);
    await page.keyboard.press('ArrowDown');
    const focusedAfter = await page.evaluate(() => browserState.focus);
    expect(focusedAfter).not.toBe(focusedBefore);
    await expect(page.locator('#list-scroll .fp-row--focused')).toHaveCount(1);

    // An item activated with the mouse hands focus back too (not <body>).
    await page.locator('[data-action="open-sort-menu"]').click();
    await page.locator('.fp-context-menu [data-menu-label="Size"]').click();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);

  } finally {
    try { await fetch(`${API}/config/ui.sort`, { method: 'DELETE', headers: apiHeaders() }); } catch { /* best effort */ }
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('date sort: access-denied and missing dates go last in both directions', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await expect(page.locator('#list-scroll .fp-row').first()).toBeVisible();
    const out = await page.evaluate(() => {
      const savedEntries = browserState.entries, savedSort = browserState.sort;
      browserState.entries = [
        { name: 'ok-new', is_dir: false, ext: 'txt', created: 10, accessed: 10 },
        { name: 'null-date', is_dir: false, ext: 'txt', created: null },
        { name: 'denied', is_dir: false, ext: 'txt', error: 'Access denied', created: 0.0, accessed: 0.0 },
        { name: 'ok-old', is_dir: false, ext: 'txt', created: 5, accessed: 5 },
      ];
      const run = (key, dir) => { browserState.sort = { key, dir }; return sortedEntries().map(e => e.name); };
      const res = { createdAsc: run('created', 'asc'), createdDesc: run('created', 'desc'), accessedAsc: run('accessed', 'asc') };
      browserState.entries = savedEntries; browserState.sort = savedSort;
      return res;
    });
    expect(out.createdAsc).toEqual(['ok-old', 'ok-new', 'denied', 'null-date']);
    expect(out.createdDesc).toEqual(['ok-new', 'ok-old', 'denied', 'null-date']);
    expect(out.accessedAsc.slice(0, 2)).toEqual(['ok-old', 'ok-new']);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});

test('Tab closes the whole menu; a stationary pointer cannot yank a keyboard-opened flyout', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const items = [
      { label: 'Alpha', action: 'sort-name' },
      { label: 'Group', items: [{ label: 'Child one', action: 'sort-name' }, { label: 'Child two', action: 'sort-name' }] },
      { label: 'Beta', action: 'sort-name' },
    ];
    const open = () => page.evaluate((it) => showContextMenu(300, 200, it, {}), items);
    const visibleMenus = page.locator('.fp-context-menu:visible');
    const fly = page.locator('.fp-context-menu--flyout');

    // Tab with a flyout open closes everything.
    await open();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(fly).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(visibleMenus).toHaveCount(0);
    await expect(fly).toHaveCount(0);

    // Focus moving out of the menu tree closes it too.
    await open();
    await page.keyboard.press('ArrowDown');
    await page.evaluate(() => document.querySelector('input').focus());
    await expect(visibleMenus).toHaveCount(0);

    // Keyboard-opened flyout: a pointerenter on a sibling at the SAME pointer
    // position (layout shift under a stationary pointer) does not close it;
    // one at a different position (the pointer really moved) does, after the
    // 300 ms grace.
    await open();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect(fly).toBeVisible();
    // Waited out deterministically: a timer of the same CM_FLYOUT_CLOSE_GRACE
    // registered right AFTER the pointerenter fires after any close timer the
    // handler armed, so if the flyout survives it, nothing was armed.
    const survived = await page.evaluate(() => {
      const beta = document.querySelector('#context-menu [data-menu-label="Beta"]');
      beta.dispatchEvent(new PointerEvent('pointerenter', { clientX: cmLastPointer.x, clientY: cmLastPointer.y }));
      return new Promise((r) => setTimeout(() => r(cmFlyouts.length > 0), CM_FLYOUT_CLOSE_GRACE));
    });
    expect(survived).toBe(true);
    await expect(fly).toBeVisible();
    await page.evaluate(() => {
      const beta = document.querySelector('#context-menu [data-menu-label="Beta"]');
      beta.dispatchEvent(new PointerEvent('pointerenter', { clientX: cmLastPointer.x + 7, clientY: cmLastPointer.y + 7 }));
    });
    await expect(fly).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(visibleMenus).toHaveCount(0);
  } finally { await app.close(); }
  expect(errors).toEqual([]);
});
