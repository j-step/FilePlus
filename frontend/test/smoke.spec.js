// frontend/test/smoke.spec.js
// Launches the real Electron app against a running backend, visits every
// screen, fails on any renderer error, and screenshots each screen.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const FRONTEND = path.join(__dirname, '..');
const SHOTS = path.join(FRONTEND, '..', 'artifacts', 'screenshots');
const API = `http://127.0.0.1:${process.env.FILEPLUS_PORT || 9876}`;
const SCREENS = [
  'home', 'browser', 'ftree', 'scan-config', 'scan-progress',
  'scan-results', 'review-bin', 'everything', 'settings',
];

test('backend /health is reachable', async () => {
  const r = await fetch(`${API}/health`);
  expect(r.ok).toBeTruthy();
  expect((await r.json()).status).toBe('ok');
});

test('a token-gated route requires X-FilePlus-Token when FILEPLUS_API_TOKEN is set', async () => {
  const token = process.env.FILEPLUS_API_TOKEN;
  test.skip(!token, 'FILEPLUS_API_TOKEN not set in this environment');
  const unauthed = await fetch(`${API}/drives`);
  expect(unauthed.status).toBe(401);
  const authed = await fetch(`${API}/drives`, { headers: { 'X-FilePlus-Token': token } });
  expect(authed.status).toBe(200);
});

