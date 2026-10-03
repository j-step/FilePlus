// frontend/test/stage2d-motion.spec.js
// Stage 2D addendum §5.1 / §5.3 (Task 1): one motion gate. Settings ›
// Personalization › "Animations" (ui.animations, default on) is the ONLY
// switch (decision A-2: prefers-reduced-motion gates nothing). Off sets
// html[data-motion="off"], which zeroes every CSS transition and animation
// and makes every JS-driven animation (fpAnimate, the zoom ease, the spring
// pulse wait) instant. The harness launches with animations off unless a
// test asks for launchApp({ motion: true }).
const { test, expect } = require('@playwright/test');
const { launchApp, apiGet, API, apiHeaders, rowByName } = require('./harness/app');

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

async function configValue(key) {
  const cfg = await apiGet('/config');
  return cfg[key];
}

/** Starts a per-frame sampler that records every running animation (CSS
 * animations, CSS transitions and WAAPI) — its target, kind and duration —
 * until stopSampler() is called. */
async function startSampler(page) {
  await page.evaluate(() => {
    window.__fpSeen = [];
    window.__fpSampling = true;
    const describe = (a) => {
      const t = a.effect && a.effect.target;
      const tm = a.effect ? a.effect.getComputedTiming() : {};
      return {
        kind: a.constructor.name,
        name: a.animationName || a.transitionProperty || a.id || '',
        target: t ? `${t.tagName.toLowerCase()}${t.id ? `#${t.id}` : ''}.${[...t.classList].join('.')}` : '',
        duration: tm.duration,
        iterations: tm.iterations,
      };
    };
    window.__fpSample = () => { for (const a of document.getAnimations()) window.__fpSeen.push(describe(a)); };
    const tick = () => { window.__fpSample(); if (window.__fpSampling) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

async function stopSampler(page) {
  return page.evaluate(() => { window.__fpSample(); window.__fpSampling = false; return window.__fpSeen; });
}

/** A scripted tour through the things that animate (spec §5.3): new tab,
 * close tab, navigate, inspector toggle, sidebar toggle, menu, dialog,
 * refresh. Each step samples getAnimations() in the same task it acted in,
 * as well as on every frame (startSampler). */
async function tour(page) {
  const root = (await apiGet('/fs/list/root')).path;
  const sample = () => page.evaluate(() => window.__fpSample());
  await page.locator('#btn-new-tab').click();
  await sample();
  await page.evaluate((r) => { loadDirectory(r); window.__fpSample(); }, root);
  await page.waitForFunction(() => !window.__fpLoadPending);
  await sample();
  await page.evaluate(() => { setInspectorOpen(false, { persist: false, animate: true }); window.__fpSample(); });
  await page.evaluate(() => { setInspectorOpen(true, { persist: false, animate: true }); window.__fpSample(); });
  await page.evaluate(() => { toggleSidebar(); window.__fpSample(); });
  await page.evaluate(() => { toggleSidebar(); window.__fpSample(); });
  await page.locator('#list-scroll').click({ button: 'right', position: { x: 300, y: 300 } });
  await expect(page.locator('#context-menu')).toBeVisible();
  await sample();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { openPalette(); window.__fpSample(); });
  await expect(page.locator('#palette-scrim')).toBeVisible();
  await sample();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { refreshAll(); window.__fpSample(); });
  await page.waitForFunction(() => !window.__fpLoadPending);
  // Close the tab the tour opened.
  await page.locator('.fp-tab.fp-tab--active .fp-tab__close').click();
  await sample();
}

test('the harness launches with animations off, deterministically, before a test acts', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const s = await page.evaluate(() => ({
      motion: document.documentElement.dataset.motion,
      on: fpMotionOn(),
      // The sidebar's width transition (and every other one) is zeroed.
      sidebarTransition: getComputedStyle(document.getElementById('sidebar')).transitionDuration,
      anim: fpAnimate(document.getElementById('sidebar'), [{ opacity: 0 }, { opacity: 1 }], { duration: 'base' }),
      running: document.getAnimations().length,
    }));
    expect(s).toEqual({ motion: 'off', on: false, sidebarTransition: '0s', anim: null, running: 0 });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('with the switch off, getAnimations() stays empty across a scripted tour and JS eases are instant', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await startSampler(page);
    await tour(page);
    const seen = await stopSampler(page);
    expect(seen, JSON.stringify(seen.slice(0, 10))).toEqual([]);
    // The JS-driven eases follow the same switch.
    expect(await page.evaluate(() => zoomEaseMode())).toBe('instant');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('motion tokens are the spec values and nothing that runs takes longer than 200 ms', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const ms = (v) => (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000);
      const out = {};
      for (const n of ['instant', 'fast', 'base', 'slow']) out[n] = ms(cs.getPropertyValue(`--motion-${n}`).trim());
      // Every --motion-* custom property the stylesheet defines on :root.
      const all = {};
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText !== ':root' || !rule.style) continue;
          for (const prop of rule.style) if (prop.startsWith('--motion-')) all[prop] = ms(cs.getPropertyValue(prop).trim());
        }
      }
      return { core: out, all, easeOut: cs.getPropertyValue('--ease-out').trim(),
        easeIn: cs.getPropertyValue('--ease-in').trim(), easeStandard: cs.getPropertyValue('--ease-standard').trim() };
    });
    expect(tokens.core).toEqual({ instant: 60, fast: 100, base: 140, slow: 200 });
    for (const [name, v] of Object.entries(tokens.all)) expect(v, name).toBeLessThanOrEqual(200);
    expect(tokens.easeOut.replace(/\s/g, '')).toBe('cubic-bezier(.2,.8,.2,1)');
    expect(tokens.easeIn).not.toBe('');
    expect(tokens.easeStandard).not.toBe('');

    expect(await page.evaluate(() => document.documentElement.dataset.motion)).toBe('on');
    await startSampler(page);
    await tour(page);
    const seen = await stopSampler(page);
    // The tour really animates with the switch on (so the empty list with it
    // off is a real result, not a tour that never moves anything).
    expect(seen.length).toBeGreaterThan(0);
    const tooLong = seen.filter((a) => !(a.duration <= 200) || a.iterations !== 1);
    expect(tooLong, JSON.stringify(tooLong.slice(0, 10))).toEqual([]);
    // Every element's computed transition durations are within the ceiling.
    const maxTransition = await page.evaluate(() => {
      let max = 0;
      let who = '';
      for (const el of document.querySelectorAll('*')) {
        for (const part of getComputedStyle(el).transitionDuration.split(',')) {
          const v = parseFloat(part) * (/ms/.test(part) ? 1 : 1000);
          if (v > max) { max = v; who = `${el.tagName}#${el.id}.${el.className}`; }
        }
      }
      return { max, who };
    });
    expect(maxTransition.max, maxTransition.who).toBeLessThanOrEqual(200);
    expect(await page.evaluate(() => zoomEaseMode())).toBe('eased');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('fpAnimate: token durations, one animation per element and key, null and cancelled when off', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const r = await page.evaluate(() => {
      const el = document.getElementById('sidebar');
      const a = fpAnimate(el, [{ opacity: 0.5 }, { opacity: 1 }], { duration: 'fast', easing: 'out', key: 'probe' });
      const fastMs = a.effect.getComputedTiming().duration;
      // The same element and key: the first one is cancelled, nothing queues.
      const b = fpAnimate(el, [{ opacity: 0.6 }, { opacity: 1 }], { duration: 'base', key: 'probe' });
      // A different key runs alongside.
      const c = fpAnimate(el, [{ transform: 'translateX(2px)' }, { transform: 'none' }], { duration: 'slow', easing: 'standard', key: 'other' });
      // A literal ms above the ceiling is clamped to --motion-slow.
      const d = fpAnimate(document.getElementById('inspector'), [{ opacity: 0.9 }, { opacity: 1 }], { duration: 900 });
      const out = {
        fastMs, aState: a.playState, bMs: b.effect.getComputedTiming().duration, bState: b.playState,
        cMs: c.effect.getComputedTiming().duration, dMs: d.effect.getComputedTiming().duration,
        instantMs: fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: 'instant', key: 'i' }).effect.getComputedTiming().duration,
      };
      // Turning the switch off cancels what is running and makes the next call a no-op.
      fpSetMotion(false, { persist: false });
      out.afterOff = [b.playState, c.playState, d.playState];
      out.offCall = fpAnimate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 'fast' });
      out.offRunning = document.getAnimations().length;
      fpSetMotion(true, { persist: false });
      return out;
    });
    expect(r).toEqual({
      fastMs: 100, aState: 'idle', bMs: 140, bState: 'running', cMs: 200, dMs: 200, instantMs: 60,
      afterOff: ['idle', 'idle', 'idle'], offCall: null, offRunning: 0,
    });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('fpAnimate never leaves state behind: fill is none or backwards, delay and odd durations are clamped', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const r = await page.evaluate(async () => {
      const el = document.getElementById('sidebar');
      const timing = (a) => { const t = a.effect.getTiming(); return { duration: t.duration, delay: t.delay, fill: t.fill }; };
      const fwd = fpAnimate(el, [{ opacity: 0.5 }, { opacity: 1 }], { duration: 'instant', fill: 'forwards', key: 'fwd' });
      const back = fpAnimate(el, [{ opacity: 0.5 }, { opacity: 1 }], { duration: 'instant', fill: 'backwards', key: 'back' });
      const both = fpAnimate(el, [{ opacity: 0.5 }, { opacity: 1 }], { duration: 'instant', fill: 'both', key: 'both' });
      const out = {
        fwd: timing(fwd), back: timing(back), both: timing(both),
        nan: timing(fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: NaN, key: 'nan' })),
        neg: timing(fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: -50, key: 'neg' })),
        zero: timing(fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: 0, key: 'zero' })),
        unknown: timing(fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: 'glacial', key: 'unknown' })),
        longDelay: timing(fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: 'instant', delay: 5000, key: 'd1' })),
        badDelay: timing(fpAnimate(el, [{ opacity: 1 }, { opacity: 1 }], { duration: 'instant', delay: -20, key: 'd2' })),
      };
      await fwd.finished;
      // A finished animation (asked for 'forwards') is gone: nothing holds a style.
      out.fwdAfter = document.getAnimations().includes(fwd);
      return out;
    });
    expect(r).toEqual({
      fwd: { duration: 60, delay: 0, fill: 'none' },
      back: { duration: 60, delay: 0, fill: 'backwards' },
      both: { duration: 60, delay: 0, fill: 'none' },
      nan: { duration: 100, delay: 0, fill: 'none' },
      neg: { duration: 100, delay: 0, fill: 'none' },
      zero: { duration: 100, delay: 0, fill: 'none' },
      unknown: { duration: 100, delay: 0, fill: 'none' },
      longDelay: { duration: 60, delay: 200, fill: 'none' },
      badDelay: { duration: 60, delay: 0, fill: 'none' },
      fwdAfter: false,
    });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('timers come from --timer-* tokens; the resize line waits for hover intent with animations off and never animates', async () => {
  const { app, page, errors } = await launchApp();
  try {
    expect(await page.evaluate(() => ['--timer-snackbar', '--timer-toast', '--timer-toast-error', '--timer-toast-resume',
      '--timer-resize-intent'].map((n) => fpMotionMs(n)))).toEqual([5000, 5000, 8000, 1500, 400]);
    await startSampler(page);
    const handle = page.locator('#sidebar-resize-handle');
    const hb = await handle.boundingBox();
    const t0 = await page.evaluate(() => performance.now());
    // The handle's inner half.
    await page.mouse.move(hb.x + 1, hb.y + hb.height / 2);
    // Not at once: the pointer has to rest there first.
    expect(await handle.evaluate((el) => [el.classList.contains('fp-sidebar__resize-handle--intent'),
      getComputedStyle(el).backgroundColor])).toEqual([false, 'rgba(0, 0, 0, 0)']);
    await expect(handle).toHaveClass(/fp-sidebar__resize-handle--intent/);
    const waited = await page.evaluate((t) => performance.now() - t, t0);
    expect(waited).toBeGreaterThanOrEqual(390);
    expect(await handle.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.move(600, 300);
    await expect(handle).not.toHaveClass(/fp-sidebar__resize-handle--intent/);
    const seen = await stopSampler(page);
    expect(seen, JSON.stringify(seen.slice(0, 5))).toEqual([]);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('the Settings switch turns animations off and on at once, persists ui.animations and fires fpMotionChanged', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await page.evaluate(() => {
      window.__fpMotionEvents = [];
      document.addEventListener('fpMotionChanged', (e) => window.__fpMotionEvents.push(e.detail.on));
      switchScreen('settings');
    });
    const sw = page.locator('#settings-animations');
    await expect(sw).toBeChecked();
    await page.locator('label.fp-toggle', { has: sw }).click();
    await expect(sw).not.toBeChecked();
    // Applied at once, in the same task as the change (no restart).
    expect(await page.evaluate(() => [document.documentElement.dataset.motion, fpMotionOn(),
      getComputedStyle(document.getElementById('sidebar')).transitionDuration])).toEqual(['off', false, '0s']);
    await expect.poll(() => configValue('ui.animations')).toBe(false);
    await page.locator('label.fp-toggle', { has: sw }).click();
    await expect(sw).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.dataset.motion)).toBe('on');
    await expect.poll(() => configValue('ui.animations')).toBe(true);
    expect(await page.evaluate(() => window.__fpMotionEvents)).toEqual([false, true]);
    expect(await page.evaluate(() => localStorage.getItem('fp-animations'))).toBe('on');
  } finally {
    await app.close();
    await delConfig('ui.animations');
  }
  expect(errors).toEqual([]);
});

test('without a launch override, startup follows the saved setting (ui.animations=false)', async () => {
  await setConfig('ui.animations', false);
  const { app, page, errors } = await launchApp({ motion: null });
  try {
    expect(await page.evaluate(() => [document.documentElement.dataset.motion,
      document.getElementById('settings-animations').checked])).toEqual(['off', false]);
  } finally {
    await app.close();
    await delConfig('ui.animations');
  }
  expect(errors).toEqual([]);
});

