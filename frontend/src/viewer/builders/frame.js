// Derived frame measurements (mm) shared by the builders, plus a box-mesh helper.
// Coordinates: x = 0 at the outer left face, y = 0 at the floor, the front face at
// z = 0 and the back at z = -depth.
import * as THREE from 'three';
import { compartmentXRanges, interiorHeight, interiorWidth } from '../../domain/geometry.js';
import { VISUAL, toM } from '../units.js';

export function frameOf(design) {
  const { width, height, depth } = design.dimensions;
  const panel = design.carcass.panelThickness;
  const innerDepth = depth - VISUAL.backThickness;
  return {
    width, height, depth, panel, innerDepth,
    innerWidth: interiorWidth(design),
    innerHeight: interiorHeight(design),
    // Interior x-range of each compartment, shifted to outer coordinates.
    ranges: compartmentXRanges(design).map(([x0, x1]) => [panel + x0, panel + x1]),
    innerCenterZ: -innerDepth / 2,
  };
}

/**
 * Rewrite a BoxGeometry's UVs in metres, with u along each face's long side. Textures
 * (wood grain) then keep a real-world scale and run lengthwise on every panel.
 * BoxGeometry faces, 4 vertices each: +x, -x (depth x height), +y, -y (width x depth),
 * +z, -z (width x height).
 */
export function scaleBoxUvs(geometry, [w, h, d]) {
  const uv = geometry.getAttribute('uv');
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  faces.forEach(([U, V], face) => {
    for (let k = 0; k < 4; k += 1) {
      const i = face * 4 + k;
      const u = uv.getX(i) * U;
      const v = uv.getY(i) * V;
      if (V > U) uv.setXY(i, v, u);
      else uv.setXY(i, u, v);
    }
  });
  uv.needsUpdate = true;
  return geometry;
}

/** A box mesh from a size and centre given in millimetres. */
export function box({ size: [w, h, d], center: [x, y, z], material, userData }) {
  const metres = [toM(w), toM(h), toM(d)];
  const mesh = new THREE.Mesh(scaleBoxUvs(new THREE.BoxGeometry(...metres), metres), material);
  mesh.position.set(toM(x), toM(y), toM(z));
  mesh.userData = { ...userData };
  return mesh;
}
