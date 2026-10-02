// frontend/test/stage2d-icons.spec.js
// Stage 2D Task 4 (spec §4): icons without flashing. In Windows-icon mode a
// revisited folder paints every visible row icon as a settled shell bitmap in
// the same task as its render (no sprite, no blank first frame); a never-seen
// folder shows empty slots or the generic folder icon, never the FilePlus
// sprite, and a plain sub-folder's icon never changes once painted; requests
// go out at px buckets and a size change never changes an icon's box after
// the reflow; Properties shows the file-TYPE icon (never the thumbnail); and
// every item icon site carries a shell <img>.
const { test, expect } = require('@playwright/test');
const { launchApp, shot, rowByName, apiGet, API, apiHeaders } = require('./harness/app');

test.setTimeout(180_000);

// Installed in the page as window.__fpSampleRows (the renderer's CSP forbids
// eval): one record per row that is actually on screen in #list-scroll (an
// off-screen row is lazily resolved by design).
function installSampler(page) {
  return page.evaluate(() => {
    window.__fpSampleRows = () => {
      const list = document.getElementById('list-scroll');
      const box = list.getBoundingClientRect();
      return [...list.querySelectorAll('.fp-row')].filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > box.top && b.top < box.bottom;
      }).map((r) => {
        const img = r.querySelector('img[data-win-icon], img.fp-thumb');
        const sprite = r.querySelector('svg.fp-icon');
        return {
          name: r.querySelector('.fp-row__name')?.textContent || '',
          settled: !!img && img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:image/gif'),
          spriteVisible: !!sprite && getComputedStyle(sprite).visibility !== 'hidden',
          src: img ? img.src : '',
        };
      });
    };
  });
}

async function iconsSettled(page) {
  await page.waitForFunction(() => {
    const list = document.getElementById('list-scroll');
    if (!list || !list.querySelector('.fp-row')) return false;
    return !list.querySelector('img[data-win-icon][data-fp-lazy="pending"], img.fp-thumb[data-fp-lazy="pending"]')
      && __fpLoadPending === 0;
  }, null, { timeout: 8000 });
  // Every visible row's icon slot has its bitmap (or its definitive sprite).
  await page.waitForFunction(() => {
    const rows = window.__fpSampleRows();
    return rows.length > 0 && rows.every((r) => r.settled || r.spriteVisible);
  }, null, { timeout: 8000 });
}

