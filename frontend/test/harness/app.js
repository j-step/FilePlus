// frontend/test/harness/app.js
// Shared helpers for Electron tests (dev harness phase 5). The backend and
// the fixture tree come from global-setup.js; this launches the real app
// against them and collects every renderer error.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(FRONTEND, '..');
const SHOTS = path.join(REPO, 'artifacts', 'screenshots');
const API = `http://127.0.0.1:${process.env.FILEPLUS_PORT || 9877}`;

function apiHeaders(extra = {}) {
  const t = process.env.FILEPLUS_API_TOKEN;
  return t ? { 'X-FilePlus-Token': t, ...extra } : extra;
}

async function apiGet(route) {
  const r = await fetch(`${API}${route}`, { headers: apiHeaders() });
  if (!r.ok) throw new Error(`GET ${route} -> ${r.status}`);
  return r.json();
}

/**
 * Launches the real Electron app. Returns { app, page, errors } where
 * `errors` collects page errors and console errors (with their source
 * location) for a zero-console-errors assertion. Waits until app.js has
 * seeded its first tab — the real "ready" signal (switchScreen() is a no-op
 * before it).
 */
async function launchApp({ args = [] } = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require('electron'), args: [FRONTEND, ...args], cwd: FRONTEND, env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location();
    errors.push(`console: ${m.text()}${loc && loc.url ? ` (${loc.url}:${loc.lineNumber})` : ''}`);
  });
  await page.waitForSelector('#shell');
  await page.waitForFunction(() => typeof tabs !== 'undefined' && tabs.list && tabs.list.length > 0);
  // Settled = the first /health poll came back green and the UI font is
  // loaded (screenshots and text measurements depend on both).
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return document.getElementById('status-backend')?.dataset.state === 'ok';
  }, null, { timeout: 15_000 });
  return { app, page, errors };
}

/** Saves artifacts/screenshots/<name>.png and returns its path. Names are
 * descriptive on purpose: they are opened and judged by eye (qa agent). */
async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Locator for the Browser row whose visible name is exactly `name`. */
function rowByName(page, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('#list-scroll .fp-row').filter({
    has: page.locator('.fp-row__name', { hasText: new RegExp(`^${esc}$`) }),
  });
}

function expectNoErrors(errors) {
  expect(errors, errors.join('\n')).toEqual([]);
}

module.exports = { FRONTEND, REPO, SHOTS, API, apiHeaders, apiGet, launchApp, shot, rowByName, expectNoErrors };
