#!/usr/bin/env node
// scripts/build_icons.js — generates frontend/src/icons-sprite.js from
// Microsoft's Fluent UI System Icons (frontend/node_modules/@fluentui/svg-icons)
// plus a small set of hand-authored FilePlus brand symbols and the file-type
// family glyphs in frontend/assets/icons/filetypes (Task 6).
//
// Output: a single `const FP_ICON_SPRITE = "<svg ...>...</svg>";` string,
// installed once at the top of <body> by fpInstallSprite() (frontend/src/icons.js).
// Every symbol id is `fp-<name>` (chrome icons) or `fp-ft-<family>` (filetype
// icons). Run: `node scripts/build_icons.js` from the repo root.
//
// ATTRIBUTION (propagated verbatim into the generated sprite's header):
// Icon data: Fluent UI System Icons, © Microsoft Corporation, MIT License
// (github.com/microsoft/fluentui-system-icons); file-type family icons © FilePlus
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FLUENT_DIR = path.join(ROOT, 'frontend', 'node_modules', '@fluentui', 'svg-icons', 'icons');
const FILETYPES_DIR = path.join(ROOT, 'frontend', 'assets', 'icons', 'filetypes');
const OUT_FILE = path.join(ROOT, 'frontend', 'src', 'icons-sprite.js');

// fpName -> source file under FLUENT_DIR. Real @fluentui/svg-icons filenames
// (checked with `ls`) do NOT carry the "ic_fluent_" prefix used in the
// upstream Fluent System Icons repo/Figma library — e.g. "home_20_regular.svg",
// not "ic_fluent_home_20_regular.svg". All 20px "_regular" weight except
// star-filled (a deliberate filled/outline pair with `star`).
const CHROME_ICONS = {
  // ---- brief-specified names (verbatim — later tasks reference these) ----
  home: 'home_20_regular.svg',
  desktop: 'desktop_20_regular.svg',
  download: 'arrow_download_20_regular.svg',
  screenshots: 'image_multiple_20_regular.svg',
  folder: 'folder_20_regular.svg',
  'folder-open': 'folder_open_20_regular.svg',
  pin: 'pin_20_regular.svg',
  drive: 'hard_drive_20_regular.svg',
  scan: 'document_search_20_regular.svg',
  'review-bin': 'tray_item_remove_20_regular.svg',
  everything: 'folder_link_20_regular.svg',
  settings: 'settings_20_regular.svg',
  sparkle: 'sparkle_20_regular.svg',
  'arrow-left': 'arrow_left_20_regular.svg',
  'arrow-right': 'arrow_right_20_regular.svg',
  'arrow-up': 'arrow_up_20_regular.svg',
  refresh: 'arrow_sync_20_regular.svg',
  'view-grid': 'grid_20_regular.svg',
  'view-list': 'text_bullet_list_ltr_20_regular.svg',
  sort: 'arrow_sort_20_regular.svg',
  inspector: 'panel_right_20_regular.svg',
  'theme-dark': 'weather_moon_20_regular.svg',
  'theme-light': 'weather_sunny_20_regular.svg',
  search: 'search_20_regular.svg',
  open: 'open_20_regular.svg',
  reveal: 'folder_arrow_right_20_regular.svg',
  star: 'star_20_regular.svg',
  'star-off': 'star_off_20_regular.svg',
  tag: 'tag_20_regular.svg',
  copy: 'copy_20_regular.svg',
  cut: 'cut_20_regular.svg',
  paste: 'clipboard_paste_20_regular.svg',
  rename: 'rename_20_regular.svg',
  delete: 'delete_20_regular.svg',
  info: 'info_20_regular.svg',
  'chevron-down': 'chevron_down_20_regular.svg',
  'chevron-right': 'chevron_right_20_regular.svg',
  close: 'dismiss_20_regular.svg',
  add: 'add_20_regular.svg',
  check: 'checkmark_20_regular.svg',
  warning: 'warning_20_regular.svg',
  error: 'error_circle_20_regular.svg',
  history: 'history_20_regular.svg',
  filter: 'filter_20_regular.svg',
  // brief lists "more" with no explicit filename; this codebase's only "more
  // actions" affordances (Review Bin row overflow, Inspector "More actions")
  // are a vertical 3-dot kebab, not a horizontal one — substituted accordingly.
  more: 'more_vertical_20_regular.svg',
  undo: 'arrow_undo_20_regular.svg',
  redo: 'arrow_redo_20_regular.svg',
  'new-tab': 'tab_add_20_regular.svg',
  file: 'document_20_regular.svg',

  // ---- Task 5 additions beyond the brief's list (see task-5-report.md) ----
  // Titlebar window controls (custom 12x12 glyphs in the old markup) —
  // dismiss/"close" already covered above by the brief's own `close` entry.
  'window-minimize': 'subtract_20_regular.svg',
  'window-maximize': 'maximize_20_regular.svg',
  // Sidebar collapse points left; brief only lists chevron-down/right.
  'chevron-left': 'chevron_left_20_regular.svg',
  // File Tree canvas "collapse to depth 3" control.
  'chevron-up': 'chevron_up_20_regular.svg',
  // File Tree canvas zoom controls.
  'zoom-in': 'zoom_in_20_regular.svg',
  'zoom-out': 'zoom_out_20_regular.svg',
  // File Tree canvas "Fit to view".
  'fit-view': 'scale_fit_20_regular.svg',
  // File Tree canvas "Add folder" (distinct from plain `folder`).
  'folder-add': 'folder_add_20_regular.svg',
  // Scan Progress "toggle hidden files" + Settings API-key visibility toggle.
  eye: 'eye_20_regular.svg',
  // File Tree canvas "Toggle AI-proposed changes" (was a 3-line+check glyph).
  changes: 'task_list_square_ltr_20_regular.svg',
  // Home Favorites row: filled/outline pair with `star` for the favorited state.
  'star-filled': 'star_20_filled.svg',
  // Settings "indexed drives" row + Everything Folder generic-file rows used
  // a hand-drawn photo/mountain glyph for non-text files.
  image: 'image_20_regular.svg',
  // Scan Progress "nothing is being moved" reassurance banner (was a padlock).
  lock: 'lock_closed_20_regular.svg',
  // Scan duplicate-group header leading icon (was an outward-chevrons glyph).
  compare: 'arrow_swap_20_regular.svg',
  // Settings "Browser download redirect" row icon (was a globe glyph).
  globe: 'globe_20_regular.svg',
  // Settings file-type table row actions (was a pencil glyph).
  edit: 'edit_20_regular.svg',
  // Sidebar "File Tree" nav item (was 4 connected squares).
  'file-tree': 'flowchart_20_regular.svg',
  // Home "Shared" pane empty state (was a circle+arrow glyph; feature not
  // built yet, "Coming in a future version").
  'coming-soon': 'arrow_circle_right_20_regular.svg',
};

