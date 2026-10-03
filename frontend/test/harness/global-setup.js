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

// Stage 2D Task 4 fix round: the generic-folder vote. ACustom sorts first and
// carries a desktop.ini custom icon (honoured by the shell because the folder
// is read-only and the ini is system+hidden); BPlain and CPlain are ordinary.
// Beside _gen and Icons so neither listing changes.
function buildVoteFixture(dir) {
  fs.mkdirSync(dir);
  for (const name of ['ACustom', 'BPlain', 'CPlain']) fs.mkdirSync(path.join(dir, name));
  const ini = path.join(dir, 'ACustom', 'desktop.ini');
  fs.writeFileSync(ini, '[.ShellClassInfo]\r\nIconResource=C:\\Windows\\System32\\shell32.dll,12\r\n');
  if (process.platform === 'win32') {
    spawnSync('attrib', ['+s', '+h', ini], { windowsHide: true });
    spawnSync('attrib', ['+r', path.join(dir, 'ACustom')], { windowsHide: true });
  }
}

// Stage 2D Task 5 (the view ladder, spec §3): a plain folder whose names
// stress every layout — a ~60-character name with no break opportunity, long
// multi-word names, and enough short ones to fill several rows and List
// columns — and an image folder (Gallery) of pictures in several aspect
// ratios, which opens in Large icons on its own. Beside _gen, Icons and
// Votes, so none of their listings change.
const VIEWS_LONG_UNBROKEN = 'AnExtremelyLongUnbrokenFileNameThatNeverOffersAWrapPoint60ch.txt';
function buildViewsFixture(dir) {
  fs.mkdirSync(dir);
  for (const name of ['Folder One', 'Folder Two', 'Another folder with a fairly long name for a folder']) {
    fs.mkdirSync(path.join(dir, name));
  }
  const files = [
    VIEWS_LONG_UNBROKEN,
    'A long multi-word document name that has to wrap over several lines in an icon cell before it ends.docx',
    'Quarterly planning notes for the team offsite and the follow-up actions we agreed on.md',
    'short.txt',
    'readme.md',
    'budget.xlsx',
    'slides.pptx',
  ];
  for (let i = 1; i <= 24; i++) files.push(`note-${String(i).padStart(2, '0')}.txt`);
  files.forEach((name, i) => fs.writeFileSync(path.join(dir, name), `views fixture ${i}\n`.repeat(i + 1)));
  const gallery = path.join(dir, 'Gallery');
  fs.mkdirSync(gallery);
  const shapes = [[320, 200], [200, 320], [256, 256], [400, 120], [180, 240], [300, 300],
    [360, 240], [240, 360], [128, 96], [96, 128], [420, 280], [280, 210]];
  shapes.forEach(([w, h], i) => {
    const rgb = [(40 + i * 37) % 256, (90 + i * 53) % 256, (160 + i * 29) % 256];
    fs.writeFileSync(path.join(gallery, `photo-${String(i + 1).padStart(2, '0')}.png`), solidPng(w, h, rgb));
  });
  fs.writeFileSync(path.join(gallery, 'A very long photograph name from the summer holiday at the lake house.png'),
    solidPng(300, 200, [220, 160, 60]));
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
  // Screenshots are judged by eye after a run: one left over from a test that
  // was renamed or deleted (or a run that stopped early) would be read as
  // today's app (Task 14 Q27). Every run starts with an empty folder.
  const shots = path.join(REPO, 'artifacts', 'screenshots');
  fs.rmSync(shots, { recursive: true, force: true });
  fs.mkdirSync(shots, { recursive: true });
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
  buildVoteFixture(path.join(sandbox, 'Votes'));
  buildViewsFixture(path.join(sandbox, 'Views'));
  // Stage 2D Task 7 (spec §6.2): a path deep and long enough that its
  // breadcrumb overflows any toolbar — the collapse-order tests open its
  // innermost folder. Names stay short enough for MAX_PATH under %TEMP%.
  let deep = path.join(sandbox, 'Deep');
  for (const name of ['Client-Projects', 'Northwind-Archive', 'Quarterly-Reports', 'Finance-Review',
    'Year-End-Closing', 'Supporting-Files', 'Scanned-Receipts', 'Final-Approved']) {
    deep = path.join(deep, name);
  }
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'deep-note.txt'), 'deep fixture\n');
  // Stage 2D Task 10 (pass-2 ux-daily-use leftovers): files to cut, copy and
  // paste (the clipboard marks) plus a destination folder. Beside the others,
  // so no other listing changes.
  const clip = path.join(sandbox, 'Clip');
  fs.mkdirSync(path.join(clip, 'Dest'), { recursive: true });
  for (const name of ['clip-a.txt', 'clip-b.txt', 'clip-c.txt', 'clip-d.txt']) {
    fs.writeFileSync(path.join(clip, name), `clip fixture ${name}\n`);
  }

  // Stage 2D Task 14 (final fix wave, stage2d-final.spec.js): files to
  // delete with a held key (Del), one to paste with a held Ctrl+V (Paste),
  // text files to page the inspector preview through (Texts), a folder whose
  // navigation a refresh must not cancel (Nav) and a one-item folder (One).
  const fin = path.join(sandbox, 'Final');
  for (const sub of ['Del', 'Paste', 'Texts', path.join('Nav', 'A'), path.join('Nav', 'B'), 'One']) {
    fs.mkdirSync(path.join(fin, sub), { recursive: true });
  }
  for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(fin, 'Del', `del-${i}.txt`), `del ${i}\n`);
  fs.writeFileSync(path.join(fin, 'Paste', 'p.txt'), 'paste me\n');
  for (let i = 1; i <= 20; i++) {
    fs.writeFileSync(path.join(fin, 'Texts', `t-${String(i).padStart(2, '0')}.txt`), `text ${i}\n`.repeat(40 + i));
  }
  fs.writeFileSync(path.join(fin, 'Nav', 'A', 'in-a.txt'), 'a\n');
  fs.writeFileSync(path.join(fin, 'Nav', 'B', 'in-b.txt'), 'b\n');
  fs.writeFileSync(path.join(fin, 'One', 'only.txt'), 'one\n');

  // Stage 2D addendum Task 7 (stage2d-motion.spec.js, content motion): a
  // folder tree to navigate (Nav), rows to delete / rename / create (Rows),
  // a file to paste (Src), a folder to sort (Sort: names and sizes in
  // opposite orders) and one with more than 30 rows (Many).
  const mo = path.join(sandbox, 'Motion');
  for (const sub of [path.join('Nav', 'Inner', 'Deepest'), 'Rows', 'Src', 'Sort', 'Many']) {
    fs.mkdirSync(path.join(mo, sub), { recursive: true });
  }
  for (let i = 1; i <= 6; i++) fs.writeFileSync(path.join(mo, 'Nav', `nav-${i}.txt`), `nav ${i}\n`);
  for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(mo, 'Nav', 'Inner', `inner-${i}.txt`), `inner ${i}\n`);
  for (let i = 1; i <= 10; i++) fs.writeFileSync(path.join(mo, 'Rows', `row-${String(i).padStart(2, '0')}.txt`), `row ${i}\n`);
  fs.writeFileSync(path.join(mo, 'Src', 'pasted.txt'), 'pasted\n');
  fs.writeFileSync(path.join(mo, 'Src', 'pasted-off.txt'), 'pasted with animations off\n');
  for (let i = 1; i <= 8; i++) fs.writeFileSync(path.join(mo, 'Sort', `sort-${i}.txt`), 'x'.repeat((9 - i) * 100));
  for (let i = 1; i <= 45; i++) fs.writeFileSync(path.join(mo, 'Many', `many-${String(i).padStart(2, '0')}.txt`), `many ${i}\n`);

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
