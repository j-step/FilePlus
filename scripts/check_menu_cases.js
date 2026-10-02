#!/usr/bin/env node
// scripts/check_menu_cases.js — two checks on the click dispatch in
// frontend/src/app.js (`document.addEventListener('click', …)`'s switch):
//
//  1. Every cm-* action referenced in CONTEXT_MENUS has a `case` in the
//     switch, and every cm-* case is a real menu action.
//  2. Every data-action in frontend/index.html (HTML comments stripped) and in
//     the literal `data-action="…"` templates of frontend/src/*.js is handled:
//     it has a `case`, or it is in IN_SCOPE_ACTIONS (a deliberate silent
//     no-op, handled by a listener of its own). Anything else falls into the
//     switch's default branch — the "not yet implemented" stub — which is how
//     dead controls used to ship on a green verify (pass 2 #186/#187). There
//     are no exemptions: Stage 2D Task 12a took the unbuilt screens and
//     Settings panes (and their 100 placeholder controls) out of the DOM, so
//     a control that does nothing can no longer ship at all. A later stage
//     that brings one back adds its `case` with it.
//
// Exits 1 and prints every disagreement.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'frontend', 'src');
const appJs = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ROOT, 'frontend', 'index.html'), 'utf8');

let failed = false;
const fail = (...msg) => { console.error(...msg); failed = true; };

// ---- Check 1: context menus <-> switch cases ----
const menuStart = appJs.indexOf('const CONTEXT_MENUS = {');
const menuEnd = menuStart === -1 ? -1 : appJs.indexOf('\n};', menuStart);
if (menuStart === -1 || menuEnd === -1) {
  console.error('check_menu_cases: could not locate the CONTEXT_MENUS block in app.js (file reshaped?)');
  process.exit(1);
}
const menuBlock = appJs.slice(menuStart, menuEnd);

const menuActions = new Set([...menuBlock.matchAll(/action:\s*'(cm-[\w-]+)'/g)].map(m => m[1]));
const allCases = new Set([...appJs.matchAll(/case '([\w-]+)':/g)].map(m => m[1]));
const cmCases = new Set([...allCases].filter(a => a.startsWith('cm-')));

// A reformat that breaks either regex (e.g. action written as "..." instead
// of '...') must fail loudly rather than pass on two empty sets.
if (menuActions.size === 0) {
  console.error('check_menu_cases: found 0 cm-* actions in CONTEXT_MENUS — regex or markup broke');
  process.exit(1);
}
if (cmCases.size === 0) {
  console.error('check_menu_cases: found 0 cm-* switch cases in app.js — regex or markup broke');
  process.exit(1);
}

const KNOWN_EXTRA_CASE = new Set(['cm-paste-here']); // shares cm-paste's case on purpose
const missingCase = [...menuActions].filter(a => !cmCases.has(a)).sort();
const extraCase = [...cmCases].filter(a => !menuActions.has(a) && !KNOWN_EXTRA_CASE.has(a)).sort();
if (missingCase.length) fail('cm-* actions in CONTEXT_MENUS with no switch case:', missingCase);
if (extraCase.length) fail('switch cases for cm-* actions not in CONTEXT_MENUS:', extraCase);

// ---- Check 2: every data-action reaches a case or IN_SCOPE_ACTIONS ----
const inScopeStart = appJs.indexOf('const IN_SCOPE_ACTIONS = new Set([');
const inScopeEnd = inScopeStart === -1 ? -1 : appJs.indexOf(']);', inScopeStart);
if (inScopeStart === -1 || inScopeEnd === -1) {
  console.error('check_menu_cases: could not locate IN_SCOPE_ACTIONS in app.js (file reshaped?)');
  process.exit(1);
}
const inScope = new Set([...appJs.slice(inScopeStart, inScopeEnd)
  .replace(/\/\/[^\n]*/g, '') // comments quote action names too
  .matchAll(/'([\w-]+)'/g)].map(m => m[1]));

const htmlNoComments = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
const declared = new Map(); // action -> first site
const addSite = (action, site) => { if (!declared.has(action)) declared.set(action, site); };
for (const m of htmlNoComments.matchAll(/data-action="([\w-]+)"/g)) addSite(m[1], 'frontend/index.html');
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.js') || f === 'icons-sprite.js') continue;
  const text = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of text.matchAll(/data-action="([\w-]+)"/g)) addSite(m[1], `frontend/src/${f}`);
}
if (declared.size === 0 || inScope.size === 0) {
  console.error('check_menu_cases: found 0 data-actions or 0 IN_SCOPE_ACTIONS — regex or markup broke');
  process.exit(1);
}

const handled = (a) => allCases.has(a) || inScope.has(a);
const unhandled = [...declared.keys()].filter(a => !handled(a)).sort();
if (unhandled.length) {
  fail('data-action(s) with no switch case and not in IN_SCOPE_ACTIONS (a click would hit the stub default branch):');
  for (const a of unhandled) console.error(`  ${a}  (${declared.get(a)})`);
  console.error('  add a `case` in app.js, or list it in IN_SCOPE_ACTIONS if its own listener handles it');
}
if (failed) process.exit(1);
console.log(`check_menu_cases: ok (${menuActions.size} cm-* actions with a case; all ${declared.size} data-actions `
  + 'handled — no placeholder controls)');
