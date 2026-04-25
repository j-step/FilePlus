/**
 * FilePlus actions dispatch.
 *
 * Every data-action value from index.html, tray/index.html, and setup/index.html
 * is mapped to a stub here. All stubs log the action and, for non-in-scope
 * actions, show a snackbar. In-scope actions are handled by app.js; those
 * entries here are no-ops to keep the dispatch table complete.
 *
 * Backend endpoint column format: GET/POST /api/path  (TBD = not yet defined)
 * Wire implementation in Phase 4+.
 */

// API_BASE is declared in app.js. Actions that call apiFetch() reference it
// directly — it is in scope by the time any action fires at runtime.

/**
 * showSnackbar / showToast are defined in app.js (A.11 real implementations).
 * These thin wrappers fall back to console when app.js hasn't loaded yet
 * (e.g. in the tray/setup windows that don't load app.js).
 */
function showSnackbar(msg, undoFn = null) {
  if (typeof window !== 'undefined' && window.__appShowSnackbar) {
    window.__appShowSnackbar(msg, undoFn ? 'Undo' : null, undoFn);
    return;
  }
  console.log('[snackbar]', msg);
}
function showToast(msg, variant = 'default') {
  if (typeof window !== 'undefined' && window.__appShowToast) {
    window.__appShowToast(msg, variant);
    return;
  }
  console.warn('[toast]', variant, msg);
}

/** Generic fetch wrapper. */
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

