/**
 * A seeded PRNG, so a household generates identically every time
 * (11 Mock Data: "fixed seed, no randomness at runtime beyond a seeded
 * generator", and `verify:inference` asserts two generations are identical).
 *
 * mulberry32: tiny, fast, and good enough for mock transaction amounts. Not for
 * anything security-sensitive, which this never is.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small deterministic helper set built on one stream. */
export class SeededRandom {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** A stable shuffle (Fisher-Yates) that does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = copy[i]!;
      const b = copy[j]!;
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  }
}
