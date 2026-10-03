#!/usr/bin/env node
// scripts/check_motion.js — the motion gate (Stage 2D addendum §5.1).
//
// Every duration and easing comes from a token, every animation is under the
// one switch (html[data-motion]), and prefers-reduced-motion gates nothing
// (decision A-2). Checks:
//
//  1. frontend/src/styles.css's :root defines --motion-instant/-fast/-base/
//     -slow and --ease-out/-in/-standard, and every --motion-* token resolves
//     to <= 200 ms (the ceiling).
//  2. A literal duration (other than 0) appears only in a --motion-* or
//     --timer-* token's definition; a literal easing (cubic-bezier(),
//     steps(), linear, ease, ease-in, ...) only in an --ease-* token's.
//  3. Every transition* / animation* declaration uses only var(--motion-*)
//     and var(--ease-*) for its timing: no literal durations or easings, no
//     other custom property. Every comma-separated part of a `transition` /
//     `animation` shorthand names an --ease-* token (no silent default
//     easing). No animation repeats forever (`infinite`). A --timer-* token
//     appears in a CSS declaration only where TIMER_ALLOW lists that
//     (token, selector, property), and every listed use exists.
//  4. Every @keyframes is used by some animation and every animation names a
//     @keyframes that exists (no dead or dangling keyframes).
//  5. The gate rule exists: html:not([data-motion="on"]) and everything in
//     it get `animation: none !important` and `transition: none !important`.
//     No other transition/animation declaration is !important (it could beat
//     the gate) unless its value is `none`.
//  6. No `prefers-reduced-motion` in styles.css, index.html, preload.js,
//     main.js or frontend/src/*.js.
//  7. JS animates only through fpAnimate (app.js): no other `.animate(` call
//     and no inline transition/animation (style.transition/animation,
//     setProperty, cssText, setAttribute('style', …)); no inline
//     transition/animation in index.html.
//
// --timer-* tokens are timers, not decoration (a notice's life, a hover-intent
// wait); the 200 ms ceiling does not apply to them. JS reads them through
// fpMotionMs; CSS may use one only where TIMER_ALLOW says.
//
// Exits 1 and prints every violation.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');
const CSS_PATH = path.join(SRC, 'styles.css');

let failed = false;
const fail = (msg) => { console.error(`check_motion: ${msg}`); failed = true; };

const rawCss = fs.readFileSync(CSS_PATH, 'utf8');
// Comments out, line numbers kept (each comment char that is not a newline
// becomes a space).
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
const lineOf = (idx) => css.slice(0, idx).split('\n').length;

const TIME_RE = /(^|[^\w.-])(\d*\.?\d+)(ms|s)(?![\w-])/g;
const EASING_FN_RE = /\b(cubic-bezier|steps|linear)\s*\(/;
const EASING_WORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end']);
const ALLOWED_VAR = /^--(motion|ease)-[a-z0-9-]+$/;
// The only places CSS may use a --timer-* token: [token, selector, property].
const TIMER_ALLOW = [
  // The snackbar's countdown bar runs exactly as long as the snackbar lives.
  ['--timer-snackbar', '.fp-snackbar__progress', 'animation'],
];
const ANIM_KEYWORDS = new Set(['none', 'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse',
  'forwards', 'backwards', 'both', 'running', 'paused', 'initial', 'inherit', 'unset', 'revert']);

const nonZeroTimes = (value) => {
  const out = [];
  for (const m of value.matchAll(TIME_RE)) if (parseFloat(m[2]) !== 0) out.push(`${m[2]}${m[3]}`);
  return out;
};
const easingLiterals = (value) => {
  const out = [];
  if (EASING_FN_RE.test(value)) out.push(value.match(EASING_FN_RE)[0]);
  for (const w of value.split(/[\s,()]+/)) if (EASING_WORDS.has(w)) out.push(w);
  return out;
};
const toMs = (v) => {
  const m = String(v).trim().match(/^(\d*\.?\d+)(ms|s)$/);
  if (!m) return NaN;
  return m[2] === 'ms' ? parseFloat(m[1]) : parseFloat(m[1]) * 1000;
};

// ---- Walk the declarations: {prop, value, important, selector, idx} ----
// A small brace-depth walk: good enough for this stylesheet (no nested
// strings with braces). @keyframes bodies are recorded separately.
const decls = [];
const keyframes = new Map();   // name -> line
{
  const stack = [];   // { header, start }
  let segStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const header = css.slice(segStart, i).trim();
      stack.push({ header });
      const kf = header.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/);
      if (kf) keyframes.set(kf[1], lineOf(i));
      segStart = i + 1;
    } else if (ch === ';' || ch === '}') {
      const text = css.slice(segStart, i);
      const inKeyframes = stack.some((s) => /^@(?:-webkit-)?keyframes/.test(s.header));
      const m = text.match(/^\s*(--[\w-]+|[a-z-]+)\s*:([\s\S]*)$/);
      if (m && !inKeyframes) {
        let value = m[2].trim();
        const important = /!important\s*$/.test(value);
        value = value.replace(/!important\s*$/, '').trim();
        const top = stack[stack.length - 1];
        decls.push({ prop: m[1], value, important, selector: top ? top.header : '', idx: segStart + text.search(/\S/) });
      }
      if (ch === '}') stack.pop();
      segStart = i + 1;
    }
  }
}

