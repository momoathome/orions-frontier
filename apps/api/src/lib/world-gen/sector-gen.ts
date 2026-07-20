// ============================================================================
// world-gen/sector-gen.ts
// Sector-level generation: spawn slots, starter pockets, field clusters,
// background scatter, and the main generateSector entry point.
//
// Pipeline (per sector):
//   1. Spawn slots   — Sub-sector grid placement (one slot per player cell)
//   2. Starter pockets — guaranteed asteroid clusters near every spawn slot
//   3. Field clusters  — 1–3 shaped asteroid groups
//   4. Background      — sparse core-resource asteroids filling remaining space
//
// Optimisations vs. the original world-gen.ts:
//   - SpatialGrid replaces the O(n) linear scan for asteroid-distance checks,
//     reducing placement from O(n²) to O(n) overall.
//   - Spawn slots use Sub-sector grid placement instead of a fixed ring,
//     giving each player their own guaranteed territory.
// ============================================================================

import { WORLD_CONFIG } from '../world-config.js';
import { SeededRng } from './rng.js';
import { buildShapeSpec, shapeArea, sampleShapeSpec } from './shapes.js';
import type { ShapeSpec } from './shapes.js';
import { buildAsteroid, buildStarterAsteroid, pickWeighted } from './asteroid-gen.js';

// ── Personality type (inferred from config) ───────────────────────────────────

type SectorPersonality = (typeof WORLD_CONFIG.SECTOR_PERSONALITIES)[number];

/** Generic weighted-pick over any array of objects with a `weight` field. */
function pickWeightedItem<T extends { weight: number }>(items: readonly T[], rng: SeededRng): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng.next() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1]!;
}
import type { SizeWeights } from './asteroid-gen.js';
import type { GeneratedAsteroid, GeneratedSpawnSlot, GeneratedSector } from './types.js';

type Point = { x: number; y: number };

// ── Spatial grid for O(1) asteroid-distance checks ────────────────────────────
//
// Grid cell size equals ASTEROID_MIN_DISTANCE. Checking a 3×3 neighbourhood
// around the candidate cell is sufficient to catch all conflicts.

class SpatialGrid {
  private readonly cells = new Map<string, Point[]>();
  private readonly cellSize: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private cell(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  add(x: number, y: number): void {
    const k = this.key(this.cell(x), this.cell(y));
    const list = this.cells.get(k);
    if (list) list.push({ x, y });
    else this.cells.set(k, [{ x, y }]);
  }

  isClearAt(x: number, y: number, minDistSq: number): boolean {
    const cx = this.cell(x),
      cy = this.cell(y);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const pts = this.cells.get(this.key(cx + dx, cy + dy));
        if (!pts) continue;
        for (const p of pts) {
          const ddx = p.x - x,
            ddy = p.y - y;
          if (ddx * ddx + ddy * ddy < minDistSq) return false;
        }
      }
    }
    return true;
  }
}

// ── Placement guard ────────────────────────────────────────────────────────────

function canPlaceAt(
  x: number,
  y: number,
  sectorCenterX: number,
  sectorCenterY: number,
  halfW: number,
  halfH: number,
  grid: SpatialGrid,
  spawnSlots: GeneratedSpawnSlot[],
  spawnSafeRadiusSq: number
): boolean {
  if (
    x < sectorCenterX - halfW ||
    x > sectorCenterX + halfW ||
    y < sectorCenterY - halfH ||
    y > sectorCenterY + halfH
  )
    return false;

  const minDistSq = WORLD_CONFIG.ASTEROID_MIN_DISTANCE ** 2;
  if (!grid.isClearAt(x, y, minDistSq)) return false;

  for (const slot of spawnSlots) {
    const dx = slot.x - x,
      dy = slot.y - y;
    if (dx * dx + dy * dy < spawnSafeRadiusSq) return false;
  }

  return true;
}

