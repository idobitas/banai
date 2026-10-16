// Always-visible wardrobe settings: overall dimensions, doors and main materials.
// Inputs report their own errors inline; buttons/selects report under their section.
import { appearanceControls } from './appearanceControls.js';
import { actionResult, cmField, countField, el, section, segmented, subsection } from './fields.js';
import { dimensionOps, doorTypeOps, toCmText } from './opsFromForm.js';
import { appearanceSummary } from './summaries.js';

function dimensionsRow(design, run) {
  const { width, height, depth } = design.dimensions;
  return el('div', { className: 'field-row field-row--3' }, [
    cmField({ label: 'Width', mm: width, testId: 'dim-width', onCommit: (mm) => run(dimensionOps('width', mm)) }),
    cmField({ label: 'Height', mm: height, testId: 'dim-height', onCommit: (mm) => run(dimensionOps('height', mm)) }),
    cmField({ label: 'Depth', mm: depth, testId: 'dim-depth', onCommit: (mm) => run(dimensionOps('depth', mm)) }),
  ]);
}

export function wardrobeSection({ design, catalog, run, ui }) {
  const { doors } = design;
  const { width, height, depth } = design.dimensions;
  const runDoors = (ops) => actionResult(wardrobe, run(ops));
  const wardrobe = section('Wardrobe', [
    dimensionsRow(design, run),
    segmented({
      label: 'Doors',
      testId: 'door-type',
      value: doors.type,
      options: [{ value: 'hinged', label: 'Hinged' }, { value: 'sliding', label: 'Sliding' }, { value: 'none', label: 'None' }],
      onChange: (type) => runDoors(doorTypeOps(type)),
    }),
    ...(doors.type === 'sliding' ? [countField({
      label: 'Sliding panels', value: doors.items.length, testId: 'sliding-count',
      onCommit: (count) => run(doorTypeOps('sliding', count)),
    })] : []),
  ], { key: 'wardrobe', ui, summary: { text: `${toCmText(width)} × ${toCmText(height)} × ${toCmText(depth)} cm` } });

  const runMaterials = (ops) => actionResult(materials, run(ops));
  const targets = [
    { target: 'carcass', title: 'Carcass & interior', appearance: design.carcass.appearance },
    ...(doors.type !== 'none' ? [{ target: 'doors', title: 'Doors', appearance: doors.appearance }] : []),
  ];
  const materials = section('Materials', targets.map(({ target, title, appearance }) => subsection(title, [
    appearanceControls({ catalog, appearance, target, run: runMaterials }),
  ], { key: `materials.${target}`, ui, summary: appearanceSummary(appearance, catalog) })), {
    key: 'materials', ui, summary: appearanceSummary(design.carcass.appearance, catalog),
  });
  return [wardrobe, materials];
}
