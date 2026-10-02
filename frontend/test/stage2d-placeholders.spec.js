// frontend/test/stage2d-placeholders.spec.js
// Stage 2D Task 12a (spec §12, controller ruling A): no control ships that
// does nothing when clicked. Screens and Settings panes that belong to
// unbuilt stages (Everything Folder, Review Bin, Scan, File Tree, AI,
// tagging rules, Downloads inbox, snapshots) are gone from the DOM, not
// greyed; the Settings panes that can be real now (About, Shortcuts, Data)
// are wired to real data; and a sweep clicks every visible data-action
// control on every screen and asserts the "not yet implemented" stub branch
// (app.js's switch default, counted on window.__fpStubHits) is never hit.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, shot, apiGet, apiHeaders, API, FRONTEND, REPO, rowByName, resetToDefaults, expectNoErrors } = require('./harness/app');
const { resolveLogDir } = require('../logger');

test.setTimeout(240_000);

const APP_JS = fs.readFileSync(path.join(FRONTEND, 'src', 'app.js'), 'utf8');
const SWITCH_CASES = new Set([...APP_JS.matchAll(/case '([\w-]+)':/g)].map((m) => m[1]));
const LOG_DIR = resolveLogDir(REPO, process.env);
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'package.json'), 'utf8')).version;

const UNBUILT_SCREENS = ['ftree', 'scan-config', 'scan-progress', 'scan-results', 'review-bin', 'everything'];
const SETTINGS_PANES = ['personalization', 'scan-index', 'shortcuts', 'data', 'about'];

