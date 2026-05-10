/**
 * Tiny deterministic PRNG + coordinate hashing helpers.
 * Used by World to pick a chunk template per (cx, cy) given a world seed.
 */

/**
 * mulberry32 — a fast, simple 32-bit PRNG with decent statistical quality.
 * Returns a function that yields values in [0, 1) on each call.
 * Reference: https://gist.github.com/tommyettinger/46a3a48b4a9d0aac0832f72b58a48ace
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Combine a world seed with chunk coordinates into a single 32-bit hash.
 * Same (seed, cx, cy) always produces the same value, so chunk content is
 * reproducible across reloads and across players sharing a seed.
 */
export function hashCoords(seed, cx, cy) {
  let h = (seed | 0) >>> 0;
  h = Math.imul(h ^ (cx | 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h ^ (cy | 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Pick a fresh world seed when none is supplied via URL or localStorage. */
export function randomSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}
