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
  await page.evaluate(() => { setInspectorOpen(false, { persist: false }); window.__fpSample(); });
  await page.evaluate(() => { setInspectorOpen(true, { persist: false }); window.__fpSample(); });
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
