/**
 * FilePlus drag and drop, rebuilt on POINTER EVENTS (Stage 2C Task 12).
 *
 * Native HTML5 drag and drop (what Task 4 shipped) cannot do three things the
 * design asks for, so it is gone entirely:
 *   1. A badge that follows the pointer reading "Move file" / "Copy 3 files"
 *      — the HTML5 drag image is a static bitmap snapshotted at dragstart and
 *      cannot be re-rendered while the drag is in flight.
 *   2. Shift/Ctrl changing the operation LIVE mid-drag — dragover only reports
 *      modifiers to set dropEffect, and the OS drag cursor (not our DOM) is
 *      what the user actually reads.
 *   3. Spring-loaded folders and right-click-to-go-up — a navigation that
 *      re-renders the list under the pointer aborts a native drag, and the
 *      right button is owned by the OS drag loop during one.
 *
 * So: pointerdown on a row arms a session, 6 px of movement starts it,
 * #list-scroll takes pointer capture (so moves/ups keep arriving even once
 * the pointer leaves the list), and elementFromPoint resolves the drop target
 * under the pointer on every move. Everything else — the badge, the target
 * highlight, the spring timer — is plain DOM we own.
 *
 * Loads AFTER browser.js (it reads browserState/nav/loadDirectory/navUp/
 * getSelectedPaths/ensureRowSelected at call time) and BEFORE app.js, whose
 * symbols (showToast) are only ever touched from inside a function.
 */

// ── Tunables ─────────────────────────────────────────────────────────────────
// 6 px: far enough that a click with a shaky hand is still a click, close
// enough that a deliberate drag feels immediate. Matches the distance
// Explorer itself uses (SM_CXDRAG is 4 px, but a 96 dpi mouse overshoots).
const DRAG_THRESHOLD_PX = 6;
// Spring-load: hover a folder this long, while still dragging, to descend
// into it. 700 ms is the Finder/Explorer figure — long enough that merely
// crossing a folder on the way somewhere else never triggers it.
const SPRING_DELAY_MS = 700;
// The pulse that says "descending now" (.fp-spring) plays before the
// navigation so the jump is never unexplained. It lasts --motion-spring
// (styles.css, read through fpMotionMs); with animations off there is no
// pulse and no wait at all.

/**
 * The whole drag, in one object. Three states, read off two fields:
 *   idle     — pointerId === null
 *   armed    — pointerId !== null, active === false  (pressed, under threshold)
 *   dragging — active === true                        (badge up, targets live)
 *
 * `paths` is snapshotted at the moment the threshold is crossed, NOT at
 * pointerdown: a spring-load navigation re-renders the list mid-drag and
 * blows the selection away, so the drag has to carry its own copy.
 */
const dragSession = {
  active: false,
  paths: [],
  sourceDir: null,
  pointerId: null,
  startX: 0,
  startY: 0,
  target: null,          // {kind, path, el, cls} — see resolveDropTarget
  mode: 'move',          // 'move' | 'copy'
  springTimer: null,
  springTarget: null,
  // Beyond the declared shape, all internal bookkeeping:
  pressPath: null,       // the row physically pressed (joins the selection at the threshold)
  x: 0, y: 0,            // last pointer position — a modifier keypress repaints the badge with no move
  ctrl: false, shift: false,
  captureEl: null,       // element holding setPointerCapture, for the release
  pulseTimer: null,
  firstEntry: null,      // /fs/list entry behind paths[0], for the badge icon
};

// True between the right button going down and coming up during a session, so
// one press navigates up exactly once, however many events report it.
let _rightPressDown = false;
// A drag's pointerup synthesizes a click; swallow exactly that one (same
// instant, same place) so releasing over a folder row does not also
// re-select — or, in single-click mode, open — it.
let _swallowClickUntil = 0;
let _swallowClickAt = null;
// A pointer whose session was cancelled (Escape) while the button is still
// physically down: its eventual pointerup must be consumed silently.
let _deadPointerId = null;
// Why the last resolve refused a target ('descendant' etc.), so a drop onto a
// folder that is inside what's being dragged can still explain itself.
let _lastViolation = null;

