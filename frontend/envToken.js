/**
 * Tiny, dependency-free .env value parser for FILEPLUS_API_TOKEN.
 *
 * Mirrors python-dotenv's value handling for this one key -- backend/config.py
 * loads the same .env file via python-dotenv's load_dotenv(), so both
 * processes must agree on the token regardless of how it's quoted/commented.
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

/** Read FILEPLUS_API_TOKEN from <repoDir>/.env, or '' if unset/missing/unreadable. */
function readEnvFileToken(repoDir) {
  try {
    const envPath = path.join(repoDir, '.env');
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key === 'FILEPLUS_API_TOKEN') return parseEnvValue(trimmed.slice(eq + 1));
    }
  } catch (_) {
    // .env missing or unreadable — no token
  }
  return '';
}

module.exports = { parseEnvValue, readEnvFileToken };
