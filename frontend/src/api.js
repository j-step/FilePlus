/**
 * FilePlus API client.
 *
 * apiHeaders() attaches X-FilePlus-Token when main.js exposed one
 * (FILEPLUS_API_TOKEN set); a no-op object when it didn't, so callers can
 * always spread the result into a fetch() headers object.
 *
 * API wraps the FastAPI backend at API.base with get/post/patch/del helpers
 * that throw ApiError on non-2xx responses.
 */
// electronAPI.apiToken() is ipcRenderer.sendSync('get-api-token') -- a
// BLOCKING renderer->main round trip -- and apiHeaders() runs on every single
// request()/blob(). The token never changes once main.js has one, so the
// first non-empty answer is memoised here (the port beside it is already read
// once, at parse time). Empty answers are not cached: main.js resolves the
// token lazily, so a renderer that launched before the backend wrote
// <repo>/.fileplus-token still picks it up on a later call.
let _apiToken = '';
function apiToken() {
  if (!_apiToken) _apiToken = window.electronAPI?.apiToken?.() || '';
  return _apiToken;
}

function apiHeaders(extra = {}) {
  const t = apiToken();
  return t ? { 'X-FilePlus-Token': t, ...extra } : extra;
}

// Default bound for a call that must not hang the caller. Startup's loaders
// use it so a backend that has bound its port but not finished its lifespan
// (DB open, migrations, reconcile) can't leave the shell waiting forever;
// checkBackend's health poll passes its own, much tighter, 2s.
const API_TIMEOUT_MS = 10_000;
function apiTimeout(ms = API_TIMEOUT_MS) {
  return { signal: AbortSignal.timeout(ms) };
}

class ApiError extends Error { constructor(status, detail) { super(detail || `HTTP ${status}`); this.status = status; this.detail = detail; } }
// Base URL: the bridge's apiPort() (main.js's FILEPLUS_PORT, read synchronously
// via contextBridge before this script runs) when available, else the 9876
// default -- keeps a plain-browser dev load working the same as before.
const API = {
  base: `http://127.0.0.1:${window.electronAPI?.apiPort?.() || 9876}`,
  async request(method, path, { params, body, signal } = {}) {
    const url = new URL(this.base + path);
    if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
    const res = await fetch(url, { method, headers: apiHeaders(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, signal });
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    if (!res.ok) throw new ApiError(res.status, data && data.detail ? data.detail : res.statusText);
    return data;
  },
  // opts (e.g. { signal: AbortSignal.timeout(2000) }) lets a caller bound a
  // call that must not hang — checkBackend's health poll, in particular.
  get(path, params, opts) { return this.request('GET', path, { params, ...opts }); },
  post(path, body, opts) { return this.request('POST', path, { body, ...opts }); },
  patch(path, body, opts) { return this.request('PATCH', path, { body, ...opts }); },
  del(path, params, opts) { return this.request('DELETE', path, { params, ...opts }); },
  // Raw-response variant for routes that don't always answer JSON — GET
  // /preview returns image bytes (content-type image/*) for images and a
  // JSON body for text/binary/too-large. Callers inspect res.headers and
  // call res.blob() or res.json() themselves; request() can't be reused
  // because it unconditionally awaits res.json().
  async blob(path, params, { signal } = {}) {
    const url = new URL(this.base + path);
    if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
    const res = await fetch(url, { headers: apiHeaders(), signal });
    if (!res.ok) {
      let detail;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        try { const data = await res.json(); detail = data && data.detail; } catch (_) { /* not JSON after all */ }
      }
      throw new ApiError(res.status, detail || res.statusText);
    }
    return res;
  },
};
function formatApiError(err) { return err instanceof ApiError ? err.detail : (err && err.message) || String(err); }
