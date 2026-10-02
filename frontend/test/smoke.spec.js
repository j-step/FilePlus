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
  // The app already zeroes animation/transition durations under
  // prefers-reduced-motion (styles.css's strict policy, UI-SPEC §A.0) — force
  // it for the whole run so every fade-in (popovers, modals) settles near-
  // instantly instead of racing a screenshot against a live CSS transition
  // (Task 15 carry-over: this is what properties-folder.png needed).
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  try {
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // location() gives {url, lineNumber, columnNumber} for a console entry —
    // included so a "Failed to load resource: 404" (Chromium's own message,
    // which never carries the URL in m.text()) actually names the route that
    // 404'd instead of leaving it a mystery.
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const loc = m.location();
      const where = loc && loc.url ? ` (${loc.url}:${loc.lineNumber})` : '';
      errors.push(`console: ${m.text()}${where}`);
    });

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
    // <root>\_gen\Documents\doc-00.txt (see scripts/gen_sandbox.py, run into
    // a fresh temp root by frontend/test/harness/global-setup.js).
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

    // --- Fix round 1 (Task 10 keydown regression): F2/Ctrl+Z must keep
    // reaching the file list even when DOM focus has moved into the
    // sidebar — only Enter/Space on a sidebar control are excluded from
    // browserKeydown (the chevron click below both toggles This PC AND
    // moves DOM focus there, exercising exactly that path). ---
    await rowByName('doc-00.txt').click();
    await page.locator('#sb-thispc .fp-sidebar__chevron').click(); // shifts DOM focus into the sidebar
    await page.keyboard.press('F2');
    await expect(page.locator('.fp-row__rename')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fp-row__rename')).toHaveCount(0);
    await page.locator('#sb-thispc .fp-sidebar__chevron').click(); // restore expanded state

    try {
      await rowByName('doc-00.txt').click();
      await page.keyboard.press('F2');
      await page.keyboard.type('renamed-by-smoke-2');
      await page.keyboard.press('Enter');
      await expect(rowByName('renamed-by-smoke-2.txt')).toBeVisible();

      await page.locator('#sb-thispc .fp-sidebar__chevron').click(); // shifts DOM focus into the sidebar
      await page.keyboard.press('Control+z');
      await expect(rowByName('doc-00.txt')).toBeVisible();
      await expect(rowByName('renamed-by-smoke-2.txt')).toHaveCount(0);
    } finally {
      await page.locator('#sb-thispc .fp-sidebar__chevron').click(); // restore expanded state
      const stillRenamed2 = await rowByName('renamed-by-smoke-2.txt').count();
      if (stillRenamed2 > 0) {
        await fetch(`${API}/fs/rename`, {
          method: 'POST',
          headers: { ...apiHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: `${docsDir}\\renamed-by-smoke-2.txt`, new_name: 'doc-00.txt' }),
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
    // 'list' now means the new name-only view (Task 10) — 'details' is the
    // renamed equivalent of what used to be called 'list' (columns), which
    // is what the Windows-icon-mode assertions below actually want back.
    await page.evaluate(() => setViewMode('details'));

    // Settings ▸ Personalization ▸ File icons = Windows: rows swap to real
    // Windows shell icons (an <img>, not a sprite <use>).
    const statsBefore = await page.evaluate(() => ({ ...window.__fpIconStats }));
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    await page.evaluate(() => switchScreen('browser'));
    await expect(page.locator('#list-scroll img.fp-icon--win[src^="data:image/png"]').first())
      .toBeVisible({ timeout: 3000 });

    // --- Pass 2: Windows-icon sharpness fix (icon design §2, §5.3 — docs/
    // superpowers/specs/2026-09-14-stage-2c-pass-2-icon-design.md). Two
    // sources, one sizing contract: Tier A is POST /shell/icons (the
    // backend's IShellItemImageFactory render — what Explorer draws, exact at
    // any px, for every entry); Tier B is Electron's app.getFileIcon (exact
    // only at the shell's own 16*S / 32*S reps, never for folders / no-ext /
    // .lnk / .url). dpr folds in any OS/Electron display scaling, so these
    // assertions hold at whatever scale this machine runs at. ---
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    // Stage 2D §4.3: every request goes out at round(css * dpr) snapped UP to
    // a px bucket (iconCache.js fpIconBucket), and the <img> stays CSS-sized
    // to its box -- the browser downsamples.
    const { fpIconBucket } = require('../iconCache');
    const iconPx = (css) => fpIconBucket(Math.round(css * dpr));
    const shellIconB64 = async (p, px) => Buffer.from(await (await fetch(
      `${API}/shell/icon?path=${encodeURIComponent(p)}&px=${px}`, { headers: apiHeaders })).arrayBuffer()).toString('base64');
    const pngRowsProof = () => page.evaluate(() => [...document.querySelectorAll('#list-scroll img.fp-icon--win[src^="data:image/png"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, px: el.dataset.px, exact: el.dataset.exact, width: r.width };
    }));
    const pngRowsSettled = (n) => page.waitForFunction((want) =>
      document.querySelectorAll('#list-scroll img.fp-icon--win[src^="data:image/png"]').length >= want
      && !document.querySelector('#list-scroll img.fp-icon--win[data-fp-lazy="pending"]'), n, { timeout: 5000 });

    // 1. Sharpness, every row (still _gen\Pictures, details): the bitmap is
    // exactly round(css * dpr) px, square, recorded in data-px, and the box
    // is pinned so device px == bitmap px. Six .png rows share one icon key:
    // six element requests collapse to fewer keys (the per-macrotask batch).
    await pngRowsSettled(6);
    const picsRows = await pngRowsProof();
    expect(picsRows.length).toBeGreaterThanOrEqual(6);
    for (const row of picsRows) {
      expect(row.naturalWidth).toBe(iconPx(row.width));
      expect(row.naturalHeight).toBe(row.naturalWidth);
      expect(Number(row.px)).toBe(row.naturalWidth);
      expect(Math.abs(row.width - 16)).toBeLessThan(0.01);
    }
    const statsAfter = await page.evaluate(() => ({ ...window.__fpIconStats }));
    expect(statsAfter.requested - statsBefore.requested).toBeGreaterThanOrEqual(6);
    expect(statsAfter.keys - statsBefore.keys).toBeLessThan(statsAfter.requested - statsBefore.requested);

    // 2. Tier A byte proof: the row's bitmap IS the backend's render.
    expect(await page.evaluate(() => fpShellIconRoute())).toBe('live');
    const img1 = rowByName('IMG_0001.png').locator('img.fp-icon--win');
    const img1Px = Number(await img1.getAttribute('data-px'));
    expect(await img1.getAttribute('src')).toBe('data:image/png;base64,' + await shellIconB64(`${picsDir}\\IMG_0001.png`, img1Px));
    expect(await img1.getAttribute('data-exact')).toBe('1');

    // Sharpness proof on a .txt row too -- not the pre-fix bug (always a
    // 32-px shell image force-resized to a 16-px, 1x-tagged bitmap that the
    // renderer then stretched again).
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
    const txtIcon = rowByName('doc-00.txt').locator('img.fp-icon--win');
    await expect(txtIcon).toHaveAttribute('src', /^data:image\/png/, { timeout: 3000 });
    const txtProof = await txtIcon.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, px: el.dataset.px, exact: el.dataset.exact, width: r.width };
    });
    const expectedPx = iconPx(16);
    expect(txtProof.px).toBe(String(expectedPx));
    expect(txtProof.naturalWidth).toBe(Number(txtProof.px));
    expect(txtProof.naturalHeight).toBe(txtProof.naturalWidth);
    expect(txtProof.naturalWidth).toBeGreaterThanOrEqual(16);
    expect(Math.abs(txtProof.width - 16)).toBeLessThan(0.01);
    expect(txtProof.exact).toBe('1');
    await page.screenshot({ path: path.join(SHOTS, 'browser-windows-icons.png') });

    // 3. Folder parity (the drive-glyph regression guard): a folder row in
    // Windows mode is a real shell <img> — Tier A renders the folder's own
    // icon, byte-identical to GET /shell/icon for that folder and different
    // from a file's at the same px. Tier B alone could never do this:
    // app.getFileIcon answers one system-drive glyph for every directory.
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen`);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 5);
    const folderIcon = rowByName('Pictures').locator('img.fp-icon--win');
    await expect(folderIcon).toHaveAttribute('src', /^data:image\/png/, { timeout: 3000 });
    const folderPx = Number(await folderIcon.getAttribute('data-px'));
    const folderSrc = await folderIcon.getAttribute('src');
    expect(folderSrc).toBe('data:image/png;base64,' + await shellIconB64(`${root}\\_gen\\Pictures`, folderPx));
    expect(folderSrc).not.toBe('data:image/png;base64,' + await shellIconB64(`${docsDir}\\doc-00.txt`, folderPx));
    await expect(rowByName('Pictures').locator('svg.fp-row__icon')).toHaveCount(0);

    // 4. Extension-less file + Tier B refusal. With the route forced 'absent'
    // the renderer falls back to Tier B, which answers ordinary files at the
    // shell's native small rep but is refused for directories / no-ext /
    // .lnk / .url (the sprite is more honest than Chromium's shared drive
    // glyph). Flipping the route state drops every cached "no icon", so the
    // same rows get their Tier A render on the next visit.
    const tierBBefore = (await page.evaluate(() => ({ ...window.__fpIconStats }))).tierB;
    await page.evaluate(() => fpShellIconRoute('absent'));
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Music`);
    await pngRowsSettled(4);
    for (const row of await pngRowsProof()) {
      expect(row.naturalWidth).toBe(iconPx(16));
      expect(row.exact).toBe('1'); // Tier B: the small image list is 16*S, exact at zoom 1 on the primary monitor
    }
    const tierBDelta = (await page.evaluate(() => ({ ...window.__fpIconStats }))).tierB - tierBBefore;
    expect(tierBDelta).toBeGreaterThanOrEqual(1);
    expect(tierBDelta).toBeLessThanOrEqual(2); // four .wav rows -> one key (one batch, maybe two)
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Projects`);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 4);
    await expect(rowByName('Makefile').locator('svg.fp-row__icon use[href="#fp-ft-generic"]')).toHaveCount(1, { timeout: 3000 });
    // A folder keeps the shell's generic folder icon it painted with its row
    // (learned from step 3's Tier A answers, Stage 2D §4.2) -- Tier B is never
    // asked for it, so it never becomes Chromium's shared drive glyph.
    for (const name of ['a', 'app', 'web']) {
      await expect(rowByName(name).locator('img.fp-icon--win[src^="data:image/png"]')).toHaveCount(1, { timeout: 3000 });
      await expect(rowByName(name).locator('img.fp-icon--win[data-fp-lazy="pending"]')).toHaveCount(0, { timeout: 3000 });
    }
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Projects\\app`);
    await pngRowsSettled(2);
    for (const row of await pngRowsProof()) expect(row.naturalWidth).toBe(iconPx(16));
    await page.evaluate(() => fpShellIconRoute('unknown'));
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Projects`);
    await expect(rowByName('Makefile').locator('img.fp-icon--win[src^="data:image/png"]')).toHaveCount(1, { timeout: 3000 });
    await expect(rowByName('app').locator('img.fp-icon--win[src^="data:image/png"]')).toHaveCount(1, { timeout: 3000 });
    expect(await page.evaluate(() => fpShellIconRoute())).toBe('live');

    // 5. Grid thumbnails in Windows mode: every bitmap's longer edge is the
    // px bucket of the tile box x dpr, and the <img> (CSS-sized at the
    // picture's aspect ratio) fills its slot along its longer edge.
    await page.evaluate((p) => loadDirectory(p), picsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 6);
    await page.evaluate(() => setViewMode('grid'));
    await expect(page.locator('#list-scroll img.fp-thumb--ready[src^="data:image/png"]').first())
      .toBeVisible({ timeout: 3000 });
    const gridProofs = await page.evaluate(() => [...document.querySelectorAll('#list-scroll img.fp-thumb--ready')].map((el) => {
      const r = el.getBoundingClientRect();
      const b = el.parentElement.getBoundingClientRect();
      return { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, px: el.dataset.px, width: r.width, height: r.height, boxW: b.width, boxH: b.height };
    }));
    expect(gridProofs.length).toBeGreaterThanOrEqual(1);
    for (const g of gridProofs) {
      expect(Number(g.px)).toBe(Math.max(g.naturalWidth, g.naturalHeight));
      expect(Number(g.px)).toBe(iconPx(Math.max(g.boxW, g.boxH)));
      expect(Math.abs(Math.max(g.width, g.height) - Math.max(g.boxW, g.boxH))).toBeLessThan(0.5);
      expect(g.width).toBeLessThanOrEqual(g.boxW + 0.5);
      expect(g.height).toBeLessThanOrEqual(g.boxH + 0.5);
    }
    await page.evaluate(() => setViewMode('details'));

    // 6. List-scale re-request: --list-scale 1.5 makes the row box 24 CSS px
    // and every icon re-resolves at round(24 * dpr) instead of Chromium
    // stretching the 16-px bitmap (needs the styles.css cascade fix:
    // .fp-row .fp-row__icon beats .fp-icon--16). Then back.
    const rowsAt = (css) => page.waitForFunction(({ want, css }) => {
      const rows = [...document.querySelectorAll('#list-scroll img.fp-icon--win[src^="data:image/png"]')];
      return rows.length >= 6 && !document.querySelector('#list-scroll img.fp-icon--win[data-fp-lazy="pending"]')
        && rows.every((el) => el.naturalWidth === want && Math.abs(el.getBoundingClientRect().width - css) < 0.01);
    }, { want: iconPx(css), css }, { timeout: 5000 });
    await page.evaluate(() => setListScale(1.5, { persist: false }));
    // Details rows stay 16 px at any --list-scale: --icon-size is 16 for
    // list/details (Stage 2D §3.2; only grid tiles follow the scale).
    await rowsAt(16);
    await page.evaluate(() => setListScale(1, { persist: false }));
    await rowsAt(16);

    // 7. Zoom round trip: Electron zoom changes devicePixelRatio; the
    // matchMedia(resolution) watcher re-resolves every icon at the new px
    // (Tier A: an exact shell render at the new size, not a resample of the
    // old bitmap), and zoomReset brings it back.
    await page.evaluate(() => zoomIn());
    await page.waitForFunction((base) => Math.abs((window.devicePixelRatio || 1) - base * 1.1) < 0.01, dpr);
    await page.waitForFunction(() => {
      const want = fpIconBucket(Math.round(16 * window.devicePixelRatio));
      const rows = [...document.querySelectorAll('#list-scroll img.fp-icon--win[src^="data:image/png"]')];
      return rows.length >= 6 && !document.querySelector('#list-scroll img.fp-icon--win[data-fp-lazy="pending"]')
        && rows.every((el) => el.naturalWidth === want && el.dataset.exact === '1');
    }, null, { timeout: 5000 });
    expect(await page.evaluate(() => fpIconBucket(Math.round(16 * window.devicePixelRatio)))).not.toBe(iconPx(16));
    await page.evaluate(() => zoomReset());
    await page.waitForFunction((base) => Math.abs((window.devicePixelRatio || 1) - base) < 0.01, dpr);
    await rowsAt(16);

    // ...and back to FilePlus restores the sprite family icons.
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="fileplus"]').click();
    await page.evaluate(() => switchScreen('browser'));
    await expect(page.locator('#list-scroll img.fp-icon--win')).toHaveCount(0);
    // (A picture row whose 16-px thumbnail is already cached paints the
    // thumbnail alone, with no sprite under it — Stage 2D §4.2 — so the
    // family sprites are checked on a folder of documents.)
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
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

    // --- Tabs (Task 7): real per-tab browser state ---
    // Tab 1 (the only tab so far) is showing _gen\Documents from the
    // rename/undo pass above — capture its row count as the baseline for
    // "did tab 1's own state survive a round trip through another tab".
    const docsRowCount = await page.locator('#list-scroll .fp-row').count();

    await page.keyboard.press('Control+t');
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await expect(page.locator('#screen-home')).toBeVisible();

    // Navigate tab 2 (now active) to Pictures — a different folder from
    // tab 1's Documents. openBrowserAt (not switchScreen+loadDirectory) so
    // this is a single fetch, matching a real sidebar/breadcrumb navigation.
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Pictures');
    const tab2Id = await page.evaluate(() => tabs.activeId);
    const picsRowCount = await page.locator('#list-scroll .fp-row').count();

    // Clicking tab 1 must restore ITS OWN state — the Documents listing,
    // untouched by tab 2's navigation — not re-fetch an empty/root listing.
    const tab1 = page.locator('.fp-tab[data-tab-id="tab-1"]');
    await tab1.click();
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Documents');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(docsRowCount);

    // Two tabs visible: tab 1 active (bordered, accent underline), tab 2
    // inactive (filled background) — see Task 7's tab styling.
    await page.screenshot({ path: path.join(SHOTS, 'tabs.png') });

    // --- Race guard (fix round 1) ---
    // Fire an UNAWAITED loadDirectory() on tab 1 (already active, already on
    // Documents — a redundant reload, not a real navigation), then
    // immediately switch to tab 2 before that fetch can resolve. Without the
    // reqTabId/reqSeq guard in loadDirectory(), the late Documents response
    // would paint over tab 2's live Pictures listing — and silently push
    // "Documents" onto tab 2's OWN history stack, since activateTab() has by
    // then repointed nav.history at tab 2's array by reference.
    const tab2HistoryLenBefore = await page.evaluate(
      (id) => tabs.list.find((t) => t.id === id).history.length, tab2Id);
    await page.evaluate((p) => { loadDirectory(p); /* deliberately not awaited */ }, docsDir);
    await page.evaluate((id) => activateTab(id), tab2Id);
    await page.waitForTimeout(1000); // let the abandoned fetch resolve (and, unfixed, wrongly apply)
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Pictures');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(picsRowCount);
    const tab2HistoryLenAfter = await page.evaluate(
      (id) => tabs.list.find((t) => t.id === id).history.length, tab2Id);
    expect(tab2HistoryLenAfter).toBe(tab2HistoryLenBefore);

    await tab1.click();
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Documents');
    await expect(page.locator('#list-scroll .fp-row')).toHaveCount(docsRowCount);

    // Middle-click (auxclick, button 1) on tab 2 closes it without activating it.
    const tab2 = page.locator('.fp-tab').nth(1);
    await tab2.click({ button: 'middle' });
    await expect(page.locator('.fp-tab')).toHaveCount(1);

    // Ctrl+Shift+T reopens the closed tab at exactly the folder it was showing.
    await page.keyboard.press('Control+Shift+T');
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('Pictures');

    // Navigating the (now active, reopened) tab to the sandbox root gives it
    // the "This PC" label rather than a folder name.
    await page.evaluate(() => loadDirectory(null));
    await expect(page.locator('.fp-tab.fp-tab--active .fp-tab__label')).toHaveText('This PC');

    // The tab context menu no longer offers Pin tab / Rename tab (Task 7
    // removes them; Duplicate tab / Close other tabs replace them).
    await page.locator('.fp-tab.fp-tab--active').click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    await expect(page.locator('#context-menu button', { hasText: 'Pin tab' })).toHaveCount(0);
    await expect(page.locator('#context-menu button', { hasText: 'Rename tab' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Close the reopened tab (Ctrl+W) so we're back to a single tab showing
    // Documents, matching what the light-theme screenshots below expect.
    await page.keyboard.press('Control+w');
    await expect(page.locator('.fp-tab')).toHaveCount(1);
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Documents');

    // --- Task 8: inspector switch, deselect anywhere, refresh, theme
    // (playtest pass 1 §3.4-3.6, 3.9) ---
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
    // The "Add tag…" step earlier in this test (cm-add-tag) left the
    // inspector's active tab on Tags — switch back to Preview so the
    // geometry checks below measure the meta grid they're actually meant to
    // (a hidden pane's getBoundingClientRect() is a trivial, meaningless 0x0).
    await page.locator('.fp-inspector__tab[data-tab="preview"]').click();

    // Fix round 1 [Important]: Ctrl+drag marquee must be able to ADD to an
    // existing selection — the open-space deselect handler above must not
    // clear browserState.selection before the marquee's own Ctrl/Shift-drag
    // path (browser.js, initMarqueeSelection) can read it to decide which
    // rows outside the drag box to keep. Targets the LAST TWO rows in the
    // sorted listing (rather than a hardcoded name) and starts the drag from
    // the confirmed-blank space below them: .fp-row rows are contiguous (no
    // gap between them), and a mousedown starting ON a row never begins a
    // marquee drag at all (browser.js's own exclusion), so that's the only
    // reliably-empty point to start from.
    await rowByName('doc-00.txt').click();
    await rowByName('doc-01.txt').click({ modifiers: ['Control'] });
    expect(await page.evaluate(() => browserState.selection.size)).toBe(2);
    const rowsLocator = page.locator('#list-scroll .fp-row[data-path]');
    const rowCount = await rowsLocator.count();
    const lastRowBox = await rowsLocator.nth(rowCount - 1).boundingBox();
    const secondLastRowBox = await rowsLocator.nth(rowCount - 2).boundingBox();
    const listScrollBox = await page.locator('#list-scroll').boundingBox();
    const dragStartY = Math.min(lastRowBox.y + lastRowBox.height + 8, listScrollBox.y + listScrollBox.height - 4);
    await page.keyboard.down('Control');
    await page.mouse.move(listScrollBox.x + 20, dragStartY);
    await page.mouse.down();
    await page.mouse.move(listScrollBox.x + 20, secondLastRowBox.y + 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    expect(await page.evaluate(() => browserState.selection.size)).toBe(4);

    // Selecting doc-00.txt kicks off sequential /file, /preview,
    // /files/history fetches (inspector.js's showInspectorFor); the debounced
    // pipeline is guarded against a SUPERSEDED selection's fetch touching the
    // DOM, but the underlying requests still run to completion — clicking
    // the same row again before the first round trip lands starts a second
    // overlapping set. inspector-kind is reset to a sentinel that can't
    // naturally occur BEFORE each click, then awaited afterward, so the wait
    // detects THIS click's own /file response landing rather than stale
    // content a previous selection already left behind.
    const clickDocAndSettle = async () => {
      await page.evaluate(() => { const el = document.getElementById('inspector-kind'); if (el) el.textContent = '…'; });
      await rowByName('doc-00.txt').click();
      await page.waitForFunction(() => document.getElementById('inspector-kind')?.textContent !== '…');
      await page.waitForTimeout(200); // let the chain's own remaining /preview + /files/history steps land too
    };

    // ui.inspector_open = false (real POST /config, then the same
    // loadConfig()+applySettingsFromConfig() pipeline a real startup runs):
    // selecting a row must NOT open the panel — selection alone never opens
    // or closes it, only Ctrl+I / the toolbar button / this config do.
    await postJson('/config', { key: 'ui.inspector_open', value: false });
    await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); });
    await clickDocAndSettle();
    await expect(page.locator('#inspector')).not.toHaveClass(/inspector--open/);

    // Back to open — deselecting from blank sidebar space (not a sidebar
    // item) must clear the selection and show the "No file selected" empty
    // state, with IDENTICAL header/preview/meta geometry to the real-file
    // state (no jitter).
    await postJson('/config', { key: 'ui.inspector_open', value: true });
    await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); });
    await clickDocAndSettle();
    await expect(page.locator('#inspector')).toHaveClass(/inspector--open/);
    await expect(page.locator('#inspector-filename')).toHaveText('doc-00.txt');
    const measureInspectorBlocks = () => page.evaluate(() => {
      const box = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { width: Math.round(r.width), height: Math.round(r.height) };
      };
      return { header: box('.inspector__header'), preview: box('#inspector-preview'), meta: box('.inspector__meta') };
    });
    const fileBoxes = await measureInspectorBlocks();
    await page.screenshot({ path: path.join(SHOTS, 'inspector-file.png') });

    const sidebarBox = await page.locator('#sidebar').boundingBox();
    const lastSidebarItemBox = await page.locator('#sidebar .fp-sidebar__item').last().boundingBox();
    await page.mouse.click(
      sidebarBox.x + sidebarBox.width / 2,
      Math.min(lastSidebarItemBox.y + lastSidebarItemBox.height + 20, sidebarBox.y + sidebarBox.height - 8),
    );
    await expect(page.locator('#inspector-filename')).toHaveText('No file selected');
    expect(await page.evaluate(() => browserState.selection.size)).toBe(0);
    const emptyBoxes = await measureInspectorBlocks();
    await page.screenshot({ path: path.join(SHOTS, 'inspector-empty.png') });
    expect(emptyBoxes).toEqual(fileBoxes);

    // Refresh, part 1: a real click on the toolbar button proves the
    // data-action="refresh-directory" wiring reaches refreshAll() end
    // to end, and that it preserves the selection and inspector content
    // across the round trip.
    await clickDocAndSettle();
    const refreshAndSettle = async () => {
      await page.evaluate(() => { const el = document.getElementById('inspector-kind'); if (el) el.textContent = '…'; });
      await page.locator('#btn-refresh').click();
      await expect(page.locator('#btn-refresh')).not.toHaveClass(/is-spinning/, { timeout: 5000 });
      // refreshDirectory() preserves the selection, which re-triggers the
      // same debounced inspector fetch clickDocAndSettle waits out above —
      // settle that fully too before anything else re-selects doc-00.txt,
      // for the same overlapping-request reason.
      await page.waitForFunction(() => document.getElementById('inspector-kind')?.textContent !== '…');
      await page.waitForTimeout(200);
    };
    await refreshAndSettle();
    await expect(rowByName('doc-00.txt')).toHaveClass(/fp-row--selected/);
    await expect(page.locator('#inspector-filename')).toHaveText('doc-00.txt');

    // Refresh, part 2: refreshAll() (the one entry point for the button,
    // Ctrl+R, F5 and the menu — Stage 2D §7.1) adds .is-spinning to the
    // button synchronously, before it ever awaits the re-list — proven by
    // calling it and reading the class back in the SAME evaluate() (no
    // round trip in between), since the local backend answers /fs/list fast
    // enough that a real click's own round trip can resolve only after the
    // whole request has already completed and the class already removed
    // again (route interception to slow it down artificially was tried and
    // dropped — toggling network interception mid-test made an unrelated,
    // genuinely concurrent /preview request fail instead).
    const spunImmediately = await page.evaluate(() => {
      refreshAll();
      return document.getElementById('btn-refresh').classList.contains('is-spinning');
    });
    expect(spunImmediately).toBe(true);
    await expect(page.locator('#btn-refresh')).not.toHaveClass(/is-spinning/, { timeout: 5000 });

    // Theme: one click flips dark -> light, one more flips back — the old
    // dark -> light -> system cycle needed two clicks to see any change.
    await page.evaluate(() => applyTheme('dark'));
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('#btn-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Fix round 1 [Minor]: Home rows get the same deselect-anywhere
    // coverage as Browser rows. Prefer a real Recent row (populated by an
    // earlier "opened" action in this run); fall back to creating a
    // Favorites row directly, since nothing in this test performs an Open
    // action that would log one.
    await page.evaluate(() => switchScreen('home'));
    const homeRecentCount = await page.locator('#home-recent .fp-row').count();
    let homeRow;
    if (homeRecentCount > 0) {
      homeRow = page.locator('#home-recent .fp-row').first();
    } else {
      await postJson('/favorites', { path: `${docsDir}\\doc-00.txt` });
      await page.evaluate(() => loadFavorites());
      await page.waitForFunction(() => document.querySelectorAll('#home-favorites .fp-row').length > 0);
      // The Favorites pane itself is display:none until its sub-tab is
      // activated (initUnderlineTabs, app.js) — Recent starts active.
      await page.locator('#home-tabs .fp-tabs__item[data-tab="favorites"]').click();
      homeRow = page.locator('#home-favorites .fp-row').first();
    }
    await homeRow.click();
    await expect(homeRow).toHaveClass(/fp-row--selected/);
    const homeScreenBox = await page.locator('#screen-home').boundingBox();
    await page.mouse.click(homeScreenBox.x + homeScreenBox.width / 2, homeScreenBox.y + homeScreenBox.height - 20);
    await expect(page.locator('#screen-home .fp-row--selected')).toHaveCount(0);

    // --- Task 9: This PC section, Quick Access known folders, Backspace-deletes ---
    await page.evaluate(() => switchScreen('browser'));

    // Sidebar's Tree section is now the collapsible "This PC" section — no
    // more bare "Tree" label.
    await expect(page.locator('#sb-thispc .fp-sidebar__section-label')).toHaveText('This PC');
    await expect(page.locator('.fp-sidebar__section-label', { hasText: /^Tree$/ })).toHaveCount(0);

    // Chevron collapses #sb-drives and persists ui.sidebar_thispc_open=false;
    // clicking again restores the default (open) state for the rest of this run.
    await page.locator('#sb-thispc .fp-sidebar__chevron').click();
    await expect(page.locator('#sb-drives')).toBeHidden();
    await expect(page.locator('#sb-thispc .fp-sidebar__chevron')).toHaveAttribute('aria-expanded', 'false');
    const cfgCollapsed = await (await fetch(`${API}/config`, { headers: apiHeaders })).json();
    expect(cfgCollapsed['ui.sidebar_thispc_open']).toBe(false);
    await page.locator('#sb-thispc .fp-sidebar__chevron').click();
    await expect(page.locator('#sb-drives')).toBeVisible();
    await expect(page.locator('#sb-thispc .fp-sidebar__chevron')).toHaveAttribute('aria-expanded', 'true');

    // Task 9 review, fix round 1 (Task 10): Enter on the focused CHEVRON
    // itself (not the section-head row it sits inside) must only toggle
    // collapse, never also open This PC — the section-head's keydown
    // listener's e.target !== e.currentTarget guard.
    const pathBeforeChevronEnter = await page.evaluate(() => browserState.path);
    await page.locator('#sb-thispc .fp-sidebar__chevron').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sb-drives')).toBeHidden();
    expect(await page.evaluate(() => browserState.path)).toBe(pathBeforeChevronEnter);
    await page.locator('#sb-thispc .fp-sidebar__chevron').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sb-drives')).toBeVisible();

    // Quick Access renders Desktop and Downloads with absolute data-path
    // (real GET /known-folders paths, not the old sandbox-relative guess).
    const qaDesktop = page.locator('#sb-quick-access-folders [data-known-id="desktop"]');
    const qaDownloads = page.locator('#sb-quick-access-folders [data-known-id="downloads"]');
    await expect(qaDesktop).toBeVisible();
    await expect(qaDownloads).toBeVisible();
    expect(await qaDesktop.getAttribute('data-path')).toMatch(/^[A-Za-z]:\\/);
    expect(await qaDownloads.getAttribute('data-path')).toMatch(/^[A-Za-z]:\\/);

    // Settings › Personalization › Quick Access: unchecking Desktop removes
    // it from the sidebar; re-checking restores it.
    await page.evaluate(() => switchScreen('settings'));
    const desktopToggle = page.locator(
      '#settings-quick-access-list [data-action="settings-quick-access-toggle"][data-known-id="desktop"]');
    await expect(desktopToggle).toBeChecked();
    // force: true — the checkbox is visually skinned by sibling .fp-toggle__track/
    // __thumb spans (the real .fp-toggle CSS pattern, styles.css), which sit on top
    // of it and fail Playwright's actionability hit-test even though a real click
    // there still reaches the input (it's the label's native target).
    await desktopToggle.uncheck({ force: true });
    await expect(page.locator('#sb-quick-access-folders [data-known-id="desktop"]')).toHaveCount(0);
    await desktopToggle.check({ force: true });
    await expect(page.locator('#sb-quick-access-folders [data-known-id="desktop"]')).toBeVisible();

    // Backspace-deletes setting: with ui.backspace_deletes=true, selecting
    // doc-01.txt and pressing Backspace trashes it (no navUp); Ctrl+Z restores it.
    await postJson('/config', { key: 'ui.backspace_deletes', value: true });
    await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); });
    await page.evaluate(() => switchScreen('browser'));
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
    await rowByName('doc-01.txt').click();
    await page.keyboard.press('Backspace');
    await expect(rowByName('doc-01.txt')).toHaveCount(0);
    const trashOps = await (await fetch(`${API}/operations?limit=1`, { headers: apiHeaders })).json();
    expect(trashOps[0]?.op_type, JSON.stringify(trashOps)).toBe('trash');
    await page.keyboard.press('Control+z');
    await expect(rowByName('doc-01.txt')).toBeVisible();

    // Reset the config keys this block set so later smoke steps (and the
    // next verify run) see the documented defaults again.
    await fetch(`${API}/config/ui.sidebar_thispc_open`, { method: 'DELETE', headers: apiHeaders });
    await fetch(`${API}/config/ui.quick_access_hidden`, { method: 'DELETE', headers: apiHeaders });
    await fetch(`${API}/config/ui.backspace_deletes`, { method: 'DELETE', headers: apiHeaders });
    await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); loadQuickAccess(); });

    // --- Task 10: list scale, View/Sort toolbar menus, List view, dynamic
    // media view (playtest pass 1) ---

    // Pictures is all images (6/6 PNGs) — dynamic media view opens it in
    // grid automatically, with no View menu interaction at all.
    await page.evaluate((p) => loadDirectory(p), picsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 6);
    await expect(page.locator('#list-scroll')).toHaveAttribute('data-view', 'grid');

    // Documents is all text/markdown/PDF — opens in 'details' (the renamed
    // columns view) instead.
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
    await expect(page.locator('#list-scroll')).toHaveAttribute('data-view', 'details');

    // The View menu opens below the toolbar button; "List" switches
    // Documents to the new name-only single-column view (#list-head hidden).
    await page.locator('#btn-view-menu').click();
    await expect(page.locator('#context-menu')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'view-menu.png') });
    await page.locator('#context-menu .fp-context-menu__item', { hasText: 'List' }).click();
    await expect(page.locator('#list-scroll')).toHaveAttribute('data-view', 'list');
    await expect(page.locator('#list-head')).toBeHidden();

    // The manual "List" override on Documents must not leak onto Pictures —
    // it still opens in grid on its own (manualViewByPath is keyed by path).
    await page.evaluate((p) => loadDirectory(p), picsDir);
    await expect(page.locator('#list-scroll')).toHaveAttribute('data-view', 'grid');

    // Sort menu: Size + Descending puts the largest file first — verified
    // against GET /fs/list's own sizes rather than a hardcoded name.
    const picsEntries = (await (await fetch(
      `${API}/fs/list?path=${encodeURIComponent(picsDir)}`, { headers: apiHeaders })).json()).entries;
    const largestPicName = [...picsEntries].sort((a, b) => b.size - a.size)[0].name;
    await page.locator('#btn-sort-menu').click();
    await page.locator('#context-menu .fp-context-menu__item', { hasText: 'Size' }).click();
    await page.locator('#btn-sort-menu').click();
    await page.locator('#context-menu .fp-context-menu__item', { hasText: 'Descending' }).click();
    await expect(page.locator('#list-scroll .fp-row').first().locator('.fp-row__name')).toHaveText(largestPicName);

    // Ctrl+wheel over the file list changes --list-scale and leaves
    // Electron's own application zoom (Ctrl+=/-/0) completely alone.
    const getZoom = () => page.evaluate(() => (window.electronAPI?.getZoom ? window.electronAPI.getZoom() : null));
    const zoomBefore = await getZoom();
    const scaleBefore = await page.evaluate(() => browserState.listScale);
    const listScrollBoxForWheel = await page.locator('#list-scroll').boundingBox();
    await page.mouse.move(
      listScrollBoxForWheel.x + listScrollBoxForWheel.width / 2,
      listScrollBoxForWheel.y + listScrollBoxForWheel.height / 2,
    );
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(() => page.evaluate(() => browserState.listScale)).not.toBe(scaleBefore);
    expect(await getZoom()).toBe(zoomBefore);
    const scaleAfter = await page.evaluate(() => browserState.listScale);

    // /config holds the persisted scale, matching what the page just
    // applied — setListScale()'s saveSetting() POST is fire-and-forget, so
    // poll rather than assuming the round trip already landed the instant
    // the in-page value changed above.
    await expect.poll(async () => {
      const cfg = await (await fetch(`${API}/config`, { headers: apiHeaders })).json();
      return cfg['ui.list_scale'];
    }).toBe(scaleAfter);

    // Reset the config keys and in-memory manual-view map this block set,
    // and reload Documents in 'details' so later smoke steps (and the next
    // verify run) see the documented defaults again.
    await fetch(`${API}/config/ui.view_mode`, { method: 'DELETE', headers: apiHeaders });
    await fetch(`${API}/config/ui.sort`, { method: 'DELETE', headers: apiHeaders });
    await fetch(`${API}/config/ui.list_scale`, { method: 'DELETE', headers: apiHeaders });
    await page.evaluate(() => manualViewByPath.clear());
    await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); });
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
    await expect(page.locator('#list-scroll')).toHaveAttribute('data-view', 'details');

    // --- Task 11: selection visuals, context-menu applicability, favorites
    // feedback (playtest pass 1 §4.1-4.3) ---
    // Force a known sort order first — Task 10's own cleanup above deletes
    // ui.sort but applySettingsFromConfig() only ever reapplies a *present*
    // config value, never resets browserState.sort to a hardcoded default
    // when the key is absent — so it's still sitting at Size/Descending from
    // Task 10's own sort-menu step. doc-00.txt/doc-01.txt must be adjacent,
    // name-sorted rows for the shift-click merge check below.
    await page.evaluate(() => applySort('name', 'asc'));
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);

    // rowByName() is unscoped (page-wide .fp-row) — by this point in the run
    // doc-00.txt has been selected/inspected many times above, and
    // inspector.js logs each as a "opened" /recent action, so a Home Recent
    // row for it now exists in the DOM alongside the Browser row (and, once
    // this block favorites it below, a Favorites row too — home.js's
    // .fp-row--recent covers both Home panes). Scope lookups to the Browser
    // list itself so they stay unambiguous.
    const browserRow = (name) => page.locator('#list-scroll .fp-row').filter({
      has: page.locator('.fp-row__name', { hasText: new RegExp(`^${escapeRe(name)}$`) }),
    });

    // Edge-hugging + merged-border selection (§4.1): click doc-00.txt,
    // shift-click its immediate name-sorted neighbor doc-01.txt — both
    // select, and the SECOND row's own top border goes transparent (styles.css
    // ".fp-row--selected + .fp-row--selected") so only the first row's bottom
    // border shows at the seam, reading as one merged block.
    await browserRow('doc-00.txt').click();
    await browserRow('doc-01.txt').click({ modifiers: ['Shift'] });
    await expect(browserRow('doc-00.txt')).toHaveClass(/fp-row--selected/);
    await expect(browserRow('doc-01.txt')).toHaveClass(/fp-row--selected/);
    await expect(page.locator('#list-scroll')).toHaveAttribute('data-selection-count', '2');
    const doc00TopBorder = await browserRow('doc-00.txt').evaluate((el) => getComputedStyle(el).borderTopColor);
    const doc01TopBorder = await browserRow('doc-01.txt').evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(doc01TopBorder).toBe('rgba(0, 0, 0, 0)');
    expect(doc00TopBorder).not.toBe('rgba(0, 0, 0, 0)');

    // Settle the inspector's own 120ms debounce (onSelectionChanged ->
    // showInspectorMulti) before relying on anything downstream of this
    // selection — closes a race the multiselect screenshot below could
    // otherwise win against a still-stale inspector header (fix round 1).
    await expect(page.locator('#inspector-filename')).toHaveText(/2 items/);

    // F2 with two items selected must no-op (fix round 1 [Important]) —
    // canRenameSelection() (browser.js) is the one shared predicate behind
    // both this key and the menu's own Rename item below, so they can never
    // drift apart.
    await page.keyboard.press('F2');
    await expect(page.locator('.fp-row__rename')).toHaveCount(0);

    // Right-clicking WITHIN that existing multi-selection leaves it intact
    // (ensureRowSelected) — the file menu judges the whole 2-item selection:
    // Open is enabled (both .txt, one shared extension), Rename/Properties
    // are single-item-only rules and render aria-disabled + the disabled class.
    await browserRow('doc-01.txt').click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    const openItem = page.locator('#context-menu [data-action="cm-open"]');
    const renameItem = page.locator('#context-menu [data-action="cm-rename"]');
    const propsItem = page.locator('#context-menu [data-action="cm-properties"]');
    await expect(openItem).not.toHaveClass(/fp-context-menu__item--disabled/);
    await expect(renameItem).toHaveAttribute('aria-disabled', 'true');
    await expect(renameItem).toHaveClass(/fp-context-menu__item--disabled/);
    await expect(propsItem).toHaveAttribute('aria-disabled', 'true');
    // "Open in new tab" is folder-only (fix round 1 ruling) — hidden, not
    // merely disabled, on the file menu.
    await expect(page.locator('#context-menu [data-action="cm-open-new-tab"]')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, 'browser-multiselect.png') });
    await page.keyboard.press('Escape');

    // Mixed-extension multi-selection (.txt + .md): Open has no shared
    // extension to open with, so it's disabled.
    await browserRow('doc-00.txt').click();
    await browserRow('readme.md').click({ modifiers: ['Control'] });
    await browserRow('readme.md').click({ button: 'right' });
    await expect(page.locator('#context-menu [data-action="cm-open"]')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    // Favorites feedback (§4.3): Add to Favorites -> star appears on the row;
    // reopening the menu now offers Remove -> star disappears and the
    // backend no longer lists the path.
    //
    // doc-00.txt may already be favorited: the earlier Home deselect-anywhere
    // step (Task 8, above) favorites it directly via POST /favorites as its
    // fallback source of a Home row whenever this run's Recent list happened
    // to be empty at that point, and never unfavorites it again. Reset to a
    // known "not favorited" state first so the Add -> Remove sequence below
    // holds regardless of that earlier step's outcome.
    await fetch(`${API}/favorites?path=${encodeURIComponent(`${docsDir}\\doc-00.txt`)}`, {
      method: 'DELETE', headers: apiHeaders,
    });
    await page.evaluate(async () => { await favoritesReload(); await refreshDirectory(); });
    await expect(browserRow('doc-00.txt').locator('.fp-row__star')).toHaveCount(0);

    await browserRow('doc-00.txt').click();
    await browserRow('doc-00.txt').click({ button: 'right' });
    const favItem = page.locator('#context-menu [data-action="cm-favorite"]');
    await expect(favItem).toHaveText('Add to Favorites');
    await favItem.click();
    await expect(browserRow('doc-00.txt').locator('.fp-row__star')).toBeVisible();

    await browserRow('doc-00.txt').click({ button: 'right' });
    const favItem2 = page.locator('#context-menu [data-action="cm-favorite"]');
    await expect(favItem2).toHaveText('Remove from Favorites');
    await favItem2.click();
    await expect(browserRow('doc-00.txt').locator('.fp-row__star')).toHaveCount(0);
    await expect.poll(async () => {
      const favs = await (await fetch(`${API}/favorites`, { headers: apiHeaders })).json();
      return favs.files.some((f) => f.path === `${docsDir}\\doc-00.txt`);
    }).toBe(false);

    // Reset the sort this block forced so later smoke steps (and the next
    // verify run) see the documented default again.
    await fetch(`${API}/config/ui.sort`, { method: 'DELETE', headers: apiHeaders });
    await page.evaluate(async () => { await loadConfig(); applySettingsFromConfig(); });

    // --- Task 12: pointer-event drag and drop (playtest pass 1 §4.4) ---
    // The whole feature was rebuilt off HTML5 drag and drop onto pointer
    // events, so every step here is driven with raw page.mouse rather than
    // Playwright's drag helpers: a badge that re-labels itself mid-drag,
    // modifiers that retarget the operation with no pointer movement,
    // spring-loaded folders and a right-button climb are all things native
    // drag and drop structurally cannot do.
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);
    await page.evaluate(() => applySort('name', 'asc'));

    const dragBadge = page.locator('#drag-badge');
    const dragBadgeText = page.locator('#drag-badge .fp-drag-badge__text');
    // gen_sandbox.py builds exactly one folder inside _gen\Documents — "old"
    // (it holds the duplicate set's "report-2025 (1).txt").
    const oldFolder = browserRow('old');
    await expect(oldFolder).toBeVisible();

    const centerOf = async (locator) => {
      const b = await locator.boundingBox();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    // The newest operation's id — "did that gesture log anything?" is asked
    // several times below, and Escape/spring-load must both answer "no".
    const latestOpId = async () => {
      const ops = await (await fetch(`${API}/operations?limit=1`, { headers: apiHeaders })).json();
      return ops[0]?.id ?? 0;
    };

    // 1. Badge + live modifiers. Select doc-01.txt alone first so the badge's
    //    count is deterministic — the drag adopts whatever is selected.
    await browserRow('doc-01.txt').click();
    // Let the inspector's own 120ms selection debounce land before the drag
    // starts — drag-badge.png below is a review artefact, and catching the
    // panel mid-debounce would show it still captioned with the PREVIOUS
    // step's two-item selection.
    await expect(page.locator('#inspector-filename')).toHaveText('doc-01.txt');
    const doc01Pt = await centerOf(browserRow('doc-01.txt'));
    await page.mouse.move(doc01Pt.x, doc01Pt.y);
    await page.mouse.down();
    await page.mouse.move(doc01Pt.x + 40, doc01Pt.y, { steps: 5 });
    await expect(dragBadge).toBeVisible();
    await expect(dragBadgeText).toHaveText('Move file');

    // Ctrl forces Copy with the pointer completely still — proving the
    // keydown path re-renders the badge itself rather than waiting for the
    // next move (which is the whole reason HTML5 DnD could not do this).
    await page.keyboard.down('Control');
    await expect(dragBadgeText).toHaveText('Copy file');
    await page.keyboard.up('Control');
    await expect(dragBadgeText).toHaveText('Move file');

    // 2. Drop on the "old" folder row. The badge screenshot is taken on the
    //    first arrival, then the pointer leaves and re-enters the row: that
    //    counts as a target change, which restarts the 700ms spring timer, so
    //    the release below cannot race a spring-load navigation no matter how
    //    long the screenshot itself took.
    const oldPt = await centerOf(oldFolder);
    await page.mouse.move(oldPt.x, oldPt.y, { steps: 8 });
    await expect(oldFolder).toHaveClass(/fp-row--drag-target/);
    await page.screenshot({ path: path.join(SHOTS, 'drag-badge.png') });
    await page.mouse.move(oldPt.x + 200, oldPt.y, { steps: 2 });   // off the row
    await page.mouse.move(oldPt.x, oldPt.y, { steps: 2 });         // back on: spring timer restarts
    await expect(oldFolder).toHaveClass(/fp-row--drag-target/);
    await page.mouse.up();

    await expect(browserRow('doc-01.txt')).toHaveCount(0);
    const dropOps = await (await fetch(`${API}/operations?limit=1`, { headers: apiHeaders })).json();
    expect(dropOps[0]?.op_type, JSON.stringify(dropOps)).toBe('move');
    await page.keyboard.press('Control+z');
    await expect(browserRow('doc-01.txt')).toBeVisible();

    // 3. Spring-loaded folders: hold over "old" for a second and the drag
    //    descends into it, badge still up and the session still live. Escape
    //    then cancels without logging anything.
    const doc02Pt = await centerOf(browserRow('doc-02.txt'));
    const opIdBeforeSpring = await latestOpId();
    await page.mouse.move(doc02Pt.x, doc02Pt.y);
    await page.mouse.down();
    await page.mouse.move(doc02Pt.x + 40, doc02Pt.y, { steps: 5 });
    const oldPt2 = await centerOf(browserRow('old'));
    await page.mouse.move(oldPt2.x, oldPt2.y, { steps: 8 });
    // 700ms hover + a 250ms pulse + the /fs/list round trip.
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current'))
      .toHaveText('old', { timeout: 5000 });
    await expect(dragBadge).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dragBadge).toBeHidden();
    await page.mouse.up();
    expect(await latestOpId()).toBe(opIdBeforeSpring);
    // The spring navigated and nothing else: "old" still holds only its own
    // file, and doc-02.txt never left Documents.
    await expect(browserRow('report-2025 (1).txt')).toBeVisible();
    await expect(browserRow('doc-02.txt')).toHaveCount(0);

    // 4. Right button during a drag climbs one folder — the counterpart to
    //    springing down, and the other thing a native drag cannot offer
    //    (the OS drag loop owns the right button for the duration).
    const reportPt = await centerOf(browserRow('report-2025 (1).txt'));
    const opIdBeforeRight = await latestOpId();
    await page.mouse.move(reportPt.x, reportPt.y);
    await page.mouse.down();
    await page.mouse.move(reportPt.x + 40, reportPt.y, { steps: 5 });
    await expect(dragBadge).toBeVisible();
    await page.mouse.down({ button: 'right' });
    await page.mouse.up({ button: 'right' });
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current'))
      .toHaveText('Documents', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await latestOpId()).toBe(opIdBeforeRight);

    // --- Task 13: Properties panel (playtest pass 1 §5) ---
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);

    const propsModal = page.locator('#properties-modal');
    const generalGrid = propsModal.locator('#properties-general-grid');
    const applyBtn = page.locator('#properties-apply');
    // dt/dd are siblings inside #properties-general-grid's <dl> — the value
    // next to a given label, matched on the dt's EXACT text so "Size" never
    // also matches "Size on disk".
    const fieldValue = (label) => generalGrid.locator('dt', { hasText: new RegExp(`^${label}$`) })
      .locator('xpath=following-sibling::dd[1]');

    await browserRow('doc-00.txt').click();
    await browserRow('doc-00.txt').click({ button: 'right' });
    await page.locator('#context-menu [data-action="cm-properties"]').click();

    await expect(propsModal).toBeVisible();
    // fp-modal-in fades opacity 0 -> 1 — wait for it to fully settle before
    // any screenshot of this modal, or the shot can land mid-fade (Task 15
    // carry-over; reducedMotion above makes this all but instant, but the
    // wait stays as the actual guarantee).
    await expect(propsModal).toHaveCSS('opacity', '1');
    await expect(propsModal.locator('#properties-icon svg.fp-icon use[href="#fp-ft-text"]')).toHaveCount(1);
    await expect(fieldValue('Type of file')).toContainText('Text');
    await expect(fieldValue('Location')).toHaveText(/Documents$/);
    for (const label of ['Size', 'Created', 'Modified', 'Accessed']) {
      await expect(generalGrid.locator('dt', { hasText: new RegExp(`^${label}$`) })).toHaveCount(1);
    }
    // Footer: exactly Close + a disabled Apply — no Cancel (design spec §5.1).
    await expect(propsModal.locator('.properties__footer button')).toHaveCount(2);
    await expect(propsModal.locator('.properties__footer button', { hasText: 'Close' })).toHaveCount(1);
    await expect(applyBtn).toBeDisabled();
    await page.screenshot({ path: path.join(SHOTS, 'properties-file.png') });
    // Pass 2: the "Opens with" icon rides the same shell-icon pipeline as a
    // row (Tier A at the px bucket of round(16 * dpr), CSS-sized 16) — asserted only
    // when this PC has an association for .txt at all.
    const docProps = await (await fetch(`${API}/fs/properties?path=${encodeURIComponent(`${docsDir}\\doc-00.txt`)}`, { headers: apiHeaders })).json();
    if (docProps.opens_with_exe) {
      const opensWithImg = propsModal.locator('#properties-opens-with-icon img');
      await expect(opensWithImg).toHaveCount(1, { timeout: 3000 });
      const opensWithProof = await opensWithImg.evaluate((el) => ({ naturalWidth: el.naturalWidth, width: el.getBoundingClientRect().width }));
      expect(opensWithProof.naturalWidth).toBe(require('../iconCache').fpIconBucket(Math.round(16 * dpr)));
      expect(Math.abs(opensWithProof.width - 16)).toBeLessThan(0.5);
    }

    // Read-only round trip: tick → Apply → backend reports true; untick →
    // Apply → false. Together these leave the fixture exactly as they found
    // it, so no separate undo call is needed afterward.
    const docPropsUrl = `${API}/fs/properties?path=${encodeURIComponent(`${docsDir}\\doc-00.txt`)}`;
    const readOnlyRow = propsModal.locator('.properties__attr', { hasText: 'Read-only' });
    const readOnlyInput = propsModal.locator('input[data-action="props-attr-toggle"][data-attr="read_only"]');

    await readOnlyRow.click();
    await expect(readOnlyInput).toBeChecked();
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();
    await expect.poll(async () => (await (await fetch(docPropsUrl, { headers: apiHeaders })).json()).attributes.read_only)
      .toBe(true);
    await expect(applyBtn).toBeDisabled();

    await readOnlyRow.click();
    await expect(readOnlyInput).not.toBeChecked();
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();
    await expect.poll(async () => (await (await fetch(docPropsUrl, { headers: apiHeaders })).json()).attributes.read_only)
      .toBe(false);
    await expect(applyBtn).toBeDisabled();

    // Details tab lazy-loads on first activation: either grouped property
    // rows or the pywin32-missing message — never blank.
    await page.locator('#properties-tabs [data-tab="details"]').click();
    await expect.poll(async () => (await page.locator('#properties-details-content').innerText()).trim().length > 0)
      .toBe(true);

    await page.locator('[data-action="props-close"]').click();
    await expect(propsModal).toBeHidden();

    // A folder's Properties: Contains + the "Optimize this folder for" select
    // (gen_sandbox.py builds exactly one folder inside _gen\Documents — "old").
    await browserRow('old').click();
    await browserRow('old').click({ button: 'right' });
    await page.locator('#context-menu [data-action="cm-properties"]').click();
    await expect(propsModal).toBeVisible();
    await expect(propsModal).toHaveCSS('opacity', '1');
    await expect(generalGrid.locator('dt', { hasText: /^Contains$/ })).toHaveCount(1);
    await expect(fieldValue('Contains')).toContainText('file');
    await expect(page.locator('#properties-folder-type-select')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'properties-folder.png') });
    await page.locator('[data-action="props-close"]').click();
    await expect(propsModal).toBeHidden();

    // Back to a known listing for the screenshots below.
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);

    // --- Task 14: search overhaul (playtest pass 1 section 8) ---
    // Everything below runs against _gen\Documents, which gen_sandbox.py fills
    // with doc-00.txt .. doc-11.txt, three .md files and a .pdf.
    const searchInput = page.locator('#search-input');
    const searchDropdown = page.locator('#search-dropdown');
    const searchHeader = page.locator('#list-search-header');

    // 1. Focus opens the Filters + History dropdown.
    await searchInput.click();
    await expect(searchDropdown).toBeVisible();
    await expect(searchDropdown).toContainText('Filters');
    await expect(searchDropdown).toContainText('History');
    await expect(searchDropdown.locator('[data-filter="in"]')).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'search-dropdown.png') });

    // 2. Typing searches the current folder: rows carry <mark> around the
    //    matched substring and a Location subline, and the header counts them.
    await searchInput.fill('doc-0');
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible({ timeout: 2500 });
    await expect(page.locator('#list-scroll .fp-row mark').first()).toHaveText('doc-0');
    await expect(page.locator('#list-scroll .fp-row__location').first()).toBeVisible();
    await expect(searchHeader).toHaveText(/\d+ results/);
    // Every result is a real .fp-row carrying its absolute path, so the menus,
    // drag, favorites and properties from Tasks 11-13 all work unchanged.
    expect(await page.locator('#list-scroll .fp-row[data-path]').count()).toBeGreaterThan(0);
    const docZeroCount = await page.locator('#list-scroll .fp-row[data-path]').count();
    await expect(page.locator('#breadcrumb [data-action="search-clear"]')).toBeVisible();

    // 3. A filter row expands inline and its choice becomes a chip in the bar.
    await searchInput.click();
    await searchDropdown.locator('[data-action="search-expand-filter"][data-filter="type"]').click();
    await searchDropdown.locator('[data-action="search-pick-filter"][data-value="document"]').click();
    const typeChip = page.locator('#search-chips .fp-search-chip');
    await expect(typeChip).toHaveCount(1);
    await expect(typeChip).toContainText('type:');
    await expect(typeChip).toContainText('Document');
    // .txt files are in the document group, so the same rows are still listed.
    await expect.poll(() => page.locator('#list-scroll .fp-row[data-path]').count())
      .toBe(docZeroCount);
    // Picking a filter closes the dropdown, so this shows the results listing
    // itself: chip in the bar, <mark> highlights, Location sublines, header.
    await expect(searchDropdown).toBeHidden();
    await page.screenshot({ path: path.join(SHOTS, 'search-results.png') });

    // 4. Backspace at the start of the text eats the last chip; a second one
    //    is a no-op (nothing left to eat) and the results stay put.
    await searchInput.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(page.locator('#search-chips .fp-search-chip')).toHaveCount(0);
    await expect(searchInput).toHaveValue('doc-0');

    // 5. Clicking away closes the dropdown and keeps chips, text and results.
    await page.locator('#list-scroll').click({ position: { x: 10, y: 10 } });
    await expect(searchDropdown).toBeHidden();
    await expect(searchInput).toHaveValue('doc-0');
    await expect(searchHeader).toHaveText(/\d+ results/);

    // 5b. Ruling (fix round 1): Backspace with ui.backspace_deletes off goes
    //     "up" out of the results to the searched folder, like Explorer --
    //     the same navUp() the toolbar Up button and Alt+Up call.
    await page.locator('#list-scroll').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('Backspace');
    await expect(searchHeader).toBeHidden();
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Documents');
    await expect(page.locator('#list-scroll .fp-row mark')).toHaveCount(0);
    await expect(searchInput).toHaveValue('');
    // Re-run it so step 6's clear-by-x has something to clear.
    await searchInput.fill('doc-0');
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 2500 });

    // 6. The breadcrumb's x returns to the folder the tab was showing.
    await page.locator('#breadcrumb [data-action="search-clear"]').click();
    await expect(searchHeader).toBeHidden();
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Documents');
    await expect(page.locator('#list-scroll .fp-row mark')).toHaveCount(0);
    await expect(searchInput).toHaveValue('');

    // 6b. More filters: the modal opens seeded from the bar, and Apply turns
    //     its fields into chips (ext=txt keeps the same ten doc-0*.txt rows,
    //     so this proves the modal -> chip -> query parameter path end to end).
    await searchInput.fill('doc-0');
    await expect(searchHeader).toHaveText(/\d+ results/, { timeout: 2500 });
    await searchInput.click();
    await searchDropdown.locator('[data-action="search-more-filters"]').click();
    await expect(page.locator('#search-filters-modal')).toBeVisible();
    await page.locator('#search-filter-ext').fill('txt');
    await page.locator('[data-action="search-more-apply"]').click();
    await expect(page.locator('#search-filters-modal')).toBeHidden();
    await expect(page.locator('#search-chips .fp-search-chip')).toContainText('ext:');
    await expect.poll(() => page.locator('#list-scroll .fp-row[data-path]').count())
      .toBe(docZeroCount);

    // 6c. Per-tab search state: a second tab shows a plain listing while tab 1
    //     keeps its results, and coming back repaints them (no re-walk).
    await page.keyboard.press('Control+t');
    await expect(page.locator('.fp-tab')).toHaveCount(2);
    await page.evaluate((p2) => openBrowserAt(p2), picsDir);
    await expect(page.locator('#list-scroll .fp-row mark')).toHaveCount(0);
    await expect(searchInput).toHaveValue('');
    await page.locator('.fp-tab[data-tab-id="tab-1"]').click();
    await expect(searchInput).toHaveValue('doc-0');
    await expect(page.locator('#search-chips .fp-search-chip')).toContainText('ext:');
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible();
    await expect(searchHeader).toHaveText(/\d+ results/);

    // 6d. Race guard (fix round 1): fire an UNAWAITED search on tab 1, then
    //     switch to tab 2 before it can resolve. The aborted response must not
    //     paint over tab 2's Pictures listing nor write itself onto tab 2's
    //     record; switching back re-runs it and tab 1 shows results again.
    const tab2Search = await page.evaluate(() => tabs.list[1].id);
    await page.evaluate(() => { setSearchText('doc-1'); runSearch(); /* deliberately not awaited */ });
    await page.evaluate((id) => activateTab(id), tab2Search);
    await page.waitForTimeout(1500);
    await expect(page.locator('#list-scroll .fp-row mark')).toHaveCount(0);
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Pictures');
    expect(await page.evaluate((id) => tabs.list.find(t => t.id === id).search, tab2Search)).toBe(null);
    await page.locator('.fp-tab[data-tab-id="tab-1"]').click();
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible({ timeout: 3000 });
    await expect(searchHeader).toHaveText(/\d+ results/);

    await page.locator('.fp-tab').nth(1).click({ button: 'middle' });
    await expect(page.locator('.fp-tab')).toHaveCount(1);

    // Back out of search for the History check below.
    await page.locator('#breadcrumb [data-action="search-clear"]').click();
    await expect(searchHeader).toBeHidden();

    // 6e. Same-tab race guard (final review finding 1): unlike 6d, this is not
    // a tab switch — start a fresh search and, before it can resolve,
    // navigate away with loadDirectory() in the very same tab. leaveSearchMode()
    // (called at the top of loadDirectory()) must abort the in-flight request
    // and bump searchState._seq so the late response cannot supersede the new
    // folder listing, and showSearchPending() must bump browserState._loadSeq
    // so a slow /fs/list in flight from a still-earlier navigation can't paint
    // over the search either.
    const histLenBefore = await page.evaluate(() => nav.history.length);
    await page.evaluate(() => { setSearchText('doc-2'); runSearch(); /* deliberately not awaited */ });
    await page.evaluate((p) => { loadDirectory(p); /* deliberately not awaited */ }, picsDir);
    await page.waitForTimeout(1500);
    await expect(page.locator('#list-scroll .fp-row mark')).toHaveCount(0);
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('Pictures');
    expect(await page.evaluate(() => activeTab().search)).toBe(null);
    expect(await page.evaluate(() => nav.history.length)).toBe(histLenBefore + 1);
    // Restore the folder the History/palette checks below expect (readme.md
    // lives under docsDir, not Pictures, and the palette search's default
    // scope is "current location").
    await page.evaluate((p) => loadDirectory(p), docsDir);

    // 7. The search just run is in History, ready to restore.
    await searchInput.click();
    await expect(searchDropdown.locator('[data-action="search-history-run"]').first())
      .toContainText('doc-0');
    await page.keyboard.press('Escape');
    await expect(searchDropdown).toBeHidden();

    // 8. The palette's only file command hands the text to the same search.
    await page.keyboard.press('Control+k');
    await page.locator('#palette-input').fill('readme');
    const paletteSearchCmd = page.locator('#palette-search-results [data-action="palette-search-files"]');
    await expect(paletteSearchCmd).toContainText('Search files for');
    await expect(paletteSearchCmd).toHaveClass(/fp-palette__item--selected/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#palette-scrim')).toBeHidden();
    await expect(page.locator('#list-scroll .fp-row mark').first()).toBeVisible({ timeout: 2500 });
    await expect(page.locator('#list-scroll .fp-row__name').first()).toContainText('readme');
    await page.locator('#breadcrumb [data-action="search-clear"]').click();
    await expect(searchHeader).toBeHidden();

    // 9. Settings > Scan & Index lists real indexed roots (GET /index/status).
    const genDir = `${root}\\_gen`;
    await postJson('/index', { path: genDir });
    await expect.poll(async () =>
      (await (await fetch(`${API}/index/status`, { headers: apiHeaders })).json()).running,
      { timeout: 30000 }).toBe(false);
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-nav"][data-pane="scan-index"]').click();
    await expect(page.locator('#settings-index-status')).toContainText('_gen');
    await expect(page.locator('[data-action="settings-index-reindex"]').first()).toBeVisible();
    await expect(page.locator('[data-action="settings-index-remove"]').first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'settings-scan-index.png') });
    // Leave the index empty again so the next verify run starts from the same
    // state this one did.
    await fetch(`${API}/index?root=${encodeURIComponent(genDir)}`, { method: 'DELETE', headers: apiHeaders });

    // 10. Toolbar never overflows (fix round 1). At the app's minimum window
    //     width with the sidebar dragged to its 480px maximum, the toolbar has
    //     ~300px for everything: the breadcrumb yields to nothing, the search
    //     bar folds into its magnifier button, and every other control stays.
    await page.evaluate(() => switchScreen('browser'));
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(800, 600); });
    // Same property the drag handle writes (app.js's initSidebarResize).
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-width', '480px'));
    await expect(page.locator('#toolbar')).toHaveAttribute('data-narrow', '', { timeout: 3000 });
    await expect(page.locator('#search-collapsed')).toBeVisible();
    for (const id of ['#btn-view-menu', '#btn-sort-menu', '#btn-inspector-toggle', '#btn-theme', '#btn-up']) {
      await expect(page.locator(id)).toBeVisible();
    }
    const toolbarFits = await page.evaluate(() => {
      const t = document.getElementById('toolbar');
      return t.scrollWidth <= t.clientWidth;
    });
    expect(toolbarFits, 'toolbar overflows at 800px with a 480px sidebar').toBe(true);
    await page.screenshot({ path: path.join(SHOTS, 'toolbar-narrow.png') });

    // The magnifier expands the bar again; leaving it empty folds it back.
    await page.locator('#search-collapsed').click();
    await expect(searchInput).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search-collapsed')).toBeVisible();

    // Restore the window and sidebar for the screenshots below.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1200, 800); });
    await page.evaluate(() => document.documentElement.style.setProperty('--sidebar-width', '240px'));
    await expect(page.locator('#toolbar')).not.toHaveAttribute('data-narrow', '', { timeout: 3000 });

    // 11. Ask File+ (Task 15, design spec §9): sidebar pill opens a popout
    // shell with no model wired in — Send stays disabled, an example chip
    // fills the textarea, and Escape / an outside click both close it.
    const askBtn = page.locator('.fp-ask');
    await expect(askBtn).toHaveText('Ask File+');
    const askPopout = page.locator('#ask-popout');
    const askSend = page.locator('#ask-send');
    const askInput = page.locator('#ask-input');

    await askBtn.click();
    await expect(askPopout).toBeVisible();
    await expect(askPopout).toHaveCSS('opacity', '1');
    await expect(askSend).toBeDisabled();
    await expect(askSend).toHaveAttribute('title', 'AI arrives in Stage 3');

    const firstExample = askPopout.locator('.fp-ask-popout__example').first();
    const exampleText = await firstExample.getAttribute('data-text');
    await firstExample.click();
    await expect(askInput).toHaveValue(exampleText);
    await page.screenshot({ path: path.join(SHOTS, 'ask-popout.png') });

    await page.keyboard.press('Escape');
    await expect(askPopout).toBeHidden();
    // Carried fix (Task 16): focus returns to the button that opened it
    // rather than being stranded on the now-hidden popout.
    await expect(page.locator('#btn-ask-fileplus')).toBeFocused();

    // Fix round 1 (Task 16): the global Escape handler calls closeAskPopout()
    // unconditionally (alongside closePalette()/closeModal()/etc.), so with
    // the popout already closed, an unrelated Escape (here: dismissing the
    // palette) must NOT steal focus to the Ask File+ pill.
    await page.keyboard.press('Control+k');
    await expect(page.locator('#palette-scrim')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#palette-scrim')).toBeHidden();
    await expect(page.locator('#btn-ask-fileplus')).not.toBeFocused();

    // Ctrl+J toggles it open, and a click outside (not on the button or the
    // popout itself) closes it again — blank sidebar space below the last
    // item, same safe "definitely not an overlay, not a drag region" spot
    // the inspector-deselect check above already clicks.
    await page.keyboard.press('Control+j');
    await expect(askPopout).toBeVisible();
    const askSidebarBox = await page.locator('#sidebar').boundingBox();
    const askLastItemBox = await page.locator('#sidebar .fp-sidebar__item').last().boundingBox();
    await page.mouse.click(
      askSidebarBox.x + askSidebarBox.width / 2,
      Math.min(askLastItemBox.y + askLastItemBox.height + 20, askSidebarBox.y + askSidebarBox.height - 8),
    );
    await expect(askPopout).toBeHidden();
    await page.keyboard.press('Control+j');
    await expect(askPopout).toBeVisible();
    await page.keyboard.press('Control+j');
    await expect(askPopout).toBeHidden();

    // 12. Tag Canvas (D2C-3): still a Stage 3 placeholder — the banner shows,
    // its mock tag-tree/graph body is dimmed, but the header's own Close
    // button keeps working (it sits above the banner, not inside the dim).
    await page.evaluate(() => openTagCanvas());
    const tagCanvas = page.locator('#tag-canvas');
    await expect(tagCanvas).toBeVisible();
    await expect(tagCanvas.locator('.fp-banner--planned')).toHaveText('Not built yet — planned for Stage 3.');
    await expect(tagCanvas.locator('.fp-planned-dim')).toHaveCount(1);
    await page.locator('[data-action="close-tag-canvas"]').click();
    await expect(page.locator('#tag-canvas-scrim')).toBeHidden();

    // --- Pass 2 (startup-init-order) ---

    // 13. A backend that comes up AFTER the renderer repopulates the shell.
    // checkBackend() remembers the state it last painted; an offline/error ->
    // ok transition re-runs the one-shot startup loaders (refreshBackendData).
    // Simulated here by emptying the sidebar's drives and telling it the pill
    // was last painted 'offline' -- exactly what a renderer that started
    // before the backend sees on its next 30s poll.
    await page.evaluate(() => {
      document.getElementById('sb-drives').innerHTML = '';
      _backendState = 'offline';
    });
    await page.evaluate(() => checkBackend());
    await expect.poll(() => page.locator('#sb-drives .fp-sidebar__drive-item').count(),
      { timeout: 5000 }).toBeGreaterThan(0);

    // ...and the status pill itself is the manual reconnect affordance
    // (data-action="retry-backend-connect"), so the same recovery is one
    // click away rather than waiting out the poll.
    await page.evaluate(() => { document.getElementById('sb-drives').innerHTML = ''; });
    await page.locator('#status-backend').click();
    await expect(page.locator('#status-backend')).toHaveAttribute('data-state', 'ok', { timeout: 5000 });
    await expect.poll(() => page.locator('#sb-drives .fp-sidebar__drive-item').count(),
      { timeout: 5000 }).toBeGreaterThan(0);

    // 14. A failed GET /tags hides the whole Tags shelf instead of leaving an
    // empty 'Tags' label and 'View all' button standing in the sidebar.
    await page.evaluate(async () => {
      const orig = API.get.bind(API);
      API.get = (route, ...rest) => (route === '/tags'
        ? Promise.reject(new Error('simulated /tags failure'))
        : orig(route, ...rest));
      document.getElementById('sb-tags').hidden = false;
      document.getElementById('sb-tags-label').hidden = false;
      try { await loadSidebarTags(); } finally { API.get = orig; }
    });
    await expect(page.locator('#sb-tags')).toBeHidden();
    await expect(page.locator('#sb-tags-label')).toBeHidden();
    await page.evaluate(() => loadSidebarTags());

    // 15. A programmatic tab switch moves the accent underline with the
    // active class -- switchInspectorTab() used to leave it parked under
    // whichever tab had last been clicked, showing two selected tabs at once.
    await page.evaluate(() => {
      const el = document.getElementById('inspector');
      if (!el.classList.contains('inspector--open')) toggleInspector();
      switchInspectorTab('history');
    });
    const underline = await page.evaluate(() => {
      const bar = document.querySelector('.fp-inspector__tabs');
      const ind = bar.querySelector('.fp-tabs__indicator');
      const tab = bar.querySelector('.fp-inspector__tab[data-tab="history"]');
      return { left: ind.style.left, width: ind.style.width,
               tabLeft: `${tab.offsetLeft}px`, tabWidth: `${tab.offsetWidth}px` };
    });
    expect(underline.left).toBe(underline.tabLeft);
    expect(underline.width).toBe(underline.tabWidth);
    await page.evaluate(() => switchInspectorTab('preview'));

    // 16. Settings: the pane persisted on every switch finally has a reader
    // (restoreSettingsPane(), called from init), and an unreachable backend
    // no longer reports "No known folders detected on this PC." as fact.
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('.settings-nav__item[data-action="settings-nav"][data-pane="data"]').click();
    await page.evaluate(() => switchSettingsPane('personalization'));
    await expect(page.locator('.settings-nav__item[data-pane="personalization"]'))
      .toHaveClass(/settings-nav__item--active/);
    await page.evaluate(() => {
      sessionStorage.setItem('fp-settings-pane', 'data');
      restoreSettingsPane();
    });
    await expect(page.locator('.settings-nav__item[data-pane="data"]'))
      .toHaveClass(/settings-nav__item--active/);
    await page.evaluate(() => switchSettingsPane('personalization'));

    await page.evaluate(() => renderQuickAccessSettings([], new Set(), false));
    await expect(page.locator('#settings-quick-access-list')).toContainText('backend');
    await page.evaluate(() => loadQuickAccess());
    await expect(page.locator('#settings-quick-access-list [data-known-id="desktop"]')).toHaveCount(1);

    // Back to the Browser listing the screenshots below expect.
    await page.evaluate(() => switchScreen('browser'));
    await page.evaluate((p2) => loadDirectory(p2), docsDir);
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

// --- Pass 2: forced-DSF run (icon-design.md §5.4) --------------------------
// A cheap, screenshot-free second Electron launch that forces
// devicePixelRatio to 1.5 (verified to reach window.devicePixelRatio in this
// Electron -- scratchpad out/dpr-1.5-cli.json) so the sizing contract's
// rounding math (px = clampPx(round(css * dpr))) is exercised at a non-1
// scale independently of whatever this machine's own display scale happens
// to be.
test('shell bitmaps are device-pixel exact at a forced 150% scale', async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [FRONTEND, '--force-device-scale-factor=1.5'],
    cwd: FRONTEND,
    env,
  });
  const page = await app.firstWindow();
  // Without this, a real CSS fade-in transition (the settings screen switch
  // below) can leave Playwright's actionability check polling forever for a
  // "stable" frame instead of settling in a couple of frames -- the main
  // smoke test does the same for the same reason.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  const apiToken = process.env.FILEPLUS_API_TOKEN;
  const apiHeaders = apiToken ? { 'X-FilePlus-Token': apiToken } : {};
  try {
    await page.waitForSelector('#shell');
    // switchScreen() is a no-op until app.js's DOMContentLoaded handler has
    // run seedInitialTab() (activeTab() returns undefined before then) —
    // #shell itself is static markup, present in the DOM (and matched by
    // waitForSelector) before that handler runs at all, so wait for the
    // actual readiness condition rather than a fixed timeout.
    await page.waitForFunction(() => typeof tabs !== 'undefined' && tabs.list && tabs.list.length > 0);
    // Same settle wait the main smoke test uses before its first screen
    // switch (fonts, first /health poll) -- without it, the settings
    // screen's own fade-in can race Playwright's actionability check on the
    // very first interaction of a freshly-launched window.
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1.5);

    const root = (await (await fetch(`${API}/fs/list/root`, { headers: apiHeaders })).json()).path;
    const docsDir = `${root}\\_gen\\Documents`;
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowByName = (name) => page.locator('.fp-row').filter({
      has: page.locator('.fp-row__name', { hasText: new RegExp(`^${escapeRe(name)}$`) }),
    });

    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    await page.evaluate(() => switchScreen('browser'));
    await page.evaluate((p) => loadDirectory(p), docsDir);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 10);

    const txtIcon = rowByName('doc-00.txt').locator('img.fp-icon--win');
    await expect(txtIcon).toHaveAttribute('src', /^data:image\/png/, { timeout: 8000 });
    const proof = await txtIcon.evaluate((el) => ({
      naturalWidth: el.naturalWidth,
      px: el.dataset.px,
      exact: el.dataset.exact,
      src: el.src,
      width: el.getBoundingClientRect().width,
    }));
    // css 16 * dpr 1.5 = 24 physical px in a 16-CSS-px box.
    expect(proof.px).toBe('24');
    expect(proof.naturalWidth).toBe(24);
    expect(Math.abs(proof.width - 16)).toBeLessThan(0.5); // pinned to px/dpr = 24/1.5 = 16 CSS px
    // Tier A proof: the bitmap IS the backend's 24-px render (24 alone would
    // not prove it -- Tier B also yields 24 here, by resampling its 32).
    expect(proof.exact).toBe('1');
    const routeB64 = Buffer.from(await (await fetch(
      `${API}/shell/icon?path=${encodeURIComponent(`${docsDir}\\doc-00.txt`)}&px=24`, { headers: apiHeaders })).arrayBuffer()).toString('base64');
    expect(proof.src).toBe('data:image/png;base64,' + routeB64);

    // Tier B at 150%: with the route forced absent, a fresh extension goes
    // through app.getFileIcon -- still exactly 24 physical px in a 16-CSS-px
    // box (main.js's IHDR/DIP maths and its resample branch, independent of
    // the backend), while an extension-less file is refused to the sprite.
    await page.evaluate(() => fpShellIconRoute('absent'));
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Music`);
    const wavIcon = rowByName('take-01.wav').locator('img.fp-icon--win');
    await expect(wavIcon).toHaveAttribute('src', /^data:image\/png/, { timeout: 8000 });
    const wavProof = await wavIcon.evaluate((el) => ({ naturalWidth: el.naturalWidth, px: el.dataset.px, width: el.getBoundingClientRect().width }));
    expect(wavProof.px).toBe('24');
    expect(wavProof.naturalWidth).toBe(24);
    expect(Math.abs(wavProof.width - 16)).toBeLessThan(0.5);
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Projects`);
    await expect(rowByName('Makefile').locator('svg.fp-row__icon use[href="#fp-ft-generic"]')).toHaveCount(1, { timeout: 5000 });

    // Grid thumbnails at 150%: a 96-CSS-px tile box -> a 144-px bitmap.
    await page.evaluate(() => fpShellIconRoute('unknown'));
    await page.evaluate((p) => loadDirectory(p), `${root}\\_gen\\Pictures`);
    await page.waitForFunction(() => document.querySelectorAll('.fp-row').length >= 6);
    await page.evaluate(() => setViewMode('grid'));
    const thumb = page.locator('#list-scroll img.fp-thumb--ready[src^="data:image/png"]').first();
    await expect(thumb).toBeVisible({ timeout: 5000 });
    const thumbProof = await thumb.evaluate((el) => {
      const b = el.parentElement.getBoundingClientRect();
      return { long: Math.max(el.naturalWidth, el.naturalHeight), box: Math.max(b.width, b.height) };
    });
    // 96 css x 1.5 = 144 physical px, snapped up to the 192 bucket (§4.3).
    expect(thumbProof.long).toBe(require('../iconCache').fpIconBucket(Math.round(thumbProof.box * 1.5)));
    await page.evaluate(() => setViewMode('details'));
  } finally {
    // The icon-source setting is persisted server-side (POST /config), not
    // per-window -- reset it so it doesn't leak into a later run.
    await fetch(`${API}/config/ui.icon_source`, { method: 'DELETE', headers: apiHeaders }).catch(() => {});
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
