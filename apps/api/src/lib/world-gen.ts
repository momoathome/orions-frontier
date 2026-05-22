// ============================================================================
// World Generation Utilities
// Deterministic, seed-based helpers for asteroid world generation.
// Used only by the seeder — not at runtime.
// ============================================================================

import { WORLD_CONFIG, type ZoneType } from './world-config.js';

const { CHUNK_SIZE } = WORLD_CONFIG;

// ── Types ─────────────────────────────────────────────────────────────────────

export type AsteroidSize = 'small' | 'medium' | 'large' | 'massive';

export interface GeneratedVein {
  veinType: 'primary' | 'secondary' | 'trace';
  resourceKey: string;
  yieldPerHour: number;
  purity: number;
  purityTier: string;
}

export interface GeneratedAsteroid {
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  size: AsteroidSize;
  stability: number;
  hiddenLevel: number;
  veins: GeneratedVein[];
}

export interface GeneratedSpawnSlot {
  slotIndex: number;
  x: number;
  y: number;
}

// ── Chunk coordinate helper ───────────────────────────────────────────────────

/**
 * Derive chunk coordinates from world coordinates.
 */
export const worldToChunk = (x: number, y: number): { chunkX: number; chunkY: number } => ({
  chunkX: Math.floor(x / CHUNK_SIZE),
  chunkY: Math.floor(y / CHUNK_SIZE),
});

// ── Seeded pseudo-random number generator (mulberry32) ───────────────────────

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

// ── Zone helpers ─────────────────────────────────────────────────────────────

function getZoneFromRatio(distanceRatio: number): ZoneType {
  if (distanceRatio <= WORLD_CONFIG.ZONES.core.max) return 'core';
  if (distanceRatio <= WORLD_CONFIG.ZONES.midRing.max) return 'midRing';
  if (distanceRatio <= WORLD_CONFIG.ZONES.frontier.max) return 'frontier';
  return 'spawnRing';
}

// ── Weighted random pick from resource pool ───────────────────────────────────

function pickResource(
  pool: { resource: string; weight: number }[],
  exclude: string[],
  rng: SeededRng,
): string {
  const available = pool.filter((p) => !exclude.includes(p.resource));
  if (available.length === 0) return pool[0]!.resource;
  const total = available.reduce((s, p) => s + p.weight, 0);
  const roll = rng.next() * total;
  let acc = 0;
  for (const p of available) {
    acc += p.weight;
    if (roll < acc) return p.resource;
  }
  return available[available.length - 1]!.resource;
}

// ── Size weighted pick ────────────────────────────────────────────────────────

function pickSize(zone: ZoneType, rng: SeededRng): AsteroidSize {
  const w = WORLD_CONFIG.ZONE_SIZE_WEIGHTS[zone];
  const total = w.small + w.medium + w.large + w.massive;
  const roll = rng.next() * total;
  let acc = 0;
  acc += w.small;   if (roll < acc) return 'small';
  acc += w.medium;  if (roll < acc) return 'medium';
  acc += w.large;   if (roll < acc) return 'large';
  return 'massive';
}

// ── Purity roll ───────────────────────────────────────────────────────────────

function rollPurity(rng: SeededRng): { purity: number; purityTier: string } {
  const roll = rng.nextInt(1, 100);
  for (const tier of WORLD_CONFIG.PURITY_TIERS) {
    if (roll >= tier.roll[0] && roll <= tier.roll[1]) {
      return {
        purity: rng.nextFloat(tier.multiplier[0], tier.multiplier[1]),
        purityTier: tier.tier,
      };
    }
  }
  return { purity: 1.0, purityTier: 'normal' };
}

// ── Single asteroid generation ────────────────────────────────────────────────

function buildAsteroid(x: number, y: number, zone: ZoneType, rng: SeededRng): GeneratedAsteroid {
  const size = pickSize(zone, rng);
  const hiddenLvl = WORLD_CONFIG.ZONE_HIDDEN_LEVEL[zone];
  const hiddenLevel = rng.nextInt(hiddenLvl.min, hiddenLvl.max);
  const stability = rng.nextFloat(WORLD_CONFIG.STABILITY_INITIAL.min, WORLD_CONFIG.STABILITY_INITIAL.max);

  const veinRange = WORLD_CONFIG.VEIN_COUNT[size];
  const veinCount = rng.nextInt(veinRange.min, veinRange.max);
  const baseBudget = rng.nextFloat(WORLD_CONFIG.YIELD_BUDGET[size].min, WORLD_CONFIG.YIELD_BUDGET[size].max);

  const pickedResources: string[] = [];
  const veins: GeneratedVein[] = [];

  const veinSlots: Array<{ type: 'primary' | 'secondary' | 'trace'; pool: keyof typeof WORLD_CONFIG.ZONE_PRIMARY_RESOURCES }> = [
    { type: 'primary',   pool: 'ZONE_PRIMARY_RESOURCES'   as any },
    { type: 'secondary', pool: 'ZONE_SECONDARY_RESOURCES' as any },
    { type: 'trace',     pool: 'ZONE_TRACE_RESOURCES'     as any },
  ];

  const pools = {
    primary:   WORLD_CONFIG.ZONE_PRIMARY_RESOURCES[zone]!,
    secondary: WORLD_CONFIG.ZONE_SECONDARY_RESOURCES[zone]!,
    trace:     WORLD_CONFIG.ZONE_TRACE_RESOURCES[zone]!,
  };

  for (let i = 0; i < veinCount; i++) {
    const veinType = veinSlots[i]!.type;
    const pool = pools[veinType];
    const resourceKey = pickResource(pool, pickedResources, rng);
    pickedResources.push(resourceKey);

    const tierKey =
      WORLD_CONFIG.RESOURCE_TIER[resourceKey as keyof typeof WORLD_CONFIG.RESOURCE_TIER] ??
      'low_value';
    const tierModifier = WORLD_CONFIG.TIER_YIELD_MODIFIER[tierKey] ?? 0.6;
    // Single-vein asteroids receive the full budget (modifier = 1.0) because
    const veinModifier = veinCount === 1 ? 1.0 : WORLD_CONFIG.VEIN_MODIFIER[veinType];
    const yieldPerHour = baseBudget * tierModifier * veinModifier;

    const { purity, purityTier } = rollPurity(rng);
    veins.push({ veinType, resourceKey, yieldPerHour, purity, purityTier });
  }

  const { chunkX, chunkY } = worldToChunk(x, y);
  return { x, y, chunkX, chunkY, size, stability, hiddenLevel, veins };
}

