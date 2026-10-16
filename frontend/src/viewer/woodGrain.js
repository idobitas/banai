// Procedural wood grain: a tileable greyscale texture multiplied over the catalog colour.
// Pure and deterministic (seeded, no DOM), so it is unit-tested in Node. The grain runs
// along the texture's u axis; panel UVs put u along each panel's long side (frame.js).

// ASSUMPTION: visual-only presentation values, not a material specification.
// One texture tile covers `tileAlong` metres along the grain and `tileAcross` across it,
// so the growth lines are long and gently curving rather than short waves.
export const GRAIN = Object.freeze({ size: 256, seed: 7, tileAlong: 2.4, tileAcross: 0.45, rings: 7, min: 0.78 });

/** Seeded PRNG (mulberry32): the same seed always gives the same texture. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/**
 * Grain intensity in [GRAIN.min, 1] for each pixel, as RGBA bytes (row-major, `size` x `size`).
 * Only integer frequencies are used, so the texture tiles seamlessly in both directions.
 */
export function woodGrainData(size = GRAIN.size, seed = GRAIN.seed) {
  const rand = random(seed);
  const phases = [rand(), rand(), rand()];
  // Fibres: each row gets its own strength, a slow variation along the grain, and a phase.
  const fibres = Array.from({ length: size }, () => ({ strength: rand(), frequency: 1 + Math.floor(rand() * 2), phase: rand() }));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    const fibre = fibres[y];
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      // Slow waviness of the growth lines, periodic in u and v (low u frequencies only).
      const warp = 0.03 * Math.sin(TAU * (u + v + phases[0]))
        + 0.015 * Math.sin(TAU * (2 * u + 3 * v + phases[1]));
      // Thin darker latewood lines, plus a fainter secondary set between them.
      const ring = (0.5 + 0.5 * Math.sin(TAU * GRAIN.rings * (v + warp))) ** 6;
      const fine = (0.5 + 0.5 * Math.sin(TAU * 3 * GRAIN.rings * (v + warp + 0.004 * Math.sin(TAU * (u + phases[2]))))) ** 4;
      const streak = fibre.strength * (0.5 + 0.5 * Math.sin(TAU * (fibre.frequency * u + fibre.phase)));
      const intensity = Math.max(GRAIN.min, 1 - 0.11 * ring - 0.04 * fine - 0.06 * streak);
      const byte = Math.round(intensity * 255);
      const i = (y * size + x) * 4;
      data[i] = byte;
      data[i + 1] = byte;
      data[i + 2] = byte;
      data[i + 3] = 255;
    }
  }
  return data;
}
