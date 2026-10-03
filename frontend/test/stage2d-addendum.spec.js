// frontend/test/stage2d-addendum.spec.js
// Stage 2D addendum (docs/superpowers/specs/2026-10-03-stage-2d-addendum-design.md).
//
// §3 — the modal backdrop blur is consistent. Every stand-out panel
// (Properties, the confirm modal, the paste-conflict modal, More filters, the
// command palette, the Tag Canvas) opens over ONE full-window scrim that sits
// above every other layer and blurs + dims everything beneath it uniformly.
//
// The bug (owner, playtest): with Mica on, the sidebar and title bar text
// stayed sharp under the blur. Those regions are transparent so the OS
// material shows through, and Chromium draws a backdrop-filter's blurred copy
// OVER the backdrop: where the backdrop has no opaque paint, the sharp
// original shows through the blurred halo. So the check is not only "the
// scrim is on top" but "everything under every point of the scrim has an
// opaque backing for the blur to work on".
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp, apiGet, shot, rowByName, expectNoErrors, SHOTS, pinFolders, windowShot, parkPointer } = require('./harness/app');

test.setTimeout(180_000);

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
  step(k);
}), n);

const settled = (page) => page.waitForFunction(() => !window.__fpLoadPending && window.__fpInspectorPending === 0);

/** Probes the layers under an open scrim. For each named point: what
 * elementFromPoint hits, whether that is the scrim (or inside it), and
 * whether the stack beneath the scrim at that point has an opaque paint
 * (a background with alpha 1) for the backdrop blur to work on. */
async function probeScrim(page, scrimSel) {
  return page.evaluate((sel) => {
    const scrim = document.querySelector(sel);
    const alphaOf = (c) => {
      if (!c || c === 'transparent') return 0;
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return 1; // color(), oklch() etc. carry no alpha here unless "/"
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      return parts.length >= 4 ? parseFloat(parts[3]) : 1;
    };
    const centre = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const visibleThumb = [...document.querySelectorAll('.fp-oscroll__thumb')]
      .find((t) => { const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 8 && !t.closest('.fp-scrim'); });
    // A plain (not active, not hovered) sidebar item: its label sits right on
    // the sidebar's own background, which Mica makes transparent.
    const label = [...document.querySelectorAll('#sidebar .fp-sidebar__item:not(.fp-sidebar__item--active) .fp-sidebar__item__label')]
      .find((el) => el.textContent.trim() && el.getBoundingClientRect().width > 4);
    const points = {
      'sidebar label': centre(label),
      'sidebar section label': centre(document.querySelector('#sidebar .fp-sidebar__section-label')),
      'header bar (device name)': centre(document.getElementById('device-name')),
      'tab bar': centre(document.querySelector('#tabbar .fp-tab')) || centre(document.getElementById('tabbar')),
      'overlay scrollbar thumb': centre(visibleThumb),
      'status bar': centre(document.getElementById('statusbar')),
      'file list': centre(document.querySelector('#list-scroll .fp-row')) || centre(document.getElementById('list-scroll')),
      'file list scrollbar': (() => {
        const r = document.getElementById('list-scroll')?.getBoundingClientRect();
        return r && r.width ? { x: r.right - 3, y: r.top + r.height / 2 } : null;
      })(),
      'window corner (top-left)': { x: 1, y: 1 },
      'window corner (bottom-right)': { x: innerWidth - 2, y: innerHeight - 2 },
    };
    const out = {};
    for (const [name, pt] of Object.entries(points)) {
      if (!pt) { out[name] = { missing: true }; continue; }
      const hit = document.elementFromPoint(pt.x, pt.y);
      const stack = document.elementsFromPoint(pt.x, pt.y);
      const below = stack.slice(stack.indexOf(scrim) + 1);
      // The root's own background (html) counts: it is what a transparent
      // window would otherwise show through.
      const opaque = below.some((el) => alphaOf(getComputedStyle(el).backgroundColor) >= 0.999);
      out[name] = {
        onScrim: !!(hit && (hit === scrim || scrim.contains(hit))),
        hitScrim: hit ? hit.closest('.fp-scrim')?.id || null : null,
        opaqueBelow: opaque,
        transparentChain: opaque ? null : below.map((el) => el.id || el.tagName.toLowerCase()).join(' > '),
      };
    }
    const r = scrim.getBoundingClientRect();
    const cs = getComputedStyle(scrim);
    return {
      points: out,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      win: { w: innerWidth, h: innerHeight },
      backdrop: cs.backdropFilter,
      background: cs.backgroundColor,
      zIndex: cs.zIndex,
      parent: scrim.parentElement === document.body,
    };
  }, scrimSel);
}

