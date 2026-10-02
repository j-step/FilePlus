// frontend/test/search-pass2.spec.js
// Regression cover for the pass-2 "renderer-search" findings (#86-#98,
// #159-#166). One Electron launch, one page; the sections run in order and
// each cleans the bar up behind it.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

const FRONTEND = path.join(__dirname, '..');
const API = `http://127.0.0.1:${process.env.FILEPLUS_PORT || 9876}`;

test.setTimeout(180_000);

test('toolbar search: pass-2 regressions', async () => {
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
    const listNames = async (dir) => {
      const data = await (await fetch(`${API}/fs/list?path=${encodeURIComponent(dir)}`, { headers })).json();
      return (data.entries || []).map(e => e.name);
    };

    const searchInput = page.locator('#search-input');
    const searchDropdown = page.locator('#search-dropdown');
    // The bar, not the <input>: with a long path the toolbar folds search
    // into its magnifier (Stage 2D §6.2), and a click on the bar opens it
    // in either mode (search.js's mousedown handler).
    const searchBar = page.locator('#search-wrap');
    const searchHeader = page.locator('#list-search-header');
    const filtersModal = page.locator('#search-filters-modal');
    const filtersScrim = page.locator('#search-filters-scrim');
    const crumbCurrent = page.locator('#breadcrumb .fp-breadcrumb__crumb--current');
    const marks = page.locator('#list-scroll .fp-row mark');
    // The real "type a query" path (one input event -> one debounced run),
    // without Playwright's per-character typing cost.
    const typeQuery = (text) => page.evaluate((t) => {
      const input = document.getElementById('search-input');
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);

    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');

    // -- #86  The More-filters dialog blocks the Browser's own shortcuts -----
    // Delete used to reach fileops.trashSelection() behind the open modal.
    const before = await listNames(docsDir);
    await page.locator('#list-scroll .fp-row[data-path]').first().click();
    expect(await page.evaluate(() => browserState.selection.size)).toBe(1);
    await searchBar.click();
    await searchDropdown.locator('[data-action="search-more-filters"]').click();
    await expect(filtersModal).toBeVisible();
    // openMoreFilters() focuses a control, so activeElement is never <body>.
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id))
      .toBe('search-filter-type');
    await page.keyboard.press('Delete');
    await page.keyboard.press('F2');
    await page.waitForTimeout(700);
    expect(await listNames(docsDir)).toEqual(before);
    expect(await page.locator('#list-scroll input').count()).toBe(0);

    // -- #92  Escape and a backdrop click both dismiss it --------------------
    await page.keyboard.press('Escape');
    await expect(filtersModal).toBeHidden();
    await searchBar.click();
    await searchDropdown.locator('[data-action="search-more-filters"]').click();
    await expect(filtersModal).toBeVisible();
    await filtersScrim.click({ position: { x: 8, y: 8 } });
    await expect(filtersModal).toBeHidden();

    // -- #90  A tag chip survives Apply -------------------------------------
    // (a) the offered list is the top tags BY COUNT, not the alphabetical ones.
    const offered = await page.evaluate(() => {
      window.__fpTags = [];
      for (let i = 0; i < 24; i++) window.__fpTags.push({ name: `aa-${String(i).padStart(2, '0')}`, count: 1 });
      window.__fpTags.push({ name: 'work', count: 99 });
      return searchTagChoices().map(c => c.value);
    });
    expect(offered).toContain('work');
    expect(offered.length).toBe(20);
    // (b) a chip whose tag nobody offers is still carried through Apply.
    await page.evaluate(() => {
      window.__fpTags = [];
      searchState.chips = [{ key: 'tag', value: 'work', label: 'work' }];
      renderSearchChips();
      openMoreFilters();
    });
    await expect(filtersModal).toBeVisible();
    expect(await page.locator('#search-filter-tag').inputValue()).toBe('work');
    await page.locator('[data-action="search-more-apply"]').click();
    await expect(filtersModal).toBeHidden();
    expect(await page.evaluate(() => searchChipValue('tag'))).toBe('work');
    await page.evaluate(() => clearSearch());
    await expect(searchHeader).toBeHidden();

    // -- #96  A failed search renders a state, not a blank pane --------------
    await page.evaluate(() => {
      window.__origGet = API.get;
      API.get = function (p, params, opts) {
        if (p === '/fs/search') return Promise.reject(new ApiError(500, 'boom'));
        return window.__origGet.call(API, p, params, opts);
      };
    });
    await typeQuery('doc-0');
    await expect(page.locator('#list-scroll .fp-error-banner')).toBeVisible({ timeout: 4000 });
    await expect(page.locator('#list-scroll .fp-error-banner')).toContainText('Search failed');
    await expect(page.locator('#list-scroll [data-action="search-retry"]')).toBeVisible();
    await page.evaluate(() => { API.get = window.__origGet; });
    // The Retry button on that banner re-runs the same search for real.
    await page.locator('#list-scroll [data-action="search-retry"]').click();
    await expect(marks.first()).toBeVisible({ timeout: 4000 });

    // -- #94  A refresh in search mode keeps the viewport --------------------
    await page.evaluate(() => { document.getElementById('list-scroll').style.maxHeight = '90px'; });
    const scrolled = await page.evaluate(() => {
      const el = document.getElementById('list-scroll');
      el.scrollTop = 60;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await page.evaluate(() => refreshDirectory());
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => document.getElementById('list-scroll').scrollTop)).toBe(scrolled);
    await page.evaluate(() => { document.getElementById('list-scroll').style.maxHeight = ''; });

    // -- #93 / #162  The drives hint never lands on a superseded header ------
    const hintCounts = await page.evaluate(async () => {
      const orig = API.get;
      API.get = function (p, params, opts) {
        if (p === '/drives') return Promise.resolve([{ letter: 'Z:', mount: 'Z:\\' }]);
        return orig.call(API, p, params, opts);
      };
      setSearchHeader('3 results');
      await renderUnindexedDrivesHint([], () => true);
      const afterSuperseded = document.querySelectorAll('#list-search-header-hint').length;
      await renderUnindexedDrivesHint([], () => false);
      const afterCurrent = document.querySelectorAll('#list-search-header-hint').length;
      API.get = orig;
      return { afterSuperseded, afterCurrent };
    });
    expect(hintCounts.afterSuperseded).toBe(0);
    expect(hintCounts.afterCurrent).toBe(1);

    // -- #88  waitForIndexIdle tells "finished" from "gave up" ---------------
    const waits = await page.evaluate(async () => {
      const orig = API.get;
      API.get = function (p, params, opts) {
        if (p === '/index/status') return Promise.resolve({ running: true });
        return orig.call(API, p, params, opts);
      };
      const timedOut = await waitForIndexIdle({ tries: 2, intervalMs: 5 });
      API.get = function (p, params, opts) {
        if (p === '/index/status') return Promise.reject(new ApiError(503, 'down'));
        return orig.call(API, p, params, opts);
      };
      const unavailable = await waitForIndexIdle({ intervalMs: 5, maxStatusErrors: 2 });
      API.get = function (p, params, opts) {
        if (p === '/index/status') return Promise.resolve({ running: false, error: null });
        return orig.call(API, p, params, opts);
      };
      const idle = await waitForIndexIdle({ intervalMs: 5 });
      API.get = orig;
      return { timedOut, unavailable, idle };
    });
    expect(waits.timedOut.idle).toBe(false);
    expect(waits.timedOut.reason).toBe('timeout');
    expect(waits.unavailable.idle).toBe(false);
    expect(waits.unavailable.reason).toBe('status-unavailable');
    expect(waits.idle.idle).toBe(true);

    // -- #87  "Index now" reports progress where the hint lives --------------
    // Notifications are off by default, so the toasts this used to rely on
    // were never shown at all.
    await page.evaluate(() => {
      window.__origGet = API.get;
      window.__origPost = API.post;
      window.__indexPosts = [];
      window.__statusCalls = 0;
      API.post = function (p, body) {
        if (p === '/index') { window.__indexPosts.push(body.path); return Promise.resolve({ ok: true }); }
        return window.__origPost.call(API, p, body);
      };
      API.get = function (p, params, opts) {
        if (p === '/index/status') {
          window.__statusCalls++;
          return Promise.resolve({ running: window.__statusCalls % 2 === 1 });
        }
        return window.__origGet.call(API, p, params, opts);
      };
      setSearchHeader('12 results');
      appendSearchHeaderHint('2 drives are not indexed', 'Index now', 'search-index-drives');
      window.__fpUnindexedDrives = ['C:\\', 'D:\\'];
      window.__indexRun = indexMissingDrives();
    });
    await expect(page.locator('#list-search-header-hint-text')).toHaveText(/Indexing C:/);
    await expect(page.locator('#list-search-header-hint-btn')).toBeDisabled();
    await page.evaluate(() => window.__indexRun);
    await expect(page.locator('#list-search-header-hint-text')).toHaveText('Indexing finished');
    expect(await page.evaluate(() => window.__indexPosts)).toEqual(['C:\\', 'D:\\']);
    await page.evaluate(() => { API.get = window.__origGet; API.post = window.__origPost; });
    await page.evaluate(() => clearSearch());

    // -- #95  "This week" is true local midnight on Monday -------------------
    const week = await page.evaluate(() => {
      const d = new Date(searchPresetAfter('week') * 1000);
      return { day: d.getDay(), hours: d.getHours(), minutes: d.getMinutes() };
    });
    expect(week).toEqual({ day: 1, hours: 0, minutes: 0 });

    // -- #166  A drive root's parent keeps its separator, subline reads LTR --
    expect(await page.evaluate(() => parentOfPath('C:\\report.pdf'))).toBe('C:\\');
    expect(await page.evaluate(() => parentOfPath('C:\\Users\\x.txt'))).toBe('C:\\Users');
    await typeQuery('doc-0');
    await expect(marks.first()).toBeVisible({ timeout: 4000 });
    // Measure the real glyph order rather than a computed-style proxy: render a
    // location subline exactly as renderFsRow() does and compare where the 'C'
    // and the ':' actually land. Under the old bare `direction: rtl` the colon
    // was reordered to the LEFT of the drive letter.
    const bidi = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'fp-row__location';
      probe.innerHTML = '<bdi>C:\</bdi>';
      document.getElementById('list-scroll').appendChild(probe);
      const text = probe.querySelector('bdi').firstChild;
      const rectOf = (from, to) => {
        const range = document.createRange();
        range.setStart(text, from);
        range.setEnd(text, to);
        return range.getBoundingClientRect();
      };
      const out = {
        letterLeft: rectOf(0, 1).left,
        colonLeft: rectOf(1, 2).left,
        unicodeBidi: getComputedStyle(probe).unicodeBidi,
      };
      probe.remove();
      return out;
    });
    expect(bidi.letterLeft).toBeLessThan(bidi.colonLeft);
    expect(bidi.unicodeBidi).toBe('isolate');

    // -- #159  A history row runs the search it is labelled with -------------
    await page.evaluate(() => clearSearch());
    await page.evaluate(() => {
      localStorage.setItem('fp-search-history', JSON.stringify([
        { chips: [], text: 'doc-1', scope: 'current' },
        { chips: [], text: 'doc-0', scope: 'current' },
      ]));
    });
    await searchBar.click();
    await expect(searchDropdown.locator('[data-action="search-history-run"]')).toHaveCount(2);
    // A newer search lands while the panel stays open: the rendered rows are
    // now positionally wrong, so an index-addressed click ran the wrong one.
    await page.evaluate(() => {
      const history = loadSearchHistory();
      localStorage.setItem('fp-search-history', JSON.stringify(
        [{ chips: [], text: 'later', scope: 'current' }, ...history]));
    });
    await searchDropdown.locator('[data-action="search-history-run"]')
      .filter({ hasText: 'doc-0' }).click();
    await expect(searchInput).toHaveValue('doc-0');
    await expect(marks.first()).toBeVisible({ timeout: 4000 });
    await page.evaluate(() => clearSearch());

    // -- #161  A typing pause is not a history entry -------------------------
    await page.evaluate(() => localStorage.removeItem('fp-search-history'));
    await typeQuery('d');
    await page.waitForTimeout(450);
    await typeQuery('do');
    await page.waitForTimeout(450);
    await typeQuery('doc-0');
    await expect(marks.first()).toBeVisible({ timeout: 4000 });
    expect(await page.evaluate(() => loadSearchHistory().length)).toBe(0);
    // A deliberate commit (Enter) still records it.
    await searchBar.click();
    await page.keyboard.press('Enter');
    await expect(marks.first()).toBeVisible({ timeout: 4000 });
    // Polled: the marks above are still the previous run's, so they do not
    // say the Enter run has landed yet — reading history once raced it (it
    // failed 1 run in 3 before Stage 2D touched anything).
    await expect.poll(() => page.evaluate(() => loadSearchHistory().map(e => e.text)), { timeout: 4000 })
      .toEqual(['doc-0']);

    // -- #97 / #165  Collapsed toolbar: the bar opens for a sidebar tag chip
    //                and folds again when the search is cleared ------------
    //                (a real narrow bar: the widest sidebar at the minimum
    //                window width collapses the search — Stage 2D §6.2)
    await page.evaluate(() => clearSearch());
    const winSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 600); });
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-w-screen', '480px'));
    await expect(page.locator('#toolbar')).toHaveAttribute('data-search', 'collapsed', { timeout: 3000 });
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'test-tag-chip';
      btn.dataset.action = 'filter-by-tag';
      btn.dataset.tag = 'zzz-none';
      document.getElementById('sidebar').appendChild(btn);
    });
    // dispatchEvent, not click(): the chip stands in for a sidebar TAGS chip
    // and carries no layout of its own — the global data-action delegation is
    // what is under test here.
    await page.locator('#test-tag-chip').dispatchEvent('click');
    await expect(page.locator('#search-wrap')).toHaveClass(/fp-search--expanded/);
    await expect(page.locator('#search-chips .fp-search-chip').first()).toBeVisible();
    await expect(searchHeader).toBeVisible({ timeout: 6000 });
    // The open bar overlays the path (it never reflows it), so the clear the
    // user reaches is the bar's own × — a real click, the clear that does not
    // come from a blur or Escape.
    await expect(page.locator('#search-wrap')).toHaveClass(/fp-search--expanded/);
    await page.locator('#search-clear-inline').click();
    await expect(searchHeader).toBeHidden();
    await expect(page.locator('#search-wrap')).not.toHaveClass(/fp-search--expanded/);
    await expect(page.locator('#search-collapsed')).toBeVisible();
    await page.evaluate(() => {
      document.getElementById('test-tag-chip')?.remove();
      document.documentElement.style.setProperty('--sidebar-w-screen', '240px');
    });
    await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]); }, winSize);

    // -- #89  A new tab starts with a clean bar, and its first query runs ----
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await typeQuery('doc-0');
    await expect(marks.first()).toBeVisible({ timeout: 4000 });
    const searchTab = await page.evaluate(() => tabs.activeId);
    await page.keyboard.press('Control+t');
    await expect(searchInput).toHaveValue('');
    expect(await page.evaluate(() => searchState.chips.length)).toBe(0);
    expect(await page.evaluate(() => browserState.mode)).toBe('browse');
    // The first query typed on the new tab must not supersede itself.
    await typeQuery('doc-0');
    await expect(marks.first()).toBeVisible({ timeout: 8000 });
    await expect(searchHeader).toHaveText(/\d+ results/);
    await page.evaluate(() => clearSearch());
    await page.evaluate((id) => activateTab(id), searchTab);
    await page.evaluate(() => clearSearch());

    // -- #98  The debounce does not survive a tab switch ---------------------
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    const tabA = await page.evaluate(() => tabs.activeId);
    const tabB = await page.evaluate(() => tabs.list.find(t => t.id !== tabs.activeId).id);
    await page.evaluate((id) => activateTab(id), tabB);
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await expect(crumbCurrent).toHaveText('Pictures');
    await page.evaluate((id) => activateTab(id), tabA);
    await expect(crumbCurrent).toHaveText('Documents');
    await typeQuery('doc-0');                       // arms the 300 ms timer
    await page.evaluate((id) => activateTab(id), tabB);
    await page.waitForTimeout(1000);
    await expect(crumbCurrent).toHaveText('Pictures');
    await expect(searchHeader).toBeHidden();
    await expect(marks).toHaveCount(0);
    await page.evaluate((id) => { closeOtherTabs(id); }, tabB);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