// ── Task 6: the chrome motion pass (addendum §5.2 Tabs, Sidebar, Window) ─────
// Every check acts and reads in ONE page task (page.evaluate), so "input is
// not delayed" means what it says: the state, the DOM and the hit-testing
// are already final in the same task the click or key ran in.

/** Page-side helpers, once per launch: __fpAnims(el) lists the animations
 * running on an element, __fpHitIs(el) says whether a click at its centre
 * would reach it right now. */
async function installMotionProbes(page) {
  await page.evaluate(() => {
    window.__fpAnims = (el, deep = false) => (el ? el.getAnimations({ subtree: deep }) : []).map((a) => ({
      duration: a.effect.getComputedTiming().duration,
      state: a.playState,
      iterations: a.effect.getComputedTiming().iterations,
    }));
    window.__fpCenter = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    window.__fpHitIs = (el) => {
      const c = window.__fpCenter(el);
      const hit = document.elementFromPoint(c.x, c.y);
      return !!hit && (hit === el || el.contains(hit));
    };
  });
}

/** Waits (polling, no sleeps) until nothing animates under `sel` (or anywhere). */
const settled = (page, sel = null) => expect.poll(() => page.evaluate((s) => {
  if (!s) return document.getAnimations().length;
  const root = document.querySelector(s);
  return root ? root.getAnimations({ subtree: true }).length : 0;
}, sel), { timeout: 5000 }).toBe(0);

