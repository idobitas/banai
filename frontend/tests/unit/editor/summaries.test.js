import { describe, expect, it } from 'vitest';
import { appearanceSummary, compartmentItems, itemLabel } from '../../../src/editor/summaries.js';
import { loadCatalog, loadDesign } from '../domain/helpers.js';

const catalog = loadCatalog();
const basic = loadDesign('basic');

describe('appearanceSummary', () => {
  it('names catalog material, colour and finish, with the colour hex', () => {
    expect(appearanceSummary(basic.carcass.appearance, catalog)).toEqual({ text: 'Melamine board · White · Matte', hex: '#f2f1ed' });
  });

  it('marks custom values as custom and uses the custom hex', () => {
    const appearance = { ...basic.carcass.appearance, color: { custom: true, name: '<b>Sage</b>', hex: '#9caf88' } };
    expect(appearanceSummary(appearance, catalog)).toEqual({ text: 'Melamine board · Custom: <b>Sage</b> · Matte', hex: '#9caf88' });
  });

  it('degrades gracefully for an unknown catalog id', () => {
    const appearance = { ...basic.carcass.appearance, color: { catalogId: 'missing' } };
    expect(appearanceSummary(appearance, catalog)).toEqual({ text: 'Melamine board · ? · Matte', hex: null });
  });
});

describe('component tree', () => {
  it('labels items with their height in cm', () => {
    expect(itemLabel('shelf', { y: 800 })).toBe('Shelf · 80.0 cm');
    expect(itemLabel('rail', { y: 1900 })).toBe('Rail · 190.0 cm');
  });

  it('lists a compartment’s items top to bottom across kinds', () => {
    expect(compartmentItems(basic.compartments[2]).map((item) => item.id)).toEqual(['shf_r2', 'shf_r1', 'drw_r2', 'drw_r1']);
    expect(compartmentItems(basic.compartments[1])).toEqual([
      { kind: 'shelf', id: 'shf_m1', label: 'Shelf · 200.0 cm' },
      { kind: 'rail', id: 'rail_m1', label: 'Rail · 190.0 cm' },
    ]);
  });

  it('returns an empty list for an empty compartment', () => {
    expect(compartmentItems({ shelves: [], drawers: [], rails: [] })).toEqual([]);
  });
});
