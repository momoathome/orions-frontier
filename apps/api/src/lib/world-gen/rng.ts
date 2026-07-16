// ============================================================================
// world-gen/rng.ts
// Seeded pseudo-random number generator (mulberry32 variant).
// ============================================================================

const hashSeed = (seed: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export class SeededRng {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns a float in [min, max). */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns a random element from a readonly array. */
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}
