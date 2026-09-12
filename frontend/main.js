/**
 * FilePlus Electron main process.
 *
 * Creates the application window, configures security settings,
 * and wires up the dev-tools shortcut.
 */
const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, shell, dialog, clipboard } = require('electron');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { readEnvFileToken } = require('./envToken');

let mainWindow;

// ── API token ────────────────────────────────────────────────────────────
// FILEPLUS_API_TOKEN from our own process environment, else parsed from
// <repo>/.env (see envToken.js — mirrors python-dotenv's value parsing, the
// same file backend/config.py loads via load_dotenv()). Stage 5 packaging
// will instead generate this at startup and pass it to the spawned backend
// process's environment; for now (dev flow) both the backend and this
// process read the same source so they agree without any IPC between them.
const API_TOKEN = process.env.FILEPLUS_API_TOKEN || readEnvFileToken(path.join(__dirname, '..'));

// Mica needs Windows 11 22H2 (build 22621). Elsewhere Electron ignores the option
// and the renderer paints solid --bg-chrome.
const MICA_AVAILABLE = process.platform === 'win32' && Number(os.release().split('.')[2] || 0) >= 22621;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#00000000',
    backgroundMaterial: 'mica',
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

  ipcMain.on('get-home-dir', (event) => {
    event.returnValue = os.homedir();
  });

  ipcMain.on('get-api-token', (event) => {
    event.returnValue = API_TOKEN;
  });

  ipcMain.on('mica-available', (event) => { event.returnValue = MICA_AVAILABLE; });

  ipcMain.on('set-theme-source', (_e, mode) => {
    nativeTheme.themeSource = ['dark', 'light'].includes(mode) ? mode : 'system';
  });

  // Shell / dialog / clipboard bridge — renderer never touches Node fs directly;
  // these are the only filesystem-adjacent capabilities exposed (Plan 2B wires the renderer side).
  const isStr = (v) => typeof v === 'string' && v.length > 0;
  ipcMain.handle('shell-open-path', async (_e, p) => isStr(p) ? await shell.openPath(p) : 'invalid path');
  ipcMain.on('shell-show-item', (_e, p) => { if (isStr(p)) shell.showItemInFolder(p); });
  ipcMain.on('shell-open-with', (_e, p) => {
    if (!isStr(p)) return;
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], { detached: true, stdio: 'ignore' }).unref();
  });
  ipcMain.handle('dialog-pick-folder', async (_e, defaultPath) => {
    if (!mainWindow) return null;
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], defaultPath: isStr(defaultPath) ? defaultPath : undefined });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  ipcMain.on('clipboard-write-text', (_e, t) => { if (typeof t === 'string') clipboard.writeText(t); });

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
