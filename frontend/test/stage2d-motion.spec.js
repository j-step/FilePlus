// frontend/test/stage2d-motion.spec.js
// Stage 2D addendum §5.1 / §5.3 (Task 1): one motion gate. Settings ›
// Personalization › "Animations" (ui.animations, default on) is the ONLY
// switch (decision A-2: prefers-reduced-motion gates nothing). Off sets
// html[data-motion="off"], which zeroes every CSS transition and animation
// and makes every JS-driven animation (fpAnimate, the zoom ease, the spring
// pulse wait) instant. The harness launches with animations off unless a
// test asks for launchApp({ motion: true }).
const { test, expect } = require('@playwright/test');
const { launchApp, apiGet, API, apiHeaders } = require('./harness/app');

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

test('screens crossfade: the new screen is live at once, the old one fades out inert, and a quick switch back is clean', async () => {
  const { app, page, errors } = await launchApp({ motion: true });
  try {
    await installMotionProbes(page);
    const r = await page.evaluate(() => {
      const home = document.getElementById('screen-home');
      const settings = document.getElementById('screen-settings');
      switchScreen('settings');
      const nav = settings.querySelector('.settings-nav__item');
      return {
        active: settings.classList.contains('active'), navHit: window.__fpHitIs(nav),
        leaving: home.classList.contains('screen--leaving'), homeInert: home.inert,
        homePe: getComputedStyle(home).pointerEvents,
        inAnims: window.__fpAnims(settings), outAnims: window.__fpAnims(home),
      };
    });
    expect(r).toMatchObject({ active: true, navHit: true, leaving: true, homeInert: true, homePe: 'none' });
    expect(r.inAnims.length).toBe(1);
    expect(r.outAnims.length).toBe(1);
    for (const a of [...r.inAnims, ...r.outAnims]) expect(a.duration).toBeLessThanOrEqual(100);
    await settled(page, '#screens');
    expect(await page.evaluate(() => {
      const home = document.getElementById('screen-home');
      return [home.classList.contains('screen--leaving'), home.inert, getComputedStyle(home).display];
    })).toEqual([false, false, 'none']);

    // Back and forth in one task: Home is the live screen, never inert.
    const q = await page.evaluate(() => {
      switchScreen('home');
      switchScreen('settings');
      switchScreen('home');
      const home = document.getElementById('screen-home');
      return { active: home.classList.contains('active'), inert: home.inert,
        leaving: home.classList.contains('screen--leaving'),
        shown: document.querySelectorAll('.screen.active').length };
    });
    expect(q).toEqual({ active: true, inert: false, leaving: false, shown: 1 });
    await settled(page, '#screens');
    expect(await page.locator('.screen--leaving').count()).toBe(0);
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
        resizer: getComputedStyle(document.getElementById('resizer')).display, anims: window.__fpAnims(ins) };
    });
    expect(c).toMatchObject({ open: false, closing: true, inert: true, hitIns: false, resizer: 'none' });
    expect(c.anims.length).toBe(1);
    expect(c.anims[0].duration).toBeLessThanOrEqual(140);
    // Mid-way the file pane is between its two widths (it resizes smoothly).
    await expect.poll(() => page.evaluate(() => document.getElementById('list-pane').getBoundingClientRect().width))
      .toBeGreaterThan(listW0);
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
        anims: window.__fpAnims(ins) };
    });
    expect(o).toMatchObject({ open: true, inert: false, focused: true });
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
        mr: getComputedStyle(ins).marginRight, inert: ins.inert, listW: document.getElementById('list-pane').getBoundingClientRect().width };
    });
    expect(fin.open).toBe(true);
    expect(Math.abs(fin.w - openW)).toBeLessThan(1);
    expect(fin.mr).toBe('0px');
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
