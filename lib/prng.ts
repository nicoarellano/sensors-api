// Small, dependency-free deterministic PRNG and seed helpers.
//
// The generator seeds a mulberry32 stream from a numeric seed that mixes the
// user seed, the sensor type, and a timestamp bucket, so the same URL always
// yields the same value while different seeds simulate different sensors.

/**
 * mulberry32: a fast 32-bit PRNG. Returns a function producing floats in
 * [0, 1). Deterministic for a given seed.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string to an unsigned 32-bit integer. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mix an arbitrary list of integers into a single unsigned 32-bit seed.
 * Order-sensitive so that (seed, type, bucket, index) tuples spread out.
 */
export function mixSeed(...nums: number[]): number {
  let h = 0x9e3779b9;
  for (const n of nums) {
    h ^= n | 0;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}
