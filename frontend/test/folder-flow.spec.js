// frontend/test/folder-flow.spec.js — one end-to-end flow on the fixture
// tree: open the generated root in the Browser, see the fixture's folders,
// open Documents and Downloads, find their files (unicode and very long
// names included), select a file and see it in the Inspector. A screenshot
// at every step, named for what it shows (artifacts/screenshots/flow-*.png).
const { test, expect } = require('@playwright/test');
const { apiGet, launchApp, shot, rowByName, expectNoErrors } = require('./harness/app');

test('the Browser shows the fixture tree and its files', async () => {
  const root = (await apiGet('/fs/list/root')).path;
  expect(root.toLowerCase()).toBe(String(process.env.FILEPLUS_ROOT).toLowerCase()); // the harness's fresh copy, not a shared folder
  const gen = `${root}\\_gen`;

  const { app, page, errors } = await launchApp();
  try {
    await expect(page.locator('#status-backend')).toHaveAttribute('data-state', 'ok', { timeout: 10_000 });
    await shot(page, 'flow-01-home-on-launch');

    await page.evaluate((p) => openBrowserAt(p), gen);
    for (const name of ['Documents', 'Downloads', 'Pictures', 'Projects', 'Screenshots', 'Empty']) {
      await expect(rowByName(page, name)).toHaveCount(1);
    }
    await expect(page.locator('#breadcrumb .fp-breadcrumb__crumb--current')).toHaveText('_gen');
    await shot(page, 'flow-02-browser-fixture-root');

    await page.evaluate((p) => loadDirectory(p), `${gen}\\Documents`);
    for (const name of ['doc-00.txt', 'contract.pdf', 'Rechnung_Müller.txt', 'ノート.md', 'café menu.txt']) {
      await expect(rowByName(page, name)).toHaveCount(1);
    }
    await shot(page, 'flow-03-browser-documents');

    await page.evaluate((p) => loadDirectory(p), `${gen}\\Downloads`);
    for (const name of ['setup-tool.exe', 'FilePlusSetup-1.2.0.msi', 'LICENSE', 'disk-image.iso', 'presets.zip']) {
      await expect(rowByName(page, name)).toHaveCount(1);
    }
    const longRow = page.locator('#list-scroll .fp-row__name', { hasText: /^Quarterly budget review/ });
    await expect(longRow).toHaveCount(1);
    await shot(page, 'flow-04-browser-downloads-long-and-no-extension-names');

    await page.evaluate((p) => loadDirectory(p), `${gen}\\Documents`);
    await rowByName(page, 'doc-00.txt').click();
    await expect(page.locator('#list-scroll .fp-row--selected')).toHaveCount(1);
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await expect(page.locator('#inspector')).toContainText('doc-00.txt', { timeout: 5000 });
    await shot(page, 'flow-05-file-selected-inspector');
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});
