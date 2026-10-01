// frontend/test/harness/global-setup.js
// Playwright globalSetup for every Electron test (dev harness phase 5).
//
// Makes `npx playwright test` self-contained and safe:
//   1. a fresh temp root per run (os.tmpdir()/fileplus-e2e-XXXX) holding the
//      sandbox, the database and a fresh copy of the messy fixture tree
//      (scripts/gen_sandbox.py -> <sandbox>/_gen) — never a shared folder;
//   2. the backend started on FILEPLUS_PORT (default 9877, NOT the dev
//      backend's 9876) with FILEPLUS_ENV=test and FILEPLUS_ROOT=<sandbox>, so
//      the write guard refuses anything outside the temp root;
//   3. logs in <repo>/artifacts/logs (cleared first), so a test run never
//      wipes the logs of a dev session;
//   4. a throwaway Electron profile (FILEPLUS_USER_DATA_DIR) so tests never
//      touch the real app's settings or wait on a FilePlus window left open;
//   5. everything the tests and the Electron app need exported through
//      process.env, which Playwright hands to every worker.
// global-teardown.js stops the backend and deletes the temp root.
//
// It never kills a process it did not start: if something already answers
// on the port, setup fails with the reason instead.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PY = process.platform === 'win32' ? { cmd: 'py', pre: ['-3'] } : { cmd: 'python3', pre: [] };

async function healthy(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

function runPy(args, env) {
  const r = spawnSync(PY.cmd, [...PY.pre, ...args], { cwd: REPO, env, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${PY.cmd} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

module.exports = async function globalSetup() {
  const port = process.env.FILEPLUS_PORT || '9877';
  if (await healthy(port)) {
    throw new Error(`port ${port} already has a backend on it; stop it first `
      + '(the test harness starts its own and never kills a process it did not start)');
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fileplus-e2e-'));
  const sandbox = path.join(tmpRoot, 'sandbox');
  fs.mkdirSync(sandbox);
  const logDir = path.join(REPO, 'artifacts', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const token = process.env.FILEPLUS_API_TOKEN || 'fileplus-dev-token';

  const env = {
    ...process.env,
    FILEPLUS_ENV: 'test',
    FILEPLUS_ROOT: sandbox,
    FILEPLUS_DB_PATH: path.join(tmpRoot, 'e2e.db'),
    FILEPLUS_LOG_DIR: logDir,
    FILEPLUS_PORT: String(port),
    FILEPLUS_API_TOKEN: token,
    WRITE_UNLOCKED: 'false',
  };
  delete env.FILEPLUS_SANDBOX_PATH; // FILEPLUS_ROOT is the one name in this process tree
  delete env.ELECTRON_RUN_AS_NODE;

  runPy(['scripts/clear_logs.py', '--dir', logDir], env);
  process.stdout.write(runPy(['scripts/gen_sandbox.py', '--out', path.join(sandbox, '_gen')], env));

  const backend = spawn(PY.cmd, [...PY.pre, '-m', 'backend.api'], {
    cwd: REPO, env, stdio: 'ignore', windowsHide: true, detached: false,
  });
  let exited = null;
  backend.on('exit', (code) => { exited = code; });

  const deadline = Date.now() + 60_000;
  while (!(await healthy(port))) {
    if (exited !== null) {
      throw new Error(`backend exited during startup (code ${exited}); see ${path.join(logDir, 'backend.log')}`);
    }
    if (Date.now() > deadline) {
      try { process.kill(backend.pid); } catch (_) { /* already gone */ }
      throw new Error(`backend did not answer /health on ${port} within 60 s; see ${path.join(logDir, 'backend.log')}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  // Exported to every worker (and from there into the Electron app the
  // tests launch, which reads FILEPLUS_PORT / FILEPLUS_API_TOKEN /
  // FILEPLUS_LOG_DIR in main.js).
  Object.assign(process.env, {
    FILEPLUS_ENV: 'test',
    FILEPLUS_ROOT: sandbox,
    FILEPLUS_PORT: String(port),
    FILEPLUS_API_TOKEN: token,
    FILEPLUS_LOG_DIR: logDir,
    FILEPLUS_E2E_TMP: tmpRoot,
    // A throwaway Electron profile per run (main.js honours this): tests must
    // never read or clear the real app's localStorage in %APPDATA%\fileplus,
    // nor queue behind a FilePlus window the user has open.
    FILEPLUS_USER_DATA_DIR: path.join(tmpRoot, 'electron-profile'),
    FILEPLUS_E2E_BACKEND_PID: String(backend.pid),
  });
  delete process.env.FILEPLUS_SANDBOX_PATH;
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.stdout.write(`e2e harness: backend pid ${backend.pid} on ${port}, root ${sandbox}, logs ${logDir}\n`);
};
