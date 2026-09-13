/**
 * FilePlus preload script — runs in the renderer context with Node access.
 *
 * Exposes a minimal, controlled API surface to the renderer via contextBridge.
 * Never expose full Node/Electron APIs — only what the renderer actually needs.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  minimize:    () => ipcRenderer.send('win-minimize'),
  maximize:    () => ipcRenderer.send('win-maximize'),
  close:       () => ipcRenderer.send('win-close'),
  openMain:    () => ipcRenderer.send('open-main'),
  hideTray:    () => ipcRenderer.send('hide-tray'),
  closeSetup:  () => ipcRenderer.send('close-setup'),
  // Zoom — uses webContents.setZoomFactor so the entire viewport scales correctly
  zoomIn:      () => ipcRenderer.send('win-zoom-in'),
  zoomOut:     () => ipcRenderer.send('win-zoom-out'),
  zoomReset:   () => ipcRenderer.send('win-zoom-reset'),
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
  openWith:          (p) => ipcRenderer.send('shell-open-with', p),
  pickFolder:        (defaultPath) => ipcRenderer.invoke('dialog-pick-folder', defaultPath),
  clipboardWriteText: (text) => ipcRenderer.send('clipboard-write-text', text),
  // Icons / thumbnails / native dialogs (Stage 2C Task 4; Tasks 6 and 13 wire renderer callers)
  fileIcon:          (path, ext, size) => ipcRenderer.invoke('get-file-icon', path, ext, size),
  thumbnail:         (path, size, mtime) => ipcRenderer.invoke('get-thumbnail', path, size, mtime),
  showProperties:    (path) => ipcRenderer.invoke('show-properties', path),
  openWithDialog:    (path) => ipcRenderer.invoke('open-with-dialog', path),
});