// ── Volume / validity ────────────────────────────────────────────────────────

/** The volume root of an absolute Windows path: "c:" for C:\x\y, or
 *  "\\server\share" for a UNC path. null when it is neither (a sentinel like
 *  the "home" crumb), which sameVolume treats as "don't guess". */
function volumeRootOf(p) {
  const s = String(p || '');
  const unc = s.match(/^[\\\/]{2}[^\\\/]+[\\\/][^\\\/]+/);
  if (unc) return unc[0].replace(/\//g, '\\').toLowerCase();
  const drive = s.match(/^[A-Za-z]:/);
  return drive ? drive[0].toLowerCase() : null;
}

/** Do `a` and `b` live on the same volume? Drives the Move-vs-Copy default:
 *  a same-volume move is a rename (instant, reversible), a cross-volume one
 *  is a copy+delete, which is why Explorer defaults the latter to Copy. When
 *  either side has no recognisable root we answer true — "same volume" is
 *  the conservative answer, since it defaults to Move, which is undoable. */
function sameVolume(a, b) {
  const ra = volumeRootOf(a);
  const rb = volumeRootOf(b);
  if (!ra || !rb) return true;
  return ra === rb;
}

/** Why `destDir` is not a valid drop target for `paths`, or null if it's fine.
 *  (Moved here verbatim from browser.js's HTML5 implementation, Task 4.)
 *  'self'       — destDir is (case-insensitively) one of the dragged paths
 *  'current'    — destDir is the directory already open
 *  'descendant' — destDir is nested inside one of the dragged folders
 *
 *  'current' is decided from the DRAGGED ITEMS' OWN parents, never from the
 *  folder currently displayed. Comparing against browserState.path was wrong
 *  in both directions: in search mode the listing is not one directory at all
 *  (results scatter across subfolders, and a legitimate drop of a result onto
 *  the search root was refused), and in browse mode a spring-load navigation
 *  moves browserState.path to the folder just entered — which made the folder
 *  the user had just sprung into the one place the drag could no longer land,
 *  while the parent crumb, no longer "current", accepted a move of every item
 *  into the folder it already sat in (pass 2 #197). Per-item parents say
 *  exactly what the rule means: a no-op only when the whole set is already
 *  sitting in destDir. */
function dropViolation(destDir, paths) {
  if (!destDir || !paths || !paths.length) return 'self';
  const norm = p => String(p).replace(/[\\\/]+$/, '').toLowerCase();
  const destLower = norm(destDir);
  if (paths.some(p => norm(p) === destLower)) return 'self';
  const alreadyThere = paths.every(p => norm(parentOfPath(p)) === destLower);
  if (alreadyThere) return 'current';
  if (paths.some(p => destLower.startsWith(norm(p) + '\\'))) return 'descendant';
  return null;
}

/** Absolute-path sanity check. The Home breadcrumb crumb carries
 *  data-path="home" and sidebar rows can carry other sentinels — neither is
 *  a directory anything can be dropped into. */
function isAbsolutePath(p) {
  return /^([A-Za-z]:|[\\\/]{2}[^\\\/])/.test(String(p || ''));
}

// ── Target resolution ────────────────────────────────────────────────────────

/**
 * What is under (x, y), if it can accept this drag? Returns
 * {kind, path, el, cls} or null.
 *
 * elementFromPoint rather than the event's own target because pointer capture
 * retargets every pointermove to #list-scroll — the event target during a
 * drag is useless, the coordinates are the only truth. #drag-badge sits under
 * the pointer the whole time and is pointer-events:none for exactly this
 * reason.
 *
 * 'up' is the toolbar Up button: a drop target in its own right (drop there to
 * move a level up) and, more usefully, a spring target — hover it to climb out
 * of a folder you dragged into.
 */
function resolveDropTarget(x, y) {
  _lastViolation = null;
  const hit = document.elementFromPoint(x, y);
  if (!hit || !hit.closest) return null;

  let kind = null, path = null, el = null, cls = null;

  const upBtn = hit.closest('[data-action="nav-up"]');
  if (upBtn) {
    // In search mode the button is still enabled but it no longer means "the
    // parent of the folder on screen" — navUp() there leaves the results
    // (exitSearchResults), while browserState.parent is the parent of the
    // invisible pre-search folder. One gesture, two destinations: refuse the
    // drop rather than move files somewhere the user never saw (pass 2 #49).
    if (browserState.mode === 'search') return null;
    if (upBtn.disabled || browserState.isRoot || !browserState.parent) return null;
    kind = 'up'; path = browserState.parent; el = upBtn; cls = 'fp-icon-btn--drag-target';
  }
  if (!kind) {
    const row = hit.closest('#list-scroll .fp-row[data-type="folder"][data-path]');
    if (row) { kind = 'folder'; path = row.dataset.path; el = row; cls = 'fp-row--drag-target'; }
  }
  if (!kind) {
    const item = hit.closest('.fp-sidebar__item[data-path]');
    if (item) { kind = 'sidebar'; path = item.dataset.path; el = item; cls = 'fp-sidebar__item--drag-target'; }
  }
  if (!kind) {
    const crumb = hit.closest('.fp-breadcrumb__crumb[data-path]');
    if (crumb) { kind = 'crumb'; path = crumb.dataset.path; el = crumb; cls = 'fp-breadcrumb__crumb--drag-target'; }
  }
  // The listing's own background (blank space, or a file row — neither is a
  // container) resolves to the folder ON SCREEN. Without it the obvious place
  // to release after a spring-load — inside the folder you just descended
  // into — was the one place a drop did nothing at all (pass 2 #197). Not in
  // search mode: the results are not one directory, and browserState.path is
  // a folder the user cannot see. dropViolation still makes this a silent
  // no-op when every dragged item already lives there.
  if (!kind && browserState.mode !== 'search') {
    const list = hit.closest('#list-scroll');
    if (list && browserState.path) {
      kind = 'list'; path = browserState.path; el = list; cls = 'fp-list--drag-target';
    }
  }
  if (!kind || !isAbsolutePath(path)) return null;

  const violation = dropViolation(path, dragSession.paths);
  if (violation) { _lastViolation = violation; return null; }
  return { kind, path, el, cls };
}

/**
 * Which operation this drop performs. Shift forces Move, Ctrl forces Copy
 * (Shift wins if somehow both are held — Move is the reversible one). With
 * neither held it is the same rule Explorer uses: same volume moves, a
 * different volume copies, because a cross-volume "move" would delete the
 * original after a long copy.
 */
function dropModeFor(paths, destPath, { ctrl = false, shift = false } = {}) {
  if (shift) return 'move';
  if (ctrl) return 'copy';
  if (!paths || !paths.length || !destPath) return 'move';
  return sameVolume(paths[0], destPath) ? 'move' : 'copy';
}

// ── Badge ────────────────────────────────────────────────────────────────────

/**
 * Positions and re-labels #drag-badge. Called on every pointermove and on
 * every modifier keypress, so the wording tracks what a release would
 * actually do at that instant.
 *
 * The icon is re-rendered only when the dragged item changes (never on a
 * plain move): in Windows-icon mode iconFor() returns a lazily-resolved
 * <img data-win-icon>, which icons.js's MutationObserver picks up and
 * resolves over the shell bridge — re-writing that markup sixty times a
 * second would queue a shell request per frame.
 */
function updateBadge(x, y) {
  const badge = document.getElementById('drag-badge');
  if (!badge) return;
  const textEl = badge.querySelector('.fp-drag-badge__text');
  const iconEl = badge.querySelector('.fp-drag-badge__icon');

  const n = dragSession.paths.length;
  const verb = dragSession.mode === 'copy' ? 'Copy' : 'Move';
  // Folders count as "files" in the wording — "Move 3 files" is what the user
  // reads for any mixed selection, rather than "3 items" or a split count.
  const noun = n === 1 ? 'file' : `${n} files`;
  if (textEl) textEl.textContent = `${verb} ${noun}`;

  if (iconEl) {
    const key = dragSession.paths[0] || '';
    if (iconEl.dataset.for !== key) {
      iconEl.dataset.for = key;
      iconEl.innerHTML = dragSession.firstEntry ? iconFor(dragSession.firstEntry, 16) : '';
    }
  }

  badge.hidden = false;
  // Offset down-right of the pointer so the badge never covers the drop
  // target itself, then clamped so it cannot push the window's scroll range
  // out near the right or bottom edge.
  const w = badge.offsetWidth || 120;
  const h = badge.offsetHeight || 24;
  const left = Math.min(x + 14, Math.max(0, window.innerWidth - w - 4));
  const top = Math.min(y + 14, Math.max(0, window.innerHeight - h - 4));
  badge.style.left = `${left}px`;
  badge.style.top = `${top}px`;
}

function hideBadge() {
  const badge = document.getElementById('drag-badge');
  if (!badge) return;
  badge.hidden = true;
  badge.style.left = '-9999px';
  badge.style.top = '-9999px';
}

// ── Spring-loaded folders ────────────────────────────────────────────────────

/** Arms the 700 ms hover-to-descend timer for `target`. Called only when the
 *  target CHANGES, so holding still over one folder runs the timer once
 *  rather than restarting it on every pointermove. */
function beginSpring(target) {
  cancelSpring();
  if (!target || !target.el) return;
  dragSession.springTarget = target;
  dragSession.springTimer = setTimeout(() => {
    dragSession.springTimer = null;
    const t = dragSession.springTarget;
    if (!t || !dragSession.active) return;
    const motion = fpMotionOn();
    if (t.el && t.el.isConnected && motion) {
      t.el.classList.add('fp-spring');
    }
    dragSession.pulseTimer = setTimeout(() => {
      dragSession.pulseTimer = null;
      if (t.el) t.el.classList.remove('fp-spring');
      if (!dragSession.active) return;
      // The listing (or the whole screen, for a sidebar target) re-renders
      // under a pointer that is still down. The session deliberately
      // survives it: only the resolved target is dropped, and the next
      // pointermove re-resolves against whatever is now on screen. Nothing
      // re-resolves without a move, which is also what stops a held pointer
      // from tunnelling through a whole folder tree by itself.
      clearTargetHighlight();
      dragSession.target = null;
      dragSession.springTarget = null;
      if (t.kind === 'up') navUp();
      else loadDirectory(t.path);
    }, motion ? fpMotionMs('--motion-spring') : 0);
  }, SPRING_DELAY_MS);
}

function cancelSpring() {
  if (dragSession.springTimer) { clearTimeout(dragSession.springTimer); dragSession.springTimer = null; }
  if (dragSession.pulseTimer) { clearTimeout(dragSession.pulseTimer); dragSession.pulseTimer = null; }
  if (dragSession.springTarget && dragSession.springTarget.el) {
    dragSession.springTarget.el.classList.remove('fp-spring');
  }
  dragSession.springTarget = null;
}

// ── Session lifecycle ────────────────────────────────────────────────────────

function clearTargetHighlight() {
  const t = dragSession.target;
  if (t && t.el && t.cls) t.el.classList.remove(t.cls);
}

/** Tears the session down to idle without performing anything. Every exit
 *  path (Escape, pointercancel, window blur, a drop onto nothing, and
 *  finishDrop itself) funnels through here, so there is exactly one place
 *  that can leave a stray highlight, timer or capture behind. */
function cancelDrag() {
  cancelSpring();
  clearTargetHighlight();
  hideBadge();
  if (dragSession.captureEl && dragSession.pointerId !== null) {
    try { dragSession.captureEl.releasePointerCapture(dragSession.pointerId); } catch (_) { /* already released */ }
  }
  document.body.classList.remove('is-dragging');
  dragSession.active = false;
  dragSession.paths = [];
  dragSession.sourceDir = null;
  dragSession.pointerId = null;
  dragSession.startX = 0;
  dragSession.startY = 0;
  dragSession.target = null;
  dragSession.mode = 'move';
  dragSession.pressPath = null;
  dragSession.ctrl = false;
  dragSession.shift = false;
  dragSession.captureEl = null;
  dragSession.firstEntry = null;
  _rightPressDown = false;
  _lastViolation = null;
}

/** Performs the drop under the pointer, then clears. fileops.moveTo already
 *  owns the conflict modal, the operations-log entry and the undo snackbar —
 *  this only decides WHAT and WHERE. */
function finishDrop() {
  const target = dragSession.target;
  const paths = dragSession.paths.slice();
  const mode = dragSession.mode;
  const violation = _lastViolation;
  cancelDrag();
  if (!target) {
    // Dropping a folder onto something inside itself is the one refusal
    // worth explaining — every other miss (open space, the folder already
    // open, the dragged item itself) is a silent no-op.
    if (violation === 'descendant') showToast('Cannot move a folder into itself', 'error');
    return;
  }
  if (!paths.length) return;
  fileops.moveTo(paths, target.path, mode === 'copy').catch(fileopsReported);
}

/** Arms the one-shot click swallow for the click the browser is about to
 *  synthesize from this pointerup. */
function armClickSwallow(x, y) {
  _swallowClickUntil = Date.now() + 300;
  _swallowClickAt = { x, y };
}

/** Recomputes mode + badge for the current pointer position and modifiers.
 *  Split out because both a pointermove and a bare Shift/Ctrl keypress need
 *  exactly this. */
function refreshDragMode() {
  dragSession.mode = dropModeFor(
    dragSession.paths,
    dragSession.target ? dragSession.target.path : null,
    { ctrl: dragSession.ctrl, shift: dragSession.shift },
  );
  updateBadge(dragSession.x, dragSession.y);
}

/** armed → dragging. Snapshots the selection (joining the pressed row to it
 *  if it was not already part of it), takes pointer capture, and paints the
 *  badge. */
function startDragging(e) {
  if (dragSession.pressPath && typeof ensureRowSelected === 'function') {
    ensureRowSelected(dragSession.pressPath);
  }
  const paths = typeof getSelectedPaths === 'function' ? getSelectedPaths() : [];
  if (!paths.length) { cancelDrag(); return; }

  dragSession.paths = paths;
  dragSession.sourceDir = browserState.path;
  dragSession.active = true;
  dragSession.ctrl = e.ctrlKey;
  dragSession.shift = e.shiftKey;

  // Badge icon: the /fs/list entry behind paths[0], snapshotted now because a
  // spring-load navigation replaces browserState.entries mid-drag.
  const firstName = String(paths[0]).split(/[\\\/]/).filter(Boolean).pop();
  const entry = (browserState.entries || []).find(en => en.name === firstName);
  dragSession.firstEntry = entry
    ? { ...entry, path: paths[0] }
    : { name: firstName, is_dir: false, ext: '', path: paths[0] };

  // Capture on #list-scroll (not the row — the row is destroyed by any
  // spring-load re-render, and losing the capture element mid-drag would
  // silently stop every further pointermove).
  const captureEl = document.getElementById('list-scroll') || document.body;
  try { captureEl.setPointerCapture(dragSession.pointerId); dragSession.captureEl = captureEl; }
  catch (_) { dragSession.captureEl = null; }

  document.body.classList.add('is-dragging');
  // body.is-dragging's user-select:none and pointermove's own preventDefault
  // stop a selection GROWING from here on, but the first 6 px — the press
  // that turned out to be a drag — can already have painted one across a row
  // name. Drop it, or it stays highlighted behind the whole drag.
  const sel = typeof window.getSelection === 'function' ? window.getSelection() : null;
  if (sel && !sel.isCollapsed) sel.removeAllRanges();
  refreshDragMode();
}

/**
 * The right button, pressed mid-drag, climbs one folder — the counterpart to
 * spring-loading down.
 *
 * Fires once per press. It has to be idempotent because the same physical
 * press reaches us up to three ways: per the Pointer Events spec's chorded-
 * button rule, pressing a SECOND button while one is already down fires
 * `pointermove` (with button 2 / buttons & 2), NOT `pointerdown` — but the
 * mousedown compatibility event still arrives, and a non-chorded press (the
 * left button released first) really does fire pointerdown. _rightPressDown
 * collapses all of them into one navigation, and is cleared the moment the
 * right button is seen to be up again.
 */
function dragNavUp() {
  if (_rightPressDown) return;
  _rightPressDown = true;
  cancelSpring();
  clearTargetHighlight();
  dragSession.target = null;
  navUp();
  refreshDragMode();
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function initDragDrop() {
  const listScroll = document.getElementById('list-scroll');
  if (!listScroll) return;

  // idle → armed. Selection is deliberately NOT changed here: a plain click
  // must keep its existing semantics (browser.js's click handler owns those),
  // and only crossing the threshold below promotes the press to a drag.
  listScroll.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('input, textarea, .fp-row__rename')) return; // inline rename in progress
    const row = e.target.closest('.fp-row[data-path]');
    if (!row) return;
    if (dragSession.pointerId !== null) cancelDrag();
    // A mouse keeps the same pointerId for its whole life, so a _deadPointerId
    // left over from an Escape whose release never came back (the button let
    // go outside the window) would otherwise eat THIS gesture's drop.
    _deadPointerId = null;
    dragSession.pointerId = e.pointerId;
    dragSession.startX = e.clientX;
    dragSession.startY = e.clientY;
    dragSession.x = e.clientX;
    dragSession.y = e.clientY;
    dragSession.pressPath = row.dataset.path;
  });

  window.addEventListener('pointermove', e => {
    if (dragSession.pointerId === null || e.pointerId !== dragSession.pointerId) return;
    dragSession.x = e.clientX;
    dragSession.y = e.clientY;

    if (!dragSession.active) {
      const dx = e.clientX - dragSession.startX;
      const dy = e.clientY - dragSession.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      startDragging(e);
      if (!dragSession.active) return;
    }

    // Chorded right button (see dragNavUp): this is the event the spec
    // actually delivers for a right press during a left drag. Return
    // afterwards rather than falling through to resolveDropTarget — navUp()'s
    // re-listing has not landed yet, so anything under the pointer right now
    // is the folder we are leaving.
    if (e.buttons & 2) { dragNavUp(); return; }
    _rightPressDown = false;

    dragSession.ctrl = e.ctrlKey;
    dragSession.shift = e.shiftKey;

    const next = resolveDropTarget(e.clientX, e.clientY);
    const prev = dragSession.target;
    const changed = (next && prev) ? (next.el !== prev.el) : (next !== prev);
    if (changed) {
      clearTargetHighlight();
      dragSession.target = next;
      if (next) next.el.classList.add(next.cls);
      // Re-arm the hover timer only on a real target change, so standing
      // still over one folder springs once at 700 ms rather than never.
      // The list background is never a spring target — "descend into the
      // folder already open" is a no-op that would reload the listing under
      // the pointer every 700 ms.
      if (next && next.kind !== 'list') beginSpring(next); else cancelSpring();
    }
    refreshDragMode();
    e.preventDefault();
  });

  window.addEventListener('pointerup', e => {
    // A session Escape cancelled while the button stayed down: eat the
    // release (and the click it synthesizes) rather than dropping anything.
    if (_deadPointerId !== null && e.pointerId === _deadPointerId) {
      _deadPointerId = null;
      armClickSwallow(e.clientX, e.clientY);
      return;
    }
    if (dragSession.pointerId === null || e.pointerId !== dragSession.pointerId) return;
    if (e.button === 2) { _rightPressDown = false; return; } // right button released mid-drag
    if (!dragSession.active) { cancelDrag(); return; }        // never crossed the threshold: a plain click
    armClickSwallow(e.clientX, e.clientY);
    finishDrop();
  });

  window.addEventListener('pointercancel', e => {
    if (dragSession.pointerId === null || e.pointerId !== dragSession.pointerId) return;
    cancelDrag();
  });

  // A lost window (Alt+Tab, a shell dialog) can never leave a half-drag armed.
  window.addEventListener('blur', () => { if (dragSession.pointerId !== null) cancelDrag(); });

  // Right button down mid-drag → up one folder. Both the pointer event and
  // its mouse compatibility event are wired (Chromium dispatches both for the
  // same press, and which one arrives first depends on capture state);
  // _rightPressDown makes the pair idempotent.
  const onRightDown = e => {
    if (!dragSession.active || e.button !== 2) return;
    e.preventDefault();
    e.stopPropagation();
    dragNavUp();
  };
  window.addEventListener('pointerdown', onRightDown, true);
  window.addEventListener('mousedown', onRightDown, true);
  window.addEventListener('mouseup', e => { if (e.button === 2) _rightPressDown = false; }, true);

  // No context menu while dragging — the right button means "go up" for the
  // duration. Capture phase so app.js's own document-level contextmenu
  // listener (which opens the menu and can clear the selection) never runs.
  document.addEventListener('contextmenu', e => {
    if (!dragSession.active) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // pointerup synthesizes a click on the capture element; swallow exactly the
  // one that ends a drag so releasing over a folder row does not also select
  // (or, in single-click mode, open) it. Matched on BOTH time and place so a
  // genuine click elsewhere, moments later, is never eaten by mistake.
  document.addEventListener('click', e => {
    if (!_swallowClickUntil) return;
    const stale = Date.now() > _swallowClickUntil;
    const elsewhere = _swallowClickAt
      && Math.hypot(e.clientX - _swallowClickAt.x, e.clientY - _swallowClickAt.y) > 8;
    if (stale) { _swallowClickUntil = 0; _swallowClickAt = null; return; }
    // A genuine click elsewhere also disarms the swallow — otherwise a later
    // click back at the drop site, still inside the 300ms window, would be
    // eaten too even though it's a separate user action (Task 15 carry-over).
    if (elsewhere) { _swallowClickUntil = 0; _swallowClickAt = null; return; }
    _swallowClickUntil = 0;
    _swallowClickAt = null;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Escape cancels outright; Shift/Ctrl retarget the operation live, without
  // needing the pointer to move at all.
  window.addEventListener('keydown', e => {
    if (dragSession.pointerId === null) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // The button is still physically down — remember the pointer so its
      // release performs nothing rather than dropping where it happens to be.
      _deadPointerId = dragSession.pointerId;
      cancelDrag();
      return;
    }
    if (!dragSession.active) return;
    if (e.key === 'Shift' || e.key === 'Control') {
      dragSession.shift = e.shiftKey;
      dragSession.ctrl = e.ctrlKey;
      refreshDragMode();
    }
  }, true);

  window.addEventListener('keyup', e => {
    if (!dragSession.active) return;
    if (e.key === 'Shift' || e.key === 'Control') {
      dragSession.shift = e.shiftKey;
      dragSession.ctrl = e.ctrlKey;
      refreshDragMode();
    }
  }, true);
}
