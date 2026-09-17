/**
 * FilePlus Electron main process.
 *
 * Creates the application window, configures security settings,
 * and wires up the dev-tools shortcut.
 */
const { app, BrowserWindow, ipcMain, nativeTheme, nativeImage, shell, dialog, clipboard } = require('electron');
const path = require('path');
const os   = require('os');
const { spawn } = require('child_process');
const { resolveApiPort, resolveApiToken } = require('./envToken');
const { LruCache, iconCacheKey, isSafeLocalPath, normalizeWinPath, clampPx } = require('./iconCache');

let mainWindow;

// ── API token ────────────────────────────────────────────────────────────
// Three sources, in order: FILEPLUS_API_TOKEN from our own process
// environment, then <repo>/.env (see envToken.js — mirrors python-dotenv's
// value parsing, the same file backend/config.py loads via load_dotenv()),
// then <repo>/.fileplus-token, which the backend writes at startup when
// nothing is configured (config.ensure_api_token). The backend always
// requires a token, so the third source is what makes a bare dev launch
// work; the renderer keeps receiving it over the preload bridge.
// Resolved lazily (not at module load) so a backend started after this
// process — the launch order verify.ps1 uses — still hands us its token.
const REPO_DIR = path.join(__dirname, '..');
let API_TOKEN = resolveApiToken(REPO_DIR, process.env);

function apiToken() {
  if (!API_TOKEN) API_TOKEN = resolveApiToken(REPO_DIR, process.env);
  return API_TOKEN;
}

// ── API port ─────────────────────────────────────────────────────────────
// FILEPLUS_PORT from our own process environment, else parsed from .env,
// else the default 9876 -- must agree with backend/config.py's FILEPLUS_PORT
// default so the renderer's fetch() calls land on whichever backend is
// actually listening (scripts/verify.ps1 sets FILEPLUS_PORT=9877 so its own
// backend can run alongside a developer's already-running instance on 9876).
// resolveApiPort also warns when the resolved port is one index.html's CSP
// connect-src does not allow -- otherwise every renderer fetch is blocked
// inside the page and the app reports "Backend offline" for a healthy backend
// with nothing anywhere saying why.
const API_PORT = resolveApiPort(REPO_DIR, process.env);

// Mica needs Windows 11 22H2 (build 22621). Elsewhere Electron ignores the option
// and the renderer paints solid --bg-chrome.
const MICA_AVAILABLE = process.platform === 'win32' && Number(os.release().split('.')[2] || 0) >= 22621;

// ── Icon / thumbnail bridge (Stage 2C Task 4; sizing rewritten pass 2 —
// icon-design.md §4.2) ───────────────────────────────────────────────────
// Two separate byte-budgeted LRUs: file icons are small and numerous (folder
// chrome, list rows); thumbnails are bigger images but there are fewer
// distinct sizes in play at once (grid view). Values: {url, px, exact} for
// icons, {url, w, h} for thumbnails.
const iconCache = new LruCache(2000, 8 * 1024 * 1024);
const thumbnailCache = new LruCache(600, 32 * 1024 * 1024);

