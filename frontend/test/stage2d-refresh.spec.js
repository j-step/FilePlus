// frontend/test/stage2d-refresh.spec.js
// Stage 2D Task 3 (spec §4.2, §7): no Electron default menu (Ctrl+R never
// reloads the page), Ctrl+R / F5 refresh the open folder in place with a
// row diff (scroll, selection and untouched row nodes survive), one render
// per navigation, and tab switches repaint synchronously from the tab's own
// cached listing.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp, shot, rowByName, apiGet } = require('./harness/app');

test.setTimeout(180_000);

// Playwright's keyboard goes through the DevTools protocol, which never
// reaches Electron's menu accelerators or Chromium's native edit commands — so
// a Ctrl+R pressed that way could not reload the page even with the default
// menu in place. sendInputEvent takes the same route as a real key press.
async function nativeKey(app, keyCode, modifiers = []) {
  await app.evaluate(({ BrowserWindow }, a) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode, modifiers: a.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers });
  }, { keyCode, modifiers });
}

// Counters in the main process for things that must NOT happen: a document
// navigation (a reload), DevTools opening, a second window. Read after
// settleKeys(), never after a sleep.
async function installMainCounters(app) {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    const c = globalThis.__fpTestCounters = { navigations: 0, devtools: 0, windows: 0 };
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.on('did-start-navigation', (e, _url, isInPlace, isMainFrame) => {
      const same = e && typeof e.isSameDocument === 'boolean' ? e.isSameDocument : isInPlace;
      const main = e && typeof e.isMainFrame === 'boolean' ? e.isMainFrame : isMainFrame;
      if (main && !same) c.navigations++;
    });
    wc.on('devtools-opened', () => { c.devtools++; });
    electronApp.on('browser-window-created', () => { c.windows++; });
  });
}
const mainCounters = (app) => app.evaluate(() => ({ ...globalThis.__fpTestCounters }));

// A sentinel key the app ignores (F24), sent the same native way. Input
// events are handled in order, so once the page has seen it, every key sent
// before it has been fully handled — by the page and by the main process.
// A reload in between would drop the listener and time this out.
async function installSentinel(page) {
  await page.evaluate(() => {
    window.__fpSentinelKeys = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'F24') window.__fpSentinelKeys++; }, true);
  });
}
async function settleKeys(app, page) {
  const n = await page.evaluate(() => window.__fpSentinelKeys || 0);
  await nativeKey(app, 'F24');
  await page.waitForFunction((k) => (window.__fpSentinelKeys || 0) > k, n);
}

// Chromium reports a 404 fetch as a console error ("Failed to load resource")
// even when the app catches it. The checks below provoke a few of those on
// purpose (folders deleted on disk, a folder that never existed); anything
// else is a real error.
function unexpectedErrors(errors) {
  return errors.filter((e) => !(/status of 404/.test(e)
    && /\/fs\/list\?path=.*(Doomed|Nowhere-2d|GoneBack-2d|zz-search-gone-2d)/.test(e)));
}

