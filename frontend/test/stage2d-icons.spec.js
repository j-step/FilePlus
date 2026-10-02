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
  // ...and nothing is still on its way that could repaint one of them.
  await page.waitForFunction(() => window.__fpIconsIdle(), null, { timeout: 8000 });
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

    // Same in Large icons (Pictures decides them): the thumbnail itself is
    // the settled image on a revisit, with no type icon under it.
    const revisitGrid = await page.evaluate(async ({ p }) => {
      await openBrowserAt(p);
      return { same: window.__fpSampleRows(), view: browserState.view };
    }, { p: picsDir });
    expect(revisitGrid.view).toBe('icons');
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
    // The per-path answers have landed (and any swap they caused is done).
    await page.waitForFunction(() => window.__fpIconsIdle());
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
    await page.evaluate(() => setView('icons', 96));
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

    // -- 5. Icon box stable across a size step (icons 96 -> 128); the sharper
    // bitmap swaps in later at the new bucket, into the same box, never
    // through a blank --
    const sizeProbe = await page.evaluate(async () => {
      const row = [...document.querySelectorAll('#list-scroll .fp-row')].find((r) => r.querySelector('.fp-row__name').textContent === 'doc.txt');
      const img = row.querySelector('img[data-win-icon]');
      const rec = () => ({ w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height, src: img.src, connected: img.isConnected });
      setView('icons', 128);
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
    expect(Math.abs(sizeProbe[0].w - 128)).toBeLessThan(0.5);
    const want128 = await bucket(Math.round(128 * dpr));
    await expect(rowByName(page, 'doc.txt').locator('img[data-win-icon]')).toHaveAttribute('data-px', String(want128), { timeout: 5000 });
    expect(await rowByName(page, 'doc.txt').locator('img[data-win-icon]').evaluate((el) => el.naturalWidth)).toBe(want128);
    await page.evaluate(() => setView('icons', 96));

    // -- 6. A corrupt picture with Tier A gone ends on a type icon or the
    // sprite — never an empty slot --------------------------------------
    await page.evaluate(() => fpShellIconRoute('absent'));
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen`); // away and back: a fresh render
    await page.evaluate((p) => openBrowserAt(p), iconsDir);
    await page.evaluate(() => setView('icons', 96));
    // Every lazy slot asked, every answer (or refusal) in and painted.
    await page.waitForFunction(() => !document.querySelector('#list-scroll [data-fp-lazy="pending"]')
      && !window.__fpLoadPending && window.__fpIconsIdle(), null, { timeout: 8000 });
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
    await page.evaluate(() => setView('details'));

    // -- 7. Every item icon site carries a shell <img> --------------------
    await apiPost('/recent', { path: `${docsDir}\\doc-00.txt`, action: 'opened' });
    // A crumb clipped off the path's left edge is never asked for (it is not
    // on screen), and the sidebar's drive icon no longer shares its 16px
    // bitmap since the sidebar draws 18px icons (Stage 2D §9.1): give the
    // whole path room so the drive crumb is on screen and resolves itself.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1700, 800));
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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 800));
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

    // Pinned folders in the sidebar.
    const pin = await apiPost('/pins', { path: `${iconsDir}\\PlainA`, label: 'PlainA' });
    try {
      await page.evaluate(() => loadPins());
      await expect(page.locator('#sb-pinned-folders img[data-win-icon]').first())
        .toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
      expect(await page.locator('#sb-pinned-folders svg.fp-icon').count()).toBe(0);
    } finally {
      if (pin && pin.id != null) await fetch(`${API}/pins/${pin.id}`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
      await page.evaluate(() => loadPins());
    }

    // The drag ghost: a real pointer drag of a .txt row.
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await iconsSettled(page);
    const dragRow = rowByName(page, 'doc-00.txt');
    const box = await dragRow.boundingBox();
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 70, box.y + box.height / 2 + 30, { steps: 4 });
    await expect(page.locator('#drag-badge img[data-win-icon]')).toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    expect(await page.locator('#drag-badge svg.fp-icon').count()).toBe(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('#drag-badge')).toBeHidden();
    await expect(rowByName(page, 'doc-00.txt')).toHaveCount(1); // nothing moved

    // Properties' "Opens with" row — .txt always has an association (Notepad).
    await page.evaluate((p) => openProperties(p), `${docsDir}\\doc-00.txt`);
    await expect(page.locator('#properties-modal')).toBeVisible();
    await expect(page.locator('#properties-opens-with-icon img[data-win-icon]'))
      .toHaveAttribute('src', /^data:image\/png/, { timeout: 5000 });
    await expect(page.locator('#properties-icon img[data-win-icon]')).toHaveAttribute('data-key', new RegExp(`^ext:txt:`));
    await page.keyboard.press('Escape');
    await expect(page.locator('#properties-modal')).toBeHidden();
  } finally {
    await fetch(`${API}/config/ui.icon_source`, { method: 'DELETE', headers: apiHeaders() }).catch(() => {});
    await app.close();
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('generic folder icon: two agreeing folders, never a custom icon; cached nulls keep it; shared bytes (Stage 2D §4.2)', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const votesDir = `${root}\\Votes`;
    const freshDir = `${root}\\Icons\\Fresh`;
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    // Let the switch's own prewarm (the root's sub-folders) finish first.
    await page.waitForFunction(() => _fpGenerics.has(`dir:*:${fpDevicePx(16)}`), null, { timeout: 8000 });

    // -- Votes: the first folder asked about has a desktop.ini custom icon --
    const vote = await page.evaluate(async (dir) => {
      const px = fpDevicePx(16);
      const gk = `dir:*:${px}`;
      const key = (n) => FpIconCache.shellIconKey(`${dir}\\${n}`, '', true, px);
      _fpGenerics.clear(); _fpGenericVotes.clear(); _fpGenericVoters.clear();
      const ask = (n) => fpShellIconUrl(key(n), { path: `${dir}\\${n}`, ext: '', isDir: true, px });
      const custom = await ask('ACustom');
      const afterCustom = _fpGenerics.get(gk) || null;
      const b = await ask('BPlain');
      const afterB = _fpGenerics.get(gk) || null;
      const again = await fpShellIconUrl(key('ACustom'), { path: `${dir}\\ACustom`, ext: '', isDir: true, px });
      _fpVoteGeneric(`${dir}\\ACustom`, px, custom.url); // a second answer for the same folder is no second vote
      const afterRepeat = _fpGenerics.get(gk) || null;
      const c = await ask('CPlain');
      const generic = _fpGenerics.get(gk) || null;
      return {
        custom: custom.url, again: again.url, b: b.url, c: c.url, afterCustom, afterB, afterRepeat, generic,
        bBytes: _fpWinIconCache.get(key('BPlain')).bytes, cBytes: _fpWinIconCache.get(key('CPlain')).bytes,
        bShared: _fpWinIconCache.get(key('BPlain')).url === generic,
        customBytes: _fpWinIconCache.get(key('ACustom')).bytes,
      };
    }, votesDir);
    expect(vote.custom).toMatch(/^data:image\/png/);
    expect(vote.b).toBe(vote.c);
    expect(vote.custom).not.toBe(vote.b); // the desktop.ini icon really is different
    expect(vote.afterCustom).toBeNull();
    expect(vote.afterB).toBeNull(); // one vote each: nothing adopted yet
    expect(vote.afterRepeat).toBeNull();
    expect(vote.generic).toBe(vote.b);
    // Plain folders share the generic's bytes: charged 0, the same string.
    expect(vote.bBytes).toBe(0);
    expect(vote.cBytes).toBe(0);
    expect(vote.bShared).toBe(true);
    expect(vote.customBytes).toBeUndefined();

    // Nothing votes before GET /known-folders has answered.
    const early = await page.evaluate((dir) => {
      const px = fpDevicePx(16);
      const saved = window.__fpKnownFolders;
      delete window.__fpKnownFolders;
      _fpGenerics.clear(); _fpGenericVotes.clear(); _fpGenericVoters.clear();
      const url = _fpWinIconCache.get(FpIconCache.shellIconKey(`${dir}\\BPlain`, '', true, px)).url;
      _fpVoteGeneric(`${dir}\\BPlain`, px, url);
      _fpVoteGeneric(`${dir}\\CPlain`, px, url);
      const out = _fpGenerics.get(`dir:*:${px}`) || null;
      window.__fpKnownFolders = saved;
      _fpVoteGeneric(`${dir}\\BPlain`, px, url);
      _fpVoteGeneric(`${dir}\\CPlain`, px, url);
      return { before: out, after: _fpGenerics.get(`dir:*:${px}`) === url };
    }, votesDir);
    expect(early.before).toBeNull();
    expect(early.after).toBe(true);

    // The prewarm asks for nothing while the route is not known to be live.
    const quiet = await page.evaluate(async () => {
      const px40 = fpDevicePx(40);
      const known = _fpGenerics.has(`dir:*:${px40}`);
      fpShellIconRoute('unknown');
      const before = window.__fpIconStats.batches;
      await fpPrewarmGenerics(40);
      // A request would be queued into a batch flushed on the next macrotask
      // (setTimeout 0): one macrotask later, a counted batch or a non-idle
      // pipeline would show it — no 300 ms sleep needed.
      await new Promise((r) => setTimeout(r, 0));
      const after = window.__fpIconStats.batches;
      const idle = window.__fpIconsIdle();
      fpShellIconRoute('live');
      return { known, requested: after - before, idle };
    });
    expect(quiet.known).toBe(false);
    expect(quiet.requested).toBe(0);
    expect(quiet.idle).toBe(true);

    // -- Tier A absent: a folder whose answer is a definitive null keeps the
    // generic it was painted with, on that render and on every later one --
    await page.evaluate(() => fpShellIconRoute('absent'));
    await page.evaluate((p) => openBrowserAt(p), freshDir);
    const subState = () => page.evaluate(() => [...document.querySelectorAll('#list-scroll .fp-row')]
      .filter((r) => /^Sub\d$/.test(r.querySelector('.fp-row__name').textContent))
      .map((r) => ({ src: r.querySelector('img[data-win-icon]')?.getAttribute('src') || null, sprite: !!r.querySelector('svg.fp-icon') })));
    await page.waitForFunction(() => !document.querySelector('#list-scroll img[data-win-icon][data-fp-lazy="pending"]')
      && __fpLoadPending === 0 && window.__fpIconsIdle(), null, { timeout: 8000 });
    const generic16 = await page.evaluate(() => _fpGenerics.get(`dir:*:${fpDevicePx(16)}`));
    const firstRender = await subState();
    await page.evaluate(() => renderDirectory());
    const secondRender = await subState();
    for (const s of [...firstRender, ...secondRender]) {
      expect(s.sprite).toBe(false);
      expect(s.src).toBe(generic16);
    }
    expect(firstRender).toHaveLength(3);
    expect(secondRender).toHaveLength(3);
    await page.evaluate(() => fpShellIconRoute('live'));

    // -- Budget: a 300-item folder of distinct 256-px icons (85 KB data URLs,
    // the measured worst case) fits, so it revisits from cache --
    const kept = await page.evaluate(() => {
      const big = 'data:image/png;base64,' + 'A'.repeat(85 * 1024);
      for (let i = 0; i < 300; i++) _fpWinIconCache.set(`path:c:\\budget\\${i}.exe:256`, { url: big + i, px: 256, exact: true });
      let n = 0;
      for (let i = 0; i < 300; i++) if (_fpWinIconCache.get(`path:c:\\budget\\${i}.exe:256`)) n++;
      for (let i = 0; i < 300; i++) _fpWinIconCache.delete(`path:c:\\budget\\${i}.exe:256`);
      return n;
    });
    expect(kept).toBe(300);
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
