// Compartment list: widths, selection, add and remove, plus an expandable tree of each
// compartment's shelves, drawers and rails (selectable without clicking in 3D).
import { actionResult, button, cmField, el, section } from './fields.js';
import { addCompartmentOps, removeOps } from './opsFromForm.js';
import { compartmentItems } from './summaries.js';

function itemTree(compartment, { selection, select }) {
  const items = compartmentItems(compartment);
  const tree = el('ul', { className: 'tree', attrs: { id: `tree-${compartment.id}` } });
  if (items.length === 0) {
    tree.append(el('li', { className: 'tree__empty', text: 'No shelves, drawers or rails' }));
    return tree;
  }
  items.forEach(({ id, label }) => {
    const selected = selection?.id === id;
    const item = button(label, () => select(id), { variant: 'link', testId: `tree-${id}` });
    item.classList.add('tree__item');
    if (selected) {
      item.classList.add('is-selected');
      item.setAttribute('aria-current', 'true');
    }
    tree.append(el('li', {}, [item]));
  });
  return tree;
}

export function compartmentsSection({ design, selection, run, select, ui }) {
  const list = el('ol', { className: 'compartment-list' });
  const single = design.compartments.length === 1;
  design.compartments.forEach((compartment, index) => {
    const name = `Compartment ${index + 1}`;
    const expanded = ui.isExpanded(compartment.id);
    const entry = el('li', { className: 'compartment' });
    const toggle = el('button', {
      className: 'tree__toggle',
      attrs: {
        type: 'button', 'aria-expanded': String(expanded), 'aria-controls': `tree-${compartment.id}`,
        'aria-label': `${expanded ? 'Hide' : 'Show'} items in ${name}`, 'data-testid': `expand-${compartment.id}`,
      },
    }, [el('span', { className: 'collapse-toggle__chevron', attrs: { 'aria-hidden': 'true' } })]);
    toggle.addEventListener('click', () => ui.toggleExpanded(compartment.id));
    const row = el('div', { className: `compartment-row${selection?.id === compartment.id ? ' is-selected' : ''}` }, [
      toggle,
      button(name, () => select(compartment.id), { variant: 'link', testId: `select-${compartment.id}` }),
      cmField({
        label: 'Width', mm: compartment.width, testId: `width-${compartment.id}`,
        onCommit: (mm) => run([{ op: 'modify_compartment', compartmentId: compartment.id, width: mm }]),
      }),
      button('Remove', () => actionResult(entry, run(removeOps(compartment.id))), {
        variant: 'ghost', disabled: single, testId: `remove-${compartment.id}`,
      }),
    ]);
    const tree = itemTree(compartment, { selection, select });
    tree.hidden = !expanded;
    entry.append(row, tree);
    list.append(entry);
  });
  const count = design.compartments.length;
  const add = button('+ Add compartment', () => actionResult(container, run(addCompartmentOps(design))), { variant: 'secondary', testId: 'add-compartment' });
  const container = section('Compartments', [list, add], { key: 'compartments', ui, summary: { text: `${count} compartment${count === 1 ? '' : 's'}` } });
  return container;
}
