// ============================================================================
// world-gen/asteroid-gen.ts
// Asteroid and vein construction helpers.
//
// Optimisations vs. the original world-gen.ts:
//   - buildAsteroidBase() extracts shared logic for size/stability/budget
//     so buildAsteroid and buildStarterAsteroid don't duplicate it.
//   - veinType index is clamped to the valid range instead of non-null asserting
//     past the end of the tuple.
//   - rollPurity uses typed PurityTier values and a safe cfg-lookup fallback.
// ============================================================================

import { WORLD_CONFIG } from '../world-config.js';
import type { AsteroidSize, VeinType, PurityTier } from '@orions-frontier/shared';
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

// ── Purity roll ────────────────────────────────────────────────────────────────

const PURITY_TIER_ORDER: readonly PurityTier[] = ['impure', 'normal', 'rich', 'pure', 'pristine'];

export function rollPurity(rng: SeededRng): { purity: number; purityTier: PurityTier } {
  const weights = WORLD_CONFIG.PURITY_WEIGHTS;
  const total = PURITY_TIER_ORDER.reduce((s, t) => s + (weights[t] ?? 0), 0);
  if (total <= 0) return { purity: 1.0, purityTier: 'normal' };

  let roll = rng.next() * total;
  for (const tier of PURITY_TIER_ORDER) {
    roll -= weights[tier] ?? 0;
    if (roll < 0) {
      const cfg = WORLD_CONFIG.PURITY_TIERS.find((t) => t.tier === tier);
      const purity = cfg ? rng.nextFloat(cfg.multiplier[0], cfg.multiplier[1]) : 1.0;
      return { purity, purityTier: tier };
    }
  }
  return { purity: 1.0, purityTier: 'normal' };
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
  stability: number;
  baseBudget: number;
  chunkX: number;
  chunkY: number;
}

function buildAsteroidBase(x: number, y: number, size: AsteroidSize, rng: SeededRng): AsteroidBase {
  const stability = rng.nextFloat(
    WORLD_CONFIG.STABILITY_INITIAL.min,
    WORLD_CONFIG.STABILITY_INITIAL.max
  );
  const baseBudget = rng.nextFloat(
    WORLD_CONFIG.YIELD_BUDGET[size].min,
    WORLD_CONFIG.YIELD_BUDGET[size].max
  );
  const { chunkX, chunkY } = worldToChunk(x, y);
  return { size, stability, baseBudget, chunkX, chunkY };
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

    const tierKey =
      WORLD_CONFIG.RESOURCE_TIER[resourceKey as keyof typeof WORLD_CONFIG.RESOURCE_TIER] ??
      'low_value';
    const tierModifier = WORLD_CONFIG.TIER_YIELD_MODIFIER[tierKey] ?? 1.0;
    const veinModifier = veinCount === 1 ? 1.0 : WORLD_CONFIG.VEIN_MODIFIER[veinType];
    const yieldPerHour = base.baseBudget * tierModifier * veinModifier;

    const { purity, purityTier } = rollPurity(rng);
    veins.push({ veinType, resourceKey, yieldPerHour, purity, purityTier });
  }

  return {
    x,
    y,
    chunkX: base.chunkX,
    chunkY: base.chunkY,
    size,
    stability: base.stability,
    hiddenLevel: 0,
    veins,
  };
}

// ── Starter asteroid builder ───────────────────────────────────────────────────
//
// Starter asteroids always have a single primary vein with guaranteed resource
// and a fixed purity range (0.9–1.4 = "normal" tier). This is intentional:
// every new player starts with a predictably good mining spot.

export function buildStarterAsteroid(
  x: number,
  y: number,
  guaranteed: { primaryResource: string; size: string },
  rng: SeededRng
): GeneratedAsteroid {
  const size = guaranteed.size as AsteroidSize;
  const base = buildAsteroidBase(x, y, size, rng);

  const tierKey =
    WORLD_CONFIG.RESOURCE_TIER[
      guaranteed.primaryResource as keyof typeof WORLD_CONFIG.RESOURCE_TIER
    ] ?? 'low_value';
  const tierMod = WORLD_CONFIG.TIER_YIELD_MODIFIER[tierKey] ?? 1.0;
  const purity = rng.nextFloat(0.9, 1.4);

  return {
    x,
    y,
    chunkX: base.chunkX,
    chunkY: base.chunkY,
    size,
    stability: base.stability,
    hiddenLevel: 0,
    veins: [
      {
        veinType: 'primary',
        resourceKey: guaranteed.primaryResource,
        yieldPerHour: base.baseBudget * tierMod,
        purity,
        purityTier: 'normal',
      },
    ],
  };
}
