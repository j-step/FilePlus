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
function apiHeaders(extra = {}) {
  const t = window.electronAPI?.apiToken?.();
  return t ? { 'X-FilePlus-Token': t, ...extra } : extra;
}

class ApiError extends Error { constructor(status, detail) { super(detail || `HTTP ${status}`); this.status = status; this.detail = detail; } }
const API = {
  base: 'http://127.0.0.1:9876',
  async request(method, path, { params, body } = {}) {
    const url = new URL(this.base + path);
    if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
    const res = await fetch(url, { method, headers: apiHeaders(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    if (!res.ok) throw new ApiError(res.status, data && data.detail ? data.detail : res.statusText);
    return data;
  },
  get(path, params) { return this.request('GET', path, { params }); },
  post(path, body) { return this.request('POST', path, { body }); },
  patch(path, body) { return this.request('PATCH', path, { body }); },
  del(path, params) { return this.request('DELETE', path, { params }); },
  // Raw-response variant for routes that don't always answer JSON — GET
  // /preview returns image bytes (content-type image/*) for images and a
  // JSON body for text/binary/too-large. Callers inspect res.headers and
  // call res.blob() or res.json() themselves; request() can't be reused
  // because it unconditionally awaits res.json().
  async blob(path, params) {
    const url = new URL(this.base + path);
    if (params) Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
    const res = await fetch(url, { headers: apiHeaders() });
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
