// frontend/test/stage2d-fixwave.spec.js
// Stage 2D addendum, Task 8 — the final fix wave (final review minors R1–R3
// and the QA visual findings Q2–Q17). One test (or more) per item.
const { test, expect } = require('@playwright/test');
const { launchApp, waitReady, apiGet, API, apiHeaders, shot, rowByName } = require('./harness/app');

test.setTimeout(180_000);

async function setConfig(key, value) {
  const r = await fetch(`${API}/config`, {
    method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key, value }),
  });
  if (!r.ok) throw new Error(`POST /config ${key} -> ${r.status}`);
}

async function delConfig(key) {
  await fetch(`${API}/config/${encodeURIComponent(key)}`, { method: 'DELETE', headers: apiHeaders() });
}

async function setWindow(app, page, width, height = 800) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
  }, [width, height]);
  await page.waitForFunction((w) => window.innerWidth === w, width);
}

async function setZoom(app, page, factor) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), factor);
  await page.waitForFunction((f) => typeof appZoom !== 'undefined' && Math.abs(appZoom.current - f) < 0.001
    && !window.__fpZoomBusy, factor, { timeout: 5000 });
}

/** Two animation frames: layout, ResizeObservers and rAF work have run. */
const frames = (page, n = 2) => page.evaluate((k) => new Promise((resolve) => {
  const step = (i) => (i ? requestAnimationFrame(() => step(i - 1)) : resolve());
  step(k);
}), n);

// ── R1: an element's blur does not end a key hold ────────────────────────────
test('R1: a held arrow moving focus keeps html.fp-key-repeat; only the window losing focus or keyup clears it', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const r = await page.evaluate(() => {
      const html = document.documentElement;
      const btn = document.getElementById('btn-new-tab');
      btn.focus();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: true, bubbles: true }));
      const set = html.classList.contains('fp-key-repeat');
      // Focus moves to the next row at a held step: the old element blurs.
      btn.dispatchEvent(new FocusEvent('blur'));
      btn.blur();
      const afterElementBlur = html.classList.contains('fp-key-repeat');
      window.dispatchEvent(new FocusEvent('blur'));
      const afterWindowBlur = html.classList.contains('fp-key-repeat');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: true, bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      const afterKeyup = html.classList.contains('fp-key-repeat');
      return { set, afterElementBlur, afterWindowBlur, afterKeyup };
    });
    expect(r).toEqual({ set: true, afterElementBlur: true, afterWindowBlur: false, afterKeyup: false });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── R2: launch restores saved state without animating it ────────────────────
test('R2: with motion on and a saved collapsed sidebar + light theme, nothing animates during boot', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await page.evaluate(() => {
      localStorage.setItem('fp-sidebar-collapsed', 'on');
      localStorage.setItem('fp-theme', 'light');
    });
    await setConfig('ui.theme', 'light');
    // Sample every frame from the very first script on the reloaded page.
    await page.addInitScript(() => {
      window.__bootSeen = [];
      const tick = () => {
        const html = document.documentElement;
        const anims = document.getAnimations().map((a) => a.animationName || a.transitionProperty || 'waapi');
        window.__bootSeen.push({ booting: html.classList.contains('fp-booting'), motion: html.dataset.motion || '', anims });
        if (!window.__bootStop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.addEventListener('DOMContentLoaded', tick);
    });
    await page.reload();
    await waitReady(page);
    await frames(page, 3);
    const seen = await page.evaluate(() => { window.__bootStop = true; return window.__bootSeen; });
    const state = await page.evaluate(() => ({
      collapsed: document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed'),
      theme: document.documentElement.dataset.theme,
      booting: document.documentElement.classList.contains('fp-booting'),
      motion: document.documentElement.dataset.motion,
    }));
    expect(state).toEqual({ collapsed: true, theme: 'light', booting: false, motion: 'on' });
    // Every frame until fp-booting was lifted ran no animation at all.
    const firstLive = seen.findIndex((s) => s.motion === 'on' && !s.booting);
    expect(firstLive).toBeGreaterThan(0);
    const during = seen.slice(0, firstLive).filter((s) => s.anims.length);
    expect(during).toEqual([]);
    expect(seen.slice(0, firstLive).some((s) => s.booting)).toBe(true);
    // And after boot, a toggle animates again.
    expect(await page.evaluate(() => {
      toggleSidebar();
      const n = document.getElementById('sidebar').getAnimations().filter((a) => a.transitionProperty === 'width').length;
      toggleSidebar();
      return n;
    })).toBe(1);
  } finally {
    await page.evaluate(() => {
      localStorage.removeItem('fp-sidebar-collapsed');
      localStorage.removeItem('fp-theme');
    }).catch(() => {});
    await app.close();
    await delConfig('ui.theme');
  }
  expect(errors).toEqual([]);
});