// ---- 1. Core tokens on :root ----
const rootDefs = new Map();
for (const d of decls) if (d.selector === ':root' && d.prop.startsWith('--')) rootDefs.set(d.prop, d.value);
for (const n of ['--motion-instant', '--motion-fast', '--motion-base', '--motion-slow', '--ease-out', '--ease-in', '--ease-standard']) {
  if (!rootDefs.has(n)) fail(`:root does not define ${n}`);
}
const resolve = (value, seen = new Set()) => {
  const m = value.match(/^var\((--[\w-]+)\)$/);
  if (!m) return value;
  if (seen.has(m[1]) || !rootDefs.has(m[1])) return value;
  seen.add(m[1]);
  return resolve(rootDefs.get(m[1]), seen);
};
for (const [name, value] of rootDefs) {
  if (!name.startsWith('--motion-')) continue;
  const ms = toMs(resolve(value));
  if (!Number.isFinite(ms)) fail(`${name}: "${value}" does not resolve to a duration`);
  else if (ms > 200) fail(`${name}: ${ms} ms is above the 200 ms ceiling (--motion-slow)`);
}

// ---- 2. Literal durations / easings only inside their own tokens ----
for (const d of decls) {
  if (!d.prop.startsWith('--')) continue;
  const where = `styles.css:${lineOf(d.idx)} ${d.prop}`;
  if (!/^--(motion|timer)-/.test(d.prop)) {
    for (const t of nonZeroTimes(d.value)) fail(`${where}: literal duration ${t} outside a --motion-* / --timer-* token`);
  }
  if (!d.prop.startsWith('--ease-')) {
    for (const e of easingLiterals(d.value)) fail(`${where}: literal easing ${e} outside an --ease-* token`);
  }
}

// ---- 3. transition / animation declarations use tokens only ----
const TIMED = /^(transition|animation)(-duration|-delay|-timing-function)?$/;
const usedNames = new Set();
const timerUses = new Set();
const normSel = (s) => s.replace(/\s+/g, ' ').replace(/'/g, '"').split(',').map((x) => x.trim());
for (const d of decls) {
  const where = `styles.css:${lineOf(d.idx)} ${d.prop}: ${d.value}`;
  if (d.prop === 'animation' || d.prop === 'animation-name') {
    const stripped = d.value.replace(/var\([^)]*\)/g, ' ');
    for (const part of stripped.split(',')) {
      for (const w of part.trim().split(/\s+/)) {
        if (!w || ANIM_KEYWORDS.has(w) || EASING_WORDS.has(w) || /^[\d.]/.test(w)) continue;
        usedNames.add(w);
      }
    }
  }
  // A --timer-* token, anywhere in a rule: only an allowlisted use.
  if (!(d.selector === ':root' && d.prop.startsWith('--'))) {
    for (const v of d.value.matchAll(/var\(\s*(--timer-[\w-]+)/g)) {
      const ok = TIMER_ALLOW.find(([tok, sel, prop]) => tok === v[1] && prop === d.prop && normSel(d.selector).includes(sel));
      if (ok) timerUses.add(ok);
      else fail(`${where}: ${v[1]} is not allowlisted for "${d.selector}" ${d.prop} (TIMER_ALLOW)`);
    }
  }
  if ((d.prop === 'animation' || d.prop === 'animation-iteration-count') && /\binfinite\b/.test(d.value)) {
    fail(`${where}: an animation that never ends — motion is a single short play (§5.1)`);
  }
  if (!TIMED.test(d.prop)) continue;
  for (const v of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!ALLOWED_VAR.test(v[1]) && !/^--timer-/.test(v[1])) fail(`${where}: var(${v[1]}) — timing must come from --motion-* / --ease-* tokens`);
  }
  const bare = d.value.replace(/var\([^)]*\)/g, ' ');
  for (const t of nonZeroTimes(bare)) fail(`${where}: literal duration ${t}`);
  for (const e of easingLiterals(bare)) fail(`${where}: literal easing ${e}`);
  if ((d.prop === 'transition' || d.prop === 'animation') && d.value !== 'none') {
    for (const part of d.value.split(/,(?![^(]*\))/)) {
      if (!/var\(\s*--ease-[\w-]+\s*\)/.test(part)) fail(`${where}: "${part.trim()}" names no --ease-* token`);
    }
  }
}
for (const entry of TIMER_ALLOW) {
  if (!timerUses.has(entry)) fail(`TIMER_ALLOW lists ${entry.join(' / ')}, which styles.css no longer uses — drop it`);
}