test('Windows-icon mode paints without flashing (Stage 2D §4)', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const docsDir = `${root}\\_gen\\Documents`;
    const picsDir = `${root}\\_gen\\Pictures`;
    const iconsDir = `${root}\\Icons`;
    const freshDir = `${iconsDir}\\Fresh`;
    const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
    await installSampler(page);
    const bucket = (px) => page.evaluate((p) => fpIconBucket(p), px);

    // Settings ▸ Personalization ▸ File icons = Windows, the way a user sets it.
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    expect(await page.evaluate(() => fpIconSource())).toBe('windows');
    expect(await page.evaluate(() => fpShellIconRoute())).toBe('live');

    // -- 1. Revisit: settled shell bitmaps in the render's own task --------
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await iconsSettled(page);
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await iconsSettled(page);
    const revisit = await page.evaluate(async ({ p }) => {
      await openBrowserAt(p); // resolves right after the single render
      const same = window.__fpSampleRows();
      const frame = await new Promise((r) => requestAnimationFrame(() => r(window.__fpSampleRows())));
      return { same, frame, view: browserState.view };
    }, { p: docsDir });
    expect(revisit.view).toBe('details');
    expect(revisit.same.length).toBeGreaterThan(5);
    expect(revisit.same.filter((s) => !s.settled).map((s) => s.name)).toEqual([]);
    expect(revisit.same.some((s) => s.spriteVisible)).toBe(false);
    expect(revisit.frame.every((s) => s.settled)).toBe(true);
    expect(revisit.frame.some((s) => s.spriteVisible)).toBe(false);

    // Same in grid (Pictures decides Large icons): the thumbnail itself is
    // the settled image on a revisit, with no type icon under it.
    const revisitGrid = await page.evaluate(async ({ p }) => {
      await openBrowserAt(p);
      return { same: window.__fpSampleRows(), view: browserState.view };
    }, { p: picsDir });
    expect(revisitGrid.view).toBe('grid');
    expect(revisitGrid.same.length).toBeGreaterThanOrEqual(6);
    expect(revisitGrid.same.filter((s) => !s.settled).map((s) => s.name)).toEqual([]);
    expect(revisitGrid.same.some((s) => s.spriteVisible)).toBe(false);
    expect(revisitGrid.same.every((s) => s.src.startsWith('data:image/png'))).toBe(true);
    await shot(page, 'stage2d-icons-grid-revisit');

    // -- 2. Never-seen folder: no sprite at any sample; plain sub-folders
    // paint the generic folder icon at once and it never changes ----------
    const first = await page.evaluate(async ({ p }) => {
      const samples = [];
      await openBrowserAt(p);
      samples.push(window.__fpSampleRows());
      for (const ms of [16, 50, 200]) {
        await new Promise((r) => setTimeout(r, ms));
        samples.push(window.__fpSampleRows());
      }
      return samples;
    }, { p: freshDir });
    for (const sample of first) expect(sample.some((s) => s.spriteVisible)).toBe(false);
    const subSrc0 = first[0].filter((s) => /^Sub\d$/.test(s.name));
    expect(subSrc0).toHaveLength(3);
    for (const s of subSrc0) expect(s.src).toMatch(/^data:image\/png/); // the generic, painted with the row
    await iconsSettled(page);
    await page.waitForTimeout(1500); // the per-path answers have long landed
    const subSrcLate = (await page.evaluate(() => window.__fpSampleRows()))
      .filter((s) => /^Sub\d$/.test(s.name));
    expect(subSrcLate.map((s) => s.src)).toEqual(subSrc0.map((s) => s.src));
    // The per-path answer agreed with the generic, so the generic marker is gone.
    await expect(page.locator('#list-scroll img[data-generic]')).toHaveCount(0);

    // Every request is bucketed: a 16-px row at this dpr asks for fpIconBucket(round(16 * dpr)).
    const want16 = await bucket(Math.round(16 * dpr));
    const rowImg = rowByName(page, 'readme.txt').locator('img[data-win-icon]');
    await expect(rowImg).toHaveAttribute('data-px', String(want16));
    expect(await rowImg.evaluate((el) => el.naturalWidth)).toBe(want16);
    expect(await rowImg.evaluate((el) => Math.abs(el.getBoundingClientRect().width - 16) < 0.01)).toBe(true);

    // -- 3. Properties: the TYPE icon (ext key), never the thumbnail ------
    await page.evaluate((p) => openBrowserAt(p), iconsDir);
    await iconsSettled(page);
    // The tab shows the folder's shell icon. (Icons is one of the folders the
    // generic-icon prewarm asked about at startup, concurrently with others —
    // a shell E_PENDING there used to come back as a definitive "no icon" and
    // pin the sprite on it for the session.)
    await expect(page.locator('.fp-tab[aria-selected="true"] img[data-win-icon]'))
      .toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    await page.evaluate((p) => openProperties(p), `${iconsDir}\\wide.png`);
    const props = page.locator('#properties-modal');
    await expect(props).toBeVisible();
    const header = props.locator('#properties-icon');
    await expect(header.locator('img.fp-thumb')).toHaveCount(0);
    const headerImg = header.locator('img[data-win-icon]');
    await expect(headerImg).toHaveCount(1);
    await expect(headerImg).toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    const want32 = await bucket(Math.round(32 * dpr));
    expect(await headerImg.getAttribute('data-key')).toBe(`ext:png:${want32}`);
    expect(await headerImg.evaluate((el) => el.naturalWidth)).toBe(want32);
    const shellPng = Buffer.from(await (await fetch(
      `${API}/shell/icon?path=${encodeURIComponent(`${iconsDir}\\wide.png`)}&px=${want32}`, { headers: apiHeaders() })).arrayBuffer()).toString('base64');
    expect(await headerImg.getAttribute('src')).toBe(`data:image/png;base64,${shellPng}`);
    await shot(page, 'stage2d-icons-properties-png');
    await page.keyboard.press('Escape');
    await expect(props).toBeHidden();

    // -- 4. Freeform thumbnails: aspect kept, bottom-aligned, outlined ----
    await page.evaluate(() => setViewMode('grid'));
    await page.waitForFunction(() => document.querySelectorAll('#list-scroll img.fp-thumb--ready').length >= 2, null, { timeout: 8000 });
    const free = await page.evaluate(() => Object.fromEntries(['wide.png', 'tall.png'].map((n) => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.querySelector('.fp-row__name').textContent === n);
      const img = row.querySelector('img.fp-thumb--ready');
      const slot = img.parentElement.getBoundingClientRect();
      const b = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      const slotCs = getComputedStyle(img.parentElement);
      return [n, { w: b.width, h: b.height, bottomGap: slot.bottom - b.bottom, slotW: slot.width, slotH: slot.height,
        outline: cs.outlineStyle, outlineW: cs.outlineWidth, fit: cs.objectFit, slotBg: slotCs.backgroundColor, slotBorder: slotCs.borderTopWidth }];
    })));
    for (const f of Object.values(free)) {
      expect(f.bottomGap).toBeLessThan(0.6);
      expect(f.outline).toBe('solid');
      expect(f.outlineW).toBe('1px');
      expect(f.fit).toBe('contain');
      expect(f.slotBg).toBe('rgba(0, 0, 0, 0)');
      expect(f.slotBorder).toBe('0px');
    }
    expect(Math.abs(free['wide.png'].w / free['wide.png'].h - 2)).toBeLessThan(0.05);
    expect(Math.abs(free['wide.png'].w - free['wide.png'].slotW)).toBeLessThan(0.6);
    expect(Math.abs(free['tall.png'].h / free['tall.png'].w - 2)).toBeLessThan(0.05);
    expect(Math.abs(free['tall.png'].h - free['tall.png'].slotH)).toBeLessThan(0.6);
    await shot(page, 'stage2d-icons-freeform-thumbs');

    // -- 5. Icon box stable across a size change; the sharper bitmap swaps
    // in later at the new bucket, into the same box, never through a blank --
    const sizeProbe = await page.evaluate(async () => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.querySelector('.fp-row__name').textContent === 'doc.txt');
      const img = row.querySelector('img[data-win-icon]');
      const rec = () => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, src: img.src, connected: img.isConnected });
      setListScale(1.5, { persist: false });
      const out = [rec()];
      for (const ms of [50, 250]) { await new Promise((r) => setTimeout(r, ms)); out.push(rec()); }
      return out;
    });
    for (const s of sizeProbe) {
      expect(s.connected).toBe(true);
      expect(Math.abs(s.w - sizeProbe[0].w)).toBeLessThan(0.01);
      expect(Math.abs(s.h - sizeProbe[0].h)).toBeLessThan(0.01);
      expect(s.src).toMatch(/^data:image\/png/);
    }
    expect(Math.abs(sizeProbe[0].w - 144)).toBeLessThan(0.5);
    const want144 = await bucket(Math.round(144 * dpr));
    await expect(rowByName(page, 'doc.txt').locator('img[data-win-icon]')).toHaveAttribute('data-px', String(want144), { timeout: 5000 });
    expect(await rowByName(page, 'doc.txt').locator('img[data-win-icon]').evaluate((el) => el.naturalWidth)).toBe(want144);
    await page.evaluate(() => setListScale(1, { persist: false }));

    // -- 6. A corrupt picture with Tier A gone ends on a type icon or the
    // sprite — never an empty slot --------------------------------------
    await page.evaluate(() => fpShellIconRoute('absent'));
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen`); // away and back: a fresh render
    await page.evaluate((p) => openBrowserAt(p), iconsDir);
    await page.evaluate(() => setViewMode('grid'));
    await page.waitForTimeout(2000);
    const broken = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.querySelector('.fp-row__name').textContent === 'broken.png');
      const shown = [...row.querySelectorAll('img, svg.fp-icon')].filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        return el.tagName === 'svg' || (el.complete && el.naturalWidth > 1 && !el.src.startsWith('data:image/gif'));
      });
      return shown.map((el) => el.tagName.toLowerCase());
    });
    expect(broken.length).toBeGreaterThan(0);
    await shot(page, 'stage2d-icons-broken-tierb');
    await page.evaluate(() => fpShellIconRoute('live'));
    await page.evaluate(() => setViewMode('details'));

    // -- 7. Every item icon site carries a shell <img> --------------------
    await apiPost('/recent', { path: `${docsDir}\\doc-00.txt`, action: 'opened' });
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await iconsSettled(page);
    const sites = {
      tab: '.fp-tab[aria-selected="true"] img[data-win-icon]',
      quickAccess: '#sb-quick-access-folders img[data-win-icon]',
      drives: '#sb-drives img[data-win-icon]',
      breadcrumbDrive: '#breadcrumb img[data-win-icon]',
    };
    for (const [site, sel] of Object.entries(sites)) {
      await expect(page.locator(sel).first(), site).toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    }
    // Quick Access and drives show no sprite glyph for an item in this mode.
    expect(await page.locator('#sb-quick-access-folders svg.fp-icon, #sb-drives svg.fp-sidebar__drive-icon').count()).toBe(0);
    // Inspector header: a folder has no preview, so its own icon shows.
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen`);
    await rowByName(page, 'Documents').click();
    await expect(page.locator('#inspector-preview img[data-win-icon]')).toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    // Search results are Browser rows: shell icons too.
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await page.evaluate(() => {
      const input = document.getElementById('search-input');
      input.value = 'doc-0';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => browserState.mode === 'search' && document.querySelectorAll('#list-scroll .fp-row').length > 0, null, { timeout: 8000 });
    await iconsSettled(page);
    expect(await page.locator('#list-scroll .fp-row svg.fp-icon').count()).toBe(0);
    await page.evaluate(() => exitSearchResults());
    // Home's recent rows.
    await page.evaluate(() => switchScreen('home'));
    await expect(page.locator('#home-recent img[data-win-icon]').first()).toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    await shot(page, 'stage2d-icons-home-windows');
    expect(await page.locator('#home-recent .fp-row svg.fp-row__icon').count()).toBe(0);
  } finally {
    await fetch(`${API}/config/ui.icon_source`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('FilePlus mode: compact family icons at small sizes (Stage 2D §4.5)', async () => {
  const { app, page, errors } = await launchApp();
  try {
    expect(await page.evaluate(() => fpIconSource())).toBe('fileplus');
    const marks = await page.evaluate(() => ({
      small: iconFor({ name: 'x.qqq', ext: '.qqq', path: 'C:\\x.qqq' }, 16),
      big: iconFor({ name: 'x.qqq', ext: '.qqq', path: 'C:\\x.qqq' }, 48),
      pdfSmall: iconFor({ name: 'x.pdf', ext: '.pdf', path: 'C:\\x.pdf' }, 32),
      pdfBig: iconFor({ name: 'x.pdf', ext: '.pdf', path: 'C:\\x.pdf' }, 40),
    }));
    expect(marks.small).toContain('fp-icon--compact');
    expect(marks.pdfSmall).toContain('fp-icon--compact');
    expect(marks.big).not.toContain('fp-icon--compact');
    expect(marks.pdfBig).not.toContain('fp-icon--compact');
    // The extension badge is hidden on a compact icon and shown on a large one.
    const badge = await page.evaluate(({ small, big }) => {
      const host = document.createElement('div');
      host.innerHTML = small + big;
      document.body.appendChild(host);
      const [s, b] = host.querySelectorAll('.fp-ext-badge');
      const out = { small: getComputedStyle(s).display, big: getComputedStyle(b).display };
      host.remove();
      return out;
    }, marks);
    expect(badge.small).toBe('none');
    expect(badge.big).not.toBe('none');
  } finally {
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

async function apiPost(route, body) {
  const r = await fetch(`${API}${route}`, {
    method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${route} -> ${r.status}`);
  return r.json().catch(() => null);
}
