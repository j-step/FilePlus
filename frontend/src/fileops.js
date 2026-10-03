/**
 * FilePlus file operations (move/rename/delete/copy) — cut/copy/paste,
 * new folder/file, trash, undo/redo, and paste-conflict resolution.
 *
 * Every mutation goes through fileops.run(), which centralizes: pushing the
 * resulting batch onto the undo stack, surfacing partial errors, handing
 * conflicts off to resolveConflicts(), showing the "Undo" snackbar, and
 * refreshing the current directory listing. Callers (browser.js's inline
 * rename, app.js's context-menu dispatch and keyboard shortcuts) never talk
 * to /fs/* directly — they call a fileops method.
 */

/** Builds a name that doesn't collide with anything in the target directory's
 * currently-loaded listing (New folder, New folder (2), New folder (3), …).
 * If `dir` isn't the directory currently shown in the Browser, there is
 * nothing local to check against — fall back to the base name and let the
 * backend's own conflict detection (409) handle the rare collision. */
function uniqueNameFor(dir, baseName) {
  if (!browserState.path || browserState.path !== dir || !browserState.entries) return baseName;
  const existing = new Set(browserState.entries.map(e => e.name));
  if (!existing.has(baseName)) return baseName;
  const dot = baseName.lastIndexOf('.');
  const hasExt = dot > 0;
  const stem = hasExt ? baseName.slice(0, dot) : baseName;
  const ext = hasExt ? baseName.slice(dot) : '';
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (existing.has(candidate)) { n += 1; candidate = `${stem} (${n})${ext}`; }
  return candidate;
}

/** `.catch()` handler for a fileops call whose failure is already reported.
 *
 * fileops.run() toasts every failure and then rethrows, so callers that want
 * to react (browser.js's inline rename, properties.js's Apply sequence) can.
 * The fire-and-forget call sites — the context-menu switch, the keyboard
 * shortcuts, the drop handler — have nothing to react with, and an
 * un-awaited rejection there becomes an "Uncaught (in promise)" console
 * error on top of the toast (a 403 from a write-locked sandbox, a 409, a
 * backend restart), which is exactly what the smoke gate counts as a
 * failure. They pass this instead of swallowing it anonymously. */
function fileopsReported() { /* run() already showed the toast */ }

/** Op types that change where a path lives (fileops.followOps). */
const FOLLOWED_OPS = new Set(['move', 'rename', 'restore', 'trash']);