test('tabs: a new tab grows in, is active and focusable at once; two "+" give two tabs', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const r = await page.evaluate(() => {
      document.getElementById('btn-new-tab').click();
      const el = document.querySelector(`.fp-tab[data-tab-id="${tabs.activeId}"]`);
      el.focus();
      return {
        active: el.classList.contains('fp-tab--active') && el.getAttribute('aria-selected') === 'true',
        focused: document.activeElement === el,
        tabindex: el.getAttribute('tabindex'),
        anims: window.__fpAnims(el),
      };
    });
    expect(r.active).toBe(true);
    expect(r.focused).toBe(true);
    expect(r.tabindex).toBe('0');
    expect(r.anims.length).toBeGreaterThan(0);
    for (const a of r.anims) expect(a.duration).toBeLessThanOrEqual(140);
    await settled(page, '#tabbar');
    // Nothing is left behind: the tab has its real width again.
    expect(await page.evaluate(() => {
      const el = document.querySelector(`.fp-tab[data-tab-id="${tabs.activeId}"]`);
      return [el.getBoundingClientRect().width > 80, el.style.maxWidth, document.querySelectorAll('.fp-tab-slider, .fp-tab-ghost').length];
    })).toEqual([true, '', 0]);

    // Two "+" in the same task: two tabs, the second one active, records
    // and elements in step.
    const two = await page.evaluate(() => {
      const before = tabs.list.length;
      const b = document.getElementById('btn-new-tab');
      b.click(); b.click();
      return {
        added: tabs.list.length - before,
        dom: document.querySelectorAll('.fp-tab').length === tabs.list.length,
        activeEls: document.querySelectorAll('.fp-tab.fp-tab--active').length,
        activeIsLast: tabs.list[tabs.list.length - 1].id === tabs.activeId,
        activeDom: document.querySelector('.fp-tab.fp-tab--active').dataset.tabId === tabs.activeId,
      };
    });
    expect(two).toEqual({ added: 2, dom: true, activeEls: 1, activeIsLast: true, activeDom: true });
    await settled(page, '#tabbar');
    // A real double-click on "+" (the pointer, not a script): both presses
    // land on live controls and the strip ends consistent.
    const plus = await page.locator('#btn-new-tab').boundingBox();
    const n0 = await page.evaluate(() => tabs.list.length);
    await page.mouse.dblclick(plus.x + plus.width / 2, plus.y + plus.height / 2);
    const dbl = await page.evaluate(() => ({
      n: tabs.list.length, dom: document.querySelectorAll('.fp-tab').length,
      active: document.querySelectorAll('.fp-tab.fp-tab--active').length,
      activeIsLast: tabs.list[tabs.list.length - 1].id === tabs.activeId,
    }));
    expect(dbl.n).toBeGreaterThan(n0);
    expect(dbl.dom).toBe(dbl.n);
    expect(dbl.active).toBe(1);
    expect(dbl.activeIsLast).toBe(true);
    await settled(page, '#tabbar');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('tabs: a closed tab shrinks out as an inert ghost; the next tab is active and hit at once; Ctrl+W spam ends right', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await page.evaluate(() => { for (let i = 0; i < 3; i++) openNewTab(); });
    await settled(page, '#tabbar');
    const r = await page.evaluate(() => {
      const order = tabsInStripOrder();
      const closing = tabs.activeId;
      const el = document.querySelector(`.fp-tab[data-tab-id="${closing}"]`);
      el.querySelector('.fp-tab__close').click();
      const ghost = document.querySelector('.fp-tab-ghost');
      const next = document.querySelector('.fp-tab.fp-tab--active');
      const gc = window.__fpCenter(ghost);
      const hitGhost = document.elementFromPoint(gc.x, gc.y);
      return {
        gone: !document.querySelector(`.fp-tab[data-tab-id="${closing}"]`),
        order: tabsInStripOrder(), was: order,
        ghost: {
          inert: ghost.inert, hidden: ghost.getAttribute('aria-hidden'), pe: getComputedStyle(ghost).pointerEvents,
          actions: ghost.querySelectorAll('[data-action]').length + (ghost.hasAttribute('data-action') ? 1 : 0),
          isTab: ghost.classList.contains('fp-tab'), anims: window.__fpAnims(ghost),
          hit: !!hitGhost && (hitGhost === ghost || ghost.contains(hitGhost)),
        },
        nextActive: next.dataset.tabId === tabs.activeId && next.getAttribute('tabindex') === '0',
        nextHit: window.__fpHitIs(next),
      };
    });
    expect(r.gone).toBe(true);
    expect(r.order).toEqual(r.was.slice(0, -1));
    expect(r.ghost.inert).toBe(true);
    expect(r.ghost.hidden).toBe('true');
    expect(r.ghost.pe).toBe('none');
    expect(r.ghost.actions).toBe(0);
    expect(r.ghost.isTab).toBe(false);
    expect(r.ghost.hit).toBe(false);
    expect(r.ghost.anims.length).toBeGreaterThan(0);
    for (const a of r.ghost.anims) expect(a.duration).toBeLessThanOrEqual(140);
    expect(r.nextActive).toBe(true);
    expect(r.nextHit).toBe(true);
    await settled(page, '#tabbar');
    expect(await page.locator('.fp-tab-ghost').count()).toBe(0);

    // Ctrl+W spam: every press closes a real tab — never a ghost — and the
    // strip is right the moment the last one lands.
    await page.evaluate(() => { for (let i = 0; i < 6; i++) openNewTab(); });
    const n = await page.evaluate(() => tabs.list.length);
    await page.locator('.fp-tab.fp-tab--active').focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+w');
    const after = await page.evaluate(() => ({
      n: tabs.list.length, dom: document.querySelectorAll('.fp-tab').length,
      active: document.querySelectorAll('.fp-tab.fp-tab--active').length,
      activeOk: document.querySelector('.fp-tab.fp-tab--active')?.dataset.tabId === tabs.activeId,
    }));
    expect(after).toEqual({ n: n - 5, dom: n - 5, active: 1, activeOk: true });
    await settled(page, '#tabbar');
    // The overflow fade agrees with the strip once the ghosts are gone.
    expect(await page.evaluate(() => {
      const t = document.getElementById('tabbar');
      return [document.querySelectorAll('.fp-tab-ghost').length,
        t.classList.contains('fp-tabbar--overflow') === (t.scrollWidth - t.clientWidth - t.scrollLeft > 1)];
    })).toEqual([0, true]);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('tabs: many tabs keep the overflow fade and the active tab in view through insert and close animations', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await page.evaluate(() => { for (let i = 0; i < 14; i++) openNewTab(); });
    await settled(page, '#tabbar');
    const s = await page.evaluate(() => {
      const t = document.getElementById('tabbar');
      const active = document.querySelector('.fp-tab.fp-tab--active').getBoundingClientRect();
      const strip = t.getBoundingClientRect();
      return { overflowOk: t.classList.contains('fp-tabbar--overflow') === (t.scrollWidth - t.clientWidth - t.scrollLeft > 1),
        scrolls: t.scrollWidth > t.clientWidth,
        activeInView: active.right <= strip.right + 1 && active.left >= strip.left - 1 };
    });
    expect(s).toEqual({ overflowOk: true, scrolls: true, activeInView: true });
    // Scrolled back to the start, the fade says there is more on the right.
    await page.evaluate(() => { document.getElementById('tabbar').scrollLeft = 0; });
    await expect(page.locator('#tabbar')).toHaveClass(/fp-tabbar--overflow/);
    for (let i = 0; i < 12; i++) await page.evaluate(() => closeCurrentTab());
    await settled(page, '#tabbar');
    expect(await page.evaluate(() => {
      const t = document.getElementById('tabbar');
      return t.classList.contains('fp-tabbar--overflow') === (t.scrollWidth - t.clientWidth - t.scrollLeft > 1);
    })).toBe(true);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('tabs: the underline slides to the newly active tab; a drop slides the reordered tabs', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await page.evaluate(() => { openNewTab(); openNewTab(); });
    await settled(page, '#tabbar');
    const r = await page.evaluate(() => {
      const first = tabsInStripOrder()[0];
      activateTab(first);
      const bar = document.querySelector('.fp-tab-slider');
      const el = document.querySelector(`.fp-tab[data-tab-id="${first}"]`);
      return { active: el.classList.contains('fp-tab--active'), hit: window.__fpHitIs(el),
        bar: !!bar, barAnims: window.__fpAnims(bar), pe: bar && getComputedStyle(bar).pointerEvents };
    });
    expect(r.active).toBe(true);
    expect(r.hit).toBe(true);
    expect(r.bar).toBe(true);
    expect(r.pe).toBe('none');
    expect(r.barAnims.length).toBe(1);
    expect(r.barAnims[0].duration).toBeLessThanOrEqual(140);
    await settled(page, '#tabbar');
    expect(await page.locator('.fp-tab-slider').count()).toBe(0);

    // Drag the first tab onto the right half of the last: the order is final
    // in the same task, and the tabs that moved slide there.
    const d = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.fp-tab')];
      const [a, b, c] = els;
      const dataTransfer = new DataTransfer();
      a.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const rc = c.getBoundingClientRect();
      c.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: rc.right - 2, clientY: rc.top + 5 }));
      const order = tabsInStripOrder();
      const anims = window.__fpAnims(b);
      a.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      return { lastIsA: order[order.length - 1] === a.dataset.tabId, anims };
    });
    expect(d.lastIsA).toBe(true);
    expect(d.anims.length).toBe(1);
    expect(d.anims[0].duration).toBeLessThanOrEqual(140);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('sidebar: collapse/expand animates, the identity card tracks it, Ctrl+B spam ends right', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const start = await page.evaluate(() => ({
      id: document.getElementById('identity').getBoundingClientRect().width,
      sb: document.getElementById('sidebar').getBoundingClientRect().width,
    }));
    // Every frame of one collapse: the card's width moves through in-between
    // values with the sidebar's, never snapping ahead of the content pane.
    const frames = await page.evaluate(() => new Promise((resolve) => {
      const out = [];
      const idEl = document.getElementById('identity');
      toggleSidebar();
      const same = {
        collapsed: document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed'),
        rail: document.getElementById('header').classList.contains('fp-header--rail'),
      };
      const t0 = performance.now();
      const tick = () => {
        out.push({ id: idEl.getBoundingClientRect().width, sb: document.getElementById('sidebar').getBoundingClientRect().width });
        if (performance.now() - t0 < 400) requestAnimationFrame(tick); else resolve({ same, out });
      };
      requestAnimationFrame(tick);
    }));
    expect(frames.same).toEqual({ collapsed: true, rail: true });
    const end = frames.out[frames.out.length - 1];
    expect(end.sb).toBeLessThan(start.sb);
    const between = (v, a, b) => v < Math.max(a, b) - 1 && v > Math.min(a, b) + 1;
    expect(frames.out.some((f) => between(f.id, start.id, end.id)), JSON.stringify(frames.out.slice(0, 8))).toBe(true);
    expect(frames.out.some((f) => between(f.sb, start.sb, end.sb))).toBe(true);
    for (let i = 1; i < frames.out.length; i++) expect(frames.out[i].id).toBeLessThanOrEqual(frames.out[i - 1].id + 0.5);
    await settled(page);

    // Ctrl+B spam: the class flips at every press, the widths end at the
    // right values, nothing keeps running.
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+b');
    expect(await page.evaluate(() => document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed'))).toBe(false);
    await settled(page);
    const fin = await page.evaluate(() => ({
      id: document.getElementById('identity').getBoundingClientRect().width,
      sb: document.getElementById('sidebar').getBoundingClientRect().width,
      tabs: document.getElementById('tabbar').getBoundingClientRect().left,
      pane: document.getElementById('main').getBoundingClientRect().left,
      opacity: getComputedStyle(document.querySelector('.fp-sidebar__scroll')).opacity,
    }));
    expect(Math.abs(fin.id - start.id)).toBeLessThan(1);
    expect(Math.abs(fin.sb - start.sb)).toBeLessThan(1);
    // Expanded: the tabs begin where the content pane begins.
    expect(Math.abs(fin.tabs - fin.pane)).toBeLessThan(1.5);
    expect(fin.opacity).toBe('1');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('sidebar: This PC folds and unfolds, a folding section takes no clicks; the maximise glyph crossfades', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await expect.poll(() => page.locator('#sb-drives .fp-sidebar__item').count()).toBeGreaterThan(0);
    const r = await page.evaluate(() => {
      const body = document.getElementById('sb-drives');
      const item = body.querySelector('.fp-sidebar__item');
      const chev = document.querySelector('#sb-thispc .fp-sidebar__chevron');
      // The chevron's own path, minus the config write (so no later spec
      // starts with the section shut).
      setThisPcOpen(false, { persist: false, animate: true });
      return { hidden: body.hidden, inert: body.inert, itemHit: window.__fpHitIs(item),
        anims: window.__fpAnims(body), chevAnims: window.__fpAnims(chev), expanded: chev.getAttribute('aria-expanded') };
    });
    expect(r.hidden).toBe(true);
    expect(r.inert).toBe(true);
    expect(r.itemHit).toBe(false);
    expect(r.expanded).toBe('false');
    expect(r.anims.length).toBe(1);
    expect(r.anims[0].duration).toBeLessThanOrEqual(140);
    for (const a of r.chevAnims) expect(a.duration).toBeLessThanOrEqual(100);
    // Reopened mid-fold: open at once, clickable at once.
    const back = await page.evaluate(() => {
      setThisPcOpen(true, { persist: false, animate: true });
      const body = document.getElementById('sb-drives');
      return { hidden: body.hidden, inert: body.inert, closing: body.classList.contains('is-closing'),
        anims: window.__fpAnims(body) };
    });
    expect(back).toMatchObject({ hidden: false, inert: false, closing: false });
    expect(back.anims.length).toBe(1);
    await settled(page, '#sidebar');
    expect(await page.evaluate(() => window.__fpHitIs(document.querySelector('#sb-drives .fp-sidebar__item')))).toBe(true);

    const g = await page.evaluate(() => {
      setMaximizeButtonState(true);
      const btn = document.getElementById('btn-maximize');
      return { label: btn.getAttribute('aria-label'), href: btn.querySelector('use').getAttribute('href'),
        anims: window.__fpAnims(btn.querySelector('svg')) };
    });
    expect(g.label).toBe('Restore');
    expect(g.href).toBe('#fp-window-restore');
    expect(g.anims.length).toBe(1);
    expect(g.anims[0].duration).toBeLessThanOrEqual(100);
    await page.evaluate(() => setMaximizeButtonState(false));
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('with the switch off the chrome motion leaves nothing behind: no ghosts, bars or folding states, no animations', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await startSampler(page);
    const r = await page.evaluate(() => {
      openNewTab(); openNewTab();
      activateTab(tabsInStripOrder()[0]);
      closeCurrentTab();
      toggleSidebar(); toggleSidebar();
      setThisPcOpen(false, { persist: false, animate: true }); setThisPcOpen(true, { persist: false, animate: true });
      setMaximizeButtonState(true); setMaximizeButtonState(false);
      return {
        leftovers: document.querySelectorAll('.fp-tab-ghost, .fp-tab-slider, .is-closing, [inert]').length,
        running: document.getAnimations().length,
      };
    });
    expect(r).toEqual({ leftovers: 0, running: 0 });
    const seen = await stopSampler(page);
    expect(seen, JSON.stringify(seen.slice(0, 5))).toEqual([]);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Task 6: screens, inspector, Settings (addendum §5.2) ─────────────────────

/** Resolves after `ms` of animation frames have passed in the page (a
 * frame-clock wait for the burst rules, not a test-side sleep). */
const pageFrames = (page, ms) => page.evaluate((wait) => new Promise((resolve) => {
  const t0 = performance.now();
  const tick = () => (performance.now() - t0 >= wait ? resolve() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), ms);

test('screens: the new screen is live at once and fades up from half opacity; the old one is hidden at once', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const r = await page.evaluate(() => {
      const home = document.getElementById('screen-home');
      const settings = document.getElementById('screen-settings');
      switchScreen('settings');
      const nav = settings.querySelector('.settings-nav__item');
      const anim = settings.getAnimations()[0];
      return {
        active: settings.classList.contains('active'), navHit: window.__fpHitIs(nav),
        homeShown: getComputedStyle(home).display, homeAnims: home.getAnimations().length,
        inAnims: window.__fpAnims(settings), from: anim && Number(anim.effect.getKeyframes()[0].opacity),
      };
    });
    // Fix round 1: no leaving copy of the old screen is kept painted (that
    // cost a full layout of a big listing) — it is hidden in the same task.
    expect(r).toMatchObject({ active: true, navHit: true, homeShown: 'none', homeAnims: 0, from: 0.5 });
    expect(r.inAnims.length).toBe(1);
    expect(r.inAnims[0].duration).toBeLessThanOrEqual(100);
    await settled(page, '#screens');

    // Back and forth in one task: one live screen, the last one.
    const q = await page.evaluate(() => {
      switchScreen('home');
      switchScreen('settings');
      switchScreen('home');
      const home = document.getElementById('screen-home');
      return { active: home.classList.contains('active'), inert: home.inert,
        shown: [...document.querySelectorAll('.screen')].filter((s) => getComputedStyle(s).display !== 'none').length };
    });
    expect(q).toEqual({ active: true, inert: false, shown: 1 });
    await settled(page, '#screens');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('inspector: open/close slides the panel and resizes the file pane; closed means closed at once; Ctrl+I spam ends right', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => { setInspectorOpen(true, { persist: false }); return loadDirectory(p); }, root);
    await page.waitForFunction(() => !window.__fpLoadPending);
    await settled(page);
    const openW = await page.evaluate(() => document.getElementById('inspector').getBoundingClientRect().width);
    const listW0 = await page.evaluate(() => document.getElementById('list-pane').getBoundingClientRect().width);

    const c = await page.evaluate(() => {
      const ins = document.getElementById('inspector');
      const center = window.__fpCenter(ins);
      setInspectorOpen(false, { persist: false, animate: true });
      const hit = document.elementFromPoint(center.x, center.y);
      return { open: ins.classList.contains('inspector--open'), closing: ins.classList.contains('inspector--closing'),
        inert: ins.inert, hitIns: !!hit && ins.contains(hit),
        resizer: getComputedStyle(document.getElementById('resizer')).display, anims: window.__fpAnims(ins),
        position: getComputedStyle(ins).position,
        overScrollbar: Number(getComputedStyle(ins).zIndex)
          > Number(getComputedStyle(document.documentElement).getPropertyValue('--z-overlay-scroll')),
        prop: Object.keys(ins.getAnimations()[0].effect.getKeyframes()[0]).find((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)),
        listW: document.getElementById('list-pane').getBoundingClientRect().width };
    });
    expect(c).toMatchObject({ open: false, closing: true, inert: true, hitIns: false, resizer: 'none',
      position: 'absolute', prop: 'transform', overScrollbar: true });
    expect(c.anims.length).toBe(1);
    expect(c.anims[0].duration).toBeLessThanOrEqual(140);
    // The file pane took its full width at once (fix round 1: laid out once,
    // not per frame); the panel slides out over its edge by transform.
    expect(c.listW).toBeGreaterThan(listW0 + openW - 2);
    await settled(page);
    expect(await page.evaluate(() => {
      const ins = document.getElementById('inspector');
      return [getComputedStyle(ins).display, ins.inert, ins.classList.contains('inspector--closing')];
    })).toEqual(['none', false, false]);

    // Open: the panel's controls take focus at once.
    const o = await page.evaluate(() => {
      const ins = document.getElementById('inspector');
      setInspectorOpen(true, { persist: false, animate: true });
      const tab = ins.querySelector('.fp-inspector__tab');
      tab.focus();
      return { open: ins.classList.contains('inspector--open'), inert: ins.inert, focused: document.activeElement === tab,
        anims: window.__fpAnims(ins), listW: document.getElementById('list-pane').getBoundingClientRect().width };
    });
    expect(o).toMatchObject({ open: true, inert: false, focused: true });
    // The file pane is at its narrow width from the first frame.
    expect(Math.abs(o.listW - listW0)).toBeLessThan(1);
    expect(o.anims.length).toBe(1);
    expect(o.anims[0].duration).toBeLessThanOrEqual(140);

    // Ctrl+I spam (the real shortcut): the class follows every press and the
    // panel lands at its full width with nothing left running.
    await page.locator('#list-scroll').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 5; i++) await page.keyboard.press('Control+i');
    expect(await page.evaluate(() => document.getElementById('inspector').classList.contains('inspector--open'))).toBe(false);
    await page.keyboard.press('Control+i');
    await settled(page);
    const fin = await page.evaluate(() => {
      const ins = document.getElementById('inspector');
      return { open: ins.classList.contains('inspector--open'), w: ins.getBoundingClientRect().width,
        tf: getComputedStyle(ins).transform, inert: ins.inert, listW: document.getElementById('list-pane').getBoundingClientRect().width };
    });
    expect(fin.open).toBe(true);
    expect(Math.abs(fin.w - openW)).toBeLessThan(1);
    expect(fin.tf).toBe('none');
    expect(fin.inert).toBe(false);
    expect(Math.abs(fin.listW - listW0)).toBeLessThan(1);
  } finally {
    await app.close();
    // Ctrl+I saves ui.inspector_open; put the default back for later specs.
    await delConfig('ui.inspector_open');
  }
  expect(errors).toEqual([]);
});

test('inspector: a discrete selection change crossfades the content; a burst and a re-announce do not; tabs fade', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await settled(page);
    await page.evaluate(() => updateInspector('single', { name: 'a.txt', path: 'C:\\probe\\a.txt' }));
    await pageFrames(page, 260);
    const d = await page.evaluate(() => {
      const scroll = document.getElementById('inspector-scroll');
      updateInspector('single', { name: 'b.txt', path: 'C:\\probe\\b.txt' });
      const first = scroll.getAnimations();
      // Same task, another item: a burst — no second fade starts.
      updateInspector('single', { name: 'c.txt', path: 'C:\\probe\\c.txt' });
      const burst = scroll.getAnimations();
      return { first: first.map((a) => a.effect.getComputedTiming().duration), sameOne: burst.length === 1 && burst[0] === first[0],
        name: document.getElementById('inspector-filename').textContent };
    });
    expect(d.first).toEqual([100]);
    expect(d.sameOne).toBe(true);
    expect(d.name).toBe('c.txt');
    await settled(page, '#inspector');
    await pageFrames(page, 260);
    // The same item announced again (a listing refresh): no fade.
    expect(await page.evaluate(() => {
      updateInspector('single', { name: 'c.txt', path: 'C:\\probe\\c.txt' });
      return document.getElementById('inspector-scroll').getAnimations().length;
    })).toBe(0);
    // Preview / Tags / History: the pane that comes into view fades in.
    const t = await page.evaluate(() => {
      switchInspectorTab('tags');
      const pane = document.querySelector('#inspector .fp-inspector__pane[data-pane="tags"]');
      return { hidden: pane.hidden, anims: window.__fpAnims(pane) };
    });
    expect(t.hidden).toBe(false);
    expect(t.anims.length).toBe(1);
    expect(t.anims[0].duration).toBeLessThanOrEqual(100);
    await page.evaluate(() => switchInspectorTab('preview'));
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('Settings: a pane switch fades the new pane up; a segmented control slides its highlight; toggles slide their knob', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await page.evaluate(() => switchScreen('settings'));
    await settled(page);
    const p = await page.evaluate(() => {
      const current = document.querySelector('.settings-nav__item--active')?.dataset.pane;
      const next = [...document.querySelectorAll('.settings-nav__item[data-pane]')].map((b) => b.dataset.pane).find((x) => x !== current);
      switchSettingsPane(next);
      const pane = document.querySelector(`.settings-pane[data-pane="${next}"]`);
      return { shown: pane.style.display !== 'none', anims: window.__fpAnims(pane), back: current };
    });
    expect(p.shown).toBe(true);
    expect(p.anims.length).toBe(1);
    expect(p.anims[0].duration).toBeLessThanOrEqual(100);
    await page.evaluate((b) => switchSettingsPane(b), p.back);
    await settled(page);

    // A segmented control (here: density, flipped by class only — no save):
    // the highlight travels from the old option to the new one.
    const s = await page.evaluate(async () => {
      const seg = document.querySelector('.fp-segmented:has([data-action="settings-set-density"])');
      const opts = [...seg.querySelectorAll('.fp-segmented__opt')];
      const from = opts.find((o) => o.classList.contains('active'));
      const to = opts.find((o) => o !== from);
      from.classList.remove('active');
      to.classList.add('active');
      await Promise.resolve();   // the observer's microtask
      const glide = seg.querySelector('.fp-segmented__glide');
      const out = { glide: !!glide, anims: window.__fpAnims(glide), pe: glide && getComputedStyle(glide).pointerEvents,
        toHit: window.__fpHitIs(to) };
      to.classList.remove('active');
      from.classList.add('active');
      return out;
    });
    expect(s.glide).toBe(true);
    expect(s.pe).toBe('none');
    expect(s.toHit).toBe(true);
    expect(s.anims.length).toBe(1);
    expect(s.anims[0].duration).toBeLessThanOrEqual(140);
    await settled(page);
    expect(await page.locator('.fp-segmented__glide').count()).toBe(0);
    // Toggles: the knob's transform transitions within the ceiling.
    const knob = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.fp-toggle__thumb'));
      return { prop: cs.transitionProperty, dur: cs.transitionDuration };
    });
    expect(knob.prop).toContain('transform');
    expect(parseFloat(knob.dur) * 1000).toBeLessThanOrEqual(140);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('with the switch off, screens, the inspector and Settings change with no animation and no leftovers', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await startSampler(page);
    const r = await page.evaluate(async () => {
      switchScreen('settings');
      const panes = [...document.querySelectorAll('.settings-nav__item[data-pane]')].map((b) => b.dataset.pane);
      switchSettingsPane(panes[1]); switchSettingsPane(panes[0]);
      const seg = document.querySelector('.fp-segmented:has([data-action="settings-set-density"])');
      const opts = [...seg.querySelectorAll('.fp-segmented__opt')];
      const from = opts.find((o) => o.classList.contains('active'));
      const to = opts.find((o) => o !== from);
      from.classList.remove('active'); to.classList.add('active');
      await Promise.resolve();
      to.classList.remove('active'); from.classList.add('active');
      await Promise.resolve();
      switchScreen('home');
      setInspectorOpen(false, { persist: false, animate: true });
      setInspectorOpen(true, { persist: false, animate: true });
      updateInspector('single', { name: 'x', path: 'C:\\probe\\x' });
      switchInspectorTab('history'); switchInspectorTab('preview');
      return {
        leftovers: document.querySelectorAll('.screen--leaving, .inspector--closing, .fp-segmented__glide, [inert]').length,
        running: document.getAnimations().length,
      };
    });
    expect(r).toEqual({ leftovers: 0, running: 0 });
    const seen = await stopSampler(page);
    expect(seen, JSON.stringify(seen.slice(0, 5))).toEqual([]);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Task 6: menus, popovers, dialogs, notices, buttons (addendum §5.2) ───────


test('menus: the context menu, its flyout and the View menu scale in from their anchor; items are hit at once; close is instant', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => loadDirectory(p), root);
    await page.waitForFunction(() => !window.__fpLoadPending);
    const box = await page.locator('#list-scroll').boundingBox();
    const x = Math.round(box.x + box.width - 40);
    const y = Math.round(box.y + box.height - 30);
    const m = await page.evaluate(({ x, y }) => {
      // A right-click on the list's empty area, in this same task.
      document.getElementById('list-scroll').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
      const menu = document.getElementById('context-menu');
      const items = [...menu.querySelectorAll('.fp-context-menu__item:not(.fp-context-menu__item--disabled)')];
      const [ox, oy] = menu.style.transformOrigin.split(' ').map(parseFloat);
      return { shown: contextMenuIsOpen(), anims: window.__fpAnims(menu), allHit: items.every((i) => window.__fpHitIs(i)),
        // The origin is the pointer: the menu grows out of the click point
        // (laid-out position plus origin, wherever the edge clamp put it).
        originAt: [Math.round(parseFloat(menu.style.left) + ox), Math.round(parseFloat(menu.style.top) + oy)] };
    }, { x, y });
    expect(m.shown).toBe(true);
    expect(m.allHit).toBe(true);
    expect(m.anims.length).toBe(1);
    expect(m.anims[0].duration).toBeLessThanOrEqual(100);
    expect(Math.abs(m.originAt[0] - x)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.originAt[1] - y)).toBeLessThanOrEqual(2);
    // A flyout (View / Sort by …) opens the same way, from its parent row's side.
    const f = await page.evaluate(() => {
      const parent = document.querySelector('#context-menu .fp-context-menu__item[aria-haspopup="true"]');
      if (!parent) return null;
      parent.click();
      const fly = document.querySelector('.fp-context-menu--flyout');
      const items = [...fly.querySelectorAll('.fp-context-menu__item:not(.fp-context-menu__item--disabled)')];
      return { anims: window.__fpAnims(fly), allHit: items.every((i) => window.__fpHitIs(i)) };
    });
    expect(f).not.toBeNull();
    expect(f.allHit).toBe(true);
    expect(f.anims.length).toBe(1);
    expect(f.anims[0].duration).toBeLessThanOrEqual(100);
    // Close: gone in the same task, nothing fades out over the list.
    expect(await page.evaluate(() => {
      hideContextMenu();
      const menu = document.getElementById('context-menu');
      return [getComputedStyle(menu).display, menu.getAnimations().length, document.querySelectorAll('.fp-context-menu--flyout').length];
    })).toEqual(['none', 0, 0]);

    // The View menu drops from its button: origin on the top edge.
    const v = await page.evaluate(() => {
      document.querySelector('[data-action="open-view-menu"]').click();
      const menu = document.getElementById('context-menu');
      const first = menu.querySelector('.fp-context-menu__item:not(.fp-context-menu__item--disabled)');
      return { anims: window.__fpAnims(menu), hit: window.__fpHitIs(first), oy: parseFloat(menu.style.transformOrigin.split(' ')[1]) };
    });
    expect(v.hit).toBe(true);
    expect(v.anims.length).toBe(1);
    expect(v.oy).toBe(0);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('popovers: the search dropdown and Ask File+ fade and scale in within --motion-fast and take input at once', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const a = await page.evaluate(() => {
      openAskPopout();
      const pop = document.getElementById('ask-popout');
      const input = document.getElementById('ask-input');
      return { focused: document.activeElement === input, anims: window.__fpAnims(pop),
        origin: getComputedStyle(pop).transformOrigin };
    });
    expect(a.focused).toBe(true);
    expect(a.anims.length).toBe(1);
    expect(a.anims[0].duration).toBeLessThanOrEqual(100);
    expect(a.origin).toMatch(/^0px 0px/);
    await page.keyboard.type('hi');
    expect(await page.locator('#ask-input').inputValue()).toBe('hi');
    await page.evaluate(() => closeAskPopout());

    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => loadDirectory(p), root);
    await page.waitForFunction(() => !window.__fpLoadPending);
    const s = await page.evaluate(() => {
      openSearchDropdown();
      const dd = document.getElementById('search-dropdown');
      const first = dd.querySelector('button');
      return { shown: !dd.hidden, anims: window.__fpAnims(dd), hit: window.__fpHitIs(first) };
    });
    expect(s.shown).toBe(true);
    expect(s.hit).toBe(true);
    expect(s.anims.length).toBe(1);
    expect(s.anims[0].duration).toBeLessThanOrEqual(100);
    await page.evaluate(() => closeSearchDropdown());
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('dialogs: open scales in with its fields live at once; close fades scrim and backing together and the scrim takes no input', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const o = await page.evaluate(() => {
      openMoreFilters();
      const scrim = document.getElementById('search-filters-scrim');
      const modal = document.getElementById('search-filters-modal');
      const field = document.getElementById('search-filter-ext');
      field.focus();
      return { focused: document.activeElement === field, fieldHit: window.__fpHitIs(field),
        scrim: window.__fpAnims(scrim), modal: window.__fpAnims(modal) };
    });
    expect(o.focused).toBe(true);
    expect(o.fieldHit).toBe(true);
    expect(o.scrim.length).toBe(1);
    expect(o.modal.length).toBe(1);
    expect(o.scrim[0].duration).toBeLessThanOrEqual(140);
    expect(o.modal[0].duration).toBeLessThanOrEqual(140);
    await page.keyboard.type('pdf');
    expect(await page.locator('#search-filter-ext').inputValue()).toBe('pdf');
    await settled(page);

    const c = await page.evaluate(() => {
      const scrim = document.getElementById('search-filters-scrim');
      closeMoreFilters();
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return {
        open: anyScrimOpen(), flag: document.documentElement.dataset.scrimOpen || null,
        hidden: scrim.getAttribute('aria-hidden'), inert: scrim.inert, pe: getComputedStyle(scrim).pointerEvents,
        hitScrim: !!hit && scrim.contains(hit), anims: window.__fpAnims(scrim),
        backing: getComputedStyle(document.documentElement).transitionDuration,
      };
    });
    expect(c).toMatchObject({ open: false, flag: null, hidden: 'true', inert: true, pe: 'none', hitScrim: false });
    expect(c.anims.length).toBe(1);
    // The scrim fades out exactly as long as the Mica backing behind it.
    expect(c.anims[0].duration).toBe(100);
    await settled(page);
    expect(await page.evaluate(() => {
      const scrim = document.getElementById('search-filters-scrim');
      return [scrim.style.display, scrim.inert, scrim.classList.contains('fp-scrim--closing')];
    })).toEqual(['none', false, false]);

    // Escape closes the palette; a new open mid-fade is live at once.
    await page.evaluate(() => openPalette());
    await page.keyboard.press('Escape');
    const r = await page.evaluate(() => {
      const scrim = document.getElementById('palette-scrim');
      const closing = scrim.classList.contains('fp-scrim--closing');
      openPalette();
      return { closing, open: anyScrimOpen(), inert: scrim.inert, cls: scrim.classList.contains('fp-scrim--closing'),
        focused: document.activeElement === document.getElementById('palette-input'),
        hit: window.__fpHitIs(document.getElementById('palette-input')) };
    });
    expect(r).toEqual({ closing: true, open: true, inert: false, cls: false, focused: true, hit: true });
    await page.keyboard.press('Escape');
    await settled(page);
    expect(await page.evaluate(() => [document.getElementById('palette-scrim').style.display, anyScrimOpen()])).toEqual(['none', false]);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('notices: a new one slides up and the stack slides to make room; a dismissed one leaves inert and the rest close the gap', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const was = await page.evaluate(() => localStorage.getItem('fp-notifications-enabled'));
    try {
      await page.evaluate(() => localStorage.setItem('fp-notifications-enabled', 'on'));
      await page.evaluate(() => showToast('first'));
      await settled(page, '#toast-container');
      const add = await page.evaluate(() => {
        showToast('second', 'error');
        const [first, second] = document.querySelectorAll('#toast-container .fp-toast');
        return { first: window.__fpAnims(first), second: window.__fpAnims(second) };
      });
      expect(add.first.length).toBe(1);
      expect(add.second.length).toBe(1);
      for (const x of [...add.first, ...add.second]) expect(x.duration).toBeLessThanOrEqual(140);
      await settled(page, '#toast-container');

      const d = await page.evaluate(() => {
        const [first, second] = document.querySelectorAll('#toast-container .fp-toast');
        second.querySelector('.fp-toast__dismiss').click();
        return { leaving: second.classList.contains('fp-notice--leaving'), inert: second.inert,
          hit: window.__fpHitIs(second), live: document.querySelectorAll('#toast-container .fp-toast:not(.fp-notice--leaving)').length,
          anims: window.__fpAnims(second), firstHit: window.__fpHitIs(first) };
      });
      expect(d).toMatchObject({ leaving: true, inert: true, hit: false, live: 1, firstHit: true });
      expect(d.anims.length).toBe(1);
      expect(d.anims[0].duration).toBeLessThanOrEqual(100);
      // Gone once it has faded; the one left slides down into its place.
      await expect.poll(() => page.locator('#toast-container .fp-toast').count()).toBe(1);
      await settled(page, '#toast-container');
      // The snackbar stack counts only live notices: four quick ones keep three.
      const n = await page.evaluate(() => {
        for (let i = 0; i < 4; i++) showSnackbar(`s${i}`, null, null);
        return document.querySelectorAll('#snackbar-container .fp-snackbar:not(.fp-notice--leaving)').length;
      });
      expect(n).toBe(3);
    } finally {
      await page.evaluate((v) => { if (v === null) localStorage.removeItem('fp-notifications-enabled'); else localStorage.setItem('fp-notifications-enabled', v); }, was);
    }
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('buttons: a press scales to .97 over --motion-instant with animations on, the 1 px nudge with them off', async () => {
  for (const motion of [true, false]) {
    const { app, page, errors } = await launchApp({ motion });
    try {
      const b = await page.locator('#btn-inspector-toggle').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      const want = motion ? 'matrix(0.97, 0, 0, 0.97, 0, 0)' : 'matrix(1, 0, 0, 1, 0, 1)';
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.getElementById('btn-inspector-toggle')).transform)).toBe(want);
      const dur = await page.evaluate(() => getComputedStyle(document.getElementById('btn-inspector-toggle')).transitionDuration);
      expect(dur.split(',').every((d) => parseFloat(d) * 1000 <= 60)).toBe(true);
      // Released off the button: no click, nothing toggled, no press left.
      await page.mouse.move(5, b.y + 200);
      await page.mouse.up();
      expect(await page.evaluate(() => document.querySelectorAll('.fp-pressed').length)).toBe(0);
      // A press the window loses focus during (Alt+Tab) never sticks.
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      const during = await page.evaluate(() => {
        const was = document.getElementById('btn-inspector-toggle').classList.contains('fp-pressed');
        window.dispatchEvent(new Event('blur'));
        return [was, document.querySelectorAll('.fp-pressed').length];
      });
      expect(during).toEqual([true, 0]);
      await page.mouse.move(5, b.y + 200);
      await page.mouse.up();
    } finally {
      await app.close();
    }
    expect(errors).toEqual([]);
  }
});

test('with the switch off, menus, dialogs, popovers and notices open and close instantly with nothing left behind', async () => {
  const { app, page, errors } = await launchApp();
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => loadDirectory(p), root);
    await page.waitForFunction(() => !window.__fpLoadPending);
    await startSampler(page);
    const was = await page.evaluate(() => localStorage.getItem('fp-notifications-enabled'));
    const r = await page.evaluate(() => {
      localStorage.setItem('fp-notifications-enabled', 'on');
      document.getElementById('list-scroll').dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, button: 2 }));
      document.querySelector('#context-menu .fp-context-menu__item[aria-haspopup="true"]')?.click();
      hideContextMenu();
      document.querySelector('[data-action="open-view-menu"]').click();
      hideContextMenu();
      openAskPopout(); closeAskPopout();
      openSearchDropdown(); closeSearchDropdown();
      openPalette(); closePalette();
      openMoreFilters(); closeMoreFilters();
      showToast('x', 'error'); showToast('y');
      document.querySelector('#toast-container .fp-toast__dismiss').click();
      const toasts = document.querySelectorAll('#toast-container .fp-toast').length;
      return {
        toasts,
        scrims: [...document.querySelectorAll('.fp-scrim')].filter((s) => s.style.display !== 'none').length,
        leftovers: document.querySelectorAll('.fp-scrim--closing, .fp-notice--leaving, [inert]').length,
        running: document.getAnimations().length,
      };
    });
    await page.evaluate((v) => { if (v === null) localStorage.removeItem('fp-notifications-enabled'); else localStorage.setItem('fp-notifications-enabled', v); }, was);
    expect(r).toEqual({ toasts: 1, scrims: 0, leftovers: 0, running: 0 });
    const seen = await stopSampler(page);
    expect(seen, JSON.stringify(seen.slice(0, 5))).toEqual([]);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('key repeat (a held Ctrl+T / Ctrl+W / Ctrl+B / Ctrl+I) acts at every step and starts no animation per step (§5.1 rule 4)', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await settled(page);
    const r = await page.evaluate(() => {
      const press = (key, repeat) => document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: `Key${key.toUpperCase()}`, ctrlKey: true, repeat, bubbles: true, cancelable: true }));
      // Ctrl held on its own (for a Ctrl+click) auto-repeats: not a held step.
      for (let i = 0; i < 3; i++) {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', code: 'ControlLeft', ctrlKey: true, repeat: true, bubbles: true }));
      }
      const modifierHeld = document.documentElement.classList.contains('fp-key-repeat');
      // Every kind: fpAnimate, CSS transitions (the sidebar's width, the
      // shell column, the header card, a tab's fill) and CSS animations.
      const scripted = (root = document) => (root === document ? document.getAnimations() : root.getAnimations({ subtree: true })).length;
      const n0 = tabs.list.length;
      for (let i = 0; i < 4; i++) press('t', true);
      const afterT = { added: tabs.list.length - n0, running: scripted() };
      for (let i = 0; i < 3; i++) press('w', true);
      const afterW = { left: tabs.list.length - n0, ghosts: document.querySelectorAll('.fp-tab-ghost').length,
        running: scripted() };
      press('i', true);
      const ins = document.getElementById('inspector');
      const afterI = { closing: ins.classList.contains('inspector--closing'), running: scripted(ins) };
      press('i', true);
      press('b', true);
      const afterB = { collapsed: document.getElementById('sidebar').classList.contains('fp-sidebar--collapsed'),
        running: scripted(document.getElementById('app')), all: scripted() };
      press('b', true);
      const held = document.documentElement.classList.contains('fp-key-repeat');
      // The key comes up: the hold is over.
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'b', code: 'KeyB', ctrlKey: true, bubbles: true }));
      return { modifierHeld, afterT, afterW, afterI, afterB, held, released: !document.documentElement.classList.contains('fp-key-repeat') };
    });
    expect(r.modifierHeld).toBe(false);
    expect(r.afterT).toEqual({ added: 4, running: 0 });
    expect(r.afterW).toEqual({ left: 1, ghosts: 0, running: 0 });
    expect(r.afterI).toEqual({ closing: false, running: 0 });
    expect(r.afterB).toEqual({ collapsed: true, running: 0, all: 0 });
    expect([r.held, r.released]).toEqual([true, true]);
    await settled(page);
    // Released, a plain Ctrl+B animates the width again.
    expect(await page.evaluate(() => {
      toggleSidebar();
      const w = document.getElementById('sidebar').getAnimations().filter((a) => a.transitionProperty === 'width').length;
      toggleSidebar();
      return w;
    })).toBe(1);
    // The first press of a key (not a repeat) still animates.
    const first = await page.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', ctrlKey: true, bubbles: true, cancelable: true }));
      return document.querySelector(`.fp-tab[data-tab-id="${tabs.activeId}"]`).getAnimations().length;
    });
    expect(first).toBeGreaterThan(0);
  } finally {
    await app.close();
    await delConfig('ui.inspector_open');
  }
  expect(errors).toEqual([]);
});

