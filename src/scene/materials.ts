/**
 * Night materials.
 *
 * The city is only ever seen after dark, so almost all of its visual information comes from
 * emissive surfaces rather than lit ones. Buildings are near-black with a procedural window
 * texture doing the work, tinted per building through the instance colour.
 */

import * as THREE from 'three';

/**
 * Warm amber dominates so the city reads as one place. The cool tints are occasional accents for
 * variety, deliberately not semantic — a building's colour says nothing about what it commemorates.
 */
export const WINDOW_TINTS = [
  0xffc27a, 0xffd49a, 0xffb055, 0xffe0b8, // warm, the majority
  0x8fc4f0, 0xab9cea, 0x6fdccc, 0xf0a0b4, // cool accents
] as const;

/** Weighted pick so the great majority of the city is warm and the cool tints stay accents. */
export function tintFor(variation: number): number {
  const warm = variation < 0.84;
  const pool = warm ? WINDOW_TINTS.slice(0, 4) : WINDOW_TINTS.slice(4);
  const index = Math.floor(((variation * 137.508) % 1) * pool.length);
  return pool[Math.min(index, pool.length - 1)];
}

/**
 * Daylight facade colours, one per window tint.
 *
 * Deliberately saturated rather than derived by washing the night tint toward pale stone — that
 * approach produced a city of identical pastels with no colour of its own. These are real facade
 * materials: terracotta, painted render, glass curtain wall, weathered copper.
 */
const DAY_TINTS: Record<number, number> = {
  0xffc27a: 0xc4703a, // terracotta
  0xffd49a: 0xd9a04e, // ochre
  0xffb055: 0xa8452c, // burnt brick
  0xffe0b8: 0xe0c48c, // sandstone
  0x8fc4f0: 0x2f6fb5, // blue glass
  0xab9cea: 0x6b52b8, // plum render
  0x6fdccc: 0x2e9c8a, // weathered copper
  0xf0a0b4: 0xc4507a, // rose
};

/** Facade colour for a given window tint. Falls back to a neutral render. */
export function dayTintFor(nightTint: number): number {
  return DAY_TINTS[nightTint] ?? 0x9a9186;
}

/**
 * Procedural window grid.
 *
 * Cheaper and sharper than an image asset, and the randomly-dark windows are what stop a row of
 * identical towers from reading as a texture repeat.
 */
export function makeWindowTexture(seed = 7): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const cols = 6;
  const rows = 12;
  const cellW = size / cols;
  const cellH = size / rows;
  const winW = cellW * 0.44;
  const winH = cellH * 0.42;

  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const roll = rand();
      if (roll < 0.28) continue; // a dark window — nobody is home
      const brightness = roll < 0.55 ? 0.55 : roll < 0.85 ? 0.8 : 1;
      ctx.fillStyle = `rgba(255,255,255,${brightness})`;
      ctx.fillRect(
        c * cellW + (cellW - winW) / 2,
        r * cellH + (cellH - winH) / 2,
        winW,
        winH,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Building material, one per window tint.
 *
 * Colour is baked into `emissive` rather than driven by `instanceColor`, because in current three
 * `color_pars_fragment` only declares `vColor` for USE_COLOR / USE_COLOR_ALPHA — never for
 * USE_INSTANCING_COLOR. Instance colour therefore cannot reach the fragment shader's emissive
 * term at all, and forcing it with `vertexColors: true` makes the shader sample a `color`
 * geometry attribute that instanced boxes do not have, which renders the entire city black.
 *
 * One material per tint costs a handful of extra draw calls and needs no shader patching.
 */
export function makeBuildingMaterial(
  windowTexture: THREE.Texture,
  tint: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x0b0d14,
    roughness: 0.82,
    metalness: 0.1,
    emissive: tint,
    // Low. The window texture is mostly-white pixels over a large surface, so anything near 1.0
    // clips the entire city to a flat sheet of light once bloom is applied on top.
    emissiveMap: windowTexture,
    emissiveIntensity: 0.8,
  });
}

/** Unlit structures — bridges — that read as dark shapes rather than glowing ones. */
export function makeQuietMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x2a3145,
    roughness: 0.9,
    metalness: 0.1,
  });
}

/** Trees and planting. Kept faintly self-lit so green still reads at night. */
export function makeNatureMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x25452c,
    roughness: 1,
    metalness: 0,
    emissive: 0x3d8a4e,
    emissiveIntensity: 0.18,
  });
}

/** Street lamps. Small, numerous, and the main thing that makes streets legible from the air. */
export function makeLampMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x14161f,
    roughness: 0.6,
    emissive: 0xffcf96,
    emissiveIntensity: 0.8,
  });
}

/** Milestones: the brightest thing in frame, and the only saturated colour that carries meaning. */
export function makeInstallationMaterial(tint: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x120a10,
    roughness: 0.25,
    metalness: 0.4,
    emissive: tint,
    // Bright enough to be the first thing the eye lands on, low enough that tone mapping does
    // not clip the colour straight to white.
    emissiveIntensity: 1.15,
  });
}
