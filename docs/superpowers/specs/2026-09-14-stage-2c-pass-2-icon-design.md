<!-- Status (2026-09-16): landing steps 1-4 are on branch stage/2c-pass-2 -- step 1 eec7e50,
step 2 2127a15, steps 3-4 plus the Tier-B review findings and the icons-thumbnails-perf audit
findings in the "fix(icons)" commits that follow. Deviations from the text below, all recorded in
the icons fix report and the run doc: (1) the renderer learns whether POST /shell/icons exists from
/health's `shell_icons` capability flag (checkBackend -> fpShellIconRoute) rather than from a 404 on
its first batch -- a caught 404 still logs a Chromium console error; the 404/405 catch remains as
the fallback; (2) the backend's STA pool is reached through winshell.icon_executor(), which recreates
a pool the lifespan shut down, and shell_image initialises COM per calling thread itself; (3) the
main process caches a definitive null (empty image / unsupported thumbnail); (4) the renderer's
IntersectionObserver is per scroll root (#list-scroll) so rootMargin really preloads; (5) the
fixture's extension-less file is `_gen\Projects\Makefile`, EXPECTED_FILES = 43. The scratchpad
probe files named in §1 were session-local measurements and are not in the repository. -->

# Windows-icon sharpness: final implementation design (Stage 2C pass 2)

> **Superseded in part by Stage 2D (2026-10-01 spec `2026-10-01-stage-2d-playtest-2-design.md` §3–§4; run summary `docs/superpowers/runs/2026-10-01-stage-2d.md`).** Still current: the two tiers (Tier A `POST /shell/icons` / `GET /shell/icon` first, Tier B `electronAPI.fileIcons` as the fallback, never asked for directories, extension-less files, `.lnk` or `.url`), physical-px requests, keys ending in px, `/health`'s `shell_icons` flag. Replaced:
> 1. **Pinning → buckets.** Requests go out at `fpIconBucket(round(css × dpr))` — 16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256, capped at 256 — not `clampPx(round(css × dpr))`. The `<img>` is no longer pinned to `px / dpr`: it is CSS-sized to its logical box (`--icon-size` on `#list-scroll`, or `.fp-icon--N`) and the browser downsamples. At ≤ 32 logical px the snap is at most one step, so the shell still picks its small, simplified art.
> 2. **Decode before swap.** A size change keeps the current bitmap scaled by CSS; the new bucket's bitmap replaces it only after `decode()`, debounced 120 ms after the last wheel step, for visible rows plus a 200 px margin. Nothing changes size after the reflow.
> 3. **`--list-scale` is gone** (§2's table, §4.5's `setListScale`, §4.6's cascade fix). The Explorer view ladder (`setView` / `stepView` in browser.js) drives `--icon-size` and `--cell-w`.
> 4. **No flash.** A cache hit is painted settled in the markup (`fpCachedIconImg`); a per-path folder slot paints the learned generic folder icon first (adopted once two plain folders agree) and changes only if the real icon differs; any other miss is an empty, fixed-size slot that fades in; the FilePlus sprite appears in Windows mode only after both tiers fail — except that a folder keeps the generic when one is known. Generics are prewarmed per bucket.
> 5. **Budget.** The renderer icon LRU is 32 MiB / 2000 entries (was 8 MiB); a plain folder's entry shares the generic's bytes.
> Sections below that say otherwise describe the pass-2 design as built then.

Worktree: `C:\Dev\FilePlus\.worktrees\stage-2c-pass-2` (branch `stage/2c-pass-2`). Every path below is relative to it. Nothing here touches `C:\Dev\FilePlus` or the live backend on 9876.

## 0. Decision in one paragraph

One sizing contract, two icon sources. **Contract:** every bridge/route request carries `px = clampPx(round(cssBox × devicePixelRatio))`, the bitmap that comes back is exactly `px × px` (thumbnails: longer edge == px), and the `<img>` is pinned to `px / dpr` CSS px (**superseded by Stage 2D: bucketed px, CSS-sized img — see the note at the top**) so Chromium composites it 1:1 (measured pixel-identical at DPR 1 / 1.25 / 1.5 / 2 — scratchpad `out/dpr2-*.json`, cases A/B/G `exact% 100, maxDiff 0`; today's 32→16→24 path is `exact% 25-27`). **Tier A (parity):** the Python backend renders the icon with `IShellItemImageFactory::GetImage(SIZE{px,px}, SIIGBF_ICONONLY|SIIGBF_SCALEUP)` — the interface Explorer's own views use — which yields the hand-hinted 16/20/24/32/40/48/…/256 resources at any px, real folder / known-folder / desktop.ini icons, shortcut-target icons, and exact 96–216 px tile icons. **Tier B (fallback, complete on its own):** Electron `app.getFileIcon` with the raw shell rep read at physical size (never `getSize()`/`resize()` on the DPI-tagged image), picking the smallest native rep ≥ px and resampling once — Explorer-exact for file rows at zoom 1 on the primary monitor (16·S is the shell's own small image list), and never worse than one Lanczos pass elsewhere. Folders, extension-less files, `.lnk`, `.url` never go to Tier B (Chromium answers the system-drive glyph / a blank page for them — `probe/out2b.json`, `probe/out3.json`); they get the sprite. No `image-rendering: pixelated`, no `srcset`, no `toDataURL({scaleFactor})` tagging — all measured to change nothing at 1:1, and pixelated would jag `.fp-row--drag-target .fp-row__icon { transform: scale(1.05) }` (`frontend/src/styles.css:2495`).

Landing order (each step verify-green and committed on its own): (1) `iconCache.js` helpers + index.html load, (2) Tier B pipeline in main/preload/icons + CSS cascade fix + smoke, (3) backend `shell_image` + routes + pytest, (4) Tier A wiring in icons.js + Tier A smoke + forced-DSF test + docs. After step 2 the author's complaint (blurry/thin/shrunken rows) is fixed for files; step 4 adds folder/shortcut/tile parity.

## 1. Measured facts this design rests on (do not re-derive)

| Fact | Evidence |
|---|---|
| `app.getFileIcon` sizes on Windows for extension groups: small = 16·S px, normal = large = 32·S px (S = Windows system scale). Only `.exe/.dll/.ico` go through the per-file branch: 16/32/48 regardless of S. So `size >= 32 ? 'large' : 'normal'` at `frontend/main.js:170` is a no-op. | `scratchpad/probe/out2.json` (txt small pngDefault 16, normal 32, large 32; realExe small 16); `probe-out/results.json` |
| Under a scaled display the rep is DPI-tagged: `getSize()` reports DIP (10 and 21 for 16- and 32-px reps at S = 1.5) and `resize()` works in DIP. `toPNG()` returns the real pixels. | `probe/out2.json` (`getSize {10,10}`, `pngDefault {16,16}`, `scales [1.5]`) |
| Today `main.js:173` `image.resize({16,16}).toDataURL()` collapses the 32-px artwork to a 1.0-tagged 16-px PNG that the renderer stretches to 20/24 device px on a 125/150 % display. That is the blur; the "thin/shrunken" glyph is the 32-px drawing (which carries a transparent margin) Lanczos-shrunk instead of the shell's hinted 16/20/24 resource. | `out/dpr2-1.5.json` case F (`exact% 25`), `probe-out/compare.png` |
| Every directory and every extension-less path gets the byte-identical SYSTEM-DRIVE glyph from `app.getFileIcon`; every `.lnk` and every `.url` gets one identical blank page regardless of target; `.dll` and `.exe` differ per path. Chromium's IconLoader groups by extension before our cache ever sees the path. | `probe/out2b.json` (`noextFile_vs_dir identical: true`, `lnk identical: true`, `url identical: true`, `dll/exe identical: false`), `probe/out3.json` identity table (plain/Documents/Desktop/OneDrive/C:\Windows/C:\ all `AJ10KBcA…`) |
| `nativeImage.createThumbnailFromPath` is `IThumbnailCache::GetThumbnail(..., WTS_SCALETOREQUESTEDSIZE|WTS_SCALEUP)`, thumbnail-ONLY: rejects `.txt`, `.exe`, `.pdf`, `.lnk` and an EMPTY folder; for images and NON-empty folders it returns exactly the requested width on the longer edge at every integer tried (16…192). | `probe-out/results.json`, `probe-out/thumb-png-*.png`, `thumb-folder-*.png`; `out/probe-out.json` emptydir |
| A `round(css × dpr)`-px bitmap in a 16-CSS-px `<img>` is composited 100 % pixel-identical at DPR 1, 1.25, 1.5 and 2, at `top:0` and at a fractional device offset, with `image-rendering: auto`; `pixelated` is byte-identical to `auto`. A 16-px bitmap upscaled by Chromium is ~26-31 % identical. | `out/dpr2-1.json`, `dpr2-1.25.json`, `dpr2-1.5.json`, `dpr2-2.json` (cases A-D, G vs E, F). The 1.75 capture failed to load its images (`nw 0`) — 1.75 is unmeasured. |
| `--force-device-scale-factor=1.5` reaches `window.devicePixelRatio` and `screen.getPrimaryDisplay().scaleFactor` in this Electron. | `out/dpr-1.5-cli.json` (`viaCli: true, dpr: 1.5`), `probe/out2.json` (`primaryScale: 1.5`) |
| Chromium's icon loader: ~0.7 ms per NEW path (even for an already-seen extension), 0.003 ms for a repeated path, 33 ms per cold `.exe`, 343 ms for 500 folders in parallel. | `probe/out3.json` `t` block |
| CSS cascade: `.fp-icon--16 { width:16px }` at `styles.css:5864` is later in source than `.fp-row__icon { width: calc(16px * var(--list-scale, 1)) }` at `:2573` with equal specificity (0,1,0), and `_winIcon` (`icons.js:166-170`) puts both classes on the `<img>`, so row icons are 16 CSS px at every `--list-scale` today (spec §3 says the icon scales). `.home-pane[data-view="grid"] .fp-row__icon` (`:5492`, (0,3,0)) and `.fp-tile__thumb > .fp-icon { width: 58% }` (`:5948`, (0,2,0)) do win over `.fp-icon--N`. | read in this worktree |
| The raw ctypes `IShellItemImageFactory` call has NOT been validated on this machine (no `GetImage`/`SIIGBF` anywhere in the scratchpad). | `grep` over scratchpad |

## 2. The sizing contract

Definitions:
- `dpr = window.devicePixelRatio || 1` in the renderer. Chromium folds `webContents` zoom (`main.js:97` `ZOOM_STEPS`) into it, so zoom is covered for free.
- `css` = the laid-out CSS width of the box the bitmap will fill: for `img.fp-icon--win` the element's own rect (`rec.boundingClientRect.width` from the IntersectionObserver record — free, no forced layout — else `el.getBoundingClientRect().width`); for `img.fp-thumb` the parent `.fp-thumb-box` rect (the `<img>` itself is a 1×1 GIF until it loads); for `img.fp-thumb--mini` its own rect (it has an explicit 40 % width, `styles.css:5927-5932`). Fallback when the rect is 0 (the no-IntersectionObserver eager path only): `Number(el.dataset.size) || 16`.
- `px = clampPx(Math.round(css * dpr))` — `clampPx` is 8..512, NaN → 16 (§4.1). **px is the only size any bridge or route ever receives.**
- (**Superseded by Stage 2D §4.3 — no pinning; the img is CSS-sized and the request bucketed.**) The element is then pinned: `el.style.width = el.style.height = (px / dpr) + 'px'` (win icons), `style.width = w/dpr, style.height = h/dpr` (thumbnails). When `css × dpr` is integral this equals `css` and changes nothing; when it is not (the 58 % tile icon = 55.68 css; 14-css rows at odd zooms) it nudges the box by ≤ 0.5 css px so the device box equals the bitmap. `data-px` records px; `data-exact="1"` records that the bitmap is an unresampled shell resource.

Physical-pixel table (css → px at dpr 1 / 1.25 / 1.5 / 1.75 / 2):

| Box | css | px |
|---|---|---|
| List/details row icon (`.fp-row .fp-row__icon`, after the cascade fix: `16 × --list-scale`) at scale 1 | 16 | 16 / 20 / 24 / 28 / 32 |
| … at `--list-scale` 1.25 / 1.5 / 2 | 20 / 24 / 32 | 20,25,30,35,40 / 24,30,36,42,48 / 32,40,48,56,64 |
| Row 16-px picture thumbnail (`.fp-row__icon--thumb` box, `16 × --list-scale`) | 16 | same as row |
| Properties header (`properties.js:167`, `.fp-icon--24`) | 24 | 24 / 30 / 36 / 42 / 48 |
| Inspector "No preview" (`inspector.js:193`, `.fp-icon--40`); Home grid rows (`styles.css:5492`) | 40 | 40 / 50 / 60 / 70 / 80 |
| Grid tile thumb box (`.fp-tile__thumb`, `96 × --list-scale`) at scale 1 / 1.5 | 96 / 144 | 96,120,144,168,192 / 144,180,216,252,288 |
| Grid tile icon (`.fp-tile__thumb > .fp-icon` = 58 % of 96) | 55.68 | 56 / 70 / 84 / 97 / 111 (non-integral → inline size px/dpr) |
| Folder-peek mini (40 % of the tile box) | 38.4 | 38 / 48 / 58 / 67 / 77 |
| Properties "Opens with" (`styles.css:6051`) | 16 | 16 / 20 / 24 / 28 / 32 |
| Drag badge (`dragdrop.js:234`, `iconFor(entry,16)`) | 16 | as row (a drag-target row's `scale(1.05)` transient reports 16.8 → px 17 for that one paint; harmless) |

Which source serves which request:

| Request | Source | Exactness |
|---|---|---|
| Windows-mode icon, any entry, any px (file, folder, `.lnk`, no-ext, tile icon) | **Tier A** `POST /shell/icons` (batch) → `winshell.shell_image(path, px)` = `GetImage(SIZE{px,px}, ICONONLY|SCALEUP)` | Exact: the shell picks the hinted resource at px when one exists (16/20/24/32/40/48/64/96/128/256 in imageres/shell32 and most exe/ico) and scales exactly as Explorer does otherwise; SCALEUP guarantees px × px even for a 16-only `.ico`. |
| Same, when the backend is down / old (no route) / timed out for that key | **Tier B** `electronAPI.fileIcons` → `renderShellIcon(path, px)` — but ONLY for non-dir entries with an extension other than `lnk`/`url`; everything else resolves to `null` → sprite | Exact when px equals a native rep (16·S or 32·S; 16/32/48 for exe/dll/ico), i.e. rows at zoom 1, list-scale 1, primary-monitor DPI; otherwise one `quality:'best'` resample from the smallest native rep ≥ px (32→20, 32→24, 48→26) or an upscale when px exceeds the largest (tiles 56-111 from 32/48). |
| Thumbnails (both modes): grid tiles, 16-px picture rows, peek minis | `electronAPI.thumbnail(path, px, mtime)` → `createThumbnailFromPath(p, {width: px, height: px})`, drawn at `w/dpr × h/dpr` css | Exact: longer edge == px (measured). |
| Thumbnail rejected (non-media, empty folder, unreadable) | Windows mode → the icon path above at the same px (Tier A, then Tier B, then sprite); FilePlus mode → `null` → `.fp-thumb--failed` → the family sprite shows (spec §6.1 "on failure the type icon shows"; today `icons.js:378` paints a Windows shell PNG over the sprite in FilePlus mode — a small, spec-conformant behaviour change, note it in the run doc) | — |

## 3. Cache keys

All keys end in px (physical). A DPR / zoom / list-scale change is therefore a NEW key: nothing is flushed, old entries age out of bounded, byte-budgeted LRUs.

**One key module for both processes.** `frontend/iconCache.js` becomes dual-mode (CommonJS export for main/tests, `window.FpIconCache` for the renderer — §4.1) and `index.html` loads it before `src/icons.js`. That removes the renderer twins (`FpLru`, the inline key at `icons.js:329`) and makes "renderer key == main key" true by construction instead of by a parity test.

- `iconCacheKey(path, ext, px)` — **Tier B / main-process only** (mirrors what Chromium's IconLoader actually groups per path): `path:${lower(normalizeWinPath(path))}:${px}` for `PER_PATH_EXTS = {exe, dll, ico}`; `ext:${ext}:${px}` otherwise (`ext::${px}` for an empty extension — documented as never reached by directories, which the renderer keeps out of Tier B).
- `shellIconKey(path, ext, isDir, px)` — **renderer + Tier A**: `dir:${lower(norm(path))}:${px}` for directories (desktop.ini custom icons, known-folder glyphs are per path); `path:${lower(norm(path))}:${px}` for `PER_PATH_SHELL_EXTS = {exe, dll, ico, lnk, url, cpl, scr}` (the shell DOES resolve `.lnk`/`.url` per target, unlike Chromium); `ext:${ext}:${px}` otherwise. The renderer must use this wider set: a per-ext `.lnk` key would paint one target's icon on every shortcut once Tier A answers.
- Backend (`backend/winshell.py`) LRU key: `(kind, ident, px)` with `kind/ident` = `("dir", norm_path)` | `("path", norm_path)` for `PER_PATH_ICON_EXTS` (same seven, defined in Python, parity-tested against the JS set) | `("ext", ext)`. `norm_path = os.path.normcase(str(resolved))`. Values are PNG bytes; only successes are cached.
- Thumbnails (renderer and main): `${normalizeWinPath(path)}|${mtime}|${px}` (mtime already rounded at `icons.js:182`).
- In-flight maps use the same keys: renderer `_fpIconInFlight` / `_fpThumbInFlight`; main-process `iconQueue`/`thumbQueue` dedupe by key. So six PNG rows = one key = one request in every process.
- Budgets: main `iconCache = new LruCache(2000, 8 MiB)`, `thumbnailCache = new LruCache(600, 32 MiB)`; renderer `_fpWinIconCache = new LruCache(2000, 8 MiB)`, `_fpThumbCache = new LruCache(600, 32 MiB)`; backend `OrderedDict` 2048 entries (PNG bytes, ~1 KB at 24 px, ~5 KB at 48, ~20-40 KB at 144). Renderer caches `null` for a definitive "no icon" so a missing icon does not re-request on every scroll; a backend `pending` (timed-out) item is NOT cached.
- No mtime in icon keys (Explorer holds icons for the session too). `GET /shell/icon` answers with `Cache-Control: private, max-age=3600`; the batch JSON is not HTTP-cached (the renderer LRU is its cache).

## 4. File-by-file changes

### 4.1 `frontend/iconCache.js`

- `LruCache(maxEntries, maxBytes = Infinity)` (`:11-44`): `set()` charges `_sizeOf(value)` = `value == null ? 0 : typeof value === 'string' ? value.length : typeof value.url === 'string' ? value.url.length : 0`; after inserting, evict LRU while `this.bytes > maxBytes`; `delete()` credits; expose `get bytes()`. Data-URL strings are one-byte V8 strings, so `length ≈ bytes`.
- `normalizeWinPath(p)`: `String(p).replace(/\//g, '\\').replace(/\\{2,}/g, '\\')`. Call it only AFTER `isSafeLocalPath(raw)` (which accepts `/`, `:80-93`); the normalised form is what every shell call receives, because `SHCreateItemFromParsingName` rejects mixed separators (`C:/a\b`) and so does `createThumbnailFromPath` (measured by proposal 1). Keys lower-case; the path handed to the shell keeps its case.
- `clampPx(v)`: `const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(512, Math.max(8, n)) : 16;`
- `PER_PATH_EXTS = new Set(['exe', 'dll', 'ico'])` (`:49` — drop lnk/url/cpl/scr, add dll: measured Chromium grouping) and `PER_PATH_SHELL_EXTS = new Set(['exe', 'dll', 'ico', 'lnk', 'url', 'cpl', 'scr'])`.
- `iconCacheKey(path, ext, px)` (`:65-71`): as §3; lower-case the path part. Replace the wrong comment at `:58-64` with: the empty extension is shared (`ext::px`) — `app.getFileIcon` answers the system-drive glyph for EVERY extension-less path (`probe/out2b.json`), so directories never reach this key (icons.js keeps them out of Tier B) and per-path keying could never have made the fallback correct.
- New `shellIconKey(path, ext, isDir, px)` as §3.
- Tail (replace `:95`):
```js
const _exports = { LruCache, iconCacheKey, shellIconKey, isSafeLocalPath, normalizeWinPath, clampPx, PER_PATH_EXTS, PER_PATH_SHELL_EXTS };
if (typeof module !== 'undefined' && module.exports) module.exports = _exports;
else if (typeof window !== 'undefined') window.FpIconCache = _exports;
```
- `frontend/index.html:3481`: insert `<script src="iconCache.js"></script>` immediately before `<script src="src/icons.js"></script>` (after `icons-sprite.js`). Update the module-order bullet in `CLAUDE.md:55` and `icons.js`'s header comment.

### 4.2 `frontend/main.js`

- `:12` → `const { LruCache, iconCacheKey, isSafeLocalPath, normalizeWinPath, clampPx } = require('./iconCache');`
- `:41-42` → `const iconCache = new LruCache(2000, 8 * 1024 * 1024); const thumbnailCache = new LruCache(600, 32 * 1024 * 1024);` Values: `{url, px, exact}` (icons) / `{url, w, h}` (thumbnails).
- `:44-70` → generalise into `makeQueue(concurrency)` returning `{ run(key, task) }`: an `inFlight = new Map()` (key → Promise; a duplicate key returns the existing promise) plus the existing FIFO gate. `const iconQueue = makeQueue(8); const thumbQueue = makeQueue(4);` (`THUMBNAIL_CONCURRENCY` stays 4; 8 for icons because Chromium serialises them internally anyway — `probe/out3.json`). `globalThis.__fpMainIconStats = { shellCalls: 0, thumbCalls: 0, batches: 0 }` for the smoke.
- Replace `:161-179` with:
```js
// Raw shell representation in PHYSICAL pixels. Never getSize()/resize() on the
// image app.getFileIcon returns: on a scaled display its rep is DPI-tagged and
// both work in DIP (probe: getSize 10x10 for a 16-px rep at 150%). The PNG's
// IHDR is the truth.
function rawRep(image) {
  const s = (typeof image.getScaleFactors === 'function' && image.getScaleFactors()[0]) || 1;
  const png = image.toPNG({ scaleFactor: s });
  return { png, w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}
// 'small' = the shell's small image list (16*S px, hand-hinted — exact for rows
// at zoom 1); 'large' = 32*S for extension groups, 48 for exe/dll/ico ('normal'
// is identical to 'large' for groups, so it is never asked). Pick the smallest
// native rep that covers px; resample once, only on a mismatch.
async function renderShellIcon(filePath, px) {
  let best = null;
  for (const size of ['small', 'large']) {
    __fpMainIconStats.shellCalls++;
    const img = await app.getFileIcon(filePath, { size });
    if (!img || img.isEmpty()) continue;
    best = rawRep(img);
    if (best.w >= px) break;
  }
  if (!best) return null;
  const exact = best.w === px && best.h === px;
  let out = nativeImage.createFromBuffer(best.png);          // true 1x image: DIP == px
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
    try { const res = await renderShellIcon(p, px); if (res) iconCache.set(key, res); return res; }
    catch (_err) { return null; }
  });
}
ipcMain.handle('get-file-icon', (_e, p, ext, px) => fileIconFor(p, ext, px));
ipcMain.handle('get-file-icons', (_e, reqs) => {
  if (!Array.isArray(reqs)) return [];
  __fpMainIconStats.batches++;
  return Promise.all(reqs.slice(0, 64).map((r) => r && typeof r === 'object' ? fileIconFor(r.path, r.ext, r.px) : null));
});
```
- Replace `:184-200` (`get-thumbnail`): signature `(filePath, px, mtime)`; `if (!isSafeLocalPath(filePath)) return null; const p = normalizeWinPath(filePath); px = clampPx(px); key = \`${p}|${mtime}|${px}\``; `thumbQueue.run(key, ...)` → `const image = await nativeImage.createThumbnailFromPath(p, { width: px, height: px }); const png = image.toPNG(); const w = png.readUInt32BE(16), h = png.readUInt32BE(20); const res = { url: 'data:image/png;base64,' + png.toString('base64'), w, h };` cache and return; any throw → `null` (not cached). Update the `:181-183` comment: px is device pixels; `createThumbnailFromPath` is `IThumbnailCache` (thumbnail-only — rejects non-media and empty folders; the renderer falls back to the icon path), returns longer edge == px.
- Never call `resize()` on the image `app.getFileIcon` returned; never `toDataURL({scaleFactor})` — Chromium does not read a density from a data URL.

### 4.3 `frontend/preload.js:38-39`

```js
// px = device pixels (CSS box x devicePixelRatio), computed by icons.js. fileIcon(s) -> {url, px, exact} | null;
// fileIcons takes [{path, ext, px}] (<= 64) and answers in order. thumbnail -> {url, w, h} | null (w or h == px).
fileIcon:  (path, ext, px)   => ipcRenderer.invoke('get-file-icon', path, ext, px),
fileIcons: (reqs)            => ipcRenderer.invoke('get-file-icons', reqs),
thumbnail: (path, px, mtime) => ipcRenderer.invoke('get-thumbnail', path, px, mtime),
```

### 4.4 `frontend/src/icons.js`

(a) Header: `const _IC = window.FpIconCache;` (loaded by index.html right before this file). Delete `FpLru` (`:226-241`); `:246-250` → `const _fpWinIconCache = new _IC.LruCache(2000, 8 * 1024 * 1024); const _fpThumbCache = new _IC.LruCache(600, 32 * 1024 * 1024); const _fpThumbInFlight = new Map(); const _fpIconInFlight = new Map(); let _fpIconBatch = null; let _fpShellRoute = 'unknown'; // 'unknown' | 'live' | 'absent'` and `window.__fpIconStats = { requested: 0, keys: 0, batches: 0, tierB: 0 };`

(b) Public helpers:
```js
function fpDevicePx(css) { return _IC.clampPx(Math.round(css * (window.devicePixelRatio || 1))); }
function _fpCssBox(el, rect, fallback) { const r = rect || el.getBoundingClientRect(); return r && r.width > 0 ? r.width : fallback; }
/** Route state for POST /shell/icons: 'absent' after a 404/405 (older backend without the route) so the
 * renderer stops paying a failed HTTP per batch; reset to 'unknown' when /health comes back (app.js checkBackend). */
function fpShellIconRoute(state) { if (state !== undefined) _fpShellRoute = state; return _fpShellRoute; }
```

(c) `_winIcon` (`:165-173`): add `data-dir=""` when `entry.is_dir`. `fpThumbBox` (`:179-190`): add `data-dir=""` when `entry.is_dir`; keep `data-size` as the no-layout fallback. `iconFor` unchanged (extension-less files still go through `_winIcon`: Tier A renders the shell's generic "unknown file" page for them; Tier B refuses them → sprite).

(d) IO callback (`:267-270`): `_fpStartLazy(el, rec.boundingClientRect)`; `_fpStartLazy(el, rect)` passes `rect` to `_fpResolveWinIcon(el, seq, rect)` and to `fpRequestThumbnail(el, path, size, mtime, seq, rect)`.

(e) Replace `_fpResolveWinIcon` (`:325-348`):
```js
function _fpResolveWinIcon(el, seq, rect) {
  const p = el.dataset.winIcon, ext = el.dataset.ext || '', isDir = el.dataset.dir !== undefined;
  const dpr = window.devicePixelRatio || 1;
  const css = _fpCssBox(el, rect, Number(el.dataset.size) || 16);
  const px = fpDevicePx(css);
  const key = _IC.shellIconKey(p, ext, isDir, px);
  const paint = (res) => {
    if (!_fpSettle(el, seq, true)) return;
    if (!res || !res.url) { _fpWinIconFallback(el); return; }
    el.dataset.px = String(res.px); el.dataset.exact = res.exact ? '1' : '';
    el.style.width = el.style.height = (res.px / dpr) + 'px';   // device box == bitmap, always
    el.src = res.url;
  };
  const hit = _fpWinIconCache.get(key);
  if (hit !== undefined) { paint(hit); return; }
  if (!window.electronAPI) { paint(null); return; }
  window.__fpIconStats.requested++;
  fpShellIconUrl(key, { path: p, ext, isDir, px }).then(paint);
}
```
`_fpWinIconFallback` (`:319-323`) unchanged (replaces the `<img>` with the sprite; no inline size survives).

(f) Batched resolver (one request per macrotask, same coalescing style as `_fpQueueScan` `:433-438`):
```js
function fpShellIconUrl(key, item) {            // -> Promise<{url,px,exact}|null>, never rejects
  const pending = _fpIconInFlight.get(key); if (pending) return pending;
  const settled = new Promise((resolve) => {
    if (!_fpIconBatch) _fpIconBatch = { items: new Map(), timer: setTimeout(_fpFlushIconBatch, 0) };
    _fpIconBatch.items.set(key, { ...item, key, resolve });
  }).then((ans) => {                            // ans = {res, cache}
    if (ans.cache) _fpWinIconCache.set(key, ans.res);
    _fpIconInFlight.delete(key);
    return ans.res;
  });
  _fpIconInFlight.set(key, settled);
  return settled;
}
async function _fpFlushIconBatch() {
  const items = [..._fpIconBatch.items.values()]; _fpIconBatch = null;
  window.__fpIconStats.keys += items.length; window.__fpIconStats.batches++;
  let answers = null;                           // Tier A: exact hinted resource at px, folders, shortcuts
  if (_fpShellRoute !== 'absent') answers = await _fpTierA(items);
  const rest = [];
  items.forEach((it, i) => {
    const a = answers && answers[i];
    if (a && a.png) it.resolve({ res: { url: 'data:image/png;base64,' + a.png, px: it.px, exact: true }, cache: true });
    else rest.push({ it, transient: !!(a && a.pending) || !answers });
  });
  if (rest.length) await _fpTierB(rest);
}
async function _fpTierA(items) {
  // <= 200 per POST, at most 2 POSTs in flight (extra items wait for the next flush)
  try {
    const data = await API.post('/shell/icons', { items: items.map(({ path, px, isDir }) => ({ path, px, is_dir: isDir })) });
    _fpShellRoute = 'live';
    return (data && data.items) || null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) _fpShellRoute = 'absent';
    return null;                                 // network / 5xx / abort: fall back for this batch, retry next time
  }
}
async function _fpTierB(rest) {
  const api = window.electronAPI;
  // Chromium's IconLoader answers the system-drive glyph for every directory and extension-less path and
  // one blank page for every .lnk/.url (probe/out2b.json) — the sprite is more honest, so those never go to it.
  const eligible = [], refused = [];
  for (const r of rest) {
    const e = r.it.ext.toLowerCase();
    (r.it.isDir || !e || e === 'lnk' || e === 'url' || !api || typeof api.fileIcons !== 'function') ? refused.push(r) : eligible.push(r);
  }
  refused.forEach((r) => r.it.resolve({ res: null, cache: !r.transient }));
  for (let i = 0; i < eligible.length; i += 64) {
    const chunk = eligible.slice(i, i + 64);
    window.__fpIconStats.tierB += chunk.length;
    let out = [];
    try { out = await api.fileIcons(chunk.map(({ it }) => ({ path: it.path, ext: it.ext, px: it.px }))); } catch (_) { out = []; }
    chunk.forEach((r, j) => r.it.resolve({ res: out[j] || null, cache: !r.transient }));
  }
}
```
Rule on caching: a Tier B answer obtained because Tier A was *unavailable for this batch* (network error, or the backend marked the key `pending`) is painted but not cached (`cache:false`), so the next scroll retries Tier A; a Tier B answer after a definitive Tier A `null` (path missing, no image) or with the route `absent` IS cached.

(g) Thumbnails (`:356-402`): `fpRequestThumbnail(imgEl, path, size, mtime, seq, rect)`: `const isMini = imgEl.classList.contains('fp-thumb--mini'); const boxEl = isMini ? imgEl : imgEl.parentElement; const css = _fpCssBox(boxEl, isMini ? rect : null, size); const px = fpDevicePx(css); const key = \`${_IC.normalizeWinPath(path)}|${mtime}|${px}\`;` → `_fpFetchThumb(key, path, px, mtime, ext, isDir)` where `isDir = imgEl.dataset.dir !== undefined`. In `_fpFetchThumb` the null branch becomes: `if (fpIconSource() !== 'windows') return null; return fpShellIconUrl(_IC.shellIconKey(path, ext, isDir, px), { path, ext, isDir, px }).then((r) => r && r.url ? { url: r.url, w: r.px, h: r.px } : null);` `_fpApplyThumb(imgEl, seq, res)`: `imgEl.classList.remove('fp-thumb--failed')` first (a re-request after a DPR/scale change can revive a tile); on `res` set `imgEl.src = res.url` and, unless `fp-thumb--mini`, `imgEl.style.width = (res.w / dpr) + 'px'; imgEl.style.height = (res.h / dpr) + 'px'` (renders w×h device px exactly even at zoom-out, where the intrinsic-size clamp alone would shrink it); `imgEl.dataset.px = String(Math.max(res.w, res.h))`.

(h) Peek minis (`:417-425`): give each mini `img.dataset.thumb = item.path; img.dataset.size = '38'; img.dataset.mtime = '0'; img.dataset.ext = item.ext || ''` and register it with `_fpObserve(img)` instead of calling `fpRequestThumbnail` directly — it then measures its own 40 % box and is covered by invalidation below.

(i) Invalidation + DPR watcher (extend `fpInstallLazyIconWatcher`, `:440-444`):
```js
/** Re-resolves every settled shell icon / thumbnail under root at its CURRENT box x devicePixelRatio.
 * The old bitmap stays on screen until the new one lands (no flash); keys differ by px so this never
 * refetches an already-seen size. Called on zoom / monitor DPI change (below) and by setListScale. */
function fpInvalidateLazyIcons(root) {
  (root || document.body).querySelectorAll('img.fp-icon--win[data-fp-lazy="done"], img.fp-thumb[data-fp-lazy="done"]').forEach((el) => {
    el.dataset.fpLazy = ''; el._fpSeq = 0; el._fpObserved = false;
    el.style.width = el.style.height = '';          // let CSS re-lay the box before it is measured again
    _fpObserve(el);
  });
}
function _fpWatchDpr() {
  const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  mq.addEventListener('change', () => { fpInvalidateLazyIcons(document.body); _fpWatchDpr(); }, { once: true });
}
```
`fpInstallLazyIconWatcher` calls `_fpWatchDpr()` once. This fires for `webContents.setZoomFactor` (app.js zoom, `:1047-1085`) and for a move to a monitor with a different scale.

### 4.5 Callers

- `frontend/src/browser.js:137-143` `setListScale`: after `setProperty('--list-scale', …)` add `setTimeout(() => fpInvalidateLazyIcons(listScroll), 0)` (a timer, not rAF — occluded windows stop painting; same reason as `icons.js:431-432`). The `{persist:false}` dynamic-media path (`:472`) goes through the same function.
- `frontend/src/properties.js:199-215` `loadOpensWithIcon`: `const px = fpDevicePx(16); fpShellIconUrl(FpIconCache.shellIconKey(props.opens_with_exe, 'exe', false, px), { path: props.opens_with_exe, ext: 'exe', isDir: false, px }).then((res) => { … if (!res) return; img.src = res.url; img.dataset.px = String(res.px); img.style.width = img.style.height = (res.px / (window.devicePixelRatio || 1)) + 'px'; })`. icons.js loads before properties.js, so the helper is defined at call time.
- `frontend/src/app.js` `checkBackend` (`:1575-1600`): in the success branch, `if (el.dataset.state !== 'ok' && typeof fpShellIconRoute === 'function' && fpShellIconRoute() === 'absent') fpShellIconRoute('unknown');` BEFORE setting `el.dataset.state = 'ok'` — a restarted backend gets one fresh chance at the route.
- `frontend/src/inspector.js:193`, `home.js:73`, `dragdrop.js:234`: no change (they go through `iconFor` and are measured). Note in the run doc: `homeIconFor` treats `ext === ''` as a directory, so an extension-less file in Recent renders the folder icon under Tier A — pre-existing approximation, out of scope.

### 4.6 `frontend/src/styles.css`

- `:2573-2577` → selector `.fp-row .fp-row__icon` (specificity (0,2,0)) so the row icon actually follows `--list-scale` as spec §3.10 says; today `.fp-icon--16` (`:5864`) wins at equal specificity. `.home-pane[data-view="grid"] .fp-row__icon` (`:5492`, (0,3,0)) and `.fp-tray__row .fp-row__icon` (`:3128`, (0,2,0), later in source) keep winning. Sprite rows now scale too at non-1 list scales (vector, harmless); at scale 1 nothing changes. One-line revert if the author disagrees — then drop smoke assertion 6 and the list-scale rows of the table above.
- `:5879-5881`: keep `.fp-icon--win { object-fit: contain; }` (a no-op guard for a square bitmap in a square box). Replace the comment: "Invariant: the bitmap is exactly box × devicePixelRatio px and icons.js pins the box to px/dpr, so Chromium composites 1:1 (measured identical at DPR 1/1.25/1.5/2). Do NOT add `image-rendering: pixelated` (no gain at 1:1; jags `.fp-row--drag-target .fp-row__icon { transform: scale(1.05) }` and every resampled bitmap) or `srcset` (would make naturalWidth report CSS px and defeat the smoke's sharpness proof)."
- `:5906-5915` `.fp-thumb`: no rule change; comment that icons.js sets an inline `w/dpr × h/dpr` size and `max-width/height: 100%` are guards only.
- Nothing else changes: `.fp-icon--N` (`:5860-5869`), `.fp-tile__thumb` (`:5944-5948`), `.fp-thumb--mini` (`:5927-5940`), `.properties__opens-with-icon img` (`:6051`) all stay in CSS px — the bitmap is what changes size.

### 4.7 `backend/winshell.py` — `shell_image`

Add after the ctypes-handle block (`:65-83`), reusing `_GUID` (`:89-94`) and the `CLSIDFromString` pattern (`:114-115`):
```python
import concurrent.futures, io, threading
SIIGBF_ICONONLY = 0x4; SIIGBF_SCALEUP = 0x100
_IID_ISHELLITEMIMAGEFACTORY = "{BCC18B79-BA16-442F-80C4-8A59C30C463B}"
ICON_PX_MIN, ICON_PX_MAX = 8, 512
PER_PATH_ICON_EXTS = frozenset({"exe", "dll", "ico", "lnk", "url", "cpl", "scr"})  # parity: frontend/iconCache.js PER_PATH_SHELL_EXTS

class _SIZE(ctypes.Structure): _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]
class _BITMAP(ctypes.Structure): _fields_ = [("bmType", c_long), ("bmWidth", c_long), ("bmHeight", c_long), ("bmWidthBytes", c_long), ("bmPlanes", c_ushort), ("bmBitsPixel", c_ushort), ("bmBits", c_void_p)]
class _BITMAPINFOHEADER(ctypes.Structure): _fields_ = [("biSize", c_uint32), ("biWidth", c_long), ("biHeight", c_long), ("biPlanes", c_ushort), ("biBitCount", c_ushort), ("biCompression", c_uint32), ("biSizeImage", c_uint32), ("biXPelsPerMeter", c_long), ("biYPelsPerMeter", c_long), ("biClrUsed", c_uint32), ("biClrImportant", c_uint32)]
class _BITMAPINFO(ctypes.Structure): _fields_ = [("bmiHeader", _BITMAPINFOHEADER), ("bmiColors", c_uint32 * 3)]

if os.name == "nt":
    _ole32 = ctypes.WinDLL("ole32"); _shell32i = ctypes.WinDLL("shell32"); _gdi32 = ctypes.WinDLL("gdi32")
    _shell32i.SHCreateItemFromParsingName.argtypes = [c_wchar_p, c_void_p, POINTER(_GUID), POINTER(c_void_p)]; restype = c_long
    _gdi32.GetObjectW.argtypes = [c_void_p, c_int, c_void_p]; restype c_int
    _gdi32.CreateCompatibleDC.argtypes = [c_void_p]; restype = c_void_p      # 64-bit handle: restype MUST be c_void_p
    _gdi32.GetDIBits.argtypes = [c_void_p, c_void_p, c_uint, c_uint, c_void_p, c_void_p, c_uint]; restype c_int
    _gdi32.DeleteDC.argtypes = [c_void_p]; _gdi32.DeleteObject.argtypes = [c_void_p]
_GETIMAGE = ctypes.WINFUNCTYPE(ctypes.c_long, c_void_p, _SIZE, c_int, POINTER(c_void_p))   # slot 3: HRESULT GetImage(SIZE, SIIGBF, HBITMAP*)
_RELEASE  = ctypes.WINFUNCTYPE(ctypes.c_ulong, c_void_p)                                     # slot 2

def _co_init_sta() -> None:
    if os.name == "nt": _ole32.CoInitializeEx(None, 0x2)   # COINIT_APARTMENTTHREADED: icon handlers expect STA
ICON_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="fp-shell-icon", initializer=_co_init_sta)
_icon_cache: OrderedDict[tuple, bytes] = OrderedDict(); _icon_cache_lock = threading.Lock(); _ICON_CACHE_MAX = 2048

def shell_icon_key(path: Path, is_dir: bool, px: int) -> tuple:
    norm = os.path.normcase(str(path)); ext = path.suffix.lower().lstrip(".")
    if is_dir: return ("dir", norm, px)
    if ext in PER_PATH_ICON_EXTS: return ("path", norm, px)
    return ("ext", ext, px)

def shell_image(path: Path, px: int, icon_only: bool = True) -> bytes | None:
    """px x px PNG of the shell's image for *path* (IShellItemImageFactory::GetImage, what Explorer's
    views draw), straight alpha; None on any failure or on a non-Windows OS. Call on ICON_EXECUTOR."""
    if os.name != "nt": return None
    px = max(ICON_PX_MIN, min(ICON_PX_MAX, int(px)))
    iid = _GUID()
    if _ole32.CLSIDFromString(c_wchar_p(_IID_ISHELLITEMIMAGEFACTORY), byref(iid)) != 0: return None
    ppv = c_void_p()
    if _shell32i.SHCreateItemFromParsingName(str(path), None, byref(iid), byref(ppv)) != 0 or not ppv: return None
    vtbl = ctypes.cast(ppv, POINTER(POINTER(c_void_p))).contents
    release, get_image = _RELEASE(vtbl[2]), _GETIMAGE(vtbl[3])
    hbm = c_void_p()
    try:
        flags = SIIGBF_SCALEUP | (SIIGBF_ICONONLY if icon_only else 0)
        if get_image(ppv, _SIZE(px, px), flags, byref(hbm)) != 0 or not hbm: return None
        return _hbitmap_to_png(hbm)
    finally:
        if hbm: _gdi32.DeleteObject(hbm)
        release(ppv)

def _hbitmap_to_png(hbm) -> bytes | None:
    bm = _BITMAP()
    if _gdi32.GetObjectW(hbm, ctypes.sizeof(bm), byref(bm)) == 0: return None
    w, h = bm.bmWidth, abs(bm.bmHeight)
    bmi = _BITMAPINFO(); bmi.bmiHeader.biSize = ctypes.sizeof(_BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth, bmi.bmiHeader.biHeight = w, -h        # negative = top-down rows
    bmi.bmiHeader.biPlanes, bmi.bmiHeader.biBitCount, bmi.bmiHeader.biCompression = 1, 32, 0
    buf = (ctypes.c_ubyte * (w * h * 4))()
    hdc = _gdi32.CreateCompatibleDC(None)
    try: lines = _gdi32.GetDIBits(hdc, hbm, 0, h, buf, byref(bmi), 0)
    finally: _gdi32.DeleteDC(hdc)
    if lines != h: return None
    from PIL import Image
    img = Image.frombuffer("RGBA", (w, h), bytes(buf), "raw", "BGRa", 0, 1)   # GetImage hands back PREMULTIPLIED BGRA; 'BGRa' un-premultiplies ('BGRA' would fringe edges dark)
    out = io.BytesIO(); img.save(out, "PNG"); return out.getvalue()

def shell_image_cached(key: tuple, path: Path, px: int, icon_only: bool = True) -> bytes | None:
    with _icon_cache_lock:
        hit = _icon_cache.get(key)
        if hit is not None: _icon_cache.move_to_end(key); return hit
    png = shell_image(path, px, icon_only)
    if png:
        with _icon_cache_lock:
            _icon_cache[key] = png; _icon_cache.move_to_end(key)
            while len(_icon_cache) > _ICON_CACHE_MAX: _icon_cache.popitem(last=False)
    return png
```
Notes: `HRESULT` as `c_long` (a `ctypes.HRESULT` restype raises `OSError` — keep control flow explicit). `_SIZE` by value: on x64 an 8-byte POD struct is passed in a register exactly like a `c_uint64`; if the pytest shows the struct-by-value marshalling misbehaving, replace that argtype with `c_uint64` and pass `px | (px << 32)` — bit-identical ABI. Everything runs on `ICON_EXECUTOR` (STA), never on the default `asyncio.to_thread` pool.

### 4.8 `backend/api.py` — routes

Add `Response` to `from fastapi.responses import FileResponse, JSONResponse` (`:23`), `import base64`. After `/fs/properties/details` (`:747-761`):
```python
class ShellIconItem(BaseModel):
    path: str; px: int; is_dir: bool = False
class ShellIconsRequest(BaseModel):
    items: list[ShellIconItem]

async def _shell_icon_png(resolved: Path, px: int, timeout: float) -> tuple[bytes | None, bool]:
    """(png, pending). pending=True when the executor did not answer within timeout (it keeps
    running and fills the LRU for the next request; a hung icon handler must not hold the route)."""
    key = winshell.shell_icon_key(resolved, resolved.is_dir(), px)
    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(winshell.ICON_EXECUTOR, winshell.shell_image_cached, key, resolved, px, True)
    done, _ = await asyncio.wait({fut}, timeout=timeout)
    return (fut.result() if done else None, not done)

@app.get("/shell/icon")
async def shell_icon(path: str = Query(...), px: int = Query(...)):
    """Explorer-exact shell icon for one path at exactly px x px (IShellItemImageFactory::GetImage,
    SIIGBF_ICONONLY|SCALEUP). Read-only (path_guard "read"). 400 outside 8..512, 404 for a missing
    path or when the shell has no image / did not answer within 5 s."""
    if not winshell.ICON_PX_MIN <= px <= winshell.ICON_PX_MAX: raise HTTPException(400, "px must be 8..512")
    resolved = path_guard(Path(path), "read")
    if not resolved.exists(): raise HTTPException(404, f"Not found: {path}")
    png, _pending = await _shell_icon_png(resolved, px, 5.0)
    if png is None: raise HTTPException(404, "no shell image")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})

@app.post("/shell/icons")
async def shell_icons(req: ShellIconsRequest):
    """Batch of GET /shell/icon for a viewport of rows: one HTTP round trip, deduplicated by icon key
    (per extension, per path for exe/dll/ico/lnk/url/cpl/scr and every directory). Answers in request
    order: {png: base64 | null, pending: bool}; a bad path or px is a null entry, never a batch failure."""
    if len(req.items) > 200: raise HTTPException(400, "at most 200 items")
    loop = asyncio.get_running_loop(); futs: dict[tuple, asyncio.Future] = {}; keys: list[tuple | None] = []
    for it in req.items:
        try:
            if not winshell.ICON_PX_MIN <= it.px <= winshell.ICON_PX_MAX: raise ValueError
            resolved = path_guard(Path(it.path), "read")
            if not resolved.exists(): raise ValueError
            key = winshell.shell_icon_key(resolved, it.is_dir or resolved.is_dir(), it.px)
        except Exception: keys.append(None); continue
        keys.append(key)
        if key not in futs: futs[key] = loop.run_in_executor(winshell.ICON_EXECUTOR, winshell.shell_image_cached, key, resolved, it.px, True)
    done, _ = await asyncio.wait(set(futs.values()), timeout=2.5) if futs else (set(), set())
    out = []
    for key in keys:
        fut = futs.get(key) if key else None
        if fut is None: out.append({"png": None, "pending": False}); continue
        if fut not in done: out.append({"png": None, "pending": True}); continue
        png = fut.result() if not fut.exception() else None
        out.append({"png": base64.b64encode(png).decode("ascii") if png else None, "pending": False})
    return {"items": out}
```
Both routes sit behind the existing token gate (`:78`). In `lifespan` (`:36-44`) add `winshell.ICON_EXECUTOR.shutdown(wait=False, cancel_futures=True)` after `yield`.

### 4.9 Fixture: `scripts/gen_sandbox.py`

After `:115` add `_write(out / "Projects" / "Makefile", "all:\n\t@echo fileplus\n"); files += 1` and bump `EXPECTED_FILES = 43` (`:30`; `EXPECTED_FILES_LARGE` follows). `tests/test_gen_sandbox.py` reads the constant. `_gen\Projects` then lists three folders (`a`, `app`, `web`) plus an extension-less file — the one listing that exercises folder rows, no-ext, Tier A and Tier B refusal together. (The `_gen\Many` 1,800-entry stress fixture from proposal 3 is deliberately NOT added: `_gen\Pictures` already proves 6 rows → 1 key, `_gen` proves per-path folders, and 1,800 extra files would slow every index/scan step of the smoke.)

## 5. Tests

### 5.1 pytest (runs in verify stage 2 before the smoke)

`tests/test_winshell.py` (all `@pytest.mark.skipif(os.name != "nt", …)` like `:21`):
- `test_shell_image_exact_size`: for px in (16, 20, 24, 28, 40, 48, 96, 144): `Image.open(BytesIO(shell_image(Path(r"C:\Windows"), px))).size == (px, px)`, mode RGBA, `getpixel((0,0))[3] == 0` (folder corners are transparent) and `getextrema()[3][1] == 255`.
- `test_shell_image_clamps_px`: px 4 → 8×8, px 10000 → 512×512.
- `test_shell_image_dir_differs_from_extensionless_file`: `tmp_path/"d"` (mkdir) vs `tmp_path/"Makefile"` at 16 → both bytes, not equal (the Chromium regression this replaces).
- `test_shell_image_txt_differs_from_dir` at 24.
- `test_shell_image_lnk_resolves_target` (skip if `win32com` import fails): `WScript.Shell.CreateShortcut(tmp/"np.lnk")` → `TargetPath = %SystemRoot%\notepad.exe`, save; `shell_image(lnk, 32) != shell_image(tmp/"a.txt", 32)`.
- `test_shell_image_missing_path_is_none`; `test_shell_image_forward_slashes` (`Path("C:/Windows")` → 16×16).
- `test_shell_image_on_sta_executor`: `ICON_EXECUTOR.submit(shell_image, Path(r"C:\Windows"), 16).result(timeout=10)` is PNG bytes (exercises the `CoInitializeEx` initializer path).
- `test_per_path_icon_exts_match_frontend`: regex `PER_PATH_SHELL_EXTS = new Set\(\[(.*?)\]\)` over `frontend/iconCache.js` → the same set as `winshell.PER_PATH_ICON_EXTS`.
- `test_shell_icon_key`: dir vs file same path differ; `.txt` shared; `.lnk` per path; case-insensitive.

`tests/test_api_fs.py` (`client` fixture `:11-15`, skipif not nt for the 200 cases): `GET /shell/icon?path=C:\Windows&px=24` → 200, `content-type image/png`, IHDR 24×24, `Cache-Control` present; `px=4` and `px=513` → 400; missing path → 404; relative path → 400; `POST /shell/icons` with `[C:\Windows (is_dir), sandbox a.txt, sandbox b.txt, sandbox missing.txt]` → 200, four entries in order, entries 0-2 have `png`, entries 1 and 2 are the identical string (shared `ext:txt` key), entry 3 is `{png: null, pending: false}`; 201 items → 400. `tests/test_api_auth.py`: add `/shell/icon?path=C:\Windows&px=16` to the 401-without-header case (`:38-41` pattern).

### 5.2 `frontend/test/icon-cache.spec.js`

- `LruCache`: byte budget — `new LruCache(10, 10)`, set `'a'` → `'xxxxxx'` (6), `'b'` → `'xxxxxx'` → `'a'` evicted, `bytes === 6`; an object value `{url: 'xxxx'}` charges 4; `delete` credits.
- `clampPx`: 24→24, 24.6→25, `'abc'`→16, `undefined`→16, 2→8, 10000→512.
- `normalizeWinPath`: `'C:/a/b'`→`'C:\a\b'`, `'C:\\a\\\\b'`→`'C:\a\b'`.
- `iconCacheKey`: `.exe`, `.dll`, `.ico` per path; `.lnk`, `.txt` shared (move the `:71-75` `.lnk` case to `shellIconKey`); `''` shared; keys differ by px (`:88-92` becomes px); path part case-insensitive.
- `shellIconKey`: dir vs file at the same path differ; `.lnk`/`.url` per path; `.txt` shared; px in key.
- Export shape: `require('../iconCache')` has all eight names.

### 5.3 `frontend/test/smoke.spec.js` — main run (100 % dev box)

Inside the Windows-mode block (`:224-237`), after the existing `img.fp-icon--win[src^="data:image/png"]` visibility wait at `:230`, still in `_gen\Pictures`, details view:

1. **Sharpness (all rows):** `page.evaluate` over `#list-scroll img.fp-icon--win[src^="data:image/png"]` → for every img `naturalWidth === Math.round(getBoundingClientRect().width * devicePixelRatio)`, `naturalHeight === naturalWidth`, `Number(dataset.px) === naturalWidth`, `Math.abs(rect.width - 16) < 0.01`; `count >= 6`. (Read `__fpIconStats` before the settings click and after the wait: `keys` delta `=== 1`, `requested` delta `=== 6` — the Home pane is `display:none`, so its Recent rows never intersect and cannot contribute.)
2. **Tier A byte proof:** `src` of `rowByName('IMG_0001.png') img` `=== 'data:image/png;base64,' + Buffer.from(await (await fetch(\`${API}/shell/icon?path=${encodeURIComponent(picsDir + '\\IMG_0001.png')}&px=${naturalWidth}\`, { headers: apiHeaders })).arrayBuffer()).toString('base64')`, and `page.evaluate(() => fpShellIconRoute()) === 'live'`.
3. **Folder parity (drive-glyph regression guard):** `loadDirectory(\`${root}\\_gen\`)`; wait `rowByName('Pictures').locator('img.fp-icon--win[src^="data:image/png"]')` visible; its `src` equals the route bytes for `${root}\_gen\Pictures` at its `naturalWidth`, and differs from the route bytes for `${root}\_gen\Documents\doc-00.txt` at the same px.
4. **Extension-less + Tier B refusal:** `loadDirectory(\`${root}\\_gen\\Projects\`)`; `rowByName('Makefile')` shows `img.fp-icon--win[src^="data:image/png"]` (Tier A: the shell's generic page). Then `page.evaluate(() => fpShellIconRoute('absent'))`, `loadDirectory(\`${root}\\_gen\\Music\`)` (four `.wav` rows — an extension not yet cached): every row `img.fp-icon--win[src^="data:image/png"]` has `naturalWidth === Math.round(16 * devicePixelRatio)` and `dataset.exact === '1'` (Tier B small rep, exact at 100 %), `__fpIconStats.tierB` delta `=== 1` (one key); `loadDirectory(Projects)` again after `page.evaluate(() => refreshIconSurfaces())` hmm — simpler: with the route still `absent`, `loadDirectory(\`${root}\\_gen\\Projects\`)` does not re-request the cached Makefile key; so instead assert Tier B refusal on a fresh no-ext file: `postJson('/fs/create', …)` is not needed — use `page.evaluate(() => _fpWinIconCache… )` no. Do this: flip to `absent` BEFORE first visiting Projects: order = (a) `_gen\Music` under Tier A (wav rows Tier A), (b) `fpShellIconRoute('absent')`, (c) `loadDirectory(Projects)`: `rowByName('Makefile')` resolves to `use[href="#fp-ft-generic"]` and each folder row (`a`, `app`, `web`) to `use[href="#fp-ft-folder"]` (Tier B refuses dirs and no-ext), while `loadDirectory(\`${root}\\_gen\\Projects\\app\`)` gives `.py` rows `img.fp-icon--win` with `naturalWidth === Math.round(16 * devicePixelRatio)`; (d) `fpShellIconRoute('unknown')`, `loadDirectory(Projects)` again → `rowByName('Makefile') img.fp-icon--win[src^="data:image/png"]` and the folder rows `img.fp-icon--win[src^="data:image/png"]` (Tier A back; keys for Makefile/dirs were never cached because Tier B refusal under a transient route state is `cache:false` — NOTE for the implementer: `refused` items must use `cache: !r.transient`, and `fpShellIconRoute('absent')` set by the test is NOT transient; so in (c) the refusals DO cache. Therefore step (d) must re-render: call `page.evaluate(() => { fpShellIconRoute('unknown'); _fpWinIconCache… })` — keep it simple: expose `fpShellIconRoute(state)` such that setting a state also clears `_fpWinIconCache` entries whose value is `null` (a one-liner: iterate and delete null values). Document that in icons.js: "a route-state change invalidates every cached 'no icon' so the other tier gets its turn".)
5. **Grid thumbnails (extend `:213-216`):** for every `#list-scroll img.fp-thumb--ready`: `Math.max(naturalWidth, naturalHeight) === Math.round(Math.max(parentRect.width, parentRect.height) * devicePixelRatio)`, `Number(dataset.px) === that`, and the img's rendered rect fits inside its parent rect (+0.5 px).
6. **List-scale re-request** (Windows mode, details, `_gen\Pictures`): `page.evaluate(() => setListScale(1.5, { persist: false }))` → `waitForFunction`: every `img.fp-icon--win[src^="data:image/png"]` has `naturalWidth === Math.round(24 * devicePixelRatio)` and `Math.abs(rect.width - 24) < 0.01`; then `setListScale(1, { persist: false })` → back to `round(16 * dpr)`. (Requires the cascade fix §4.6.)
7. **Zoom round trip** (last thing in the block, no screenshot in between): `page.evaluate(() => zoomIn())` → `waitForFunction(() => devicePixelRatio > 1)` → `waitForFunction` every png row `naturalWidth === Math.round(16 * devicePixelRatio)` (18 at 1.1; `dataset.exact === ''` — a resample) → `page.evaluate(() => zoomReset())` → `waitForFunction` back to `16` with `dataset.exact === '1'`. Proves the `matchMedia(resolution)` watcher replaces the bitmap rather than letting Chromium resample it.
8. **Properties "Opens with"** (inside the properties-file block after `:915`): `await expect(propsModal.locator('#properties-opens-with-icon img')).toHaveCount(1)` then `naturalWidth === Math.round(16 * devicePixelRatio)`.
9. **Existing gates stay:** zero console errors (`:55-66`), `img.fp-icon--win` count 0 after switching back (`:237`), sprite `use[]` count > 0 (`:238`), decoy Desktop identity (`:243-256`), `browser-grid.png`.

### 5.4 Second Electron launch: `test('shell bitmaps are device-pixel exact at 150%')` (screenshot-free)

Launch exactly like `:38-46` plus `args: [FRONTEND, '--force-device-scale-factor=1.5']` (verified to reach `devicePixelRatio`). `expect(await page.evaluate(() => devicePixelRatio)).toBe(1.5)`. Switch Settings › File icons to windows; `loadDirectory(\`${root}\\_gen\\Documents\`)`:
- every png row: `naturalWidth === 24`, `rect.width === 16`, `dataset.exact === '1'`; the first row's `src` equals the route bytes at `px=24` (Tier A proof — NOT "24 px proves the backend": Tier B also yields 24 here via 32→24).
- `fpShellIconRoute('absent')`; `loadDirectory(\`${root}\\_gen\\Music\`)`: `.wav` rows `naturalWidth === 24`, `rect.width === 16`, `dataset.exact === ''` (on this 100 % OS the small rep is 16 < 24, so Tier B takes `large` 32 and resamples to 24 — exercises the IHDR/DIP math and the resample branch independently of the backend); `loadDirectory(Projects)`: `Makefile` → `use[href="#fp-ft-generic"]`.
- `fpShellIconRoute('unknown')`; `loadDirectory(\`${root}\\_gen\\Pictures\`)`; `setViewMode('grid')`: first `img.fp-thumb--ready` long edge `=== Math.round(parentRect.width * 1.5)` (144 at scale 1).
- `finally`: `fetch(\`${API}/config/ui.icon_source\`, { method: 'DELETE', headers: apiHeaders })` (route at `api.py:1189`, pattern `smoke.spec.js:581`) — the setting is persisted and shared with the first launch — then `app.close()`.

Optional cheaper variant to try first: `app.context().newCDPSession(page)` + `Emulation.setDeviceMetricsOverride({deviceScaleFactor: 1.5, width: 0, height: 0, mobile: false})` inside the main run; keep the second launch if that does not move `devicePixelRatio` (unverified under Playwright-Electron).

## 6. In-flight caps and timeouts (summary)

| Stage | Cap |
|---|---|
| Renderer icon batch | one `POST /shell/icons` per macrotask, ≤ 200 unique keys per POST, ≤ 2 POSTs in flight (later flushes wait); Tier B `fileIcons` ≤ 64 per invoke |
| Backend | `ICON_EXECUTOR` 2 STA threads; batch `asyncio.wait` 2.5 s (finished items returned, rest `pending`), single route 5 s; LRU 2048 |
| Main process | `iconQueue` 8 concurrent `getFileIcon`, `thumbQueue` 4 concurrent `createThumbnailFromPath`, both dedupe by key |
| Renderer thumbs | `_fpThumbInFlight` dedupe by key; IO `rootMargin: 200px` unchanged |

## 7. Docs

- `docs/backend-integration.md:359-366`: Windows-mode icons come from `POST /shell/icons` / `GET /shell/icon` (IShellItemImageFactory at physical px); `electronAPI.fileIcons` is the offline fallback (exact only at 16·S / 32·S / exe 16/32/48; never for folders, no-ext, lnk, url); thumbnails from `electronAPI.thumbnail` at physical px. Add both routes to the ledger.
- `docs/superpowers/specs/2026-09-12-stage-2c-playtest-pass-1-design.md:188-189`: mark the "cached by extension (by full path for .exe .lnk .url .ico .cpl)" sentence superseded and point at this design.
- `CLAUDE.md:55` module-order bullet: `frontend/iconCache.js` (dual-mode) loads between `icons-sprite.js` and `icons.js`.
- Run doc `docs/superpowers/runs/<date>-stage-2c-pass-2.md`: the measured facts table, the behaviour changes (folders/no-ext/lnk under Tier B → sprite; failed thumbnails in FilePlus mode → sprite; row icons follow `--list-scale`), and the note that the author's live backend on 9876 must be restarted to gain the route (until then the renderer marks it `absent` and Tier B carries Windows mode).

## 8. What stays imperfect (honest list)

- **Overlays are not drawn.** `GetImage` never composites the shortcut arrow or OneDrive/sync/state badges; Explorer adds them from the system image list. Follow-up: `SHGetFileInfo(..., SHGFI_ICON|SHGFI_ADDOVERLAYS|SHGFI_SMALLICON)` once the backend process is made DPI-aware (`SetProcessDpiAwarenessContext(-4)` at startup so `SM_CXSMICON` is 16·S), or `IImageList::GetOverlayImage` composited at px.
- **Per-monitor DPR.** `devicePixelRatio` follows the monitor the window is on; the `matchMedia(resolution)` watcher re-requests after a move, but Tier B's `small`/`large` reps follow the Windows SYSTEM scale (`SHGetFileInfo`), so on a secondary monitor with a different scale Tier B is a resample (Tier A is exact everywhere). During the transition rows show the previous bitmap scaled until the new one lands (kept on purpose: no blank flash).
- **Tier B exactness envelope:** exact only at px ∈ {16·S, 32·S} (16/32/48 for exe/dll/ico). Zoom ≠ 1, list-scale ∉ {1, 2}, 40-px inspector, 24-px Properties header, 56-111 px tile icons are single Lanczos resamples (upscales for tiles) under Tier B. Under Tier B folders, extension-less files, `.lnk`, `.url` are FilePlus sprites — an honest, visible difference from Explorer until the backend answers.
- **Tier A risks that only the pytest can retire:** the raw vtable call (`SIZE` by value, slot 3, HRESULT as `c_long`), premultiplied `BGRa` decoding, and the STA initializer are unvalidated on this machine. Icon handlers run in-process in the backend: a misbehaving third-party handler can hang a worker (route times out; the thread is not cancellable) or, worst case, crash the backend process — `SIIGBF_ICONONLY` keeps thumbnail providers out of that path. A `.lnk` to a dead network target can hold one of the two STA threads until the redirector gives up.
- **First-paint latency under Tier A:** a cold batch of 200 per-path folders costs a few hundred ms; a hung handler holds that batch 2.5 s (finished items still return; pending ones are painted by Tier B for that scroll and re-requested later). The "race Tier A against a 1 s timer and swap later" refinement was considered and left out: it needs per-element repaint after resolution and the measured normal case is single-digit ms.
- **Explorer's Details view shows 16·S picture thumbnails** when "Always show icons" is off; spec §6.1 keeps type icons in Windows-mode rows (`browser.js:651-655`). One-line change if wanted.
- **Non-integral device boxes** (58 % tile icon, odd zoom×scale products) get a JS inline size of px/dpr — a ≤ 0.5 css px layout nudge Explorer never needs because it lays out in physical pixels. DPR 1.75 compositing was not measured (the capture failed to load); the mechanism is identical.
- **Home Recent rows** treat `ext === ''` as a folder (`home.js:73`), so an extension-less file in Recent gets the folder icon under Tier A — pre-existing, out of scope.
- **Renderer memory:** px-in-key multiplies entries across zoom/scale steps; the byte budgets (8 MiB icons / 32 MiB thumbnails per process) are the bound, and they count string length, not heap.
- `image-rendering: pixelated` is intentionally absent everywhere; if a future reviewer wants it, the `out/dpr2-*.json` C/D cases show it changes nothing at 1:1.