test('5,000 rows: inspector, sidebar and screen switches cost no more with motion on than off (fix round 1)', async () => {
  test.setTimeout(240_000);
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const root = (await apiGet('/fs/list/root')).path;
    await page.evaluate((p) => { setInspectorOpen(true, { persist: false }); return loadDirectory(p); }, root);
    await page.waitForFunction(() => !window.__fpLoadPending);
    // ~5,000 entries, generated in memory and rendered through the real path.
    await page.evaluate(() => {
      const now = Date.now() / 1000;
      browserState.entries = Array.from({ length: 5000 }, (_, i) => ({
        name: `generated-entry-${String(i).padStart(4, '0')}.txt`, ext: '.txt', is_dir: false,
        is_hidden: false, size: 1000 + i, modified: now - i * 60, created: now - i * 60, accessed: now,
      }));
      setView('details', null, { manual: false });
      renderDirectory();
    });
    expect(await page.locator('#list-scroll > .fp-row').count()).toBe(5000);
    await settled(page);

    // A big listing on screen turns off the per-frame width motion (the
    // contents' fade stays); leaving the Browser lifts it.
    const heavy = await page.evaluate(() => {
      const on = document.documentElement.classList.contains('fp-heavy-list');
      toggleSidebar();
      const widths = ['shell', 'sidebar', 'identity'].map((id) => document.getElementById(id).getAnimations().length);
      const fade = document.querySelector('.fp-sidebar__scroll').getAnimations().length;
      toggleSidebar();
      return { on, widths, fade };
    });
    expect(heavy).toEqual({ on: true, widths: [0, 0, 0], fade: 1 });
    await settled(page);

    /** Times one action in the page: the synchronous handler, the first
     * frame after it (rendered), and the longest frame in the 350 ms after. */
    const measure = (name) => page.evaluate(async (n) => {
      const actions = {
        inspectorClose: () => setInspectorOpen(false, { persist: false, animate: true }),
        inspectorOpen: () => setInspectorOpen(true, { persist: false, animate: true }),
        sidebarCollapse: () => toggleSidebar(),
        sidebarExpand: () => toggleSidebar(),
        toHome: () => switchScreen('home'),
        toBrowser: () => switchScreen('browser'),
      };
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const t0 = performance.now();
      actions[n]();
      const sync = performance.now() - t0;
      const first = await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(performance.now() - t0), 0)));
      let last = performance.now();
      let maxFrame = 0;
      await new Promise((r) => {
        const tick = () => {
          const now = performance.now();
          maxFrame = Math.max(maxFrame, now - last);
          last = now;
          if (now - t0 < 350) requestAnimationFrame(tick); else r();
        };
        requestAnimationFrame(tick);
      });
      return { sync, first, maxFrame };
    }, name);
    const names = ['inspectorClose', 'inspectorOpen', 'sidebarCollapse', 'sidebarExpand', 'toHome', 'toBrowser'];
    const run = async (motion) => {
      await page.evaluate((m) => fpSetMotion(m, { persist: false }), motion);
      const best = {};
      for (let round = 0; round < 3; round++) {
        for (const n of names) {
          const m = await measure(n);
          const b = best[n] || { sync: Infinity, first: Infinity, maxFrame: Infinity };
          best[n] = { sync: Math.min(b.sync, m.sync), first: Math.min(b.first, m.first), maxFrame: Math.min(b.maxFrame, m.maxFrame) };
        }
      }
      return best;
    };
    const off = await run(false);
    const on = await run(true);
    const fmt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, Math.round(b)]))]));
    console.log(`5,000 rows, motion off (ms): ${JSON.stringify(fmt(off))}`);
    console.log(`5,000 rows, motion on  (ms): ${JSON.stringify(fmt(on))}`);
    for (const n of names) {
      // Within ~1.3x of motion off (plus a frame of slack for timer noise).
      expect(on[n].sync, `${n} sync`).toBeLessThanOrEqual(off[n].sync * 1.3 + 8);
      expect(on[n].first, `${n} first frame`).toBeLessThanOrEqual(off[n].first * 1.3 + 17);
      // No frame of the animation that follows re-lays the listing out.
      expect(on[n].maxFrame, `${n} longest frame`).toBeLessThanOrEqual(Math.max(off[n].maxFrame * 1.3 + 17, 40));
    }
    // Leaving the big folder for This PC lifts it too, and Ctrl+B animates.
    await page.evaluate(() => loadDirectory(THISPC));
    await page.waitForFunction(() => !window.__fpLoadPending && thisPcActive());
    expect(await page.evaluate(() => {
      const heavyOff = !document.documentElement.classList.contains('fp-heavy-list');
      toggleSidebar();
      const width = document.getElementById('sidebar').getAnimations().filter((a) => a.transitionProperty === 'width').length;
      toggleSidebar();
      return [heavyOff, width];
    })).toEqual([true, 1]);
    expect(await page.evaluate(() => { switchScreen('home'); return document.documentElement.classList.contains('fp-heavy-list'); })).toBe(false);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