/** Stub: log + toast for not-yet-implemented backend actions. */
function stub(action, endpoint = 'TBD') {
  console.log(`[FilePlus] stub: ${action} → ${endpoint}`);
  showToast(`${action} — not yet implemented`, 'default');
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * ACTION MAP
 * Format: 'data-action-value': { endpoint: 'METHOD /api/...', fn: (el) => … }
 * ══════════════════════════════════════════════════════════════════════
 *
 * Actions already handled in app.js (in-scope, real implementations):
 *   navigate-screen, navigate-path, switch-tab, close-tab, new-tab,
 *   toggle-sidebar, toggle-inspector, toggle-theme, set-view-mode,
 *   focus-search, filter-by-tag, open-tag-canvas, close-tag-canvas,
 *   tag-canvas-select, nav-back, nav-forward, nav-up, navigate-crumb,
 *   open-review-bin, switch-home-tab, switch-inspector-tab,
 *   open-palette, close-palette, palette-set-mode,
 *   modal-cancel, modal-confirm, modal-confirm-type,
 *   ef-filter, ef-sort, ef-toggle-pause-ai, ef-toggle-moving-card,
 *   scan-config-switch-mode, settings-nav, settings-set-theme,
 *   settings-set-density, settings-set-accent, settings-set-font-scale,
 *   settings-reset-shortcuts
 *
 * All others below are stubs awaiting Phase 4+ backend implementation.
 */
const ACTIONS = {

  // ── Window controls ────────────────────────────────────────────────
  'window-minimize':  { endpoint: 'IPC windowMinimize', fn: () => window.electronAPI?.minimize?.() },
  'window-maximize':  { endpoint: 'IPC windowMaximize', fn: () => window.electronAPI?.maximize?.() },
  'window-close':     { endpoint: 'IPC windowClose',    fn: () => window.electronAPI?.close?.()    },

  // ── Navigation & tabs ──────────────────────────────────────────────
  'navigate-screen':   { endpoint: 'client-side only', fn: () => {} }, // handled in app.js
  'navigate-path':     { endpoint: 'GET /api/ls?path=', fn: () => {} },
  'navigate-crumb':    { endpoint: 'GET /api/ls?path=', fn: () => {} },
  'switch-tab':        { endpoint: 'client-side only', fn: () => {} },
  'close-tab':         { endpoint: 'client-side only', fn: () => {} },
  'new-tab':           { endpoint: 'client-side only', fn: () => {} },
  'nav-back':          { endpoint: 'client-side (history)', fn: () => {} },
  'nav-forward':       { endpoint: 'client-side (history)', fn: () => {} },
  'nav-up':            { endpoint: 'GET /api/ls?path=parent', fn: () => {} },
  'sort-by':           { endpoint: 'client-side sort', fn: (el) => stub('sort-by ' + el?.dataset?.col) },
  'set-view-mode':     { endpoint: 'client-side only', fn: () => {} },

  // ── Sidebar / toolbar ──────────────────────────────────────────────
  'toggle-sidebar':    { endpoint: 'client-side only', fn: () => {} },
  'toggle-inspector':  { endpoint: 'client-side only', fn: () => {} },
  'toggle-theme':      { endpoint: 'localStorage',     fn: () => {} },
  'focus-search':      { endpoint: 'client-side only', fn: () => {} },
  'filter-by-tag':     { endpoint: 'GET /api/files?tag=', fn: () => {} },
  'open-tag-canvas':   { endpoint: 'GET /api/tags/graph', fn: () => {} },
  'close-tag-canvas':  { endpoint: 'client-side only', fn: () => {} },
  'tag-canvas-select': { endpoint: 'GET /api/tags/:id/files', fn: () => {} },
  'open-review-bin':   { endpoint: 'client-side only', fn: () => {} },

  // ── File operations ───────────────────────────────────────────────
  'open-file':         { endpoint: 'IPC shell.openPath', fn: (el) => stub('open-file', `IPC openPath(${el?.dataset?.path})`) },
  'open-file-with':    { endpoint: 'IPC shell.showOpenWith', fn: (el) => stub('open-file-with') },
  'open-recent-file':  { endpoint: 'GET /api/recent/:id', fn: (el) => stub('open-recent-file') },
  'reveal-file':       { endpoint: 'IPC shell.showItemInFolder', fn: (el) => stub('reveal-file') },
  'reveal-in-explorer':{ endpoint: 'IPC shell.showItemInFolder', fn: (el) => stub('reveal-in-explorer') },
  'copy-path':         { endpoint: 'client clipboard', fn: (el) => { navigator.clipboard?.writeText(el?.closest('[data-path]')?.dataset?.path || ''); showSnackbar('Path copied'); } },
  'add-tag':           { endpoint: 'POST /api/files/:id/tags', fn: (el) => stub('add-tag', 'POST /api/files/:id/tags') },
  'unfavorite-file':   { endpoint: 'DELETE /api/favorites/:id', fn: (el) => stub('unfavorite-file') },
  'view-all-recent':   { endpoint: 'navigate to home screen', fn: () => stub('view-all-recent') },
  'select-file':       { endpoint: 'client-side selection', fn: (el) => stub('select-file') },
  'inspector-more':    { endpoint: 'GET /api/files/:id/meta', fn: (el) => stub('inspector-more') },

  // ── Context menu actions ──────────────────────────────────────────
  'cm-open':           { endpoint: 'IPC shell.openPath', fn: (el) => stub('cm-open') },
  'cm-open-with':      { endpoint: 'IPC shell.showOpenWith', fn: (el) => stub('cm-open-with') },
  'cm-open-new-tab':   { endpoint: 'client-side tab', fn: (el) => stub('cm-open-new-tab') },
  'cm-reveal-browser': { endpoint: 'client navigate', fn: (el) => stub('cm-reveal-browser') },
  'cm-cut':            { endpoint: 'client clipboard (pending move)', fn: (el) => stub('cm-cut') },
  'cm-copy':           { endpoint: 'client clipboard', fn: (el) => stub('cm-copy') },
  'cm-paste':          { endpoint: 'POST /api/fs/copy', fn: (el) => stub('cm-paste', 'POST /api/fs/copy') },
  'cm-rename':         { endpoint: 'POST /api/fs/rename', fn: (el) => stub('cm-rename', 'POST /api/fs/rename') },
  'cm-delete':         { endpoint: 'POST /api/fs/trash', fn: (el) => stub('cm-delete', 'POST /api/fs/trash') },
  'cm-add-tag':        { endpoint: 'POST /api/files/:id/tags', fn: (el) => stub('cm-add-tag') },
  'cm-reclassify':     { endpoint: 'POST /api/files/:id/classify', fn: (el) => stub('cm-reclassify') },
  'cm-favorite':       { endpoint: 'POST /api/favorites', fn: (el) => stub('cm-favorite') },
  'cm-compress':       { endpoint: 'POST /api/fs/compress', fn: (el) => stub('cm-compress') },
  'cm-properties':     { endpoint: 'GET /api/files/:id/meta', fn: (el) => stub('cm-properties') },
  'cm-reveal-explorer':{ endpoint: 'IPC shell.showItemInFolder', fn: (el) => stub('cm-reveal-explorer') },
  'cm-new-file':       { endpoint: 'POST /api/fs/touch', fn: (el) => stub('cm-new-file') },
  'cm-new-folder':     { endpoint: 'POST /api/fs/mkdir', fn: (el) => stub('cm-new-folder') },
  'cm-paste-here':     { endpoint: 'POST /api/fs/copy', fn: (el) => stub('cm-paste-here') },
  'cm-scan-folder':    { endpoint: 'POST /api/scan/start?path=', fn: (el) => stub('cm-scan-folder') },
  'cm-rename-tab':     { endpoint: 'client-side only', fn: (el) => stub('cm-rename-tab') },
  'cm-move-tab':       { endpoint: 'client-side only', fn: (el) => stub('cm-move-tab') },
  'cm-close-tab':      { endpoint: 'client-side only', fn: (el) => stub('cm-close-tab') },
  'cm-pin-sidebar':    { endpoint: 'client-side only', fn: (el) => stub('cm-pin-sidebar') },
  'cm-unpin-sidebar':  { endpoint: 'client-side only', fn: (el) => stub('cm-unpin-sidebar') },
  'cm-rename-sidebar': { endpoint: 'client-side only', fn: (el) => stub('cm-rename-sidebar') },

  // ── Palette ───────────────────────────────────────────────────────
  'open-palette':      { endpoint: 'client-side only', fn: () => {} },
  'close-palette':     { endpoint: 'client-side only', fn: () => {} },
  'palette-set-mode':  { endpoint: 'client-side only', fn: () => {} },
  'palette-open-file': { endpoint: 'GET /api/files/:id', fn: (el) => stub('palette-open-file') },
  'palette-open-folder':{ endpoint: 'GET /api/ls?path=', fn: (el) => stub('palette-open-folder') },
  'palette-filter-tag':{ endpoint: 'GET /api/files?tag=', fn: (el) => stub('palette-filter-tag') },
  'palette-plan-approve-all': { endpoint: 'POST /api/review-bin/approve-all', fn: (el) => stub('palette-plan-approve-all') },
  'palette-plan-preview':     { endpoint: 'client-side only', fn: (el) => stub('palette-plan-preview') },
  'palette-plan-review-bin':  { endpoint: 'navigate review-bin', fn: (el) => stub('palette-plan-review-bin') },

  // ── Modals ────────────────────────────────────────────────────────
  'modal-cancel':       { endpoint: 'client-side only', fn: () => {} },
  'modal-confirm':      { endpoint: 'client-side only', fn: () => {} },
  'modal-confirm-type': { endpoint: 'client-side only', fn: () => {} },
  'dismiss-error':      { endpoint: 'client-side only', fn: (el) => { el?.closest('.fp-error-banner')?.remove(); } },
  'conflict-cancel':    { endpoint: 'client-side only', fn: (el) => stub('conflict-cancel') },
  'conflict-replace':   { endpoint: 'POST /api/fs/copy?replace=true', fn: (el) => stub('conflict-replace') },
  'conflict-skip':      { endpoint: 'client-side only', fn: (el) => stub('conflict-skip') },
  'conflict-keep-both': { endpoint: 'POST /api/fs/copy?rename=true', fn: (el) => stub('conflict-keep-both') },
  'crash-dismiss':      { endpoint: 'DELETE /api/crash-recovery', fn: (el) => stub('crash-dismiss') },
  'crash-view-log':     { endpoint: 'GET /api/operations-log', fn: (el) => stub('crash-view-log') },

  // ── Scan config ──────────────────────────────────────────────────
  'scan-config-switch-mode':    { endpoint: 'client-side only', fn: () => {} },
  'scan-config-use-defaults':   { endpoint: 'POST /api/scan/config/defaults', fn: (el) => stub('scan-config-use-defaults') },
  'scan-baseline-confirm':      { endpoint: 'POST /api/snapshots/create', fn: (el) => stub('scan-baseline-confirm') },
  'scan-chat-input':            { endpoint: 'client-side only', fn: () => {} },
  'scan-chat-done':             { endpoint: 'client-side only', fn: (el) => stub('scan-chat-done') },
  'scan-form-toggle-drive':     { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-toggle-drive') },
  'scan-form-toggle-ext':       { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-toggle-ext') },
  'scan-form-set-aggressiveness':{ endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-set-aggressiveness') },
  'scan-form-set-complexity':   { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-set-complexity') },
  'scan-form-add-priority':     { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-add-priority') },
  'scan-form-add-exclusion':    { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-add-exclusion') },
  'scan-form-add-never-touch':  { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-add-never-touch') },
  'scan-form-add-path':         { endpoint: 'IPC openDirectoryPicker', fn: (el) => stub('scan-form-add-path') },
  'scan-form-remove-path':      { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-form-remove-path') },
  'scan-toggle-ext':            { endpoint: 'POST /api/scan/config', fn: (el) => stub('scan-toggle-ext') },

  // ── Scan progress ────────────────────────────────────────────────
  'scan-pause':         { endpoint: 'POST /api/scan/pause', fn: (el) => stub('scan-pause', 'POST /api/scan/pause') },
  'scan-minimize-tray': { endpoint: 'IPC minimizeToTray', fn: (el) => window.electronAPI?.minimizeToTray?.() },
  'scan-stop-confirm':  { endpoint: 'POST /api/scan/stop', fn: (el) => stub('scan-stop-confirm', 'POST /api/scan/stop') },
  'restart-scan':       { endpoint: 'POST /api/scan/start', fn: (el) => stub('restart-scan') },
  'restart-watcher':    { endpoint: 'POST /api/watcher/restart', fn: (el) => stub('restart-watcher') },
  'retry-backend-connect': { endpoint: 'GET /api/health', fn: (el) => stub('retry-backend-connect') },
  'retry-review-bin':   { endpoint: 'GET /api/review-bin', fn: (el) => stub('retry-review-bin') },

  // ── Scan results ─────────────────────────────────────────────────
  'switch-scan-results-tab':  { endpoint: 'client-side only', fn: () => {} },
  'scan-dupes-select-all':    { endpoint: 'client-side only', fn: (el) => stub('scan-dupes-select-all') },
  'scan-toggle-dupe-group':   { endpoint: 'client-side only', fn: (el) => stub('scan-toggle-dupe-group') },
  'scan-dupe-keep':           { endpoint: 'client-side only', fn: (el) => stub('scan-dupe-keep') },
  'scan-dupes-hardlink':      { endpoint: 'POST /api/dedup/hardlink', fn: (el) => stub('scan-dupes-hardlink') },
  'scan-dedup-confirm':       { endpoint: 'POST /api/dedup/execute', fn: (el) => stub('scan-dedup-confirm', 'POST /api/dedup/execute') },
  'scan-toggle-cleanup-cat':  { endpoint: 'client-side only', fn: (el) => stub('scan-toggle-cleanup-cat') },
  'scan-cleanup-toggle-file': { endpoint: 'client-side only', fn: (el) => stub('scan-cleanup-toggle-file') },
  'scan-cleanup-select-all':  { endpoint: 'client-side only', fn: (el) => stub('scan-cleanup-select-all') },
  'scan-cleanup-reject-all':  { endpoint: 'client-side only', fn: (el) => stub('scan-cleanup-reject-all') },
  'scan-cleanup-age-threshold':{ endpoint: 'client-side filter', fn: (el) => stub('scan-cleanup-age-threshold') },
  'scan-cleanup-confirm':     { endpoint: 'POST /api/cleanup/execute', fn: (el) => stub('scan-cleanup-confirm', 'POST /api/cleanup/execute') },
  'scan-open-reorg-canvas':   { endpoint: 'navigate file-tree-canvas', fn: (el) => stub('scan-open-reorg-canvas') },

  // ── Review Bin ────────────────────────────────────────────────────
  'rb-select-file':    { endpoint: 'GET /api/review-bin/:id', fn: (el) => stub('rb-select-file') },
  'rb-group-review':   { endpoint: 'client-side expand', fn: (el) => stub('rb-group-review') },
  'rb-group-approve-all':{ endpoint: 'POST /api/review-bin/group/:id/approve', fn: (el) => stub('rb-group-approve-all') },
  'rb-group-reject-all': { endpoint: 'POST /api/review-bin/group/:id/reject', fn: (el) => stub('rb-group-reject-all') },
  'rb-row-overflow':   { endpoint: 'client context menu', fn: (el) => stub('rb-row-overflow') },
  'rb-reject':         { endpoint: 'POST /api/review-bin/:id/reject', fn: (el) => stub('rb-reject') },
  'rb-modify-path':    { endpoint: 'PATCH /api/review-bin/:id', fn: (el) => stub('rb-modify-path') },
  'rb-snooze':         { endpoint: 'POST /api/review-bin/:id/snooze?days=7', fn: (el) => stub('rb-snooze') },
  'rb-approve':        { endpoint: 'POST /api/review-bin/:id/approve', fn: (el) => stub('rb-approve', 'POST /api/review-bin/:id/approve') },

  // ── Everything Folder ─────────────────────────────────────────────
  'ef-filter':         { endpoint: 'client-side filter', fn: () => {} },
  'ef-sort':           { endpoint: 'client-side sort', fn: () => {} },
  'ef-toggle-pause-ai':{ endpoint: 'POST /api/ai/pause', fn: () => {} },
  'ef-toggle-moving-card':{ endpoint: 'client-side only', fn: () => {} },
  'ef-select-file':    { endpoint: 'GET /api/ef/:id', fn: (el) => stub('ef-select-file') },

  // ── File Tree Canvas ──────────────────────────────────────────────
  'ftree-toggle-left-rail':  { endpoint: 'client-side only', fn: (el) => stub('ftree-toggle-left-rail') },
  'ftree-new-snapshot':      { endpoint: 'POST /api/snapshots/create', fn: (el) => stub('ftree-new-snapshot') },
  'ftree-view-snapshot':     { endpoint: 'GET /api/snapshots/:id/tree', fn: (el) => stub('ftree-view-snapshot') },
  'ftree-return-live':       { endpoint: 'GET /api/tree/live', fn: (el) => stub('ftree-return-live') },
  'ftree-toggle-changes':    { endpoint: 'client-side diff overlay', fn: (el) => stub('ftree-toggle-changes') },
  'ftree-jump':              { endpoint: 'GET /api/tree/node/:id', fn: (el) => stub('ftree-jump') },
  'ftree-expand-node':       { endpoint: 'GET /api/tree/node/:id/children', fn: (el) => stub('ftree-expand-node') },
  'ftree-select-node':       { endpoint: 'client-side only', fn: () => {} },
  'ftree-zoom-in':           { endpoint: 'client-side only', fn: (el) => stub('ftree-zoom-in') },
  'ftree-zoom-out':          { endpoint: 'client-side only', fn: (el) => stub('ftree-zoom-out') },
  'ftree-fit-view':          { endpoint: 'client-side only', fn: (el) => stub('ftree-fit-view') },
  'ftree-fullscreen':        { endpoint: 'client-side only', fn: (el) => stub('ftree-fullscreen') },
  'ftree-expand-all':        { endpoint: 'GET /api/tree/full', fn: (el) => stub('ftree-expand-all') },
  'ftree-collapse-depth3':   { endpoint: 'client-side only', fn: (el) => stub('ftree-collapse-depth3') },
  'ftree-toggle-hidden':     { endpoint: 'client-side only', fn: (el) => stub('ftree-toggle-hidden') },
  'ftree-add-folder':        { endpoint: 'POST /api/fs/mkdir', fn: (el) => stub('ftree-add-folder') },
  'ftree-delete-selected':   { endpoint: 'POST /api/fs/trash', fn: (el) => stub('ftree-delete-selected') },
  'ftree-execute-proposal':  { endpoint: 'POST /api/proposals/execute', fn: (el) => stub('ftree-execute-proposal') },

  // ── Settings ──────────────────────────────────────────────────────
  'settings-nav':                 { endpoint: 'client-side only', fn: () => {} },
  'settings-set-theme':           { endpoint: 'localStorage', fn: () => {} },
  'settings-set-density':         { endpoint: 'localStorage', fn: () => {} },
  'settings-set-accent':          { endpoint: 'localStorage', fn: () => {} },
  'settings-set-font-scale':      { endpoint: 'localStorage', fn: () => {} },
  'settings-reset-shortcuts':     { endpoint: 'TBD', fn: (el) => stub('settings-reset-shortcuts') },
  'settings-theme':               { endpoint: 'localStorage', fn: () => {} },
  'settings-accent':              { endpoint: 'localStorage', fn: () => {} },
  'settings-toggle':              { endpoint: 'POST /api/config', fn: (el) => stub('settings-toggle', 'POST /api/config/' + el?.dataset?.key) },
  'settings-add-drive':           { endpoint: 'POST /api/config/drives', fn: (el) => stub('settings-add-drive') },
  'settings-remove-drive':        { endpoint: 'DELETE /api/config/drives/:id', fn: (el) => stub('settings-remove-drive') },
  'settings-browse-ef-path':      { endpoint: 'IPC dialog.showOpenDialog', fn: (el) => stub('settings-browse-ef-path') },
  'settings-set-ef-path':         { endpoint: 'POST /api/config/ef-path', fn: (el) => stub('settings-set-ef-path') },
  'settings-ef-confidence':       { endpoint: 'POST /api/config', fn: (el) => stub('settings-ef-confidence') },
  'settings-ef-review-timeout':   { endpoint: 'POST /api/config', fn: (el) => stub('settings-ef-review-timeout') },
  'settings-ef-stuck':            { endpoint: 'POST /api/config', fn: (el) => stub('settings-ef-stuck') },
  'settings-set-ef-notify':       { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-ef-notify') },
  'settings-browse-dl-path':      { endpoint: 'IPC dialog.showOpenDialog', fn: (el) => stub('settings-browse-dl-path') },
  'settings-set-dl-path':         { endpoint: 'POST /api/config/dl-path', fn: (el) => stub('settings-set-dl-path') },
  'settings-add-ef-exclusion':    { endpoint: 'POST /api/config/exclusions', fn: (el) => stub('settings-add-ef-exclusion') },
  'settings-add-dl-exclusion':    { endpoint: 'POST /api/config/exclusions', fn: (el) => stub('settings-add-dl-exclusion') },
  'settings-review-threshold':    { endpoint: 'POST /api/config', fn: (el) => stub('settings-review-threshold') },
  'settings-set-autonomy':        { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-autonomy') },
  'settings-set-purge-action':    { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-purge-action') },
  'settings-set-purge-after':     { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-purge-after') },
  'settings-reset-organization':  { endpoint: 'POST /api/config/reset-organization', fn: (el) => stub('settings-reset-organization') },
  'settings-set-ollama-model':    { endpoint: 'POST /api/config/ollama-model', fn: (el) => stub('settings-set-ollama-model') },
  'settings-set-api-key':         { endpoint: 'POST /api/config/api-key', fn: (el) => stub('settings-set-api-key') },
  'settings-toggle-api-key-visibility': { endpoint: 'client-side only', fn: (el) => stub('settings-toggle-api-key-visibility') },
  'settings-set-claude-model':    { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-claude-model') },
  'settings-set-cost-cap':        { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-cost-cap') },
  'settings-temperature':         { endpoint: 'POST /api/config', fn: (el) => stub('settings-temperature') },
  'settings-set-token-cap':       { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-token-cap') },
  'settings-batch-size':          { endpoint: 'POST /api/config', fn: (el) => stub('settings-batch-size') },
  'settings-ai-test-classification': { endpoint: 'POST /api/ai/test', fn: (el) => stub('settings-ai-test-classification') },
  'settings-ai-reset-stats':      { endpoint: 'POST /api/ai/stats/reset', fn: (el) => stub('settings-ai-reset-stats') },
  'ai-test-classification':       { endpoint: 'POST /api/ai/test', fn: (el) => stub('ai-test-classification') },
  'ai-reset-stats':               { endpoint: 'POST /api/ai/stats/reset', fn: (el) => stub('ai-reset-stats') },
  'settings-add-filetype':        { endpoint: 'POST /api/config/filetypes', fn: (el) => stub('settings-add-filetype') },
  'settings-edit-filetype':       { endpoint: 'PATCH /api/config/filetypes/:id', fn: (el) => stub('settings-edit-filetype') },
  'settings-delete-filetype':     { endpoint: 'DELETE /api/config/filetypes/:id', fn: (el) => stub('settings-delete-filetype') },
  'settings-add-ignore-pattern':  { endpoint: 'POST /api/config/ignore-patterns', fn: (el) => stub('settings-add-ignore-pattern') },
  'settings-set-encryption':      { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-encryption') },
  'settings-snap-warn':           { endpoint: 'POST /api/config', fn: (el) => stub('settings-snap-warn') },
  'settings-snap-daily-count':    { endpoint: 'POST /api/config', fn: (el) => stub('settings-snap-daily-count') },
  'settings-snap-weekly-count':   { endpoint: 'POST /api/config', fn: (el) => stub('settings-snap-weekly-count') },
  'settings-snap-monthly-count':  { endpoint: 'POST /api/config', fn: (el) => stub('settings-snap-monthly-count') },
  'settings-cleanup-snapshots':   { endpoint: 'POST /api/snapshots/cleanup', fn: (el) => stub('settings-cleanup-snapshots') },
  'settings-rebind':              { endpoint: 'POST /api/config/shortcuts', fn: (el) => stub('settings-rebind') },
  'settings-reset-defaults':      { endpoint: 'POST /api/config/reset', fn: (el) => stub('settings-reset-defaults') },
  'settings-export-db':           { endpoint: 'GET /api/db/export', fn: (el) => stub('settings-export-db') },
  'settings-import-db':           { endpoint: 'POST /api/db/import', fn: (el) => stub('settings-import-db') },
  'settings-export-diagnostics':  { endpoint: 'GET /api/diagnostics/export', fn: (el) => stub('settings-export-diagnostics') },
  'settings-clear-ai-tags':       { endpoint: 'DELETE /api/tags/ai-generated', fn: (el) => stub('settings-clear-ai-tags') },
  'settings-set-scan-schedule':   { endpoint: 'POST /api/config', fn: (el) => stub('settings-set-scan-schedule') },
  'settings-set-click-mode':      { endpoint: 'localStorage', fn: (el) => stub('settings-set-click-mode') },
  'settings-set-tab-style':       { endpoint: 'localStorage', fn: (el) => stub('settings-set-tab-style') },
  'settings-inspector-width':     { endpoint: 'localStorage', fn: (el) => stub('settings-inspector-width') },
  'settings-open-licenses':       { endpoint: 'IPC shell.openExternal', fn: (el) => stub('settings-open-licenses') },
  'open-install-guide':           { endpoint: 'IPC shell.openExternal', fn: (el) => stub('open-install-guide') },

  // ── Tray ──────────────────────────────────────────────────────────
  'tray-switch-tab':     { endpoint: 'client-side only', fn: () => {} },
  'tray-select-row':     { endpoint: 'client-side only', fn: () => {} },
  'tray-open-main':      { endpoint: 'IPC openMain', fn: () => window.electronAPI?.openMain?.() },
  'tray-open-review-bin':{ endpoint: 'IPC openMain + navigate', fn: () => { window.electronAPI?.openMain?.(); } },
  'tray-open-everything':{ endpoint: 'IPC openMain + navigate', fn: () => { window.electronAPI?.openMain?.(); } },
  'tray-toggle-pause-ai':{ endpoint: 'POST /api/ai/pause', fn: (el) => stub('tray-toggle-pause-ai') },
  'tray-expand':         { endpoint: 'IPC expandTray', fn: () => window.electronAPI?.expandTray?.() },
  'tray-close':          { endpoint: 'IPC hideTray', fn: () => window.electronAPI?.hideTray?.() },
  'tray-cancel-download':{ endpoint: 'POST /api/downloads/:id/cancel', fn: (el) => stub('tray-cancel-download') },
  'tray-drag':           { endpoint: 'native drag', fn: () => {} },
  'tray-open-file':      { endpoint: 'IPC shell.openPath', fn: (el) => stub('tray-open-file') },
  'tray-reveal-in-app':  { endpoint: 'IPC openMain + navigate', fn: (el) => stub('tray-reveal-in-app') },
  'tray-copy-path':      { endpoint: 'client clipboard', fn: (el) => { navigator.clipboard?.writeText(el?.closest('[data-path]')?.dataset?.path || ''); } },
  'tray-toggle-moving':  { endpoint: 'client-side only', fn: (el) => stub('tray-toggle-moving') },
  'tray-open-settings':  { endpoint: 'IPC openMain + navigate settings', fn: (el) => stub('tray-open-settings') },
  'tray-search':         { endpoint: 'IPC openMain + open palette', fn: (el) => stub('tray-search') },
  'tray-add-favorite':   { endpoint: 'POST /api/favorites', fn: (el) => stub('tray-add-favorite') },
  'tray-remove-from-list':{ endpoint: 'DELETE /api/recent/:id', fn: (el) => stub('tray-remove-from-list') },
  'tray-reveal-in-explorer':{ endpoint: 'IPC shell.showItemInFolder', fn: (el) => stub('tray-reveal-in-explorer') },

  // ── Setup wizard ─────────────────────────────────────────────────
  'setup-next':          { endpoint: 'client-side only', fn: () => {} },
  'setup-prev':          { endpoint: 'client-side only', fn: () => {} },
  'setup-check-ollama':  { endpoint: 'GET /api/ai/status', fn: (el) => stub('setup-check-ollama') },
  'setup-skip-ollama':   { endpoint: 'POST /api/config/ollama-skip', fn: (el) => stub('setup-skip-ollama') },
  'setup-toggle-key-vis':{ endpoint: 'client-side only', fn: () => {} },
  'setup-set-model':     { endpoint: 'POST /api/config', fn: (el) => stub('setup-set-model') },
  'setup-set-cost-cap':  { endpoint: 'POST /api/config', fn: (el) => stub('setup-set-cost-cap') },
  'setup-toggle-offline':{ endpoint: 'POST /api/config', fn: (el) => stub('setup-toggle-offline') },
  'setup-skip-claude':   { endpoint: 'client-side only', fn: () => {} },
  'setup-browse-everything':{ endpoint: 'IPC dialog.showOpenDialog', fn: (el) => stub('setup-browse-everything') },
  'setup-set-everything-path':{ endpoint: 'POST /api/config/ef-path', fn: (el) => stub('setup-set-everything-path') },
  'setup-toggle-drive':  { endpoint: 'POST /api/config/drives', fn: (el) => stub('setup-toggle-drive') },
  'setup-set-dl-mode':   { endpoint: 'POST /api/config', fn: (el) => stub('setup-set-dl-mode') },
  'setup-set-confidence':{ endpoint: 'POST /api/config', fn: (el) => stub('setup-set-confidence') },
  'setup-set-scan-schedule':{ endpoint: 'POST /api/config', fn: (el) => stub('setup-set-scan-schedule') },
  'setup-toggle-tray':   { endpoint: 'POST /api/config', fn: (el) => stub('setup-toggle-tray') },
  'setup-toggle-component':{ endpoint: 'POST /api/setup/components', fn: (el) => stub('setup-toggle-component') },
  'setup-chat-type':     { endpoint: 'client-side only', fn: () => {} },
  'setup-chat-chip':     { endpoint: 'client-side only', fn: () => {} },
  'setup-chat-send':     { endpoint: 'POST /api/scan/chat', fn: (el) => stub('setup-chat-send') },
  'setup-chat-skip':     { endpoint: 'POST /api/scan/config/defaults', fn: (el) => stub('setup-chat-skip') },
  'setup-chat-done':     { endpoint: 'POST /api/scan/config/apply', fn: (el) => stub('setup-chat-done') },
  'setup-start-scan':    { endpoint: 'POST /api/scan/start', fn: () => stub('setup-start-scan', 'POST /api/scan/start') },
  'setup-open-app':      { endpoint: 'IPC openMain + closeSetup', fn: () => { window.electronAPI?.openMain?.(); window.electronAPI?.closeSetup?.(); } },

  // ── Home screen actions ───────────────────────────────────────────
  'switch-home-tab':     { endpoint: 'client-side only', fn: () => {} },
  'switch-inspector-tab':{ endpoint: 'client-side only', fn: () => {} },
};

/** Expose globally so app.js can also call showSnackbar / showToast. */
window.showSnackbar = showSnackbar;
window.showToast    = showToast;
