// frontend/test/env-token.spec.js
// Pure-logic test for envToken.js -- no Electron/browser needed, so it also
// serves as a fast, always-run check of the dotenv-compatible value parsing
// (main.js can't be required directly under plain node: it calls electron
// APIs at module load time).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEnvValue, readEnvFileToken, readEnvFileValue } = require('../envToken');

test.describe('parseEnvValue', () => {
  test('plain value', () => {
    expect(parseEnvValue('abc123')).toBe('abc123');
  });

  test('strips surrounding double quotes', () => {
    expect(parseEnvValue('"abc 123"')).toBe('abc 123');
  });

  test('strips surrounding single quotes', () => {
    expect(parseEnvValue("'abc 123'")).toBe('abc 123');
  });

  test('strips an inline comment preceded by whitespace', () => {
    expect(parseEnvValue('abc123 # a comment')).toBe('abc123');
  });

  test('does not treat a bare "#" with no preceding whitespace as a comment', () => {
    expect(parseEnvValue('abc#123')).toBe('abc#123');
  });

  test('does not strip a "#" inside quotes', () => {
    expect(parseEnvValue('"abc # not a comment"')).toBe('abc # not a comment');
  });

  test('trims surrounding whitespace', () => {
    expect(parseEnvValue('  abc123  ')).toBe('abc123');
  });
});

test.describe('readEnvFileToken', () => {
  let dir;

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileplus-envtoken-'));
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reads a plain token', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_API_TOKEN=abc123\n');
    expect(readEnvFileToken(dir)).toBe('abc123');
  });

  test('reads a quoted token with an inline comment ignored (quotes win)', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_API_TOKEN="abc # not a comment"\n');
    expect(readEnvFileToken(dir)).toBe('abc # not a comment');
  });

  test('reads an unquoted token and strips a trailing comment', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_API_TOKEN=abc123  # dev token\n');
    expect(readEnvFileToken(dir)).toBe('abc123');
  });

  test('ignores commented-out and unrelated lines', () => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      '# FILEPLUS_API_TOKEN=<random hex>  # optional in dev\nOTHER_KEY=x\nFILEPLUS_API_TOKEN=real-token\n'
    );
    expect(readEnvFileToken(dir)).toBe('real-token');
  });

  test('returns "" when .env is missing', () => {
    expect(readEnvFileToken(path.join(dir, 'does-not-exist'))).toBe('');
  });

  test('returns "" when the key is absent', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'OTHER_KEY=x\n');
    expect(readEnvFileToken(dir)).toBe('');
  });
});

test.describe('readEnvFileValue', () => {
  let dir;

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileplus-envvalue-'));
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reads FILEPLUS_PORT', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_PORT=9877\n');
    expect(readEnvFileValue(dir, 'FILEPLUS_PORT')).toBe('9877');
  });

  test('reads an arbitrary key alongside others, ignoring comments', () => {
    fs.writeFileSync(
      path.join(dir, '.env'),
      '# FILEPLUS_PORT=<override>  # optional in dev\nOTHER_KEY=x\nFILEPLUS_PORT=9877\n'
    );
    expect(readEnvFileValue(dir, 'FILEPLUS_PORT')).toBe('9877');
  });

  test('returns "" when the key is absent', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'OTHER_KEY=x\n');
    expect(readEnvFileValue(dir, 'FILEPLUS_PORT')).toBe('');
  });

  test('returns "" when .env is missing', () => {
    expect(readEnvFileValue(path.join(dir, 'does-not-exist'), 'FILEPLUS_PORT')).toBe('');
  });
});