test('§3: every scrimmed surface covers the whole window above every layer and blurs it evenly, Mica on', async () => {
  const { app, page, errors } = await launchApp();
  let unpin = async () => {};
  try {
    const root = (await apiGet('/fs/list/root')).path;
    // A folder long enough to scroll, so the list has an overlay thumb.
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Bulk`);
    await settled(page);
    await page.evaluate(() => {
      if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar();
    });
    // Mica is what made the sidebar/title bar transparent. Force it on, so
    // the check holds on a machine without Mica too (the CSS is the subject).
    const themeWas = await page.evaluate(() => {
      document.documentElement.dataset.mica = 'on';
      return localStorage.getItem('fp-theme') || 'system';
    });
    // A short window and four pinned folders, so the sidebar overflows and
    // lays out its overlay thumb (elementFromPoint ignores the thumb's fade,
    // not its layout). The pins: since the one-row header bar (addendum §1)
    // the default sidebar fits even the 500 px minimum height.
    unpin = await pinFolders(page, ['Bulk', 'Views', '_gen', '_gen\\Documents'].map((n) => `${root}\\${n}`));
    const sizeWas = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const was = w.getSize();
      w.setSize(1100, 520);
      return was;
    });
    await page.waitForFunction(() => [...document.querySelectorAll('#sidebar .fp-oscroll__thumb')]
      .some((t) => t.getBoundingClientRect().height > 8));
    await page.evaluate(() => { const s = document.getElementById('list-scroll'); s.scrollTop = 40; });
    await frames(page);

    const surfaces = [
      ['properties', '#properties-modal-scrim',
        (p) => openProperties(p), () => closeProperties(), `${root}\\Bulk\\bulk-001.txt`],
      ['confirm modal', '#modal-scrim',
        () => openModal('danger', { title: 'Delete?', body: 'Layer probe.' }), () => closeModal()],
      ['conflict modal', '#modal-scrim',
        () => openModal('warn', { title: '1 item already exists', body: 'Layer probe.',
          extraActions: [{ label: 'Skip', variant: 'secondary', onClick: () => {} }] }), () => closeModal()],
      ['more filters', '#search-filters-scrim', () => openMoreFilters(), () => closeMoreFilters()],
      ['command palette', '#palette-scrim', () => openPalette(), () => closePalette()],
      ['tag canvas', '#tag-canvas-scrim', () => openTagCanvas(), () => closeTagCanvas()],
    ];

    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => applyTheme(t), theme);
      for (const [name, sel, open, close, arg] of surfaces) {
        await page.evaluate(open, arg);
        await expect(page.locator(sel), name).toBeVisible();
        await frames(page);
        const probe = await probeScrim(page, sel);
        const ctx = `${theme} / ${name}`;
        expect(probe.parent, `${ctx}: the scrim is a child of <body>`).toBe(true);
        expect(probe.rect, `${ctx}: the scrim covers the window`).toEqual({ left: 0, top: 0, right: probe.win.w, bottom: probe.win.h });
        expect(probe.backdrop, `${ctx}: the scrim blurs`).toMatch(/blur\(/);
        for (const [pt, r] of Object.entries(probe.points)) {
          expect(r.missing, `${ctx}: probe point "${pt}" exists`).toBeFalsy();
          expect(r.onScrim, `${ctx}: elementFromPoint at the ${pt} is the scrim (hit ${r.hitScrim})`).toBe(true);
          expect(r.opaqueBelow, `${ctx}: under the scrim at the ${pt} something opaque is there to blur (chain: ${r.transparentChain})`).toBe(true);
        }
        expect(probe.zIndex, `${ctx}: the scrim sits on the --z-scrim layer`).toBe(
          await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--z-scrim').trim()));
        if (name === 'properties' || name === 'command palette') {
          // One capture: with a scrim up the Mica backing is solid, so a
          // second "-mica" capture came out byte-identical and proved nothing
          // (Task 8 Q18); the opaqueBelow probe above is the Mica check.
          await parkPointer(page);
          await shot(page, `addendum-scrim-${name.replace(/\s+/g, '-')}-${theme}`);
        }
        await page.evaluate(close);
        await expect(page.locator(sel)).toBeHidden();
      }
    }
    // Closed: the window is Mica-transparent again (the backing is only
    // there while a scrim is up).
    const htmlBg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    expect(htmlBg).toBe('rgba(0, 0, 0, 0)');
    await page.evaluate((t) => applyTheme(t), themeWas);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sizeWas);
  } finally {
    await unpin();
    await app.close();
  }
  expectNoErrors(errors);
});

// §3 review fix round 1: "a scrim is open" has one source of truth —
// fpSetScrim keeps display + aria-hidden in step and mirrors the count onto
// html[data-scrim-open], which anyScrimOpen() and the Mica backing both read.
test('§3: html[data-scrim-open] follows every scrim through every way in and out; the Mica backing goes with it', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Bulk`);
    await settled(page);
    await page.evaluate(() => { document.documentElement.dataset.mica = 'on'; });
    const state = () => page.evaluate(() => ({
      attr: document.documentElement.dataset.scrimOpen ?? null,
      any: anyScrimOpen(),
      bg: getComputedStyle(document.documentElement).backgroundColor,
    }));
    const closed = { attr: null, any: false, bg: 'rgba(0, 0, 0, 0)' };
    const isOpen = (s) => s.attr === '1' && s.any === true && s.bg !== 'rgba(0, 0, 0, 0)';

    const surfaces = [
      ['properties', '#properties-modal-scrim', '#properties-modal', (p) => openProperties(p), `${root}\\Bulk\\bulk-001.txt`],
      ['confirm modal', '#modal-scrim', '#modal', () => openModal('danger', { title: 'Delete?', body: 'Probe.' })],
      ['more filters', '#search-filters-scrim', '#search-filters-modal', () => openMoreFilters()],
      ['command palette', '#palette-scrim', '#palette', () => openPalette()],
      ['tag canvas', '#tag-canvas-scrim', '#tag-canvas', () => openTagCanvas()],
    ];
    expect(await state()).toEqual(closed);
    for (const [name, sel, , open, arg] of surfaces) {
      for (const how of ['Escape', 'backdrop click']) {
        await page.evaluate(open, arg);
        await expect(page.locator(sel), name).toBeVisible();
        expect(isOpen(await state()), `${name}: open`).toBe(true);
        if (how === 'Escape') await page.keyboard.press('Escape');
        else await page.mouse.click(4, 300); // the scrim's left edge, outside every dialog
        await expect(page.locator(sel), `${name}: ${how} closes it`).toBeHidden();
        expect(await state(), `${name}: closed by ${how}`).toEqual(closed);
        expect(await page.locator(sel).getAttribute('aria-hidden')).toBe('true');
      }
    }
    // Nested: a confirm over Properties keeps the backing until the last closes.
    await page.evaluate((p) => openProperties(p), `${root}\\Bulk\\bulk-001.txt`);
    await expect(page.locator('#properties-modal-scrim')).toBeVisible();
    await page.evaluate(() => openModal('warn', { title: 'Nested', body: 'Probe.' }));
    expect((await state()).attr).toBe('2');
    await page.evaluate(() => closeModal());
    expect(isOpen(await state())).toBe(true);
    await page.evaluate(() => closeModal()); // a second close miscounts nothing
    expect((await state()).attr).toBe('1');
    await page.evaluate(() => closeProperties());
    expect(await state()).toEqual(closed);
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

// §3 review fix round 1: a right-click inside an open modal neither opens the
// app's context menu (it would sit under the scrim, unreachable) nor clears
// the file selection behind the modal.
test('§3: a right-click while a modal is open opens no menu and keeps the selection', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Bulk`);
    await settled(page);
    await rowByName(page, 'bulk-002.txt').click();
    await settled(page);
    const selection = () => page.evaluate(() => [...browserState.selection].map((p) => p.split('\\').pop()));
    expect(await selection()).toEqual(['bulk-002.txt']);

    const surfaces = [
      ['properties', '#properties-modal-scrim', '#properties-modal', (p) => openProperties(p), `${root}\\Bulk\\bulk-002.txt`],
      ['more filters', '#search-filters-scrim', '#search-filters-modal', () => openMoreFilters()],
      ['command palette', '#palette-scrim', '#palette', () => openPalette()],
    ];
    for (const [name, sel, dialog, open, arg] of surfaces) {
      await page.evaluate(open, arg);
      await expect(page.locator(sel)).toBeVisible();
      const box = await page.locator(dialog).boundingBox();
      // Inside the dialog, then on the bare scrim over the file list.
      for (const [x, y] of [[box.x + 12, box.y + box.height / 2], [4, 300]]) {
        await page.mouse.click(x, y, { button: 'right' });
        await frames(page);
        await expect(page.locator('#context-menu'), `${name}: no context menu`).toBeHidden();
        expect(await selection(), `${name}: selection kept`).toEqual(['bulk-002.txt']);
        await expect(page.locator(sel), `${name}: still open`).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(page.locator(sel)).toBeHidden();
    }
    // With no modal, the right-click menu still works.
    await rowByName(page, 'bulk-002.txt').click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

// ── §1 One header bar ────────────────────────────────────────────────────────
// The identity card (big logo + device name), the tab strip, an empty drag
// region and the Windows caption buttons share ONE top bar, 44 screen px tall
// at any app zoom. The card is as wide as the sidebar while it is expanded
// (the tabs start where the content pane starts) and keeps its natural width
// over the collapsed rail — it never collapses. The sidebar's collapse toggle
// moved into the sidebar's top row, beside Ask File+.

/** Geometry of the header bar and everything that lives in it, in CSS px
 * plus the real page zoom (screen px = CSS px × zoom). */
const headerGeo = (page) => page.evaluate(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const header = document.getElementById('header');
  const name = document.getElementById('device-name');
  const region = (el) => { const cs = el && getComputedStyle(el); return cs ? (cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region')) : null; };
  const drag = header && header.querySelector('.fp-header__drag');
  return {
    zoom: window.electronAPI.getZoom(),
    win: { w: innerWidth, h: innerHeight },
    header: rect(header),
    headerBg: header && getComputedStyle(header).backgroundColor,
    card: rect(document.getElementById('identity')),
    cardInHeader: !!header?.contains(document.getElementById('identity')),
    logo: rect(document.querySelector('#identity .fp-identity__logo')),
    name: rect(name),
    nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : null,
    nameEllipsis: name ? getComputedStyle(name).textOverflow : null,
    nameTitle: name?.title,
    tabbar: rect(document.getElementById('tabbar')),
    tabbarInHeader: !!header?.contains(document.getElementById('tabbar')),
    firstTab: rect(document.querySelector('#tabbar .fp-tab')),
    newTab: rect(document.getElementById('btn-new-tab')),
    drag: rect(drag),
    dragRegion: region(drag),
    noDrag: ['#device-name', '#tabbar .fp-tab', '#btn-new-tab', '#btn-minimize', '#btn-maximize', '#btn-close']
      .map((s) => [s, region(document.querySelector(s))]),
    caps: ['btn-minimize', 'btn-maximize', 'btn-close'].map((id) => rect(document.getElementById(id))),
    capsInHeader: ['btn-minimize', 'btn-maximize', 'btn-close'].every((id) => header?.contains(document.getElementById(id))),
    sidebar: rect(document.getElementById('sidebar')),
    main: rect(document.getElementById('main')),
    collapsed: document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed'),
    // Remnants of the old two-row chrome.
    oldTitlebar: !!document.querySelector('#titlebar, .fp-titlebar, .fp-titlebar__brand'),
    oldSidebarCard: !!document.querySelector('#sidebar .fp-sidebar__header, #sidebar #device-name, #sidebar .fp-sidebar__brand-mark, #btn-sidebar-expand'),
  };
});

const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

/** The checks every layout (expanded, collapsed, zoomed, narrow) must pass. */
function expectOneBar(g, ctx) {
  const z = g.zoom;
  expect(g.header, `${ctx}: #header exists`).toBeTruthy();
  expect(g.oldTitlebar, `${ctx}: the old title bar is gone`).toBe(false);
  expect(g.oldSidebarCard, `${ctx}: the sidebar card is gone`).toBe(false);
  expect(g.header.top, `${ctx}: the bar is at the top`).toBe(0);
  expect(near(g.header.width, g.win.w), `${ctx}: the bar spans the window`).toBe(true);
  expect(near(g.header.height * z, 44, 1), `${ctx}: 44 screen px tall (got ${g.header.height * z})`).toBe(true);
  expect(g.cardInHeader && g.tabbarInHeader && g.capsInHeader, `${ctx}: card, tabs and caption buttons all live in the bar`).toBe(true);
  // One row: everything sits inside the bar's box.
  for (const [what, r] of [['card', g.card], ['logo', g.logo], ['name', g.name], ['tab', g.firstTab], ['+', g.newTab]]) {
    expect(r, `${ctx}: ${what} laid out`).toBeTruthy();
    expect(r.width > 0 && r.top >= g.header.top - 0.5 && r.bottom <= g.header.bottom + 0.5,
      `${ctx}: ${what} inside the bar (${JSON.stringify(r)})`).toBe(true);
  }
  // Left to right: card, tabs, drag region, caption buttons.
  expect(g.tabbar.left, `${ctx}: tabs start after the card`).toBeGreaterThanOrEqual(g.card.right - 0.5);
  expect(g.drag.left, `${ctx}: the drag region follows the tabs`).toBeGreaterThanOrEqual(g.tabbar.right - 0.5);
  expect(g.drag.width * z, `${ctx}: the drag region always keeps room to grab`).toBeGreaterThanOrEqual(40);
  expect(g.dragRegion, `${ctx}: empty bar space moves the window`).toBe('drag');
  for (const [sel, region] of g.noDrag) expect(region, `${ctx}: ${sel} is no-drag`).toBe('no-drag');
  // Windows 11 caption buttons: full bar height, ~46 screen px wide, flush right.
  g.caps.forEach((r, i) => {
    expect(near(r.height, g.header.height, 0.5), `${ctx}: caption ${i} is full bar height`).toBe(true);
    expect(near(r.width * z, 46, 1), `${ctx}: caption ${i} is 46 screen px wide (got ${r.width * z})`).toBe(true);
  });
  expect(near(g.caps[2].right, g.win.w, 0.5), `${ctx}: close is flush with the right edge`).toBe(true);
  expect(g.caps[0].left, `${ctx}: caption buttons follow the drag region`).toBeGreaterThanOrEqual(g.drag.right - 0.5);
  // The name never clips vertically: its box stays inside the bar.
  expect(g.name.bottom <= g.header.bottom + 0.5 && g.name.top >= g.header.top - 0.5, `${ctx}: the name fits the bar`).toBe(true);
}

/** Sets the device name the way a finished rename leaves it. */
const setDeviceName = (page, name) => page.evaluate((n) => {
  localStorage.setItem('fp-device-name', n);
  setDeviceNameText(n);
}, name);

test('§1: one header bar — identity card, tabs, drag region and caption buttons on one row; the card tracks the sidebar', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setDeviceName(page, "JJ's PC");
    const themeWas = await page.evaluate(() => localStorage.getItem('fp-theme') || 'system');
    await page.evaluate(() => {
      applyTheme('dark');
      if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar();
    });
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Bulk`);
    await settled(page);

    // Expanded: the card region is exactly the sidebar's width, so the tabs
    // begin where the content pane begins.
    let g = await headerGeo(page);
    expectOneBar(g, 'expanded');
    expect(near(g.card.left, 0) && near(g.card.width, g.sidebar.width), `card = sidebar width (${g.card.width} vs ${g.sidebar.width})`).toBe(true);
    // …a small inset off the seam (Task 8 Q6: flush on it, the tab's edge
    // drew a 1 px step beside the sidebar's divider).
    const inset = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('tabbar')).paddingLeft));
    expect(inset, 'the strip has a leading inset').toBeGreaterThan(0);
    expect(near(g.firstTab.left, g.main.left + inset), 'the first tab starts an inset into the content pane').toBe(true);
    await windowShot(app, page, 'addendum-header-expanded-dark');

    // It tracks a resized sidebar.
    await page.evaluate(() => setSidebarWidthVar(320));
    await frames(page);
    g = await headerGeo(page);
    expect(near(g.sidebar.width, 320) && near(g.card.width, 320), `card tracks a 320px sidebar (${g.card.width})`).toBe(true);
    expect(near(g.firstTab.left, g.main.left + inset)).toBe(true);
    await page.evaluate(() => setSidebarWidthVar(savedSidebarWidth()));

    // Collapsed: the card never collapses to the rail; it keeps its natural
    // width (logo + whole name) and the tabs start after it.
    await page.evaluate(() => toggleSidebar());
    await frames(page);
    g = await headerGeo(page);
    expect(g.collapsed).toBe(true);
    expectOneBar(g, 'collapsed');
    expect(g.card.width, 'the card is wider than the rail').toBeGreaterThan(g.sidebar.width + 20);
    expect(g.nameClipped, 'the whole name shows over the rail').toBe(false);
    await windowShot(app, page, 'addendum-header-collapsed-dark');

    // The collapse toggle sits above the rail icons, inside the sidebar.
    const railToggle = await page.evaluate(() => {
      const t = document.getElementById('btn-sidebar-collapse');
      const a = document.getElementById('btn-ask-fileplus').getBoundingClientRect();
      const r = t.getBoundingClientRect();
      return { inSidebar: !!t.closest('#sidebar'), visible: r.width > 0, above: r.bottom <= a.top + 0.5,
        title: t.title, href: t.querySelector('use')?.getAttribute('href') };
    });
    expect(railToggle).toEqual({ inSidebar: true, visible: true, above: true, title: 'Expand sidebar (Ctrl+B)', href: '#fp-chevron-right' });
    await page.locator('#btn-sidebar-collapse').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/fp-sidebar--collapsed/);

    // Expanded: the toggle shares Ask File+'s row.
    const rowToggle = await page.evaluate(() => {
      const t = document.getElementById('btn-sidebar-collapse');
      const tr = t.getBoundingClientRect();
      const a = document.getElementById('btn-ask-fileplus').getBoundingClientRect();
      return { sameRow: Math.abs((tr.top + tr.bottom) / 2 - (a.top + a.bottom) / 2) <= 1, after: tr.left >= a.right - 0.5,
        title: t.title, href: t.querySelector('use')?.getAttribute('href') };
    });
    expect(rowToggle).toEqual({ sameRow: true, after: true, title: 'Collapse sidebar (Ctrl+B)', href: '#fp-chevron-left' });

    // Mica: the bar is transparent over the material, like the sidebar.
    await page.evaluate(() => { document.documentElement.dataset.mica = 'on'; });
    expect((await headerGeo(page)).headerBg).toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(() => { delete document.documentElement.dataset.mica; });

    // Light theme. The pointer leaves the collapse toggle it just clicked, so
    // the shots show no hover (Task 8 Q17).
    await parkPointer(page);
    await page.evaluate(() => applyTheme('light'));
    await windowShot(app, page, 'addendum-header-expanded-light');
    await page.evaluate(() => toggleSidebar());
    await windowShot(app, page, 'addendum-header-collapsed-light');
    await page.evaluate(() => toggleSidebar());
    await page.evaluate((t) => applyTheme(t), themeWas);

    // Maximized: still one bar, close still flush right; the maximise button
    // is now Restore.
    const isMax = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    await page.locator('#btn-maximize').click();
    await expect.poll(isMax).toBe(true);
    await expect(page.locator('#btn-maximize')).toHaveAttribute('aria-label', 'Restore');
    await page.waitForFunction(() => innerWidth > 1000);
    await frames(page);
    expectOneBar(await headerGeo(page), 'maximized');
    await windowShot(app, page, 'addendum-header-maximized');
    await page.locator('#btn-maximize').click();
    await expect.poll(isMax).toBe(false);
  } finally {
    await page.evaluate(() => localStorage.removeItem('fp-device-name')).catch(() => {});
    await app.close();
  }
  expectNoErrors(errors);
});

test('§1: a long device name ellipsizes at the cap with the full name in a tooltip; rename still works in the bar', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.evaluate(() => {
      if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar();
    });
    const name = page.locator('#device-name');
    await expect(name).toBeVisible();
    const long = 'The Extremely Long Workstation Name Of JJ Upstairs';
    await name.dblclick();
    await page.keyboard.type(long);
    await page.keyboard.press('Enter');
    await expect(name).toHaveText(long);
    expect(await page.evaluate(() => localStorage.getItem('fp-device-name'))).toBe(long);

    let g = await headerGeo(page);
    expectOneBar(g, 'long name, expanded');
    expect(g.nameClipped && g.nameEllipsis === 'ellipsis', 'expanded: the name ellipsizes inside the sidebar-wide card').toBe(true);
    expect(g.nameTitle).toContain(long);
    await windowShot(app, page, 'addendum-header-long-name-expanded');

    await page.evaluate(() => toggleSidebar());
    await frames(page);
    g = await headerGeo(page);
    expectOneBar(g, 'long name, collapsed');
    expect(g.name.width * g.zoom, 'the name caps at ~220 screen px').toBeLessThanOrEqual(221);
    expect(g.name.width * g.zoom).toBeGreaterThan(200);
    expect(g.nameClipped && g.nameEllipsis === 'ellipsis').toBe(true);
    await windowShot(app, page, 'addendum-header-long-name-collapsed');

    // Escape on a rename restores the current name.
    await name.dblclick();
    await page.keyboard.type('Scratch');
    await page.keyboard.press('Escape');
    await expect(name).toHaveText(long);

    // A single mouse press on the card keeps keyboard focus where it was
    // (the chrome mouse-focus model covers the bar).
    await page.evaluate(() => toggleSidebar());
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Bulk`);
    await settled(page);
    await rowByName(page, 'bulk-002.txt').click();
    const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.className);
    const before = await focused();
    await name.click();
    expect(await focused()).toBe(before);
    await page.evaluate(() => localStorage.removeItem('fp-device-name'));
  } finally {
    await app.close();
  }
  expectNoErrors(errors);
});

