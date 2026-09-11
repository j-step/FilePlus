/**
 * FilePlus Home screen: Favorites unfavorite handling and Recent/Favorites
 * empty-section pruning.
 */

/**
 * Visual-only unfavorite handler for Home → Favorites rows.
 * Captures the row's parent + sibling + star-path attributes BEFORE removal so
 * the Undo affordance on the snackbar can re-insert the row at its original
 * position with the filled star restored. The snackbar respects the global
 * notifications toggle — when notifications are off (default), the row is
 * still removed but the Undo affordance is silent.
 * INTEGRATION (see backend-integration.md §A.2.2):
 *   - On removal completion: DELETE /favorites?path=<row.dataset.path>.
 *   - On Undo: cancel the pending DELETE if not yet sent, else POST /favorites
 *     to re-add. Defer the network call past the 200ms timer so undo can race
 *     it without a roundtrip.
 */
function unfavoriteFile(el) {
  const row = el?.closest('.fp-row');
  if (!row) return;
  const parent = row.parentElement;
  const nextSibling = row.nextElementSibling;
  const filename = row.querySelector('.fp-row__name')?.textContent || 'File';
  const starPath = el.querySelector('svg path');
  const origFill = starPath?.getAttribute('fill');
  const origStroke = starPath?.getAttribute('stroke');
  const origStrokeWidth = starPath?.getAttribute('stroke-width');

  if (starPath) {
    starPath.setAttribute('fill', 'none');
    starPath.setAttribute('stroke', 'var(--accent)');
    starPath.setAttribute('stroke-width', '1.2');
  }
  row.classList.add('fp-row--unfavoriting');

  const removeTimer = setTimeout(() => {
    row.remove();
    if (typeof pruneEmptyHomeSections === 'function') pruneEmptyHomeSections();
  }, 200);

  // Script load order is api.js → fileops.js → browser.js → inspector.js →
  // home.js → settings.js → app.js (see index.html), so app.js's
  // function showSnackbar(message, undoLabel, onUndo) is already defined by
  // the time this runs. Call with the 3-arg signature.
  showSnackbar(`Removed "${filename}" from favorites`, 'Undo', () => {
    clearTimeout(removeTimer);
    if (!row.parentElement) parent.insertBefore(row, nextSibling);
    row.classList.remove('fp-row--unfavoriting');
    if (starPath) {
      origFill === null ? starPath.removeAttribute('fill') : starPath.setAttribute('fill', origFill);
      origStroke === null ? starPath.removeAttribute('stroke') : starPath.setAttribute('stroke', origStroke);
      origStrokeWidth === null ? starPath.removeAttribute('stroke-width') : starPath.setAttribute('stroke-width', origStrokeWidth);
    }
    if (typeof pruneEmptyHomeSections === 'function') pruneEmptyHomeSections();
  });
}

// ── Home > Recent/Favorites: prune empty sections + toggle empty states ───────
// Each .home-section in Recent renders only when it has at least one
// .fp-row--recent. Order is preserved (Today → Yesterday → This week →
// Earlier this month → Older); the first non-empty group naturally lands at
// the top. Additionally, .fp-empty-state[data-empty-for="recent"|"favorites"]
// elements toggle visible iff their pane has zero .fp-row--recent rows.
function pruneEmptyHomeSections() {
  document.querySelectorAll('.home-pane[data-pane="recent"] .home-section').forEach(s => {
    s.style.display = s.querySelector('.fp-row--recent') ? '' : 'none';
  });
  document.querySelectorAll('.fp-empty-state.home-pane__empty[data-empty-for]').forEach(es => {
    const key  = es.dataset.emptyFor;
    const pane = document.querySelector(`.home-pane[data-pane="${key}"]`);
    const empty = !!pane && !pane.querySelector('.fp-row--recent');
    es.style.display = empty ? '' : 'none';
  });
}
