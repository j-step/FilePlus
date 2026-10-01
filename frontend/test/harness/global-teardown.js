// frontend/test/harness/global-teardown.js
// Stops the backend global-setup.js started (and only that one) and deletes
// the run's temp root (sandbox, fixture copy, database).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { healthy, killTree } = require('./net');

module.exports = async function globalTeardown() {
  const pid = Number(process.env.FILEPLUS_E2E_BACKEND_PID || 0);
  if (pid) {
    killTree(pid);
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
