#!/usr/bin/env node
// scripts/check_icons.js — keeps the Fluent icon sprite (Stage 2C Task 5) the
// single source of icon markup in the renderer. Three checks, exits 1 and
// prints a list on the first failure category found:
//
//  1. No new hand-drawn inline <svg> in frontend/index.html or
//     frontend/src/*.js (icons-sprite.js excepted — it's the generated
//     sprite itself). An <svg ...> tag is allowed only when its opening tag
//     carries class="fp-icon" (the icon()/iconFor() <use> wrapper pattern,
//     or hand-written static markup using the same pattern). A short,
//     explicit id allowlist covers the two genuine non-icon inline SVGs
//     (live data-viz canvases the sprite format can't represent: the Scan
//     Progress sparkline and the Tag Canvas relationship graph) — anything
//     else is a regression. index.html also carries ~20 commented-out
//     example/alternate-state blocks (<!-- ... -->) predating this gate;
//     HTML comments are stripped before scanning so that reference markup
//     doesn't have to be rewritten into sprite syntax to satisfy a gate that
//     never renders it.
//  2. Every #fp-<name> href and icon('<name>') / icon("<name>") call
//     resolves to a symbol actually present in the generated sprite
//     (frontend/src/icons-sprite.js).
//  3. Every family in frontend/src/filetypes.js's FP_FILETYPES.families has
//     a matching fp-ft-<family> sprite symbol. Task 6 fills in the filetype
//     SVGs and enforces this; today it only warns (never fails the gate).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const SRC = path.join(FRONTEND, 'src');

// Non-icon inline SVGs the sprite format cannot represent (per-instance live
// data, not a fixed glyph). Identified by id — add here, with a reason,
// rather than loosening the class="fp-icon" rule.
const ALLOWED_RAW_SVG_IDS = new Set([
  'scan-sparkline', // Scan Progress throughput chart — live polyline points
  'tag-graph-canvas', // Tag Canvas relationship graph — live nodes/edges from GET /tags/graph
]);

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' ')); // keep line numbers stable
}

function findRawSvgViolations(text, isHtml) {
  const scanned = isHtml ? stripHtmlComments(text) : text;
  const violations = [];
  const svgOpenRe = /<svg\b[^>]*>/g;
  let m;
  while ((m = svgOpenRe.exec(scanned))) {
    const tag = m[0];
    if (tag.includes('class="fp-icon')) continue;
    const idMatch = tag.match(/\sid="([^"]+)"/);
    if (idMatch && ALLOWED_RAW_SVG_IDS.has(idMatch[1])) continue;
    const lineNo = scanned.slice(0, m.index).split('\n').length;
    violations.push({ lineNo, snippet: tag.slice(0, 120) });
  }
  return violations;
}

function listSourceFiles() {
  const files = [path.join(FRONTEND, 'index.html')];
  for (const f of fs.readdirSync(SRC)) {
    if (f.endsWith('.js') && f !== 'icons-sprite.js') files.push(path.join(SRC, f));
  }
  return files;
}

// ---- Check 1: no new hand-drawn inline <svg> ----
let rawSvgFailures = [];
for (const file of listSourceFiles()) {
  const text = fs.readFileSync(file, 'utf8');
  const isHtml = file.endsWith('.html');
  const violations = findRawSvgViolations(text, isHtml);
  if (violations.length) {
    rawSvgFailures.push({ file: path.relative(ROOT, file), violations });
  }
}

// ---- Check 2: every reference resolves to a sprite symbol ----
const spritePath = path.join(SRC, 'icons-sprite.js');
if (!fs.existsSync(spritePath)) {
  console.error(`check_icons: ${path.relative(ROOT, spritePath)} does not exist — run "node scripts/build_icons.js" first`);
  process.exit(1);
}
const spriteSrc = fs.readFileSync(spritePath, 'utf8');
// icons-sprite.js is `const FP_ICON_SPRITE = "<svg ...>...";` — a single
// JSON-string-literal-compatible (build_icons.js writes it via
// JSON.stringify) assignment. Pull the literal out and JSON.parse it back to
// real markup rather than regexing the escaped (\") source text directly.
const literalMatch = spriteSrc.match(/const FP_ICON_SPRITE = (".*");\s*$/s);
if (!literalMatch) {
  console.error('check_icons: could not find `const FP_ICON_SPRITE = "...";` in icons-sprite.js (file reshaped?)');
  process.exit(1);
}
const spriteMarkup = JSON.parse(literalMatch[1]);
const symbolIds = new Set([...spriteMarkup.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
if (symbolIds.size === 0) {
  console.error('check_icons: found 0 <symbol id="..."> in icons-sprite.js — regex or generated file broke');
  process.exit(1);
}

const referencedNames = new Map(); // name -> [{file, lineNo}]
function addRef(name, file, lineNo) {
  const key = name;
  if (!referencedNames.has(key)) referencedNames.set(key, []);
  referencedNames.get(key).push({ file, lineNo });
}
for (const file of listSourceFiles()) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of text.matchAll(/href="#(fp-[\w-]+)"/g)) {
    addRef(m[1], rel, text.slice(0, m.index).split('\n').length);
  }
  for (const m of text.matchAll(/\bicon\(\s*['"]([\w-]+)['"]/g)) {
    addRef(`fp-${m[1]}`, rel, text.slice(0, m.index).split('\n').length);
  }
}
const unresolvedRefs = [];
for (const [name, sites] of referencedNames) {
  if (!symbolIds.has(name)) {
    for (const s of sites) unresolvedRefs.push(`${s.file}:${s.lineNo} -> ${name}`);
  }
}

// ---- Check 3: filetype family coverage (warn-only in Task 5) ----
const filetypesPath = path.join(SRC, 'filetypes.js');
let familyWarnings = [];
if (fs.existsSync(filetypesPath)) {
  const ftSrc = fs.readFileSync(filetypesPath, 'utf8');
  const familiesMatch = ftSrc.match(/"families":\s*\{([\s\S]*?)\},\s*"groups"/);
  if (familiesMatch) {
    const families = [...familiesMatch[1].matchAll(/"([\w-]+)":\s*\[/g)].map(m => m[1]);
    familyWarnings = families.filter(f => !symbolIds.has(`fp-ft-${f}`));
  }
}

// ---- Report ----
let failed = false;

if (rawSvgFailures.length) {
  failed = true;
  console.error('check_icons: hand-drawn inline <svg> found outside the icon sprite:');
  for (const { file, violations } of rawSvgFailures) {
    for (const v of violations) {
      console.error(`  ${file}:${v.lineNo}  ${v.snippet}`);
    }
  }
}

if (unresolvedRefs.length) {
  failed = true;
  console.error('check_icons: icon reference(s) do not resolve to a sprite symbol:');
  for (const r of unresolvedRefs) console.error(`  ${r}`);
}

if (familyWarnings.length) {
  console.warn(`check_icons: WARN — ${familyWarnings.length} filetypes.js family(ies) have no fp-ft-<family> sprite symbol yet (Task 6): ${familyWarnings.join(', ')}`);
}

if (failed) process.exit(1);
console.log(`check_icons: ok (${symbolIds.size} sprite symbols, ${referencedNames.size} distinct references resolved, 0 raw <svg> outside the sprite)`);
