// Short text summaries for collapsed panel sections and the component tree. Pure (no DOM):
// callers render the returned text with textContent only.
import { toCmText } from './opsFromForm.js';

const refName = (ref, list) => (ref.custom ? `Custom: ${ref.name}` : list.find((entry) => entry.id === ref.catalogId)?.name ?? '?');

/** `{ text: 'Melamine board · White · Matte', hex }` for an appearance; hex feeds the colour dot. */
export function appearanceSummary(appearance, catalog) {
  const { material, color, finish } = appearance;
  const hex = color.custom ? color.hex : catalog.colors.find((entry) => entry.id === color.catalogId)?.hex ?? null;
  return {
    text: [refName(material, catalog.materials), refName(color, catalog.colors), refName(finish, catalog.finishes)].join(' · '),
    hex,
  };
}

const ITEM_NAMES = Object.freeze({ shelf: 'Shelf', drawer: 'Drawer', rail: 'Rail' });

/** Tree row label, e.g. 'Shelf · 80.0 cm'. */
export const itemLabel = (kind, item) => `${ITEM_NAMES[kind]} · ${toCmText(item.y)} cm`;

/** A compartment's shelves, drawers and rails as `{ kind, id, label }`, top to bottom. */
export function compartmentItems(compartment) {
  return [
    ...compartment.shelves.map((item) => ({ kind: 'shelf', item })),
    ...compartment.drawers.map((item) => ({ kind: 'drawer', item })),
    ...compartment.rails.map((item) => ({ kind: 'rail', item })),
  ]
    .sort((a, b) => b.item.y - a.item.y)
    .map(({ kind, item }) => ({ kind, id: item.id, label: itemLabel(kind, item) }));
}
