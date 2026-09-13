#!/usr/bin/env node
// scripts/check_menu_cases.js — every cm-* action referenced in CONTEXT_MENUS
// (frontend/src/app.js) must have a `case` in the data-action dispatch switch
// in the same file. Exits 1 and prints the diff if the two sets disagree.
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app.js'), 'utf8');

const menuStart = appJs.indexOf('const CONTEXT_MENUS = {');
const menuEnd = menuStart === -1 ? -1 : appJs.indexOf('\n};', menuStart);
if (menuStart === -1 || menuEnd === -1) {
  console.error('check_menu_cases: could not locate the CONTEXT_MENUS block in app.js (file reshaped?)');
  process.exit(1);
}
const menuBlock = appJs.slice(menuStart, menuEnd);

const menuActions = new Set([...menuBlock.matchAll(/action:\s*'(cm-[\w-]+)'/g)].map(m => m[1]));
const switchCases = new Set([...appJs.matchAll(/case '(cm-[\w-]+)':/g)].map(m => m[1]));

// A reformat that breaks either regex (e.g. action written as "..." instead
// of '...') must fail loudly rather than pass on two empty sets.
if (menuActions.size === 0) {
  console.error('check_menu_cases: found 0 cm-* actions in CONTEXT_MENUS — regex or markup broke');
  process.exit(1);
}
if (switchCases.size === 0) {
  console.error('check_menu_cases: found 0 cm-* switch cases in app.js — regex or markup broke');
  process.exit(1);
}

// Known, accepted gaps — update alongside the run summary if this set
// changes. Anything else showing up in the diff is a regression, not a
// documented debt. Stage 2C Task 7 implemented cm-duplicate-tab/
// cm-close-other-tabs and removed cm-pin-tab/cm-rename-tab from the tab menu
// entirely (so neither shows up as a menu action any more) — nothing is left
// to allowlist.
const KNOWN_MISSING_CASE = new Set();
const KNOWN_EXTRA_CASE = new Set(['cm-paste-here']); // shares cm-paste's case on purpose

const missingCase = [...menuActions].filter(a => !switchCases.has(a) && !KNOWN_MISSING_CASE.has(a)).sort();
const extraCase = [...switchCases].filter(a => !menuActions.has(a) && !KNOWN_EXTRA_CASE.has(a)).sort();

if (missingCase.length || extraCase.length) {
  if (missingCase.length) console.error('cm-* actions in CONTEXT_MENUS with no switch case:', missingCase);
  if (extraCase.length) console.error('switch cases for cm-* actions not in CONTEXT_MENUS:', extraCase);
  process.exit(1);
}
console.log(`check_menu_cases: ok (${menuActions.size} cm-* actions, all have a switch case)`);
