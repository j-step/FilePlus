// frontend/test/smoke.spec.js
// Launches the real Electron app against a running backend, visits every
// screen, fails on any renderer error, and screenshots each screen.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const FRONTEND = path.join(__dirname, '..');
const SHOTS = path.join(FRONTEND, '..', 'artifacts', 'screenshots');
const API = 'http://127.0.0.1:9876';
const SCREENS = [
  'home', 'browser', 'ftree', 'scan-config', 'scan-progress',
  'scan-results', 'review-bin', 'everything', 'settings',
];

test('backend /health is reachable', async () => {
  const r = await fetch(`${API}/health`);
  expect(r.ok).toBeTruthy();
  expect((await r.json()).status).toBe('ok');
});

test('every screen renders with no renderer errors', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [FRONTEND],
    cwd: FRONTEND,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.waitForSelector('#shell');
  await page.waitForTimeout(1500); // fonts, first /health poll

  for (const id of SCREENS) {
    await page.evaluate((s) => switchScreen(s), id);
    await expect(page.locator(`#screen-${id}`)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
  }

  await page.evaluate(() => openPalette());
  await page.screenshot({ path: path.join(SHOTS, 'palette.png') });
  await page.evaluate(() => closePalette());

  await app.close();
  expect(errors, errors.join('\n')).toEqual([]);
});
