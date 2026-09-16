/**
 * Tiny, dependency-free .env value reader.
 *
 * Mirrors python-dotenv's value handling -- backend/config.py loads the same
 * .env file via python-dotenv's load_dotenv(), so every process must agree
 * on a given key's value regardless of how it's quoted/commented. Originally
 * just FILEPLUS_API_TOKEN; readEnvFileValue(repoDir, key) is the general
 * form now used for FILEPLUS_PORT too (readEnvFileToken is kept as a thin
 * wrapper so existing callers/tests are unaffected).
 * No `electron` import here (unlike main.js) so this stays requirable from
 * plain node, including from a Playwright test.
 */
const fs = require('fs');
const path = require('path');

/** Strip surrounding matching quotes, else a trailing " #comment". */
function parseEnvValue(raw) {
  let v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  const commentAt = v.search(/\s#/);
  if (commentAt !== -1) v = v.slice(0, commentAt);
  return v.trim();
}

/** Read *key* from <repoDir>/.env, or '' if unset/missing/unreadable. */
function readEnvFileValue(repoDir, key) {
  try {
    const envPath = path.join(repoDir, '.env');
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const lineKey = trimmed.slice(0, eq).trim();
      if (lineKey === key) return parseEnvValue(trimmed.slice(eq + 1));
    }
  } catch (_) {
    // .env missing or unreadable — no value
  }
  return '';
}

/** Read FILEPLUS_API_TOKEN from <repoDir>/.env, or '' if unset/missing/unreadable. */
function readEnvFileToken(repoDir) {
  return readEnvFileValue(repoDir, 'FILEPLUS_API_TOKEN');
}

/**
 * Read the token the backend minted for itself from <repoDir>/.fileplus-token.
 *
 * backend/config.py's ensure_api_token() writes that file when
 * FILEPLUS_API_TOKEN is unset, so auth is on even in a bare dev launch. This
 * is the last of the three sources main.js tries (env -> .env -> this file);
 * '' when the file is missing or unreadable.
 */
function readTokenFile(repoDir) {
  try {
    return fs.readFileSync(path.join(repoDir, '.fileplus-token'), 'utf8').trim();
  } catch (_) {
    return '';
  }
}

/** The effective API token for *repoDir*: env -> .env -> minted token file. */
function resolveApiToken(repoDir, env) {
  return (env && env.FILEPLUS_API_TOKEN) || readEnvFileToken(repoDir) || readTokenFile(repoDir);
}

// The renderer can only reach a backend the page's own Content-Security-Policy
// allows: frontend/index.html's connect-src names exactly these two ports
// (9876 = the default, 9877 = scripts/verify.ps1's). A FILEPLUS_PORT outside
// the list is not a slow or refused connection -- every fetch is blocked
// inside the renderer as a TypeError, which surfaces as "Backend offline" for
// a backend that is actually up and healthy. Keep in sync with the meta tag.
const DEFAULT_API_PORT = 9876;
const CSP_ALLOWED_PORTS = [9876, 9877];

/**
 * The effective API port for *repoDir*: FILEPLUS_PORT from *env*, else from
 * <repoDir>/.env, else DEFAULT_API_PORT.
 *
 * A value that is not a usable port number falls back to the default. A
 * usable port that index.html's CSP does not allow is still returned (the
 * backend really is there, and silently talking to a DIFFERENT backend on
 * 9876 would be worse), but *warn* is called with an explanation first, so
 * the resulting "Backend offline" has a traceable cause.
 */
function resolveApiPort(repoDir, env, warn = console.warn) {
  const raw = String((env && env.FILEPLUS_PORT) || readEnvFileValue(repoDir, 'FILEPLUS_PORT') || '').trim();
  if (!raw) return DEFAULT_API_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    warn(`[fileplus] FILEPLUS_PORT="${raw}" is not a valid port number - using ${DEFAULT_API_PORT}.`);
    return DEFAULT_API_PORT;
  }
  if (!CSP_ALLOWED_PORTS.includes(port)) {
    warn(`[fileplus] FILEPLUS_PORT=${port} is not in frontend/index.html's Content-Security-Policy `
       + `connect-src (${CSP_ALLOWED_PORTS.join(', ')}). Every renderer fetch to it will be blocked by the `
       + `CSP and the app will report "Backend offline". Add the port to that meta tag to use it.`);
  }
  return port;
}

module.exports = {
  parseEnvValue, readEnvFileToken, readEnvFileValue, readTokenFile, resolveApiToken,
  resolveApiPort, DEFAULT_API_PORT, CSP_ALLOWED_PORTS,
};