// ── Content motion (addendum §5.2: navigation, breadcrumb, rows, new and
// removed items, rename, cut/copy, views and sort — Task 7) ───────────────

/** The Motion fixture folder (global-setup.js). */
async function motionDir() {
  return `${(await apiGet('/fs/list/root')).path}\\Motion`;
}

async function openFolder(page, p) {
  await page.evaluate((x) => loadDirectory(x), p);
  await page.waitForFunction(() => !window.__fpLoadPending);
}

/** In-page helpers for the listing: what animates on #list-scroll itself
 * (its first keyframe), and on its rows and ghosts. */
async function installListProbes(page) {
  await installMotionProbes(page);
  await page.evaluate(() => {
    const first = (a) => {
      const k = a.effect.getKeyframes()[0] || {};
      return { opacity: k.opacity ?? null, transform: k.transform ?? null };
    };
    window.__fpListAnims = () => {
      const list = document.getElementById('list-scroll');
      return list.getAnimations().map((a) => ({ duration: a.effect.getComputedTiming().duration, ...first(a) }));
    };
    /** Animations on anything inside #list-scroll (rows, their parts,
     * ghosts) — CSS transitions included. */
    window.__fpRowAnims = () => {
      const list = document.getElementById('list-scroll');
      return list.getAnimations({ subtree: true }).filter((a) => a.effect.target !== list).map((a) => {
        const t = a.effect.target;
        const row = t.closest ? t.closest('.fp-row') : null;
        return {
          kind: a.constructor.name,
          prop: a.transitionProperty || null,
          pseudo: a.effect.pseudoElement || null,
          duration: a.effect.getComputedTiming().duration,
          row: row ? (row.dataset.path || '(ghost)').split('\\').pop() : null,
          self: t === row,
          ...first(a),
        };
      });
    };
    window.__fpRowPaths = () => [...document.querySelectorAll('#list-scroll > .fp-row[data-path]')]
      .map((r) => r.dataset.path.split('\\').pop());
    /** The rows on screen: is each icon painted, and is the row itself at
     * full opacity (only the listing as a whole may fade)? */
    window.__fpSampleListing = () => {
      const list = document.getElementById('list-scroll');
      const box = list.getBoundingClientRect();
      return [...list.querySelectorAll(':scope > .fp-row[data-path]')].filter((r) => {
        const b = r.getBoundingClientRect();
        return b.bottom > box.top && b.top < box.bottom;
      }).map((r) => {
        const img = r.querySelector('img[data-win-icon], img.fp-thumb');
        return {
          settled: !!img && img.complete && img.naturalWidth > 0 && !img.src.startsWith('data:image/gif'),
          opacity: getComputedStyle(r).opacity,
        };
      });
    };
  });
}

test('navigation: the listing fades in from the side it came from after the one render; rows take input at once', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const nav = `${await motionDir()}\\Nav`;
    const inner = `${nav}\\Inner`;
    const deepest = `${inner}\\Deepest`;
    await openFolder(page, nav);
    await settled(page);

    // Into a folder: one render, then a fade from 0.6 sliding in from the
    // right; a row is hit and selected in the same task.
    const into = await page.evaluate(async (p) => {
      const n0 = window.__fpRenderCount;
      await loadDirectory(p);
      const anims = __fpListAnims();
      const rowAnims = __fpRowAnims();
      const row = document.querySelector('#list-scroll > .fp-row[data-path]');
      const hit = __fpHitIs(row);
      selectRow(row.dataset.path);
      return { renders: window.__fpRenderCount - n0, anims, rowAnims, hit,
        selected: [...browserState.selection].map((s) => s.split('\\').pop()), opacity: getComputedStyle(row).opacity };
    }, inner);
    expect(into.renders).toBe(1);
    expect(into.anims).toEqual([{ duration: 140, opacity: '0.6', transform: 'translateX(6px)' }]);
    expect(into.rowAnims).toEqual([]);
    expect(into.hit).toBe(true);
    expect(into.selected).toEqual(['Deepest']);
    expect(into.opacity).toBe('1');
    // Keys act at once, mid-animation.
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => browserState.focus.split('\\').pop())).toBe('inner-1.txt');

    // Back and Up come in from the left, Forward from the right.
    const back = await page.evaluate(async () => { await navBack(); return __fpListAnims(); });
    expect(back).toEqual([{ duration: 140, opacity: '0.6', transform: 'translateX(-6px)' }]);
    const fwd = await page.evaluate(async () => { await navForward(); return __fpListAnims(); });
    expect(fwd).toEqual([{ duration: 140, opacity: '0.6', transform: 'translateX(6px)' }]);
    await openFolder(page, deepest);
    const up = await page.evaluate(async () => { navUp(); await browserState._navInFlight.done; return __fpListAnims(); });
    expect(up).toEqual([{ duration: 140, opacity: '0.6', transform: 'translateX(-6px)' }]);
    // A crumb to an ancestor is a way up too.
    const ancestor = await page.evaluate(async (p) => { await loadDirectory(p); return __fpListAnims(); }, nav);
    expect(ancestor[0].transform).toBe('translateX(-6px)');
    await settled(page);

    // The breadcrumb: only the crumb that is new fades in (with its dot).
    const crumbs = await page.evaluate(async (p) => {
      await loadDirectory(p);
      return [...document.querySelectorAll('#breadcrumb > *')].filter((el) => el.getAnimations().length)
        .map((el) => (el.dataset.path ? el.dataset.path.split('\\').filter(Boolean).pop() : el.className));
    }, inner);
    expect(crumbs).toEqual(['fp-breadcrumb__sep', 'Inner']);

    // A tab switch from its cached listing: the fade only.
    const firstTab = await page.evaluate(() => tabs.activeId);
    await page.locator('#btn-new-tab').click();
    await openFolder(page, deepest);
    await settled(page);
    const sw = await page.evaluate((id) => { activateTab(id); return { anims: __fpListAnims(), rows: __fpRowPaths().length }; }, firstTab);
    expect(sw.anims).toEqual([{ duration: 140, opacity: '0.6', transform: null }]);
    expect(sw.rows).toBeGreaterThan(0);
    await page.waitForFunction(() => !window.__fpLoadPending);
    await settled(page);

    // Refreshing the folder on screen moves nothing.
    expect(await page.evaluate(async () => { await refreshDirectory(); return __fpListAnims().length; })).toBe(0);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('icons are settled in the first frame of a navigation with motion on; rows are never hidden under the fade', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const root = (await apiGet('/fs/list/root')).path;
    const docsDir = `${root}\\_gen\\Documents`;
    const picsDir = `${root}\\_gen\\Pictures`;
    await page.evaluate(() => switchScreen('settings'));
    await page.locator('[data-action="settings-set-icon-source"][data-val="windows"]').click();
    expect(await page.evaluate(() => fpIconSource())).toBe('windows');
    const idle = () => page.waitForFunction(() => {
      const list = document.getElementById('list-scroll');
      return !!list.querySelector('.fp-row') && __fpLoadPending === 0 && window.__fpIconsIdle()
        && window.__fpSampleListing().every((r) => r.settled);
    }, null, { timeout: 10000 });
    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await idle();
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await idle();
    const revisit = await page.evaluate(async (p) => {
      await openBrowserAt(p);
      const same = window.__fpSampleListing();
      const anims = __fpListAnims();
      const frame = await new Promise((r) => requestAnimationFrame(() => r(window.__fpSampleListing())));
      return { same, frame, anims };
    }, docsDir);
    expect(revisit.anims).toHaveLength(1);
    expect(revisit.anims[0].opacity).toBe('0.6');
    expect(revisit.same.length).toBeGreaterThan(5);
    expect(revisit.same.every((r) => r.settled && r.opacity === '1')).toBe(true);
    expect(revisit.frame.every((r) => r.settled && r.opacity === '1')).toBe(true);
  } finally {
    await app.close();
    await delConfig('ui.icon_source');
  }
  expect(errors).toEqual([]);
});

