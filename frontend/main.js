/**
 * FilePlus Electron main process.
 *
 * Creates the application window, configures security settings,
 * and wires up the dev-tools shortcut.
 */
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const os   = require('os');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#181522',
    title: 'FilePlus',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const ZOOM_STEPS   = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.33, 1.5, 1.75, 2.0];

app.whenReady().then(() => {
  ipcMain.on('win-minimize', () => mainWindow?.minimize());
  ipcMain.on('win-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('win-close', () => mainWindow?.close());

  // Zoom via Electron native webContents — avoids the layout-cut-off problem of CSS zoom
  ipcMain.on('win-zoom-in', () => {
    if (!mainWindow) return;
    const cur = mainWindow.webContents.getZoomFactor();
    const next = ZOOM_STEPS.find(s => s > cur + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    mainWindow.webContents.setZoomFactor(next);
  });
  ipcMain.on('win-zoom-out', () => {
    if (!mainWindow) return;
    const cur = mainWindow.webContents.getZoomFactor();
    const prev = [...ZOOM_STEPS].reverse().find(s => s < cur - 0.001) ?? ZOOM_STEPS[0];
    mainWindow.webContents.setZoomFactor(prev);
  });
  ipcMain.on('win-zoom-reset', () => {
    mainWindow?.webContents.setZoomFactor(1.0);
  });
  ipcMain.on('win-zoom-get', (event) => {
    event.returnValue = mainWindow ? mainWindow.webContents.getZoomFactor() : 1.0;
  });

  ipcMain.on('get-hostname', (event) => {
    event.returnValue = os.hostname();
  });

  createWindow();

  // F12 toggles DevTools
  globalShortcut.register('F12', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
