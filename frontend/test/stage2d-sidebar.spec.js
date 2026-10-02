// frontend/test/stage2d-sidebar.spec.js
// Stage 2D Task 9 (spec §9): the sidebar's typography and rhythm (11px
// section headers, hairline dividers, 28px items with 18px icons), the
// collapsed rail (40px squares, 22px icons, a This PC entry that shows the
// page is open), and the overlay scrollbar (fpOverlayScroll): no native bar,
// a thin thumb over the content that widens under the pointer, drags, pages,
// fades, and top/bottom fade cues while content is hidden. The same component
// on the inspector body and the Properties body (§9.3 ruling), keyboard focus
// rings on sidebar items and panel tabs (pass-2 #173), and the §12 sweep for
// permanent bars / x-overflow in the settings screen, search popovers,
// context menus and the Ask File+ popout at 800 px and zoom 1.5.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp, apiGet, SHOTS, rowByName } = require('./harness/app');

test.setTimeout(240_000);

/** The whole window as the user sees it, with Mica flattened (its regions are
 * transparent in a capture). Same helper as stage2d-views.spec.js. */
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

async function frames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function setZoom(app, page, z) {
  await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(f), z);
  await page.waitForFunction((f) => Math.abs(window.electronAPI.getZoom() - f) < 0.001, z);
  await frames(page);
}

async function setSize(app, page, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s.w, s.h), { w, h });
  // The renderer has the new size (CSS px x zoom = window px), then layout
  // and the overlay scrollbars' observers have run.
  await page.waitForFunction((cw) => Math.abs(window.innerWidth * window.electronAPI.getZoom() - cw) <= 2, w, { timeout: 5000 });
  await frames(page);
  await frames(page);
}

/** Elements under `selector` (inclusive) that show a horizontal scrollbar or
 * clip content sideways without an ellipsis: scrollWidth past clientWidth on
 * anything whose overflow-x is not hidden/clip. */
async function xOverflow(page, selector) {
  return page.evaluate((sel) => [...document.querySelectorAll(`${sel}, ${sel} *`)]
    .filter((e) => {
      if (!e.getClientRects().length || e.clientWidth === 0) return false;
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') return false;
      return e.scrollWidth > e.clientWidth + 1;
    })
    .map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).replace(/\s+/g, '.')} ${e.scrollWidth}>${e.clientWidth}`), selector);
}

/** Elements under `selector` that reserve a scrollbar's width (a permanent
 * or a currently-shown native bar) — offsetWidth past clientWidth+borders on
 * an element that scrolls, or overflow:scroll. */
async function nativeBars(page, selector) {
  return page.evaluate((sel) => [...document.querySelectorAll(`${sel}, ${sel} *`)]
    .filter((e) => {
      if (!e.getClientRects().length) return false;
      const cs = getComputedStyle(e);
      if (cs.overflowY === 'scroll' || cs.overflowX === 'scroll') return true;
      if (!['auto', 'scroll'].includes(cs.overflowY) && !['auto', 'scroll'].includes(cs.overflowX)) return false;
      const bx = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
      const by = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      return e.offsetWidth - e.clientWidth - bx > 1 || e.offsetHeight - e.clientHeight - by > 1;
    })
    .map((e) => `${e.tagName.toLowerCase()}#${e.id}.${String(e.className).replace(/\s+/g, '.')}`), selector);
}

