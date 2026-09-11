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
