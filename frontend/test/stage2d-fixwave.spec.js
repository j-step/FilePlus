// frontend/test/stage2d-fixwave.spec.js
// Stage 2D addendum, Task 8 — the final fix wave (final review minors R1–R3
// and the QA visual findings Q2–Q17). One test (or more) per item.
const { test, expect } = require('@playwright/test');
const { launchApp, waitReady, apiGet, API, apiHeaders, windowShot, parkPointer, rowByName } = require('./harness/app');

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

// ── Q4 / Q5 / Q6: the tab strip ──────────────────────────────────────────────
/** Geometry of the header's tab strip, the "+" and every tab. */
const stripGeo = (page) => page.evaluate(() => {
  const strip = document.getElementById('tabbar');
  const s = strip.getBoundingClientRect();
  const fade = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar-fade')) || 24;
  const plus = document.getElementById('btn-new-tab');
  const p = plus.getBoundingClientRect();
  const hit = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2);
  const clippedRight = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1;
  const tabsEls = [...strip.querySelectorAll('.fp-tab')];
  const active = strip.querySelector('.fp-tab--active').getBoundingClientRect();
  return {
    scrolls: strip.scrollWidth > strip.clientWidth + 1,
    // Whole, and clear of the fade while there is more to its right.
    activeVisible: active.left >= s.left - 0.5 && active.right <= s.right + 0.5
      && (!clippedRight || active.right <= s.right - fade + 0.5),
    plusOutsideStrip: !strip.contains(plus),
    plusOnScreen: !!hit && (hit === plus || plus.contains(hit)) && p.right <= innerWidth,
    widths: tabsEls.map((t) => Math.round(t.getBoundingClientRect().width * 10) / 10),
    labelWidths: tabsEls.map((t) => Math.round(t.querySelector('.fp-tab__label').getBoundingClientRect().width * 10) / 10),
    activeIndex: tabsEls.findIndex((t) => t.classList.contains('fp-tab--active')),
  };
});

