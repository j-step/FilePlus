// frontend/test/stage2d-zoom.spec.js
// Stage 2D Task 6 (spec §5, decision D2D-1): app zoom (Ctrl+= / Ctrl+- /
// Ctrl+0). The sidebar, the inspector and the collapsed rail keep their
// SCREEN width while everything inside them grows; each zoom step eases in
// over ~70 ms (or is instant under reduced motion, or after the 32 ms frame
// fallback); the zoom pill shows the percentage and fades 1.2 s after the
// last change; the resize handles store screen px and both panel widths
// survive a restart (pass-2 #176); the inspector's resize handle is gone
// while the inspector is closed (pass-2 #57).
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, apiGet, API, apiHeaders, SHOTS } = require('./harness/app');

test.setTimeout(240_000);

const NAMED = [
  ['content', 'content', null], ['tiles', 'tiles', null], ['details', 'details', null], ['list', 'list', null],
  ['small', 'small', null], ['medium', 'icons', 48], ['large', 'icons', 96], ['xl', 'icons', 256],
];

/** A key press delivered the way the OS delivers it (no application menu
 * exists to turn it into an accelerator — Stage 2D §7.1). */
async function nativeKey(app, keyCode, modifiers = []) {
  await app.evaluate(({ BrowserWindow }, a) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: a.keyCode, modifiers: a.modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers });
  }, { keyCode, modifiers });
}

const twoFrames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Every native input event sent before this call has been handled by the
 * page: a sentinel key the app ignores (F24) is sent the same native way, and
 * input is delivered in order (as stage2d-refresh.spec.js's settleKeys). */
async function inputSettled(app, page) {
  const n = await page.evaluate(() => {
    if (window.__fpSentinelKeys === undefined) {
      window.__fpSentinelKeys = 0;
      document.addEventListener('keydown', (e) => { if (e.key === 'F24') window.__fpSentinelKeys++; }, true);
    }
    return window.__fpSentinelKeys;
  });
  await nativeKey(app, 'F24');
  await page.waitForFunction((k) => window.__fpSentinelKeys > k, n);
}

/** Waits until the page zoom AND the published --app-zoom are both `z`, and
 * no eased step is still running. Once settled the renderer's factor is the
 * main process's EXACTLY (the Ctrl+wheel ladder multiplies deltas by it, and
 * a float-noise 0.99999994 left one notch short of a step). */
async function settled(page, z) {
  await page.waitForFunction((f) => Math.abs(window.electronAPI.getZoom() - f) < 0.001
    && Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) - f) < 0.001
    && !window.__fpZoomBusy && appZoom.current === window.electronAPI.getZoom(), z);
  await twoFrames(page);
}

async function setZoom(app, page, z) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
  await settled(page, z);
}

/** Width on screen (device-independent px): CSS px × the real page zoom. */
const screenW = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el.getBoundingClientRect().width * window.electronAPI.getZoom();
}, sel);

/** Same capture as stage2d-views.spec.js: the whole window as the user sees
 * it, Mica off so its transparent regions don't save as white. */
async function windowShot(app, page, name) {
  const mica = await page.evaluate(async () => {
    const was = document.documentElement.dataset.mica || null;
    delete document.documentElement.dataset.mica;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return was;
  });
  try {
    const b64 = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'));
  } finally {
    await page.evaluate((m) => { if (m) document.documentElement.dataset.mica = m; }, mica);
  }
}

async function open(page, dir, minRows = 1) {
  await page.evaluate((p) => openBrowserAt(p), dir);
  await page.waitForFunction((n) => document.querySelectorAll('#list-scroll > .fp-row').length >= n
    && window.__fpLoadPending === 0, minRows);
}

async function delConfig(key) {
  await fetch(`${API}/config/${encodeURIComponent(key)}`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
}

async function resetZoom(app) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
}

/** Text that clips in the toolbar, the tab strip, the sidebar and the
 * inspector's action row (a fixed-width panel whose buttons grow): wider or
 * taller than its box without an ellipsis. */
const chromeClips = (page) => page.evaluate(() => {
  const out = [];
  for (const root of document.querySelectorAll('.fp-toolbar, .fp-tabbar, #sidebar, .inspector__actions')) {
    for (const el of root.querySelectorAll('*')) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.fontSize === '0px') continue;
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') {
        out.push(`h-clip ${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`);
      }
      if (el.scrollHeight > el.clientHeight + 1 && cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') {
        out.push(`v-clip ${el.className || el.tagName} "${el.textContent.trim().slice(0, 30)}" ${el.scrollHeight}>${el.clientHeight}`);
      }
      // A button label broken over two lines reads as broken even unclipped.
      if (el.closest('button, [role="button"]')) {
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`wrapped ${el.className || el.tagName} "${n.textContent.trim().slice(0, 30)}"`);
        }
      }
    }
  }
  return out;
});