const fileops = {
  clipboard: { mode: null, paths: [] },          // 'copy' | 'cut'
  undoStack: [], redoStack: [],                  // batch ids

  // fn may be called with no arguments (the normal case) or, when a batch
  // partially conflicts, with (overridePaths, onConflict) to re-run the same
  // request for just the conflicting sources — see resolveConflicts().
  async run(label, fn) {
    try {
      const res = await fn();
      if (res && res.batch_id && res.ops && res.ops.length) { this.undoStack.push(res.batch_id); this.redoStack.length = 0; }
      this.followOps(res && res.ops);
      if (res && res.errors && res.errors.length) showToast(`${label}: ${res.errors[0].error}`, 'error');
      if (res && res.conflicts && res.conflicts.length) return this.resolveConflicts(label, res, fn);
      // `skipped` is the fourth bucket mover._batch returns (on_conflict:
      // 'skip'). Without it, choosing Skip in the conflict dialog closed the
      // modal and reported nothing at all — indistinguishable from a request
      // that silently did nothing.
      const skipped = (res && res.skipped && res.skipped.length) || 0;
      if (res && res.ops && res.ops.length) {
        const suffix = skipped ? `, ${skipped} skipped` : '';
        showSnackbar(`${label} (${res.ops.length}${suffix})`, 'Undo', () => this.undoBatch(res.batch_id));
      } else if (skipped) {
        showToast(`${label}: skipped ${skipped} item${skipped === 1 ? '' : 's'}`, 'default');
      }
      await refreshDirectory();
      return res;
    } catch (err) { showToast(`${label} failed: ${formatApiError(err)}`, 'error'); throw err; }
  },

  // undoLast/redoLast PEEK the stack rather than pop — the id is only removed
  // once the request has actually succeeded, so a network/HTTP failure
  // leaves the entry in place (and retryable) instead of silently losing it.
  // _inFlight makes a second call (a fast repeated Ctrl+Z, or a click while
  // the first request is still out) a no-op instead of firing a second
  // /undo for the same batch id.
  _inFlight: false,

  async undoLast() {
    if (this._inFlight) return;
    const id = this.undoStack[this.undoStack.length - 1];
    if (!id) return;
    this._inFlight = true;
    try { await this.undoBatch(id); } finally { this._inFlight = false; }
  },

  async undoBatch(id) {
    try {
      const res = await API.post(`/operations/batch/${id}/undo`);
      this.followOps(res && res.ops);
      this.undoStack = this.undoStack.filter(b => b !== id);
      if (res.batch_id) this.redoStack.push(res.batch_id);
      if (res.errors.length) showToast(`Undo: ${res.errors[0].error}`, 'error');
      // Only announce "Undone" when something was actually undone — a batch
      // id left stale on undoStack (e.g. its ops were already undone
      // individually from Inspector History) comes back as {batch_id: null,
      // ops: []} and must be a silent no-op, not a false "Undone".
      else if (res.ops && res.ops.length) showSnackbar('Undone', null, null);
      await refreshDirectory();
      // What the undo put back into this folder is selected (Explorer).
      if (typeof selectLandedOps === 'function') selectLandedOps(res.ops);
    } catch (err) { showToast(`Undo failed: ${formatApiError(err)}`, 'error'); }
  },

  /** Called by inspector.js after a per-operation History undo (POST
   * /operations/{id}/undo) so the batch undo/redo stacks stay consistent
   * without inspector.js reaching into fileops's arrays directly:
   * removes `batchId` (the undone op's own batch id, if it was still queued
   * on undoStack) so a later Ctrl+Z can't post a batch undo that finds
   * nothing left and still report "Undone", and pushes `inverseBatchId`
   * (the History undo's own inverse batch id) onto redoStack so Ctrl+Y can
   * redo it. */
  noteExternalUndo(batchId, inverseBatchId) {
    if (batchId) this.undoStack = this.undoStack.filter(b => b !== batchId);
    if (inverseBatchId) this.redoStack.push(inverseBatchId);
  },

  async redoLast() {
    if (this._inFlight) return;
    const id = this.redoStack[this.redoStack.length - 1];
    if (!id) return;
    this._inFlight = true;
    try {
      const res = await API.post(`/operations/batch/${id}/undo`);
      this.followOps(res && res.ops);
      // Mirror undoBatch: the inverse of an op can be refused (the item moved
      // or vanished behind our back) and the backend reports that in
      // `errors`. Dropping the entry regardless made a wholly-failed redo
      // look exactly like a successful one, with the entry gone for good.
      if (res.errors && res.errors.length) showToast(`Redo: ${res.errors[0].error}`, 'error');
      if (res.ops && res.ops.length) {
        this.redoStack = this.redoStack.filter(b => b !== id);
        if (res.batch_id) this.undoStack.push(res.batch_id);
      } else if (!res.errors || !res.errors.length) {
        // Nothing to redo and nothing wrong (already undone elsewhere):
        // drop the stale entry so Ctrl+Y moves on instead of retrying it.
        this.redoStack = this.redoStack.filter(b => b !== id);
      }
      await refreshDirectory();
      if (typeof selectLandedOps === 'function') selectLandedOps(res.ops);
    } catch (err) { showToast(`Redo failed: ${formatApiError(err)}`, 'error'); }
    finally { this._inFlight = false; }
  },

  // Both no-op on an empty selection rather than replacing a real clipboard
  // with an empty one: a stray Ctrl+C after a deselect used to wipe the copy
  // the user had just made, greying Paste out with no feedback (pass 2 #50).
  copySelection() { const paths = getSelectedPaths(); if (!paths.length) return; this.setClipboard('copy', paths); },
  cutSelection()  { const paths = getSelectedPaths(); if (!paths.length) return; this.setClipboard('cut', paths); },

  /** The one writer of `clipboard`. Every change repaints the cut / copied
   * marks on the listing and the status-bar count (browser.js
   * syncClipboardMarks) — with notifications off (the default) those are the
   * only sign a Ctrl+X / Ctrl+C happened at all (pass 2 #172). */
  setClipboard(mode, paths) {
    this.clipboard = { mode: mode || null, paths: mode ? paths : [] };
    if (typeof syncClipboardMarks === 'function') syncClipboardMarks();
  },

  /** Keeps the clipboard true to what is on disk after operations land: a
   * clipboard item (or anything under a clipboard folder) that was renamed or
   * moved now lives at its new path; one sent to the trash is dropped. So the
   * status-bar count always matches the ghosted rows, and Paste never offers
   * a path that is gone (pass 2 #172 review). Only the four path-changing
   * op types act; every other (copy, attr-set, folder-type-set, mkdir, …)
   * leaves the clipboard alone — an attribute change from Properties must
   * not drop a pending cut. */
  followOps(ops) {
    // The selection (and with it the inspector) follows the same ops.
    if (typeof followSelectionOps === 'function') followSelectionOps(ops);
    // A renamed row slides to its new place in the refresh that follows.
    if (typeof noteListMoves === 'function') noteListMoves(ops);
    const { mode, paths } = this.clipboard;
    if (!mode || !paths.length || !ops || !ops.length) return;
    let next = paths.slice();
    let changed = false;
    for (const op of ops) {
      if (!op || !op.src || !FOLLOWED_OPS.has(op.op_type)) continue;
      if (op.op_type !== 'trash' && !op.dest) continue;
      const src = String(op.src);
      const lsrc = src.toLowerCase();
      const prefix = lsrc.endsWith('\\') ? lsrc : `${lsrc}\\`;
      next = next.flatMap(p => {
        const lp = String(p).toLowerCase();
        if (lp !== lsrc && !lp.startsWith(prefix)) return [p];
        changed = true;
        if (op.op_type === 'trash') return [];
        return [String(op.dest) + String(p).slice(src.length)];
      });
    }
    if (changed) this.setClipboard(next.length ? mode : null, next);
  },

  /** Number of paths currently on the clipboard — the Paste context-menu
   * item's enabled(ctx) predicate (Task 11, playtest pass 1 §4.2) reads this
   * via buildMenuContext(target)'s ctx.clipboard rather than reaching into
   * fileops.clipboard.paths itself. */
  clipboardCount() { return this.clipboard.paths.length; },

  async pasteInto(dir) {
    const { mode, paths } = this.clipboard;
    if (!mode || !paths.length || !dir) return;
    const route = mode === 'cut' ? '/fs/move' : '/fs/copy';
    const res = await this.run(mode === 'cut' ? 'Moved' : 'Copied',
      (overridePaths, onConflict) => API.post(route, { sources: overridePaths || paths, dest: dir, on_conflict: onConflict || 'fail' }));
    // A conflict the user cancelled (resolveConflicts settles 'cancel') means
    // nothing new happened for the still-pending sources — keep the clipboard
    // so Ctrl+V can be retried instead of silently losing the cut selection.
    // Otherwise the moved items are done (followOps already pointed them at
    // their new home); any item still at its original path failed (an error,
    // or skipped) and stays cut, so Ctrl+V can retry just those.
    // The pasted items are selected, as in Explorer.
    if (res && res !== 'cancel' && typeof selectLandedOps === 'function') selectLandedOps(res.ops);
    if (mode === 'cut' && res !== 'cancel') {
      const original = new Set(paths.map(p => String(p).toLowerCase()));
      const left = this.clipboard.mode === 'cut'
        ? this.clipboard.paths.filter(p => original.has(String(p).toLowerCase())) : [];
      this.setClipboard(left.length ? 'cut' : null, left);
    }
  },

  // A second Delete while one is still out is a no-op (Task 14 I1): the
  // selection still holds the items being trashed, and once the first one
  // lands the next item is selected (selectAfterDelete) — a double press must
  // not send a duplicate request or trash that next item too.
  _trashInFlight: false,

  async trashSelection() {
    if (this._trashInFlight) return;
    const paths = getSelectedPaths();
    if (!paths.length) return;
    // Where the first deleted item sat: the item that takes its place is
    // selected afterwards (Explorer), so the keyboard carries on from there.
    const place = typeof deletePlace === 'function' ? deletePlace(paths) : null;
    this._trashInFlight = true;
    try {
      await this.run('Deleted', (overridePaths) => API.post('/fs/trash', { paths: overridePaths || paths }));
      if (place && typeof selectAfterDelete === 'function') selectAfterDelete(place);
    } finally { this._trashInFlight = false; }
  },

  async newFolder(dir) {
    if (!dir) return;
    const name = uniqueNameFor(dir, 'New folder');
    const res = await this.run('Created folder', () => API.post('/fs/mkdir', { dir, name }));
    this._selectAndRenameFromResult(res);
  },

  async newFile(dir) {
    if (!dir) return;
    const name = uniqueNameFor(dir, 'New file.txt');
    const res = await this.run('Created file', () => API.post('/fs/touch', { dir, name }));
    this._selectAndRenameFromResult(res);
  },

  _selectAndRenameFromResult(res) {
    if (!res || !res.ops || !res.ops.length) return;
    const path = res.ops[0].dest;
    if (!path) return;
    if (typeof selectRow === 'function') selectRow(path, {});
    if (typeof startInlineRename === 'function') startInlineRename(path);
  },

  async rename(path, newName) {
    // fn ignores the (overridePaths, onConflict) args run() would pass on a
    // conflict retry — /fs/rename never returns a "conflict" status (mover.rename
    // raises ConflictError instead, which the API maps straight to a 409), so
    // run() can never call fn() with those args here; a 409 falls into run()'s
    // catch and is toasted as-is via formatApiError, same as any other failure.
    const res = await this.run('Renamed', () => API.post('/fs/rename', { path, new_name: newName }));
    // Select (and focus) the renamed row once refreshDirectory() (inside
    // run()) has re-rendered it under its new path.
    const newPath = res && res.ops && res.ops[0] && res.ops[0].dest;
    if (newPath && typeof selectRow === 'function') selectRow(newPath);
    return res;
  },

  async moveTo(paths, dir, copy = false) {
    if (!paths || !paths.length || !dir) return;
    const route = copy ? '/fs/copy' : '/fs/move';
    await this.run(copy ? 'Copied' : 'Moved',
      (overridePaths, onConflict) => API.post(route, { sources: overridePaths || paths, dest: dir, on_conflict: onConflict || 'fail' }));
  },

  /**
   * A batch request came back with one or more items that already exist at
   * the destination. Surfaces Replace / Skip / Keep both (+ the modal's
   * existing Cancel) via #modal-extra-actions; the chosen policy re-runs the
   * SAME request for ONLY the conflicting sources — "applies to all
   * remaining" is implicit because one request carries every one of them.
   *
   * Any ops that already succeeded in `res` were logged/executed by the
   * backend regardless of how the conflicts resolve, so the listing is
   * refreshed immediately (covers dismissal — Cancel, Escape, a backdrop
   * click — where no follow-up request happens).
   *
   * Dismissal of any kind resolves the promise with the string 'cancel' via
   * openModal's config.onClose, which closeModal() calls exactly once no
   * matter which path closed the modal — so Escape/backdrop are handled the
   * same as clicking Cancel, and nothing is left listening afterward.
   */
  resolveConflicts(label, res, fn) {
    if (typeof refreshDirectory === 'function') refreshDirectory();
    const conflictPaths = res.conflicts.map(c => c.src).filter(Boolean);
    const names = conflictPaths.map(p => String(p).split(/[\\/]/).filter(Boolean).pop() || p);
    const count = conflictPaths.length;

    return new Promise(settle => {
      let done = false;
      const finish = (result) => { if (done) return; done = true; settle(result); };
      const choose = (policy) => finish(this.run(label, () => fn(conflictPaths, policy)));

      openModal('warn', {
        title: `${count} item${count === 1 ? '' : 's'} already exist${count === 1 ? 's' : ''}`,
        body: `${names.join(', ')} already ${names.length === 1 ? 'exists' : 'exist'} at the destination. Choose how to proceed.`,
        extraActions: [
          { label: 'Replace',   variant: 'danger',    onClick: () => choose('replace') },
          { label: 'Skip',      variant: 'secondary', onClick: () => choose('skip') },
          { label: 'Keep both', variant: 'primary',   onClick: () => choose('keep-both') },
        ],
        // Fires on Escape/backdrop/Cancel, AND (redundantly but harmlessly —
        // `finish` is idempotent) right after an extraActions click, since
        // that button's own handler also calls closeModal().
        onClose: () => finish('cancel'),
      });
    });
  },
};
