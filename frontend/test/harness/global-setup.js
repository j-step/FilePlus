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
const { healthy, killTree } = require('./net');

const REPO = path.resolve(__dirname, '..', '..', '..');
const PY = process.platform === 'win32' ? { cmd: 'py', pre: ['-3'] } : { cmd: 'python3', pre: [] };

function runPy(args, env) {
  const r = spawnSync(PY.cmd, [...PY.pre, ...args], { cwd: REPO, env, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${PY.cmd} ${args.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

// A solid-colour RGB PNG, built by hand (zlib + CRC32) so the fixture needs
// no image library and is byte-identical on every run.
function solidPng(width, height, rgb) {
  const zlib = require('zlib');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (tag, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Stage 2D Task 4 (flash-free icons, spec §4): beside _gen, not inside it, so
// _gen's own listings and counts are unchanged. Plain folders with no
// desktop.ini (their shell icon is the generic folder), a folder of plain
// sub-folders no test visits before it means to (Fresh), a corrupt image the
// shell cannot thumbnail, and two non-square pictures for freeform thumbnails.
function buildIconFixture(dir) {
  fs.mkdirSync(dir);
  for (const name of ['PlainA', 'PlainB', 'PlainC']) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, 'PlainA', 'note.txt'), 'plain\n');
  const fresh = path.join(dir, 'Fresh');
  fs.mkdirSync(fresh);
  for (const name of ['Sub1', 'Sub2', 'Sub3']) fs.mkdirSync(path.join(fresh, name));
  fs.writeFileSync(path.join(fresh, 'readme.txt'), 'fresh\n');
  // "Random" bytes from a fixed LCG: not a PNG at all past the extension.
  let seed = 0x2d4;
  const junk = Buffer.alloc(4096, 0).map(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed & 0xff; });
  fs.writeFileSync(path.join(dir, 'broken.png'), junk);
  fs.writeFileSync(path.join(dir, 'wide.png'), solidPng(240, 120, [70, 130, 180]));
  fs.writeFileSync(path.join(dir, 'tall.png'), solidPng(100, 200, [250, 250, 250]));
  fs.writeFileSync(path.join(dir, 'doc.txt'), 'icons fixture\n');
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
    // Both names, same value: backend/config.py's load_dotenv() only fills
    // variables that are MISSING, so deleting FILEPLUS_SANDBOX_PATH would let
    // a developer's .env put a different value back -- and two roots that
    // disagree stop the backend from starting.
    FILEPLUS_SANDBOX_PATH: sandbox,
    FILEPLUS_DB_PATH: path.join(tmpRoot, 'e2e.db'),
    FILEPLUS_LOG_DIR: logDir,
    FILEPLUS_PORT: String(port),
    FILEPLUS_API_TOKEN: token,
    WRITE_UNLOCKED: 'false',
  };
  delete env.ELECTRON_RUN_AS_NODE;

  runPy(['scripts/clear_logs.py', '--dir', logDir], env);
  process.stdout.write(runPy(['scripts/gen_sandbox.py', '--out', path.join(sandbox, '_gen')], env));
  // A folder long enough to scroll (Stage 2D refresh tests: scroll position
  // and row identity across an in-place refresh). Beside _gen, not inside it,
  // so _gen's own listings and indexed searches are unchanged. Deterministic
  // names and contents.
  const bulk = path.join(sandbox, 'Bulk');
  fs.mkdirSync(bulk);
  for (let i = 1; i <= 240; i++) {
    fs.writeFileSync(path.join(bulk, `bulk-${String(i).padStart(3, '0')}.txt`), `bulk ${i}\n`);
  }
  buildIconFixture(path.join(sandbox, 'Icons'));

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
      killTree(backend.pid); // teardown never runs when setup throws
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
    FILEPLUS_SANDBOX_PATH: sandbox,
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
  delete process.env.ELECTRON_RUN_AS_NODE;
  process.stdout.write(`e2e harness: backend pid ${backend.pid} on ${port}, root ${sandbox}, logs ${logDir}\n`);
};
