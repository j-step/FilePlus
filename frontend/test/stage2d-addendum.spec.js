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
const { launchApp, apiGet, shot, rowByName, expectNoErrors, SHOTS } = require('./harness/app');

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
      'title bar': centre(document.querySelector('#titlebar .fp-titlebar__brand-name')) || centre(document.getElementById('titlebar')),
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
    // A short window, so the sidebar overflows and lays out its overlay
    // thumb (elementFromPoint ignores the thumb's fade, not its layout).
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
          await shot(page, `addendum-scrim-${name.replace(/\s+/g, '-')}-${theme}`);
          // Mica on, captured as is: the backing that makes the blur even is
          // in this capture too (transparent regions would show as sharp text).
          await page.screenshot({ path: path.join(SHOTS, `addendum-scrim-${name.replace(/\s+/g, '-')}-${theme}-mica.png`) });
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
