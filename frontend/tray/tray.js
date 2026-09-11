  const api = window.electronAPI;

  // ── IPC handlers ──────────────────────────────────────────
  document.getElementById('btn-tray-close')?.addEventListener('click', () => api?.hideTray?.());
  document.getElementById('btn-tray-open-main')?.addEventListener('click', () => api?.openMain?.());

  // ── Tab switching ─────────────────────────────────────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'tray-switch-tab': {
        document.querySelectorAll('[data-action="tray-switch-tab"]').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        // INTEGRATION: swap list content for recent vs favorites
        break;
      }
      case 'tray-select-row': {
        const row = btn.closest('.tray-row');
        document.querySelectorAll('.tray-row').forEach(r => r.classList.remove('selected'));
        row?.classList.add('selected');
        break;
      }
      case 'tray-open-main':
        api?.openMain?.();
        break;
      case 'tray-open-review-bin':
        api?.openMain?.();
        // INTEGRATION: navigate main window to Review Bin screen
        break;
      case 'tray-open-everything':
        api?.openMain?.();
        // INTEGRATION: navigate main window to Everything Folder screen
        break;
      case 'tray-toggle-pause-ai': {
        btn.classList.toggle('tray-icon-btn--active');
        // INTEGRATION: POST /api/ai/pause
        break;
      }
      case 'tray-expand':
        api?.expandTray?.();
        break;
      case 'tray-close':
        api?.hideTray?.();
        break;
      case 'tray-toggle-moving': {
        const card = document.getElementById('tray-moving-card');
        // INTEGRATION: toggle collapsed state
        break;
      }
      case 'tray-open-settings':
        api?.openMain?.();
        // INTEGRATION: navigate to settings screen
        break;
      case 'tray-search':
        api?.openMain?.();
        // INTEGRATION: open command palette
        break;
    }
  });

  // ── Context menu ──────────────────────────────────────────
  const ctxMenu = document.getElementById('tray-context-menu');
  document.querySelectorAll('.tray-row').forEach(row => {
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      ctxMenu.style.display = '';
      ctxMenu.style.left = e.clientX + 'px';
      ctxMenu.style.top  = e.clientY + 'px';
      ctxMenu.setAttribute('aria-hidden', 'false');
    });
  });
  document.addEventListener('click', e => {
    if (!ctxMenu.contains(e.target)) {
      ctxMenu.style.display = 'none';
      ctxMenu.setAttribute('aria-hidden', 'true');
    }
  });