// ── Spawn slot generation — Sub-sector grid ────────────────────────────────────
//
// The sector is divided into a cols×rows grid of equal cells. Each player gets
// one cell and is placed randomly inside it (with a margin from cell edges and
// from sector boundaries). This guarantees:
//   - Even territorial distribution — no two players share a cell.
//   - Implicit minimum distance determined by cell dimensions.
//   - Each slot uses its own deterministic RNG stream (:spawn:N).

function generateSectorSpawnSlots(
  sectorX: number,
  sectorY: number,
  sectorSeed: string,
  playerCapacity: number,
  slotIndexOffset: number
): GeneratedSpawnSlot[] {
  const { WIDTH, HEIGHT, SAFE_SPAWN_RADIUS } = WORLD_CONFIG.SECTOR;
  const sectorLeft = sectorX * WIDTH - WIDTH / 2;
  const sectorTop = sectorY * HEIGHT - HEIGHT / 2;

  // Compute grid dimensions that best fit playerCapacity into a near-square layout.
  const cols = Math.ceil(Math.sqrt(playerCapacity));
  const rows = Math.ceil(playerCapacity / cols);
  const cellW = WIDTH / cols;
  const cellH = HEIGHT / rows;

  // Margin keeps slots away from cell edges; edge pad keeps them inside the sector.
  const marginX = Math.max(cellW * 0.15, SAFE_SPAWN_RADIUS);
  const marginY = Math.max(cellH * 0.15, SAFE_SPAWN_RADIUS);

  const slots: GeneratedSpawnSlot[] = [];

  for (let i = 0; i < playerCapacity; i++) {
    const rng = new SeededRng(`${sectorSeed}:spawn:${i}`);
    const col = i % cols;
    const row = Math.floor(i / cols);

    const cellLeft = sectorLeft + col * cellW;
    const cellTop = sectorTop + row * cellH;

    // Placeable area within cell, clamped to sector bounds with edge padding.
    const minX = Math.max(sectorLeft + SAFE_SPAWN_RADIUS, cellLeft + marginX);
    const maxX = Math.min(sectorLeft + WIDTH - SAFE_SPAWN_RADIUS, cellLeft + cellW - marginX);
    const minY = Math.max(sectorTop + SAFE_SPAWN_RADIUS, cellTop + marginY);
    const maxY = Math.min(sectorTop + HEIGHT - SAFE_SPAWN_RADIUS, cellTop + cellH - marginY);

    // Fallback to cell centre if margins leave no room (shouldn't happen in normal configs).
    const x = minX < maxX ? rng.nextFloat(minX, maxX) : cellLeft + cellW / 2;
    const y = minY < maxY ? rng.nextFloat(minY, maxY) : cellTop + cellH / 2;

    slots.push({ slotIndex: slotIndexOffset + i, x: Math.round(x), y: Math.round(y) });
  }

  return slots;
}

// ── Starter pocket generation ─────────────────────────────────────────────────
//
// Guaranteed asteroid clusters around each spawn slot. Starter asteroids are
// allowed inside the spawn-safe zone (spawnSlots passed as [] to canPlaceAt)
// because they are intentionally close to the spawn point.

function generateStarterPockets(
  spawnSlots: GeneratedSpawnSlot[],
  sectorCenterX: number,
  sectorCenterY: number,
  halfW: number,
  halfH: number,
  sectorSeed: string,
  grid: SpatialGrid
): GeneratedAsteroid[] {
  const rng = new SeededRng(sectorSeed + ':starter');
  const cfg = WORLD_CONFIG.STARTER_POCKET;
  const result: GeneratedAsteroid[] = [];

  for (const slot of spawnSlots) {
    for (const guaranteed of cfg.GUARANTEED) {
      for (let attempt = 0; attempt < 64; attempt++) {
        const dist = rng.nextFloat(cfg.MIN_DIST, cfg.MAX_DIST);
        const angle = rng.next() * Math.PI * 2;
        const x = slot.x + Math.cos(angle) * dist;
        const y = slot.y + Math.sin(angle) * dist;

        if (!canPlaceAt(x, y, sectorCenterX, sectorCenterY, halfW, halfH, grid, [], 0)) continue;

        grid.add(x, y);
        result.push(buildStarterAsteroid(x, y, guaranteed, rng));
        break;
      }
    }
  }

  return result;
}

