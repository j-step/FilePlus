/**
 * FilePlus renderer — base UI logic.
 *
 * Handles layout interactions (sidebar/preview toggles, view modes)
 * and will serve as the integration point for backend API calls.
 *
 * Phase 5/6 implementation target for full functionality.
 */

const API_BASE = 'http://127.0.0.1:9876';

// ── DOM references ────────────────────────────────────────────────────
const sidebar         = document.getElementById('sidebar');
const previewPanel    = document.getElementById('preview-panel');
const btnToggleSidebar  = document.getElementById('btn-toggle-sidebar');
const btnClosePreview   = document.getElementById('btn-close-preview');
const addressBar      = document.getElementById('address-bar');
const statusBackend   = document.getElementById('status-backend');
const viewButtons     = document.querySelectorAll('.btn-view');

// ── Sidebar toggle ────────────────────────────────────────────────────
function toggleSidebar() {
  sidebar.classList.toggle('collapsed');
}

// ── Preview panel toggle ──────────────────────────────────────────────
function togglePreview(open) {
  if (open === undefined) {
    previewPanel.classList.toggle('collapsed');
  } else {
    previewPanel.classList.toggle('collapsed', !open);
  }
}

// ── View mode toggle ──────────────────────────────────────────────────
function setViewMode(mode) {
  viewButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === mode);
  });
  // TODO: Phase 6 — re-render file list in the chosen mode
}

// ── Backend health check ──────────────────────────────────────────────
async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      statusBackend.className = 'status-dot status-dot--ok';
      statusBackend.textContent = '● Backend';
      return true;
    }
  } catch (_) { /* backend not yet running */ }
  statusBackend.className = 'status-dot status-dot--error';
  statusBackend.textContent = '● Backend offline';
  return false;
}

// ── Event listeners ───────────────────────────────────────────────────
btnToggleSidebar.addEventListener('click', toggleSidebar);
btnClosePreview.addEventListener('click', () => togglePreview(false));

viewButtons.forEach(btn => {
  btn.addEventListener('click', () => setViewMode(btn.dataset.view));
});

addressBar.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    // TODO: Phase 6 — navigate to entered path via backend
    console.log('Navigate to:', addressBar.value);
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  if (e.altKey  && e.key === 'Left')  { e.preventDefault(); /* TODO: back nav */ }
  if (e.altKey  && e.key === 'Right') { e.preventDefault(); /* TODO: forward nav */ }
  if (e.altKey  && e.key === 'ArrowUp') { e.preventDefault(); /* TODO: up nav */ }
});

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  console.log('FilePlus UI initialized');
  checkBackend();
  // Ping backend every 30s to keep status indicator current
  setInterval(checkBackend, 30_000);
});
