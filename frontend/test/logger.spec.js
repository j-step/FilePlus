// frontend/test/logger.spec.js
// Pure-logic test for logger.js (no Electron): the main/renderer file logs.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLogDir, createFileLogger, consoleLevelName } = require('../logger');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fp-logger-'));
}

test.describe('logger.js', () => {
  test('resolveLogDir prefers FILEPLUS_LOG_DIR, else <repo>/logs', () => {
    expect(resolveLogDir('C:\\repo', { FILEPLUS_LOG_DIR: 'D:\\x' })).toBe('D:\\x');
    expect(resolveLogDir('C:\\repo', { FILEPLUS_LOG_DIR: '  ' })).toBe(path.join('C:\\repo', 'logs'));
    expect(resolveLogDir('C:\\repo', {})).toBe(path.join('C:\\repo', 'logs'));
  });

  test('writes timestamped, levelled lines and creates the folder', () => {
    const dir = path.join(tmpDir(), 'nested');
    const log = createFileLogger(dir, 'main.log');
    log.info('hello', { a: 1 });
    log.error('boom', new Error('kaput'));
    const text = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    const lines = text.trim().split('\n');
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} INFO +hello \{ a: 1 \}$/);
    expect(text).toContain('ERROR');
    expect(text).toContain('Error: kaput');
    expect(text).toMatch(/\n {4,}at /); // stack frames indented under their line
  });

  test('rotates a file past maxBytes when the logger opens', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'renderer.log'), 'x'.repeat(50));
    const log = createFileLogger(dir, 'renderer.log', { maxBytes: 10 });
    log.info('fresh');
    expect(fs.readFileSync(path.join(dir, 'renderer.log.1'), 'utf8')).toBe('x'.repeat(50));
    expect(fs.readFileSync(path.join(dir, 'renderer.log'), 'utf8')).toContain('fresh');
  });

  test('never throws when the folder cannot be written', () => {
    const dir = tmpDir();
    const blocker = path.join(dir, 'file-not-dir');
    fs.writeFileSync(blocker, '');
    const failures = [];
    const log = createFileLogger(path.join(blocker, 'sub'), 'main.log', { onWriteError: (err, line) => failures.push([err.code, line]) });
    expect(() => log.error('still alive')).not.toThrow();
    expect(failures).toHaveLength(1);
    expect(failures[0][1]).toContain('still alive');
  });

  test('consoleLevelName accepts Electron 41 strings and legacy numbers', () => {
    expect(consoleLevelName('warning')).toBe('warning');
    expect(consoleLevelName(3)).toBe('error');
    expect(consoleLevelName(0)).toBe('debug');
    expect(consoleLevelName(9)).toBe('info');
  });
});
