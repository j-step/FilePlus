/**
 * FilePlus Settings screen: pane switching, density, accent color, and
 * persisted-settings restore on startup. Theme mode (applyTheme et al.)
 * stays in app.js since toggleTheme and the DOMContentLoaded init also use
 * it directly.
 */

// ── Config cache ─────────────────────────────────────────────────────────────
// Loaded once at startup from GET /config into window.__fpConfig — read by
// applyDownloadsPath() and the browserState.showHidden seed in app.js's init.
// Left as {} (not populated) when the backend can't be reached; callers use
// `config['key'] || fallback` so a missing/empty cache degrades gracefully.
async function loadConfig() {
  try {
    window.__fpConfig = await API.get('/config');
  } catch (err) {
    window.__fpConfig = {};
  }
}

/**
 * Persists one setting to POST /config, updating window.__fpConfig
 * optimistically so callers that read the cache synchronously (browserState
 * seeds, applyDownloadsPath, the click-mode check in browser.js's row click
 * handler) see the new value immediately. On failure, reverts the cache to
 * whatever it held before and toasts — the caller's own UI (checkbox/segmented
 * button) has already visually applied the change and is not rolled back here,
 * since each caller owns its own apply step and can re-apply if it wants to.
 */
async function saveSetting(key, value) {
  if (!window.__fpConfig) window.__fpConfig = {};
  const hadPrev = Object.prototype.hasOwnProperty.call(window.__fpConfig, key);
  const prev = window.__fpConfig[key];
  window.__fpConfig[key] = value;
  try {
    await API.post('/config', { key, value });
  } catch (err) {
    if (hadPrev) window.__fpConfig[key] = prev;
    else delete window.__fpConfig[key];
    if (typeof showToast === 'function') {
      showToast(`Failed to save setting: ${formatApiError(err)}`, 'error');
    }
  }
}

/** Removes a persisted setting (DELETE /config/{key}) — used by "Reset to
 * default" actions (e.g. accent color) so a future load doesn't reapply the
 * old value. Same optimistic-update/revert-on-failure shape as saveSetting(). */
async function deleteSetting(key) {
  const hadPrev = window.__fpConfig && Object.prototype.hasOwnProperty.call(window.__fpConfig, key);
  const prev = hadPrev ? window.__fpConfig[key] : undefined;
  if (window.__fpConfig) delete window.__fpConfig[key];
  try {
    await API.del(`/config/${encodeURIComponent(key)}`);
  } catch (err) {
    if (hadPrev) {
      if (!window.__fpConfig) window.__fpConfig = {};
      window.__fpConfig[key] = prev;
    }
    if (typeof showToast === 'function') {
      showToast(`Failed to save setting: ${formatApiError(err)}`, 'error');
    }
  }
}

/**
 * Applies backend-persisted settings from window.__fpConfig — called once at
 * startup, right after loadConfig() resolves, following restoreSettings()
 * (which already applied the localStorage fast-paint cache). Config wins:
 * theme/density/accent/notifications are only re-applied when the config key
 * is actually present, so an unset key leaves restoreSettings()'s
 * localStorage-derived choice alone. show-extensions/show-hidden/click-mode
 * have no localStorage cache — config (or its documented default) is their
 * only source. Also syncs the Personalization controls (checkbox `checked`,
 * segmented `active`) to whatever ends up applied.
 */
function applySettingsFromConfig() {
  const cfg = window.__fpConfig || {};

  if (typeof cfg['ui.theme'] === 'string') applyTheme(cfg['ui.theme']);
  if (typeof cfg['ui.density'] === 'string') applyDensity(cfg['ui.density']);
  if (typeof cfg['ui.accent_hex'] === 'string' && cfg['ui.accent_hex']) {
    applyAccentHex(cfg['ui.accent_hex']);
    const input = document.getElementById('settings-accent-hex');
    if (input) input.value = cfg['ui.accent_hex'];
  }
  if (typeof cfg['ui.notifications'] === 'boolean') setNotificationsEnabled(cfg['ui.notifications']);

  // Default true (matches the Personalization checkbox's static markup).
  const showExtensions = cfg['ui.show_extensions'] !== false;
  browserState.showExtensions = showExtensions;
  const extToggle = document.querySelector('[data-action="settings-toggle"][data-setting="show-extensions"]');
  if (extToggle) extToggle.checked = showExtensions;

  // Default false (matches the Personalization checkbox's static markup).
  const showHidden = !!cfg['ui.show_hidden'];
  browserState.showHidden = showHidden;
  const hiddenToggle = document.querySelector('[data-action="settings-toggle"][data-setting="show-hidden"]');
  if (hiddenToggle) hiddenToggle.checked = showHidden;

  // Default 'double' — matches actual behaviour when the key is unset
  // (browser.js's row click handler only opens on single click when
  // ui.click_mode === 'single').
  const clickMode = cfg['ui.click_mode'] === 'single' ? 'single' : 'double';
  document.querySelectorAll('[data-action="settings-set-click-mode"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === clickMode);
  });

  // Default 'fileplus' — matches fpIconSource() (icons.js), which treats
  // anything other than the literal 'windows' as the FilePlus family sprite.
  // No repaint here: this runs during init, before the first listing renders.
  applyIconSource(cfg['ui.icon_source']);
}

/** Syncs the Personalization "File icons" segmented control to `source` and
 * returns the normalised value ('fileplus' | 'windows'). The value itself is
 * read back out of window.__fpConfig by fpIconSource() (icons.js) on every
 * icon render, so there is no other state to apply. */