// ---- 4. Keyframes used and defined ----
for (const [name, line] of keyframes) if (!usedNames.has(name)) fail(`styles.css:${line} @keyframes ${name} is never used`);
for (const name of usedNames) if (!keyframes.has(name)) fail(`animation "${name}" has no @keyframes`);

// ---- 5. The gate ----
const GATE_SEL = 'html:not([data-motion="on"]) *';
const gateDecls = decls.filter((d) => normSel(d.selector).includes(GATE_SEL));
const hasGate = (prop) => gateDecls.some((d) => d.prop === prop && d.value === 'none' && d.important);
if (!gateDecls.length) fail(`no gate rule for "${GATE_SEL}"`);
else {
  if (!hasGate('animation')) fail('the gate rule lacks `animation: none !important`');
  if (!hasGate('transition')) fail('the gate rule lacks `transition: none !important`');
  const sels = normSel(gateDecls[0].selector);
  for (const s of ['html:not([data-motion="on"])', 'html:not([data-motion="on"]) *::before', 'html:not([data-motion="on"]) *::after']) {
    if (!sels.includes(s)) fail(`the gate rule's selector list lacks ${s}`);
  }
}
for (const d of decls) {
  if (/^(transition|animation)/.test(d.prop) && d.important && d.value !== 'none'
      && !gateDecls.includes(d)) {
    fail(`styles.css:${lineOf(d.idx)} ${d.prop}: ${d.value} !important — could override the motion gate`);
  }
}

// ---- 6. prefers-reduced-motion gates nothing (A-2) ----
const jsFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'icons-sprite.js' && f !== 'filetypes.js')
  .map((f) => path.join(SRC, f));
for (const file of [CSS_PATH, path.join(FRONTEND, 'index.html'), path.join(FRONTEND, 'preload.js'),
  path.join(FRONTEND, 'main.js'), ...jsFiles]) {
  const text = fs.readFileSync(file, 'utf8');
  if (/prefers-reduced-motion/.test(text)) {
    fail(`${path.relative(ROOT, file)} mentions prefers-reduced-motion — animations follow only the FilePlus switch (A-2)`);
  }
}

// ---- 7. JS animates only through fpAnimate ----
for (const file of jsFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const lines = text.split('\n');
  let inFpAnimate = false;
  lines.forEach((line, i) => {
    if (/^function fpAnimate\(/.test(line)) inFpAnimate = true;
    else if (inFpAnimate && /^}/.test(line)) inFpAnimate = false;
    if (/\.animate\(/.test(line) && !(inFpAnimate && path.basename(file) === 'app.js')) {
      fail(`${rel}:${i + 1} calls .animate() — use fpAnimate() (app.js) so the switch and the tokens apply`);
    }
    if (/\.style\.(transition|animation)\w*\s*=/.test(line) || /setProperty\(\s*['"](transition|animation)/.test(line)
        || /cssText\s*\+?=.*\b(transition|animation)/.test(line)
        || /setAttribute\(\s*['"]style['"].*\b(transition|animation)/.test(line)) {
      fail(`${rel}:${i + 1} sets an inline transition/animation — use a class with token timings or fpAnimate()`);
    }
  });
}
{
  const html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/style="[^"]*\b(transition|animation)\s*:/g)) {
    fail(`index.html: inline ${m[1]} in a style attribute — timings live in styles.css tokens`);
  }
}

if (failed) process.exit(1);
console.log(`check_motion: ok (${decls.filter((d) => TIMED.test(d.prop)).length} timed declarations, ${keyframes.size} keyframes, all on tokens and under the switch)`);
