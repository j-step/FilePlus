/**
 * FilePlus Electron main process.
 *
 * Creates the application window, configures security settings,
 * and wires up the dev-tools shortcut.
 */
const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, nativeImage, shell, dialog, clipboard } = require('electron');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { readEnvFileToken, readEnvFileValue } = require('./envToken');
const { LruCache, iconCacheKey, isSafeLocalPath } = require('./iconCache');

let mainWindow;

// ── API token ────────────────────────────────────────────────────────────
// FILEPLUS_API_TOKEN from our own process environment, else parsed from
// <repo>/.env (see envToken.js — mirrors python-dotenv's value parsing, the
// same file backend/config.py loads via load_dotenv()). Stage 5 packaging
// will instead generate this at startup and pass it to the spawned backend
// process's environment; for now (dev flow) both the backend and this
// process read the same source so they agree without any IPC between them.
const API_TOKEN = process.env.FILEPLUS_API_TOKEN || readEnvFileToken(path.join(__dirname, '..'));

// ── API port ─────────────────────────────────────────────────────────────
// FILEPLUS_PORT from our own process environment, else parsed from .env,
// else the default 9876 -- must agree with backend/config.py's FILEPLUS_PORT
// default so the renderer's fetch() calls land on whichever backend is
// actually listening (scripts/verify.ps1 sets FILEPLUS_PORT=9877 so its own
// backend can run alongside a developer's already-running instance on 9876).
const API_PORT = Number(process.env.FILEPLUS_PORT || readEnvFileValue(path.join(__dirname, '..'), 'FILEPLUS_PORT')) || 9876;

// Mica needs Windows 11 22H2 (build 22621). Elsewhere Electron ignores the option
// and the renderer paints solid --bg-chrome.
const MICA_AVAILABLE = process.platform === 'win32' && Number(os.release().split('.')[2] || 0) >= 22621;

// ── Icon / thumbnail bridge (Stage 2C Task 4) ───────────────────────────────
// Two separate LRUs: file icons are small and numerous (folder chrome, list
// rows); thumbnails are bigger images but there are fewer distinct sizes in
// play at once (grid view). Sizes per task-4-brief.md.
const iconCache = new LruCache(300);
const thumbnailCache = new LruCache(500);

// Thumbnails go through the shell (IShellItemImageFactory under the hood);
// a grid of ~500 tiles must not fire 500 concurrent shell calls, so this is
// a tiny FIFO queue capping in-flight work at THUMBNAIL_CONCURRENCY.
const THUMBNAIL_CONCURRENCY = 4;
let thumbnailInFlight = 0;
const thumbnailQueue = [];

function runQueuedThumbnail(task) {
  return new Promise((resolve) => {
    const run = () => {
      thumbnailInFlight++;
      task().then(
        (result) => { thumbnailInFlight--; drainThumbnailQueue(); resolve(result); },
        () => { thumbnailInFlight--; drainThumbnailQueue(); resolve(null); }
      );
    };
    if (thumbnailInFlight < THUMBNAIL_CONCURRENCY) run();
    else thumbnailQueue.push(run);
  });
}

function drainThumbnailQueue() {
  if (thumbnailInFlight < THUMBNAIL_CONCURRENCY) {
    const next = thumbnailQueue.shift();
    if (next) next();
  }
}

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

  ipcMain.on('get-api-port', (event) => {
    event.returnValue = API_PORT;
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

  // File icon: app.getFileIcon's own {size} option is a coarse 'small'/'normal'/'large'
  // enum, not a pixel size, so it's picked from the requested pixel size and the
  // result is resized down/up to it exactly (list rows at 16-20, grid rows at 32-48).
  ipcMain.handle('get-file-icon', async (_e, filePath, ext, size) => {
    if (!isSafeLocalPath(filePath)) return null;
    const key = iconCacheKey(filePath, ext, size);
    const cached = iconCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const iconSize = size >= 32 ? 'large' : 'normal';
      const image = await app.getFileIcon(filePath, { size: iconSize });
      const dataUrl = image.resize({ width: size, height: size }).toDataURL();
      iconCache.set(key, dataUrl);
      return dataUrl;
    } catch (_err) {
      return null;
    }
  });

  // Shell thumbnail (real image content — photos, video posters, folder
  // previews via IShellItemImageFactory). Keyed with mtime so an edited file
  // doesn't serve a stale cached thumbnail. Queued: see THUMBNAIL_CONCURRENCY above.
  ipcMain.handle('get-thumbnail', async (_e, filePath, size, mtime) => {
    if (!isSafeLocalPath(filePath)) return null;
    const key = `${filePath}|${mtime}|${size}`;
    const cached = thumbnailCache.get(key);
    if (cached !== undefined) return cached;
    return runQueuedThumbnail(async () => {
      try {
        const image = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size });
        const dataUrl = image.toDataURL();
        thumbnailCache.set(key, dataUrl);
        return dataUrl;
      } catch (_err) {
        return null;
      }
    });
  });

  // Native "Properties" dialog. isSafeLocalPath gates this before the path
  // ever reaches a spawned shell process — see iconCache.js.
  ipcMain.handle('show-properties', async (_e, filePath) => {
    if (!isSafeLocalPath(filePath)) return false;
    try {
      spawn(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(__dirname, 'native', 'show-properties.ps1'), '-Path', filePath],
        { detached: true, stdio: 'ignore', windowsHide: true }
      ).unref();
      return true;
    } catch (_err) {
      return false;
    }
  });

  // Native "Open with" dialog, gated the same way as showProperties. (Distinct
  // from the older fire-and-forget openWith() above: this one validates the
  // path and reports back whether the dialog was actually spawned.)
  ipcMain.handle('open-with-dialog', async (_e, filePath) => {
    if (!isSafeLocalPath(filePath)) return false;
    try {
      spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', filePath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return true;
    } catch (_err) {
      return false;
    }
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
