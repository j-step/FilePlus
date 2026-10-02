// frontend/test/stage2d-menus.spec.js
// Stage 2D Task 2 (spec §6.3): context-menu flyout submenus, the Sort menu's
// "Date…" flyout (created / modified / accessed) and a Details date column
// that follows the date sort.
const { test, expect } = require('@playwright/test');
const { launchApp, shot, apiGet, apiHeaders, API } = require('./harness/app');

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

    expect(errors).toEqual([]);
  } finally {
    try { await fetch(`${API}/config/ui.sort`, { method: 'DELETE', headers: apiHeaders() }); } catch { /* best effort */ }
    await app.close();
  }
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
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
