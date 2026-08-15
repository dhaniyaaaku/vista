/**
 * Small deterministic PRNG.
 *
 * Used in two places, both of which depend on being reproducible:
 *  - the demo city, so it looks identical on every load
 *  - per-building variation (rotation, roof style, colour jitter), seeded from `entry.id`, so a
 *    varied city can be regenerated from the data alone with no coordinates ever stored
 */

/** FNV-1a. Turns a UUID into a 32-bit seed. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 — fast, tiny, good enough for visual variation. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable RNG for one record, keyed by its id. */
export function rngFor(id: string): () => number {
  return mulberry32(hashString(id));
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

/** Integer in [min, max] inclusive. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
