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

    await page.waitForTimeout(1500); // fonts, first /health poll

    for (const id of SCREENS) {
      await page.evaluate((s) => switchScreen(s), id);
      await expect(page.locator(`#screen-${id}`)).toBeVisible();
      await page.screenshot({ path: path.join(SHOTS, `${id}.png`) });
    }

    await page.evaluate(() => openPalette());
    await page.screenshot({ path: path.join(SHOTS, 'palette.png') });
    await page.evaluate(() => closePalette());
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});
