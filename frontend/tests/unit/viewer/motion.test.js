import { describe, expect, it } from 'vitest';
import { createTween, doorPose, easeInOutCubic, isView, MOTION, stepToward, viewPose } from '../../../src/viewer/motion.js';
import { loadDesign } from '../domain/helpers.js';

const basic = loadDesign('basic');
const close = (actual, expected) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));

describe('easing and stepping', () => {
  it('eases from 0 to 1 symmetrically and clamps', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('steps toward the target without overshooting', () => {
    expect(stepToward(0, 1, 225, 450)).toBe(0.5);
    expect(stepToward(0.9, 1, 450, 450)).toBe(1);
    expect(stepToward(0.2, 0, 450, 450)).toBe(0);
    expect(stepToward(0.3, 1, 16, 0)).toBe(1);
  });
});

describe('doorPose', () => {
  const hinged = (hingeSide) => ({ type: 'hinged', center: [0.5, 1.2, 0.009], width: 0.6, thickness: 0.018, hingeSide });

  it('is the rest pose when closed', () => {
    const pose = doorPose(hinged('left'), 0);
    close(pose.position, [0.5, 1.2, 0.009]);
    expect(pose).toMatchObject({ rotationY: 0, opacity: 1, visible: true });
  });

  it('swings a left-hinged door outward about its left edge', () => {
    const pose = doorPose(hinged('left'), 1);
    expect(pose.rotationY).toBeCloseTo(-MOTION.doorOpenAngle, 6);
    expect(pose.position[2]).toBeGreaterThan(0.25); // well in front of the carcass
    expect(pose.position[0]).toBeLessThan(0.5); // centre moved toward the hinge side
  });

  it('mirrors for a right-hinged door', () => {
    const left = doorPose(hinged('left'), 1);
    const right = doorPose(hinged('right'), 1);
    expect(right.rotationY).toBeCloseTo(-left.rotationY, 6);
    expect(right.position[0] - 0.5).toBeCloseTo(-(left.position[0] - 0.5), 6);
    expect(right.position[2]).toBeCloseTo(left.position[2], 6);
  });

  it('keeps the hinge edge fixed while swinging', () => {
    const door = hinged('left');
    const hingeEdge = (pose) => {
      // Left edge on the front face, rotated with the door.
      const rx = -door.width / 2;
      const rz = door.thickness / 2;
      const cos = Math.cos(pose.rotationY);
      const sin = Math.sin(pose.rotationY);
      return [pose.position[0] + rx * cos + rz * sin, pose.position[2] - rx * sin + rz * cos];
    };
    close(hingeEdge(doorPose(door, 0.5)), hingeEdge(doorPose(door, 0)));
  });

  it('slides and fades sliding panels, hiding them when fully open', () => {
    const panel = { type: 'sliding', center: [0.5, 1.2, 0.009], width: 0.9, thickness: 0.018, slideDirection: -1 };
    const half = doorPose(panel, 0.5);
    expect(half.position[0]).toBeCloseTo(0.5 - 0.5 * 0.9 * MOTION.slideFraction, 6);
    expect(half).toMatchObject({ opacity: 0.5, visible: true });
    expect(doorPose(panel, 1)).toMatchObject({ opacity: 0, visible: false });
  });
});

describe('viewPose', () => {
  it('frames the wardrobe from the front, the default 3/4 angle and the top', () => {
    const front = viewPose(basic, 'front', 40);
    close(front.target, [1, 1.2, -0.3]);
    expect(front.position[0]).toBeCloseTo(1, 6);
    expect(front.position[1]).toBeGreaterThan(1.2); // just above eye level
    expect(front.position[1]).toBeLessThan(1.4);
    expect(front.position[2]).toBeGreaterThan(3);

    const angle = viewPose(basic, 'angle', 40);
    expect(angle.position[0]).toBeGreaterThan(1);
    expect(angle.position[2]).toBeCloseTo(front.position[2], 6);

    const top = viewPose(basic, 'top', 40);
    expect(top.position[1]).toBeGreaterThan(2.4);
    expect(top.position[0]).toBeCloseTo(1, 6);
  });

  it('knows only the three named views', () => {
    expect(['front', 'angle', 'top'].every(isView)).toBe(true);
    expect(isView('side')).toBe(false);
  });
});

describe('createTween', () => {
  it('interpolates every key with easing and reports completion', () => {
    const tween = createTween({ from: { p: [0, 0] }, to: { p: [10, -10] }, durationMs: 100, startMs: 1000 });
    expect(tween.at(1000)).toEqual({ value: { p: [0, 0] }, done: false });
    expect(tween.at(1050).value.p).toEqual([5, -5]);
    expect(tween.at(1200)).toEqual({ value: { p: [10, -10] }, done: true });
  });

  it('completes immediately with a zero duration (reduced motion)', () => {
    const tween = createTween({ from: { p: [0] }, to: { p: [1] }, durationMs: 0, startMs: 0 });
    expect(tween.at(0)).toEqual({ value: { p: [1] }, done: true });
  });
});