test('§1: at 800 px and at 150% zoom nothing in the bar clips; many tabs scroll under the fade; the sidebar handle is grabbable on both halves', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setDeviceName(page, "JJ's PC");
    await page.evaluate(() => {
      if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar();
    });
    const sizeWas = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const was = w.getSize();
      w.setSize(800, 600);
      return was;
    });
    await page.waitForFunction(() => innerWidth <= 800);
    await frames(page);
    expectOneBar(await headerGeo(page), '800px');
    await windowShot(app, page, 'addendum-header-800');

    // Many tabs: the strip scrolls with the fade; the caption buttons and a
    // grab-able drag region stay put.
    for (let i = 0; i < 9; i++) await page.locator('#btn-new-tab').click();
    await frames(page);
    let g = await headerGeo(page);
    expectOneBar(g, '800px, 10 tabs');
    const strip = await page.evaluate(() => {
      const s = document.getElementById('tabbar');
      const t = document.querySelector('.fp-tab--active').getBoundingClientRect();
      const r = s.getBoundingClientRect();
      return { scrolls: s.scrollWidth > s.clientWidth, activeInView: t.left >= r.left - 1 && t.right <= r.right + 1 };
    });
    expect(strip).toEqual({ scrolls: true, activeInView: true });
    // Scrolled to the start, tabs are clipped off the right: the fade shows.
    await page.evaluate(() => { document.getElementById('tabbar').scrollLeft = 0; });
    await expect(page.locator('#tabbar')).toHaveClass(/fp-tabbar--overflow/);
    await windowShot(app, page, 'addendum-header-800-many-tabs');

    // 150% zoom: the bar stays 44 screen px, the caption buttons 46 screen
    // px, nothing clips.
    const zoomTo = async (z) => {
      await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
      await page.waitForFunction((f) => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) - f) < 0.001
        && !window.__fpZoomBusy, z);
      await frames(page);
    };
    await zoomTo(1.5);
    g = await headerGeo(page);
    expectOneBar(g, '800px @150%');
    expect(near(g.card.width, g.sidebar.width), 'card = sidebar width @150%').toBe(true);
    await windowShot(app, page, 'addendum-header-800-zoom-150');
    await page.evaluate(() => toggleSidebar());
    await frames(page);
    expectOneBar(await headerGeo(page), '800px @150% collapsed');
    await windowShot(app, page, 'addendum-header-800-zoom-150-collapsed');
    await page.evaluate(() => toggleSidebar());
    // The extreme zoom: still one bar, nothing spills out of it.
    await zoomTo(2);
    expectOneBar(await headerGeo(page), '800px @200%');
    await zoomTo(1);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sizeWas);
    await page.waitForFunction((w) => innerWidth > 800, sizeWas[0]);
    await frames(page);

    // The sidebar resize handle straddles the panel edge and BOTH halves take
    // the pointer (its outer half used to be clipped by the sidebar).
    const handle = await page.evaluate(() => {
      const side = document.getElementById('sidebar').getBoundingClientRect();
      const h = document.getElementById('sidebar-resize-handle').getBoundingClientRect();
      const y = side.top + side.height / 2;
      return { inner: document.elementFromPoint(side.right - 2, y)?.id, outer: document.elementFromPoint(side.right + 2, y)?.id,
        straddles: h.left < side.right && h.right > side.right };
    });
    expect(handle).toEqual({ inner: 'sidebar-resize-handle', outer: 'sidebar-resize-handle', straddles: true });
    // A drag that starts on the outer half resizes.
    const sb = await page.locator('#sidebar').boundingBox();
    await page.mouse.move(sb.x + sb.width + 2, sb.y + 200);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width + 30, sb.y + 200, { steps: 4 });
    await page.mouse.move(sb.x + sb.width + 40, sb.y + 200, { steps: 4 });
    await page.mouse.up();
    const w = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().width);
    expect(near(w, sb.width + 38, 3), `dragged from the outer half (${sb.width} -> ${w})`).toBe(true);
    // The card followed the drag.
    const g2 = await headerGeo(page);
    expect(near(g2.card.width, g2.sidebar.width)).toBe(true);
  } finally {
    // The drag saved ui.sidebar_w: put the default back (awaited, so the
    // save lands before the app closes) — later specs size the toolbar off it.
    await page.evaluate(async () => {
      localStorage.removeItem('fp-device-name');
      localStorage.removeItem('fp-sidebar-width');
      setSidebarWidthVar(SIDEBAR_EXPANDED_DEFAULT);
      await saveSetting('ui.sidebar_w', SIDEBAR_EXPANDED_DEFAULT);
    }).catch(() => {});
    await app.close();
  }
  expectNoErrors(errors);
});

