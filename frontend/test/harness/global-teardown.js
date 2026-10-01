// frontend/test/harness/global-teardown.js
// Stops the backend global-setup.js started (and only that one) and deletes
// the run's temp root (sandbox, fixture copy, database).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function healthy(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

module.exports = async function globalTeardown() {
  const pid = Number(process.env.FILEPLUS_E2E_BACKEND_PID || 0);
  if (pid) {
    if (process.platform === 'win32') {
      // /T: `py -3` is a launcher; the real python.exe is its child.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      try { process.kill(pid); } catch (_) { /* already gone */ }
    }
    const port = process.env.FILEPLUS_PORT;
    for (let i = 0; i < 20 && port && (await healthy(port)); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (port && (await healthy(port))) {
      throw new Error(`backend still listening on ${port} after teardown`);
    }
  }
  const tmp = process.env.FILEPLUS_E2E_TMP;
  // Only ever delete what setup created: a folder under the OS temp dir with
  // our prefix.
  if (tmp && path.basename(tmp).startsWith('fileplus-e2e-') && path.dirname(tmp) === os.tmpdir()) {
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); break; } catch (_) {
        await new Promise((r) => setTimeout(r, 300)); // a file handle closing late
      }
    }
  }
};
