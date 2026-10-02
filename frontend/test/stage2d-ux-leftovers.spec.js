// frontend/test/stage2d-ux-leftovers.spec.js
// Stage 2D Task 10 (spec §10): the pass-2 `ux-daily-use` findings that were
// still present in today's code — disabled controls that keep their tooltip
// and cursor (#58), device-name Escape (#59), truncation tooltips on Home rows
// (#60), stacking snackbars and capped, self-dismissing, opaque error toasts
// (#62/#63), Home roving focus (#170), window-local F12 (#171), visible cut /
// copy state (#172), the maximize <-> restore glyph (#174), menus that close
// on resize and scroll (#175, plus #61's tall-menu clamp) and a Details header
// that scrolls with its rows (#177). Waits are on conditions, never sleeps.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { launchApp, shot, rowByName, apiGet, apiHeaders, API, FRONTEND } = require('./harness/app');

test.setTimeout(120_000);

async function apiPost(route, body) {
  const r = await fetch(`${API}${route}`, {
    method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${route} -> ${r.status}`);
  return r.json().catch(() => null);
}

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => {
  const step = (i) => (i <= 0 ? r() : requestAnimationFrame(() => step(i - 1)));
  step(k);
}), n);

// Resizes the window and waits until the renderer has seen the new size
// (its resize event has run), so a menu opened afterwards never meets a late
// resize.
async function setSize(app, w, h, page) {
  const same = await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [cw, ch] = win.getSize();
    return !win.isMaximized() && cw === s.w && ch === s.h;
  }, { w, h });
  if (same) return;
  await page.evaluate(() => {
    window.__testResized = new Promise((r) => window.addEventListener('resize', () => r(), { once: true }));
  });
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.isMaximized()) win.unmaximize();
    win.setSize(s.w, s.h);
  }, { w, h });
  await page.evaluate(() => window.__testResized);
  await frames(page);
}

test('#58 disabled buttons keep their tooltip and the not-allowed cursor', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await expect(page.locator('#list-scroll .fp-row').first()).toBeVisible();
    const back = page.locator('#btn-back');
    await expect(back).toBeDisabled();
    const probe = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { pe: cs.pointerEvents, cursor: cs.cursor, hit: !!hit && el.contains(hit), title: el.title };
    }, sel);
    // The pointer reaches the disabled control (so its native tooltip shows)
    // and the cursor says why nothing happens.
    expect(await probe('#btn-back')).toEqual({ pe: 'auto', cursor: 'not-allowed', hit: true, title: 'Back (Alt+Left)' });
    // A click on it is still inert: no navigation happens.
    const before = await page.evaluate(() => browserState.path);
    await back.click({ force: true });
    await frames(page);
    expect(await page.evaluate(() => browserState.path)).toBe(before);

    // The Ask File+ Send button (an .fp-btn) explains itself the same way.
    await page.keyboard.press('Control+j');
    await expect(page.locator('#ask-popout')).toBeVisible();
    const send = await probe('#ask-send');
    expect(send.pe).toBe('auto');
    expect(send.cursor).toBe('not-allowed');
    expect(send.hit).toBe(true);
    expect(send.title).toBe('AI arrives in Stage 3');
    // No hover treatment on a disabled primary button.
    const sendBg = () => page.evaluate(() => getComputedStyle(document.getElementById('ask-send')).backgroundColor);
    const restBg = await sendBg();
    await page.hover('#ask-send');
    expect(await sendBg()).toBe(restBg);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#59 Escape on the device-name rename restores the CURRENT name', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const name = page.locator('#sb-device-name');
    await expect(name).toBeVisible();
    await name.dblclick();
    await page.keyboard.type('Workstation');
    await page.keyboard.press('Enter');
    await expect(name).toHaveText('Workstation');
    expect(await page.evaluate(() => localStorage.getItem('fp-device-name'))).toBe('Workstation');

    await name.dblclick();
    await page.keyboard.type('Scratch name');
    await page.keyboard.press('Escape');
    await expect(name).toHaveText('Workstation');
    expect(await page.evaluate(() => localStorage.getItem('fp-device-name'))).toBe('Workstation');
    await page.evaluate(() => localStorage.removeItem('fp-device-name'));
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#62/#63 snackbars stack; error toasts are opaque, above panels, capped at 3 and leave after 8 s', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen\\Documents`);
    await expect(page.locator('#list-scroll .fp-row').first()).toBeVisible();

    // Gate respected: with notifications off nothing but errors appears.
    await page.evaluate(() => { localStorage.removeItem('fp-notifications-enabled'); showSnackbar('gated'); showToast('gated'); });
    await expect(page.locator('#snackbar-container .fp-snackbar')).toHaveCount(0);
    await expect(page.locator('#toast-container .fp-toast')).toHaveCount(0);

    // #62: three snackbars at once stack instead of painting on one spot.
    await page.evaluate(() => {
      localStorage.setItem('fp-notifications-enabled', 'on');
      showSnackbar('Tab closed one'); showSnackbar('Tab closed two'); showSnackbar('Tab closed three');
    });
    const bars = page.locator('#snackbar-container .fp-snackbar');
    await expect(bars).toHaveCount(3);
    const boxes = await bars.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
    await shot(page, 'ux-leftovers-snackbars-stacked');
    await page.evaluate(() => { document.getElementById('snackbar-container').innerHTML = ''; });

    // The cap never evicts an error for a non-error: the oldest non-error
    // goes first (the newcomer included); only an error arriving among
    // errors pushes the oldest error out.
    const stack = () => page.evaluate(() => [...document.querySelectorAll('#toast-container .fp-toast')]
      .map((t) => t.textContent.replace('✕', '').trim()));
    await page.evaluate(() => { showToast('e1', 'error'); showToast('i1'); showToast('i2'); showToast('e2', 'error'); });
    expect(await stack()).toEqual(['e1', 'i2', 'e2']);
    await page.evaluate(() => { showToast('i3'); });
    expect(await stack()).toEqual(['e1', 'e2', 'i3']);
    await page.evaluate(() => { showToast('e3', 'error'); });
    expect(await stack()).toEqual(['e1', 'e2', 'e3']);
    await page.evaluate(() => { showToast('i4'); });
    expect(await stack()).toEqual(['e1', 'e2', 'e3']);
    await page.evaluate(() => { showToast('e4', 'error'); });
    expect(await stack()).toEqual(['e2', 'e3', 'e4']);
    await page.evaluate(() => {
      document.getElementById('toast-container').innerHTML = '';
      localStorage.removeItem('fp-notifications-enabled');
    });

    // #63: errors bypass the gate, at most 3 at a time (the newest win).
    if (!(await page.evaluate(() => document.getElementById('inspector').classList.contains('inspector--open')))) {
      await page.keyboard.press('Control+i');
    }
    await expect(page.locator('#inspector')).toHaveClass(/inspector--open/);
    const t0 = Date.now();
    await page.evaluate(() => { for (let i = 1; i <= 5; i++) showToast(`Search failed: try ${i}`, 'error'); });
    const toasts = page.locator('#toast-container .fp-toast');
    await expect(toasts).toHaveCount(3);
    await expect(toasts.last()).toContainText('try 5');
    await expect(toasts.first()).toContainText('try 3');
    // Dismiss button is labelled; errors are announced.
    const dismiss = toasts.first().locator('button');
    await expect(dismiss).toHaveAttribute('aria-label', 'Dismiss');
    await expect(toasts.first()).toHaveAttribute('role', 'alert');
    // Opaque, and on top of whatever panel it covers (the inspector's buttons
    // used to show through it).
    const look = await toasts.last().evaluate((el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(/[ ,/]+/).filter(Boolean) : [];
      const alpha = parts.length === 4 ? Number(parts[3]) : 1;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + 12, r.y + r.height / 2);
      return { alpha, onTop: !!hit && el.contains(hit) };
    });
    expect(look.alpha).toBe(1);
    expect(look.onTop).toBe(true);
    await shot(page, 'ux-leftovers-error-toasts');
    // They go on their own after 8 s (not 5, not never) — except the one the
    // pointer rests on, whose clock is paused until the pointer leaves.
    await toasts.last().hover();
    await expect(toasts).toHaveCount(1, { timeout: 15_000 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(7_500);
    await expect(toasts.first()).toContainText('try 5');
    await page.mouse.move(5, 300);
    const tLeave = Date.now();
    await expect(toasts).toHaveCount(0, { timeout: 10_000 });
    expect(Date.now() - tLeave).toBeGreaterThanOrEqual(1_000);
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#60/#170 Home rows: truncation tooltips, one tab stop per pane, arrow keys move between rows', async () => {
  const root = (await apiGet('/fs/list/root')).path;
  const views = `${root}\\Views`;
  for (const n of ['Quarterly planning notes for the team offsite and the follow-up actions we agreed on.md',
    'short.txt', 'readme.md', 'budget.xlsx']) {
    await apiPost('/recent', { path: `${views}\\${n}`, action: 'opened' });
  }
  await apiPost('/favorites', { path: `${views}\\readme.md` }).catch(() => {});   // already there on a rerun
  const { app, page, errors } = await launchApp();
  try {
    await setSize(app, 1200, 760, page);
    await page.evaluate(() => switchScreen('home'));
    const rows = page.locator('#home-recent .fp-row[data-path]');
    await expect(rows.first()).toBeVisible();
    const n = await rows.count();
    expect(n).toBeGreaterThanOrEqual(4);

    // #170: one roving tab stop for the whole pane; hover buttons never take Tab.
    await expect(page.locator('#home-recent .fp-row[data-path][tabindex="0"]')).toHaveCount(1);
    expect(await page.locator('#home-recent .fp-row__hover-actions button:not([tabindex="-1"])').count()).toBe(0);
    const favRows = page.locator('#home-favorites .fp-row[data-path]');
    await expect.poll(() => favRows.count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#home-favorites .fp-row[data-path][tabindex="0"]')).toHaveCount(1);
    expect(await page.locator('#home-favorites button').count()).toBeGreaterThanOrEqual(1);
    expect(await page.locator('#home-favorites button:not([tabindex="-1"])').count()).toBe(0);
    const first = rows.nth(0), second = rows.nth(1);
    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('tabindex', '0');
    await expect(first).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('End');
    await expect(rows.nth(n - 1)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    // Tab leaves the pane in one press: focus is no longer inside #home-recent.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#home-recent'))).toBe(false);

    // #60: a cut-short name (and its folder column) carries the full text as a
    // tooltip; a name that fits carries none.
    const longRow = page.locator('#home-recent .fp-row[data-path$="agreed on.md"]');
    const longName = longRow.locator('.fp-row__name');
    await expect.poll(() => longName.evaluate((el) => el.clientWidth > 40 && el.scrollWidth > el.clientWidth)).toBe(true);
    await longName.hover();
    await expect(longName).toHaveAttribute('title',
      'Quarterly planning notes for the team offsite and the follow-up actions we agreed on.md');
    const shortName = page.locator('#home-recent .fp-row[data-path$="short.txt"] .fp-row__name');
    await shortName.hover();
    await expect(shortName).not.toHaveAttribute('title', /.+/);
    // The folder column, held narrow so it is always cut short here.
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.id = 'test-narrow-path';
      st.textContent = '#home-recent .fp-row__recent-path { max-width: 60px; }';
      document.head.appendChild(st);
    });
    const pathCell = longRow.locator('.fp-row__recent-path');
    await expect.poll(() => pathCell.evaluate((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth)).toBe(true);
    await pathCell.hover();
    await expect(pathCell).toHaveAttribute('title', /Views\\$/);
    await page.evaluate(() => document.getElementById('test-narrow-path').remove());
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#171 F12 is window-local (never an OS-wide global shortcut)', async () => {
  const src = fs.readFileSync(path.join(FRONTEND, 'main.js'), 'utf8');
  expect(src).not.toMatch(/globalShortcut\s*\.\s*register/);
  expect(src).toMatch(/before-input-event[\s\S]{0,300}F12/);
});

test('#172 cut and copied items stay visible in every view, across refreshes, until the clipboard changes', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    const clip = `${root}\\Clip`;
    await page.evaluate((p) => openBrowserAt(p), clip);
    await expect(rowByName(page, 'clip-a.txt')).toBeVisible();
    await page.evaluate(() => setView('details', null, { manual: false }));

    await frames(page);
    const selected = () => page.evaluate(() => [...browserState.selection].map((p) => p.split(/[\\/]/).pop()).sort());
    await rowByName(page, 'clip-a.txt').click();
    await expect.poll(selected).toEqual(['clip-a.txt']);
    await rowByName(page, 'clip-b.txt').click({ modifiers: ['Control'] });
    await expect.poll(selected).toEqual(['clip-a.txt', 'clip-b.txt']);
    await page.keyboard.press('Control+x');
    const cutRows = page.locator('#list-scroll .fp-row--cut');
    await expect(cutRows).toHaveCount(2);
    await expect(page.locator('#status-clipboard')).toHaveText('2 items cut');
    const iconOpacity = () => rowByName(page, 'clip-a.txt').evaluate((row) => Number(getComputedStyle(row.firstElementChild).opacity));
    expect(await iconOpacity()).toBeCloseTo(0.5, 2);
    expect(await rowByName(page, 'clip-c.txt').evaluate((row) => Number(getComputedStyle(row.firstElementChild).opacity))).toBe(1);

    // Every view of the ladder keeps the mark (each re-renders the rows).
    for (const [view, size] of [['content', null], ['tiles', null], ['list', null], ['small', null], ['icons', 96], ['details', null]]) {
      await page.evaluate(([v, s]) => setView(v, s, { manual: false }), [view, size]);
      await expect(cutRows).toHaveCount(2);
      expect(await iconOpacity()).toBeCloseTo(0.5, 2);
      if (view === 'icons') await shot(page, 'ux-leftovers-cut-icons');
    }
    // An in-place refresh (row diffing) keeps it, and so does leaving and coming back.
    await page.keyboard.press('F5');
    await frames(page, 3);
    await expect(cutRows).toHaveCount(2);
    await page.evaluate((p) => openBrowserAt(p), `${clip}\\Dest`);
    await expect(page.locator('#list-scroll .fp-row--cut')).toHaveCount(0);
    await page.evaluate((p) => openBrowserAt(p), clip);
    await expect(rowByName(page, 'clip-a.txt')).toBeVisible();
    await expect(cutRows).toHaveCount(2);
    await shot(page, 'ux-leftovers-cut-details');

    // A new copy replaces the cut: the dimming goes, the copied badge comes.
    await rowByName(page, 'clip-c.txt').click();
    await page.keyboard.press('Control+c');
    await expect(cutRows).toHaveCount(0);
    const copied = page.locator('#list-scroll .fp-row--copied');
    await expect(copied).toHaveCount(1);
    await expect(page.locator('#status-clipboard')).toHaveText('1 item copied');
    const badge = await rowByName(page, 'clip-c.txt').evaluate((row) => {
      const cs = getComputedStyle(row, '::after');
      return { content: cs.content, w: parseFloat(cs.width) };
    });
    expect(badge.content).not.toBe('none');
    expect(badge.w).toBeGreaterThan(0);
    await shot(page, 'ux-leftovers-copied-badge');

    // Pasting a cut empties the clipboard, so the marks go with it.
    await rowByName(page, 'clip-d.txt').click();
    await page.keyboard.press('Control+x');
    await expect(cutRows).toHaveCount(1);
    await expect(copied).toHaveCount(0);
    await page.evaluate((d) => fileops.pasteInto(d), `${clip}\\Dest`);
    await expect(page.locator('#status-clipboard')).toBeHidden();
    await expect(page.locator('#list-scroll .fp-row--cut, #list-scroll .fp-row--copied')).toHaveCount(0);
    // Put the fixture back (the move is undoable like any other).
    await page.evaluate(() => fileops.undoLast());
    await expect(rowByName(page, 'clip-d.txt')).toBeVisible();

    // A cut item renamed afterwards stays cut under its new name: the count
    // and the ghosted row agree, and Paste would move the file that exists.
    await rowByName(page, 'clip-a.txt').click();
    await page.keyboard.press('Control+x');
    await expect(page.locator('#status-clipboard')).toHaveText('1 item cut');
    await page.evaluate((p) => fileops.rename(p, 'clip-a-renamed.txt'), `${clip}\\clip-a.txt`);
    await expect(rowByName(page, 'clip-a-renamed.txt')).toHaveClass(/fp-row--cut/);
    await expect(page.locator('#status-clipboard')).toHaveText('1 item cut');
    expect(await page.evaluate(() => fileops.clipboard.paths.map((p) => p.split(/[\\/]/).pop()))).toEqual(['clip-a-renamed.txt']);
    await page.evaluate(() => fileops.undoLast());
    await expect(rowByName(page, 'clip-a.txt')).toHaveClass(/fp-row--cut/);
    expect(await page.evaluate(() => fileops.clipboard.paths.map((p) => p.split(/[\\/]/).pop()))).toEqual(['clip-a.txt']);

    // An op that changes nothing about where the item lives (an attribute
    // change from Properties: attr-set, src with no dest) and its undo leave
    // the cut alone.
    const clipNames = () => page.evaluate(() => [fileops.clipboard.mode, ...fileops.clipboard.paths.map((p) => p.split(/[\\/]/).pop())]);
    // The same wrapper Properties uses (properties.js applyProperties).
    await page.evaluate((p) => fileops.run('Changed attributes', async () => {
      const res = await API.post('/fs/attributes', { path: p, read_only: true });
      return { batch_id: res.batch_id, ops: res.op ? [res.op] : [] };
    }), `${clip}\\clip-a.txt`);
    expect(await clipNames()).toEqual(['cut', 'clip-a.txt']);
    await expect(rowByName(page, 'clip-a.txt')).toHaveClass(/fp-row--cut/);
    await page.evaluate(() => fileops.undoLast());
    expect(await page.evaluate(() => fileops.undoStack.length)).toBe(0);   // the undo really ran
    expect(await clipNames()).toEqual(['cut', 'clip-a.txt']);
    await expect(rowByName(page, 'clip-a.txt')).toHaveClass(/fp-row--cut/);
    await expect(page.locator('#status-clipboard')).toHaveText('1 item cut');

    // A cut item sent to the trash leaves the clipboard.
    await rowByName(page, 'clip-a.txt').click();
    await page.evaluate(() => fileops.trashSelection());
    await expect(rowByName(page, 'clip-a.txt')).toHaveCount(0);
    await expect(page.locator('#status-clipboard')).toBeHidden();
    expect(await page.evaluate(() => fileops.clipboard.mode)).toBe(null);
    await page.evaluate(() => fileops.undoLast());
    await expect(rowByName(page, 'clip-a.txt')).toBeVisible();

    // A paste where one item fails: the moved one is done, the failed one
    // stays cut so Ctrl+V can retry it.
    const ghost = `${clip}\\no-such-file.txt`;
    await page.evaluate(([a, g]) => fileops.setClipboard('cut', [a, g]), [`${clip}\\clip-b.txt`, ghost]);
    await page.evaluate((d) => fileops.pasteInto(d), `${clip}\\Dest`);
    await expect(rowByName(page, 'clip-b.txt')).toHaveCount(0);
    expect(await page.evaluate(() => fileops.clipboard)).toEqual({ mode: 'cut', paths: [ghost] });
    await expect(page.locator('#status-clipboard')).toHaveText('1 item cut');
    await page.evaluate(() => { fileops.setClipboard(null, []); return fileops.undoLast(); });
    await expect(rowByName(page, 'clip-b.txt')).toBeVisible();
    await page.evaluate(() => { document.getElementById('toast-container').innerHTML = ''; });
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#174 the maximize button turns into Restore while maximized', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const btn = page.locator('#btn-maximize');
    const isMax = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
    if (await isMax()) { await btn.click(); await expect.poll(isMax).toBe(false); }
    await expect(btn).toHaveAttribute('aria-label', 'Maximize');
    await expect(btn.locator('use')).toHaveAttribute('href', '#fp-window-maximize');
    // The glyph exists in the generated sprite.
    expect(await page.evaluate(() => !!document.getElementById('fp-window-restore'))).toBe(true);

    await btn.click();
    await expect.poll(isMax).toBe(true);
    await expect(btn).toHaveAttribute('aria-label', 'Restore');
    await expect(btn).toHaveAttribute('title', 'Restore');
    await expect(btn.locator('use')).toHaveAttribute('href', '#fp-window-restore');
    await shot(page, 'ux-leftovers-titlebar-restore');

    // A maximize/restore that did not come from the button is reflected too.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
    await expect(btn).toHaveAttribute('aria-label', 'Maximize');
    await expect(btn.locator('use')).toHaveAttribute('href', '#fp-window-maximize');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#175/#61 menus close on resize and on scroll; a tall menu fits the window', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await setSize(app, 1200, 800, page);
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Bulk`);
    await expect(rowByName(page, 'bulk-001.txt')).toBeVisible();
    const menu = page.locator('#context-menu');

    // Row menu, then a window resize: it closes.
    await rowByName(page, 'bulk-003.txt').click({ button: 'right' });
    await expect(menu).toBeVisible();
    await frames(page);
    await setSize(app, 1100, 760, page);
    await expect(menu).toBeHidden();

    // Keyboard inside the menu, then a resize: focus goes back to the row.
    await rowByName(page, 'bulk-003.txt').click({ button: 'right' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => !!document.activeElement.closest('#context-menu'))).toBe(true);
    await frames(page);
    await setSize(app, 1150, 780, page);
    await expect(menu).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.closest?.('.fp-row')?.dataset.path || document.activeElement.id))
      .toMatch(/bulk-003\.txt$|^list-scroll$/);

    // Row menu, then the list scrolls under it: it closes.
    await rowByName(page, 'bulk-003.txt').click({ button: 'right' });
    await expect(menu).toBeVisible();
    await frames(page);
    await page.evaluate(() => { document.getElementById('list-scroll').scrollTop += 120; });
    await expect(menu).toBeHidden();

    // The View dropdown (the same menu, anchored to its button) closes on resize too.
    await page.click('[data-action="open-view-menu"]');
    await expect(menu).toBeVisible();
    await frames(page);
    await setSize(app, 1200, 800, page);
    await expect(menu).toBeHidden();

    // A menu that opens with the list scrolled keeps itself open (no scroll of its own).
    await page.evaluate(() => { document.getElementById('list-scroll').scrollTop = 0; });
    await rowByName(page, 'bulk-002.txt').click({ button: 'right' });
    await frames(page, 4);
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');

    // #61: at the minimum window height a folder menu never runs off either edge.
    await setSize(app, 1200, 500, page);
    await page.evaluate((p) => openBrowserAt(p), `${root}\\_gen`);
    const folderRow = page.locator('#list-scroll .fp-row[data-type="folder"]').last();
    await expect(folderRow).toBeVisible();
    await folderRow.click({ button: 'right' });
    await expect(menu).toBeVisible();
    const fit = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const sc = el.querySelector(':scope > .fp-context-menu__scroll');
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight, overflowY: getComputedStyle(sc).overflowY,
        frameMask: getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage };
    });
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(fit.vh);
    expect(fit.overflowY).toBe('auto');
    expect(fit.frameMask).toBe('none');
    // At 1.5 zoom the menu is taller than the window: the items scroll in
    // their own scroller, the fade marks the hidden end, the frame stays whole.
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
    await page.waitForFunction(() => window.innerHeight < 400);
    await folderRow.click({ button: 'right' });
    await expect(menu).toBeVisible();
    const tall = await menu.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const sc = el.querySelector(':scope > .fp-context-menu__scroll');
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight, over: sc.scrollHeight > sc.clientHeight,
        cueBottom: sc.classList.contains('is-scroll-bottom'), frameMask: getComputedStyle(el).maskImage || 'none',
        itemsMask: getComputedStyle(sc).maskImage || getComputedStyle(sc).webkitMaskImage,
        right: r.right, vw: window.innerWidth };
    });
    expect(tall.right).toBeLessThanOrEqual(tall.vw);
    expect(tall.itemsMask).toMatch(/gradient/);
    expect(tall.over).toBe(true);
    expect(tall.cueBottom).toBe(true);
    expect(tall.frameMask).toBe('none');
    expect(tall.top).toBeGreaterThanOrEqual(0);
    expect(tall.bottom).toBeLessThanOrEqual(tall.vh);
    await shot(page, 'ux-leftovers-menu-tall-zoomed');
    await page.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.waitForFunction(() => window.innerHeight > 400);
    await shot(page, 'ux-leftovers-menu-short-window');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});

test('#177 Details: no sideways overflow in a narrow pane; when rows do scroll sideways the header follows', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => openBrowserAt(p), `${root}\\Views`);
    await expect(page.locator('#list-scroll .fp-row').first()).toBeVisible();
    await page.evaluate(() => setView('details', null, { manual: false }));
    if (!(await page.evaluate(() => document.getElementById('inspector').classList.contains('inspector--open')))) {
      await page.keyboard.press('Control+i');
    }
    // The finding's case: a narrow window with the inspector open.
    for (const w of [800, 900, 1000, 1100]) {
      await setSize(app, w, 700, page);
      await frames(page);
      const o = await page.evaluate(() => {
        const ls = document.getElementById('list-scroll');
        return { sw: ls.scrollWidth, cw: ls.clientWidth };
      });
      expect(o.sw, `width ${w}`).toBeLessThanOrEqual(o.cw);
    }
    // Force rows wider than the pane: the header must move with them.
    await setSize(app, 1100, 700, page);
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.id = 'test-wide-rows';
      st.textContent = '#list-scroll[data-view="details"] .fp-row__name { min-width: 900px !important; }'
        + ' #list-head .list-col--name { min-width: 900px !important; }';
      document.head.appendChild(st);
    });
    await frames(page);
    await page.evaluate(() => { document.getElementById('list-scroll').scrollLeft = 300; });
    const colX = async () => page.evaluate(() => {
      const head = document.querySelector('#list-head .list-col--modified').getBoundingClientRect();
      const cell = document.querySelector('#list-scroll .fp-row .fp-row__modified').getBoundingClientRect();
      return { head: Math.round(head.right), cell: Math.round(cell.right) };
    });
    await expect.poll(async () => { const c = await colX(); return Math.abs(c.head - c.cell); }).toBeLessThanOrEqual(1);
    await shot(page, 'ux-leftovers-details-hscroll');
    await page.evaluate(() => { document.getElementById('list-scroll').scrollLeft = 0; document.getElementById('test-wide-rows').remove(); });
    expect(errors).toEqual([]);
  } finally { await app.close(); }
});