// Hand-authored, non-Fluent symbols: the FilePlus brand mark (a literal "+"
// glyph — the wordmark pun on "Plus"). `brand` is the plain cross used inside
// a `.fp-brand` container that supplies the accent-coloured background via
// CSS; `brand-badge` bakes its own accent-square background in for the one
// place (sidebar collapsed toggle) that isn't wrapped in `.fp-brand`.
const CUSTOM_SYMBOLS = {
  brand: '<path d="M4 10h12M10 4v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  'brand-badge':
    '<rect x="2" y="2" width="20" height="20" rx="5" fill="var(--accent)" opacity="0.85"/>' +
    '<path d="M8 12h8M12 8v8" stroke="var(--text-on-accent)" stroke-width="1.8" stroke-linecap="round"/>',
};
const CUSTOM_VIEWBOX = {
  brand: '0 0 20 20',
  'brand-badge': '0 0 24 24',
};

function readFluentSymbol(fpName, fileName) {
  const file = path.join(FLUENT_DIR, fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`build_icons: CHROME_ICONS['${fpName}'] -> ${fileName} not found under ${FLUENT_DIR}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const viewBoxMatch = raw.match(/viewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 20 20';
  // Fluent source files are `<svg ...><path d="..." fill="#212121"/></svg>` (a
  // single path, occasionally more). Strip width/height/fill from every
  // element and force fill="currentColor" so CSS text color drives it.
  const bodyMatch = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!bodyMatch) throw new Error(`build_icons: could not parse ${file}`);
  let body = bodyMatch[1]
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace(/\sfill="(?!none")[^"]*"/g, ''); // drop explicit fills (keep fill="none" if ever present)
  return { id: `fp-${fpName}`, viewBox, body: body.trim() };
}

// A filetype SVG's fill is load-bearing (unlike a Fluent chrome icon's, which
// is always stripped down to currentColor): the family colour arrives as a
// `var(--ft-*)` token and the neutral page outline as `currentColor`, so only
// those two forms — plus the structural `fill="none"` on stroked shapes — are
// allowed through. Anything else (a stray hex left in while authoring) is
// stripped so it falls back to the CSS-driven `fill: currentColor` on .fp-icon
// rather than baking a theme-blind colour into the sprite.
const FILETYPE_FILL_OK = /^(none|currentColor|var\(--ft-[a-z0-9-]+\))$/;

function readFiletypeSymbols() {
  if (!fs.existsSync(FILETYPES_DIR)) return [];
  const files = fs.readdirSync(FILETYPES_DIR).filter(f => f.endsWith('.svg')).sort();
  return files.map(f => {
    const family = path.basename(f, '.svg');
    const raw = fs.readFileSync(path.join(FILETYPES_DIR, f), 'utf8');
    const viewBoxMatch = raw.match(/viewBox="([^"]*)"/);
    const viewBox = viewBoxMatch ? viewBoxMatch[1] : '';
    // Every family icon is authored on the same 20x20 grid — a different
    // viewBox would silently rescale one icon against all the others.
    if (viewBox !== '0 0 20 20') {
      throw new Error(`build_icons: ${f} must carry viewBox="0 0 20 20" (found "${viewBox}")`);
    }
    const bodyMatch = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
    if (!bodyMatch) throw new Error(`build_icons: could not parse ${f}`);
    // The root <svg>'s own width/height are dropped with the tag itself (only
    // the body is kept, wrapped in a <symbol>), so — unlike readFluentSymbol —
    // nothing strips width/height from the body here: on a <rect> those are
    // geometry, and removing them collapses the family colour tab to nothing.
    const body = bodyMatch[1]
      .replace(/\sfill="([^"]*)"/g, (m, value) => (FILETYPE_FILL_OK.test(value) ? m : ''))
      .trim();
    if (/<text\b/.test(body)) {
      throw new Error(`build_icons: ${f} contains <text> — family glyphs must be paths only`);
    }
    return { id: `fp-ft-${family}`, viewBox, body };
  });
}

function main() {
  const symbols = [];

  for (const [fpName, fileName] of Object.entries(CHROME_ICONS)) {
    symbols.push(readFluentSymbol(fpName, fileName));
  }
  for (const [fpName, body] of Object.entries(CUSTOM_SYMBOLS)) {
    symbols.push({ id: `fp-${fpName}`, viewBox: CUSTOM_VIEWBOX[fpName] || '0 0 20 20', body });
  }
  symbols.push(...readFiletypeSymbols());

  const symbolMarkup = symbols
    .map(s => `<symbol id="${s.id}" viewBox="${s.viewBox}">${s.body}</symbol>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbolMarkup}</svg>`;

  const out = `// GENERATED by scripts/build_icons.js from @fluentui/svg-icons (chrome icons),
// hand-authored brand symbols, and frontend/assets/icons/filetypes/*.svg (file-type
// family icons). Do not edit by hand — re-run the build script instead.
//
// Icon data: Fluent UI System Icons, © Microsoft Corporation, MIT License
// (github.com/microsoft/fluentui-system-icons); file-type family icons © FilePlus
const FP_ICON_SPRITE = ${JSON.stringify(svg)};
`;
  fs.writeFileSync(OUT_FILE, out, 'utf8');
  console.log(`build_icons: wrote ${symbols.length} symbols (${Object.keys(CHROME_ICONS).length} chrome + ${Object.keys(CUSTOM_SYMBOLS).length} brand + ${symbols.length - Object.keys(CHROME_ICONS).length - Object.keys(CUSTOM_SYMBOLS).length} filetype) to ${path.relative(ROOT, OUT_FILE)}`);
}

main();