test('zoom keys step the app zoom; sidebar, inspector and rail keep their screen width while their contents grow', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setZoom(app, page, 1);
    await page.evaluate(() => { setSidebarCollapsed(false); setInspectorOpen(true, { persist: false }); });
    await twoFrames(page);
    const label = '#sidebar .fp-sidebar__item__label';
    const fontScreen = () => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)
      * window.electronAPI.getZoom(), label);
    const sw0 = await screenW(page, '#sidebar');
    const iw0 = await screenW(page, '#inspector');
    const lw0 = await screenW(page, '#list-pane');
    const f0 = await fontScreen();

    // Renderer keys: three steps up from 100% are the main process's own steps.
    const steps = await page.evaluate(() => window.electronAPI.zoomSteps());
    expect(steps).toEqual([0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.33, 1.5, 1.75, 2.0]);
    // When the pill was last told about a change (for the fade check below).
    await page.evaluate(() => {
      const orig = window.updateZoomPill;
      window.updateZoomPill = function (...a) { window.__fpPillAt = performance.now(); return orig.apply(this, a); };
    });
    for (const want of [1.1, 1.2, 1.33]) {
      await page.keyboard.press('Control+=');
      await settled(page, want);
      expect(Math.abs((await screenW(page, '#sidebar')) - sw0), `sidebar @${want}`).toBeLessThanOrEqual(1);
      expect(Math.abs((await screenW(page, '#inspector')) - iw0), `inspector @${want}`).toBeLessThanOrEqual(1);
      expect(Math.abs((await screenW(page, '#list-pane')) - lw0), `file area @${want}`).toBeLessThanOrEqual(2);
    }
    expect(await fontScreen()).toBeGreaterThan(f0 * 1.3);

    // The pill shows the percentage at once and fades 1.2 s after the last change.
    const pill = () => page.evaluate(() => {
      const p = document.getElementById('status-zoom-pill');
      return { text: p.textContent, shown: !!p.getClientRects().length, opacity: getComputedStyle(p).opacity };
    });
    expect(await pill()).toEqual({ text: '133%', shown: true, opacity: '1' });
    // It fades, and not before 1.2 s after the last change — measured from
    // that change, so a slow machine can only make it look later.
    await page.waitForFunction(() => getComputedStyle(document.getElementById('status-zoom-pill')).opacity === '0',
      null, { timeout: 5000 });
    expect(await page.evaluate(() => performance.now() - window.__fpPillAt)).toBeGreaterThanOrEqual(1150);

    // Native keys (sendInputEvent): every zoom shortcut, numpad included,
    // reaches the renderer's handler; the ladder clamps at 200%.
    const native = [
      ['=', ['control'], 1.5], ['=', ['control', 'shift'], 1.75], ['numadd', ['control'], 2.0],
      ['numadd', ['control'], 2.0], ['-', ['control'], 1.75], ['numsub', ['control'], 1.5],
    ];
    for (const [key, mods, want] of native) {
      await nativeKey(app, key, mods);
      await settled(page, want);
      expect(Math.abs((await screenW(page, '#sidebar')) - sw0), `sidebar @${want}`).toBeLessThanOrEqual(1);
      expect(Math.abs((await screenW(page, '#inspector')) - iw0), `inspector @${want}`).toBeLessThanOrEqual(1);
    }
    expect((await pill()).text).toBe('150%');
    await windowShot(app, page, 'zoom-150-browser');

    // The collapsed rail: 52 screen px at 150% and 200%, and nothing in it
    // sticks out past its edge.
    await page.evaluate(() => setSidebarCollapsed(true));
    for (const z of [1.5, 2]) {
      await setZoom(app, page, z);
      expect(Math.abs((await screenW(page, '#sidebar')) - 52), `rail @${z}`).toBeLessThanOrEqual(1);
      const wide = await page.evaluate(() => {
        const sb = document.getElementById('sidebar').getBoundingClientRect();
        // (The resize handle straddles the edge on purpose.)
        return [...document.querySelectorAll('#sidebar *:not(#sidebar-resize-handle)')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.left < sb.left - 0.5 || r.right > sb.right + 0.5);
        }).map((el) => `${el.className || el.tagName}`);
      });
      expect(wide, `rail @${z}`).toEqual([]);
      if (z === 1.5) await windowShot(app, page, 'zoom-150-rail');
    }
    await page.evaluate(() => setSidebarCollapsed(false));

    await nativeKey(app, '0', ['control']);
    await settled(page, 1);
    expect(Math.abs((await screenW(page, '#sidebar')) - sw0)).toBeLessThanOrEqual(1);
  } finally {
    await page.evaluate(() => setSidebarCollapsed(false)).catch(() => {});
    await resetZoom(app);
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('inspector open: no view squeezes or clips a name at 125% and 150%; toolbar, tab and sidebar text never clips at any step', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\Views`, 20);
    const steps = await page.evaluate(() => window.electronAPI.zoomSteps());
    const offenders = [];
    let checked = 0;
    let chromeChecks = 0;
    // Every zoom step of the ladder (plus 125%, the views sweep's in-between
    // point); the chrome is checked with the inspector closed AND open.
    for (const z of [...new Set([...steps, 1.25])].sort((a, b) => a - b)) {
      await setZoom(app, page, z);
      expect(await page.evaluate(() => document.querySelectorAll('#list-scroll > .fp-row').length)).toBeGreaterThanOrEqual(20);
      for (const inspectorOpen of [false, true]) {
        await page.evaluate((o) => setInspectorOpen(o, { persist: false }), inspectorOpen);
        await twoFrames(page);
        offenders.push(...(await chromeClips(page)).map((b) => `chrome@${z} inspector ${inspectorOpen ? 'open' : 'closed'}: ${b}`));
        chromeChecks += 1;
      }
      if (z !== 1.25 && z !== 1.5) continue;
      for (const [label, view, size] of NAMED) {
        await page.evaluate(([v, s]) => setView(v, s, { manual: false }), [view, size]);
        await twoFrames(page);
        const bad = await page.evaluate(() => {
          const out = [];
          for (const row of document.querySelectorAll('#list-scroll > .fp-row')) {
            if (row.scrollHeight > row.clientHeight + 1) out.push(`row ${row.dataset.path} ${row.scrollHeight}>${row.clientHeight}`);
            for (const nm of row.querySelectorAll('.fp-row__name, .fp-row__line, .fp-row__meta')) {
              const cs = getComputedStyle(nm);
              nm.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
              const titled = !!nm.getAttribute('title');
              if (nm.scrollWidth > nm.clientWidth + 1 && !(cs.textOverflow === 'ellipsis' && titled)) out.push(`h-clip "${nm.textContent}"`);
              if (nm.scrollHeight > nm.clientHeight + 1 && !(cs.webkitLineClamp !== 'none' && titled)) out.push(`v-clip "${nm.textContent}"`);
              if (nm.classList.contains('fp-row__name') && nm.clientWidth < Math.min(nm.scrollWidth, 48)) out.push(`squeezed "${nm.textContent}" ${nm.clientWidth}px`);
            }
          }
          return out;
        });
        offenders.push(...bad.map((b) => `${label}@${z}: ${b}`));
        checked += 1;
      }
      await windowShot(app, page, `zoom-${Math.round(z * 100)}-inspector-open`);
    }
    expect(offenders).toEqual([]);
    expect(checked).toBe(NAMED.length * 2);
    expect(chromeChecks).toBe((steps.length + 1) * 2);
  } finally {
    await resetZoom(app);
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('resize handles store screen px; both panel widths survive a restart; the inspector handle is gone while it is closed (#57)', async () => {
  let { app, page, errors } = await launchApp();
  const allErrors = [];
  try {
    await page.evaluate(() => { setSidebarCollapsed(false); setInspectorOpen(true, { persist: false }); });
    await setZoom(app, page, 1.5);

    // Inspector: drag its handle 40 CSS px left = 60 screen px wider.
    const iw0 = await screenW(page, '#inspector');
    const h = await page.locator('#resizer').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 - 20, h.y + h.height / 2, { steps: 4 });
    await page.mouse.move(h.x + h.width / 2 - 40, h.y + h.height / 2, { steps: 4 });
    await page.mouse.up();
    const iw1 = await screenW(page, '#inspector');
    expect(Math.abs(iw1 - (iw0 + 60))).toBeLessThanOrEqual(1.5);
    await expect.poll(async () => (await apiGet('/config'))['ui.inspector_w']).toBe(Math.round(iw1));

    // Sidebar: the pointer at CSS x 200 is screen x 300 → a 300 screen-px panel.
    // The panel itself never scrolls (spec §9.3) and its overlay scrollbar
    // sits under the handle, so the handle's inner half is grabbable as is.
    const sh = await page.locator('#sidebar-resize-handle').boundingBox();
    await page.mouse.move(sh.x + 1.5, sh.y + 200);
    await page.mouse.down();
    await page.mouse.move(180, sh.y + 200, { steps: 4 });
    await page.mouse.move(200, sh.y + 200, { steps: 4 });
    await page.mouse.up();
    expect(Math.abs((await screenW(page, '#sidebar')) - 300)).toBeLessThanOrEqual(1);
    await expect.poll(async () => (await apiGet('/config'))['ui.sidebar_w']).toBe(300);

    await app.close();
    allErrors.push(...errors);   // after close: renderer.log errors are collected then
    ({ app, page, errors } = await launchApp({ keepZoom: true }));
    // Electron restores the page zoom; the renderer publishes it at startup.
    await settled(page, 1.5);
    await page.waitForFunction(() => document.getElementById('inspector').classList.contains('inspector--open'));
    expect(Math.abs((await screenW(page, '#inspector')) - iw1)).toBeLessThanOrEqual(1);
    expect(Math.abs((await screenW(page, '#sidebar')) - 300)).toBeLessThanOrEqual(1);

    // #57: a closed inspector leaves no handle to see or grab at the edge.
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await expect(page.locator('#resizer')).toBeHidden();
    const atEdge = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth - 2, window.innerHeight / 2);
      return el ? (el.closest('#resizer') ? 'resizer' : 'other') : 'none';
    });
    expect(atEdge).not.toBe('resizer');
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await expect(page.locator('#resizer')).toBeVisible();
  } finally {
    await delConfig('ui.inspector_w');
    await delConfig('ui.sidebar_w');
    await page.evaluate(() => localStorage.removeItem('fp-sidebar-width')).catch(() => {});
    await resetZoom(app);
    await app.close();
  }
  allErrors.push(...errors);
  expect(allErrors).toEqual([]);
});

test('each zoom step eases in (or records the instant fallback) and the panels hold their screen width on every frame', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setZoom(app, page, 1);
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Per-frame sampler: the zoom the renderer has APPLIED (devicePixelRatio
    // over the display scale) and each panel's width at that zoom.
    await page.evaluate(() => {
      const scale = window.devicePixelRatio / window.electronAPI.getZoom();
      window.__zs = [];
      const tick = () => {
        const z = window.devicePixelRatio / scale;
        window.__zs.push({ z, sb: document.getElementById('sidebar').getBoundingClientRect().width * z,
          ins: document.getElementById('inspector').getBoundingClientRect().width * z });
        if (window.__zsOn) requestAnimationFrame(tick);
      };
      window.__zsOn = true;
      requestAnimationFrame(tick);
    });
    const sw0 = await screenW(page, '#sidebar');
    const iw0 = await screenW(page, '#inspector');
    await page.keyboard.press('Control+=');
    await settled(page, 1.1);
    await page.keyboard.press('Control+=');
    await settled(page, 1.2);
    const r = await page.evaluate(() => { window.__zsOn = false; return { mode: window.__fpZoomEase, frames: window.__fpZoomFrames, samples: window.__zs }; });
    console.log(`zoom ease mode: ${r.mode}; frame times (ms) of the first two eased steps: ${JSON.stringify(r.frames)}`);
    expect(['eased', 'instant']).toContain(r.mode);
    expect(r.frames.length).toBe(2);
    const between = r.samples.filter((s) => (s.z > 1.001 && s.z < 1.099) || (s.z > 1.101 && s.z < 1.199));
    if (r.mode === 'eased') {
      expect(r.frames.flat().every((ms) => ms <= 32)).toBe(true);
      expect(between.length).toBeGreaterThanOrEqual(2);      // it really interpolated
    } else {
      expect(r.frames.flat().some((ms) => ms > 32)).toBe(true);
    }
    for (const s of r.samples) {
      expect(Math.abs(s.sb - sw0), `sidebar at z=${s.z}`).toBeLessThanOrEqual(1);
      expect(Math.abs(s.ins - iw0), `inspector at z=${s.z}`).toBeLessThanOrEqual(1);
    }

    // A burst of key repeats lands exactly three steps on, never in between.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+=');
    await settled(page, 1.75);

    // Reduced motion: straight to the step, no frame in between.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { window.__zs = []; window.__zsOn = true;
      const scale = window.devicePixelRatio / window.electronAPI.getZoom();
      const tick = () => { window.__zs.push(window.devicePixelRatio / scale); if (window.__zsOn) requestAnimationFrame(tick); };
      requestAnimationFrame(tick); });
    await page.keyboard.press('Control+-');
    await settled(page, 1.5);
    const zs = await page.evaluate(() => { window.__zsOn = false; return window.__zs; });
    expect(zs.filter((z) => z > 1.501 && z < 1.749)).toEqual([]);
    expect(await page.evaluate(() => window.__fpZoomEase)).toBe('instant');
  } finally {
    await resetZoom(app);
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('one Ctrl+wheel notch is exactly one ladder step at every app zoom; resizes cost no zoom IPC; a stale display scale cannot bend a step', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await open(page, `${root}\\Views`, 20);
    await page.evaluate(() => setView('details', null, { manual: false }));
    // A real notch, delivered by the OS path: Chromium reports it as 100
    // screen units, i.e. 100 / zoom CSS px (90.909… at 110%, 66.666… at 150%).
    const notch = async (z) => {
      const b = await page.locator('#list-scroll').boundingBox();
      await app.evaluate(({ BrowserWindow }, a) => {
        BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'mouseWheel', x: a.x, y: a.y,
          deltaX: 0, deltaY: 100, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
      }, { x: Math.round((b.x + b.width / 2) * z), y: Math.round((b.y + b.height / 2) * z) });
    };
    for (const z of [1.1, 1.5, 1.75]) {
      await setZoom(app, page, z);
      const before = await page.evaluate(() => currentViewStep());
      await notch(z);
      await expect.poll(() => page.evaluate(() => currentViewStep()), { message: `notch @${z}` }).toBe(before + 1);
      // Native input is handled in order: once a sentinel key sent after the
      // notch has reached the page, everything the notch produced has too.
      await inputSettled(app, page);
      expect(await page.evaluate(() => currentViewStep()), `notch @${z} stepped once`).toBe(before + 1);
      await page.evaluate(() => setView('details', null, { manual: false }));
    }

    // Window resizes (no zoom change) ask the main process nothing.
    await app.evaluate(({ ipcMain }) => {
      globalThis.__fpZoomGets = 0;
      ipcMain.on('win-zoom-get', () => { globalThis.__fpZoomGets += 1; });
    });
    for (const [w, h] of [[1100, 760], [1000, 700], [1200, 800]]) {
      await app.evaluate(({ BrowserWindow }, a) => BrowserWindow.getAllWindows()[0].setSize(a.w, a.h), { w, h });
      // The renderer has the new size and its resize handlers have run.
      // (appZoom.current, not electronAPI.getZoom(): that IS the IPC counted.)
      await page.waitForFunction((cw) => Math.abs(window.innerWidth * appZoom.current - cw) <= 2, w, { timeout: 5000 });
      await twoFrames(page);
    }
    expect(await app.evaluate(() => globalThis.__fpZoomGets)).toBe(0);

    // The display scale moved under us (a monitor DPI change that reached
    // nothing here): the next step re-reads it before it starts, so every
    // eased frame still publishes the zoom the page really applied.
    await setZoom(app, page, 1);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const sw0 = await screenW(page, '#sidebar');
    const base = await page.evaluate(() => window.devicePixelRatio);
    await page.evaluate(() => {
      appZoom.scale *= 1.25;
      window.__zs = [];
      window.__zsOn = true;
      const tick = () => {
        const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom'));
        window.__zs.push({ z, dpr: window.devicePixelRatio, sb: document.getElementById('sidebar').getBoundingClientRect().width });
        if (window.__zsOn) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press('Control+=');
    await settled(page, 1.1);
    const samples = await page.evaluate(() => { window.__zsOn = false; return window.__zs; });
    expect(samples.length).toBeGreaterThan(2);
    for (const s of samples) {
      const applied = s.dpr / base;
      expect(Math.abs(s.z - applied), `--app-zoom vs applied zoom ${applied}`).toBeLessThan(0.001);
      expect(Math.abs(s.sb * applied - sw0), `sidebar at ${applied}`).toBeLessThanOrEqual(1);
    }
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800)).catch(() => {});
    await resetZoom(app);
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('the 32 ms fallback ignores the session\'s warm-up frame and nothing else', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const v = await page.evaluate(() => ({
      warmupSpike: zoomFramesTooSlow([8, 120, 8, 8], true),
      firstFrameSpike: zoomFramesTooSlow([120, 8, 8, 8], true),
      laterSpikeFirstStep: zoomFramesTooSlow([8, 8, 40, 8], true),
      spikeSecondStep: zoomFramesTooSlow([120, 8, 8], false),
      smooth: zoomFramesTooSlow([8, 8, 8, 8], false),
    }));
    expect(v).toEqual({ warmupSpike: false, firstFrameSpike: false, laterSpikeFirstStep: true, spikeSecondStep: true, smooth: false });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
