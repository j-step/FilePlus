/**
 * FilePlus preload script — runs in the renderer context with Node access.
 *
 * Exposes a minimal, controlled API surface to the renderer via contextBridge.
 * Never expose full Node/Electron APIs — only what the renderer actually needs.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
});
