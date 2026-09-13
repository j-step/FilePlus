/**
 * FilePlus icon sprite helpers. Loaded right after icons-sprite.js (which
 * defines FP_ICON_SPRITE — see scripts/build_icons.js) and before every
 * other frontend/src module, so icon()/iconFor() are safe to call from any
 * later file's own top level (const FOO = icon('...') included).
 *
 * fpInstallSprite() inserts the sprite SVG once at the top of <body>. It
 * runs twice, both no-ops the second time (installed flag + a duplicate-id
 * guard): once synchronously below if <body> already exists (the case for
 * a classic <script> tag placed at the end of the document, after <body>'s
 * static markup — so static index.html markup can reference `#fp-*` symbols
 * directly, e.g. <svg class="fp-icon"><use href="#fp-home"></use></svg>,
 * and the sprite is already in the DOM before first paint), and again from
 * app.js's DOMContentLoaded handler as a belt-and-braces guard.
 */
let _fpSpriteInstalled = false;
function fpInstallSprite() {
  if (_fpSpriteInstalled || document.getElementById('fp-icon-sprite')) {
    _fpSpriteInstalled = true;
    return;
  }
  if (typeof FP_ICON_SPRITE !== 'string' || !document.body) return;
  const wrap = document.createElement('div');
  wrap.id = 'fp-icon-sprite';
  wrap.style.display = 'none';
  wrap.innerHTML = FP_ICON_SPRITE;
  document.body.insertBefore(wrap, document.body.firstChild);
  _fpSpriteInstalled = true;
}

/** Markup for one sprite-backed chrome icon. `cls` is appended to the class
 * list (e.g. a size modifier like 'fp-icon--20' or a component hook class). */
function icon(name, cls = '') {
  return `<svg class="fp-icon ${cls}" aria-hidden="true"><use href="#fp-${name}"></use></svg>`;
}

/** Row/tile icon for a file-system entry. `entry` is the shape used
 * throughout browser.js/home.js/app.js: {name, is_dir, ext, path, modified}.
 * `size` picks the .fp-icon--N modifier (default 16, the file-list row size).
 *
 * Task 6 will branch on window.__fpConfig['ui.icon_source'] here to pull a
 * real Windows shell icon (see backend/bridge icon endpoints landed in Stage
 * 2C Task 4) when the user has that setting on; for now every entry gets its
 * sprite family icon regardless of the setting, and folders always get
 * 'fp-folder' — there is no per-folder Windows icon to source (custom
 * folder icons are out of scope; see fileplus-feature-list.md).
 */
function iconFor(entry, size = 16) {
  const cls = `fp-icon--${size}`;
  if (!entry || entry.is_dir) return icon('folder', cls);
  return icon(fpFamilyIconFor(entry.ext), cls);
}

/** Family -> chrome-icon-name fallback used by iconFor() until Task 6 adds
 * real `fp-ft-<family>` file-type glyphs and extends this. Coarse but better
 * than a single generic icon for every file. */
function fpFamilyIconFor(ext) {
  const group = typeof fpTypeGroupFor === 'function' ? fpTypeGroupFor(ext, false) : 'other';
  if (group === 'image') return 'image';
  return 'file';
}

// Install as early as possible. index.html loads every frontend/src module
// as a classic, parser-blocking <script src> placed inside <body> — by the
// time THIS script tag runs, the parser has already created the <body>
// element (document.body is truthy) even though document.readyState is
// still 'loading' (parsing hasn't reached </html> yet) and it hasn't
// finished parsing every element after this tag. Check document.body
// itself, not readyState, so the sprite installs synchronously at that
// point rather than waiting for DOMContentLoaded. The DOMContentLoaded
// fallback below only matters if this script were ever loaded before
// <body> starts (e.g. moved into <head>) — a no-op belt-and-braces path.
if (document.body) {
  fpInstallSprite();
} else {
  document.addEventListener('DOMContentLoaded', fpInstallSprite);
}