function applyIconSource(source) {
  const v = source === 'windows' ? 'windows' : 'fileplus';
  document.querySelectorAll('[data-action="settings-set-icon-source"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.val === v);
  });
  return v;
}

/** Repaints everything that renders a file icon, after ui.icon_source
 * changed: the open directory listing, Home's Recent/Favorites rows, and the
 * Inspector (whose "No preview" placeholder carries the selected file's
 * icon). Palette results need nothing — they are rebuilt per query. */
function refreshIconSurfaces() {
  if (browserState.entries && browserState.entries.length) renderDirectory();
  loadRecent();
  loadFavorites();
  // Only for a selection that is still in the current listing — re-fetching
  // metadata for a path the user has since navigated away from would answer
  // 404 and blank the panel that is showing something perfectly valid.
  const selected = [...browserState.selection];
  if (selected.length === 1 && entryForPath(selected[0])) showInspectorFor(selected[0]);
}

/** Updates the Data pane's read-only "Writes" line from the last /health
 * result (checkBackend(), in app.js, stores it on window.__fpHealth). No-op
 * until /health has answered at least once. */
function updateWritesStatusLine() {
  const el = document.getElementById('settings-writes-status');
  if (!el || !window.__fpHealth) return;
  el.textContent = window.__fpHealth.write_unlocked
    ? 'Unlocked — real-drive writes enabled'
    : 'Sandbox only — set WRITE_UNLOCKED=true in .env to enable real-drive writes';
}

// ── Settings: pane switching + persistence ────────────────────────────────────

function switchSettingsPane(pane) {
  if (!pane) return;
  document.querySelectorAll('.settings-nav__item').forEach(btn => {
    btn.classList.toggle('settings-nav__item--active', btn.dataset.pane === pane);
  });
  document.querySelectorAll('.settings-pane').forEach(p => {
    p.style.display = p.dataset.pane === pane ? '' : 'none';
  });
  sessionStorage.setItem('fp-settings-pane', pane);
}

function applyDensity(density) {
  document.documentElement.dataset.density = density;
  localStorage.setItem('fp-density', density);
  document.querySelectorAll('[data-action="settings-set-density"]').forEach(btn => {
    const v = btn.dataset.density || btn.dataset.val;
    btn.classList.toggle('active', v === density);
  });
}

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const DEFAULT_ACCENT = '#4CC2FF';

function isValidHex(s) {
  return typeof s === 'string' && HEX_RE.test(s.trim());
}

function applyAccentHex(rawHex) {
  const hex = (rawHex || '').trim();
  const errorEl = document.getElementById('settings-accent-error');
  if (!isValidHex(hex)) {
    if (errorEl) {
      errorEl.textContent = 'Enter a valid hex color (e.g. #4CC2FF or #abc).';
      errorEl.hidden = false;
    }
    return false;
  }
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  // Write to --accent-custom so the canonical cascade picks it up
  document.documentElement.style.setProperty('--accent-custom', hex);
  // Update swatch
  const swatch = document.getElementById('settings-accent-swatch');
  if (swatch) swatch.style.background = hex;
  localStorage.setItem('fp-accent', hex);
  return true;
}

function resetAccentToDefault() {
  document.documentElement.style.removeProperty('--accent-custom');
  const swatch = document.getElementById('settings-accent-swatch');
  if (swatch) swatch.style.background = `var(--accent)`;
  const input = document.getElementById('settings-accent-hex');
  if (input) input.value = '';
  const errorEl = document.getElementById('settings-accent-error');
  if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  localStorage.removeItem('fp-accent');
}

// Legacy compatibility — accept hex through old name too
function applyAccent(value) {
  if (isValidHex(value)) applyAccentHex(value);
}

function restoreSettings() {
  if (window.electronAPI?.micaAvailable?.()) document.documentElement.dataset.mica = 'on';
  applyTheme(localStorage.getItem('fp-theme') || 'system');
  const density = localStorage.getItem('fp-density');
  if (density) applyDensity(density);
  // One-time migration: drop the retired amber default (#E8965E) that older
  // sessions re-saved to localStorage, so the new blue accent takes over.
  const RETIRED_AMBER_ACCENT = '#E8965E';
  const persistedAccent = localStorage.getItem('fp-accent');
  if (persistedAccent && persistedAccent.toLowerCase() === RETIRED_AMBER_ACCENT.toLowerCase()) {
    localStorage.removeItem('fp-accent');
    console.info('[fp-accent] Dropped retired amber default; using the new blue accent.');
  }
  const savedAccent = localStorage.getItem('fp-accent');
  if (savedAccent) {
    if (isValidHex(savedAccent)) {
      // Valid hex — apply via --accent-custom hook
      document.documentElement.style.setProperty('--accent-custom', savedAccent);
      const input = document.getElementById('settings-accent-hex');
      if (input) input.value = savedAccent;
      const swatch = document.getElementById('settings-accent-swatch');
      if (swatch) swatch.style.background = savedAccent;
    } else {
      // Invalid (e.g., 'lavender' from pre-A4 sessions) — purge so the default accent wins
      console.warn(`[fp-accent] Discarding invalid persisted value: ${savedAccent}`);
      localStorage.removeItem('fp-accent');
    }
  }
  // Zoom is now handled by Electron webContents.setZoomFactor (no CSS zoom persistence needed).
  // Legacy fp-zoom in localStorage is intentionally ignored — Electron persists zoom separately.
  // Stage 1: glow feature removed
  localStorage.removeItem('fp-accent-glow');
  // Notifications setting — defaults to OFF if unset
  const checkbox = document.getElementById('settings-show-notifications');
  if (checkbox) checkbox.checked = notificationsEnabled();
}