test('Q4: with many tabs at 800 px (100/150/200%), the active tab is whole and clear of the fade, the "+" always on screen, every tab the same width', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setWindow(app, page, 800, 600);
    for (let i = 0; i < 11; i++) await page.locator('#btn-new-tab').click();
    const bad = [];
    for (const z of [1, 1.5, 2]) {
      await setZoom(app, page, z);
      await frames(page, 3);
      for (const which of ['last', 'middle', 'first']) {
        await page.evaluate((w) => {
          const order = tabsInStripOrder();
          activateTab(order[w === 'last' ? order.length - 1 : w === 'first' ? 0 : Math.floor(order.length / 2)]);
        }, which);
        await frames(page);
        const g = await stripGeo(page);
        if (!g.scrolls) bad.push(`@${z} ${which}: expected the strip to scroll`);
        if (!g.activeVisible) bad.push(`@${z} ${which}: active tab not fully visible`);
        if (!g.plusOutsideStrip || !g.plusOnScreen) bad.push(`@${z} ${which}: "+" not on screen (${g.plusOutsideStrip}/${g.plusOnScreen})`);
        const w0 = g.widths[0];
        if (g.widths.some((w) => Math.abs(w - w0) > 1)) bad.push(`@${z} ${which}: uneven tabs ${g.widths}`);
        const l0 = g.labelWidths[0];
        if (g.labelWidths.some((w) => Math.abs(w - l0) > 1)) bad.push(`@${z} ${which}: uneven labels ${g.labelWidths}`);
      }
      // A window narrowing under a scrolled strip keeps the active tab in view.
      if (z === 1) {
        await page.evaluate(() => activateTab(tabsInStripOrder().slice(-1)[0]));
        // (800 is the window's minimum: a wider sidebar narrows the strip.)
        await page.evaluate(() => setSidebarWidthVar(380));
        await frames(page, 3);
        const g = await stripGeo(page);
        if (!g.activeVisible) bad.push('narrowed: active tab not fully visible');
        await page.evaluate(() => setSidebarWidthVar(savedSidebarWidth()));
        await frames(page);
        await windowShot(app, page, 'fixwave-q4-many-tabs-800');
      }
      if (z === 2) await windowShot(app, page, 'fixwave-q4-many-tabs-800-z200');
    }
    expect(bad).toEqual([]);
  } finally {
    await setZoom(app, page, 1).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('Q5: with room, tabs are as wide as their titles (no "Docum…"), a long title stops at the max and ellipsizes', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await setWindow(app, page, 1300, 800);
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await page.waitForFunction(() => !window.__fpLoadPending && activeTab().label === 'Documents');
    await page.evaluate(() => openNewTab());
    await page.evaluate(() => openNewTab());
    await page.evaluate(() => {
      const rec = tabs.list[tabs.list.length - 1];
      rec.label = 'Quarterly planning notes for the whole team offsite';
      updateTabElementAppearance(rec);
    });
    await frames(page, 3);
    const r = await page.evaluate(() => {
      const maxW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tab-max-w'));
      return [...document.querySelectorAll('#tabbar .fp-tab')].map((t) => {
        const l = t.querySelector('.fp-tab__label');
        return { text: l.textContent, cut: l.scrollWidth > l.clientWidth + 0.5, w: t.getBoundingClientRect().width, maxW };
      });
    });
    expect(r.map((t) => t.text)).toEqual(['Documents', 'Home', 'Quarterly planning notes for the whole team offsite']);
    expect(r[0].cut).toBe(false);
    expect(r[1].cut).toBe(false);
    expect(r[1].w).toBeLessThan(r[0].w);            // sized to the title, not a fixed width
    expect(r[2].cut).toBe(true);                     // the long one ellipsizes…
    expect(r[2].w).toBeLessThanOrEqual(r[2].maxW + 0.5);   // …at the max width
    expect(r[2].w).toBeGreaterThan(r[2].maxW - 4);
    await windowShot(app, page, 'fixwave-q5-tab-widths');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('Q6: the tab strip starts a small inset off the sidebar seam, its tabs bottom-aligned with the toolbar edge', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setWindow(app, page, 1100, 700);
    const r = await page.evaluate(() => {
      const tab = document.querySelector('#tabbar .fp-tab').getBoundingClientRect();
      const main = document.getElementById('main').getBoundingClientRect();
      const header = document.getElementById('header').getBoundingClientRect();
      const inset = parseFloat(getComputedStyle(document.getElementById('tabbar')).paddingLeft);
      return { gap: tab.left - main.left, inset, bottom: Math.abs(tab.bottom - header.bottom) };
    });
    expect(r.inset).toBeGreaterThanOrEqual(4);
    expect(Math.abs(r.gap - r.inset)).toBeLessThanOrEqual(1);
    expect(r.bottom).toBeLessThanOrEqual(0.5);
    await windowShot(app, page, 'fixwave-q6-tab-seam');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

async function apiSend(method, route, body) {
  const r = await fetch(`${API}${route}`, {
    method, headers: apiHeaders(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${route} -> ${r.status}`);
  return r.json().catch(() => null);
}

// ── Q7: menu shortcuts sit in one right-aligned column ───────────────────────
test('Q7: every menu item spans the menu, so shortcuts and flyout chevrons end on one right-aligned column', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await setWindow(app, page, 1200, 800);
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await page.waitForFunction(() => !window.__fpLoadPending);
    const columns = () => page.evaluate(() => {
      const menu = document.getElementById('context-menu');
      const inner = menu.querySelector('.fp-context-menu__scroll') || menu;
      const ir = inner.getBoundingClientRect();
      const items = [...menu.querySelectorAll('.fp-context-menu__item')].filter((i) => i.getClientRects().length);
      return {
        itemWidths: [...new Set(items.map((i) => Math.round(i.getBoundingClientRect().width)))],
        inner: Math.round(ir.width),
        kbdRights: [...new Set([...menu.querySelectorAll('.fp-context-menu__kbd')].map((k) => Math.round(k.getBoundingClientRect().right)))],
        kbdCount: menu.querySelectorAll('.fp-context-menu__kbd').length,
        chevronRights: [...new Set([...menu.querySelectorAll('.fp-context-menu__chevron')].map((k) => Math.round(k.getBoundingClientRect().right)))],
      };
    });
    // A file's menu (Cut, Copy, Paste, Rename, Delete shortcuts).
    await rowByName(page, 'doc-00.txt').click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    let c = await columns();
    expect(c.kbdCount).toBeGreaterThanOrEqual(4);
    expect(c.itemWidths).toEqual([c.inner]);
    expect(c.kbdRights.length).toBe(1);
    await parkPointer(page);
    await windowShot(app, page, 'fixwave-q7-context-menu');
    await page.keyboard.press('Escape');
    // The empty-area menu (flyout parents with chevrons, shortcuts).
    await page.locator('#list-scroll').click({ button: 'right', position: { x: 400, y: 600 } });
    await expect(page.locator('#context-menu')).toBeVisible();
    c = await columns();
    expect(c.itemWidths).toEqual([c.inner]);
    expect(c.kbdRights.length).toBeLessThanOrEqual(1);
    expect(c.chevronRights.length).toBeLessThanOrEqual(1);
    if (c.kbdRights.length && c.chevronRights.length) expect(Math.abs(c.kbdRights[0] - c.chevronRights[0])).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Q8: Home's hover actions never sit on a half-shown time ──────────────────
test('Q8: a hovered Recent row hides the time under its actions; the actions never cover the name or location (100% and 150%)', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const dir = `${root}\\_gen\\Documents`;
    await apiSend('DELETE', '/recent');
    for (const n of ['doc-00.txt', 'doc-01.txt', 'doc-02.txt']) await apiSend('POST', '/recent', { path: `${dir}\\${n}`, action: 'opened' });
    await page.evaluate(() => switchScreen('home'));
    const rows = page.locator('#home-recent .fp-row[data-path]');
    await expect(rows).toHaveCount(3);
    const bad = [];
    for (const [w, z] of [[1200, 1], [800, 1.5], [1100, 1.5]]) {
      await setWindow(app, page, w, 700);
      await setZoom(app, page, z);
      await frames(page);
      await rows.nth(1).hover();
      await frames(page);
      const r = await rows.nth(1).evaluate((row) => {
        const act = row.querySelector('.fp-row__hover-actions').getBoundingClientRect();
        const out = [];
        for (const sel of ['.fp-row__name', '.fp-row__recent-path', '.fp-row__recent-time', '.fp-row__tags']) {
          const el = row.querySelector(sel);
          if (!el || !el.getClientRects().length) continue;
          if (getComputedStyle(el).visibility === 'hidden') continue;
          const b = el.getBoundingClientRect();
          if (b.width && b.right > act.left + 0.5 && b.left < act.right - 0.5) out.push(`${sel} ${Math.round(b.left)}..${Math.round(b.right)} under actions ${Math.round(act.left)}..${Math.round(act.right)}`);
        }
        const a = row.querySelector('.fp-row__hover-actions');
        return { out, timeColumn: row.querySelector('.fp-row__recent-time').getClientRects().length > 0,
          actionsShown: a.getClientRects().length > 0 && getComputedStyle(a).opacity === '1' };
      });
      // A pane too narrow for the time column has no room for the buttons
      // either: they stay out (the context menu has the same actions).
      if (r.actionsShown !== r.timeColumn) bad.push(`${w}@${z}: actions ${r.actionsShown} with time column ${r.timeColumn}`);
      bad.push(...r.out.map((o) => `${w}@${z}: ${o}`));
      if (w === 800) await windowShot(app, page, 'fixwave-q8-home-hover-800-z150');
    }
    // Not hovered, the time is back.
    await parkPointer(page);
    expect(await rows.nth(1).locator('.fp-row__recent-time').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
    expect(bad).toEqual([]);
  } finally {
    await setZoom(app, page, 1).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Q9: the favourite star never sits on the icon, never shifts a column ─────
test('Q9: in Icons the star sits beside the icon box at every size; in Content every row keeps the same date/size column', async () => {
  const { app, page, errors } = await launchApp();
  const root = (await apiGet('/fs/list/root')).path;
  const doc = `${root}\\Views\\short.txt`;
  try {
    await apiSend('POST', '/favorites', { path: doc });
    await page.evaluate(() => loadFavorites());
    await setWindow(app, page, 1200, 800);
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Views`);
    await page.waitForFunction(() => !window.__fpLoadPending);
    const bad = [];
    for (const size of [48, 64, 96, 256]) {
      await page.evaluate((s) => setView('icons', s), size);
      await frames(page);
      const g = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.dataset.path.endsWith('short.txt'));
        row.scrollIntoView({ block: 'center' });
        const s = row.querySelector('.fp-row__star').getBoundingClientRect();
        const box = row.firstElementChild.getBoundingClientRect();
        const cell = row.getBoundingClientRect();
        const overlaps = s.right > box.left + 0.5 && s.left < box.right - 0.5 && s.bottom > box.top + 0.5 && s.top < box.bottom - 0.5;
        const inCell = s.left >= cell.left - 0.5 && s.right <= cell.right + 0.5 && s.top >= cell.top - 0.5;
        return { overlaps, inCell, s: [s.left, s.top, s.width], box: [box.left, box.top, box.width] };
      });
      if (g.overlaps || !g.inCell) bad.push(`icons ${size}: ${JSON.stringify(g)}`);
      if (size === 48) await windowShot(app, page, 'fixwave-q9-star-medium');
    }
    await page.evaluate(() => setView('content'));
    await frames(page);
    const cols = await page.evaluate(() => [...document.querySelectorAll('#list-scroll .fp-row[data-path]')]
      .filter((r) => !r.hasAttribute('data-dir'))
      .map((r) => ({
        star: !!r.querySelector('.fp-row__star'),
        meta: [...r.querySelectorAll('.fp-row__content > .fp-row__meta:not(.fp-row__meta--start)')].map((m) => Math.round(m.getBoundingClientRect().right)),
      })));
    const starred = cols.find((c) => c.star);
    const plain = cols.find((c) => !c.star);
    expect(starred, 'a starred row').toBeTruthy();
    expect(starred.meta).toEqual(plain.meta);
    await page.evaluate(() => [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.dataset.path.endsWith('short.txt')).scrollIntoView({ block: 'center' }));
    await windowShot(app, page, 'fixwave-q9-star-content');
    expect(bad).toEqual([]);
    await page.evaluate(() => setView('details'));
  } finally {
    await apiSend('DELETE', `/favorites?path=${encodeURIComponent(doc)}`).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Q11: Settings › Data › Writes, both lines one style ──────────────────────
test('Q11: the Writes detail line uses the same font and colour as the status line above it', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('.settings-nav__item[data-pane="data"]').click();
    await expect(page.locator('#settings-writes-detail')).not.toHaveText('');
    const [a, b] = await page.evaluate(() => ['settings-writes-status', 'settings-writes-detail'].map((id) => {
      const cs = getComputedStyle(document.getElementById(id));
      return { font: `${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`, color: cs.color };
    }));
    expect(b).toEqual(a);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
