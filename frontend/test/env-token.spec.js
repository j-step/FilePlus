// frontend/test/env-token.spec.js
// Pure-logic test for envToken.js -- no Electron/browser needed, so it also
// serves as a fast, always-run check of the dotenv-compatible value parsing
// (main.js can't be required directly under plain node: it calls electron
// APIs at module load time).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEnvValue, readEnvFileToken, readEnvFileValue, readTokenFile, resolveApiToken,
        resolveApiPort, DEFAULT_API_PORT, CSP_ALLOWED_PORTS,
        resolveAppEnv, devToolsAllowed } = require('../envToken');

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

// Pass 2, finding #45 -- the backend always requires a token, minting one into
// <repo>/.fileplus-token when nothing is configured. main.js resolves it as
// env -> .env -> that file, so a bare dev launch still authenticates.
test.describe('resolveApiToken', () => {
  let dir;

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileplus-apitoken-'));
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reads the minted token file', () => {
    fs.writeFileSync(path.join(dir, '.fileplus-token'), 'minted-token\n');
    expect(readTokenFile(dir)).toBe('minted-token');
    expect(resolveApiToken(dir, {})).toBe('minted-token');
  });

  test('returns "" when no token file exists', () => {
    expect(readTokenFile(dir)).toBe('');
    expect(resolveApiToken(dir, {})).toBe('');
  });

  test('the process environment wins over both files', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_API_TOKEN=from-env-file\n');
    fs.writeFileSync(path.join(dir, '.fileplus-token'), 'minted-token\n');
    expect(resolveApiToken(dir, { FILEPLUS_API_TOKEN: 'from-process-env' })).toBe('from-process-env');
  });

  test('.env wins over the minted token file', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_API_TOKEN=from-env-file\n');
    fs.writeFileSync(path.join(dir, '.fileplus-token'), 'minted-token\n');
    expect(resolveApiToken(dir, {})).toBe('from-env-file');
  });
});

// Pass 2, finding #31 -- index.html's CSP connect-src names exactly two ports,
// so a FILEPLUS_PORT outside that pair is unreachable from the renderer: every
// fetch is blocked inside the page and the app reports "Backend offline" for a
// backend that is up. resolveApiPort still returns it (silently retargeting a
// DIFFERENT backend would be worse) but must say so.
test.describe('resolveApiPort', () => {
  let dir;
  let warnings;
  const warn = (msg) => warnings.push(msg);

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileplus-apiport-'));
    warnings = [];
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('defaults to 9876 with nothing configured', () => {
    expect(resolveApiPort(dir, {}, warn)).toBe(DEFAULT_API_PORT);
    expect(warnings).toEqual([]);
  });

  test('reads the port from .env and from the process environment', () => {
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_PORT=9877\n');
    expect(resolveApiPort(dir, {}, warn)).toBe(9877);
    expect(resolveApiPort(dir, { FILEPLUS_PORT: '9876' }, warn)).toBe(9876);
    expect(warnings).toEqual([]);
  });

  test('every CSP-allowed port resolves without a warning', () => {
    for (const port of CSP_ALLOWED_PORTS) {
      expect(resolveApiPort(dir, { FILEPLUS_PORT: String(port) }, warn)).toBe(port);
    }
    expect(warnings).toEqual([]);
  });

  test('a port outside the CSP list is returned WITH a warning naming the CSP', () => {
    expect(resolveApiPort(dir, { FILEPLUS_PORT: '9880' }, warn)).toBe(9880);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Content-Security-Policy');
    expect(warnings[0]).toContain('9880');
  });

  test('an unusable value falls back to the default with a warning', () => {
    expect(resolveApiPort(dir, { FILEPLUS_PORT: 'not-a-port' }, warn)).toBe(DEFAULT_API_PORT);
    expect(resolveApiPort(dir, { FILEPLUS_PORT: '70000' }, warn)).toBe(DEFAULT_API_PORT);
    expect(warnings).toHaveLength(2);
  });
});

test.describe('resolveAppEnv / devToolsAllowed (F12 is dev-only, Stage 2D §7.1)', () => {
  const noEnvFile = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fp-appenv-'));

  test('defaults to dev, honours the process env, then .env', () => {
    const dir = noEnvFile();
    expect(resolveAppEnv(dir, {})).toBe('dev');
    expect(resolveAppEnv(dir, { FILEPLUS_ENV: ' Test ' })).toBe('test');
    fs.writeFileSync(path.join(dir, '.env'), 'FILEPLUS_ENV=prod\n');
    expect(resolveAppEnv(dir, {})).toBe('prod');
    expect(resolveAppEnv(dir, { FILEPLUS_ENV: 'dev' })).toBe('dev');   // own env wins, like load_dotenv
  });

  test('DevTools only outside prod', () => {
    expect(devToolsAllowed('dev')).toBe(true);
    expect(devToolsAllowed('test')).toBe(true);
    expect(devToolsAllowed('prod')).toBe(false);
    expect(devToolsAllowed('PROD')).toBe(false);
  });
});
