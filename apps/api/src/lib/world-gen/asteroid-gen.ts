import { WORLD_CONFIG } from '../world-config.js';
import { resources } from '@orions-frontier/game-config';
import type { AsteroidSize, ResourceKey, VeinType } from '@orions-frontier/shared';
import type { GeneratedAsteroid, GeneratedVein } from './types.js';
import type { SeededRng } from './rng.js';

const { CHUNK_SIZE } = WORLD_CONFIG;

const worldToChunk = (x: number, y: number): { chunkX: number; chunkY: number } => ({
  chunkX: Math.floor(x / CHUNK_SIZE),
  chunkY: Math.floor(y / CHUNK_SIZE),
});

export function pickWeighted(
  pool: readonly { resource: string; weight: number }[],
  rng: SeededRng
): string {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return pool[0]!.resource;
  let roll = rng.next() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll < 0) return p.resource;
  }
  return pool[pool.length - 1]!.resource;
}

export interface SizeWeights {
  small: number;
  medium: number;
  large: number;
  massive: number;
}

function pickSize(rng: SeededRng, weights: SizeWeights): AsteroidSize {
  const w = weights;
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

const VEIN_TYPES: readonly VeinType[] = ['primary', 'secondary', 'trace'];

const isRareResource = (resourceKey: string): boolean =>
  resources[resourceKey as ResourceKey]?.rarity === 'rare';

function majorPoolForSize(
  size: AsteroidSize,
  veinType: VeinType,
  pool: readonly { resource: string; weight: number }[]
) {
  if (size !== 'massive' || veinType === 'trace') return pool;
  const nonRarePool = pool.filter((resource) => !isRareResource(resource.resource));
  return nonRarePool.length > 0 ? nonRarePool : pool;
}

export function buildAsteroid(
  x: number,
  y: number,
  primaryResource: string,
  secondaryPool: readonly { resource: string; weight: number }[],
  rng: SeededRng,
  sizeWeights: SizeWeights
): GeneratedAsteroid {
  const size = pickSize(rng, sizeWeights);
  const base = buildAsteroidBase(x, y, size, rng);

  const veinRange = WORLD_CONFIG.VEIN_COUNT[size];
  const veinCount = rng.nextInt(veinRange.min, veinRange.max);
  const amountWeights = Array.from({ length: veinCount }, (_, index) => {
    const veinType = VEIN_TYPES[Math.min(index, VEIN_TYPES.length - 1)]!;
    return veinCount === 1 ? 1 : WORLD_CONFIG.VEIN_WEIGHTS[veinType];
  });
  const totalAmountWeight = amountWeights.reduce((sum, weight) => sum + weight, 0);
  let allocatedAmount = 0;

  const usedResources = new Set<string>();

  const veins: GeneratedVein[] = [];
  for (let i = 0; i < veinCount; i++) {
    const veinType = VEIN_TYPES[Math.min(i, VEIN_TYPES.length - 1)]!;

    let resourceKey: string;
    if (i === 0 && !(size === 'massive' && isRareResource(primaryResource))) {
      resourceKey = primaryResource;
    } else {
      const pool = majorPoolForSize(size, veinType, secondaryPool);
      const available = pool.filter((p) => !usedResources.has(p.resource));
      resourceKey = pickWeighted(available.length > 0 ? available : pool, rng);
    }
    usedResources.add(resourceKey);

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
    veins,
  };
}

export function buildStarterAsteroid(
  x: number,
  y: number,
  guaranteed: { primaryResource: string; size: AsteroidSize },
  rng: SeededRng
): GeneratedAsteroid {
  const base = buildAsteroidBase(x, y, guaranteed.size, rng);

  return {
    x,
    y,
    chunkX: base.chunkX,
    chunkY: base.chunkY,
    size: guaranteed.size,
    veins: [
      {
        veinType: 'primary',
        resourceKey: guaranteed.primaryResource,
        remainingAmount: base.resourceAmount,
      },
    ],
  };
}
