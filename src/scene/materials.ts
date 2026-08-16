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

/**
 * Commitment towers.
 *
 * Deliberately unlike every other building: a tighter, brighter window grid and a cool metallic
 * facade, so a tower reads as a landmark rather than as a very tall house.
 */
export function makeTowerMaterial(
  towerTexture: THREE.Texture,
  tint: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x14161f,
    roughness: 0.36,
    metalness: 0.55,
    emissive: tint,
    emissiveMap: towerTexture,
    emissiveIntensity: 0.72,
  });
}

/** A denser, more regular grid than the housing texture. Corporate rather than domestic. */
export function makeTowerTexture(seed = 19): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const cols = 10;
  const rows = 22;
  const cellW = size / cols;
  const cellH = size / rows;

  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  for (let r = 0; r < rows; r += 1) {
    // Whole floors go dark together, which is what office towers actually do at night.
    const floorLit = rand() > 0.18;
    for (let c = 0; c < cols; c += 1) {
      if (!floorLit && rand() < 0.82) continue;
      const roll = rand();
      if (roll < 0.12) continue;
      ctx.fillStyle = `rgba(255,255,255,${roll < 0.5 ? 0.7 : 1})`;
      ctx.fillRect(c * cellW + cellW * 0.2, r * cellH + cellH * 0.22, cellW * 0.6, cellH * 0.5);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

/**
 * Ground wash.
 *
 * The city sits on a disc that runs to the horizon, and a single flat dark colour across it looks
 * like a void rather than land. This puts a warm pool of light under the city itself, fading out
 * with distance, so the ground has depth and the city has somewhere to belong.
 */
export function makeGroundTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // The city occupies roughly the middle tenth of this disc, so the warm core stays tight.
  g.addColorStop(0, '#3a2b3f');
  g.addColorStop(0.05, '#2c2233');
  g.addColorStop(0.16, '#191428');
  g.addColorStop(0.45, '#0d0b1a');
  g.addColorStop(1, '#08070f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Water between the islands.
 *
 * A flat lit plane never reads as water no matter what colour it is — it reads as a floor. Water
 * is recognisable because of three things, all of which are cheap:
 *
 *   - Fresnel. Looking straight down you see the dark depths; looking out toward the horizon the
 *     surface turns into a mirror of the sky. That gradient alone does most of the work.
 *   - A moving surface. Two layers of drifting noise, one fine and one broad, so it never sits
 *     still and never repeats visibly.
 *   - Sun glitter. A tight specular highlight scattered by the ripples, which is the single most
 *     recognisable thing about a body of water.
 */
export function makeWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      deepColor: { value: new THREE.Color(0x050a18) },
      skyColor: { value: new THREE.Color(0x2a1550) },
      sunColor: { value: new THREE.Color(0xffe0b0) },
      sunDirection: { value: new THREE.Vector3(-0.6, 0.5, -0.5).normalize() },
      glitter: { value: 0.5 },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 deepColor;
      uniform vec3 skyColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform float glitter;
      uniform float time;
      varying vec3 vWorld;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec3 view = normalize(cameraPosition - vWorld);

        // Two drifting layers give a surface that moves without ever visibly repeating.
        vec2 p = vWorld.xz * 0.035;
        float ripple =
          noise(p + vec2(time * 0.06, time * 0.04)) * 0.6 +
          noise(p * 2.7 - vec2(time * 0.09, time * 0.05)) * 0.4;

        // Perturb the surface normal by the slope of the ripples.
        vec3 normal = normalize(vec3((ripple - 0.5) * 0.30, 1.0, (ripple - 0.5) * 0.30));

        // Fresnel: depths underfoot, sky at the horizon. This is what makes it read as water.
        float fres = pow(1.0 - clamp(dot(view, normal), 0.0, 1.0), 3.0);
        vec3 c = mix(deepColor, skyColor, clamp(fres * 1.15, 0.0, 1.0));

        // Sun glitter, broken up by the ripples so it scatters into a path rather than a disc.
        // Note: "half" is a reserved word in GLSL and cannot be a variable name.
        vec3 halfVec = normalize(view + normalize(sunDirection));
        float spec = pow(max(dot(normal, halfVec), 0.0), 180.0);
        c += sunColor * spec * glitter * (0.55 + ripple * 0.8);

        gl_FragColor = vec4(c, 1.0);
      }
    `,
    // Deliberately not fogged. A ShaderMaterial with `fog: true` needs THREE.UniformsLib.fog
    // merged into its uniforms, and without them three throws inside refreshFogUniforms on every
    // single frame. The fresnel term already fades the surface to the sky colour toward the
    // horizon, which is the effect fog would have provided anyway.
    fog: false,
  });
}

/** Island ground. */
export function makeIslandMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x16182a, roughness: 1, metalness: 0 });
}

/** The bridge between two years. Lit, because it is the thread joining them. */
export function makeBridgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x2a2540,
    roughness: 0.5,
    emissive: 0xffc98a,
    emissiveIntensity: 0.55,
  });
}

/** Billboards for months not yet built. */
export function makeBillboardMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x3a4256,
    roughness: 0.85,
    emissive: 0x8fa4c8,
    emissiveIntensity: 0.32,
  });
}

/** Gardens and groves earned by consistency. Self-lit so green still reads at night. */
export function makeGardenMaterial(tint: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x1d3a26,
    roughness: 0.9,
    emissive: tint,
    emissiveIntensity: 0.5,
  });
}

/** Monuments. Pale stone, lit, meant to be the landmark of a finished year. */
export function makeMonumentMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x2c2a3a,
    roughness: 0.42,
    metalness: 0.3,
    emissive: 0xffe6c0,
    emissiveIntensity: 0.62,
  });
}

/**
 * A tower's own facade, one row per expected occurrence.
 *
 * Rows are lit where the commitment was kept and dark where it was missed, so the tower is a
 * legible record of the year rather than decoration. Expected occurrences come from the declared
 * cadence rather than from calendar days: one row per day would leave a twice-monthly commitment
 * 93 percent dark and unable to ever earn a monument.
 */
export function makeTowerFacadeTexture(litRatio: number, seed: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 26;
  const cellW = size / cols;
  const cellH = size / rows;

  let state = seed >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  for (let r = 0; r < rows; r += 1) {
    // Whole floors are lit or dark together: a floor is one occurrence, kept or missed.
    if (rand() > litRatio) continue;
    for (let c = 0; c < cols; c += 1) {
      if (rand() < 0.1) continue;
      ctx.fillStyle = `rgba(255,255,255,${rand() < 0.5 ? 0.75 : 1})`;
      ctx.fillRect(c * cellW + cellW * 0.22, r * cellH + cellH * 0.24, cellW * 0.56, cellH * 0.48);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
