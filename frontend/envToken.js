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

module.exports = { parseEnvValue, readEnvFileToken, readEnvFileValue, readTokenFile, resolveApiToken };
