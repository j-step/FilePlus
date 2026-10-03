#!/usr/bin/env node
// scripts/check_layers.js — the layer gate (Stage 2D addendum §3).
//
// One z-index scale, defined as --z-* tokens on :root in frontend/src/
// styles.css, and nothing stacks outside it. Checks:
//
//  1. :root defines every tier in SCALE, in that order, each an integer and
//     each strictly above the one before (the order is the design: base and
//     sticky up through popover, menu, scrim, modal and notice).
//  2. No --z-* token is defined anywhere but :root, and :root defines no
//     --z-* token SCALE does not list (a new layer is added here, on purpose).
//  3. Every z-index declaration in styles.css is `var(--z-<tier>)` or
//     `calc(var(--z-<tier>) + n)` — a small lift inside a tier that stays
//     below the next tier. No literal numbers, no other custom property.
//  4. No z-index anywhere else: none in index.html (style attributes or
//     <style>), none set from frontend/src/*.js, main.js or preload.js
//     (style.zIndex, setProperty('z-index'), cssText).
//
// Exits 1 and prints every violation.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');
const CSS_PATH = path.join(SRC, 'styles.css');

// Lowest to highest. Keep in step with the :root block in styles.css.
const SCALE = [
  '--z-base', '--z-local', '--z-raised', '--z-overlay-scroll', '--z-marquee', '--z-header',
  '--z-sidebar-resize', '--z-popover', '--z-dropdown', '--z-menu', '--z-tooltip', '--z-drag',
  '--z-scrim', '--z-modal', '--z-notice',
];

let failed = false;
const fail = (msg) => { console.error(`check_layers: ${msg}`); failed = true; };

const rawCss = fs.readFileSync(CSS_PATH, 'utf8');
// Comments out, line numbers kept.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
const lineOf = (idx) => css.slice(0, idx).split('\n').length;

// ---- Declarations with their selector (same small brace walk as check_motion) ----
const decls = [];
{
  const stack = [];
  let segStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      stack.push(css.slice(segStart, i).trim());
      segStart = i + 1;
    } else if (ch === ';' || ch === '}') {
      const text = css.slice(segStart, i);
      const m = text.match(/^\s*(--[\w-]+|[a-z-]+)\s*:([\s\S]*)$/);
      if (m && !stack.some((h) => /^@(?:-webkit-)?keyframes/.test(h))) {
        decls.push({ prop: m[1], value: m[2].replace(/!important\s*$/, '').trim(),
          selector: stack[stack.length - 1] || '', idx: segStart + text.search(/\S/) });
      }
      if (ch === '}') stack.pop();
      segStart = i + 1;
    }
  }
}

// ---- 1 + 2. The scale ----
const tiers = new Map();
for (const d of decls) {
  if (!d.prop.startsWith('--z-')) continue;
  if (d.selector !== ':root') { fail(`styles.css:${lineOf(d.idx)} ${d.prop} is defined in "${d.selector}" — layers live on :root only`); continue; }
  if (!SCALE.includes(d.prop)) fail(`styles.css:${lineOf(d.idx)} ${d.prop} is not in the scale (scripts/check_layers.js SCALE)`);
  if (!/^-?\d+$/.test(d.value)) fail(`styles.css:${lineOf(d.idx)} ${d.prop}: "${d.value}" is not an integer`);
  tiers.set(d.prop, parseInt(d.value, 10));
}
let prev = null;
for (const name of SCALE) {
  if (!tiers.has(name)) { fail(`:root does not define ${name}`); continue; }
  if (prev && !(tiers.get(name) > tiers.get(prev))) fail(`${name} (${tiers.get(name)}) is not above ${prev} (${tiers.get(prev)})`);
  prev = name;
}
const nextAbove = (name) => {
  const i = SCALE.indexOf(name);
  return i >= 0 && i + 1 < SCALE.length ? tiers.get(SCALE[i + 1]) : Infinity;
};

// ---- 3. Every z-index is on the scale ----
let uses = 0;
for (const d of decls) {
  if (d.prop !== 'z-index') continue;
  uses++;
  const where = `styles.css:${lineOf(d.idx)} "${d.selector}" z-index: ${d.value}`;
  if (/^(auto|inherit|initial|unset|revert)$/.test(d.value)) continue;
  let m = d.value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  if (m) {
    if (!SCALE.includes(m[1])) fail(`${where} — ${m[1]} is not a --z-* tier`);
    continue;
  }
  m = d.value.match(/^calc\(\s*var\(\s*(--[\w-]+)\s*\)\s*\+\s*(\d+)\s*\)$/);
  if (m) {
    if (!SCALE.includes(m[1])) { fail(`${where} — ${m[1]} is not a --z-* tier`); continue; }
    if (tiers.has(m[1]) && tiers.get(m[1]) + parseInt(m[2], 10) >= nextAbove(m[1])) {
      fail(`${where} — the lift reaches the next tier; add a tier instead`);
    }
    continue;
  }
  fail(`${where} — a literal or off-scale z-index; use var(--z-<tier>)`);
}

// ---- 4. No z-index outside styles.css ----
{
  const html = fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/z-index\s*:/g)) {
    fail(`index.html:${html.slice(0, m.index).split('\n').length} sets a z-index — layers live in styles.css on the --z-* scale`);
  }
}
const jsFiles = fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'icons-sprite.js' && f !== 'filetypes.js')
  .map((f) => path.join(SRC, f)).concat([path.join(FRONTEND, 'main.js'), path.join(FRONTEND, 'preload.js')]);
for (const file of jsFiles) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/\.zIndex\b|setProperty\(\s*['"]z-index|z-index\s*:/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      fail(`${path.relative(ROOT, file)}:${i + 1} sets a z-index — use a class whose z-index is a --z-* tier`);
    }
  });
}

if (failed) process.exit(1);
console.log(`check_layers: ok (${SCALE.length} tiers, ${uses} z-index declarations, all on the scale)`);