test('views and sort: a View-menu change crossfades, wheel steps never animate; a sort slides <= 30 rows and crossfades above that', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const mo = await motionDir();
    await openFolder(page, `${mo}\\Sort`);
    await page.evaluate(() => { setView('details', null, { manual: false }); applySort('name', 'asc'); });
    await settled(page);

    // The View menu: one crossfade of the whole listing, nothing per row.
    const menu = await page.evaluate(() => {
      const n0 = window.__fpRenderCount;
      applyViewChoice('tiles');
      return { view: browserState.view, renders: window.__fpRenderCount - n0, list: __fpListAnims(), rows: __fpRowAnims() };
    });
    expect(menu).toEqual({ view: 'tiles', renders: 1, list: [{ duration: 140, opacity: '0.5', transform: null }], rows: [] });
    await settled(page);
    // A Ctrl+wheel step is continuous input: no animation at all, even
    // across a change of view kind.
    const wheel = await page.evaluate(() => {
      const list = document.getElementById('list-scroll');
      const fire = (dy) => list.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, bubbles: true, cancelable: true }));
      fire(-100);
      const a = { view: browserState.view, n: list.getAnimations({ subtree: true }).length };
      fire(-100);
      const b = { view: `${browserState.view}@${browserState.iconSize}`, n: list.getAnimations({ subtree: true }).length };
      return [a, b];
    });
    expect(wheel[0].view).not.toBe('tiles');
    expect(wheel.map((w) => w.n)).toEqual([0, 0]);
    await page.evaluate(() => applyViewChoice('details'));
    await settled(page);

    // A sort with few rows on screen: the DOM order is final at once and the
    // rows slide (transform only) to their new places.
    const sort = await page.evaluate(() => {
      const before = __fpRowPaths();
      applySort('size', 'asc');
      return { before, after: __fpRowPaths(), rows: __fpRowAnims(), list: __fpListAnims() };
    });
    expect(sort.after).toEqual([...sort.before].reverse());
    expect(sort.list).toEqual([]);
    expect(sort.rows.length).toBeGreaterThanOrEqual(6);
    for (const r of sort.rows) {
      expect(r.kind).toBe('Animation');
      expect(r.self).toBe(true);
      expect(r.duration).toBe(140);
      expect(r.transform).toMatch(/^translate\(/);
    }
    await settled(page);

    // Many rows on screen (Small icons in Bulk): a crossfade, nothing per row.
    const root = (await apiGet('/fs/list/root')).path;
    await openFolder(page, `${root}\\Bulk`);
    await page.evaluate(() => setView('small', null, { manual: false }));
    await settled(page);
    const big = await page.evaluate(() => {
      const visible = listRowsInView(document.getElementById('list-scroll')).size;
      applySort('name', 'desc');
      return { visible, list: __fpListAnims(), rows: __fpRowAnims() };
    });
    expect(big.visible).toBeGreaterThan(30);
    expect(big.list).toEqual([{ duration: 140, opacity: '0.5', transform: null }]);
    expect(big.rows).toEqual([]);
    await page.evaluate(() => applySort('name', 'asc'));
  } finally {
    await app.close();
    await delConfig('ui.sort');
    await delConfig('ui.folder_views');
  }
  expect(errors).toEqual([]);
});

test('rows: a selection fill fades; Ctrl+A over 30 rows, a marquee drag and a held arrow start no per-row animation', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const mo = await motionDir();
    await openFolder(page, `${mo}\\Many`);
    await page.evaluate(() => setView('details', null, { manual: false }));
    await settled(page);

    // One click: that row's fill fades over --motion-instant.
    await page.locator('#list-scroll > .fp-row[data-path]').nth(2).click();
    const one = await page.evaluate(() => __fpRowAnims().filter((a) => a.kind === 'CSSTransition'));
    expect(one.length).toBeGreaterThan(0);
    for (const a of one) expect(a.duration).toBeLessThanOrEqual(100);
    await settled(page);

    // Ctrl+A over 45 rows: every row is selected at once, none transitions.
    const all = await page.evaluate(() => {
      selectAll();
      return { selected: browserState.selection.size, anims: __fpRowAnims().length };
    });
    expect(all).toEqual({ selected: 45, anims: 0 });
    await expect(page.locator('#list-scroll.fp-list-still')).toHaveCount(0);
    await page.waitForFunction(() => !window.__fpInspectorPending);
    // Back to one row: 44 fills change at once, so none transitions either...
    await page.locator('#list-scroll > .fp-row[data-path]').nth(4).click();
    expect(await page.evaluate(() => __fpRowAnims().length)).toBe(0);
    await expect(page.locator('#list-scroll.fp-list-still')).toHaveCount(0);
    // ...and the next single change fades again.
    await page.locator('#list-scroll > .fp-row[data-path]').nth(6).click();
    expect(await page.evaluate(() => __fpRowAnims().length)).toBeGreaterThan(0);
    await settled(page);

    // A held arrow: every step lands, nothing animates.
    const held = await page.evaluate(() => {
      const press = (repeat) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat, bubbles: true, cancelable: true }));
      const f0 = browserState.focus;
      press(false);
      const firstStep = __fpRowAnims().length;
      for (let i = 0; i < 5; i++) press(true);
      const n = document.getElementById('list-scroll').getAnimations({ subtree: true }).length;
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      return { moved: f0 !== browserState.focus, firstStep, n };
    });
    expect(held.moved).toBe(true);
    expect(held.firstStep).toBeGreaterThan(0);
    expect(held.n).toBe(0);
    await settled(page);

    // A marquee drag across rows (Rows has blank space under its rows).
    await openFolder(page, `${mo}\\Rows`);
    await settled(page);
    const box = await page.locator('#list-scroll').boundingBox();
    const last = await page.locator('#list-scroll > .fp-row[data-path]').last().boundingBox();
    await page.mouse.move(box.x + box.width - 40, last.y + last.height + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 10, { steps: 4 });
    const during = await page.evaluate(() => ({
      marked: document.querySelectorAll('#list-scroll > .fp-row--selected').length,
      anims: __fpRowAnims().length,
    }));
    await page.mouse.up();
    expect(during.marked).toBeGreaterThan(3);
    expect(during.anims).toBe(0);
    await expect(page.locator('#list-scroll.fp-list-still')).toHaveCount(0);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('delete: the DOM and the selection change in the same task; the row leaves as an inert ghost, gone within 200 ms', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const rows = `${await motionDir()}\\Rows`;
    await openFolder(page, rows);
    await page.evaluate(() => setView('details', null, { manual: false }));
    await settled(page);

    const del = await page.evaluate(async (dir) => {
      selectRow(`${dir}\\row-03.txt`);
      await fileops.trashSelection();
      const t0 = performance.now();
      const list = document.getElementById('list-scroll');
      const ghosts = [...list.querySelectorAll('.fp-row--ghost')];
      const g = ghosts[0];
      const c = g ? __fpCenter(g) : null;
      const hit = c ? document.elementFromPoint(c.x, c.y) : null;
      const out = {
        paths: __fpRowPaths(),
        selected: [...browserState.selection].map((s) => s.split('\\').pop()),
        ghosts: ghosts.length,
        ghost: g ? {
          path: g.getAttribute('data-path'), role: g.getAttribute('role'), hidden: g.getAttribute('aria-hidden'),
          inert: g.inert, pe: getComputedStyle(g).pointerEvents, position: getComputedStyle(g).position,
          hitGhost: !!hit && (hit === g || g.contains(hit)),
          anims: g.getAnimations().map((a) => a.effect.getComputedTiming().duration),
          text: g.textContent.includes('row-03.txt'),
        } : null,
      };
      // When does the ghost go?
      out.goneAfter = await new Promise((resolve) => {
        if (!g || !g.isConnected) { resolve(0); return; }
        new MutationObserver((_, mo) => { if (!g.isConnected) { mo.disconnect(); resolve(performance.now() - t0); } })
          .observe(list, { childList: true });
      });
      return out;
    }, rows);
    expect(del.paths).not.toContain('row-03.txt');
    expect(del.paths).toHaveLength(9);
    expect(del.selected).toEqual(['row-04.txt']);
    expect(del.ghosts).toBe(1);
    expect(del.ghost).toMatchObject({ path: null, role: null, hidden: 'true', inert: true, pe: 'none', position: 'absolute', hitGhost: false, text: true });
    expect(del.ghost.anims).toEqual([100]);
    expect(del.goneAfter).toBeLessThanOrEqual(200);
    await settled(page);

    // Keys act at once after a delete, and a ghost is never a row to them.
    const keys = await page.evaluate(async (dir) => {
      selectRow(`${dir}\\row-05.txt`);
      await fileops.trashSelection();
      const ghost = !!document.querySelector('#list-scroll .fp-row--ghost');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
      const focus = browserState.focus.split('\\').pop();
      // A refresh while the ghost plays patches the real rows only.
      await refreshDirectory();
      return { ghost, focus, rows: __fpRowPaths().length, entries: browserState.entries.length };
    }, rows);
    expect(keys).toEqual({ ghost: true, focus: 'row-07.txt', rows: 8, entries: 8 });
    await expect(page.locator('#list-scroll .fp-row--ghost')).toHaveCount(0);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('new items fade and grow in, the rename box fades in, a renamed row slides to its place; cut fades and the copy badge pops', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const mo = await motionDir();
    const rows = `${mo}\\Rows`;
    await openFolder(page, rows);
    await page.evaluate(() => setView('details', null, { manual: false }));
    await settled(page);

    // New folder: the row grows in, the rename box fades in and has focus.
    const made = await page.evaluate(async (dir) => {
      await fileops.newFolder(dir);
      const input = document.querySelector('#list-scroll .fp-row__rename');
      return {
        row: __fpRowAnims().filter((a) => a.row === 'New folder' && a.self && a.kind === 'Animation'),
        focused: !!input && document.activeElement === input,
        input: input ? input.getAnimations().filter((a) => a.constructor.name === 'Animation')
          .map((a) => ({ d: a.effect.getComputedTiming().duration, o: a.effect.getKeyframes()[0].opacity })) : null,
      };
    }, rows);
    expect(made.focused).toBe(true);
    expect(made.input).toEqual([{ d: 100, o: '0' }]);
    expect(made.row).toHaveLength(1);
    expect(made.row[0]).toMatchObject({ duration: 140, opacity: '0', transform: 'scale(0.96)' });
    await page.keyboard.press('Escape');
    await settled(page);

    // Rename: the row slides from its old place, no ghost of the old name.
    const ren = await page.evaluate(async (dir) => {
      await fileops.rename(`${dir}\\row-01.txt`, 'zz-renamed.txt');
      return {
        paths: __fpRowPaths(),
        ghosts: document.querySelectorAll('#list-scroll .fp-row--ghost').length,
        anims: __fpRowAnims().filter((a) => a.row === 'zz-renamed.txt' && a.self && a.kind === 'Animation'),
      };
    }, rows);
    expect(ren.paths[ren.paths.length - 1]).toBe('zz-renamed.txt');
    expect(ren.ghosts).toBe(0);
    expect(ren.anims).toHaveLength(1);
    expect(ren.anims[0].transform).toMatch(/^translate\(0px, -\d/);
    await settled(page);

    // Paste: the pasted row grows in and is selected at once.
    const pasted = await page.evaluate(async ({ dir, src }) => {
      fileops.setClipboard('copy', [src]);
      await fileops.pasteInto(dir);
      return {
        selected: [...browserState.selection].map((s) => s.split('\\').pop()),
        anims: __fpRowAnims().filter((a) => a.row === 'pasted.txt' && a.self && a.kind === 'Animation').map((a) => a.transform),
      };
    }, { dir: rows, src: `${mo}\\Src\\pasted.txt` });
    expect(pasted).toEqual({ selected: ['pasted.txt'], anims: ['scale(0.96)'] });
    await settled(page);

    // Cut: icon and name fade to the cut ghosting; copy: the badge pops in.
    const clip = await page.evaluate((dir) => {
      fileops.setClipboard('cut', [`${dir}\\row-02.txt`]);
      const cut = __fpRowAnims().filter((a) => a.row === 'row-02.txt');
      fileops.setClipboard('copy', [`${dir}\\row-04.txt`]);
      const copy = __fpRowAnims().filter((a) => a.row === 'row-04.txt');
      const uncut = __fpRowAnims().filter((a) => a.row === 'row-02.txt');
      fileops.setClipboard(null, []);
      return { cut, copy, uncut };
    }, rows);
    expect(clip.cut).toHaveLength(2);
    for (const a of clip.cut) expect(a).toMatchObject({ duration: 100, opacity: '1', self: false });
    expect(clip.copy).toEqual([expect.objectContaining({ pseudo: '::after', duration: 100, transform: 'scale(0.9)', self: true })]);
    expect(clip.uncut).toHaveLength(2);
    for (const a of clip.uncut) expect(a.opacity).toBe('0.5');
    await settled(page);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('over 30 rows changing at once animate nothing per row; nor does a 5,000-row listing, which still navigates and changes view within the Stage 2D bounds', async () => {
  test.setTimeout(240_000);
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const mo = await motionDir();
    await openFolder(page, `${mo}\\Many`);
    await settled(page);
    // 45 rows go to the trash at once: no ghost, nothing per row.
    const many = await page.evaluate(async () => {
      selectAll();
      await fileops.trashSelection();
      return { rows: __fpRowPaths().length, ghosts: document.querySelectorAll('#list-scroll .fp-row--ghost').length, anims: __fpRowAnims().length };
    });
    expect(many).toEqual({ rows: 0, ghosts: 0, anims: 0 });
    // ...and come back the same way.
    const back = await page.evaluate(async () => {
      await fileops.undoLast();
      return { rows: __fpRowPaths().length, anims: __fpRowAnims().length };
    });
    expect(back).toEqual({ rows: 45, anims: 0 });
    await settled(page);

    // 5,000 rows, through the real commit path: one render, the whole list
    // fades (no slide), nothing per row, html.fp-heavy-list on.
    const target = `${mo}\\Nav\\Inner`;
    const big = await page.evaluate((p) => {
      const now = Date.now() / 1000;
      const entries = Array.from({ length: 5000 }, (_, i) => ({
        name: `generated-entry-${String(i).padStart(4, '0')}.txt`, ext: '.txt', is_dir: false,
        is_hidden: false, size: 1000 + i, modified: now - i * 60, created: now - i * 60, accessed: now,
      }));
      const n0 = window.__fpRenderCount;
      const t0 = performance.now();
      commitListing({ path: p, entries, parent: null, is_root: false, truncated: false }, { absPath: p });
      document.body.offsetHeight;
      const nav = performance.now() - t0;
      const out = { renders: window.__fpRenderCount - n0, nav, list: __fpListAnims(), rows: __fpRowAnims().length,
        heavy: document.documentElement.classList.contains('fp-heavy-list') };
      // A view change from the View menu: a crossfade, under the 1 s bound.
      const t1 = performance.now();
      applyViewChoice('small');
      document.body.offsetHeight;
      out.view = performance.now() - t1;
      out.viewAnims = { list: __fpListAnims().length, rows: __fpRowAnims().length };
      // A sort: a crossfade, never 5,000 slides.
      applySort('size', 'desc');
      out.sortAnims = { list: __fpListAnims().length, rows: __fpRowAnims().length };
      applySort('name', 'asc');
      // A patch that removes and adds a row: no ghost, nothing per row.
      patchDirectory([{ ...entries[0], name: 'zz-new.txt' }, ...entries.slice(2)]);
      out.patch = { ghosts: document.querySelectorAll('#list-scroll .fp-row--ghost').length, rows: __fpRowAnims().length };
      // Every one of 5,000 rows selected at once (Ctrl+A's own repaint,
      // without the inspector asking the backend about rows that are not on
      // disk): no transitions.
      browserState.selection = new Set(sortedEntries().map(entryPath));
      applySelectionState();
      out.selectAll = __fpRowAnims().length;
      browserState.selection = new Set();
      applySelectionState();
      return out;
    }, target);
    console.log(`5,000 rows with motion on (ms): nav ${Math.round(big.nav)}, view ${Math.round(big.view)}`);
    expect(big.renders).toBe(1);
    expect(big.heavy).toBe(true);
    expect(big.list).toEqual([{ duration: 140, opacity: '0.6', transform: null }]);
    expect(big.rows).toBe(0);
    expect(big.nav).toBeLessThan(1000);
    expect(big.view).toBeLessThan(1000);
    expect(big.viewAnims).toEqual({ list: 1, rows: 0 });
    expect(big.sortAnims).toEqual({ list: 1, rows: 0 });
    expect(big.patch).toEqual({ ghosts: 0, rows: 0 });
    expect(big.selectAll).toBe(0);
  } finally {
    await app.close();
    await delConfig('ui.sort');
    await delConfig('ui.folder_views');
  }
  expect(errors).toEqual([]);
});

test('with the switch off, navigation, sort, view, delete, paste, cut and rename play nothing and leave no ghost', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await installListProbes(page);
    const mo = await motionDir();
    await openFolder(page, `${mo}\\Nav`);
    const seen = await page.evaluate(async (m) => {
      const out = [];
      const look = () => out.push(document.getAnimations().length + document.querySelectorAll('.fp-row--ghost').length);
      await loadDirectory(`${m}\\Nav\\Inner`); look();
      await navBack(); look();
      applySort('size', 'desc'); look();
      applySort('name', 'asc'); look();
      applyViewChoice('tiles'); look();
      applyViewChoice('details'); look();
      await loadDirectory(`${m}\\Rows`); look();
      selectRow(`${m}\\Rows\\row-08.txt`);
      await fileops.trashSelection(); look();
      fileops.setClipboard('copy', [`${m}\\Src\\pasted-off.txt`]); look();
      await fileops.pasteInto(`${m}\\Rows`); look();
      fileops.setClipboard('cut', [`${m}\\Rows\\row-09.txt`]); look();
      fileops.setClipboard(null, []);
      await fileops.rename(`${m}\\Rows\\row-10.txt`, 'aa-row-10.txt'); look();
      selectAll(); look();
      return out;
    }, mo);
    expect(seen).toEqual(new Array(seen.length).fill(0));
  } finally {
    await app.close();
    await delConfig('ui.sort');
    await delConfig('ui.folder_views');
  }
  expect(errors).toEqual([]);
});