// ── Field cluster generation ──────────────────────────────────────────────────

function generateFields(
  sectorCenterX: number,
  sectorCenterY: number,
  halfW: number,
  halfH: number,
  spawnSlots: GeneratedSpawnSlot[],
  spawnSafeRadiusSq: number,
  grid: SpatialGrid,
  rng: SeededRng,
  personality: SectorPersonality
): GeneratedAsteroid[] {
  const asteroids: GeneratedAsteroid[] = [];
  const fieldPool = WORLD_CONFIG.FIELD_RESOURCES as { resource: string; weight: number }[];
  const [minFields, maxFields] = personality.fieldCount;
  const fieldCount = rng.nextInt(minFields, maxFields);
  const sizeWeights = WORLD_CONFIG.FIELD_SIZE_WEIGHTS as SizeWeights;

  for (let f = 0; f < fieldCount; f++) {
    const primaryResource = pickWeighted(fieldPool, rng);

    // ── vast_field: single giant dense_disk spanning most of the sector ──────
    let spec: ShapeSpec;
    let shapeKey: string;

    if (personality.vastField) {
      shapeKey = 'dense_disk';
      // Place center very close to sector centre (±10% of halfW/H).
      const cx = sectorCenterX + rng.nextFloat(-halfW * 0.1, halfW * 0.1);
      const cy = sectorCenterY + rng.nextFloat(-halfH * 0.1, halfH * 0.1);
      // Disk radius = 55–80% of sector half-width → diameter fills most of sector.
      const radius = rng.nextFloat(halfW * 0.55, halfW * 0.8);
      spec = { shapeKey, cx, cy, p: { radius } };
    } else {
      shapeKey = rng.pick(WORLD_CONFIG.FIELD_SHAPES);
      spec = buildShapeSpec(shapeKey, sectorCenterX, sectorCenterY, halfW, halfH, rng);
    }

    const area = shapeArea(spec);
    // vast_field uses a higher density multiplier for an impressive crowded look.
    const baseDensity = WORLD_CONFIG.FIELD_DENSITY_FACTOR[shapeKey] ?? 0.04;
    const density = personality.vastField ? baseDensity * 1.5 : baseDensity;
    const count = Math.max(4, Math.round(Math.sqrt(area) * density * rng.nextFloat(0.7, 1.4)));
    const points = sampleShapeSpec(spec, count, rng);

    const isMixedField = count > WORLD_CONFIG.FIELD_PURE_MAX;
    for (const pt of points) {
      if (
        !canPlaceAt(
          pt.x,
          pt.y,
          sectorCenterX,
          sectorCenterY,
          halfW,
          halfH,
          grid,
          spawnSlots,
          spawnSafeRadiusSq
        )
      )
        continue;

      grid.add(pt.x, pt.y);
      const resource = isMixedField ? pickWeighted(fieldPool, rng) : primaryResource;
      asteroids.push(buildAsteroid(pt.x, pt.y, resource, fieldPool, rng, sizeWeights));
    }
  }

  return asteroids;
}

// ── Background scatter ────────────────────────────────────────────────────────
//
// Sparse uniform scatter of core-resource asteroids across the whole sector.
// Uses an independent RNG stream (:background) for deterministic placement and reserves.

function generateBackground(
  sectorCenterX: number,
  sectorCenterY: number,
  halfW: number,
  halfH: number,
  spawnSlots: GeneratedSpawnSlot[],
  spawnSafeRadiusSq: number,
  grid: SpatialGrid,
  sectorSeed: string,
  count: number
): GeneratedAsteroid[] {
  const rng = new SeededRng(sectorSeed + ':background');
  const pool = WORLD_CONFIG.BACKGROUND_RESOURCES as { resource: string; weight: number }[];
  const sizeWeights = WORLD_CONFIG.BACKGROUND_SIZE_WEIGHTS as SizeWeights;
  const result: GeneratedAsteroid[] = [];

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = sectorCenterX + rng.nextFloat(-halfW, halfW);
      const y = sectorCenterY + rng.nextFloat(-halfH, halfH);

      if (
        !canPlaceAt(
          x,
          y,
          sectorCenterX,
          sectorCenterY,
          halfW,
          halfH,
          grid,
          spawnSlots,
          spawnSafeRadiusSq
        )
      )
        continue;

      grid.add(x, y);
      result.push(buildAsteroid(x, y, pickWeighted(pool, rng), pool, rng, sizeWeights));
      break;
    }
  }

  return result;
}

