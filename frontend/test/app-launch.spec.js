// frontend/test/app-launch.spec.js — the fast smoke (`npm run test:smoke`).
// The real Electron app launches against the harness backend (fresh fixture
// copy, FILEPLUS_ENV=test), the main window renders its shell, nothing logs
// a console error, all three log files are written, and a screenshot is
// saved for a visual check: artifacts/screenshots/smoke.png.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { REPO, apiGet, launchApp, shot, expectNoErrors } = require('./harness/app');

test('app launches, renders, logs, and reports no console errors', async () => {
  const health = await apiGet('/health');
  expect(health.env).toBe('test');
  expect(health.write_unlocked).toBe(false);

  const { app, page, errors } = await launchApp();
  try {
    await expect(page.locator('#shell')).toBeVisible();
    await expect(page.locator('.sidebar, #sidebar').first()).toBeVisible();
    await expect(page.locator('#status-backend')).toHaveAttribute('data-state', 'ok', { timeout: 10_000 });
    await shot(page, 'smoke');
  } finally {
    await app.close();
  }
  expectNoErrors(errors);

  // Phase 1 guarantee: every layer wrote its log for this run.
  const logDir = process.env.FILEPLUS_LOG_DIR || path.join(REPO, 'artifacts', 'logs');
  for (const [name, needle] of [['backend.log', 'GET /'], ['main.log', 'window loaded'], ['renderer.log', 'page loaded']]) {
    const file = path.join(logDir, name);
    expect(fs.existsSync(file), `${file} missing`).toBe(true);
    expect(fs.readFileSync(file, 'utf8'), `${name} has no "${needle}" line`).toContain(needle);
  }
});