test('every screen renders with no renderer errors', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // Electron-based dev shells (e.g. this one) export ELECTRON_RUN_AS_NODE=1,
  // which turns the Electron binary into plain Node and breaks the launch;
  // strip it so the gate works regardless of the caller's shell.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [FRONTEND],
    cwd: FRONTEND,
    env,
  });
  const page = await app.firstWindow();
  const errors = [];
  try {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await page.waitForSelector('#shell');

    // Screenshots must show default settings, not whatever this machine's profile persisted.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#shell');

    // Capture the solid fallback chrome: Mica is a live desktop material that
    // screenshots as transparent pixels under the harness.
    await page.evaluate(() => { delete document.documentElement.dataset.mica; });

    // Screenshot passes must be deterministic: force dark for the base pass
    // (Playwright emulates prefers-color-scheme: light by default).
    await page.evaluate(() => applyTheme('dark'));

    await page.waitForTimeout(1500); // fonts, first /health poll

    for (const id of SCREENS) {
      await page.evaluate((s) => switchScreen(s), id);
      await expect(page.locator(`#screen-${id}`)).toBeVisible();
      await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
    }

    await page.evaluate(() => openPalette());
    await page.screenshot({ path: path.join(SHOTS, 'palette.png') });
    await page.evaluate(() => closePalette());

    // --- Explorer e2e in the generated sandbox ---
    // Navigate via the API rather than a page global: GET /fs/list/root's
    // `path` is the sandbox root, and scripts/gen_sandbox.py always builds
    // <root>\_gen\Documents\doc-00.txt (see scripts/gen_sandbox.py, run by
    // verify.ps1's fixtures stage before this test runs).
    const apiToken = process.env.FILEPLUS_API_TOKEN;
    const apiHeaders = apiToken ? { 'X-FilePlus-Token': apiToken } : {};
    const root = (await (await fetch(`${API}/fs/list/root`, { headers: apiHeaders })).json()).path;
    const docsDir = `${root}\\_gen\\Documents`;

    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowByName = (name) => page.locator('.fp-row').filter({
      has: page.locator('.fp-row__name', { hasText: new RegExp(`^${escapeRe(name)}$`) }),
    });

    await page.evaluate(() => switchScreen('browser'));
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);

    await rowByName('doc-00.txt').click();
    await expect(page.locator('#inspector')).toHaveClass(/inspector--open/);
    await expect(page.locator('#inspector-filename')).toHaveText('doc-00.txt');
    await page.screenshot({ path: path.join(SHOTS, 'browser-selected.png') });

    await rowByName('doc-00.txt').click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'context-menu.png') });
    await page.keyboard.press('Escape');

    // "Add tag…" must switch the Inspector to the Tags tab (it's display:none
    // under the default Preview tab) before focusing the tag input, or the
    // focus() call is a silent no-op — see Task 8b fix round 1.
    await rowByName('doc-00.txt').click({ button: 'right' });
    await page.locator('#context-menu [data-action="cm-add-tag"]').click();
    await expect(page.locator('#inspector-tag-input')).toBeVisible();
    await expect(page.locator('#inspector-tag-input')).toBeFocused();
    // inspector-tag-input's own keydown handler stops propagation on every
    // key (including Escape) so browser.js's shortcuts never see keys typed
    // here — so Escape does not blur it. Re-click the row instead, which
    // both moves focus back to #list-scroll (required for F2 below to reach
    // browserKeydown) and leaves selection/state exactly as before this step.
    await rowByName('doc-00.txt').click();

    try {
      await page.keyboard.press('F2');
      // startInlineRename() preselects only the stem for a file with an
      // extension (Explorer-style rename UX) — type just the new stem so the
      // existing ".txt" (left un-selected) isn't duplicated.
      await page.keyboard.type('renamed-by-smoke');
      await page.keyboard.press('Enter');
      await expect(rowByName('renamed-by-smoke.txt')).toBeVisible();
      await expect(rowByName('doc-00.txt')).toHaveCount(0);

      await page.keyboard.press('Control+z');
      await expect(rowByName('doc-00.txt')).toBeVisible();
      await expect(rowByName('renamed-by-smoke.txt')).toHaveCount(0);

      const ops = await (await fetch(`${API}/operations?limit=2`, { headers: apiHeaders })).json();
      const renamedRow = ops.find(o => o.op_type === 'rename' && o.undone === 1);
      const inverseRow = ops.find(o => o.undo_of === renamedRow?.id);
      expect(renamedRow, JSON.stringify(ops)).toBeTruthy();
      expect(inverseRow, JSON.stringify(ops)).toBeTruthy();
    } finally {
      // Restore the sandbox even if an assertion above threw mid-way, so
      // verify stays repeatable on the next run.
      const stillRenamed = await rowByName('renamed-by-smoke.txt').count();
      if (stillRenamed > 0) {
        await fetch(`${API}/fs/rename`, {
          method: 'POST',
          headers: { ...apiHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `${docsDir}\\renamed-by-smoke.txt`, new_name: 'doc-00.txt' }),
        });
      }
    }

    // --- File-type icons, grid thumbnails, Windows icon mode (Task 6) ---
    // gen_sandbox.py writes six PNGs into <root>\_gen\Pictures, so the grid
    // has real image content for the shell to thumbnail.
    const picsDir = `${root}\\_gen\\Pictures`;
    await page.evaluate((p) => loadDirectory(p), picsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 6);

    // Every list row carries a file-type family symbol from the sprite.
    expect(await page.locator('#list-scroll use[href^="#fp-ft-"]').count()).toBeGreaterThan(0);

    // Grid view: at least one tile resolves a real shell thumbnail. The blank
    // placeholder is a data:image/gif, so matching data:image/png proves the
    // bridge actually answered rather than the <img> merely existing.
    await page.evaluate(() => setViewMode('grid'));
    await expect(page.locator('#list-scroll img.fp-thumb[src^="data:image/png"]').first())
      .toBeVisible({ timeout: 3000 });
    await page.screenshot({ path: path.join(SHOTS, 'browser-grid.png') });
    await page.evaluate(() => setViewMode('list'));

    // Settings ▸ Personalization ▸ File icons = Windows: rows swap to real
    // Windows shell icons (an <img>, not a sprite <use>).
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    await page.evaluate(() => switchScreen('browser'));
    await expect(page.locator('#list-scroll img.fp-icon--win[src^="data:image/png"]').first())
      .toBeVisible({ timeout: 3000 });

    // ...and back to FilePlus restores the sprite family icons.
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="fileplus"]').click();
    await page.evaluate(() => switchScreen('browser'));
    await expect(page.locator('#list-scroll img.fp-icon--win')).toHaveCount(0);
    expect(await page.locator('#list-scroll use[href^="#fp-ft-"]').count()).toBeGreaterThan(0);

    // Special folder icons are decided by PATH (GET /known-folders), not by
    // name: a folder called "Desktop" that is not the user's real Desktop
    // must render the plain folder symbol.
    const decoyDir = `${root}\\_gen\\Desktop`;
    const postJson = (route, body) => fetch(`${API}${route}`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await postJson('/fs/mkdir', { dir: `${root}\\_gen`, name: 'Desktop' });
    try {
      await page.evaluate((p) => loadDirectory(p), `${root}\\_gen`);
      await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 2);
      const decoyIcon = rowByName('Desktop').locator('use');
      await expect(decoyIcon).toHaveAttribute('href', '#fp-ft-folder');
      // Sanity: the sprite does carry the special symbol, so the assertion
      // above is about identity rather than a missing icon.
      expect(await page.evaluate(() => !!document.getElementById('fp-ft-folder-desktop'))).toBe(true);
    } finally {
      await postJson('/fs/trash', { paths: [decoyDir] });
    }

    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);

    await page.evaluate(() => applyTheme('light'));
    for (const id of ['home', 'browser', 'settings']) {
      await page.evaluate((s) => switchScreen(s), id);
      await page.screenshot({ path: path.join(SHOTS, `${id}-light.png`) });
    }
    await page.evaluate(() => applyTheme('system'));
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
