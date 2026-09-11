  const TOTAL = 7;
  let current = 1;

  const dotsEl  = document.getElementById('setup-dots');
  const btnBack = document.getElementById('btn-back');
  const btnNext = document.getElementById('btn-next');

  // Build step dots
  for (let i = 1; i <= TOTAL; i++) {
    const d = document.createElement('div');
    d.className = 'setup-footer__dot';
    d.dataset.dot = i;
    dotsEl.appendChild(d);
  }

  function updateRailFooter(step) {
    const remaining = Math.max(0, 7 - step);
    const minMap = [5, 4, 3, 2, 2, 1, 0];
    const el = document.getElementById('setup-rail-footer');
    if (!el) return;
    const mins = minMap[step - 1] || 0;
    el.innerHTML = mins > 0
      ? `~${mins} min remaining<br>~2.1 GB disk needed<br>offline after setup`
      : `Setup complete<br>~2.1 GB disk used<br>FilePlus ready`;
  }

  function go(step) {
    current = Math.max(1, Math.min(TOTAL, step));

    // Pages
    document.querySelectorAll('.setup-page').forEach(p => {
      p.classList.toggle('active', Number(p.dataset.page) === current);
    });

    // Rail steps
    document.querySelectorAll('.setup-step').forEach(s => {
      const n = Number(s.dataset.step);
      s.dataset.state = n < current ? 'done' : n === current ? 'active' : '';
    });

    // Footer dots
    document.querySelectorAll('[data-dot]').forEach(d => {
      d.classList.toggle('setup-footer__dot--active', Number(d.dataset.dot) === current);
    });

    // Buttons
    btnBack.style.visibility = current > 1 ? 'visible' : 'hidden';
    if (current === TOTAL) {
      btnNext.style.display = 'none'; // Final step — use the cards instead
    } else {
      btnNext.style.display = '';
      btnNext.textContent = current === 6 ? 'Continue' : 'Continue';
    }

    updateRailFooter(current);
  }

  // Navigate via data-action
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'setup-next': go(current + 1); break;
      case 'setup-prev': go(current - 1); break;
      case 'setup-start-scan':
        window.electronAPI?.startScan?.();
        window.electronAPI?.openMain?.();
        window.electronAPI?.closeSetup?.();
        break;
      case 'setup-open-app':
        window.electronAPI?.openMain?.();
        window.electronAPI?.closeSetup?.();
        break;
      case 'setup-set-cost-cap':
        document.querySelectorAll('[data-action="setup-set-cost-cap"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        break;
      case 'setup-set-dl-mode':
        btn.closest('.fp-segmented')?.querySelectorAll('.fp-segmented__opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        break;
      case 'setup-set-scan-schedule':
        btn.closest('.fp-segmented')?.querySelectorAll('.fp-segmented__opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        break;
      case 'setup-chat-chip':
        // Toggle chip selection
        btn.classList.toggle('fp-chip--active');
        break;
      case 'setup-toggle-component': {
        const card = btn.closest('.setup-opt-card');
        const cb = card?.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = !cb.checked;
        card?.classList.toggle('setup-opt-card--selected', cb?.checked ?? false);
        break;
      }
      case 'setup-toggle-key-vis': {
        const input = document.getElementById('claude-api-key');
        if (input) input.type = input.type === 'password' ? 'text' : 'password';
        break;
      }
      case 'setup-toggle-offline': {
        // INTEGRATION: disable API key field if offline mode on
        break;
      }
    }
  });

  // Back button explicit handler (separate from data-action delegation above)
  btnBack.addEventListener('click', () => go(current - 1));

  // Confidence slider live display
  const confSlider = document.getElementById('confidence-threshold');
  const confVal    = document.getElementById('confidence-val');
  confSlider?.addEventListener('input', () => {
    if (confVal) confVal.textContent = confSlider.value + '%';
  });

  // Theme switcher on step 4 (if user wants to preview theme during setup)
  document.querySelectorAll('[data-theme-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-theme-val]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.themeVal !== 'system') {
        document.documentElement.dataset.theme = btn.dataset.themeVal;
      }
    });
  });

  // Toggle handlers (fp-toggle uses native checkbox + sibling combinator CSS)
  // Handled by native checkbox; fp-toggle CSS applies via :checked

  go(1);
