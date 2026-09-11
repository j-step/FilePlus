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
      if (res && res.errors && res.errors.length) showToast(`${label}: ${res.errors[0].error}`, 'error');
      if (res && res.conflicts && res.conflicts.length) return this.resolveConflicts(label, res, fn);
      if (res && res.ops && res.ops.length) showSnackbar(`${label} (${res.ops.length})`, 'Undo', () => this.undoBatch(res.batch_id));
      await refreshDirectory();
      return res;
    } catch (err) { showToast(`${label} failed: ${formatApiError(err)}`, 'error'); throw err; }
  },

  async undoLast() { const id = this.undoStack.pop(); if (!id) return; await this.undoBatch(id, { fromStack: true }); },

  async undoBatch(id, { fromStack = false } = {}) {
    try {
      const res = await API.post(`/operations/batch/${id}/undo`);
      if (res.batch_id) this.redoStack.push(res.batch_id);
      if (!fromStack) this.undoStack = this.undoStack.filter(b => b !== id);
      if (res.errors.length) showToast(`Undo: ${res.errors[0].error}`, 'error'); else showSnackbar('Undone', null, null);
      await refreshDirectory();
    } catch (err) { showToast(`Undo failed: ${formatApiError(err)}`, 'error'); }
  },

  async redoLast() {
    const id = this.redoStack.pop();
    if (!id) return;
    try {
      const res = await API.post(`/operations/batch/${id}/undo`);
      if (res.batch_id) this.undoStack.push(res.batch_id);
      await refreshDirectory();
    } catch (err) { showToast(`Redo failed: ${formatApiError(err)}`, 'error'); }
  },

  copySelection() { this.clipboard = { mode: 'copy', paths: getSelectedPaths() }; },
  cutSelection()  { this.clipboard = { mode: 'cut',  paths: getSelectedPaths() }; },

  async pasteInto(dir) {
    const { mode, paths } = this.clipboard;
    if (!mode || !paths.length || !dir) return;
    const route = mode === 'cut' ? '/fs/move' : '/fs/copy';
    await this.run(mode === 'cut' ? 'Moved' : 'Copied',
      (overridePaths, onConflict) => API.post(route, { sources: overridePaths || paths, dest: dir, on_conflict: onConflict || 'fail' }));
    if (mode === 'cut') this.clipboard = { mode: null, paths: [] };
  },

  async trashSelection() {
    const paths = getSelectedPaths();
    if (!paths.length) return;
    await this.run('Deleted', (overridePaths) => API.post('/fs/trash', { paths: overridePaths || paths }));
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

  async rename(path, newName) { return this.run('Renamed', () => API.post('/fs/rename', { path, new_name: newName })); },

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
   * refreshed immediately (covers the Cancel path too, where no follow-up
   * request happens).
   */
  resolveConflicts(label, res, fn) {
    if (typeof refreshDirectory === 'function') refreshDirectory();
    const conflictPaths = res.conflicts.map(c => c.src).filter(Boolean);
    const names = conflictPaths.map(p => String(p).split(/[\\/]/).filter(Boolean).pop() || p);
    const count = conflictPaths.length;

    return new Promise(settle => {
      const cancelBtn = document.getElementById('modal-cancel');
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        cancelBtn?.removeEventListener('click', onCancel);
        settle(result);
      };
      const onCancel = () => finish(res);
      const choose = (policy) => finish(this.run(label, () => fn(conflictPaths, policy)));

      cancelBtn?.addEventListener('click', onCancel);
      openModal('warn', {
        title: `${count} item${count === 1 ? '' : 's'} already exist${count === 1 ? 's' : ''}`,
        body: `${names.join(', ')} already ${names.length === 1 ? 'exists' : 'exist'} at the destination. Choose how to proceed.`,
        extraActions: [
          { label: 'Replace',   variant: 'danger',    onClick: () => choose('replace') },
          { label: 'Skip',      variant: 'secondary', onClick: () => choose('skip') },
          { label: 'Keep both', variant: 'primary',   onClick: () => choose('keep-both') },
        ],
      });
    });
  },
};
