/**
 * Seeded randomness for tests: a run that fails must fail the same way tomorrow.
 * mulberry32 (the PRNG the bench scorer and the shape-model trainer use) and a
 * Box-Muller Gaussian over it. Tests that humanise an anchor train or jitter a
 * fixture's anchors take `next` from here and never `Math.random`.
 */

/** A deterministic uniform generator on [0, 1) from a 32-bit seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal draw from a uniform generator (Box-Muller). */
export function gaussian(next: () => number): number {
  const u = Math.max(1e-12, next());
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