// ── Content motion, part 2 (addendum §5.2: Search, This PC, Home, Drag and
// drop — Task 7) ─────────────────────────────────────────────────────────

/** First keyframe and timing of each script animation on `el` (CSS
 * transitions and animations left out). */
async function installAnimProbe(page) {
  await page.evaluate(() => {
    window.__fpScripted = (el) => (el ? el.getAnimations() : []).filter((a) => a.constructor.name === 'Animation').map((a) => {
      const k = a.effect.getKeyframes()[0] || {};
      const t = a.effect.getComputedTiming();
      return { duration: t.duration, delay: t.delay, fill: t.fill, opacity: k.opacity ?? null, transform: k.transform ?? null };
    });
  });
}

test('search: the results header slides in and a new result set fades in, a re-run does not; chips pop in and out as inert ghosts', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    await installAnimProbe(page);
    const rows = `${await motionDir()}\\Rows`;
    await page.evaluate(() => setInspectorOpen(false, { persist: false }));
    await openFolder(page, rows);
    await settled(page);

    const s = await page.evaluate(async (root) => {
      showSearchPending('row', root);
      const header = __fpScripted(document.getElementById('list-search-header'));
      const payload = await API.get('/fs/search', { q: 'row', root, limit: 50 });
      renderSearchResults(payload, { query: 'row', root });
      const list = __fpListAnims();
      const results = __fpRowPaths().length;
      fpCancelAnimation(document.getElementById('list-scroll'), 'list');
      renderSearchResults(payload, { query: 'row', root, preserveSelection: true });
      return { header, list, results, rerun: __fpListAnims().length };
    }, rows);
    expect(s.header).toEqual([{ duration: 140, delay: 0, fill: 'none', opacity: '0', transform: 'translateY(-4px)' }]);
    expect(s.list).toEqual([{ duration: 140, opacity: '0.6', transform: null }]);
    expect(s.results).toBeGreaterThan(3);
    expect(s.rerun).toBe(0);
    await page.evaluate(() => exitSearchResults());
    await page.waitForFunction(() => !window.__fpLoadPending && browserState.mode !== 'search');
    await settled(page);

    // Chips: one pops in; taken away, it plays out as a ghost outside
    // #search-chips that nothing can hit, and is gone within --motion-fast.
    await page.evaluate(() => focusSearchInput());
    await settled(page);
    const c = await page.evaluate(() => {
      searchState.chips = [{ key: 'tag', value: 'work', label: 'work' }];
      renderSearchChips();
      const chip = document.querySelector('#search-chips .fp-search-chip');
      const popIn = __fpScripted(chip);
      const hitChip = __fpHitIs(chip);
      searchState.chips = [];
      renderSearchChips();
      const ghost = document.querySelector('#search-wrap .fp-search-chip--ghost');
      const at = ghost ? __fpCenter(ghost) : null;
      const hit = at ? document.elementFromPoint(at.x, at.y) : null;
      return {
        popIn, hitChip,
        chipsLeft: document.querySelectorAll('#search-chips > *').length,
        ghost: ghost ? {
          inChips: !!ghost.closest('#search-chips'), inert: ghost.inert, hidden: ghost.getAttribute('aria-hidden'),
          action: ghost.getAttribute('data-action'), pe: getComputedStyle(ghost).pointerEvents,
          hitGhost: !!hit && (hit === ghost || ghost.contains(hit)), out: __fpScripted(ghost),
        } : null,
      };
    });
    expect(c.popIn).toEqual([{ duration: 100, delay: 0, fill: 'none', opacity: '0', transform: 'scale(0.9)' }]);
    expect(c.hitChip).toBe(true);
    expect(c.chipsLeft).toBe(0);
    expect(c.ghost).toEqual({ inChips: false, inert: true, hidden: 'true', action: null, pe: 'none', hitGhost: false,
      out: [{ duration: 100, delay: 0, fill: 'none', opacity: '1', transform: 'none' }] });
    await expect(page.locator('.fp-search-chip--ghost')).toHaveCount(0);
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('This PC: cards fade up with a capped 20 ms stagger and usage bars fill from 0; a refresh never replays it, a tab switch only fades', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    await installAnimProbe(page);
    await page.waitForFunction(() => Array.isArray(window.__fpDrives) && window.__fpDrives.length > 0);
    const r = await page.evaluate(async () => {
      const done = loadDirectory(THISPC);
      const cards = thisPcCards();
      const out = {
        n: cards.length,
        cards: cards.map((c) => __fpScripted(c)),
        bars: cards.map((c) => __fpScripted(c.querySelector('.fp-drive-card__bar-fill'))),
        hit: __fpHitIs(cards[0]),
      };
      selectThisPcCard(cards[cards.length - 1].dataset.path);
      out.selected = thisPcState.selected === cards[cards.length - 1].dataset.path;
      await done;
      return out;
    });
    expect(r.n).toBeGreaterThan(0);
    r.cards.forEach((a, i) => {
      expect(a).toEqual([{ duration: 140, delay: Math.min(i * 20, 60), fill: 'backwards', opacity: '0', transform: 'translateY(4px)' }]);
    });
    for (const b of r.bars) expect(b).toEqual([{ duration: 200, delay: 0, fill: 'none', opacity: null, transform: 'scaleX(0)' }]);
    expect(r.hit).toBe(true);
    expect(r.selected).toBe(true);
    await settled(page);

    // A refresh patches the cards in place: nothing plays again.
    expect(await page.evaluate(async () => { await refreshThisPc(); return document.getElementById('thispc-view').getAnimations({ subtree: true }).length; })).toBe(0);

    // Back to a This PC tab from another one: the page only fades.
    const pcTab = await page.evaluate(() => tabs.activeId);
    await page.locator('#btn-new-tab').click();
    await settled(page);
    const sw = await page.evaluate((id) => {
      activateTab(id);
      const grid = document.getElementById('thispc-drives');
      return { grid: __fpScripted(grid), cards: thisPcCards().reduce((n, c) => n + c.getAnimations({ subtree: true }).length, 0) };
    }, pcTab);
    expect(sw.grid).toEqual([{ duration: 140, delay: 0, fill: 'none', opacity: '0.6', transform: null }]);
    expect(sw.cards).toBe(0);
    await page.waitForFunction(() => !window.__fpLoadPending);
    await settled(page);

    // The View menu's layout change crossfades the page.
    const view = await page.evaluate(() => { applyViewChoice('details'); return __fpScripted(document.getElementById('thispc-drives')); });
    expect(view).toEqual([{ duration: 140, delay: 0, fill: 'none', opacity: '0.5', transform: null }]);
  } finally {
    await app.close();
    await delConfig('ui.thispc_view');
  }
  expect(errors).toEqual([]);
});

