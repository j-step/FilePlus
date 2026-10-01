// frontend/test/harness/net.js -- shared by global-setup.js and global-teardown.js.
const { spawnSync } = require('child_process');

/** True when a backend answers /health on `port` within a second. */
async function healthy(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

/** Kills `pid` and its children. On Windows `py -3` is a launcher whose
 * child python.exe is the real backend, so the whole tree must go. */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(pid); } catch (_) { /* already gone */ }
  }
}

module.exports = { healthy, killTree };
