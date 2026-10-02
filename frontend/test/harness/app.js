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

function rendererLogPath() {
  return path.join(process.env.FILEPLUS_LOG_DIR || path.join(REPO, 'artifacts', 'logs'), 'renderer.log');
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch (_) { return 0; }
}

const LOG_LINE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} (\S+)\s+(.*)$/;

/** ERROR entries main.js wrote to renderer.log from byte `from` on. */
function loggedRendererErrors(from) {
  let buf;
  try { buf = fs.readFileSync(rendererLogPath()); } catch (_) { return []; }
  // main.js rotates the file (> 5 MB) when it starts: then it is all new.
  const text = buf.subarray(buf.length >= from ? from : 0).toString('utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(LOG_LINE);
    if (m) { if (m[1] === 'ERROR') out.push(m[2]); else out.push(null); continue; }
    // A multi-line message continues on lines indented by four spaces.
    if (line.startsWith('    ') && out.length && out[out.length - 1] !== null) out[out.length - 1] += `\n${line.slice(4)}`;
  }
  return out.filter((e) => e !== null);
}

/**
 * Launches the real Electron app. Returns { app, page, errors } where
 * `errors` collects page errors and console errors (with their source
 * location) for a zero-console-errors assertion. Waits until app.js has
 * seeded its first tab — the real "ready" signal (switchScreen() is a no-op
 * before it).
 *
 * Two sources feed `errors` (pass 2 #106):
 *  - Playwright's page listeners, live, from the moment launch() returns.
 *    They cannot be attached earlier: Playwright lets the app reach 'ready'
 *    inside launch(), so the window can exist (and log) before any listener
 *    is registered.
 *  - renderer.log, read when the app closes: main.js attaches its
 *    console-message listener when it creates the window, before the page
 *    loads, so the log has every error from the first line on — including
 *    ones Chromium never reports to DevTools at all (a "ResizeObserver loop
 *    completed with undelivered notifications" is logged there, not as a
 *    pageerror). An entry the page listeners already reported is not
 *    repeated. So: assert `errors` after `await app.close()`.
 */
async function launchApp({ args = [], keepZoom = false } = {}) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const logFrom = fileSize(rendererLogPath());
  const app = await electron.launch({ executablePath: require('electron'), args: [FRONTEND, ...args], cwd: FRONTEND, env });
  const errors = [];
  const reported = []; // raw texts the page listeners saw, for de-duplication
  const listened = new Set();
  const listen = (p) => {
    if (listened.has(p)) return;
    listened.add(p);
    p.on('pageerror', (e) => { errors.push(`pageerror: ${e.message}`); reported.push(e.message); });
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const loc = m.location();
      errors.push(`console: ${m.text()}${loc && loc.url ? ` (${loc.url}:${loc.lineNumber})` : ''}`);
      reported.push(m.text());
    });
  };
  app.on('window', listen);
  const page = await app.firstWindow();
  listen(page);
  const close = app.close.bind(app);
  let closed = false;
  app.close = async () => {
    await close();
    if (closed) return;
    closed = true;
    for (const entry of loggedRendererErrors(logFrom)) {
      // main.js appends " (source:line)" to the message; without it the entry
      // is the message the page listener reported (a pageerror's carries
      // Chromium's "Uncaught …:" prefix, so for those the message is its end).
      const msg = entry.replace(/ \([^()]*:\d+\)$/, '');
      const i = reported.findIndex((t) => t && (msg === t || msg.startsWith(`${t} `) || /^Uncaught /.test(msg) && msg.endsWith(t)));
      if (i >= 0) reported.splice(i, 1);
      else errors.push(`renderer.log: ${entry}`);
    }
  };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitReady(page);
  // Electron restores the page zoom from the run's shared profile, so a test
  // that died at 150 % used to start every later test at 150 % (Task 11: one
  // failure cascaded into four). Each test starts at 100 % unless it is the
  // one checking that restore (keepZoom).
  if (!keepZoom) {
    const z = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
    if (Math.abs(z - 1) > 0.001) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
      await page.waitForFunction(() => typeof appZoom !== 'undefined' && Math.abs(appZoom.current - 1) < 0.001
        && !window.__fpZoomBusy, null, { timeout: 5000 });
    }
  }
  return { app, page, errors };
}

/** The app is up: app.js seeded its first tab and finished its startup
 * (config, known folders, drives, pins, tags, Quick Access all loaded and
 * applied — window.__fpInitDone), the first /health poll came back green and
 * the UI font is loaded (screenshots and text measurements depend on both).
 * Acting before startup had finished raced it: the config landing re-applied
 * settings and re-rendered rows/sidebar under the test's clicks. */
async function waitReady(page) {
  await page.waitForSelector('#shell');
  await page.waitForFunction(() => typeof tabs !== 'undefined' && tabs.list && tabs.list.length > 0);
  await page.waitForFunction(() => window.__fpInitDone === true, null, { timeout: 15_000 });
  await page.waitForFunction(async () => {
    await document.fonts.ready;
    return document.getElementById('status-backend')?.dataset.state === 'ok';
  }, null, { timeout: 15_000 });
}

/** Clears the page's localStorage and reloads, so the run starts from default
 * settings rather than whatever the profile persisted; resolves once the
 * reloaded app is ready (waitReady), never after a fixed sleep. */
async function resetToDefaults(page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await waitReady(page);
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

module.exports = { FRONTEND, REPO, SHOTS, API, apiHeaders, apiGet, launchApp, waitReady, resetToDefaults, shot, rowByName, expectNoErrors };
