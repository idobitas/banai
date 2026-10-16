// Motion helpers for the viewer: easing, door poses, camera view poses and tweens.
// Pure (no DOM, no WebGL, no clock): time is always passed in, so it is unit-tested in Node.
import { toM } from './units.js';

// ASSUMPTION: visual-only presentation values, not part of the design model.
export const MOTION = Object.freeze({
  doorOpenAngle: (100 * Math.PI) / 180,
  doorDurationMs: 450,
  cameraDurationMs: 600,
  slideFraction: 0.6, // how far a sliding panel travels (share of its width) while it fades out
});

export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const easeInOutCubic = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
};

/** Move `current` linearly toward `target` over `durationMs` (a duration of 0 jumps). */
export function stepToward(current, target, dtMs, durationMs) {
  if (durationMs <= 0) return target;
  const step = dtMs / durationMs;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

/**
 * Pose of one door at `openness` in [0, 1] (eased here). `door` is the mesh's rest state in metres:
 * { type: 'hinged' | 'sliding', center: [x, y, z], width, thickness, hingeSide?, slideDirection? }.
 * Hinged doors swing outward (z > 0) about their front hinge edge; sliding panels slide and fade.
 */
export function doorPose(door, openness) {
  const k = easeInOutCubic(openness);
  const [cx, cy, cz] = door.center;
  if (door.type === 'hinged') {
    const side = door.hingeSide === 'right' ? 1 : -1;
    const angle = side * k * MOTION.doorOpenAngle;
    // Hinge axis: the door's hinge-side edge on its front face.
    const px = cx + (side * door.width) / 2;
    const pz = cz + door.thickness / 2;
    const rx = cx - px;
    const rz = cz - pz;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      position: [px + rx * cos + rz * sin, cy, pz - rx * sin + rz * cos],
      rotationY: angle + 0, // normalises -0
      opacity: 1,
      visible: true,
    };
  }
  return {
    position: [cx + door.slideDirection * k * door.width * MOTION.slideFraction, cy, cz],
    rotationY: 0,
    opacity: 1 - k,
    visible: k < 1,
  };
}

const VIEWS = Object.freeze(['front', 'angle', 'top']);
export const isView = (name) => VIEWS.includes(name);

/** Camera `{ position, target }` (metres) framing the whole wardrobe from a named view. */
export function viewPose(design, view, fovDeg) {
  const { width, height, depth } = design.dimensions;
  const center = [toM(width / 2), toM(height / 2), toM(-depth / 2)];
  const fit = (extentMm) => (toM(extentMm) / (2 * Math.tan((fovDeg * Math.PI) / 360))) * 1.35;
  const distance = fit(Math.max(width, height));
  // Slightly above eye level: the orbit controls forbid looking exactly along the horizon.
  if (view === 'front') return { position: [center[0], center[1] + distance * 0.03, distance], target: center };
  if (view === 'top') {
    // A tiny z offset keeps the orbit controls' up vector well defined.
    return { position: [center[0], toM(height) + fit(Math.max(width, depth)), center[2] + 0.01], target: center };
  }
  return { position: [center[0] + distance * 0.35, center[1] + distance * 0.12, distance], target: center };
}

/** Eased interpolation between two `{ key: number[] }` records over `durationMs`, from `startMs`. */
export function createTween({ from, to, durationMs, startMs }) {
  return {
    at(nowMs) {
      const t = durationMs <= 0 ? 1 : clamp01((nowMs - startMs) / durationMs);
      const k = easeInOutCubic(t);
      const value = Object.fromEntries(Object.entries(to).map(([key, end]) => [key, end.map((v, i) => from[key][i] + (v - from[key][i]) * k)]));
      return { value, done: t >= 1 };
    },
  };
}
