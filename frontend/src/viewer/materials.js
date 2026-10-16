// Appearance -> three.js material, with a cache per distinct appearance.
// Catalog data stays outside the renderer: colours come from the injected catalog.
// Catalog colours flagged `grain: 'wood'` get a procedural wood-grain map (woodGrain.js).
import * as THREE from 'three';
import { GRAIN, woodGrainData } from './woodGrain.js';

// ASSUMPTION: prototype visual mapping, not a material specification.
export const FINISH_ROUGHNESS = Object.freeze({ matte: 0.85, satin: 0.5, gloss: 0.15 });
const DEFAULT_ROUGHNESS = 0.6;
const FALLBACK_COLOR = '#b8b8b8';

const catalogColor = (ref, catalog) => (ref.custom ? null : catalog.colors.find((c) => c.id === ref.catalogId) ?? null);

function resolveColor(ref, catalog) {
  if (ref.custom) return ref.hex ?? FALLBACK_COLOR;
  return catalogColor(ref, catalog)?.hex ?? FALLBACK_COLOR;
}

const resolveRoughness = (ref) => (ref.custom ? DEFAULT_ROUGHNESS : FINISH_ROUGHNESS[ref.catalogId] ?? DEFAULT_ROUGHNESS);

/** One shared, tiling grain texture; UVs are in metres, so the repeat sets the tile size. */
function createGrainTexture() {
  const texture = new THREE.DataTexture(woodGrainData(), GRAIN.size, GRAIN.size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / GRAIN.tileAlong, 1 / GRAIN.tileAcross);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createMaterials(catalog) {
  const cache = new Map();
  const rail = new THREE.MeshStandardMaterial({ color: '#9ea3a8', metalness: 0.8, roughness: 0.3 });
  let grain = null;
  const grainTexture = () => {
    grain ??= createGrainTexture();
    return grain;
  };

  return {
    forAppearance(appearance) {
      const key = JSON.stringify(appearance);
      if (!cache.has(key)) {
        const wood = catalogColor(appearance.color, catalog)?.grain === 'wood';
        cache.set(key, new THREE.MeshStandardMaterial({
          color: resolveColor(appearance.color, catalog),
          roughness: resolveRoughness(appearance.finish),
          metalness: 0,
          ...(wood ? { map: grainTexture() } : {}),
        }));
      }
      return cache.get(key);
    },
    rail,
    /** Dispose cached materials the current scene no longer uses (keeps memory bounded). */
    retainOnly(inUse) {
      for (const [key, material] of cache) {
        if (!inUse.has(material)) {
          material.dispose();
          cache.delete(key);
        }
      }
    },
    dispose() {
      cache.forEach((material) => material.dispose());
      cache.clear();
      rail.dispose();
      grain?.dispose();
    },
  };
}
