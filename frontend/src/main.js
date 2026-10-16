import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import { getCatalog, getDefaultDesign } from './api/client.js';
import { createStore } from './state/store.js';
import { mountPanel } from './editor/panel.js';
import { createViewer } from './viewer/viewer.js';

function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.hidden = false;
}

function bindInteriorToggle(store) {
  const toggle = document.getElementById('toggle-interior');
  toggle.addEventListener('change', () => store.setDoorsVisible(!toggle.checked));
  store.subscribe((state) => { toggle.checked = !state.ui.doorsVisible; });
}

// The chat column collapses to a narrow rail. Collapsed by default until the agent exists
// (Phase 5); the choice persists per viewer. The viewer's ResizeObserver handles the canvas.
const CHAT_COLLAPSED_KEY = 'banai.chat.collapsed';

function bindChatCollapse() {
  const workspace = document.querySelector('.workspace');
  const header = document.getElementById('chat-header');
  const body = document.getElementById('chat-body');
  const collapseButton = document.getElementById('chat-collapse');
  const expandButton = document.getElementById('chat-expand');
  const apply = (collapsed) => {
    workspace.classList.toggle('is-chat-collapsed', collapsed);
    header.hidden = collapsed;
    body.hidden = collapsed;
    expandButton.hidden = !collapsed;
    collapseButton.setAttribute('aria-expanded', String(!collapsed));
    expandButton.setAttribute('aria-expanded', String(!collapsed));
  };
  const set = (collapsed) => {
    apply(collapsed);
    try {
      localStorage.setItem(CHAT_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Not persisting is fine.
    }
    (collapsed ? expandButton : collapseButton).focus();
  };
  let stored = null;
  try {
    stored = localStorage.getItem(CHAT_COLLAPSED_KEY);
  } catch {
    // Storage blocked: use the default.
  }
  apply(stored !== 'false');
  collapseButton.addEventListener('click', () => set(true));
  expandButton.addEventListener('click', () => set(false));
}

async function boot() {
  let catalog;
  let initial;
  try {
    [catalog, initial] = await Promise.all([getCatalog(), getDefaultDesign()]);
  } catch {
    showError('Could not reach the design service. Please check your connection and reload.');
    return;
  }
  // Validates the server data before anything is rendered (throws on invalid data).
  const store = createStore({ design: initial.design, revision: initial.revision, catalog });
  const viewer = createViewer(document.getElementById('viewer'), store);
  bindInteriorToggle(store);
  mountPanel(document.getElementById('properties-content'), store);
  if (import.meta.env.DEV) {
    window.__banai = Object.freeze({ store, viewer });
  }
}

bindChatCollapse();
boot().catch(() => {
  showError('The designer could not start. Please reload the page.');
});