// Thumbnails and icons both go through the shell; a grid of ~500 tiles must
// not fire 500 concurrent shell calls. makeQueue(concurrency) is a tiny FIFO
// gate that also dedupes identical in-flight work by key — six rows sharing
// one icon key become one shell call, not six.
function makeQueue(concurrency, { lifo = false } = {}) {
  let running = 0;
  const waiting = [];
  const inFlight = new Map(); // key -> Promise
  // lifo: a fast scroll through a grid queues far more thumbnails than the
  // gate lets through at once; serving the most recently requested (the
  // tiles currently on screen) first means the user sees the viewport fill
  // rather than tiles that have already scrolled away (pass 2 #35). The
  // renderer separately drops requests nobody wants any more before they
  // are sent (icons.js _fpFlushIconBatch).
  function drain() {
    if (running < concurrency) {
      const next = lifo ? waiting.pop() : waiting.shift();
      if (next) next();
    }
  }
  function run(key, task) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = new Promise((resolve) => {
      const start = () => {
        running++;
        task().then(
          (result) => { running--; inFlight.delete(key); drain(); resolve(result); },
          () => { running--; inFlight.delete(key); drain(); resolve(null); }
        );
      };
      if (running < concurrency) start();
      else waiting.push(start);
    });
    inFlight.set(key, promise);
    return promise;
  }
  return { run };
}
// 8 for icons: Chromium serialises app.getFileIcon internally anyway
// (probe/out3.json), so a wider gate here costs nothing. THUMBNAIL_CONCURRENCY
// stays 4 (IShellItemImageFactory-backed thumbnails are heavier per call).
const THUMBNAIL_CONCURRENCY = 4;
const iconQueue = makeQueue(8);
const thumbQueue = makeQueue(THUMBNAIL_CONCURRENCY, { lifo: true });
globalThis.__fpMainIconStats = { shellCalls: 0, thumbCalls: 0, batches: 0 };

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

  // F12 toggles DevTools. before-input-event (not globalShortcut): a global
  // shortcut is an OS-level accelerator that fires even when FilePlus has no
  // focus, so registering F12 there took the key away from every other
  // application on the machine for as long as FilePlus was running.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12'
        && !input.control && !input.alt && !input.shift && !input.meta) {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const ZOOM_STEPS   = [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.33, 1.5, 1.75, 2.0];

// How long show-properties waits for the PowerShell helper to fail before
// concluding the dialog is up: the failure paths throw within milliseconds,
// while a successful run blocks until the property sheet closes.
const SHOW_PROPERTIES_EARLY_EXIT_MS = 1200;

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
    event.returnValue = apiToken();
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
  ipcMain.handle('dialog-pick-folder', async (_e, defaultPath) => {
    if (!mainWindow) return null;
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], defaultPath: isStr(defaultPath) ? defaultPath : undefined });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });
  ipcMain.on('clipboard-write-text', (_e, t) => { if (typeof t === 'string') clipboard.writeText(t); });

  // File icon (Windows-icon sharpness fix, pass 2 — icon-design.md §4.2).
  // app.getFileIcon's own {size} option is a coarse 'small'/'normal'/'large'
  // enum: small = 16*S px, normal = large = 32*S px for extension groups
  // (16/32/48 regardless of S for .exe/.dll/.ico — the per-file branch).
  // The returned nativeImage is DPI-tagged on a scaled display, so its own
  // getSize()/resize() work in DIP, not physical pixels (measured:
  // scratchpad probe/out2.json, getSize {10,10} for a 16-px rep at 150%) —
  // never call either on it. Instead read the raw representation at its true
  // physical size via toPNG() and treat the PNG's own IHDR as ground truth.
  function rawRep(image) {
    // app.getFileIcon returns a single representation today; should a
    // future Electron hand back several, the largest is the physical one.
    const factors = (typeof image.getScaleFactors === 'function' && image.getScaleFactors()) || [];
    const s = factors.length ? Math.max(...factors) : 1;
    const png = image.toPNG({ scaleFactor: s });
    return { png, w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
  }
  // 'small' = the shell's small image list (16*S px, hand-hinted — exact for
  // list rows at zoom 1); 'large' = 32*S for extension groups, 48 for
  // exe/dll/ico ('normal' is identical to 'large' for extension groups, so
  // it is never requested). Picks the smallest native representation that
  // covers px and resamples at most once, only on a size mismatch.
  async function renderShellIcon(filePath, px) {
    let best = null;
    for (const size of ['small', 'large']) {
      globalThis.__fpMainIconStats.shellCalls++;
      const img = await app.getFileIcon(filePath, { size });
      if (!img || img.isEmpty()) continue;
      best = rawRep(img);
      if (best.w >= px) break;
    }
    if (!best) return null;
    const exact = best.w === px && best.h === px;
    let out = nativeImage.createFromBuffer(best.png); // a true 1x image: DIP == px
    if (!exact) out = out.resize({ width: px, height: px, quality: 'best' });
    return { url: out.toDataURL(), px, exact };
  }
  async function fileIconFor(rawPath, ext, rawPx) {
    if (!isSafeLocalPath(rawPath)) return null;
    const p = normalizeWinPath(rawPath), px = clampPx(rawPx);
    const key = iconCacheKey(p, ext, px);
    const hit = iconCache.get(key);
    if (hit !== undefined) return hit;
    return iconQueue.run(key, async () => {
      try {
        // A definitive "no icon" (the shell answered an empty image) is
        // cached as null so the next renderer miss for that key — a second
        // window, an evicted renderer entry — does not re-run two
        // app.getFileIcon calls (pass 2 #38/#144). A throw is not cached:
        // it is the unusual, possibly transient path.
        const res = await renderShellIcon(p, px);
        iconCache.set(key, res || null);
        return res;
      } catch (_err) {
        return null;
      }
    });
  }
  // Single-icon and batched (a viewport of list rows -> one IPC round trip)
  // variants share fileIconFor's cache/queue, so overlapping requests for the
  // same key (one from a batch, one from a stray single call) still collapse
  // to one shell call.
  ipcMain.handle('get-file-icon', (_e, p, ext, px) => fileIconFor(p, ext, px));
  ipcMain.handle('get-file-icons', (_e, reqs) => {
    if (!Array.isArray(reqs)) return [];
    globalThis.__fpMainIconStats.batches++;
    return Promise.all(reqs.slice(0, 64).map((r) => (r && typeof r === 'object') ? fileIconFor(r.path, r.ext, r.px) : null));
  });

  // Shell thumbnail (real image content — photos, video posters, folder
  // previews via IThumbnailCache). px is device pixels (CSS box x
  // devicePixelRatio), computed by icons.js. createThumbnailFromPath is
  // thumbnail-ONLY — it rejects .txt/.exe/.pdf/.lnk and an empty folder (the
  // renderer falls back to the icon path for those) — and for anything it
  // accepts it returns the requested width on the longer edge exactly.
  // Keyed with mtime so an edited file doesn't serve a stale cached
  // thumbnail. Queued: see THUMBNAIL_CONCURRENCY above.
  ipcMain.handle('get-thumbnail', async (_e, filePath, rawPx, mtime) => {
    if (!isSafeLocalPath(filePath)) return null;
    const p = normalizeWinPath(filePath), px = clampPx(rawPx);
    const key = `${p}|${mtime}|${px}`;
    const cached = thumbnailCache.get(key);
    if (cached !== undefined) return cached;
    return thumbQueue.run(key, async () => {
      try {
        globalThis.__fpMainIconStats.thumbCalls++;
        const image = await nativeImage.createThumbnailFromPath(p, { width: px, height: px });
        if (!image || image.isEmpty()) { thumbnailCache.set(key, null); return null; }
        const png = image.toPNG();
        const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
        const res = { url: 'data:image/png;base64,' + png.toString('base64'), w, h };
        thumbnailCache.set(key, res);
        return res;
      } catch (_err) {
        // createThumbnailFromPath THROWS for everything it cannot picture
        // (.txt, .exe, .pdf, an empty folder) — that is the normal negative
        // answer, not an error, and it is cached so a renderer miss does not
        // re-run a COM round trip per scroll (pass 2 #38/#144). The key
        // carries mtime, so an edit invalidates it.
        thumbnailCache.set(key, null);
        return null;
      }
    });
  });

  // Native "Properties" dialog. isSafeLocalPath gates this before the path
  // ever reaches a spawned shell process — see iconCache.js.
  ipcMain.handle('show-properties', async (_e, filePath) => {
    if (!isSafeLocalPath(filePath)) return false;
    let child;
    try {
      child = spawn(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(__dirname, 'native', 'show-properties.ps1'), '-Path', filePath],
        { detached: true, stdio: 'ignore', windowsHide: true }
      );
    } catch (_err) {
      return false;
    }
    // The script blocks for as long as the dialog is up, so "still running a
    // moment later" IS success. An early non-zero exit (a shell item that
    // could not be resolved) used to be invisible: this handler reported only
    // whether the SPAWN worked, so the renderer never toasted and the user
    // got absolute silence (pass 2 #147).
    return await new Promise((resolve) => {
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      const timer = setTimeout(() => { child.unref(); done(true); }, SHOW_PROPERTIES_EARLY_EXIT_MS);
      child.once('exit', (code) => { clearTimeout(timer); child.unref(); done(code === 0); });
      child.once('error', () => { clearTimeout(timer); done(false); });
    });
  });

  // Native "Open with" dialog, gated the same way as showProperties: validates
  // the path with isSafeLocalPath before it ever reaches a spawned process,
  // and reports back whether the dialog was actually spawned. The sole way to
  // open this dialog — both the context menu's Open with… and the Properties
  // panel's Change… button call electronAPI.openWithDialog().
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