test('Home: new rows fade in and the same rows again do not; the sub-tab pane fades while its underline slides; favouriting pops the star', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  const rows = `${await motionDir()}\\Rows`;
  const favA = `${rows}\\row-02.txt`;
  const favB = `${rows}\\row-04.txt`;
  const addFav = (p) => fetch(`${API}/favorites`, {
    method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ path: p }),
  });
  const delFav = (p) => fetch(`${API}/favorites?path=${encodeURIComponent(p)}`, { method: 'DELETE', headers: apiHeaders() });
  try {
    await installMotionProbes(page);
    await installAnimProbe(page);
    await openFolder(page, rows);
    await settled(page);

    // Favouriting a row on screen pops its star in.
    await addFav(favA);
    const star = await page.evaluate(async (p) => {
      await loadFavorites();
      return __fpScripted(findRowByPath(p).querySelector('.fp-row__star'));
    }, favA);
    expect(star).toEqual([{ duration: 100, delay: 0, fill: 'none', opacity: '0', transform: 'scale(0.9)' }]);

    // Home › Favorites: the pane fades in and the underline slides to it.
    await page.evaluate(() => switchScreen('home'));
    await settled(page);
    await page.locator('#home-tabs [data-tab="favorites"]').click();
    const tab = await page.evaluate(() => ({
      pane: __fpScripted(document.querySelector('#screen-home .home-pane[data-pane="favorites"]')),
      underline: document.querySelector('#home-tabs .fp-tabs__indicator').getAnimations()
        .map((a) => [a.transitionProperty, a.effect.getComputedTiming().duration]).sort(),
    }));
    expect(tab.pane).toEqual([{ duration: 100, delay: 0, fill: 'none', opacity: '0', transform: null }]);
    expect(tab.underline).toEqual([['left', 140], ['width', 140]]);
    await settled(page);

    // A new favourite's row fades in; the row already there does not, and
    // painting the same rows again plays nothing.
    await addFav(favB);
    const fresh = await page.evaluate(async ({ a, b }) => {
      await loadFavorites();
      const row = (p) => document.querySelector(`#home-favorites .fp-row[data-path="${CSS.escape(p)}"]`);
      const out = { a: __fpScripted(row(a)), b: __fpScripted(row(b)), focusable: row(b).tabIndex >= -1 };
      for (const anim of document.getAnimations()) anim.finish();
      await loadFavorites();
      out.again = document.getElementById('home-favorites').getAnimations({ subtree: true }).length;
      return out;
    }, { a: favA, b: favB });
    expect(fresh.a).toEqual([]);
    expect(fresh.b).toEqual([{ duration: 140, delay: 0, fill: 'none', opacity: '0', transform: 'translateY(4px)' }]);
    expect(fresh.again).toBe(0);
    await page.locator('#home-tabs [data-tab="recent"]').click();
  } finally {
    await delFav(favA).catch(() => {});
    await delFav(favB).catch(() => {});
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('drag: the badge fades in once and then follows the pointer with no animation; a drop target highlight fades', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const nav = `${await motionDir()}\\Nav`;
    await openFolder(page, nav);
    await page.evaluate(() => setView('details', null, { manual: false }));
    await settled(page);
    await page.evaluate(() => {
      const badge = document.getElementById('drag-badge');
      const target = [...document.querySelectorAll('#list-scroll > .fp-row[data-path]')].find((r) => r.dataset.path.endsWith('\\Inner'));
      window.__fpBadgeSeen = [];
      window.__fpTargetSeen = [];
      new MutationObserver(() => {
        if (!badge.hidden) window.__fpBadgeSeen.push(badge.getAnimations().map((a) => [a.effect.getComputedTiming().duration, a.effect.getKeyframes()[0].opacity]));
      }).observe(badge, { attributes: true, attributeFilter: ['hidden', 'style'] });
      new MutationObserver(() => {
        if (target.classList.contains('fp-row--drag-target')) {
          window.__fpTargetSeen.push(target.getAnimations().map((a) => [a.transitionProperty || 'script', a.effect.getComputedTiming().duration]));
        }
      }).observe(target, { attributes: true, attributeFilter: ['class'] });
    });
    const src = await rowByName(page, 'nav-1.txt').boundingBox();
    const dst = await rowByName(page, 'Inner').boundingBox();
    await page.mouse.move(src.x + 40, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(src.x + 60, src.y + src.height / 2 + 12, { steps: 3 });
    await page.mouse.move(dst.x + 50, dst.y + dst.height / 2, { steps: 4 });
    const seen = await page.evaluate(() => ({ badge: window.__fpBadgeSeen, target: window.__fpTargetSeen }));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(seen.badge.length).toBeGreaterThan(2);
    expect(seen.badge[0]).toEqual([[100, '0']]);
    // One fade for the whole drag: never more than that one animation.
    for (const s of seen.badge) expect(s.length).toBeLessThanOrEqual(1);
    expect(seen.target.length).toBeGreaterThan(0);
    const props = Object.fromEntries(seen.target[0]);
    expect(props['background-color']).toBeLessThanOrEqual(60);
    expect(props['box-shadow']).toBeLessThanOrEqual(60);
    // Cancelled: nothing moved.
    await expect(rowByName(page, 'nav-1.txt')).toHaveCount(1);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('with the switch off, search chips, This PC, Home and a drag play nothing and leave no ghost', async () => {
  const { app, page, errors } = await launchApp();
  try {
    await page.waitForFunction(() => Array.isArray(window.__fpDrives) && window.__fpDrives.length > 0);
    const seen = await page.evaluate(async () => {
      const out = [];
      const look = () => out.push(document.getAnimations().length + document.querySelectorAll('.fp-search-chip--ghost, .fp-row--ghost').length);
      await loadDirectory(THISPC); look();
      await refreshThisPc(); look();
      focusSearchInput();
      searchState.chips = [{ key: 'tag', value: 'work', label: 'work' }];
      renderSearchChips(); look();
      searchState.chips = [];
      renderSearchChips(); look();
      switchScreen('home'); look();
      document.querySelector('#home-tabs [data-tab="favorites"]').click(); look();
      await loadFavorites(); look();
      document.querySelector('#home-tabs [data-tab="recent"]').click(); look();
      return out;
    });
    expect(seen).toEqual(new Array(seen.length).fill(0));
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('breadcrumb: the overflow fade grows in when the path starts to overflow (and is simply there with motion off)', async () => {
  for (const motion of [true, false]) {
    const { app, page, errors } = await launchApp({ motion });
    try {
      const root = (await apiGet('/fs/list/root')).path;
      const deep = ['Client-Projects', 'Northwind-Archive', 'Quarterly-Reports', 'Finance-Review',
        'Year-End-Closing', 'Supporting-Files', 'Scanned-Receipts', 'Final-Approved'].reduce((p, n) => `${p}\\${n}`, `${root}\\Deep`);
      // From This PC (one short crumb): the path is not overflowing.
      await openFolder(page, 'thispc:');
      await expect.poll(() => page.evaluate(() => document.querySelector('.fp-breadcrumb-wrap').classList.contains('is-overflowing'))).toBe(false);
      await page.evaluate(() => {
        const wrap = document.querySelector('.fp-breadcrumb-wrap');
        window.__fpCrumbSeen = null;
        new MutationObserver((_, mo) => {
          if (!wrap.classList.contains('is-overflowing')) return;
          mo.disconnect();
          window.__fpCrumbSeen = {
            anims: wrap.getAnimations().map((a) => [a.animationName, a.effect.getComputedTiming().duration]),
            fade: getComputedStyle(wrap).getPropertyValue('--crumb-fade').trim(),
          };
        }).observe(wrap, { attributes: true, attributeFilter: ['class'] });
        return wrap.classList.contains('is-overflowing');
      });
      await openFolder(page, deep);
      await expect.poll(() => page.evaluate(() => window.__fpCrumbSeen)).not.toBeNull();
      const r = await page.evaluate(() => window.__fpCrumbSeen);
      expect(r.anims).toEqual(motion ? [['fp-crumb-fade-in', 100]] : []);
      if (!motion) expect(r.fade).toBe('24px');
    } finally {
      await app.close();
    }
    expect(errors).toEqual([]);
  }
});

test('a key pressed while rows slide acts on where they land: a geometric arrow right after a sort', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const sortDir = `${await motionDir()}\\Sort`;
    await openFolder(page, sortDir);
    await page.evaluate((dir) => {
      setView('icons', 96, { manual: false });
      applySort('name', 'asc');
      selectRow(`${dir}\\sort-8.txt`);
    }, sortDir);
    await settled(page);
    const r = await page.evaluate(() => {
      applySort('size', 'asc');
      const sliding = __fpRowAnims().filter((a) => a.kind === 'Animation' && a.self).length;
      const order = __fpRowPaths();
      const from = order.indexOf(browserState.focus.split('\\').pop());
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
      const rows = [...document.querySelectorAll('#list-scroll > .fp-row[data-path]')];
      const top0 = rows[0].getBoundingClientRect().top;
      return {
        sliding,
        left: __fpRowAnims().filter((a) => a.kind === 'Animation' && a.self).length,
        from,
        to: order.indexOf(browserState.focus.split('\\').pop()),
        cols: rows.filter((row) => Math.abs(row.getBoundingClientRect().top - top0) < 1).length,
        n: rows.length,
      };
    });
    expect(r.sliding).toBeGreaterThan(0);
    expect(r.left).toBe(0);
    expect(r.from).toBe(0);
    expect(r.cols).toBeGreaterThan(1);
    expect(r.cols).toBeLessThan(r.n);
    expect(r.to).toBe(r.cols);
  } finally {
    await app.close();
    await delConfig('ui.sort');
    await delConfig('ui.folder_views');
  }
  expect(errors).toEqual([]);
});

test('delete at the bottom of a scrolled list: the scroll position settles in the same task, and nothing jumps when the ghost goes', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    const many = `${await motionDir()}\\Many`;
    await openFolder(page, many);
    await page.evaluate(() => setView('details', null, { manual: false }));
    await settled(page);
    const r = await page.evaluate(async (dir) => {
      const list = document.getElementById('list-scroll');
      list.scrollTop = list.scrollHeight;
      const before = list.scrollTop;
      const last = __fpRowPaths().pop();
      selectRow(`${dir}\\${last}`);
      await fileops.trashSelection();
      const ghost = list.querySelector('.fp-row--ghost');
      // The listing's real extent, without the ghost.
      const rows = [...list.querySelectorAll(':scope > .fp-row[data-path]')];
      const end = rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight
        + parseFloat(getComputedStyle(list).paddingBottom || 0);
      const max = Math.max(0, end - list.clientHeight);
      const now = list.scrollTop;
      const seen = [];
      await new Promise((resolve) => {
        const tick = () => {
          seen.push(list.scrollTop);
          if (!list.querySelector('.fp-row--ghost') && seen.length > 2) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { before, ghost: !!ghost, now, max, after: list.scrollTop, seen: [...new Set(seen)] };
    }, many);
    expect(r.before).toBeGreaterThan(100);
    expect(r.ghost).toBe(true);
    expect(Math.abs(r.now - r.max)).toBeLessThanOrEqual(1);
    expect(r.seen).toEqual([r.now]);
    expect(r.after).toBe(r.now);
    // Put the row back for any later test of this folder.
    await page.evaluate(() => fileops.undoLast());
    await page.waitForFunction(() => !window.__fpLoadPending && browserState.entries.length === 45);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('an item trashed while the inspector is still reading about it: no 404, no console error, the panel says it is gone', async () => {
  const { app, page, errors } = await launchApp();
  const held = [];
  const hold = (route) => { held.push(route); };
  try {
    const rows = `${await motionDir()}\\Rows`;
    await openFolder(page, rows);
    await page.waitForFunction(() => !window.__fpInspectorPending);
    await page.route('**/file?**', hold);
    await page.route('**/preview?**', hold);

    // 1. Through the app: select, and trash while GET /file is still out.
    await page.evaluate((p) => selectRow(p), `${rows}\\row-06.txt`);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await page.evaluate(() => fileops.trashSelection());
    expect(await page.evaluate(() => getSelectedPaths().map((p) => p.split('\\').pop()))).not.toContain('row-06.txt');

    // 2. Gone behind the app's back (another program): the held read is let
    // through after the file is gone and answers exists:false — 200, not 404.
    const before = held.length;
    await page.evaluate((p) => selectRow(p), `${rows}\\row-07.txt`);
    await expect.poll(() => held.length).toBeGreaterThan(before);
    const r = await fetch(`${API}/fs/trash`, {
      method: 'POST', headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ paths: [`${rows}\\row-07.txt`] }),
    });
    expect(r.ok).toBe(true);
    await page.unroute('**/file?**', hold);
    await page.unroute('**/preview?**', hold);
    for (const route of held) await route.continue().catch(() => {});
    await expect(page.locator('#inspector-kind')).toHaveText('Moved or deleted');
    await page.waitForFunction(() => !window.__fpInspectorPending);
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});

test('the view anchor is read from where rows land: a scroll anchor taken mid-slide ends the slide first', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installListProbes(page);
    await openFolder(page, `${await motionDir()}\\Sort`);
    await page.evaluate(() => { setView('icons', 96, { manual: false }); applySort('name', 'asc'); });
    await settled(page);
    const r = await page.evaluate(() => {
      const sliding = () => __fpRowAnims().filter((a) => a.kind === 'Animation' && a.self).length;
      const list = document.getElementById('list-scroll');
      applySort('size', 'asc');
      const a0 = sliding();
      captureScrollAnchor(list, null);
      const a1 = sliding();
      applySort('size', 'desc');
      const b0 = sliding();
      firstVisibleRow(list);
      return [a0, a1, b0, sliding()];
    });
    expect(r[0]).toBeGreaterThan(0);
    expect(r[1]).toBe(0);
    expect(r[2]).toBeGreaterThan(0);
    expect(r[3]).toBe(0);
  } finally {
    await app.close();
    await delConfig('ui.sort');
    await delConfig('ui.folder_views');
  }
  expect(errors).toEqual([]);
});

test('icons arriving in one task: a few fade in, more than 30 land with no fade; none fades under fp-heavy-list', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    const r = await page.evaluate(async () => {
      const make = (n) => Array.from({ length: n }, () => {
        const img = document.createElement('img');
        img.className = 'fp-icon fp-icon--win';
        document.body.appendChild(img);
        return img;
      });
      const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
      const faded = (els) => els.filter((e) => e.classList.contains('fp-icon--fade-in')).length;
      const few = make(3);
      few.forEach((e) => _fpFadeIconIn(e));
      await nextTask();
      const many = make(31);
      many.forEach((e) => _fpFadeIconIn(e));
      await nextTask();
      const out = { few: faded(few), many: faded(many), normal: getComputedStyle(few[0]).animationName };
      document.documentElement.classList.add('fp-heavy-list');
      out.heavy = getComputedStyle(few[0]).animationName;
      document.documentElement.classList.remove('fp-heavy-list');
      [...few, ...many].forEach((e) => e.remove());
      return out;
    });
    expect(r).toEqual({ few: 3, many: 0, normal: 'fp-icon-in', heavy: 'none' });
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
