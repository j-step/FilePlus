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
  // Theme — syncs Electron's nativeTheme.themeSource so window chrome (e.g. Mica tint) agrees
  setThemeSource: (mode) => ipcRenderer.send('set-theme-source', mode),
});
