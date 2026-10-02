/**
 * FilePlus preload script — runs in the renderer context with Node access.
 *
 * Exposes a minimal, controlled API surface to the renderer via contextBridge.
 * Never expose full Node/Electron APIs — only what the renderer actually needs.
 */
const { contextBridge, ipcRenderer } = require('electron');

// ── Eased app zoom (Stage 2D §5) ───────────────────────────────────────────
// A zoom step interpolates the page zoom from where it is to `target` over
// ZOOM_EASE_MS (ease-out; 4 frames at 60 Hz), one factor per animation
// frame, then settles on the exact target. Every factor goes through the
// main process's webContents.setZoomFactor (win-zoom-to), not
// webFrame.setZoomFactor: webFrame's zoom is a Chromium *temporary* zoom
// level, which Electron never persists — after one webFrame step the zoom
// stopped surviving a restart, and the main-process route keeps it (measured
// frame times were the same either way). A newer zoomTo supersedes a running
// one and starts from wherever the page zoom is at that moment.
// Resolves { factor, frames, superseded }: `frames` are the rAF-to-rAF
// durations (ms) while the ease ran, which the renderer uses to drop the
// ease on a machine that cannot keep up (spec §5's 32 ms ruling).
const ZOOM_EASE_MS = 70;
const ZOOM_EASE_FIRST_STEP_MS = 1000 / 60;
let zoomRun = 0;
function zoomTo(target, ease) {
  const run = ++zoomRun;
  const to = Number(target);
  const settle = () => ipcRenderer.invoke('win-zoom-to', to);
  const from = ipcRenderer.sendSync('win-zoom-get');
  if (!ease || !(Math.abs(to - from) > 0.0005)) {
    return settle().then((factor) => ({ factor, frames: [], superseded: run !== zoomRun }));
  }
  return new Promise((resolve) => {
    const frames = [];
    let start = null;
    let prev = null;
    let done = false;
    const tick = (ts) => {
      if (run !== zoomRun) { resolve({ factor: null, frames, superseded: true }); return; }
      if (prev !== null) frames.push(Math.round((ts - prev) * 10) / 10);
      prev = ts;
      if (done) {
        // The frame after the last step: its layout and paint are measured too.
        settle().then((factor) => resolve({ factor, frames, superseded: run !== zoomRun }),
          () => resolve({ factor: null, frames, superseded: true }));
        return;
      }
      // Progress counts from one 60 Hz frame before the first animation
      // frame: the first frame already moves, and a slow first frame (the
      // page's first zoom of the session can take one) never eats the ease.
      if (start === null) start = ts - ZOOM_EASE_FIRST_STEP_MS;
      const p = Math.min(1, (ts - start) / ZOOM_EASE_MS);
      const e = 1 - (1 - p) * (1 - p) * (1 - p);
      ipcRenderer.invoke('win-zoom-to', p >= 1 ? to : from + (to - from) * e).catch(() => {});
      done = p >= 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize:    () => ipcRenderer.send('win-minimize'),
  maximize:    () => ipcRenderer.send('win-maximize'),
  close:       () => ipcRenderer.send('win-close'),
  openMain:    () => ipcRenderer.send('open-main'),
  hideTray:    () => ipcRenderer.send('hide-tray'),
  closeSetup:  () => ipcRenderer.send('close-setup'),
  // App zoom (Stage 2D §5): the step list lives in main.js; zoomTo eases
  // to a factor (see above) and resolves once the main process has it.
  zoomSteps:   () => ipcRenderer.sendSync('win-zoom-steps'),
  zoomTo:      (factor, ease) => zoomTo(factor, !!ease),
  getZoom:     () => ipcRenderer.sendSync('win-zoom-get'),
  // Host info
  hostname:    () => ipcRenderer.sendSync('get-hostname'),
  homeDir:     () => ipcRenderer.sendSync('get-home-dir'),
  micaAvailable: () => ipcRenderer.sendSync('mica-available'),
  // API auth token (empty string when FILEPLUS_API_TOKEN is unset)
  apiToken:    () => ipcRenderer.sendSync('get-api-token'),
  // Backend port (9876 unless FILEPLUS_PORT overrides it)
  apiPort:     () => ipcRenderer.sendSync('get-api-port'),
  // Theme — syncs Electron's nativeTheme.themeSource so window chrome (e.g. Mica tint) agrees
  setThemeSource: (mode) => ipcRenderer.send('set-theme-source', mode),
  // Shell / dialog / clipboard bridge (Plan 2B wires renderer callers)
  openPath:          (p) => ipcRenderer.invoke('shell-open-path', p),
  showItemInFolder:  (p) => ipcRenderer.send('shell-show-item', p),
  pickFolder:        (defaultPath) => ipcRenderer.invoke('dialog-pick-folder', defaultPath),
  clipboardWriteText: (text) => ipcRenderer.send('clipboard-write-text', text),
  // Icons / thumbnails / native dialogs (Stage 2C Task 4; Tasks 6 and 13 wire
  // renderer callers; pass 2 — icon-design.md §4.3 — switches sizing from a
  // coarse enum to physical pixels). px = device pixels (the CSS box size x
  // devicePixelRatio), computed by icons.js. fileIcon(s) -> {url, px, exact}
  // | null; fileIcons takes [{path, ext, px}] (<= 64) and answers in the same
  // order. thumbnail -> {url, w, h} | null (w or h == px, the longer edge).
  fileIcon:          (path, ext, px) => ipcRenderer.invoke('get-file-icon', path, ext, px),
  fileIcons:         (reqs) => ipcRenderer.invoke('get-file-icons', reqs),
  thumbnail:         (path, px, mtime) => ipcRenderer.invoke('get-thumbnail', path, px, mtime),
  showProperties:    (path) => ipcRenderer.invoke('show-properties', path),
  openWithDialog:    (path) => ipcRenderer.invoke('open-with-dialog', path),
});
