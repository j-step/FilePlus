// frontend/test/inspector-props-settings-pass2.spec.js
// Regression cover for the pass-2 "renderer-inspector-properties-settings"
// findings (#75-#85, #147-#152). One Electron launch, one page; each section
// restores whatever state it borrowed (selection, API stubs, panel width,
// Settings pane) so the next one starts clean.
const { test, expect } = require('@playwright/test');
const { launchApp, resetToDefaults } = require('./harness/app');

const API = `http://127.0.0.1:${process.env.FILEPLUS_PORT || 9876}`;

test.setTimeout(180_000);

test('inspector, properties and settings: pass-2 regressions', async () => {
  // launchApp (harness): reduced motion, errors collected from the first
  // renderer line on (renderer.log, read at close), app ready. Then default
  // settings, waiting for the reloaded app to be ready again — not a sleep.
  const { app, page, errors } = await launchApp();
  try {
    await resetToDefaults(page);
    // The inspector has caught up with the selection: its debounce has fired
    // and every /file, /preview, /files/history fetch it started has landed.
    const inspectorSettled = () => page.waitForFunction(() => window.__fpInspectorPending === 0);

    const token = process.env.FILEPLUS_API_TOKEN;
    const headers = token ? { 'X-FilePlus-Token': token } : {};
    const root = (await (await fetch(`${API}/fs/list/root`, { headers })).json()).path;
    const genDir = `${root}\\_gen`;
    const docsDir = `${genDir}\\Documents`;
    const picsDir = `${genDir}\\Pictures`;
    const fileA = `${docsDir}\\doc-00.txt`;
    const fileB = `${docsDir}\\doc-01.txt`;
    const imgA = `${picsDir}\\IMG_0001.png`;

    const crumbCurrent = page.locator('#breadcrumb .fp-breadcrumb__crumb--current');

    await page.evaluate(() => setInspectorOpen(true, { persist: false }));
    await page.evaluate((p) => openBrowserAt(p), picsDir);
    await expect(crumbCurrent).toHaveText('Pictures');
    // The breadcrumb updates before the listing renders; selecting a row that
    // is not in the DOM yet is a silent no-op (no /file or /preview request
    // was ever made in the flaky runs — logs/backend.log), so wait for it.
    await page.waitForFunction((p) => [...document.querySelectorAll('#list-scroll .fp-row')]
      .some((r) => r.dataset.path === p), imgA);

    // ── #148  A multi-selection really hides the preview box ────────────────
    // #inspector-preview carries an inline display:flex, so `hidden` alone was
    // inert and the previous file's image stayed on screen above "N selected".
    await page.evaluate((p) => selectRow(p), imgA);
    await inspectorSettled();
    const previewShown = await page.evaluate(() => ({
      display: getComputedStyle(document.getElementById('inspector-preview')).display,
      hasImg: !!document.querySelector('#inspector-preview img'),
      blob: _inspectorPreviewUrl !== null,
    }));
    expect(previewShown.display).not.toBe('none');
    expect(previewShown.hasImg).toBe(true);

    await page.evaluate((paths) => {
      selectRow(paths[0]);
      selectRow(paths[1], { ctrl: true });
    }, [imgA, `${picsDir}\\IMG_0002.png`]);
    await inspectorSettled();
    const previewHidden = await page.evaluate(() => ({
      display: getComputedStyle(document.getElementById('inspector-preview')).display,
      // #149 — the single file's chips go with its id, so nothing that
      // un-hides the Tags pane can show another file's tags under "2 selected".
      tagsHtml: document.getElementById('inspector-tags').innerHTML,
      fileId: _inspectorFileId,
      blob: _inspectorPreviewUrl,
    }));
    expect(previewHidden.display).toBe('none');
    expect(previewHidden.tagsHtml).toBe('');
    expect(previewHidden.fileId).toBeNull();
    expect(previewHidden.blob).toBeNull();   // the image blob: URL was revoked

    // ── #81  The tag field is disabled for something that cannot be tagged ──
    await page.evaluate((p) => openBrowserAt(p), genDir);
    await expect(crumbCurrent).toHaveText('_gen');
    await page.evaluate((p) => selectRow(p), docsDir);       // a folder
    await inspectorSettled();
    const folderTagInput = await page.evaluate(() => {
      const el = document.getElementById('inspector-tag-input');
      return { disabled: el.disabled, placeholder: el.placeholder, fileId: _inspectorFileId };
    });
    expect(folderTagInput.fileId).toBeNull();
    expect(folderTagInput.disabled).toBe(true);
    expect(folderTagInput.placeholder).toBe('Only files can be tagged');

    await page.evaluate((p) => openBrowserAt(p), docsDir);
    await expect(crumbCurrent).toHaveText('Documents');
    await page.evaluate((p) => selectRow(p), fileA);
    await inspectorSettled();
    const fileTagInput = await page.evaluate(() => {
      const el = document.getElementById('inspector-tag-input');
      return { disabled: el.disabled, placeholder: el.placeholder, fileId: _inspectorFileId };
    });
    expect(fileTagInput.disabled).toBe(false);
    expect(fileTagInput.placeholder).toBe('Add tag…');
    expect(typeof fileTagInput.fileId).toBe('number');

    // ── #77  History rows never dump a base64 desktop.ini ───────────────────
    const historyRows = await page.evaluate(() => {
      const ini = 'W1ZpZXdTdGF0ZV0NCkZvbGRlclR5cGU9UGljdHVyZXMNCg==';
      const rows = [
        { id: 1, op_type: 'folder-type-set', source_path: 'C:\\x\\Proj', timestamp: '2026-09-13T10:00:00',
          reason: JSON.stringify({ before_ini: ini, folder_bits_before: 16, after: 'Documents' }) },
        { id: 2, op_type: 'attr-set', source_path: 'C:\\x\\a.txt', timestamp: '2026-09-13T10:01:00',
          reason: JSON.stringify({ before: 32, after: 33 }) },
        { id: 3, op_type: 'move', source_path: 'C:\\x\\a.txt', dest_path: 'C:\\y\\a.txt',
          timestamp: '2026-09-13T10:02:00', reason: 'undo of #12' },
      ];
      return { html: rows.map(renderHistoryRow).join(''), ini };
    });
    expect(historyRows.html).toContain('Folder type → Documents');
    expect(historyRows.html).not.toContain(historyRows.ini);
    expect(historyRows.html).toContain('Read-only on');
    expect(historyRows.html).toContain('undo of #12');      // plain reasons still shown verbatim
    expect(historyRows.html).toContain('word-break:break-all');

    // ── #80  Undoing a tag-add from History removes the chip too ────────────
    const tagUndo = await page.evaluate(async (p) => {
      // Polls a condition (10 s cap) — a wait on the outcome, never a fixed sleep.
      const until = async (cond) => { const end = Date.now() + 10_000; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); };
      await addInspectorTag('pass2undotag');
      await until(() => document.getElementById('inspector-tags').textContent.includes('pass2undotag'));
      const before = document.getElementById('inspector-tags').textContent;
      await reloadInspectorHistoryFor(p);
      const row = [...document.querySelectorAll('.inspector-history__row')]
        .find(r => r.textContent.includes('tag-add'));
      const btn = row && row.querySelector('[data-action="inspector-undo-op"]');
      if (!btn) return { before, after: null, found: false };
      await inspectorUndoOp(btn.dataset.opId, btn.dataset.batchId || null);
      await until(() => !document.getElementById('inspector-tags').textContent.includes('pass2undotag')
        && window.__fpInspectorPending === 0);
      return { before, after: document.getElementById('inspector-tags').textContent, found: true };
    }, fileA);
    expect(tagUndo.found).toBe(true);
    expect(tagUndo.before).toContain('pass2undotag');
    expect(tagUndo.after).not.toContain('pass2undotag');

    // ── #152  "Shared by all" is never claimed from a 50-item sample ────────
    const sampled = await page.evaluate(async () => {
      const orig = API.get.bind(API);
      API.get = async (route, params) => (route === '/file'
        ? { id: 1, kind: 'Text', tags: [{ id: 1, name: 'work' }] }
        : orig(route, params));
      const paths = Array.from({ length: 60 }, (_, i) => `C:\\fake\\f${i}.txt`);
      await showInspectorMulti(paths);           // resolves once its fetches have landed and rendered
      const host = document.getElementById('inspector-multi-tags');
      const out = { html: host.innerHTML, text: host.textContent };
      // …and under the cap the full-opacity claim still stands.
      await showInspectorMulti(paths.slice(0, 10));
      out.smallHtml = host.innerHTML;
      API.get = orig;
      return out;
    });
    expect(sampled.text).toContain('Sampled from the first 50 of 60 items');
    expect(sampled.html).toContain('opacity:.5');
    expect(sampled.smallHtml).toContain('fp-chip');
    expect(sampled.smallHtml).not.toContain('opacity:.5');
    expect(sampled.smallHtml).not.toContain('Sampled');

    // ── #75  A Home row click runs the whole inspector pipeline ─────────────
    // (and leaves the Browser's own selection to repaint the panel when the
    // user comes back to it).
    await page.evaluate((p) => selectRow(p), fileA);
    await inspectorSettled();
    const homeClick = await page.evaluate(async (p) => {
      document.body.insertAdjacentHTML('beforeend',
        `<div class="home-pane" id="probe-home-pane"><div class="fp-row" data-action="open-recent-file" data-path="${p}">` +
        `<span class="fp-row__name">doc-01.txt</span></div></div>`);
      // Polls a condition (10 s cap) — a wait on the outcome, never a fixed sleep.
      const until = async (cond) => { const end = Date.now() + 10_000; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); };
      document.querySelector('#probe-home-pane .fp-row').click();
      // The inspector pipeline ran for it and has landed.
      await until(() => _inspectorEntry && _inspectorEntry.path === p && window.__fpInspectorPending === 0
        && document.getElementById('inspector-kind').textContent !== '—');
      const out = {
        entryPath: _inspectorEntry && _inspectorEntry.path,
        fileId: _inspectorFileId,
        kind: document.getElementById('inspector-kind').textContent,
        filename: document.getElementById('inspector-filename').textContent,
      };
      document.getElementById('probe-home-pane').remove();
      return out;
    }, fileB);
    expect(homeClick.entryPath).toBe(fileB);
    expect(typeof homeClick.fileId).toBe('number');
    expect(homeClick.kind).not.toBe('—');          // the meta grid really refetched
    expect(homeClick.filename).toBe('doc-01.txt');

    // Clearing the Home selection hands the panel back to the Browser's own
    // selection instead of blanking it.
    const afterHomeClear = await page.evaluate(async () => {
      // Polls a condition (10 s cap) — a wait on the outcome, never a fixed sleep.
      const until = async (cond) => { const end = Date.now() + 10_000; while (!cond() && Date.now() < end) await new Promise(r => setTimeout(r, 20)); };
      homeClearSelection();
      await until(() => document.getElementById('inspector-filename').textContent === 'doc-00.txt'
        && window.__fpInspectorPending === 0);
      return {
        filename: document.getElementById('inspector-filename').textContent,
        entryPath: _inspectorEntry && _inspectorEntry.path,
      };
    });
    expect(afterHomeClear.filename).toBe('doc-00.txt');
    expect(afterHomeClear.entryPath).toBe(fileA);

    // ── #82 / #83  One width bound, and a slider that actually moves it ─────
    const width = await page.evaluate(async () => {
      const inspector = document.getElementById('inspector');
      const slider = document.getElementById('slider-inspector-width');
      const label = document.getElementById('val-inspector-width');
      const maxWidth = getComputedStyle(inspector).maxWidth;
      applyInspectorWidth(9999);                    // clamps to INSPECTOR_WIDTH_MAX
      // Two frames, so the measurement below reads the laid-out width rather
      // than the value from before this frame's style recalc.
      const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await frames();
      const clamped = {
        css: document.documentElement.style.getPropertyValue('--inspector-w-screen'),
        box: Math.round(inspector.getBoundingClientRect().width),
        label: label.textContent,
        slider: slider.value,
      };

      slider.value = '400';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await frames();
      const fromSlider = { box: Math.round(inspector.getBoundingClientRect().width), label: label.textContent };
      applyInspectorWidth(340);
      return { maxWidth, clamped, fromSlider, sliderMax: slider.max, sliderMin: slider.min };
    });
    expect(width.maxWidth).toBe('520px');
    expect(width.sliderMax).toBe('520');
    expect(width.sliderMin).toBe('280');
    expect(width.clamped.css).toBe('520px');
    expect(width.clamped.box).toBe(520);            // the CSS cap no longer eats the last 40px
    expect(width.clamped.label).toBe('520px');
    expect(width.clamped.slider).toBe('520');
    expect(width.fromSlider.box).toBe(400);
    expect(width.fromSlider.label).toBe('400px');
    // The dead "Tab style" control is gone rather than faked.
    expect(await page.locator('[data-action="settings-set-tab-style"]').count()).toBe(0);

    // ── #79  Clicking into the accent field is not a validation failure ─────
    await page.evaluate(() => { switchScreen('settings'); switchSettingsPane('personalization'); });
    await page.evaluate(() => { document.getElementById('settings-accent-hex').value = ''; });
    // The accent field's click/input handlers are synchronous (no timer, no
    // fetch before they validate): once click()/fill() return, they have run.
    await page.locator('#settings-accent-hex').click();
    expect(await page.locator('#settings-accent-error').isHidden()).toBe(true);
    // Typing a real value still applies and persists it.
    await page.locator('#settings-accent-hex').fill('#AA5500');
    expect(await page.locator('#settings-accent-error').isHidden()).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-custom').trim()))
      .toBe('#AA5500');
    // Persisted: and only once the save has landed may the reset's DELETE go
    // out — sent while the POST was still in flight, it could arrive first and
    // leave the accent saved for every later test.
    await expect.poll(async () => (await (await fetch(`${API}/config`, { headers })).json())['ui.accent_hex'])
      .toBe('#AA5500');
    await page.evaluate(async () => { resetAccentToDefault(); await deleteSetting('ui.accent_hex'); });

    // ── #76  Scan & Index polls itself back to life ─────────────────────────
    await page.evaluate(() => switchSettingsPane('scan-index'));
    const poll = await page.evaluate(async () => {
      const orig = API.get.bind(API);
      let calls = 0;
      API.get = async (route, params) => {
        if (route !== '/index/status') return orig(route, params);
        calls += 1;
        return calls < 3 ? { running: true, roots: [] } : { running: false, roots: [] };
      };
      await loadIndexStatus();
      const duringRun = {
        badge: document.getElementById('settings-index-running').hidden,
        addDisabled: document.querySelector('[data-action="settings-index-add"]').disabled,
      };
      // Until the pane's own poll has re-read the status past "running" (or
      // 10 s, after which the assertions below fail) — not a fixed 2.6 s.
      const deadline = Date.now() + 10_000;
      while ((calls < 3 || !document.getElementById('settings-index-running').hidden) && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50));
      }
      const afterRun = {
        badge: document.getElementById('settings-index-running').hidden,
        addDisabled: document.querySelector('[data-action="settings-index-add"]').disabled,
        calls,
      };
      API.get = orig;
      stopIndexPolling();
      return { duringRun, afterRun };
    });
    expect(poll.duringRun).toEqual({ badge: false, addDisabled: true });
    expect(poll.afterRun.badge).toBe(true);
    expect(poll.afterRun.addDisabled).toBe(false);
    expect(poll.afterRun.calls).toBeGreaterThanOrEqual(3);   // it re-read without any user action

    // ── #84  An unreadable status never leaves the pane wedged ─────────────
    const failedRead = await page.evaluate(async () => {
      const orig = API.get.bind(API);
      API.get = async (route, params) => {
        if (route === '/index/status') throw new Error('backend down');
        return orig(route, params);
      };
      document.getElementById('settings-index-running').hidden = false;
      document.querySelector('[data-action="settings-index-add"]').disabled = true;
      await loadIndexStatus();
      const out = {
        badge: document.getElementById('settings-index-running').hidden,
        addDisabled: document.querySelector('[data-action="settings-index-add"]').disabled,
        text: document.getElementById('settings-index-status').textContent,
      };
      API.get = orig;
      stopIndexPolling();
      return out;
    });
    expect(failedRead.badge).toBe(true);
    expect(failedRead.addDisabled).toBe(false);
    expect(failedRead.text).toContain('read the index');
    await page.evaluate(async () => { await loadIndexStatus(); switchScreen('browser'); });

    // ── #78  A folder type outside the five options is reported, not rewritten
    const folderType = await page.evaluate(() => {
      const props = {
        is_dir: true, name: 'Proj', path: 'C:\\x\\Proj', location: 'C:\\x',
        type_description: 'File folder', size: 0, size_on_disk: 0,
        contains: { files: 0, folders: 0, truncated: false }, created: 0,
        attributes: { read_only: false, hidden: false, archive: false },
        folder_type: 'Contacts', folder_type_detected: 'Generic',
      };
      renderGeneral(props);
      const select = document.getElementById('properties-folder-type-select');
      const out = { value: select.value, loaded: _propsFolderTypeLoaded, options: [...select.options].map(o => o.value) };
      document.getElementById('properties-general-grid').innerHTML = '';
      return out;
    });
    expect(folderType.value).toBe('Contacts');        // not silently 'Generic'
    expect(folderType.loaded).toBe('Contacts');       // …and Apply compares against this
    expect(folderType.options).toContain('Contacts');

    // ── #151  Details never keeps the previous item's rows after a reload ───
    const details = await page.evaluate(async (p) => {
      await openProperties(p);
      _propsDetailsLoaded = true;
      document.getElementById('properties-details-content').innerHTML = '<p id="stale-details">stale</p>';
      await reloadProperties(_propsPath);
      const out = {
        loaded: _propsDetailsLoaded,
        stale: !!document.getElementById('stale-details'),
      };
      closeProperties();
      return out;
    }, fileA);
    expect(details.loaded).toBe(false);
    expect(details.stale).toBe(false);

    await page.evaluate(() => clearSelection());
    await inspectorSettled();   // nothing still fetching when the app closes
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);
});
