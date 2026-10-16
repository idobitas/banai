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

// Toolbar view buttons mirror the viewer's current named view (none after a free orbit).
function showActiveView(view) {
  document.querySelectorAll('#viewer-toolbar [data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  });
}

function bindToolbar(viewer) {
  document.querySelectorAll('#viewer-toolbar [data-view]').forEach((button) => {
    button.addEventListener('click', () => viewer.setView(button.dataset.view));
  });
  document.getElementById('view-fit').addEventListener('click', () => viewer.fit());
}

// The floating panels cover the canvas edges. Their widths are passed to the viewer (to
// centre the wardrobe in the free area) and to CSS (to centre the toolbar there).
function bindInsets(viewer) {
  const workspace = document.querySelector('.workspace');
  const chat = document.getElementById('chat-panel');
  const properties = document.getElementById('properties-panel');
  const update = () => {
    const area = workspace.getBoundingClientRect();
    const left = workspace.classList.contains('is-chat-collapsed') ? 0 : chat.getBoundingClientRect().right - area.left;
    const right = area.right - properties.getBoundingClientRect().left;
    workspace.style.setProperty('--inset-left', `${Math.round(left)}px`);
    workspace.style.setProperty('--inset-right', `${Math.round(right)}px`);
    viewer.setInsets({ left, right });
  };
  const observer = new ResizeObserver(update);
  [workspace, chat, properties].forEach((node) => observer.observe(node));
  update();
}

// The chat panel collapses to a small pill. Collapsed by default until the agent exists
// (Phase 5); the choice persists per viewer.
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
  const viewer = createViewer(document.getElementById('viewer'), store, { onViewChange: showActiveView });
  bindInsets(viewer);
  bindToolbar(viewer);
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
