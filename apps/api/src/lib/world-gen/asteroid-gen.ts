// ============================================================================
// world-gen/asteroid-gen.ts
// Asteroid and vein construction helpers.
//
// buildAsteroidBase() keeps shared size, reserve and chunk logic in one place.
// ============================================================================

import { WORLD_CONFIG } from '../world-config.js';
import type { AsteroidSize, VeinType } from '@orions-frontier/shared';
import type { GeneratedAsteroid, GeneratedVein } from './types.js';
import type { SeededRng } from './rng.js';

const { CHUNK_SIZE } = WORLD_CONFIG;

// ── Chunk coordinate helper ────────────────────────────────────────────────────

export const worldToChunk = (x: number, y: number): { chunkX: number; chunkY: number } => ({
  chunkX: Math.floor(x / CHUNK_SIZE),
  chunkY: Math.floor(y / CHUNK_SIZE),
});

// ── Weighted random pick ───────────────────────────────────────────────────────

export function pickWeighted(pool: { resource: string; weight: number }[], rng: SeededRng): string {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return pool[0]!.resource;
  let roll = rng.next() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll < 0) return p.resource;
  }
  return pool[pool.length - 1]!.resource;
}

// ── Size picker ────────────────────────────────────────────────────────────────

export interface SizeWeights {
  small: number;
  medium: number;
  large: number;
  massive: number;
}

export function pickSize(rng: SeededRng, weights?: SizeWeights): AsteroidSize {
  const w = weights ?? WORLD_CONFIG.SIZE_WEIGHTS;
  const total = w.small + w.medium + w.large + w.massive;
  const roll = rng.next() * total;
  let acc = w.small;
  if (roll < acc) return 'small';
  acc += w.medium;
  if (roll < acc) return 'medium';
  acc += w.large;
  if (roll < acc) return 'large';
  return 'massive';
}

// ── Shared asteroid base ───────────────────────────────────────────────────────

interface AsteroidBase {
  size: AsteroidSize;
  resourceAmount: number;
  chunkX: number;
  chunkY: number;
}

function buildAsteroidBase(x: number, y: number, size: AsteroidSize, rng: SeededRng): AsteroidBase {
  const resourceAmount = rng.nextInt(
    WORLD_CONFIG.ASTEROID_RESOURCE_AMOUNT[size].min,
    WORLD_CONFIG.ASTEROID_RESOURCE_AMOUNT[size].max
  );
  const { chunkX, chunkY } = worldToChunk(x, y);
  return { size, resourceAmount, chunkX, chunkY };
}

// ── Core asteroid builder ──────────────────────────────────────────────────────

const VEIN_TYPES: readonly VeinType[] = ['primary', 'secondary', 'trace'];

export function buildAsteroid(
  x: number,
  y: number,
  primaryResource: string,
  secondaryPool: { resource: string; weight: number }[],
  rng: SeededRng,
  sizeWeights?: SizeWeights
): GeneratedAsteroid {
  const size = pickSize(rng, sizeWeights);
  const base = buildAsteroidBase(x, y, size, rng);

  const veinRange = WORLD_CONFIG.VEIN_COUNT[size];
  const veinCount = rng.nextInt(veinRange.min, veinRange.max);
  const amountWeights = Array.from({ length: veinCount }, (_, index) => {
    const veinType = VEIN_TYPES[Math.min(index, VEIN_TYPES.length - 1)]!;
    return veinCount === 1 ? 1 : WORLD_CONFIG.VEIN_MODIFIER[veinType];
  });
  const totalAmountWeight = amountWeights.reduce((sum, weight) => sum + weight, 0);
  let allocatedAmount = 0;

  // Track used resources so no two veins share the same resource.
  const usedResources = new Set<string>([primaryResource]);

  const veins: GeneratedVein[] = [];
  for (let i = 0; i < veinCount; i++) {
    // Clamp index so veinType is always valid even if VEIN_COUNT max ever exceeds 3.
    const veinType = VEIN_TYPES[Math.min(i, VEIN_TYPES.length - 1)]!;

    let resourceKey: string;
    if (i === 0) {
      resourceKey = primaryResource;
    } else {
      // Filter out already-used resources; fall back to full pool if nothing remains.
      const available = secondaryPool.filter((p) => !usedResources.has(p.resource));
      resourceKey = pickWeighted(available.length > 0 ? available : secondaryPool, rng);
      usedResources.add(resourceKey);
    }

    const remainingAmount =
      i === veinCount - 1
        ? base.resourceAmount - allocatedAmount
        : Math.round(base.resourceAmount * (amountWeights[i]! / totalAmountWeight));
    allocatedAmount += remainingAmount;

    veins.push({ veinType, resourceKey, remainingAmount });
  }

  return {
    x,
    y,
    chunkX: base.chunkX,
    chunkY: base.chunkY,
    size,
    hiddenLevel: 0,
    veins,
  };
}

// ── Starter asteroid builder ───────────────────────────────────────────────────
//
// Starter asteroids always have a single primary vein with guaranteed resource.

export function buildStarterAsteroid(
  x: number,
  y: number,
  guaranteed: { primaryResource: string; size: string },
  rng: SeededRng
): GeneratedAsteroid {
  const size = guaranteed.size as AsteroidSize;
  const base = buildAsteroidBase(x, y, size, rng);

  return {
    x,
    y,
    chunkX: base.chunkX,
    chunkY: base.chunkY,
    size,
    hiddenLevel: 0,
    veins: [
      {
        veinType: 'primary',
        resourceKey: guaranteed.primaryResource,
        remainingAmount: base.resourceAmount,
      },
    ],
  };
}
