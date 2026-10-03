// frontend/test/dnd-menus-pass2.spec.js
// Regression cover for the pass-2 "renderer-dragdrop-selection-menus"
// findings (#48-#52, #197-#202). One Electron launch, one page; the sections
// run in order and each restores the state it borrowed (view mode, click
// mode, clipboard, selection, favorites) for the next one.
const { test, expect } = require('@playwright/test');
const { launchApp, resetToDefaults } = require('./harness/app');

const API = `http://127.0.0.1:${process.env.FILEPLUS_PORT || 9876}`;

test.setTimeout(180_000);

test('drag/drop, selection and menus: pass-2 regressions', async () => {
  // launchApp (harness): animations off, errors collected from the first
  // renderer line on (renderer.log, read at close), app ready. Then default
  // settings, waiting for the reloaded app to be ready again — not a sleep.
  const { app, page, errors } = await launchApp();
  try {
    await resetToDefaults(page);
    // Settle signals instead of sleeps: no folder load in flight (a click
    // that navigates starts its load synchronously, so once this holds any
    // navigation it caused has landed), and the inspector caught up with the
    // selection (debounce fired, fetches landed).
    const navSettled = () => page.waitForFunction(() => !window.__fpLoadPending);
    const inspectorSettled = () => page.waitForFunction(() => window.__fpInspectorPending === 0);

    const token = process.env.FILEPLUS_API_TOKEN;
    const headers = token ? { 'X-FilePlus-Token': token } : {};
    const root = (await (await fetch(`${API}/fs/list/root`, { headers })).json()).path;
    const genDir = `${root}\\_gen`;
    const docsDir = `${genDir}\\Documents`;
    const picsDir = `${genDir}\\Pictures`;
    const oldDir = `${docsDir}\\old`;

    const crumbCurrent = page.locator('#breadcrumb .fp-breadcrumb__crumb--current');
    const searchHeader = page.locator('#list-search-header');

    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');

    // ── #48  The marquee is drawn where the pointer is ───────────────────────
    // #marquee-rect is position:absolute inside #screen-browser, so viewport
    // coordinates written straight into left/top painted the band a sidebar
    // width right and a chrome height down from the drag (and .content's
    // overflow:hidden then clipped it away).
    const marquee = await page.evaluate(() => {
      const ls = document.getElementById('list-scroll');
      const box = ls.getBoundingClientRect();
      const x0 = Math.round(box.left + 24), y0 = Math.round(box.top + 24);
      const x1 = x0 + 80, y1 = y0 + 60;
      // Dispatched on #list-scroll itself, so e.target is never a row.
      ls.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x0, clientY: y0 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x1, clientY: y1 }));
      const r = document.getElementById('marquee-rect').getBoundingClientRect();
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return { left: r.left, top: r.top, width: r.width, height: r.height, x0, y0 };
    });
    expect(Math.abs(marquee.left - marquee.x0)).toBeLessThanOrEqual(2);
    expect(Math.abs(marquee.top - marquee.y0)).toBeLessThanOrEqual(2);
    expect(Math.abs(marquee.width - 80)).toBeLessThanOrEqual(2);
    expect(Math.abs(marquee.height - 60)).toBeLessThanOrEqual(2);
    await page.evaluate(() => clearSelection());

    // ── #198  Single-click mode: a MODIFIED click selects, never opens ───────
    await page.evaluate(() => { window.__fpConfig = window.__fpConfig || {}; window.__fpConfig['ui.click_mode'] = 'single'; });
    const firstFolderRow = page.locator('#list-scroll .fp-row[data-type="folder"]').first();
    await firstFolderRow.click({ modifiers: ['Control'] });
    await navSettled();
    await expect(crumbCurrent).toHaveText('Documents');           // did not navigate
    expect(await page.evaluate(() => browserState.selection.size)).toBe(1);
    await firstFolderRow.click({ modifiers: ['Shift'] });
    await navSettled();
    await expect(crumbCurrent).toHaveText('Documents');
    // …and an UNmodified click still opens the folder in this mode.
    await firstFolderRow.click();
    await expect(crumbCurrent).toHaveText('old');
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    await page.evaluate(() => { window.__fpConfig['ui.click_mode'] = 'double'; });

    // ── #50  Ctrl+C / Ctrl+X never clear a good clipboard ────────────────────
    const firstFileRow = page.locator('#list-scroll .fp-row[data-type="file"]').first();
    await firstFileRow.click();
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const sel = window.getSelection(); if (sel) sel.removeAllRanges();
    });
    await page.keyboard.press('Control+c');
    expect(await page.evaluate(() => fileops.clipboardCount())).toBe(1);
    const copied = await page.evaluate(() => fileops.clipboard.paths[0]);
    // Deselect, then press again: the clipboard must survive untouched.
    await page.evaluate(() => clearSelection());
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+x');
    expect(await page.evaluate(() => fileops.clipboardCount())).toBe(1);
    expect(await page.evaluate(() => fileops.clipboard.paths[0])).toBe(copied);
    expect(await page.evaluate(() => fileops.clipboard.mode)).toBe('copy');
    // The fileops entry points guard themselves too (the context menu's
    // Cut/Copy reach them without going through browserKeydown).
    await page.evaluate(() => { fileops.copySelection(); fileops.cutSelection(); });
    expect(await page.evaluate(() => fileops.clipboardCount())).toBe(1);
    expect(await page.evaluate(() => fileops.clipboard.mode)).toBe('copy');

    // ── #49 / #197  Drop targets are judged against the DRAG, not the screen ─
    const violations = await page.evaluate(({ docsDir, picsDir, oldDir }) => {
      const fileInDocs = `${docsDir}\\doc-00.txt`;
      return {
        sibling: dropViolation(picsDir, [fileInDocs]),        // null — a real move
        ownParent: dropViolation(docsDir, [fileInDocs]),      // 'current' — already there
        subfolder: dropViolation(oldDir, [fileInDocs]),       // null — one level down
        itself: dropViolation(oldDir, [oldDir]),              // 'self'
        inside: dropViolation(`${oldDir}\\x`, [oldDir]),      // 'descendant'
      };
    }, { docsDir, picsDir, oldDir });
    expect(violations).toEqual({
      sibling: null, ownParent: 'current', subfolder: null, itself: 'self', inside: 'descendant',
    });

    // The spring-load case: navigate into the folder mid-drag, then ask again.
    // The folder now on screen used to answer 'current' (the drag's dead end),
    // and its parent — where every dragged item already lives — used to answer
    // null and fire a move of each file into its own directory.
    await page.evaluate((p) => openBrowserAt(p), oldDir);
    await expect(crumbCurrent).toHaveText('old');
    const sprung = await page.evaluate(({ docsDir, oldDir }) => {
      const fileInDocs = `${docsDir}\\doc-00.txt`;
      return { intoSprungFolder: dropViolation(oldDir, [fileInDocs]), backToParent: dropViolation(docsDir, [fileInDocs]) };
    }, { docsDir, oldDir });
    expect(sprung.intoSprungFolder).toBeNull();
    expect(sprung.backToParent).toBe('current');

    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');

    // resolveDropTarget: the listing background resolves to the folder on
    // screen, and the Up button is refused in search mode (where it navigates
    // somewhere else entirely).
    const targets = await page.evaluate(({ docsDir, picsDir }) => {
      const strip = t => (t ? { kind: t.kind, path: t.path } : null);
      const at = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; };
      const fileRow = document.querySelector('#list-scroll .fp-row[data-type="file"]');
      const [fx, fy] = at(fileRow);
      const [ux, uy] = at(document.getElementById('btn-up'));
      const out = {};
      dragSession.active = true;
      dragSession.paths = [`${picsDir}\\photo-00.jpg`];   // dragged from elsewhere
      out.listFromElsewhere = strip(resolveDropTarget(fx, fy));
      out.upInBrowse = strip(resolveDropTarget(ux, uy));
      dragSession.paths = [`${docsDir}\\doc-00.txt`];     // already in this folder
      out.listFromHere = strip(resolveDropTarget(fx, fy));
      dragSession.active = false;
      dragSession.paths = [];
      out.currentPath = browserState.path;
      out.up = { ux, uy };
      return out;
    }, { docsDir, picsDir });
    expect(targets.listFromElsewhere).toEqual({ kind: 'list', path: targets.currentPath });
    expect(targets.upInBrowse && targets.upInBrowse.kind).toBe('up');
    expect(targets.listFromHere).toBeNull();

    // ── #51  New folder / New file / Paste are refused over search results ───
    await page.evaluate(() => { setSearchText('doc-0'); return runSearch(); });
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 8000 });

    const upInSearch = await page.evaluate(({ picsDir, ux, uy }) => {
      dragSession.active = true;
      dragSession.paths = [`${picsDir}\\photo-00.jpg`];
      const t = resolveDropTarget(ux, uy);
      dragSession.active = false;
      dragSession.paths = [];
      return t ? { kind: t.kind, path: t.path } : null;
    }, { picsDir, ux: targets.up.ux, uy: targets.up.uy });
    expect(upInSearch).toBeNull();

    const menuInSearch = await page.evaluate(({ docsDir }) => {
      fileops.clipboard = { mode: 'copy', paths: [`${docsDir}\\doc-00.txt`] };
      const ls = document.getElementById('list-scroll');
      const b = ls.getBoundingClientRect();
      ls.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: Math.round(b.left + 30), clientY: Math.round(b.top + 30),
      }));
      const items = {};
      document.querySelectorAll('#context-menu .fp-context-menu__item').forEach(btn => {
        items[btn.dataset.action] = btn.classList.contains('fp-context-menu__item--disabled');
      });
      hideContextMenu();
      return items;
    }, { docsDir });
    expect(menuInSearch['cm-new-folder']).toBe(true);
    expect(menuInSearch['cm-new-file']).toBe(true);
    expect(menuInSearch['cm-paste']).toBe(true);

    // Ctrl+V takes the same refusal rather than pasting into the invisible
    // pre-search folder.
    await page.evaluate(() => {
      window.__pasteCalls = 0;
      window.__origPaste = fileops.pasteInto;
      fileops.pasteInto = async function (dir) { window.__pasteCalls++; return undefined; };
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
    await page.keyboard.press('Control+v');
    // The refusal is the handled key's own answer: its error toast.
    await expect(page.locator('#toast-container .fp-toast--error', { hasText: 'Leave search results to paste here' })).toHaveCount(1);
    expect(await page.evaluate(() => window.__pasteCalls)).toBe(0);

    await page.evaluate(() => clearSearch());
    await page.waitForFunction(() => browserState.mode !== 'search' && !window.__fpLoadPending);
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await page.keyboard.press('Control+v');
    await expect.poll(() => page.evaluate(() => window.__pasteCalls)).toBe(1);   // allowed again outside search
    await page.evaluate(() => {
      fileops.pasteInto = window.__origPaste;
      fileops.clipboard = { mode: null, paths: [] };
    });

    const menuOutOfSearch = await page.evaluate(() => {
      const ls = document.getElementById('list-scroll');
      const b = ls.getBoundingClientRect();
      ls.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: Math.round(b.left + 30), clientY: Math.round(b.top + 30),
      }));
      const items = {};
      document.querySelectorAll('#context-menu .fp-context-menu__item').forEach(btn => {
        items[btn.dataset.action] = btn.classList.contains('fp-context-menu__item--disabled');
      });
      hideContextMenu();
      return items;
    });
    expect(menuOutOfSearch['cm-new-folder']).toBe(false);
    expect(menuOutOfSearch['cm-new-file']).toBe(false);

    // ── #199 / #200  The Inspector never tags a file that isn't selected ─────
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    const fileA = `${docsDir}\\doc-00.txt`;
    const fileB = `${docsDir}\\doc-01.txt`;
    await page.evaluate((p) => selectRow(p), fileA);
    await inspectorSettled();
    await page.evaluate(() => { _inspectorFileId = 999999; });       // stand in for a settled single inspection
    await page.evaluate(([a, b]) => { selectRow(a); selectRow(b, { ctrl: true }); }, [fileA, fileB]);
    await inspectorSettled();
    expect(await page.evaluate(() => browserState.selection.size)).toBe(2);
    expect(await page.evaluate(() => _inspectorFileId)).toBeNull();

    // …and "Add tag…" is honest about it: single selection only.
    const tagItem = await page.evaluate((p) => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row[data-path]')].find(r => r.dataset.path === p);
      const b = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: Math.round(b.left + 20), clientY: Math.round(b.top + 4),
      }));
      const btn = document.querySelector('#context-menu .fp-context-menu__item[data-action="cm-add-tag"]');
      const disabled = btn ? btn.classList.contains('fp-context-menu__item--disabled') : null;
      hideContextMenu();
      return disabled;
    }, fileA);
    expect(tagItem).toBe(true);

    // #200 — switching to a single-file pane restores the chrome multi hid.
    const chrome = await page.evaluate(() => {
      updateInspector('multi', { count: 2 });
      switchInspectorTab('tags');
      const inspector = document.getElementById('inspector');
      return {
        tabBar: inspector.querySelector('.fp-tabs.fp-inspector__tabs').hidden,
        preview: document.getElementById('inspector-preview').hidden,
      };
    });
    expect(chrome).toEqual({ tabBar: false, preview: false });

    // ── #201 / #52  A partly failed favourites batch still resyncs ───────────
    await page.evaluate(([a, b]) => { selectRow(a); selectRow(b, { ctrl: true }); }, [fileA, fileB]);
    await inspectorSettled();
    const favResult = await page.evaluate(async ([good, bad]) => {
      const orig = API.post.bind(API);
      API.post = (route, body) => (route === '/favorites' && body && body.path === bad)
        ? Promise.reject(new Error('simulated failure'))
        : orig(route, body);
      document.body.insertAdjacentHTML('beforeend', '<button id="fav-probe" data-action="cm-favorite"></button>');
      document.getElementById('fav-probe').click();
      // The batch is done — requests settled, favorites and listing resynced
      // — when it reports the one failure (its last step); 10 s cap.
      const deadline = Date.now() + 10_000;
      while (![...document.querySelectorAll('#toast-container .fp-toast--error')]
        .some((t) => /Failed to add 1 of 2/.test(t.textContent)) && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50));
      }
      API.post = orig;
      document.getElementById('fav-probe').remove();
      return { good: favoritesHas(good), bad: favoritesHas(bad) };
    }, [fileA, fileB]);
    // The request that succeeded is reflected everywhere, even though its
    // sibling rejected (Promise.all used to skip the resync entirely).
    expect(favResult.good).toBe(true);
    expect(favResult.bad).toBe(false);

    // #52 — a star toggled outside the Browser repaints the rendered rows,
    // with no directory re-fetch.
    await page.evaluate(async (p) => { await API.del('/favorites', { path: p }); await favoritesReload(); }, fileA);
    expect(await page.evaluate((p) => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row[data-path]')].find(r => r.dataset.path === p);
      return !!row.querySelector('.fp-row__star');
    }, fileA)).toBe(false);
    await page.evaluate(async (p) => { await API.post('/favorites', { path: p }); await favoritesReload(); }, fileA);
    expect(await page.evaluate((p) => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row[data-path]')].find(r => r.dataset.path === p);
      return !!row.querySelector('.fp-row__star');
    }, fileA)).toBe(true);
    await page.evaluate(async (p) => { await API.del('/favorites', { path: p }); await favoritesReload(); }, fileA);

    // ── #202  Every Ctrl+wheel step checks exactly one View-menu item ────────
    const checks = await page.evaluate(() => {
      const view = browserState.view, size = browserState.iconSize;
      const out = VIEW_LADDER.map(step => {
        browserState.view = step.view;
        if (step.size) browserState.iconSize = step.size;
        const ctx = menuContext();
        const on = VIEW_MENU_ITEMS.filter(i => i !== 'sep' && /^view-/.test(i.action) && i.checked(ctx));
        return [step.view + (step.size ? `@${step.size}` : ''), on.length === 1 ? on[0].action : `${on.length} checked`];
      });
      browserState.view = view; browserState.iconSize = size;
      return out;
    });
    // Exactly one item checked at every Ctrl+wheel step; an icon size lands in
    // its named bucket (< 80 Medium, < 192 Large, else Extra large — §3.1).
    expect(checks).toEqual([
      ['content', 'view-content'], ['tiles', 'view-tiles'], ['details', 'view-details'], ['list', 'view-list'],
      ['small', 'view-small'], ['icons@48', 'view-medium'], ['icons@56', 'view-medium'], ['icons@64', 'view-medium'],
      ['icons@72', 'view-medium'], ['icons@80', 'view-large'], ['icons@96', 'view-large'], ['icons@112', 'view-large'],
      ['icons@128', 'view-large'], ['icons@160', 'view-large'], ['icons@192', 'view-xl'], ['icons@224', 'view-xl'],
      ['icons@256', 'view-xl'],
    ]);

    await page.evaluate(() => clearSelection());
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
