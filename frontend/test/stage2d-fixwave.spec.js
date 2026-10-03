// frontend/test/stage2d-fixwave.spec.js
// Stage 2D addendum, Task 8 — the final fix wave (final review minors R1–R3
// and the QA visual findings Q2–Q17). One test (or more) per item.
const { test, expect } = require('@playwright/test');
const { launchApp, waitReady, apiGet, API, apiHeaders, windowShot, rowByName } = require('./harness/app');

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
  await page.waitForFunction((w) => Math.abs(window.innerWidth * window.electronAPI.getZoom() - w) <= 2, width);
  await frames(page);
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

// ── Q2: the path never fades or cuts while the search bar could still shrink ─
const DEEP = ['Deep', 'Client-Projects', 'Northwind-Archive', 'Quarterly-Reports', 'Finance-Review',
  'Year-End-Closing', 'Supporting-Files', 'Scanned-Receipts', 'Final-Approved'];

/** The path's state: is it faded/cut, and does the search bar still have room to give? */
const crumbState = (page) => page.evaluate(() => {
  const tb = document.getElementById('toolbar');
  const wrap = document.getElementById('breadcrumb-wrap');
  const crumbs = document.getElementById('breadcrumb');
  const w = wrap.getBoundingClientRect();
  const c = crumbs.getBoundingClientRect();
  const slot = document.getElementById('search-slot').getBoundingClientRect();
  return {
    search: tb.dataset.search,
    overflowing: wrap.classList.contains('is-overflowing'),
    cut: c.left < w.left - 0.5 || c.right > w.right + 0.5,
    slotW: Math.round(slot.width),
    text: crumbs.textContent.replace(/\s+/g, ' ').trim(),
  };
});

test('Q2: at 800 px (100% and 150%) the Home / Settings / This PC path is whole and unfaded while the search bar is open', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const bad = [];
    for (const z of [1, 1.5]) {
      for (const screen of ['home', 'settings', 'thispc']) {
        // Narrow from a wide window each time: the first frame of a narrowing
        // is when the buttons used to measure squeezed.
        await setWindow(app, page, 1300, 800);
        await setZoom(app, page, z);
        if (screen === 'thispc') await page.evaluate(() => openBrowserAt(THISPC));
        else await page.evaluate((s) => switchScreen(s), screen);
        await page.waitForFunction(() => !window.__fpLoadPending);
        await frames(page);
        await setWindow(app, page, 800, 800);
        await frames(page, 3);
        const s = await crumbState(page);
        if (s.search === 'full' && (s.overflowing || s.cut)) bad.push(`${screen} @${z}: ${JSON.stringify(s)}`);
      }
      if (z === 1) {
        await page.evaluate(() => switchScreen('home'));
        await frames(page);
        await windowShot(app, page, 'fixwave-q2-home-800');
      }
    }
    expect(bad).toEqual([]);
  } finally {
    await setZoom(app, page, 1).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Q10: the search header ellipsizes instead of losing its start ────────────
test('Q10: a narrow toolbar ellipsizes "Search in <folder>"; its start and the clear × stay in view', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await setWindow(app, page, 800, 700);
    await setZoom(app, page, 1.5);
    await page.evaluate((p) => openBrowserAt(p), [root, ...DEEP].join('\\'));
    await page.waitForFunction(() => !window.__fpLoadPending);
    await page.evaluate(() => { setSearchText('deep'); runSearch(); });
    await page.waitForFunction(() => browserState.mode === 'search' && !searchState.inflight, null, { timeout: 10_000 });
    await frames(page, 3);
    const r = await page.evaluate(() => {
      const wrap = document.getElementById('breadcrumb-wrap').getBoundingClientRect();
      const head = document.querySelector('#breadcrumb .fp-breadcrumb__search');
      const label = head.querySelector('.fp-breadcrumb__label');
      const clear = document.querySelector('#breadcrumb .fp-breadcrumb__clear').getBoundingClientRect();
      const h = head.getBoundingClientRect();
      const cs = getComputedStyle(label);
      return {
        text: label.textContent,
        ellipsized: cs.textOverflow === 'ellipsis' && label.scrollWidth > label.clientWidth,
        startInView: h.left >= wrap.left - 0.5,
        clearInView: clear.left >= wrap.left - 0.5 && clear.right <= wrap.right + 0.5,
        faded: getComputedStyle(document.getElementById('breadcrumb-wrap')).maskImage !== 'none',
        title: head.title,
      };
    });
    expect(r.text).toBe('Search in Final-Approved');
    expect(r).toMatchObject({ ellipsized: true, startInView: true, clearInView: true, faded: false, title: 'Search in Final-Approved' });
    await windowShot(app, page, 'fixwave-q10-search-header-ellipsis');
  } finally {
    await page.evaluate(() => typeof clearSearch === 'function' && clearSearch()).catch(() => {});
    await setZoom(app, page, 1).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Q13: a cramped opened search bar ends its placeholder in an ellipsis ─────
test('Q13: the opened search bar given way to a few characters ellipsizes its placeholder', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await setWindow(app, page, 800, 700);
    await setZoom(app, page, 1.5);
    await page.evaluate((p) => openBrowserAt(p), [root, ...DEEP].join('\\'));
    await page.waitForFunction(() => !window.__fpLoadPending);
    await frames(page);
    expect(await page.evaluate(() => document.getElementById('toolbar').dataset.search)).toBe('collapsed');
    await page.locator('#search-collapsed').click();
    await expect(page.locator('#search-input')).toBeFocused();
    await frames(page, 3);
    const r = await page.evaluate(() => {
      const input = document.getElementById('search-input');
      const ruler = document.getElementById('search-measure');
      const width = (t) => { ruler.textContent = t; return ruler.getBoundingClientRect().width; };
      return {
        cramped: input.clientWidth < width(input.dataset.placeholder),
        shown: input.placeholder,
        fits: width(input.placeholder) <= input.clientWidth,
        input: getComputedStyle(input).textOverflow,
      };
    });
    await windowShot(app, page, 'fixwave-q13-cramped-search');
    expect(r.cramped).toBe(true);
    expect(r.shown).toMatch(/^Search\b.*…$/);
    expect(r.shown).not.toBe('Search files…');
    expect(r).toMatchObject({ fits: true, input: 'ellipsis' });
    // Folded back and opened wide again, the whole placeholder returns.
    await page.keyboard.press('Escape');
    await setWindow(app, page, 1300, 700);
    await setZoom(app, page, 1);
    await page.evaluate(() => switchScreen('home'));
    await frames(page, 3);
    expect(await page.evaluate(() => document.getElementById('search-input').placeholder)).toBe('Search files…');
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
    await setZoom(app, page, 1).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Q16: the "…" (See more) button is a horizontal ellipsis ──────────────────
test('Q16: the toolbar overflow button draws the horizontal "more" glyph, not the vertical kebab', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const href = await page.evaluate(() => document.querySelector('#btn-toolbar-more use').getAttribute('href'));
    expect(href).toBe('#fp-more-horizontal');
    expect(await page.evaluate(() => !!document.getElementById('fp-more-horizontal'))).toBe(true);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
