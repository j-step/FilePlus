/* frontend/src/overlayscroll.js — the overlay scrollbar (Stage 2D §9.3).
 *
 * fpOverlayScroll(el, opts) hides el's native scrollbar and lays a thin
 * thumb OVER el's right edge instead, so the bar takes no layout width and
 * nothing is pushed sideways:
 *   - the thumb is --oscroll-w wide (3px), widening to --oscroll-w-hot (7px)
 *     while the pointer is in the hot zone, the right --oscroll-hot (10px) of
 *     el, with a 160ms ease on width and opacity so a quick pass never
 *     flashes;
 *   - it shows while the panel is hovered, while el scrolls and while the
 *     thumb is dragged, and fades out 900ms after the last scroll;
 *   - it is not there at all while the content fits;
 *   - the track (.fp-oscroll) is only the thumb's own column, --oscroll-inset
 *     in from the edge: dragging the thumb scrolls, a press in the column
 *     above/below the thumb pages toward it, a wheel there scrolls el. A
 *     press anywhere else — the rest of the hot zone included — reaches the
 *     content underneath. Panels keep that column clear of their controls
 *     (styles.css: the sidebar scroller's right padding; in the collapsed
 *     rail only the thumb itself takes the pointer).
 *   - is-scroll-top / is-scroll-bottom on el say content is hidden above /
 *     below, which styles.css turns into 20px mask fades (opts.fade, on by
 *     default) — the scroll cue.
 * The three widths are read from CSS (getComputedStyle on el) on every
 * update, so a panel state that redefines them (the collapsed rail) applies.
 * A ResizeObserver (el, its direct children, its parent) and a
 * MutationObserver (el's subtree, childList) keep it right as sections
 * render dynamically.
 *
 * The track is inserted right after el and positioned absolutely in el's
 * parent (made position:relative if it was static, and restored by
 * destroy()), so el itself is never re-parented and no selector that walks
 * the existing markup changes. It is aria-hidden and never focusable:
 * keyboard scrolling stays el's own.
 *
 * Loaded before app.js; defines functions only (CLAUDE.md load order).
 */

const FP_OSCROLL_FADE_MS = 900;   // the thumb fades this long after the last scroll
const FP_OSCROLL_PAD_PX = 2;      // the thumb's gap from the track's top/bottom ends
const FP_OSCROLL_MIN_THUMB = 24;  // shortest thumb, CSS px
const FP_OSCROLL_SLACK = 1;       // px of scroll that still counts as "at the end"
// Live (attached, not destroyed) overlay scrollbars — a leak check for the
// tests (Task 14 I2: one per text preview used to pile up for the session).
window.__fpOverlayScrollLive = 0;

