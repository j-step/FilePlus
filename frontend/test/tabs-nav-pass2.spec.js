// frontend/test/tabs-nav-pass2.spec.js
// Regression cover for the pass-2 "renderer-tabs-nav" findings (#11-#20,
// #153-#158). One Electron launch, one page, the checks run in order because
// each builds on the tab set the previous one left behind.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

const FRONTEND = path.join(__dirname, '..');
const API = `http://127.0.0.1:${process.env.FILEPLUS_PORT || 9876}`;

test('tabs and navigation: pass-2 regressions', async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [FRONTEND],
    cwd: FRONTEND,
    env,
  });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  try {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.waitForSelector('#shell');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#shell');
    await page.waitForTimeout(800);

    const token = process.env.FILEPLUS_API_TOKEN;
    const headers = token ? { 'X-FilePlus-Token': token } : {};
    const root = (await (await fetch(`${API}/fs/list/root`, { headers })).json()).path;
    const genDir = `${root}\\_gen`;
    const docsDir = `${genDir}\\Documents`;
    const picsDir = `${genDir}\\Pictures`;

    const crumbCurrent = page.locator('#breadcrumb .fp-breadcrumb__crumb--current');
    const searchInput = page.locator('#search-input');
    const searchHeader = page.locator('#list-search-header');
    // #btn-* ids, not [data-action] — the load-error banner renders its own
    // "Go back"/"Retry" buttons carrying the same actions.
    const btnUp = page.locator('#btn-up');
    const btnBack = page.locator('#btn-back');
    const btnFwd = page.locator('#btn-forward');
    const activeScreenOf = () => page.evaluate(() => activeTab().screen);
    const activeLabelOf = () => page.evaluate(() => activeTab().label);

    // ── #13  The seed breadcrumb crumb is a screen link, not a fake path ─────
    // "home" is not a directory: handing it to loadDirectory() relabelled the
    // tab and flipped it to the Browser screen before the backend's 400 landed.
    expect(await page.locator('#breadcrumb [data-path="home"]').count()).toBe(0);
    await page.locator('#breadcrumb .fp-breadcrumb__crumb').first().click();
    expect(await activeScreenOf()).toBe('home');
    expect(await activeLabelOf()).toBe('Home');

    // ── #11 / #12  The toolbar is outside .screen ────────────────────────────
    // Browse Documents, then leave the Browser screen: the nav group must go
    // dead and the breadcrumb/search bar must stop describing a hidden listing.
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await expect(crumbCurrent).toHaveText('Pictures');
    await expect(btnBack).toBeEnabled();

    await page.evaluate(() => switchScreen('home'));
    await expect(btnBack).toBeDisabled();
    await expect(btnFwd).toBeDisabled();
    await expect(btnUp).toBeDisabled();
    // No crumb in the toolbar still points at the folder that is now hidden.
    expect(await page.locator('#breadcrumb [data-action="navigate-crumb"]').count()).toBe(0);

    // The click-dispatch guard is the second half of the same rule: force the
    // button back on and click it — the tab must stay a Home tab.
    await page.evaluate(() => { document.getElementById('btn-up').disabled = false; });
    await btnUp.click();
    await page.waitForTimeout(300);
    expect(await activeScreenOf()).toBe('home');
    expect(await activeLabelOf()).toBe('Home');
    await expect(page.locator('#screen-home')).toBeVisible();

    // ── #155  A Settings tab survives the show-hidden toggle ─────────────────
    await page.evaluate(() => switchScreen('settings'));
    expect(await activeLabelOf()).toBe('Settings');
    await page.evaluate(() => {
      const t = document.querySelector('[data-action="settings-toggle"][data-setting="show-hidden"]');
      t.checked = !t.checked;
      t.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    expect(await activeScreenOf()).toBe('settings');
    expect(await activeLabelOf()).toBe('Settings');
    await expect(page.locator('#screen-settings')).toBeVisible();
    // Put it back and return to a folder.
    await page.evaluate(() => {
      const t = document.querySelector('[data-action="settings-toggle"][data-setting="show-hidden"]');
      t.checked = !t.checked;
      t.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');

    // ── #17  A navigation that goes nowhere keeps the forward stack ──────────
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await expect(crumbCurrent).toHaveText('Pictures');
    await page.evaluate(() => navBack());
    await expect(crumbCurrent).toHaveText('Documents');
    await expect(btnFwd).toBeEnabled();
    const histLen = await page.evaluate(() => nav.history.length);
    await page.evaluate((p) => openBrowserAt(p), docsDir);   // the folder already shown
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => nav.history.length)).toBe(histLen);
    await expect(btnFwd).toBeEnabled();

    // ── #16  "This PC" keeps its label across a tab switch ───────────────────
    await page.evaluate(() => openBrowserAt(null));
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('This PC');
    const rootTabId = await page.evaluate(() => tabs.activeId);
    await page.keyboard.press('Control+t');
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await page.locator(`.fp-tab[data-tab-id="${rootTabId}"]`).click();
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('This PC');

    // ── #158  The tab strip is reachable from the keyboard ───────────────────
    // Exactly one tab stop (roving tabindex), and Ctrl+<n> jumps by position.
    expect(await page.locator('.fp-tab[tabindex="0"]').count()).toBe(1);
    expect(await page.evaluate(() => document.querySelector('.fp-tab.fp-tab--active').tabIndex)).toBe(0);
    const stripOrder = await page.evaluate(() => tabsInStripOrder());
    await page.keyboard.press('Control+2');
    expect(await page.evaluate(() => tabs.activeId)).toBe(stripOrder[1]);
    await page.keyboard.press('Control+1');
    expect(await page.evaluate(() => tabs.activeId)).toBe(stripOrder[0]);
    // Ctrl+Tab cycles, Ctrl+Shift+Tab cycles back.
    await page.keyboard.press('Control+Tab');
    expect(await page.evaluate(() => tabs.activeId)).toBe(stripOrder[1]);
    await page.keyboard.press('Control+Shift+Tab');
    expect(await page.evaluate(() => tabs.activeId)).toBe(stripOrder[0]);

    // ── #156  A new tab past the fold is scrolled into view ──────────────────
    for (let i = 0; i < 12; i++) await page.keyboard.press('Control+t');
    const strip = await page.evaluate(() => {
      const bar = document.getElementById('tabbar');
      const el = document.querySelector('.fp-tab.fp-tab--active');
      const b = bar.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      return {
        overflows: bar.scrollWidth - bar.clientWidth > 1,
        scrolled: bar.scrollLeft > 0,
        visible: t.left >= b.left - 1 && t.right <= b.right + 1,
      };
    });
    expect(strip.overflows).toBeTruthy();   // 14 tabs at this width really do overflow
    expect(strip.scrolled).toBeTruthy();    // the strip followed the new tab
    expect(strip.visible).toBeTruthy();
    // Close them again, back to a single tab.
    await page.evaluate(() => { closeOtherTabs(tabsInStripOrder()[0]); });
    await expect(page.locator('.fp-tab')).toHaveCount(1);

    // ── #15  A search runs against THIS tab's folder, never the last one ─────
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    await page.keyboard.press('Control+t');              // a Home tab, path null
    // #12 again: the new tab starts with a clean toolbar.
    await expect(searchInput).toHaveValue('');
    await expect(btnBack).toBeDisabled();
    await page.evaluate(() => { setSearchText('doc-0'); return runSearch(); });
    await page.waitForTimeout(800);
    const scoped = await page.evaluate(() => ({ root: searchState.root, tabPath: activeTab().path }));
    expect(scoped.root).not.toContain('Documents');      // NOT the other tab's folder
    // A tab with no folder of its own opens at This PC (Stage 2D §8), and
    // "current location" there is This PC: the index scope ('*'), never a
    // walk of a folder called "thispc:".
    expect(scoped.tabPath).toBe('thispc:');
    expect(scoped.root).toBe('*');
    await page.evaluate(() => clearSearch());
    await page.keyboard.press('Control+w');
    await expect(page.locator('.fp-tab')).toHaveCount(1);

    // ── #154  Back out of results returns to the searched folder ─────────────
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await page.evaluate(() => { setSearchText('doc-0'); return runSearch(); });
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 4000 });
    await page.evaluate(() => navBack());
    await expect(searchHeader).toBeHidden();
    await expect(crumbCurrent).toHaveText('Documents');   // not Pictures, one step past

    // A tab that leaves the Browser screen mid-search comes back as a search:
    // the bar and the "Search in x" breadcrumb are restored, not replaced by a
    // folder breadcrumb painted over a results listing.
    await page.evaluate(() => { setSearchText('doc-0'); return runSearch(); });
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 4000 });
    await page.evaluate(() => switchScreen('settings'));
    await expect(searchInput).toHaveValue('');
    await page.evaluate(() => switchScreen('browser'));
    await expect(searchInput).toHaveValue('doc-0');
    await expect(page.locator('#breadcrumb [data-action="search-clear"]')).toBeVisible();
    await page.evaluate(() => clearSearch());

    // ── #153  A results tab keeps its selection across a tab switch ──────────
    await page.evaluate(() => { setSearchText('doc-0'); return runSearch(); });
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 4000 });
    await page.locator('#list-scroll .fp-row').first().click();
    const selBefore = await page.evaluate(() => [...browserState.selection]);
    expect(selBefore.length).toBe(1);
    const searchTabId = await page.evaluate(() => tabs.activeId);
    await page.keyboard.press('Control+t');
    await page.locator(`.fp-tab[data-tab-id="${searchTabId}"]`).click();
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible();
    expect(await page.evaluate(() => [...browserState.selection])).toEqual(selBefore);

    // ── #18  Reopen-closed-tab and duplicate-tab keep the results ────────────
    await page.keyboard.press('Control+w');               // closes the results tab
    await expect(page.locator('.fp-tab')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+T');
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible();
    await expect(searchHeader).toHaveText(/\d+ results/);

    await page.evaluate(() => duplicateTab(tabs.activeId));
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible();
    await expect(searchHeader).toHaveText(/\d+ results/);
    await page.evaluate(() => { closeOtherTabs(tabs.activeId); });
    await page.evaluate(() => clearSearch());

    // ── #14  An unfinished search survives the switch that resumes it ────────
    // Tab A shows results; tab B has chips/text but no results yet. Switching
    // A -> B used to have loadDirectory()'s leaveSearchMode() null B's snapshot
    // out from under the resume check.
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await page.evaluate(() => { setSearchText('doc-0'); return runSearch(); });
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 4000 });
    const tabA = await page.evaluate(() => tabs.activeId);
    await page.keyboard.press('Control+t');
    const tabB = await page.evaluate(() => tabs.activeId);
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await page.evaluate((id) => activateTab(id), tabA);
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible();
    // Stage B's unfinished search AFTER the switch — activateTab() syncs the
    // outgoing tab's record on the way out, which would overwrite it.
    await page.evaluate((id) => {
      tabs.list.find(t => t.id === id).search =
        { chips: [], text: 'pic', scope: 'current', results: null, truncated: false, root: null, query: '' };
    }, tabB);
    await page.evaluate((id) => activateTab(id), tabB);
    await page.waitForTimeout(1200);
    await expect(searchInput).toHaveValue('pic');         // resumed, not discarded
    await page.evaluate(() => clearSearch());
    await page.evaluate((id) => { closeOtherTabs(id); }, tabA);
    await page.evaluate(() => clearSearch());

    // ── #19  the view and icon size are per tab ──────────────────────────────
    // Two tabs on the SAME folder: a view change in the second must not
    // reach the first, even though the folder now remembers the second's
    // choice (Stage 2D §3.1: tabs keep their own view state).
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await page.evaluate(() => setView('icons', 256, { manual: true }));
    expect(await page.evaluate(() => [browserState.view, browserState.iconSize])).toEqual(['icons', 256]);
    const scaleTab = await page.evaluate(() => tabs.activeId);
    await page.keyboard.press('Control+t');
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await page.evaluate(() => setView('icons', 48, { manual: true }));
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await page.evaluate(() => setView('list', null, { manual: true }));
    await page.locator(`.fp-tab[data-tab-id="${scaleTab}"]`).click();
    await expect(crumbCurrent).toHaveText('Documents');
    expect(await page.evaluate(() => [browserState.view, browserState.iconSize])).toEqual(['icons', 256]);
    expect(await page.locator('#list-scroll').getAttribute('data-view')).toBe('icons');
    await page.evaluate((id) => { closeOtherTabs(id); }, scaleTab);
    await page.evaluate(() => setView('details'));
    await fetch(`${API}/config/ui.folder_views`, { method: 'DELETE', headers });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