async function api(method, route, body) {
  const r = await fetch(`${API}${route}`, {
    method,
    headers: apiHeaders(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}`);
  return r.json().catch(() => null);
}

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
  step(k);
}), n);

// Replaces the main process's shell.openPath / showItemInFolder with
// recorders, so a swept or tested control never opens a window on the
// desktop. `answer` is what openPath resolves ('' = success, else Electron's
// error string).
async function stubShell(app, answer = '') {
  await app.evaluate(({ shell }, a) => {
    globalThis.__fpOpened = [];
    shell.openPath = async (p) => { globalThis.__fpOpened.push(p); return a; };
    shell.showItemInFolder = (p) => { globalThis.__fpOpened.push(p); };
  }, answer);
}
const opened = (app) => app.evaluate(() => globalThis.__fpOpened || []);

// Puts the backend config back the way it was before a test that clicks
// settings controls, then re-applies it in the page.
async function restoreConfig(page, before) {
  const now = await apiGet('/config');
  for (const key of Object.keys(now)) {
    if (!(key in before)) await api('DELETE', `/config/${encodeURIComponent(key)}`);
    else if (JSON.stringify(now[key]) !== JSON.stringify(before[key])) await api('POST', '/config', { key, value: before[key] });
  }
  for (const key of Object.keys(before)) {
    if (!(key in now)) await api('POST', '/config', { key, value: before[key] });
  }
  await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); });
}

test('unbuilt screens, Settings panes and their controls are gone, not greyed', async () => {
  const { app, page, errors } = await launchApp();
  try {
    for (const id of UNBUILT_SCREENS) {
      await expect(page.locator(`#screen-${id}`)).toHaveCount(0);
      await expect(page.locator(`[data-screen="${id}"]`)).toHaveCount(0);
    }
    // A stale call (an old tab record, a leftover shortcut) leaves the tab
    // where it is rather than blanking it on a screen that does not exist.
    await page.evaluate(() => switchScreen('home'));
    await page.evaluate(() => switchScreen('review-bin'));
    await expect(page.locator('#screen-home')).toBeVisible();
    expect(await page.evaluate(() => activeTab().screen)).toBe('home');
    await page.keyboard.press('Control+Shift+R');
    await expect(page.locator('#screen-home')).toBeVisible();

    // Sidebar: no Review Bin, File Tree, Scan or Everything Folder entries.
    for (const id of ['nav-review-bin', 'nav-ftree', 'nav-scan', 'nav-everything']) {
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
    // Home: no "Shared" sub-tab for a feature that does not exist.
    await expect(page.locator('#home-tabs [data-tab="shared"]')).toHaveCount(0);
    // Palette: no AI chat mode, no commands for hidden screens.
    await page.evaluate(() => openPalette());
    await expect(page.locator('#palette-mode-toggle')).toHaveCount(0);
    await expect(page.locator('#palette-chat-pane')).toHaveCount(0);
    await expect(page.locator('#palette-commands .fp-palette__item', { hasText: /Review Bin|scan/i })).toHaveCount(0);
    // …no preview pane nothing ever filled, and the footer only names keys
    // that do something (no "# tags", "/ paths", "⇥ action", "> commands").
    await expect(page.locator('#palette-preview')).toHaveCount(0);
    expect(await page.locator('.fp-palette__footer .fp-palette__hint').allTextContents())
      .toEqual(['↑↓ navigate', '⏎ open', 'Esc close']);
    // Shortcut hints are Windows keys, and say what the key really does.
    expect(await page.locator('#palette-commands .fp-palette__kbd').allTextContents()).toEqual(['Ctrl+B', 'Ctrl+I', 'Ctrl+,']);
    await page.evaluate(() => closePalette());

    // Settings: exactly the panes that are real today, in nav and in content.
    await page.evaluate(() => switchScreen('settings'));
    expect(await page.$$eval('.settings-nav__item', (els) => els.map((e) => e.dataset.pane))).toEqual(SETTINGS_PANES);
    expect(await page.$$eval('#screen-settings .settings-pane', (els) => els.map((e) => e.dataset.pane))).toEqual(SETTINGS_PANES);
    // No greyed-out "planned" control anywhere in Settings, no rebinding rows,
    // no stale fake numbers.
    await expect(page.locator('#screen-settings [title*="Planned for Stage"]')).toHaveCount(0);
    await expect(page.locator('#screen-settings input[disabled], #screen-settings select[disabled]')).toHaveCount(0);
    await expect(page.locator('[data-action="settings-rebind"]')).toHaveCount(0);
    for (const fake of ['142 MB', '214,823', 'llama3.1', '2.4 GB', 'main@77b006d']) {
      await expect(page.locator('#screen-settings', { hasText: fake })).toHaveCount(0);
    }
    // A pane remembered from before it was hidden falls back to the first one.
    await page.evaluate(() => { sessionStorage.setItem('fp-settings-pane', 'ai-config'); restoreSettingsPane(); });
    await expect(page.locator('.settings-pane[data-pane="personalization"]')).toBeVisible();
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

test('the stub counter works (a bogus action is counted)', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const hits = await page.evaluate(() => {
      window.__fpStubHits = 0;
      const b = document.createElement('button');
      b.dataset.action = 'definitely-not-an-action';
      document.body.appendChild(b);
      b.click();
      b.remove();
      const n = window.__fpStubHits;
      window.__fpStubHits = 0;
      return n;
    });
    expect(hits).toBe(1);
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

// Actions whose click would leave the test (launch another program, open a
// native dialog, close/minimize the window) or change shared run state
// another spec relies on. They are not clicked; they must have a switch case
// or an IN_SCOPE_ACTIONS entry (a listener of their own) instead.
const NOT_CLICKED = new Set([
  'window-close', 'window-minimize', 'window-maximize',
  'settings-index-add', 'settings-index-reindex', 'settings-index-remove',
  'settings-clear-recent',
  'inspector-open', 'open-file-with', 'inspector-reveal',
  'open-recent-file', 'open-file', 'reveal-file', 'home-toggle-favorite', 'unfavorite-file',
  'props-open-with', 'props-advanced', 'props-apply',
  // Real changes the sweep must not make: undoing a logged operation and
  // removing a tag act on the run's data, and Copy path writes the real OS
  // clipboard (the developer's own, outside the test). Task 12b.
  'inspector-undo-op', 'inspector-remove-tag', 'copy-path',
]);

test('every visible control on every screen reaches a real handler, never the stub', async () => {
  const { app, page, errors } = await launchApp();
  const configBefore = await apiGet('/config');
  const root = (await apiGet('/fs/list/root')).path;
  const gallery = `${root}\\Views\\Gallery`;
  const inScope = new Set(await page.evaluate(() => [...IN_SCOPE_ACTIONS]));
  const handled = (a) => SWITCH_CASES.has(a) || inScope.has(a);
  const clicked = {};
  const unclickedButHandled = [];
  const unhandled = [];
  try {
    await stubShell(app);
    await page.evaluate(() => { window.__fpStubHits = 0; });

    const ensureFolder = async () => {
      await page.waitForFunction(() => !window.__fpLoadPending, null, { timeout: 20_000 });
      await page.evaluate(async (p) => {
        const onIt = document.getElementById('screen-browser').classList.contains('active')
          && fpNormalizePath(browserState.path || '') === fpNormalizePath(p) && browserState.mode !== 'search';
        if (!onIt) await openBrowserAt(p);
      }, gallery);
      await page.waitForFunction((p) => fpNormalizePath(browserState.path || '') === fpNormalizePath(p)
        && !window.__fpLoadPending && document.querySelectorAll('#list-scroll .fp-row').length > 0, gallery);
    };
    const ensureSelection = async () => {
      if (await page.evaluate(() => browserState.selection.size) !== 1) {
        await rowByName(page, 'photo-01.png').click();
      }
      await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    };
    const resetOverlays = async () => {
      await page.evaluate(() => {
        closePalette(); hideContextMenu(); closeModal(); closeTagCanvas(); closeProperties(); closeAskPopout();
        closeMoreFilters(); closeSearchDropdown();
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      });
    };

    // [name, root selector the sweep looks inside, setup()]
    const contexts = [
      ['chrome', '#titlebar, #sidebar, #tabbar, #toolbar, #statusbar', async () => {
        await ensureFolder();
        await page.evaluate(() => {
          if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar();
          setThisPcOpen(true, { persist: false });
        });
      }],
      ['home', '#screen-home', async () => { await page.evaluate(() => switchScreen('home')); }],
      ['folder', '#screen-browser, #inspector', async () => { await ensureFolder(); await ensureSelection(); }],
      ['view-menu', '#context-menu', async () => { await ensureFolder(); await page.locator('#btn-view-menu').click(); }],
      ['sort-menu', '#context-menu', async () => { await ensureFolder(); await page.locator('#btn-sort-menu').click(); }],
      ['properties', '#properties-modal-scrim', async () => {
        await ensureFolder();
        await page.evaluate((p) => openProperties(p), `${gallery}\\photo-01.png`);
        await expect(page.locator('#properties-modal-scrim')).toBeVisible();
      }],
      ['thispc', '#screen-browser', async () => {
        await page.evaluate(async () => { if (browserState.path !== THISPC) await openBrowserAt(THISPC); });
        await page.waitForFunction(() => browserState.path === THISPC && !window.__fpLoadPending);
      }],
      ['palette', '#palette-scrim', async () => { await page.evaluate(() => openPalette()); }],
      ['ask', '#ask-popout', async () => { await page.evaluate(() => { if (!askPopoutOpen()) toggleAskPopout(); }); }],
      ['tag-canvas', '#tag-canvas-scrim', async () => { await page.evaluate(() => openTagCanvas()); }],
      ...SETTINGS_PANES.map((pane) => [`settings:${pane}`, '#screen-settings', async () => {
        await page.evaluate((p) => { switchScreen('settings'); switchSettingsPane(p); }, pane);
      }]),
    ];

    for (const [name, rootSel, setup] of contexts) {
      clicked[name] = 0;
      for (let i = 0; i < 200; i++) {
        await resetOverlays();
        await setup();
        await frames(page);
        // The inspector repaints its panes when a fetch lands: mark a control
        // only once it has settled, or the marked node can be replaced
        // between the mark and the click.
        await page.waitForFunction(() => window.__fpInspectorPending === 0 && !window.__fpLoadPending, null, { timeout: 20_000 });
        // The i-th control a user could click right now: laid out, visible,
        // not under pointer-events:none (the dimmed Tag Canvas mock body).
        const target = await page.evaluate(([sel, idx]) => {
          const roots = [...document.querySelectorAll(sel)];
          // A toggle's checkbox is drawn by its <label> (the input itself
          // is visually hidden): the label is what the user clicks.
          const shown = (el) => {
            const box = (el.matches('input') && el.closest('label')) || el;
            if (!box || !box.getClientRects().length) return false;
            const cs = getComputedStyle(box);
            return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
          };
          const els = roots.flatMap((r) => [...r.querySelectorAll('[data-action]')])
            .filter((el) => !el.disabled && shown(el));
          const el = els[idx];
          if (!el) return null;
          el.dataset.fpSweep = String(idx);
          return { action: el.dataset.action, checkbox: el.type === 'checkbox', label: (el.textContent || el.title || '').trim().slice(0, 40) };
        }, [rootSel, i]);
        if (!target) break;
        if (process.env.FP_SWEEP_DEBUG) console.log(name, i, target.action, target.label);
        if (!handled(target.action)) unhandled.push(`${name}: ${target.action} (${target.label})`);
        if (NOT_CLICKED.has(target.action)) {
          unclickedButHandled.push(target.action);
          await page.evaluate(() => document.querySelector('[data-fp-sweep]')?.removeAttribute('data-fp-sweep'));
          continue;
        }
        const before = await page.evaluate(() => window.__fpStubHits);
        await page.evaluate((twice) => {
          const el = document.querySelector('[data-fp-sweep]');
          el.removeAttribute('data-fp-sweep');
          el.click();
          // A checkbox is clicked back, so the sweep leaves settings as found.
          if (twice) el.click();
        }, target.checkbox);
        await frames(page);
        // A navigation the click started lands before the next setup looks.
        await page.waitForFunction(() => !window.__fpLoadPending, null, { timeout: 20_000 });
        const after = await page.evaluate(() => window.__fpStubHits);
        if (after !== before) unhandled.push(`${name}: ${target.action} (${target.label}) hit the stub`);
        clicked[name]++;
      }
    }
    await resetOverlays();
    expect(unhandled).toEqual([]);
    expect(await page.evaluate(() => window.__fpStubHits)).toBe(0);
    // This PC's drive cards are driven by thispc.js's own listeners (no
    // data-action); every other surface has controls of its own.
    for (const [name] of contexts) if (name !== 'thispc') expect(clicked[name], `nothing clicked in ${name}`).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'clicked', description: JSON.stringify(clicked) });
    if (process.env.FP_SWEEP_DEBUG) console.log(JSON.stringify(clicked), unclickedButHandled.join(' '));
    expect(Object.values(clicked).reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
  } finally {
    await restoreConfig(page, configBefore).catch(() => {});
    await resetToDefaults(page).catch(() => {});
    await app.close();
  }
  expectNoErrors(errors);
});

test('Settings › About shows real versions and opens the logs folder', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await stubShell(app);
    const health = await apiGet('/health');
    const versions = await app.evaluate(() => ({ ...process.versions }));
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('.settings-nav__item[data-pane="about"]').click();
    const about = page.locator('#settings-pane-about');
    await expect(about.locator('#about-app-version')).toHaveText(PKG_VERSION);
    await expect(about.locator('#about-electron-version')).toHaveText(versions.electron);
    await expect(about.locator('#about-chrome-version')).toHaveText(versions.chrome);
    await expect(about.locator('#about-node-version')).toHaveText(versions.node);
    await expect(about.locator('#about-backend-version')).toHaveText(`${health.version} · ${health.env}`);
    await expect(about.locator('#about-writes')).toHaveText(health.write_unlocked ? /Unlocked/ : /Sandbox only/);
    await expect(about.locator('#about-log-dir')).toHaveText(LOG_DIR);
    await shot(page, 'stage2d-12a-settings-about');

    await about.locator('[data-action="settings-open-logs"]').click();
    await expect.poll(() => opened(app)).toEqual([LOG_DIR]);

    // A failure is said out loud (an error toast), never swallowed.
    await stubShell(app, 'Failed to open path');
    await about.locator('[data-action="settings-open-logs"]').click();
    await expect(page.locator('.fp-toast', { hasText: /logs folder/i })).toBeVisible();
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

test('Settings › Shortcuts is a read-only list of the real shortcuts, and the listed ones work', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const scratch = `${root}\\Placeholder12a`;
  try {
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('.settings-nav__item[data-pane="shortcuts"]').click();
    const pane = page.locator('#settings-pane-shortcuts');
    await expect(pane).toBeVisible();
    await expect(pane.locator('[data-action]')).toHaveCount(0);
    const keys = await pane.locator('.settings-kbd-pill').allTextContents();
    for (const k of ['Ctrl+K', 'Ctrl+F', 'Ctrl+,', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Shift+T', 'F2', 'Delete', 'Ctrl+Z', 'Ctrl+Shift+N', 'Alt+Enter', 'F5']) {
      expect(keys, k).toContain(k);
    }
    for (const gone of ['⌘⇧R', '⊞⇧F', '⊞⇧D', '⌘T']) expect(keys).not.toContain(gone);
    await shot(page, 'stage2d-12a-settings-shortcuts');

    // Ctrl+Shift+N makes a new folder in the folder on screen, ready to rename.
    await api('POST', '/fs/mkdir', { dir: root, name: 'Placeholder12a' });
    const openScratch = async () => {
      await page.evaluate((p) => openBrowserAt(p), scratch);
      await page.waitForFunction((p) => fpNormalizePath(browserState.path || '') === fpNormalizePath(p)
        && !window.__fpLoadPending && document.getElementById('screen-browser').classList.contains('active'), scratch);
    };
    await openScratch();
    await page.locator('#list-scroll').focus();
    await page.keyboard.press('Control+Shift+N');
    await expect(page.locator('#list-scroll input.fp-row__rename')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#list-scroll input.fp-row__rename')).toHaveCount(0);
    await expect.poll(async () => (await apiGet(`/fs/list?path=${encodeURIComponent(scratch)}`)).entries.map((e) => e.name))
      .toContain('New folder');

    // Ctrl+, opens Settings (the sidebar tooltip and the status bar both say so).
    await page.locator('#list-scroll').focus();
    await page.keyboard.press('Control+,');
    await expect(page.locator('#screen-settings')).toBeVisible();
    expect(await page.evaluate(() => activeTab().screen)).toBe('settings');
    await page.waitForFunction(() => !window.__fpLoadPending);
  } finally {
    await app.close();
    await api('POST', '/fs/trash', { paths: [scratch] }).catch(() => {});
  }
  expectNoErrors(errors);
});

test('Settings › Data: open logs, clear icon and thumbnail caches, clear Recent', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const gallery = `${root}\\Views\\Gallery`;
  try {
    await stubShell(app);
    // Fill the caches: the Gallery opens in a picture view, so its tiles ask
    // for thumbnails (renderer LRU + main-process LRU).
    await page.evaluate((p) => openBrowserAt(p), gallery);
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll img.fp-thumb[data-fp-lazy="done"]').length > 0, null, { timeout: 20_000 });
    const sizesBefore = await page.evaluate(() => fpIconCacheSizes());
    expect(sizesBefore.thumbnails).toBeGreaterThan(0);
    const mainThumbCallsBefore = await app.evaluate(() => globalThis.__fpMainIconStats.thumbCalls);

    await page.evaluate(() => switchScreen('settings'));
    await page.locator('.settings-nav__item[data-pane="data"]').click();
    const pane = page.locator('#settings-pane-data');
    await expect(pane).toBeVisible();
    await shot(page, 'stage2d-12a-settings-data');

    // Open logs folder
    await pane.locator('[data-action="settings-open-logs"]').click();
    await expect.poll(() => opened(app)).toEqual([LOG_DIR]);

    // Clear icon + thumbnail caches: every layer reports what it dropped, and
    // the pictures are fetched again (not served from a cache) on return.
    await page.evaluate(() => { window.__fpLastCacheClear = null; });
    await pane.locator('[data-action="settings-clear-icon-cache"]').click();
    await page.waitForFunction(() => window.__fpLastCacheClear !== null);
    const result = await page.evaluate(() => window.__fpLastCacheClear);
    expect(result.renderer).toBeGreaterThanOrEqual(sizesBefore.thumbnails);
    expect(result.main.thumbnails).toBeGreaterThan(0);
    expect(typeof result.backend).toBe('number');
    const sizesAfter = await page.evaluate(() => fpIconCacheSizes());
    expect(sizesAfter.thumbnails).toBe(0);
    // Answered in place (toasts are off by default), with the real count.
    const total = result.renderer + result.main.icons + result.main.thumbnails + result.backend;
    await expect(pane.locator('#settings-cache-status')).toHaveText(`Cleared ${total.toLocaleString()} cached image${total === 1 ? '' : 's'}`);
    await page.evaluate((p) => openBrowserAt(p), gallery);
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll img.fp-thumb[data-fp-lazy="done"]').length > 0, null, { timeout: 20_000 });
    await expect.poll(() => app.evaluate(() => globalThis.__fpMainIconStats.thumbCalls)).toBeGreaterThan(mainThumbCallsBefore);

    // Clear Recent: the backend list empties and Home says so.
    await api('POST', '/recent', { path: `${gallery}\\photo-01.png`, action: 'opened' });
    await page.evaluate(() => switchScreen('home'));
    await expect(page.locator('#home-recent .fp-row').first()).toBeVisible();
    await page.evaluate(() => { switchScreen('settings'); switchSettingsPane('data'); });
    await pane.locator('[data-action="settings-clear-recent"]').click();
    await expect.poll(async () => ((await apiGet('/recent')).groups || []).length).toBe(0);
    await expect(pane.locator('#settings-recent-status')).toHaveText(/^Cleared \d+ items?$/);
    await shot(page, 'stage2d-12a-settings-data-cleared');
    await page.evaluate(() => switchScreen('home'));
    await expect(page.locator('#home-recent .fp-empty-state')).toBeVisible();
    await expect(page.locator('#home-recent .fp-row')).toHaveCount(0);
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

test('screenshots of every Settings pane', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => { delete document.documentElement.dataset.mica; applyTheme('dark'); switchScreen('settings'); });
    for (const pane of SETTINGS_PANES) {
      await page.locator(`.settings-nav__item[data-pane="${pane}"]`).click();
      await expect(page.locator(`#settings-pane-${pane}`)).toBeVisible();
      await frames(page);
      await shot(page, `stage2d-12a-pane-${pane}`);
    }
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});