/** A px length custom property of `el` (e.g. --oscroll-hot), or `fallback`. */
function _fpOscrollVar(cs, name, fallback) {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Attaches the overlay scrollbar to the scroller `el`. Idempotent: a second
 * call returns the first handle. Returns { update(), destroy(), track }. */
function fpOverlayScroll(el, opts = {}) {
  if (!el || !el.parentElement) return null;
  if (el._fpOverlayScroll) return el._fpOverlayScroll;
  const parent = el.parentElement;
  const madeRelative = getComputedStyle(parent).position === 'static';
  if (madeRelative) parent.style.position = 'relative';
  const fade = opts.fade !== false;
  el.classList.add('fp-oscroll-host');
  if (fade) el.classList.add('fp-oscroll-host--fade');

  const track = document.createElement('div');
  track.className = 'fp-oscroll is-none';
  track.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('div');
  thumb.className = 'fp-oscroll__thumb';
  track.appendChild(thumb);
  el.after(track);

  const hoverRoot = opts.hoverRoot || parent;
  let hovered = false;
  let scrolling = false;
  let drag = null;
  let fadeTimer = 0;
  let raf = 0;
  // Layout read once per update / pointerenter, never per pointermove.
  let geo = { trackH: 0, thumbH: 0, max: 0, hot: 10, zone: null };

  function paintVisible() {
    track.classList.toggle('is-visible', hovered || scrolling || !!drag);
  }

  /** The hot zone in client coordinates: el's right --oscroll-hot px. */
  function measureZone() {
    if (track.classList.contains('is-none')) { geo.zone = null; return; }
    const r = el.getBoundingClientRect();
    geo.zone = { left: r.right - geo.hot, right: r.right, top: r.top, bottom: r.bottom };
  }

  function update() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (!el.isConnected) return;
    const ch = el.clientHeight;
    const sh = el.scrollHeight;
    const max = Math.max(0, sh - ch);
    const st = Math.min(Math.max(el.scrollTop, 0), max);
    const scrollable = ch > 0 && max > FP_OSCROLL_SLACK;
    el.classList.toggle('is-scroll-top', scrollable && st > FP_OSCROLL_SLACK);
    el.classList.toggle('is-scroll-bottom', scrollable && st < max - FP_OSCROLL_SLACK);
    track.classList.toggle('is-none', !scrollable);
    if (!scrollable) { geo = { ...geo, trackH: 0, thumbH: 0, max: 0, zone: null }; return; }
    const cs = getComputedStyle(el);
    const hot = _fpOscrollVar(cs, '--oscroll-hot', 10);
    const col = _fpOscrollVar(cs, '--oscroll-w-hot', 7);
    const inset = _fpOscrollVar(cs, '--oscroll-inset', 3);
    const right = el.offsetLeft + el.clientLeft + el.clientWidth;
    track.style.top = `${el.offsetTop + el.clientTop}px`;
    track.style.left = `${right - inset - col}px`;
    track.style.width = `${col}px`;
    track.style.height = `${ch}px`;
    const trackH = Math.max(0, ch - 2 * FP_OSCROLL_PAD_PX);
    const thumbH = Math.min(trackH, Math.max(FP_OSCROLL_MIN_THUMB, Math.round(trackH * ch / sh)));
    const y = FP_OSCROLL_PAD_PX + (max ? (st / max) * (trackH - thumbH) : 0);
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${y}px)`;
    geo = { ...geo, trackH, thumbH, max, hot };
    if (hovered) measureZone();
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); });
  }

  function onScroll() {
    update();
    scrolling = true;
    paintVisible();
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { scrolling = false; paintVisible(); }, FP_OSCROLL_FADE_MS);
  }

  function inHotZone(e) {
    const z = geo.zone;
    return !!z && e.clientX >= z.left && e.clientX <= z.right && e.clientY >= z.top && e.clientY <= z.bottom;
  }

  function onEnter() { hovered = true; measureZone(); paintVisible(); }
  function onLeave() {
    hovered = false;
    if (!drag) track.classList.remove('is-hot');
    paintVisible();
  }
  function onMove(e) { track.classList.toggle('is-hot', !!drag || inHotZone(e)); }

  function onTrackDown(e) {
    if (e.button !== 0 || track.classList.contains('is-none')) return;
    const r = thumb.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY <= r.bottom) {
      drag = { id: e.pointerId, y: e.clientY, st: el.scrollTop };
      // Captured on the thumb, which takes the pointer even where the track
      // itself does not (the collapsed rail); its events bubble to here.
      thumb.setPointerCapture(e.pointerId);
      track.classList.add('is-dragging', 'is-hot');
      paintVisible();
    } else {
      // Page toward the press, keeping a little of the old view in sight.
      const dir = e.clientY < r.top ? -1 : 1;
      el.scrollTop += dir * Math.max(1, el.clientHeight - 2 * FP_OSCROLL_MIN_THUMB);
    }
  }
  function onTrackMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const travel = geo.trackH - geo.thumbH;
    if (travel <= 0) return;
    el.scrollTop = drag.st + (e.clientY - drag.y) * (geo.max / travel);
  }
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    try { thumb.releasePointerCapture(drag.id); } catch (_) { /* already released */ }
    drag = null;
    track.classList.remove('is-dragging');
    if (!hovered || (e && !inHotZone(e))) track.classList.remove('is-hot');
    paintVisible();
  }
  // No text selection starting from a press on the bar.
  function onTrackMouseDown(e) { e.preventDefault(); }
  function onTrackWheel(e) {
    if (e.ctrlKey) return; // Ctrl+wheel belongs to app zoom
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
    el.scrollTop += e.deltaY * unit;
  }

  el.addEventListener('scroll', onScroll, { passive: true });
  hoverRoot.addEventListener('pointerenter', onEnter);
  hoverRoot.addEventListener('pointerleave', onLeave);
  hoverRoot.addEventListener('pointermove', onMove, { passive: true });
  track.addEventListener('pointerdown', onTrackDown);
  track.addEventListener('pointermove', onTrackMove);
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('lostpointercapture', endDrag);
  track.addEventListener('mousedown', onTrackMouseDown);
  track.addEventListener('wheel', onTrackWheel, { passive: true });

  let ro = null;
  let mo = null;
  const observed = new Set();
  /** Observe el's current direct children; drop the ones that left. */
  const syncChildren = () => {
    if (!ro) return;
    for (const child of observed) {
      if (child.parentElement !== el) { ro.unobserve(child); observed.delete(child); }
    }
    for (const child of el.children) {
      if (!observed.has(child)) { ro.observe(child); observed.add(child); }
    }
  };
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(schedule);
    ro.observe(el);
    ro.observe(parent);
    syncChildren();
  }
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(() => { syncChildren(); schedule(); });
    mo.observe(el, { childList: true, subtree: true });
  }
  update();
  window.__fpOverlayScrollLive++;

  function destroy() {
    if (el._fpOverlayScroll !== handle) return;   // already destroyed
    window.__fpOverlayScrollLive--;
    clearTimeout(fadeTimer);
    if (raf) cancelAnimationFrame(raf);
    ro?.disconnect();
    mo?.disconnect();
    observed.clear();
    el.removeEventListener('scroll', onScroll);
    hoverRoot.removeEventListener('pointerenter', onEnter);
    hoverRoot.removeEventListener('pointerleave', onLeave);
    hoverRoot.removeEventListener('pointermove', onMove);
    track.remove();
    if (madeRelative) parent.style.position = '';
    el.classList.remove('fp-oscroll-host', 'fp-oscroll-host--fade', 'is-scroll-top', 'is-scroll-bottom');
    delete el._fpOverlayScroll;
  }

  const handle = { update, destroy, track };
  el._fpOverlayScroll = handle;
  return handle;
}