// ── Main world generator ──────────────────────────────────────────────────────

export interface GenerateWorldResult {
  worldRadius: number;
  generatedAsteroids: GeneratedAsteroid[];
  generatedSpawnSlots: GeneratedSpawnSlot[];
}

/**
 * Procedurally generates a full asteroid world for the given player count.
 * Deterministic: same playerCount + seed always produces the same world.
 *
 * Zone model (distance from center):
 *   core (0–25%)      → massive/large, high hiddenLevel
 *   midRing (25–55%)  → large/medium
 *   frontier (55–80%) → medium/small
 *   spawnRing (80–100%)→ small/medium, always visible
 */
// ── Spawn slot generation ─────────────────────────────────────────────────────
// Uses a separate RNG stream so changing spawn config doesn't shift asteroid RNG.

function generateSpawnSlots(
  playerCount: number,
  worldRadius: number,
  worldSeed: string,
): GeneratedSpawnSlot[] {
  const rng = new SeededRng(worldSeed + ':spawn');
  const slotRadius = worldRadius * WORLD_CONFIG.SPAWN_CONFIG.RING_FRACTION;
  // Random starting angle so different seeds give different orientations
  const startAngle = rng.next() * 2 * Math.PI;

  return Array.from({ length: playerCount }, (_, i) => {
    const angle = startAngle + (2 * Math.PI * i) / playerCount;
    return {
      slotIndex: i,
      x: Math.round(Math.cos(angle) * slotRadius),
      y: Math.round(Math.sin(angle) * slotRadius),
    };
  });
}

export const generateWorld = (playerCount: number, worldSeed: string): GenerateWorldResult => {
  const worldRadius = WORLD_CONFIG.BASE_RADIUS + playerCount * WORLD_CONFIG.RADIUS_PER_PLAYER;
  const rng = new SeededRng(worldSeed);

  // Generate spawn slots first (independent RNG stream)
  const generatedSpawnSlots = generateSpawnSlots(playerCount, worldRadius, worldSeed);
  const spawnSafeRadiusSq = WORLD_CONFIG.SPAWN_CONFIG.SAFE_RADIUS ** 2;

  const placedPositions: Array<{ x: number; y: number }> = [];
  const generatedAsteroids: GeneratedAsteroid[] = [];

  const maxChunk = Math.ceil(worldRadius / CHUNK_SIZE) + 1;
  const minDistSq = WORLD_CONFIG.ASTEROID_MIN_DISTANCE ** 2;

  for (let cx = -maxChunk; cx <= maxChunk; cx++) {
    for (let cy = -maxChunk; cy <= maxChunk; cy++) {
      // Check if chunk center falls within world radius
      const chunkCenterX = (cx + 0.5) * CHUNK_SIZE;
      const chunkCenterY = (cy + 0.5) * CHUNK_SIZE;
      const chunkDist = Math.sqrt(chunkCenterX ** 2 + chunkCenterY ** 2);
      if (chunkDist > worldRadius) continue;

      const distRatio = chunkDist / worldRadius;
      const zone = getZoneFromRatio(distRatio);
      const density = WORLD_CONFIG.ZONE_DENSITY[zone];
      const count = rng.nextInt(density.min, density.max);

      for (let i = 0; i < count; i++) {
        let placed = false;

        for (let attempt = 0; attempt < 24; attempt++) {
          const x = cx * CHUNK_SIZE + rng.nextFloat(0, CHUNK_SIZE);
          const y = cy * CHUNK_SIZE + rng.nextFloat(0, CHUNK_SIZE);

          // Must be within world radius
          if (x * x + y * y > worldRadius ** 2) continue;

          // Min distance check against all placed asteroids
          let tooClose = false;
          for (const p of placedPositions) {
            const dx = p.x - x;
            const dy = p.y - y;
            if (dx * dx + dy * dy < minDistSq) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          // Safe-zone check: no asteroid within SAFE_RADIUS of any spawn slot
          let inSpawnZone = false;
          for (const slot of generatedSpawnSlots) {
            const dx = slot.x - x;
            const dy = slot.y - y;
            if (dx * dx + dy * dy < spawnSafeRadiusSq) {
              inSpawnZone = true;
              break;
            }
          }
          if (inSpawnZone) continue;

          placedPositions.push({ x, y });
          generatedAsteroids.push(buildAsteroid(x, y, zone, rng));
          placed = true;
          break;
        }

        // If we couldn't place after 24 attempts, skip this slot silently
        void placed;
      }
    }
  }

  return { worldRadius, generatedAsteroids, generatedSpawnSlots };
};;