test('refresh in place, one render per navigation, cached tab repaint, no default menu', async () => {
  const { app, page, errors } = await launchApp();
  try {
    // Solid chrome for the screenshots: Mica is a live desktop material that
    // captures as transparent pixels under the harness (as in smoke.spec.js).
    await page.evaluate(() => { delete document.documentElement.dataset.mica; });
    const root = (await apiGet('/fs/list/root')).path;
    const bigDir = `${root}\\Bulk`;
    const docsDir = `${root}\\_gen\\Documents`;
    const picsDir = `${root}\\_gen\\Pictures`;
    const musicDir = `${root}\\_gen\\Music`;
    const crumbCurrent = page.locator('#breadcrumb .fp-breadcrumb__crumb--current');

    // ── 1. Ctrl+R does not reload the page ─────────────────────────────────
    const origin0 = await page.evaluate(() => performance.timeOrigin);
    await installMainCounters(app);
    await installSentinel(page);
    await nativeKey(app, 'R', ['control']);
    await nativeKey(app, 'R', ['control', 'shift']); // Review Bin, never a hard reload
    await settleKeys(app, page);
    expect(await mainCounters(app)).toEqual({ navigations: 0, devtools: 0, windows: 0 });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin0);
    expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu())).toBeNull();

    // ── 2. scroll + selection survive Ctrl+R; a new file appears ────────────
    await page.evaluate((p) => openBrowserAt(p), bigDir);
    await expect(crumbCurrent).toHaveText('Bulk');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(240);
    await page.evaluate(() => { document.getElementById('list-scroll').scrollTop = 900; });
    expect(await page.evaluate(() => document.getElementById('list-scroll').scrollTop)).toBe(900);
    // A row comfortably inside the viewport after the scroll.
    const someVisibleName = await page.evaluate(() => {
      const ls = document.getElementById('list-scroll');
      const top = ls.getBoundingClientRect().top;
      const row = [...ls.querySelectorAll('.fp-row')].find((r) => r.getBoundingClientRect().top > top + 60);
      return row.querySelector('.fp-row__name').textContent;
    });
    await rowByName(page, someVisibleName).click();
    await expect(rowByName(page, someVisibleName)).toHaveClass(/fp-row--selected/);
    const scrollBefore = await page.evaluate(() => document.getElementById('list-scroll').scrollTop);
    fs.writeFileSync(path.join(bigDir, 'aaa-new-2d.txt'), 'x');
    await nativeKey(app, 'R', ['control']);
    await expect(rowByName(page, 'aaa-new-2d.txt')).toHaveCount(1);
    expect(await page.evaluate(() => document.getElementById('list-scroll').scrollTop)).toBe(scrollBefore);
    await expect(rowByName(page, someVisibleName)).toHaveClass(/fp-row--selected/);
    // DOM focus stays on the focused row (the click gave it to the list).
    expect(await page.evaluate(() => {
      const a = document.activeElement;
      return a && (a.id === 'list-scroll' || a.closest('#list-scroll') !== null);
    })).toBe(true);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin0);
    // The refresh button gave its one-spin feedback and the list its dip
    // (classes are removed again on a timer; reduced motion kills the motion).
    await expect(page.locator('#btn-refresh')).not.toHaveClass(/is-spinning/);
    await expect(page.locator('#list-scroll')).not.toHaveClass(/is-refreshing/);
    await shot(page, 'refresh-bulk-after-ctrl-r');

    // ── 3. unchanged rows keep their DOM node identity across F5 ────────────
    const probed = await page.evaluate(() => {
      const rows = document.querySelectorAll('#list-scroll .fp-row');
      rows[5].dataset.probe = '1';
      rows[6].dataset.probe = '2';
      return [rows[5].dataset.path, rows[6].dataset.path];
    });
    // DOM focus on the focused row itself (where applySort puts it) survives
    // the patch too.
    await page.evaluate(() => findRowByPath(browserState.focus).focus({ preventScroll: true }));
    const rendersBeforeF5 = await page.evaluate(() => window.__fpRenderCount);
    fs.writeFileSync(path.join(bigDir, 'aab-second-2d.txt'), 'y');
    fs.rmSync(path.join(bigDir, 'bulk-240.txt'));
    await page.keyboard.press('F5');
    await expect(rowByName(page, 'aab-second-2d.txt')).toHaveCount(1);
    await expect(rowByName(page, 'bulk-240.txt')).toHaveCount(0);
    expect(await page.locator('#list-scroll .fp-row[data-probe="1"]').getAttribute('data-path')).toBe(probed[0]);
    expect(await page.locator('#list-scroll .fp-row[data-probe="2"]').getAttribute('data-path')).toBe(probed[1]);
    // The patch inserted the new row in sorted position (second, after aaa-).
    expect(await page.evaluate(() => [...document.querySelectorAll('#list-scroll .fp-row__name')].slice(0, 3).map((n) => n.textContent)))
      .toEqual(['aaa-new-2d.txt', 'aab-second-2d.txt', 'bulk-001.txt']);
    // A patch is not a render.
    expect(await page.evaluate(() => window.__fpRenderCount)).toBe(rendersBeforeF5);
    await expect(rowByName(page, someVisibleName)).toHaveClass(/fp-row--selected/);
    expect(await page.evaluate(() => document.activeElement?.dataset?.path)).toBe(await rowByName(page, someVisibleName).getAttribute('data-path'));
    // An F5 with nothing changed on disk touches nothing.
    await page.evaluate(() => refreshAll());
    expect(await page.locator('#list-scroll .fp-row[data-probe="1"]').count()).toBe(1);
    expect(await page.evaluate(() => window.__fpRenderCount)).toBe(rendersBeforeF5);

    // ── 5. tab switch paints the cached listing synchronously ───────────────
    const tab1Id = await page.evaluate(() => tabs.activeId);
    const tab1Scroll = await page.evaluate(() => document.getElementById('list-scroll').scrollTop);
    await page.keyboard.press('Control+t');
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    const docsCount = await page.locator('#list-scroll .fp-row').count();
    const tab2Id = await page.evaluate(() => tabs.activeId);
    const atSwitch = await page.evaluate((id) => {
      const n0 = window.__fpRenderCount;
      activateTab(id);
      const ls = document.getElementById('list-scroll');
      return {
        rows: ls.querySelectorAll('.fp-row').length,
        scrollTop: ls.scrollTop,
        selected: [...ls.querySelectorAll('.fp-row--selected .fp-row__name')].map((n) => n.textContent),
        crumb: document.querySelector('#breadcrumb .fp-breadcrumb__crumb--current')?.textContent,
        renders: window.__fpRenderCount - n0,
      };
    }, tab1Id);
    expect(atSwitch.rows).toBe(241);
    expect(atSwitch.scrollTop).toBe(tab1Scroll);
    expect(atSwitch.selected).toEqual([someVisibleName]);
    expect(atSwitch.crumb).toBe('Bulk');
    expect(atSwitch.renders).toBe(1);
    // The background revalidation found nothing new: still exactly one render.
    await page.waitForFunction(() => !window.__fpLoadPending);
    const rendersAfterSwitch = await page.evaluate(() => window.__fpRenderCount);
    // Back to tab 2, synchronously too.
    const docsAtSwitch = await page.evaluate((id) => { activateTab(id); return document.querySelectorAll('#list-scroll .fp-row').length; }, tab2Id);
    expect(docsAtSwitch).toBe(docsCount);
    await page.waitForFunction(() => !window.__fpLoadPending);
    expect(await page.evaluate(() => window.__fpRenderCount)).toBe(rendersAfterSwitch + 1);

    // A file added on disk while a tab was in the background shows up after
    // the switch back (revalidation patches it in).
    fs.writeFileSync(path.join(bigDir, 'aac-background-2d.txt'), 'z');
    await page.evaluate((id) => activateTab(id), tab1Id);
    await expect(rowByName(page, 'aac-background-2d.txt')).toHaveCount(1);
    expect(await page.evaluate(() => document.getElementById('list-scroll').scrollTop)).toBe(tab1Scroll);

    // ── 7. race: navigation started, then an immediate tab switch ───────────
    await page.evaluate((args) => {
      window.__fpRaceLoad = openBrowserAt(args.music);   // deliberately not awaited here
      activateTab(args.tab2);
    }, { music: musicDir, tab2: tab2Id });
    await page.evaluate(() => window.__fpRaceLoad);       // the abandoned load has fully settled
    await page.waitForFunction(() => !window.__fpLoadPending);
    await expect(crumbCurrent).toHaveText('Documents');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(docsCount);
    expect(await page.evaluate(() => tabs.activeId)).toBe(tab2Id);

    // Refresh marks every other tab stale; activating it clears the flag.
    await page.evaluate(() => refreshAll());
    expect(await page.evaluate((id) => tabs.list.find((t) => t.id === id).stale, tab1Id)).toBe(true);
    await page.evaluate((id) => activateTab(id), tab1Id);
    expect(await page.evaluate((id) => tabs.list.find((t) => t.id === id).stale, tab1Id)).toBe(false);
    await page.waitForFunction(() => !window.__fpLoadPending);

    // ── 4. one render per navigation ────────────────────────────────────────
    for (const [dir, crumb] of [[docsDir, 'Documents'], [picsDir, 'Pictures'], [bigDir, 'Bulk']]) {
      const n0 = await page.evaluate(() => window.__fpRenderCount);
      await page.evaluate((p) => openBrowserAt(p), dir);   // resolves once the load has landed
      await expect(crumbCurrent).toHaveText(crumb);
      expect(await page.evaluate(() => window.__fpRenderCount) - n0, `renders for ${crumb}`).toBe(1);
    }
    // Pictures decided grid on the way in, Bulk went back to details: the
    // view was decided before the single render, not fixed up after it.
    expect(await page.evaluate(() => document.getElementById('list-scroll').dataset.view)).toBe('details');
    // Back / Forward are navigations too.
    let n0 = await page.evaluate(() => window.__fpRenderCount);
    await page.evaluate(() => navBack());
    await expect(crumbCurrent).toHaveText('Pictures');
    await page.waitForFunction(() => !window.__fpLoadPending);
    expect(await page.evaluate(() => window.__fpRenderCount) - n0).toBe(1);
    n0 = await page.evaluate(() => window.__fpRenderCount);
    await page.evaluate(() => navForward());
    await expect(crumbCurrent).toHaveText('Bulk');
    await page.waitForFunction(() => !window.__fpLoadPending);
    expect(await page.evaluate(() => window.__fpRenderCount) - n0).toBe(1);

    // A Back whose folder has gone is not a navigation: nav.index stays, and a
    // Forward right after it has nowhere to go (it used to step on from the
    // failed Back's target and re-open the current folder).
    const goneBack = `${root}\\GoneBack-2d`;
    fs.mkdirSync(goneBack);
    await page.evaluate((p) => openBrowserAt(p), goneBack);
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    fs.rmSync(goneBack, { recursive: true, force: true });
    const histAtDocs = await page.evaluate(() => [nav.history.length, nav.index]);
    await page.evaluate(() => navBack());
    await expect(page.locator('#toast-container .fp-toast--error')).toHaveCount(1);
    await expect(crumbCurrent).toHaveText('Documents');
    expect(await page.evaluate(() => [nav.history.length, nav.index])).toEqual(histAtDocs);
    expect(await page.evaluate(() => pendingHistoryIndex() === nav.index)).toBe(true);
    await expect(page.locator('[data-action="nav-forward"]')).toBeDisabled();
    n0 = await page.evaluate(() => window.__fpRenderCount);
    expect(await page.evaluate(() => navForward() === undefined)).toBe(true);
    expect(await page.evaluate(() => window.__fpRenderCount)).toBe(n0);
    await page.locator('#toast-container .fp-toast--error button').click();

    // ── 6. refresh of a folder deleted on disk keeps the listing ────────────
    const doomed = `${root}\\Doomed`;
    fs.mkdirSync(doomed);
    fs.writeFileSync(path.join(doomed, 'still-here.txt'), 'x');
    await page.evaluate((p) => openBrowserAt(p), doomed);
    await expect(crumbCurrent).toHaveText('Doomed');
    await expect(rowByName(page, 'still-here.txt')).toHaveCount(1);
    const histBefore = await page.evaluate(() => [nav.history.length, nav.index]);
    fs.rmSync(doomed, { recursive: true, force: true });
    await page.keyboard.press('Control+r');
    await expect(page.locator('#toast-container .fp-toast--error')).toHaveCount(1);
    await expect(rowByName(page, 'still-here.txt')).toHaveCount(1);
    await expect(page.locator('#list-scroll .fp-error-banner')).toHaveCount(0);
    await expect(crumbCurrent).toHaveText('Doomed');
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Doomed');
    expect(await page.evaluate(() => [nav.history.length, nav.index])).toEqual(histBefore);
    await expect(page.locator('#inspector-filename')).toHaveText('No file selected'); // inspector settled
    await shot(page, 'refresh-deleted-folder-keeps-listing');
    await page.locator('#toast-container .fp-toast--error button').click();

    // pass-2 #55: a failed navigation leaves the path, breadcrumb, tab label
    // and history on the folder that is still on screen.
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Nowhere-2d`);
    await expect(page.locator('#toast-container .fp-toast--error')).toHaveCount(1);
    await expect(crumbCurrent).toHaveText('Doomed');
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Doomed');
    expect(await page.evaluate(() => browserState.path)).toBe(doomed);
    expect(await page.evaluate(() => [nav.history.length, nav.index])).toEqual(histBefore);
    await expect(rowByName(page, 'still-here.txt')).toHaveCount(1);
    await page.locator('#toast-container .fp-toast--error button').click();

    // ── 8. no menu bar on Alt, no default devtools accelerator, no navigation ─
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await nativeKey(app, 'Alt');
    await settleKeys(app, page);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
    await nativeKey(app, 'I', ['control', 'shift']);
    await settleKeys(app, page);
    expect((await mainCounters(app)).devtools).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened())).toBe(false);
    // A renderer-initiated navigation away from the app (what a file dropped
    // onto the window would do) is refused; the app's own page is not. Driven
    // through the handler itself: a real blocked navigation leaves Playwright
    // waiting for a navigation that never finishes.
    const verdicts = await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const probe = (url) => {
        let prevented = false;
        const ev = { url, preventDefault() { prevented = true; } };
        wc.emit('will-navigate', ev, url);
        return prevented;
      };
      return { away: probe('file:///C:/Windows/win.ini'), self: probe(wc.getURL()) };
    });
    expect(verdicts).toEqual({ away: true, self: false });
    // window.open never makes a second window (the denial is answered before
    // window.open returns, so its null result is the settled answer).
    expect(await page.evaluate(() => window.open('https://example.com') === null)).toBe(true);
    expect((await mainCounters(app)).windows).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // ── Ctrl+R / F5 are ignored while a modal (here the palette) is open ────
    // Dispatched in the page and read back in the same task, so the answer
    // cannot race the key event. The first call is the control: no modal.
    const pressRefreshKeys = () => page.evaluate(() => {
      const spinning = () => document.getElementById('btn-refresh').classList.contains('is-spinning');
      const out = [];
      for (const init of [{ key: 'F5' }, { key: 'r', ctrlKey: true }]) {
        document.getElementById('btn-refresh').classList.remove('is-spinning');
        const ev = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
        document.dispatchEvent(ev);
        out.push({ spun: spinning(), prevented: ev.defaultPrevented });
      }
      return out;
    });
    expect(await pressRefreshKeys()).toEqual([{ spun: true, prevented: true }, { spun: true, prevented: true }]);
    await page.waitForFunction(() => !window.__fpLoadPending);
    await page.evaluate(() => openPalette());
    await expect(page.locator('#palette-scrim')).toBeVisible();
    expect(await pressRefreshKeys()).toEqual([{ spun: false, prevented: true }, { spun: false, prevented: true }]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette-scrim')).toBeHidden();

    // ── An inline rename in progress survives a refresh (fix round 1) ───────
    // Blurring the rename input commits it, so a refresh must neither take
    // focus from it nor rebuild its row — not on a small patch, not on a
    // change big enough for a full render.
    const renameZone = `${root}\\RenameZone`;
    fs.mkdirSync(renameZone);
    for (let i = 1; i <= 10; i++) fs.writeFileSync(path.join(renameZone, `rz-${String(i).padStart(2, '0')}.txt`), `rz ${i}`);
    await page.evaluate((p) => openBrowserAt(p), renameZone);
    await expect(crumbCurrent).toHaveText('RenameZone');
    await page.evaluate((p) => startInlineRename(p), `${renameZone}\\rz-03.txt`);
    const renameInput = page.locator('#list-scroll .fp-row__rename');
    await expect(renameInput).toBeFocused();
    await page.keyboard.type('half');                       // replaces the selected stem
    await expect(renameInput).toHaveValue('half.txt');
    fs.writeFileSync(path.join(renameZone, 'rz-00-new.txt'), 'n');
    await page.evaluate(() => refreshDirectory());
    await expect(rowByName(page, 'rz-00-new.txt')).toHaveCount(1);
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('half.txt');
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(renameZone, `rz-50-bulk-${i}.txt`), 'b'); // > 30% changed
    await page.evaluate(() => refreshAll());
    await expect(rowByName(page, 'rz-50-bulk-7.txt')).toHaveCount(1);
    await expect(renameInput).toBeFocused();
    await expect(renameInput).toHaveValue('half.txt');
    expect(fs.existsSync(path.join(renameZone, 'rz-03.txt'))).toBe(true);
    expect(fs.existsSync(path.join(renameZone, 'half.txt'))).toBe(false);
    await page.keyboard.press('Escape');                    // cancel: nothing renamed
    await expect(renameInput).toHaveCount(0);
    await expect(rowByName(page, 'rz-03.txt')).toHaveCount(1);
    expect(fs.existsSync(path.join(renameZone, 'half.txt'))).toBe(false);

    // ── A failed navigation out of search results keeps the results ─────────
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    const searchGone = `${docsDir}\\zz-search-gone-2d`;
    fs.mkdirSync(searchGone);
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      input.value = 'zz-search-gone';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(rowByName(page, 'zz-search-gone-2d')).toHaveCount(1, { timeout: 5000 });
    await page.waitForFunction(() => browserState.mode === 'search' && !searchState.inflight);
    fs.rmSync(searchGone, { recursive: true, force: true });
    await page.evaluate((p) => loadDirectory(p), searchGone);  // what opening the result row does
    await expect(page.locator('#toast-container .fp-toast--error')).toHaveCount(1);
    expect(await page.evaluate(() => browserState.mode)).toBe('search');
    await expect(rowByName(page, 'zz-search-gone-2d')).toHaveCount(1);
    await expect(page.locator('#list-search-header')).toBeVisible();
    await expect(page.locator('#list-scroll .fp-error-banner')).toHaveCount(0);
    await page.locator('#toast-container .fp-toast--error button').click();
    await page.evaluate(() => clearSearch());
    await expect(crumbCurrent).toHaveText('Documents');
    expect(await page.evaluate(() => browserState.mode)).toBe('browse');

    // ── Opening a folder from Home keeps Home up until the listing lands ─────
    // The fetch is held in the page until released, so "while in flight" is a
    // state, not a race.
    const tabCount = await page.locator('.fp-tab').count();
    await page.keyboard.press('Control+t');
    await expect(page.locator('.fp-tab')).toHaveCount(tabCount + 1);
    await expect(page.locator('#screen-home')).toHaveClass(/active/);
    await page.evaluate((pics) => {
      window.__fpOrigGet = API.get;
      API.get = function (route, params, ...rest) {
        if (route === '/fs/list' && params && params.path === pics) {
          return new Promise((res) => { window.__fpRelease = res; })
            .then(() => window.__fpOrigGet.call(API, route, params, ...rest));
        }
        return window.__fpOrigGet.call(API, route, params, ...rest);
      };
      window.__fpHomeLoad = openBrowserAt(pics);
    }, picsDir);
    await page.waitForFunction(() => typeof window.__fpRelease === 'function');
    await expect(page.locator('#screen-home')).toHaveClass(/active/);
    await expect(page.locator('#screen-browser')).not.toHaveClass(/active/);
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Home');
    const rendersHeld = await page.evaluate(() => window.__fpRenderCount);
    await page.evaluate(async () => { window.__fpRelease(); await window.__fpHomeLoad; API.get = window.__fpOrigGet; });
    await expect(page.locator('#screen-browser')).toHaveClass(/active/);
    await expect(page.locator('#screen-home')).not.toHaveClass(/active/);
    await expect(crumbCurrent).toHaveText('Pictures');
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Pictures');
    expect(await page.evaluate(() => window.__fpRenderCount)).toBe(rendersHeld + 1);
    // …and a folder that cannot be opened leaves Home on screen.
    await page.keyboard.press('Control+t');
    await expect(page.locator('#screen-home')).toHaveClass(/active/);
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Nowhere-2d`);
    await expect(page.locator('#toast-container .fp-toast--error')).toHaveCount(1);
    await expect(page.locator('#screen-home')).toHaveClass(/active/);
    await expect(page.locator('#screen-browser')).not.toHaveClass(/active/);
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Home');
    expect(await page.evaluate(() => activeTab().screen)).toBe('home');
    await page.locator('#toast-container .fp-toast--error button').click();

    // ── Closed tabs drop their listing; the reopen stack is capped ──────────
    const closeId = await page.evaluate(() => {
      const t = tabs.list.find((r) => r.listing && r.id !== tabs.activeId);
      closeTabById(t.id);
      return t.id;
    });
    expect(await page.evaluate((id) => {
      const rec = _closedTabs[_closedTabs.length - 1];
      return rec.id === id && rec.listing === null && !!rec.path;
    }, closeId)).toBe(true);
    expect(await page.evaluate(() => {
      for (let i = 0; i < 25; i++) closeTabById(createTab({ screen: 'home', label: 'Home' }).id);
      return _closedTabs.length;
    })).toBe(20);

    // ── Edit shortcuts work natively in text inputs without the Edit menu ───
    // Sent through sendInputEvent, the route a real key press takes, so these
    // pass only if Chromium's own editing handles them (no Edit-menu roles).
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    const input = page.locator('#search-input');
    await input.click();
    await page.keyboard.type('zqx-2d');
    await expect(input).toHaveValue('zqx-2d');
    await nativeKey(app, 'A', ['control']);
    await nativeKey(app, 'X', ['control']);
    await settleKeys(app, page);
    expect(await input.inputValue()).toBe('');
    await nativeKey(app, 'V', ['control']);
    await settleKeys(app, page);
    expect(await input.inputValue()).toBe('zqx-2d');
    await nativeKey(app, 'Z', ['control']);                 // undo the paste
    await settleKeys(app, page);
    expect(await input.inputValue()).toBe('');
    await page.keyboard.press('Escape');

    expect(await mainCounters(app)).toEqual({ navigations: 0, devtools: 0, windows: 0 });
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin0);
    expect(unexpectedErrors(errors), errors.join('\n')).toEqual([]);
  } finally {
    await app.close();
  }
});