// §1 review round 1: the overflow fade follows the strip's own width (a
// sidebar collapse or drag resizes it with no window resize); the tabs leave
// drag room above them at every zoom; the sidebar top row's Tab order is the
// order it is drawn in.
test('§1: the tab fade follows the strip width; tabs keep drag room at 150%/200%; the top row tabs in visual order', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setDeviceName(page, "JJ's PC");
    await page.evaluate(() => {
      if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar();
    });
    const sizeWas = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const was = w.getSize();
      w.setSize(800, 600);
      return was;
    });
    await page.waitForFunction(() => innerWidth <= 800);
    // Five tabs: clipped beside the expanded sidebar's card, room to spare
    // beside the rail's narrower card.
    for (let i = 0; i < 4; i++) await page.locator('#btn-new-tab').click();
    await page.evaluate(() => { document.getElementById('tabbar').scrollLeft = 0; });
    const fade = () => page.evaluate(() => {
      const s = document.getElementById('tabbar');
      return { clipped: s.scrollWidth - s.clientWidth - s.scrollLeft > 1, faded: s.classList.contains('fp-tabbar--overflow') };
    });
    await expect.poll(fade).toEqual({ clipped: true, faded: true });
    await page.keyboard.press('Control+b');
    await expect(page.locator('#sidebar')).toHaveClass(/fp-sidebar--collapsed/);
    await expect.poll(fade, 'collapsed: the strip widened, the fade goes').toEqual({ clipped: false, faded: false });
    await page.keyboard.press('Control+b');
    await expect(page.locator('#sidebar')).not.toHaveClass(/fp-sidebar--collapsed/);
    // Narrowed again, the strip scrolls the active (last) tab back into view
    // (Task 8 Q4) — nothing is left to its right, so no fade until the strip
    // is scrolled back to the start.
    await expect.poll(fade, 'expanded again: the active tab is in view').toEqual({ clipped: false, faded: false });
    await page.evaluate(() => { document.getElementById('tabbar').scrollLeft = 0; });
    await expect.poll(fade, 'expanded again: the fade is back').toEqual({ clipped: true, faded: true });

    // Drag room: at every zoom the tabs (and the "+") stay at least 12 screen
    // px below the window's top edge, inside the bar, their labels uncut.
    const zoomTo = async (z) => {
      await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
      await page.waitForFunction((f) => Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-zoom')) - f) < 0.001
        && !window.__fpZoomBusy, z);
      await frames(page);
    };
    for (const z of [1, 1.5, 2]) {
      await zoomTo(z);
      const room = await page.evaluate(() => {
        const h = document.getElementById('header').getBoundingClientRect();
        return [...document.querySelectorAll('#tabbar .fp-tab, #btn-new-tab')].map((el) => {
          const r = el.getBoundingClientRect();
          const label = el.querySelector('.fp-tab__label');
          const lr = label?.getBoundingClientRect();
          return { above: r.top - h.top, below: h.bottom - r.bottom, labelInBar: !lr || (lr.top >= h.top && lr.bottom <= h.bottom + 0.5) };
        });
      });
      for (const r of room) {
        expect(r.above * z, `@${z}: drag room above a tab`).toBeGreaterThanOrEqual(11.5);
        expect(r.below, `@${z}: the tab sits inside the bar`).toBeGreaterThanOrEqual(-0.5);
        expect(r.labelInBar, `@${z}: the label stays inside the bar`).toBe(true);
      }
      expectOneBar(await headerGeo(page), `tab room @${z}`);
      if (z === 2) await windowShot(app, page, 'addendum-header-800-zoom-200');
    }
    await zoomTo(1);
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), sizeWas);

    // Tab order = visual order: expanded, Ask File+ then the toggle; on the
    // rail, the toggle (drawn above) then Ask File+.
    const tabFrom = async (id) => {
      await page.evaluate((i) => document.getElementById(i).focus(), id);
      await page.keyboard.press('Tab');
      return page.evaluate(() => document.activeElement?.id);
    };
    expect(await tabFrom('btn-ask-fileplus')).toBe('btn-sidebar-collapse');
    expect(await tabFrom('btn-sidebar-collapse')).toBe('nav-home');
    const drawn = () => page.evaluate(() => {
      const t = document.getElementById('btn-sidebar-collapse').getBoundingClientRect();
      const a = document.getElementById('btn-ask-fileplus').getBoundingClientRect();
      return t.top >= a.bottom - 0.5 ? 'ask-above' : t.left >= a.right - 0.5 ? 'ask-left' : t.bottom <= a.top + 0.5 ? 'toggle-above' : 'other';
    });
    expect(await drawn()).toBe('ask-left');
    await page.evaluate(() => toggleSidebar());
    expect(await drawn()).toBe('toggle-above');
    expect(await tabFrom('btn-sidebar-collapse')).toBe('btn-ask-fileplus');
    expect(await tabFrom('btn-ask-fileplus')).toBe('nav-home');
    await page.evaluate(() => toggleSidebar());
    expect(await drawn()).toBe('ask-left');
  } finally {
    await page.evaluate(() => localStorage.removeItem('fp-device-name')).catch(() => {});
    await app.close();
  }
  expectNoErrors(errors);
});
