// Properties panel: re-renders from store state on every committed change. Every edit
// goes through store.dispatch(ops); a rejected op leaves the state (and panel) as-is
// and shows an inline message. No LLM is involved in manual editing.
//
// Panel-only UI state (collapsed sections, expanded compartments) lives here, not in the
// store: it is not part of the design. Collapsed sections persist per viewer in localStorage.
import { compartmentsSection } from './compartmentsSection.js';
import { componentSection } from './componentSection.js';
import { wardrobeSection } from './wardrobeSection.js';
import { locate } from '../domain/lookup.js';

const STORAGE_KEY = 'banai.panel.collapsed';
const DEFAULT_COLLAPSED = ['materials'];
const SECTION_KEYS = new Set(['wardrobe', 'materials', 'materials.carcass', 'materials.doors', 'compartments']);

function loadCollapsed() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(parsed)) return new Set(parsed.filter((key) => SECTION_KEYS.has(key)));
  } catch {
    // Storage blocked or corrupt: fall back to the defaults.
  }
  return new Set(DEFAULT_COLLAPSED);
}

function saveCollapsed(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
  } catch {
    // Not persisting is fine; the state still applies for this page view.
  }
}

/** The compartment that is, or contains, the selected component (null for doors, partitions, carcass). */
function compartmentOf(design, selection) {
  const found = selection && locate(design, selection.id);
  return found && found[0] !== 'partition' && found[0] !== 'door' ? design.compartments[found[1]].id : null;
}

export function mountPanel(root, store) {
  const run = (ops) => {
    try {
      return store.dispatch(ops);
    } catch {
      return { ok: false, error: { code: 'UNEXPECTED' } }; // shown as a generic message
    }
  };
  const select = (id) => store.select(id);
  const scroller = root.closest('.panel') ?? root;
  const collapsed = loadCollapsed();
  const expanded = new Set();
  let rendered = { design: null, selection: undefined };

  const render = (state, { force = false } = {}) => {
    if (!force && state.design === rendered.design && state.selection === rendered.selection) return;
    const newSelection = state.selection && state.selection.id !== rendered.selection?.id;
    rendered = { design: state.design, selection: state.selection };
    if (newSelection) {
      const compartmentId = compartmentOf(state.design, state.selection);
      if (compartmentId) expanded.add(compartmentId);
    }
    const context = { design: state.design, catalog: state.catalog, selection: state.selection, run, select, ui };
    root.replaceChildren(
      ...(state.selection ? [componentSection(context)] : []),
      ...wardrobeSection(context),
      compartmentsSection(context),
    );
    // A new selection brings its card (always first) into view; edits inside it do not scroll.
    if (newSelection) scroller.scrollTo({ top: 0 });
  };

  // Re-render after a toggle and give keyboard focus back to the same toggle.
  const rerender = (focusSelector) => {
    render(store.getState(), { force: true });
    root.querySelector(focusSelector)?.focus();
  };
  const ui = Object.freeze({
    isCollapsed: (key) => collapsed.has(key),
    toggle(key) {
      if (!collapsed.delete(key)) collapsed.add(key);
      saveCollapsed(collapsed);
      rerender(`[data-collapse-key="${CSS.escape(key)}"]`);
    },
    isExpanded: (compartmentId) => expanded.has(compartmentId),
    toggleExpanded(compartmentId) {
      if (!expanded.delete(compartmentId)) expanded.add(compartmentId);
      rerender(`[data-testid="expand-${CSS.escape(compartmentId)}"]`);
    },
  });

  const unsubscribe = store.subscribe((state) => render(state));
  render(store.getState());
  return unsubscribe;
}
