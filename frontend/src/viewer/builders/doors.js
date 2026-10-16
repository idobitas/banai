// Door panels in front of the carcass (z > 0). Hinged doors span the x-range of the
// compartments they cover; sliding panels split the interior width on two tracks.
import { toM, VISUAL } from '../units.js';
import { box } from './frame.js';

export function buildDoors(design, frame, materials) {
  const { doors } = design;
  const t = VISUAL.doorThickness;
  const gap = VISUAL.doorGap;
  const y = frame.panel + frame.innerHeight / 2;
  const height = frame.innerHeight - 2 * gap;
  const materialOf = (door) => materials.forAppearance(door.appearance ?? doors.appearance);

  // `motion` is the rest state in metres, used by the viewer to animate opening (motion.js).
  if (doors.type === 'hinged') {
    const rangeOf = new Map(design.compartments.map((c, i) => [c.id, frame.ranges[i]]));
    return doors.items.map((door) => {
      const x0 = rangeOf.get(door.compartmentIds[0])[0];
      const x1 = rangeOf.get(door.compartmentIds.at(-1))[1];
      const size = [x1 - x0 - 2 * gap, height, t];
      const center = [(x0 + x1) / 2, y, t / 2];
      return box({
        size, center,
        material: materialOf(door),
        userData: {
          componentId: door.id, kind: 'door', hingeSide: door.hingeSide,
          motion: { type: 'hinged', center: center.map(toM), width: toM(size[0]), thickness: toM(t), hingeSide: door.hingeSide },
        },
      });
    });
  }

  if (doors.type === 'sliding') {
    const panelWidth = frame.innerWidth / doors.items.length;
    const middle = frame.panel + frame.innerWidth / 2;
    return doors.items.map((door, i) => {
      const center = [frame.panel + panelWidth * (i + 0.5), y, i % 2 === 0 ? t / 2 : t * 1.5 + VISUAL.slidingTrackGap];
      return box({
        size: [panelWidth, height, t],
        center,
        material: materialOf(door),
        userData: {
          componentId: door.id, kind: 'door',
          // Panels slide toward the nearer end of the wardrobe while they fade out.
          motion: { type: 'sliding', center: center.map(toM), width: toM(panelWidth), thickness: toM(t), slideDirection: center[0] < middle ? -1 : 1 },
        },
      });
    });
  }

  return [];
}
