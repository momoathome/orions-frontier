// ============================================================================
// World Generation Utilities
// Deterministic, seed-based helpers for asteroid world generation.
// Used only by the seeder — not at runtime.
// ============================================================================

export { CHUNK_SIZE } from '@orions-frontier/shared';
import { CHUNK_SIZE } from '@orions-frontier/shared';

/**
 * Derive chunk coordinates from world coordinates.
 */
export const worldToChunk = (x: number, y: number): { chunkX: number; chunkY: number } => ({
  chunkX: Math.floor(x / CHUNK_SIZE),
  chunkY: Math.floor(y / CHUNK_SIZE),
});

// ============================================================================
// Seeded pseudo-random number generator (mulberry32)
// Produces deterministic floats in [0, 1) from a 32-bit integer seed.
// ============================================================================

const hashSeed = (seed: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h >>> 0;
};

export class SeededRng {
  private state: number;

  constructor(seed: string) {
    this.state = hashSeed(seed);
  }

  /** Returns a float in [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] (inclusive) */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns a float in [min, max) */
  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns a random element from an array */
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}

// ============================================================================
// Asteroid position generation within a cluster
// ============================================================================

export interface ClusterSpec {
  centerX: number;
  centerY: number;
  radius: number;
  seed: string;
}

/**
 * Generates `count` random (x, y) world positions within a cluster radius.
 * Uses rejection sampling to keep positions inside the circular cluster area.
 * Deterministic: same spec + count always yields the same positions.
 */
export const generateClusterPositions = (
  spec: ClusterSpec,
  count: number,
): Array<{ x: number; y: number }> => {
  const rng = new SeededRng(spec.seed + ':positions');
  const positions: Array<{ x: number; y: number }> = [];
  let attempts = 0;

  while (positions.length < count && attempts < count * 10) {
    attempts++;
    const dx = rng.nextFloat(-spec.radius, spec.radius);
    const dy = rng.nextFloat(-spec.radius, spec.radius);
    if (dx * dx + dy * dy <= spec.radius * spec.radius) {
      positions.push({ x: spec.centerX + dx, y: spec.centerY + dy });
    }
  }

  return positions;
};
