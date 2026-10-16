import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { scaleBoxUvs } from '../../../src/viewer/builders/frame.js';
import { createMaterials } from '../../../src/viewer/materials.js';
import { GRAIN, woodGrainData } from '../../../src/viewer/woodGrain.js';
import { parseCatalog } from '../../../src/domain/catalog.js';
import { loadCatalog } from '../domain/helpers.js';

const SIZE = 64;
const at = (data, x, y) => data[(y * SIZE + x) * 4] / 255;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

describe('woodGrainData', () => {
  const data = woodGrainData(SIZE, 7);

  it('is deterministic for a seed and differs between seeds', () => {
    expect(woodGrainData(SIZE, 7)).toEqual(data);
    expect(woodGrainData(SIZE, 8)).not.toEqual(data);
  });

  it('stays within the configured intensity range, opaque greyscale', () => {
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i] / 255).toBeGreaterThanOrEqual(GRAIN.min - 0.01);
      expect(data[i]).toBe(data[i + 1]);
      expect(data[i]).toBe(data[i + 2]);
      expect(data[i + 3]).toBe(255);
    }
  });

  it('runs along u: values change more across rows than along a row', () => {
    const alongRow = mean(Array.from({ length: SIZE - 1 }, (_, x) => Math.abs(at(data, x + 1, 10) - at(data, x, 10))));
    const acrossRows = mean(Array.from({ length: SIZE - 1 }, (_, y) => Math.abs(at(data, 10, y + 1) - at(data, 10, y))));
    expect(acrossRows).toBeGreaterThan(alongRow * 1.5);
  });

  it('tiles seamlessly: the wrap-around step is no larger than a normal step', () => {
    const steps = Array.from({ length: SIZE - 1 }, (_, x) => Math.abs(at(data, x + 1, 20) - at(data, x, 20)));
    expect(Math.abs(at(data, 0, 20) - at(data, SIZE - 1, 20))).toBeLessThanOrEqual(Math.max(...steps) + 1e-9);
  });
});

describe('scaleBoxUvs', () => {
  it('puts UVs in metres with u along the long side of each face', () => {
    const geometry = scaleBoxUvs(new THREE.BoxGeometry(0.6, 2.4, 0.018), [0.6, 2.4, 0.018]);
    const uv = geometry.getAttribute('uv');
    const extent = (face) => {
      const us = [0, 1, 2, 3].map((k) => uv.getX(face * 4 + k));
      const vs = [0, 1, 2, 3].map((k) => uv.getY(face * 4 + k));
      return [Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)];
    };
    // Front face (+z) of a door: 0.6 wide x 2.4 tall -> grain (u) runs vertically, 2.4 m long.
    expect(extent(4)[0]).toBeCloseTo(2.4, 6);
    expect(extent(4)[1]).toBeCloseTo(0.6, 6);
    // Top face (+y): 0.6 wide x 0.018 deep -> u along the width.
    expect(extent(2)[0]).toBeCloseTo(0.6, 6);
    expect(extent(2)[1]).toBeCloseTo(0.018, 6);
  });
});

describe('wood materials', () => {
  const catalog = parseCatalog(loadCatalog());
  const appearance = (color) => ({ material: { catalogId: 'melamine' }, color, finish: { catalogId: 'matte' } });

  it('keeps the grain hint through catalog validation', () => {
    expect(catalog.colors.find((c) => c.id === 'teak').grain).toBe('wood');
    expect(catalog.colors.find((c) => c.id === 'white').grain).toBeUndefined();
  });

  it('adds one shared grain map to wood colours only', () => {
    const materials = createMaterials(catalog);
    const teak = materials.forAppearance(appearance({ catalogId: 'teak' }));
    const walnut = materials.forAppearance(appearance({ catalogId: 'walnut' }));
    expect(teak.map).toBeInstanceOf(THREE.DataTexture);
    expect(walnut.map).toBe(teak.map);
    expect(materials.forAppearance(appearance({ catalogId: 'white' })).map).toBeNull();
    expect(materials.forAppearance(appearance({ custom: true, name: 'Sage', hex: '#9caf88' })).map).toBeNull();
    materials.dispose();
  });

  it('rejects an unknown grain value from the server', () => {
    const bad = { ...loadCatalog(), colors: [{ id: 'x', name: 'X', hex: '#000000', grain: 'marble' }] };
    expect(() => parseCatalog(bad)).toThrow();
  });
});
