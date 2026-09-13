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
    // data-action="refresh-directory" wiring reaches refreshDirectory() end
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

    // Refresh, part 2: refreshDirectory() itself adds .is-spinning to the
    // button synchronously, before it ever awaits the re-list — proven by
    // calling it and reading the class back in the SAME evaluate() (no
    // round trip in between), since the local backend answers /fs/list fast
    // enough that a real click's own round trip can resolve only after the
    // whole request has already completed and the class already removed
    // again (route interception to slow it down artificially was tried and
    // dropped — toggling network interception mid-test made an unrelated,
    // genuinely concurrent /preview request fail instead).
    const spunImmediately = await page.evaluate(() => {
      refreshDirectory();
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
