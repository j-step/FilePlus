/**
 * File logs for the Electron side (dev harness, phase 1).
 *
 *   main.log     — the main process: startup, window lifecycle, IPC failures,
 *                  uncaught exceptions and unhandled promise rejections.
 *   renderer.log — everything the page writes to its console (console.log/
 *                  warn/error and every uncaught error, which Chromium reports
 *                  as a console error), forwarded by main.js from the
 *                  webContents 'console-message' event — no preload/IPC
 *                  bridge, so a renderer that dies before its scripts run is
 *                  still logged.
 *
 * Directory: FILEPLUS_LOG_DIR, else <repo>/logs — the same variable
 * backend/config.py reads for backend.log, so one setting moves all three
 * (the test harness points it at artifacts/logs).
 *
 * No `electron` import (like envToken.js / iconCache.js) so node-run tests can
 * require it. Writes are synchronous appends: a log line written just before
 * a crash must reach the disk. Rotation is at open time: a file past MAX_BYTES
 * becomes <name>.1 (one generation kept) — enough for a dev log.
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

const MAX_BYTES = 5 * 1024 * 1024;

function resolveLogDir(repoDir, env = process.env) {
  const fromEnv = env && typeof env.FILEPLUS_LOG_DIR === 'string' ? env.FILEPLUS_LOG_DIR.trim() : '';
  return fromEnv || path.join(repoDir, 'logs');
}

function _stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Formats any value the way console would, errors with their stack. */
function _fmt(args) {
  return args.map((a) => (a instanceof Error ? (a.stack || String(a))
    : typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: Infinity }))).join(' ');
}

/**
 * Returns { file, write(level, ...args), info, warn, error, debug }.
 * Never throws: a logger that cannot write (read-only disk, locked file)
 * must not take the app down with it — it falls back to stderr, or to
 * `onWriteError(err, line)` when given one.
 */
function createFileLogger(dir, name, { maxBytes = MAX_BYTES, onWriteError = null } = {}) {
  const file = path.join(dir, name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const st = fs.existsSync(file) ? fs.statSync(file) : null;
    if (st && st.size > maxBytes) fs.renameSync(file, file + '.1');
  } catch (_) { /* best effort — write() reports any real failure */ }
  function write(level, ...args) {
    const line = `${_stamp()} ${String(level).toUpperCase().padEnd(7)} ${_fmt(args).replace(/\r?\n/g, '\n    ')}\n`;
    try {
      fs.appendFileSync(file, line, 'utf8');
    } catch (err) {
      if (onWriteError) { onWriteError(err, line); return; }
      try { process.stderr.write(`[log write failed: ${err.message}] ${line}`); } catch (_) { /* nothing left */ }
    }
  }
  return {
    file,
    write,
    debug: (...a) => write('debug', ...a),
    info: (...a) => write('info', ...a),
    warn: (...a) => write('warning', ...a),
    error: (...a) => write('error', ...a),
  };
}

/** Chromium console level -> our level word. Electron 41 hands the
 * 'console-message' listener an event whose `level` is a string
 * ('debug'|'info'|'warning'|'error'); older builds passed a number
 * (0..3) positionally — both are accepted. */
function consoleLevelName(level) {
  if (typeof level === 'string') return level;
  return ['debug', 'info', 'warning', 'error'][Number(level)] || 'info';
}

module.exports = { resolveLogDir, createFileLogger, consoleLevelName, MAX_BYTES };