test('sidebar: 11px headers, hairline dividers, 28px items, overlay scrollbar with scroll cues, bigger rail icons', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.waitForFunction(() => document.querySelectorAll('#sb-drives .fp-sidebar__item').length > 0);
    const sc = page.locator('.fp-sidebar__scroll');

    // ── Typography and rhythm (§9.1) ────────────────────────────────────────
    const label = await page.locator('.fp-sidebar__section-label').first().evaluate((e) => {
      const cs = getComputedStyle(e);
      const probe = document.createElement('span');
      probe.style.color = 'var(--text-secondary)';
      document.body.appendChild(probe);
      const secondary = getComputedStyle(probe).color;
      probe.remove();
      return { size: cs.fontSize, line: cs.lineHeight, weight: cs.fontWeight, track: cs.letterSpacing,
        transform: cs.textTransform, color: cs.color, secondary };
    });
    expect(label.size).toBe('11px');
    expect(label.line).toBe('16px');
    expect(label.weight).toBe('600');
    expect(label.transform).toBe('uppercase');
    expect(parseFloat(label.track)).toBeCloseTo(0.44, 2);
    expect(label.color).toBe(label.secondary);
    // Every section header (This PC's in its head too) is the same type.
    const sizes = await page.$$eval('.fp-sidebar__section-label', (els) => [...new Set(els.map((e) => getComputedStyle(e).fontSize))]);
    expect(sizes).toEqual(['11px']);

    // Hairline dividers between the sections, inset 12px from the panel.
    expect(await page.locator('.fp-sidebar__divider').count()).toBeGreaterThanOrEqual(3);
    const dividers = await page.evaluate(() => {
      const side = document.getElementById('sidebar').getBoundingClientRect();
      const probe = document.createElement('span');
      probe.style.color = 'var(--border-subtle)';
      document.body.appendChild(probe);
      const subtle = getComputedStyle(probe).color;
      probe.remove();
      return [...document.querySelectorAll('.fp-sidebar__divider')].filter((d) => d.getClientRects().length).map((d) => {
        const r = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        return { h: r.height, left: r.left - side.left, right: side.right - 1 - r.right, bg: cs.backgroundColor, subtle,
          mt: cs.marginTop, mb: cs.marginBottom, role: d.getAttribute('role') };
      });
    });
    expect(dividers.length).toBeGreaterThanOrEqual(2);
    for (const d of dividers) {
      expect(d.h).toBe(1);
      expect(d.bg).toBe(d.subtle);
      expect(d.role).toBe('separator');
      expect(Math.abs(d.left - 12)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.right - 12)).toBeLessThanOrEqual(1);
      expect([d.mt, d.mb]).toEqual(['6px', '4px']);
    }
    // The expanded This PC header shows its own label: no tooltip.
    expect(await page.locator('#sb-thispc .fp-sidebar__section-head').getAttribute('title')).toBeNull();
    // The Tags divider comes and goes with the Tags section.
    expect(await page.evaluate(() => document.getElementById('sb-tags-divider').hidden
      === document.getElementById('sb-tags-label').hidden)).toBe(true);
    // The old section margin-top gap is gone.
    expect(await page.$$eval('.fp-sidebar__scroll > .fp-sidebar__section-label, .fp-sidebar__scroll > .fp-sidebar__section',
      (els) => els.map((e) => getComputedStyle(e).marginTop).filter((m) => m !== '0px'))).toEqual([]);

    // Items: 28px high, 8px padding, an 18px icon, an 8px gap, a 13px label.
    const item = await page.locator('#nav-home').evaluate((e) => {
      const cs = getComputedStyle(e);
      const ic = e.querySelector('.fp-icon').getBoundingClientRect();
      return { h: e.getBoundingClientRect().height, pad: cs.paddingLeft, gap: cs.columnGap, icon: ic.width,
        font: getComputedStyle(e.querySelector('.fp-sidebar__item__label')).fontSize };
    });
    expect(item).toEqual({ h: 28, pad: '8px', gap: '8px', icon: 18, font: '13px' });
    // Shell / sprite icons on the dynamic rows are 18 too.
    expect(await page.$$eval('#sb-drives .fp-sidebar__item > .fp-icon:not(.fp-sidebar__drive-letter)',
      (els) => els.filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().width)))).toEqual(
      expect.arrayContaining([18]));
    // Drive mini-bars stay 3px.
    expect(await page.locator('.fp-sidebar__drive-bar').first().evaluate((e) => e.getBoundingClientRect().height)).toBe(3);

    // ── Scrolling (§9.3): only the scroller scrolls, nothing is wider ───────
    expect(await page.locator('#sidebar').evaluate((e) => getComputedStyle(e).overflowY)).toBe('hidden');
    expect(await page.locator('#sidebar').evaluate((e) => getComputedStyle(e).overflowX)).toBe('hidden');
    expect(await sc.evaluate((e) => getComputedStyle(e).overflowX)).toBe('hidden');
    expect(await xOverflow(page, '.fp-sidebar')).toEqual([]);
    // A long drive / pin name ellipsizes instead of widening the panel.
    await page.evaluate(() => {
      const l = document.querySelector('#sb-drives .fp-sidebar__item__label');
      l.dataset.was = l.textContent;
      l.textContent = 'Seagate Barracuda 4tb HDD with a very long label indeed (D:)';
    });
    expect(await xOverflow(page, '.fp-sidebar')).toEqual([]);
    expect(await page.locator('#sb-drives .fp-sidebar__item__label').first().evaluate((e) => getComputedStyle(e).textOverflow)).toBe('ellipsis');
    await page.evaluate(() => { const l = document.querySelector('#sb-drives .fp-sidebar__item__label'); l.textContent = l.dataset.was; });
    // The overlay takes no layout width.
    expect(await sc.evaluate((e) => e.offsetWidth - e.clientWidth)).toBe(0);
    expect(await sc.evaluate((e) => getComputedStyle(e).scrollbarWidth)).toBe('none');
    // Fits: no thumb, no cue.
    await expect(page.locator('.fp-sidebar .fp-oscroll')).toHaveClass(/is-none/);
    await expect(sc).not.toHaveClass(/is-scroll-(top|bottom)/);
    await windowShot(app, page, 'sidebar-expanded');

    // ── Overflow: a short window ────────────────────────────────────────────
    await setSize(app, page, 1100, 420); // clamped to the 500 px minHeight
    expect(await sc.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(page.locator('.fp-sidebar .fp-oscroll')).not.toHaveClass(/is-none/);
    expect(await sc.evaluate((e) => e.offsetWidth - e.clientWidth)).toBe(0);
    await expect(sc).toHaveClass(/is-scroll-bottom/);
    await expect(sc).not.toHaveClass(/is-scroll-top/);
    const maskBottom = await sc.evaluate((e) => getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage);
    expect(maskBottom).toMatch(/linear-gradient/);
    expect(maskBottom).toMatch(/20px/);

    // The track hugs the panel's right edge, over the content, under the
    // resize handle (which still wins its inner half — Task 6's known bug).
    const geo = await page.evaluate(() => {
      const side = document.getElementById('sidebar').getBoundingClientRect();
      const track = document.querySelector('.fp-sidebar .fp-oscroll').getBoundingClientRect();
      const thumb = document.querySelector('.fp-sidebar .fp-oscroll__thumb').getBoundingClientRect();
      const scr = document.querySelector('.fp-sidebar__scroll').getBoundingClientRect();
      const hit = document.elementFromPoint(side.right - 2, scr.top + scr.height / 2);
      const item = document.getElementById('nav-home').getBoundingClientRect();
      const onItem = document.elementFromPoint(item.right - 2, item.top + item.height / 2);
      return { sideRight: side.right - 1, trackRight: track.right, trackW: track.width, thumbRight: thumb.right, thumbW: thumb.width,
        trackTop: track.top, scrTop: scr.top, trackH: track.height, scrH: scr.height, handle: hit && hit.id,
        itemRight: item.right, onItem: onItem && onItem.closest('.fp-sidebar__item')?.id };
    });
    // The track is the thumb's own column, 3px in from the edge, and it
    // never reaches an item: a press on an item's right edge is the item's.
    expect(Math.abs(geo.trackRight - (geo.sideRight - 3))).toBeLessThanOrEqual(1);
    expect(geo.trackW).toBe(7);
    expect(geo.itemRight).toBeLessThanOrEqual(geo.trackRight - geo.trackW + 0.5);
    expect(geo.onItem).toBe('nav-home');
    expect(geo.sideRight - geo.thumbRight).toBeLessThanOrEqual(4);
    expect(geo.thumbW).toBe(3);
    expect(Math.abs(geo.trackTop - geo.scrTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(geo.trackH - geo.scrH)).toBeLessThanOrEqual(1);
    expect(geo.handle).toBe('sidebar-resize-handle');

    // Hidden until the panel is hovered, then visible; fades 900 ms after the
    // last scroll once the pointer is elsewhere.
    const track = page.locator('.fp-sidebar .fp-oscroll');
    await page.mouse.move(700, 300);
    await expect(track).not.toHaveClass(/is-visible/);
    const sbox = await page.locator('#sidebar').boundingBox();
    await page.mouse.move(sbox.x + 60, sbox.y + sbox.height / 2);
    await expect(track).toHaveClass(/is-visible/);
    await windowShot(app, page, 'sidebar-scroll-cue');
    await page.mouse.move(700, 300);
    await expect(track).not.toHaveClass(/is-visible/);
    const scrolledAt = await sc.evaluate((e) => { e.scrollTop = 20; return performance.now(); });
    await expect(track).toHaveClass(/is-visible/);
    // It stays up for the fade delay (900 ms) after the last scroll, then
    // goes: measured, so a slow machine can only make it look longer, never
    // fail it (it used to sleep 500 ms and expect it still up).
    await page.waitForFunction(() => !document.querySelector('.fp-sidebar .fp-oscroll').classList.contains('is-visible'),
      null, { timeout: 5000 });
    expect(await page.evaluate((t) => performance.now() - t, scrolledAt)).toBeGreaterThanOrEqual(850);
    await expect(sc).toHaveClass(/is-scroll-top/);
    await expect(sc).toHaveClass(/is-scroll-bottom/);
    const maskBoth = await sc.evaluate((e) => getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage);
    expect(maskBoth).toMatch(/calc\(100% - 20px\)/);
    await sc.evaluate((e) => { e.scrollTop = 0; });

    // Thumb widens on hover of its hot zone.
    const thumb = page.locator('.fp-sidebar .fp-oscroll__thumb');
    const w0 = await thumb.evaluate((e) => e.getBoundingClientRect().width);
    let tb = await thumb.boundingBox();
    const thumbW = () => thumb.evaluate((e) => e.getBoundingClientRect().width);
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 5);
    await expect.poll(thumbW).toBe(7);
    expect(w0).toBe(3);
    // …and from 8px inside the edge (the hot zone is 10px wide).
    await page.mouse.move(700, 300);
    await expect.poll(thumbW).toBe(3);
    await page.mouse.move(geo.sideRight - 8, tb.y + 5);
    await expect.poll(thumbW).toBe(7);

    // Dragging the thumb scrolls; it keeps the hot width while dragging.
    tb = await thumb.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2 + 30, { steps: 5 });
    expect(await sc.evaluate((e) => e.scrollTop)).toBeGreaterThan(10);
    await page.mouse.move(tb.x - 80, tb.y + tb.height / 2 + 30, { steps: 3 });
    expect(await thumb.evaluate((e) => e.getBoundingClientRect().width)).toBe(7);
    await page.mouse.up();
    // A press on the track below the thumb pages down; above it pages up.
    await sc.evaluate((e) => { e.scrollTop = 0; });
    await frames(page);
    tb = await thumb.boundingBox();
    const tr = await track.boundingBox();
    await page.mouse.click(tb.x + tb.width / 2, tr.y + tr.height - 4);
    const paged = await sc.evaluate((e) => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight, h: e.clientHeight }));
    expect(paged.top).toBeGreaterThanOrEqual(Math.min(paged.max, paged.h * 0.8) - 1);
    // A wheel over the track scrolls the content under it.
    await sc.evaluate((e) => { e.scrollTop = 0; });
    await page.mouse.move(tb.x + tb.width / 2, tr.y + tr.height / 2);
    await page.mouse.wheel(0, 60);
    await expect.poll(() => sc.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);

    // At the bottom: the top cue only.
    await sc.evaluate((e) => { e.scrollTop = e.scrollHeight; });
    // (Both class checks retry until the scroll handler has run.)
    await expect(sc).toHaveClass(/is-scroll-top/);
    await expect(sc).not.toHaveClass(/is-scroll-bottom/);
    const maskTop = await sc.evaluate((e) => getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage);
    expect(maskTop).toMatch(/linear-gradient/);
    expect(maskTop).not.toMatch(/calc\(100% - 20px\)/);

    // Dynamic sections update the thumb (a MutationObserver/ResizeObserver).
    await sc.evaluate((e) => { e.scrollTop = 0; });
    const h0 = await thumb.evaluate((e) => e.getBoundingClientRect().height);
    await page.evaluate(() => {
      const c = document.getElementById('sb-pinned-folders');
      c.insertAdjacentHTML('beforeend', Array.from({ length: 12 }, (_, i) =>
        `<button class="fp-sidebar__item fp-test-pad"><span class="fp-sidebar__item__label">Pad ${i}</span></button>`).join(''));
    });
    await expect.poll(() => thumb.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(h0);
    await page.evaluate(() => document.querySelectorAll('.fp-test-pad').forEach((e) => e.remove()));

    // Light theme and over Mica: the thumb is a tinted text colour that reads
    // over either backdrop (never fully transparent).
    await page.mouse.move(sbox.x + 60, sbox.y + 200);
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await frames(page);
      expect(await thumb.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
      await windowShot(app, page, `sidebar-scroll-cue-${theme}`);
    }

    // ── Collapsed rail (§9.2) ───────────────────────────────────────────────
    // A short window, so the rail overflows and its thumb is live.
    await setSize(app, page, 1100, 420);
    await page.keyboard.press('Control+b');
    await expect(page.locator('#sidebar')).toHaveClass(/fp-sidebar--collapsed/);
    await expect.poll(() => sc.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(page.locator('.fp-sidebar .fp-oscroll')).not.toHaveClass(/is-none/);
    // The rail's thumb column sits in the gutter beside the squares: a press
    // 2px inside a square's right edge reaches the square and navigates.
    const qa = page.locator('#sb-quick-access-folders .fp-sidebar__item').first();
    const qaPath = await qa.getAttribute('data-path');
    const railHit = await qa.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const t = document.querySelector('.fp-sidebar .fp-oscroll').getBoundingClientRect();
      const hit = document.elementFromPoint(r.right - 2, r.top + r.height / 2);
      return { own: !!hit && b.contains(hit), x: r.right - 2, y: r.top + r.height / 2, gap: t.left - r.right };
    });
    expect(railHit.own).toBe(true);
    expect(railHit.gap).toBeGreaterThanOrEqual(0);
    const top0 = await sc.evaluate((e) => e.scrollTop);
    await page.mouse.click(railHit.x, railHit.y);
    await expect.poll(() => page.evaluate(() => activeTab().path)).toBe(qaPath);
    expect(await sc.evaluate((e) => e.scrollTop)).toBe(top0);
    // …and the rail's thumb itself still drags.
    await sc.evaluate((e) => { e.scrollTop = 0; });
    await frames(page);
    const rt = await thumb.boundingBox();
    await page.mouse.move(rt.x + rt.width / 2, rt.y + rt.height / 2);
    await page.mouse.down();
    await page.mouse.move(rt.x + rt.width / 2, rt.y + rt.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    expect(await sc.evaluate((e) => e.scrollTop)).toBeGreaterThan(5);
    await windowShot(app, page, 'sidebar-collapsed-overflow');
    await page.evaluate(() => switchScreen('home'));
    await setSize(app, page, 1200, 800);
    expect(await page.locator('.fp-sidebar__item .fp-icon').first().evaluate((e) => e.getBoundingClientRect().width)).toBe(22);
    const rail = await page.evaluate(() => {
      const side = document.getElementById('sidebar').getBoundingClientRect();
      const items = [...document.querySelectorAll('#sidebar .fp-sidebar__item, #sidebar .fp-sidebar__tags-collapsed, #sb-thispc .fp-sidebar__section-head')]
        .filter((e) => e.getClientRects().length);
      return {
        width: side.width * window.electronAPI.getZoom(),
        sizes: [...new Set(items.map((e) => { const r = e.getBoundingClientRect(); return `${r.width}x${r.height}`; }))],
        untitled: items.filter((e) => !e.getAttribute('title')).map((e) => e.id || e.className),
        icons: [...new Set([...document.querySelectorAll('#sidebar .fp-sidebar__scroll .fp-icon, #sidebar .fp-sidebar__bottom .fp-icon')]
          .filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().width))],
        dividers: [...document.querySelectorAll('.fp-sidebar__divider')].filter((d) => d.getClientRects().length)
          .map((d) => d.getBoundingClientRect().width),
        badge: document.querySelector('.fp-sidebar__drive-letter').getBoundingClientRect().height,
        labels: [...document.querySelectorAll('.fp-sidebar__section-label')].filter((e) => e.getClientRects().length).length,
      };
    });
    expect(Math.abs(rail.width - 52)).toBeLessThanOrEqual(1);
    expect(rail.sizes).toEqual(['40x40']);
    expect(rail.untitled).toEqual([]);
    expect(rail.icons).toEqual([22]);
    expect(rail.badge).toBe(22);
    expect(rail.labels).toBe(0);
    for (const w of rail.dividers) expect(Math.abs(w - (rail.width - 16))).toBeLessThanOrEqual(1);
    expect(await xOverflow(page, '.fp-sidebar')).toEqual([]);
    await windowShot(app, page, 'sidebar-collapsed');

    // The rail's This PC entry shows the page is open.
    const railPc = page.locator('#sb-thispc .fp-sidebar__section-head');
    await expect(railPc).toHaveAttribute('title', 'This PC');
    await railPc.click();
    await expect(railPc).toHaveClass(/fp-sidebar__section-head--active/);
    await expect(railPc).toHaveAttribute('aria-current', 'page');
    const pcColour = await railPc.evaluate((e) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { icon: getComputedStyle(e.querySelector('.fp-sidebar__section-icon')).color, accent,
        bg: getComputedStyle(e).backgroundColor };
    });
    expect(pcColour.icon).toBe(pcColour.accent);
    expect(pcColour.bg).not.toBe('rgba(0, 0, 0, 0)');
    await windowShot(app, page, 'sidebar-collapsed-thispc');

    // Rail at zoom 1.5: still no sideways overflow, items capped by the rail.
    await setZoom(app, page, 1.5);
    expect(await xOverflow(page, '.fp-sidebar')).toEqual([]);
    await setZoom(app, page, 1);

    await page.keyboard.press('Control+b');
    await expect(page.locator('#sidebar')).not.toHaveClass(/fp-sidebar--collapsed/);
    // Expanded again: the This PC head's own icon is hidden.
    expect(await page.locator('#sb-thispc .fp-sidebar__section-icon').evaluate((e) => e.getClientRects().length)).toBe(0);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
    await page.evaluate(() => { if (document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed')) toggleSidebar(); }).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('sidebar items and panel tabs show a keyboard focus ring (pass-2 #173); the overlay never takes focus', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const accent = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    // Keyboard: from the Ask File+ pill, Tab lands on Home.
    await page.locator('#btn-ask-fileplus').focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const a = document.activeElement;
      const cs = getComputedStyle(a);
      return { id: a.id, style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
    expect(ring.id).toBe('nav-home');
    expect(ring.style).toBe('solid');
    expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(1);
    expect(ring.color).toBe(accent);

    // The inspector's tabs (fp-tabs__item) too.
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await page.locator('.fp-inspector__tab').first().focus();
    await page.keyboard.press('Tab');
    const tabRing = await page.evaluate(() => {
      const a = document.activeElement;
      const cs = getComputedStyle(a);
      return { cls: a.className, style: cs.outlineStyle, color: cs.outlineColor };
    });
    expect(tabRing.cls).toMatch(/fp-inspector__tab/);
    expect(tabRing.style).toBe('solid');
    expect(tabRing.color).toBe(accent);

    // The window tab strip too, drawn inside the tab: .fp-tabbar clips
    // anything outside it (overflow-y:hidden).
    await page.keyboard.press('Shift');
    const winTab = await page.evaluate(() => {
      const t = document.querySelector('.fp-tab');
      t.focus();
      const cs = getComputedStyle(t);
      return { visible: t.matches(':focus-visible'), style: cs.outlineStyle, color: cs.outlineColor, offset: cs.outlineOffset,
        clip: getComputedStyle(document.querySelector('.fp-tabbar')).overflowY };
    });
    expect(winTab.visible).toBe(true);
    expect(winTab.style).toBe('solid');
    expect(winTab.color).toBe(accent);
    expect(winTab.offset).toBe('-1px');
    expect(winTab.clip).toBe('hidden');

    // A mouse press on a sidebar item keeps focus where it was (Task 7), and
    // the overlay track/thumb are never focusable.
    expect(await page.$$eval('.fp-oscroll, .fp-oscroll *', (els) => els.filter((e) => e.tabIndex >= 0).length)).toBe(0);
    expect(await page.$$eval('.fp-oscroll', (els) => els.every((e) => e.getAttribute('aria-hidden') === 'true'))).toBe(true);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('the inspector body and the Properties body use the overlay scrollbar (§9.3 ruling)', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    for (const sel of ['#inspector-body', '#properties-modal .properties__body']) {
      const info = await page.locator(sel).evaluate((e) => ({
        host: e.classList.contains('fp-oscroll-host'),
        sibling: !!(e.nextElementSibling && e.nextElementSibling.classList.contains('fp-oscroll')),
        bar: getComputedStyle(e).scrollbarWidth,
      }));
      expect(info, sel).toEqual({ host: true, sibling: true, bar: 'none' });
    }

    // The inspector body overflowing (a short window) shows the bottom cue
    // and no native bar; the track hugs the inspector's right edge.
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Views`);
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll .fp-row').length > 0);
    await page.locator('#list-scroll .fp-row').first().click();
    await setSize(app, page, 1100, 420);
    const body = page.locator('#inspector-body');
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await expect(body).toHaveClass(/is-scroll-bottom/);
    expect(await body.evaluate((e) => e.offsetWidth - e.clientWidth)).toBe(0);
    const edge = await page.evaluate(() => ({
      insp: document.getElementById('inspector').getBoundingClientRect().right,
      track: document.querySelector('#inspector .fp-oscroll').getBoundingClientRect().right,
    }));
    expect(Math.abs(edge.insp - 3 - edge.track)).toBeLessThanOrEqual(1);
    const ib = await page.locator('#inspector').boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height - 80);
    await expect(page.locator('#inspector .fp-oscroll')).toHaveClass(/is-visible/);
    await windowShot(app, page, 'inspector-overlay-scroll');
    await setSize(app, page, 1200, 800);

    // Properties: open on a file; its body never reserves a native bar.
    const file = await page.evaluate(() => [...document.querySelectorAll('#list-scroll .fp-row')]
      .map((r) => r.dataset.path).find((p) => p && /\.\w+$/.test(p)));
    // openProperties() resolves once the modal is rendered and shown.
    await page.evaluate((p) => openProperties(p), file);
    await page.waitForFunction(() => document.getElementById('properties-modal-scrim').style.display !== 'none');
    await frames(page);
    await page.waitForFunction(() => window.__fpIconsIdle());
    expect(await nativeBars(page, '#properties-modal')).toEqual([]);
    expect(await xOverflow(page, '#properties-modal')).toEqual([]);
    await page.evaluate(() => closeProperties());
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('sweep (§12): no permanent bars or sideways overflow in settings, search popovers, context menus, Ask File+ at 800 px and zoom 1.5', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await setSize(app, page, 800, 600);
    const offenders = [];
    for (const z of [1, 1.5]) {
      await setZoom(app, page, z);
      const tag = (s) => `${s} @${z}`;

      // Settings screen, every section — inspector open, the narrowest case.
      await page.evaluate(() => setInspectorOpen(true, { persist: false }));
      await page.evaluate(() => switchScreen('settings'));
      await frames(page);
      const navs = await page.locator('.settings-nav__item').count();
      for (let i = 0; i < navs; i++) {
        await page.locator('.settings-nav__item').nth(i).click();
        await frames(page);
        for (const o of await xOverflow(page, '#screen-settings')) offenders.push(tag(`settings x: ${o}`));
        for (const o of await nativeBars(page, '#screen-settings')) offenders.push(tag(`settings bar: ${o}`));
        // The content is never squeezed to nothing: at least 200px of it,
        // all reachable by scrolling the layout (or the content itself).
        const room = await page.evaluate(() => {
          const lay = document.querySelector('#screen-settings .settings-layout');
          const c = lay.querySelector('.settings-content');
          const scroller = lay.scrollHeight > lay.clientHeight + 1 ? lay : c;
          return { h: c.getBoundingClientRect().height, reach: scroller.scrollHeight - scroller.clientHeight >= 0,
            narrow: getComputedStyle(lay).flexDirection === 'column', lay: lay.scrollHeight, nav: lay.querySelector('.settings-nav').offsetHeight };
        });
        if (room.h < 200) offenders.push(tag(`settings content only ${Math.round(room.h)}px tall`));
        if (room.narrow && room.lay < room.nav + 200) offenders.push(tag('settings content unreachable'));
        if (i === 0) await windowShot(app, page, `sweep-settings-z${Math.round(z * 100)}`);
      }

      // Browser: a context menu on a row and on the background.
      await page.evaluate((p) => openBrowserAt(p), `${root}\\Views`);
      await page.waitForFunction(() => document.querySelectorAll('#list-scroll .fp-row').length > 0);
      await page.locator('#list-scroll .fp-row').first().click({ button: 'right' });
      await expect(page.locator('#context-menu')).toBeVisible();
      for (const o of await xOverflow(page, '#context-menu')) offenders.push(tag(`menu x: ${o}`));
      for (const o of await nativeBars(page, '#context-menu')) offenders.push(tag(`menu bar: ${o}`));
      const menuBox = await page.locator('#context-menu').boundingBox();
      const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      if (menuBox.x < 0 || menuBox.x + menuBox.width > vp.w + 1) offenders.push(tag('menu off-window'));
      await page.keyboard.press('Escape');

      // Search dropdown.
      await page.evaluate(() => { focusSearchInput(); openSearchDropdown(); });
      await frames(page);
      await expect(page.locator('#search-dropdown')).toBeVisible();
      for (const o of await xOverflow(page, '#search-dropdown')) offenders.push(tag(`search dd x: ${o}`));
      for (const o of await nativeBars(page, '#search-dropdown')) offenders.push(tag(`search dd bar: ${o}`));
      if (z === 1.5) await windowShot(app, page, 'sweep-search-dropdown-z150');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      // More filters modal.
      await page.evaluate(() => openMoreFilters());
      await frames(page);
      for (const o of await xOverflow(page, '#search-filters-modal')) offenders.push(tag(`filters x: ${o}`));
      for (const o of await nativeBars(page, '#search-filters-modal')) offenders.push(tag(`filters bar: ${o}`));
      await page.evaluate(() => closeMoreFilters());

      // Ask File+ popout.
      await page.evaluate(() => openAskPopout());
      await frames(page);
      for (const o of await xOverflow(page, '#ask-popout')) offenders.push(tag(`ask x: ${o}`));
      for (const o of await nativeBars(page, '#ask-popout')) offenders.push(tag(`ask bar: ${o}`));
      const ask = await page.locator('#ask-popout').boundingBox();
      if (ask.x < 0 || ask.x + ask.width > vp.w + 1 || ask.y + ask.height > vp.h + 1) offenders.push(tag('ask off-window'));
      if (z === 1.5) await windowShot(app, page, 'sweep-ask-z150');
      await page.evaluate(() => closeAskPopout());
    }
    expect(offenders).toEqual([]);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)).catch(() => {});
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800)).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});
