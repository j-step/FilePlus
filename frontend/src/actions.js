/**
 * FilePlus actions dispatch map.
 *
 * Every data-action attribute in the HTML maps to a function here.
 * Functions call the matching backend endpoint on localhost:9876 and show
 * a "not implemented" toast when the endpoint is not yet built.
 *
 * Phase 4+ implementation target (wire data-action → backend call).
 * Phase 0: stub only — all actions log and show the toast.
 */

const API_BASE = 'http://localhost:9876';

/** Show a bottom-right toast notification. */
function showToast(message, variant = 'default') {
  // TODO: implement toast in Phase 4
  console.warn('[FilePlus toast]', variant, message);
}

/** Generic fetch wrapper with error handling. */
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    showToast(`API error: ${err.message}`, 'error');
    throw err;
  }
}

/** Dispatch table: data-action value → handler function. */
const ACTIONS = {
  // --- Navigation ---
  'nav-home':         () => notImplemented('nav-home'),
  'nav-browser':      () => notImplemented('nav-browser'),
  'nav-review-bin':   () => notImplemented('nav-review-bin'),
  'nav-scan':         () => notImplemented('nav-scan'),
  'nav-file-tree':    () => notImplemented('nav-file-tree'),
  'nav-settings':     () => notImplemented('nav-settings'),
  'nav-everything':   () => notImplemented('nav-everything'),

  // --- Toolbar ---
  'toolbar-back':     () => notImplemented('toolbar-back'),
  'toolbar-forward':  () => notImplemented('toolbar-forward'),
  'toolbar-up':       () => notImplemented('toolbar-up'),
  'toolbar-search':   () => notImplemented('toolbar-search'),
  'view-list':        () => notImplemented('view-list'),
  'view-grid':        () => notImplemented('view-grid'),
  'toggle-inspector': () => notImplemented('toggle-inspector'),
  'open-palette':     () => notImplemented('open-palette'),

  // --- Approvals ---
  'open-review-bin':  () => notImplemented('open-review-bin'),
  'approve-file':     (el) => notImplemented('approve-file', el),
  'override-file':    (el) => notImplemented('override-file', el),
  'defer-file':       (el) => notImplemented('defer-file', el),
  'batch-approve':    () => notImplemented('batch-approve'),

  // --- File operations ---
  'file-open':        (el) => notImplemented('file-open', el),
  'file-rename':      (el) => notImplemented('file-rename', el),
  'file-delete':      (el) => notImplemented('file-delete', el),
  'file-tag':         (el) => notImplemented('file-tag', el),
  'file-reclassify':  (el) => notImplemented('file-reclassify', el),

  // --- Scan ---
  'scan-start':       () => notImplemented('scan-start'),
  'scan-pause':       () => notImplemented('scan-pause'),
  'scan-stop':        () => notImplemented('scan-stop'),
  'scan-apply':       () => notImplemented('scan-apply'),

  // --- Undo ---
  'undo-last':        () => notImplemented('undo-last'),
  'undo-batch':       (el) => notImplemented('undo-batch', el),

  // --- Snapshots ---
  'snapshot-create':  () => notImplemented('snapshot-create'),
  'snapshot-restore': (el) => notImplemented('snapshot-restore', el),

  // --- Settings ---
  'settings-save':    () => notImplemented('settings-save'),
  'theme-toggle':     () => notImplemented('theme-toggle'),

  // --- Tray ---
  'tray-header':       () => notImplemented('tray-header'),
  'tray-tab-switch':   () => notImplemented('tray-tab-switch'),
  'tray-active-download': () => notImplemented('tray-active-download'),
  'tray-list':         () => notImplemented('tray-list'),
  'tray-move-queue':   () => notImplemented('tray-move-queue'),
  'tray-footer':       () => notImplemented('tray-footer'),
};

function notImplemented(action, el) {
  console.log(`[FilePlus] data-action="${action}" not yet implemented`, el ?? '');
  showToast(`"${action}" is not yet implemented.`, 'default');
}

/** Wire all data-action elements to their handlers on DOMContentLoaded. */
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const handler = ACTIONS[action];
    if (handler) {
      e.preventDefault();
      handler(el);
    } else {
      console.warn(`[FilePlus] No handler for data-action="${action}"`);
      showToast(`Unknown action: "${action}"`, 'default');
    }
  });
});