// ── Main sector generator ─────────────────────────────────────────────────────

/**
 * Generates a single sector deterministically.
 *
 * @param sectorX         Sector grid column (negative = west)
 * @param sectorY         Sector grid row    (negative = north)
 * @param worldSeed       Master world seed; combined with coords for per-sector seed
 * @param slotIndexOffset Starting index for spawn slot numbering (multi-sector worlds)
 */
export const generateSector = (
  sectorX: number,
  sectorY: number,
  worldSeed: string,
  slotIndexOffset: number = 0
): GeneratedSector => {
  const sectorSeed = `${worldSeed}:${sectorX}:${sectorY}`;
  const rng = new SeededRng(sectorSeed);

  // Roll sector personality — determines background density and field count.
  const personality = pickWeightedItem(WORLD_CONFIG.SECTOR_PERSONALITIES, rng);

  const { WIDTH, HEIGHT, PLAYER_CAPACITY, SAFE_SPAWN_RADIUS } = WORLD_CONFIG.SECTOR;
  const halfW = WIDTH / 2;
  const halfH = HEIGHT / 2;
  const sectorCenterX = sectorX * WIDTH;
  const sectorCenterY = sectorY * HEIGHT;
  const spawnSafeRadiusSq = SAFE_SPAWN_RADIUS ** 2;

  // Spatial grid for fast asteroid-distance checks (cell size = min distance).
  const grid = new SpatialGrid(WORLD_CONFIG.ASTEROID_MIN_DISTANCE);

  // 1. Spawn slots — sub-sector grid, one cell per player.
  const spawnSlots = generateSectorSpawnSlots(
    sectorX,
    sectorY,
    sectorSeed,
    PLAYER_CAPACITY,
    slotIndexOffset
  );

  const asteroidList: GeneratedAsteroid[] = [];

  // 2. Starter pockets — guaranteed resources near every spawn slot.
  asteroidList.push(
    ...generateStarterPockets(
      spawnSlots,
      sectorCenterX,
      sectorCenterY,
      halfW,
      halfH,
      sectorSeed,
      grid
    )
  );

  // 3. Field clusters — shaped asteroid groups (before background to fill gaps first).
  const fieldAsteroids = generateFields(
    sectorCenterX,
    sectorCenterY,
    halfW,
    halfH,
    spawnSlots,
    spawnSafeRadiusSq,
    grid,
    rng,
    personality
  );
  asteroidList.push(...fieldAsteroids);

  // 4. Background scatter — count derived from personality density × available area.
  //    netArea = sector area minus spawn exclusion circles.
  const netArea = WIDTH * HEIGHT - spawnSlots.length * Math.PI * SAFE_SPAWN_RADIUS ** 2;
  const [densityMin, densityMax] = personality.backgroundDensity;
  const backgroundCount = Math.round(
    (netArea / WORLD_CONFIG.ASTEROID_MIN_DISTANCE ** 2) * rng.nextFloat(densityMin, densityMax)
  );
  asteroidList.push(
    ...generateBackground(
      sectorCenterX,
      sectorCenterY,
      halfW,
      halfH,
      spawnSlots,
      spawnSafeRadiusSq,
      grid,
      sectorSeed,
      backgroundCount
    )
  );

  return {
    sectorX,
    sectorY,
    archetypeId: personality.id,
    seed: sectorSeed,
    asteroids: asteroidList,
    spawnSlots,
  };
};
