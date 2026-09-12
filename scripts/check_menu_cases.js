#!/usr/bin/env node
// scripts/check_menu_cases.js — every cm-* action referenced in CONTEXT_MENUS
// (frontend/src/app.js) must have a `case` in the data-action dispatch switch
// in the same file. Exits 1 and prints the diff if the two sets disagree.
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'src', 'app.js'), 'utf8');

const menuStart = appJs.indexOf('const CONTEXT_MENUS = {');
const menuEnd = appJs.indexOf('\n};', menuStart);
const menuBlock = appJs.slice(menuStart, menuEnd);

const menuActions = new Set([...menuBlock.matchAll(/action:\s*'(cm-[\w-]+)'/g)].map(m => m[1]));
const switchCases = new Set([...appJs.matchAll(/case '(cm-[\w-]+)':/g)].map(m => m[1]));

// Known, accepted gaps (Stage 2B Task 8b) — update alongside
// docs/superpowers/runs/2026-09-11-stage-2b.md if this set changes. Anything
// else showing up in the diff is a regression, not a documented debt.
const KNOWN_MISSING_CASE = new Set(['cm-duplicate-tab', 'cm-close-other-tabs', 'cm-pin-tab', 'cm-rename-tab']);
const KNOWN_EXTRA_CASE = new Set(['cm-paste-here']); // shares cm-paste's case on purpose

const missingCase = [...menuActions].filter(a => !switchCases.has(a) && !KNOWN_MISSING_CASE.has(a)).sort();
const extraCase = [...switchCases].filter(a => !menuActions.has(a) && !KNOWN_EXTRA_CASE.has(a)).sort();

if (missingCase.length || extraCase.length) {
  if (missingCase.length) console.error('cm-* actions in CONTEXT_MENUS with no switch case:', missingCase);
  if (extraCase.length) console.error('switch cases for cm-* actions not in CONTEXT_MENUS:', extraCase);
  process.exit(1);
}
console.log(`check_menu_cases: ok (${menuActions.size} cm-* actions, all have a switch case)`);
