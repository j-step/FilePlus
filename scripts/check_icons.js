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
//     Names that reach icon() through a variable (a data table or a lookup)
//     are checked through FP_DYNAMIC_ICON_SYMBOLS, the list icons.js declares
//     for exactly that: each must resolve, and every value of the tables this
//     gate can see — `icon: '<name>'` properties (search.js's filter rows) and
//     app.js's QUICK_ACCESS_ICON — must be on that list (pass 2 #104).
//  3. Every family in frontend/src/filetypes.js's FP_FILETYPES.families has
//     a matching fp-ft-<family> sprite symbol, plus the folder symbols
//     iconFor()/_folderSymbol() resolve to (ft-folder, ft-folder-open and
//     every value of icons.js's FP_FOLDER_SPECIALS — derived, not restated).
//     Enforced (Task 6): adding a family to backend/filetypes.py without
//     authoring frontend/assets/icons/filetypes/<family>.svg fails the gate
//     rather than silently rendering a blank <use> in every row.
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
  // Only a call whose whole first argument is a string literal — the closing
  // `,`/`)` is what proves it. `icon('ft-' + fam, cls)` (iconFor's dynamic
  // family lookup) is deliberately not matched: its symbol name is only known
  // at runtime, and check 3's family coverage is what guarantees it resolves.
  for (const m of text.matchAll(/\bicon\(\s*['"]([\w-]+)['"]\s*[,)]/g)) {
    addRef(`fp-${m[1]}`, rel, text.slice(0, m.index).split('\n').length);
  }
}
// Non-literal references: icons.js's declared list, cross-checked against
// the data tables that feed icon() / fpShellItemIcon() a variable.
const iconsJsPath = path.join(SRC, 'icons.js');
const iconsSrc = fs.readFileSync(iconsJsPath, 'utf8');
function declaredStrings(src, re, what) {
  const m = src.match(re);
  if (!m) {
    console.error(`check_icons: could not find ${what} (file reshaped?)`);
    process.exit(1);
  }
  const names = [...m[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([\w-]+)'/g)].map(x => x[1]);
  if (names.length === 0) {
    console.error(`check_icons: parsed 0 names out of ${what} — regex or source broke`);
    process.exit(1);
  }
  return names;
}
const dynamicSymbols = new Set(declaredStrings(iconsSrc,
  /const FP_DYNAMIC_ICON_SYMBOLS = Object\.freeze\(\[([\s\S]*?)\]\)/, 'FP_DYNAMIC_ICON_SYMBOLS in icons.js'));
for (const name of dynamicSymbols) addRef(`fp-${name}`, 'frontend/src/icons.js', 'FP_DYNAMIC_ICON_SYMBOLS');
const tableValues = []; // {name, site}
for (const file of listSourceFiles()) {
  if (!file.endsWith('.js')) continue;
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of text.matchAll(/\bicon:\s*'([\w-]+)'/g)) {
    tableValues.push({ name: m[1], site: `${rel}:${text.slice(0, m.index).split('\n').length}` });
  }
}
const appSrc = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
const qaMatch = appSrc.match(/const QUICK_ACCESS_ICON = \{([^}]*)\}/);
if (!qaMatch) {
  console.error('check_icons: could not find QUICK_ACCESS_ICON in app.js (file reshaped?)');
  process.exit(1);
}
for (const m of qaMatch[1].matchAll(/:\s*'([\w-]+)'/g)) tableValues.push({ name: m[1], site: 'frontend/src/app.js QUICK_ACCESS_ICON' });
if (tableValues.length === 0) {
  console.error('check_icons: found 0 icon-table values — regex or source broke');
  process.exit(1);
}
const undeclaredTableValues = tableValues.filter(v => !dynamicSymbols.has(v.name));

const unresolvedRefs = [];
for (const [name, sites] of referencedNames) {
  if (!symbolIds.has(name)) {
    for (const s of sites) unresolvedRefs.push(`${s.file}:${s.lineNo} -> ${name}`);
  }
}

// ---- Check 3: filetype family + folder-variant coverage ----
// The folder symbols are not families in filetypes.js (a directory has no
// extension) but iconFor()/_folderSymbol() in frontend/src/icons.js resolve to
// them the same way, so they are required here too.
const folderSpecials = declaredStrings(iconsSrc, /const FP_FOLDER_SPECIALS = \{([^}]*)\}/, 'FP_FOLDER_SPECIALS in icons.js')
  .filter(v => v.startsWith('ft-')); // the values; the keys are unquoted ids
if (folderSpecials.length === 0) {
  console.error('check_icons: FP_FOLDER_SPECIALS has no ft-* values — regex or source broke');
  process.exit(1);
}
const REQUIRED_FOLDER_SYMBOLS = ['folder', 'folder-open', ...folderSpecials.map(v => v.replace(/^ft-/, ''))];
const filetypesPath = path.join(SRC, 'filetypes.js');
let missingFamilies = [];
if (!fs.existsSync(filetypesPath)) {
  console.error(`check_icons: ${path.relative(ROOT, filetypesPath)} does not exist — run "py -3 scripts/build_filetypes.py" first`);
  process.exit(1);
}
const ftSrc = fs.readFileSync(filetypesPath, 'utf8');
const familiesMatch = ftSrc.match(/"families":\s*\{([\s\S]*?)\},\s*"groups"/);
if (!familiesMatch) {
  console.error('check_icons: could not find FP_FILETYPES.families in filetypes.js (generator reshaped?)');
  process.exit(1);
}
const families = [...familiesMatch[1].matchAll(/"([\w-]+)":\s*\[/g)].map(m => m[1]);
if (families.length === 0) {
  console.error('check_icons: parsed 0 families out of filetypes.js — regex or generated file broke');
  process.exit(1);
}
missingFamilies = [...families, ...REQUIRED_FOLDER_SYMBOLS].filter(f => !symbolIds.has(`fp-ft-${f}`));

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

if (undeclaredTableValues.length) {
  failed = true;
  console.error('check_icons: icon-table value(s) not declared in icons.js FP_DYNAMIC_ICON_SYMBOLS:');
  for (const v of undeclaredTableValues) console.error(`  ${v.site} -> ${v.name}`);
}

if (missingFamilies.length) {
  failed = true;
  console.error(`check_icons: ${missingFamilies.length} file-type family/folder symbol(s) have no fp-ft-<name> sprite symbol —`);
  console.error(`  missing: ${missingFamilies.join(', ')}`);
  console.error('  author frontend/assets/icons/filetypes/<name>.svg, then re-run "node scripts/build_icons.js"');
}

if (failed) process.exit(1);
console.log(`check_icons: ok (${symbolIds.size} sprite symbols, ${referencedNames.size} distinct references resolved, ` +
  `${dynamicSymbols.size} dynamic symbols declared (${tableValues.length} table values), ` +
  `${families.length} file-type families + ${REQUIRED_FOLDER_SYMBOLS.length} folder variants covered, 0 raw <svg> outside the sprite)`);
