import { WORLD_CONFIG } from '../world-config.js';
import { buildAsteroid, buildStarterAsteroid, pickWeighted } from './asteroid-gen.js';
import type { SizeWeights } from './asteroid-gen.js';
import { SeededRng } from './rng.js';
import { sampleBelt, sampleCloud } from './shapes.js';
import type {
  GeneratedAsteroid,
  GeneratedSector,
  GeneratedSpawnSlot,
  SectorRole,
} from './types.js';

type Point = { x: number; y: number };

class SpatialGrid {
  private readonly cells = new Map<string, Point[]>();

  constructor(private readonly cellSize: number) {}

  private cell(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  add(point: Point): void {
    const key = this.key(this.cell(point.x), this.cell(point.y));
    const points = this.cells.get(key);
    if (points) points.push(point);
    else this.cells.set(key, [point]);
  }

  isClear(point: Point): boolean {
    const cellX = this.cell(point.x);
    const cellY = this.cell(point.y);
    const minimumDistanceSquared = this.cellSize ** 2;
    for (let x = cellX - 1; x <= cellX + 1; x += 1) {
      for (let y = cellY - 1; y <= cellY + 1; y += 1) {
        for (const existing of this.cells.get(this.key(x, y)) ?? []) {
          if ((existing.x - point.x) ** 2 + (existing.y - point.y) ** 2 < minimumDistanceSquared) {
            return false;
          }
        }
      }
    }
    return true;
  }
}

const sectorBounds = (sectorX: number, sectorY: number) => {
  const { WIDTH, HEIGHT } = WORLD_CONFIG.SECTOR;
  const centerX = sectorX * WIDTH;
  const centerY = sectorY * HEIGHT;
  return {
    centerX,
    centerY,
    minX: centerX - WIDTH / 2,
    maxX: centerX + WIDTH / 2,
    minY: centerY - HEIGHT / 2,
    maxY: centerY + HEIGHT / 2,
  };
};

function generateSpawnSlots(
  sectorX: number,
  sectorY: number,
  sectorSeed: string,
  role: SectorRole
): GeneratedSpawnSlot[] {
  if (role === 'frontier') return [];

  const { STATION_CAPACITY, BOTS_PER_SETTLEMENT, SAFE_SPAWN_RADIUS, WIDTH, HEIGHT } =
    WORLD_CONFIG.SECTOR;
  const bounds = sectorBounds(sectorX, sectorY);
  const columns = Math.ceil(Math.sqrt(STATION_CAPACITY));
  const rows = Math.ceil(STATION_CAPACITY / columns);
  const cellWidth = WIDTH / columns;
  const cellHeight = HEIGHT / rows;
  const playerSlots = STATION_CAPACITY - BOTS_PER_SETTLEMENT;

  return Array.from({ length: STATION_CAPACITY }, (_, slotIndex) => {
    const rng = new SeededRng(`${sectorSeed}:spawn:${slotIndex}`);
    const column = slotIndex % columns;
    const row = Math.floor(slotIndex / columns);
    const cellLeft = bounds.minX + column * cellWidth;
    const cellTop = bounds.minY + row * cellHeight;
    const marginX = Math.max(cellWidth * 0.15, SAFE_SPAWN_RADIUS);
    const marginY = Math.max(cellHeight * 0.15, SAFE_SPAWN_RADIUS);
    return {
      slotIndex,
      slotType: slotIndex < playerSlots ? 'player' : 'bot',
      x: Math.round(rng.nextFloat(cellLeft + marginX, cellLeft + cellWidth - marginX)),
      y: Math.round(rng.nextFloat(cellTop + marginY, cellTop + cellHeight - marginY)),
    };
  });
}

function isInsideSector(point: Point, bounds: ReturnType<typeof sectorBounds>): boolean {
  return (
    point.x >= bounds.minX &&
    point.x < bounds.maxX &&
    point.y >= bounds.minY &&
    point.y < bounds.maxY
  );
}

function isOutsideSpawnZones(point: Point, slots: GeneratedSpawnSlot[]): boolean {
  const minimumDistanceSquared = WORLD_CONFIG.SECTOR.SAFE_SPAWN_RADIUS ** 2;
  return slots.every(
    (slot) => (slot.x - point.x) ** 2 + (slot.y - point.y) ** 2 >= minimumDistanceSquared
  );
}

function addAsteroid(
  point: Point,
  primaryResource: string,
  pool: readonly { resource: string; weight: number }[],
  sizeWeights: SizeWeights,
  rng: SeededRng,
  bounds: ReturnType<typeof sectorBounds>,
  slots: GeneratedSpawnSlot[],
  grid: SpatialGrid,
  result: GeneratedAsteroid[]
): void {
  if (
    !isInsideSector(point, bounds) ||
    !isOutsideSpawnZones(point, slots) ||
    !grid.isClear(point)
  ) {
    return;
  }
  grid.add(point);
  result.push(buildAsteroid(point.x, point.y, primaryResource, pool, rng, sizeWeights));
}

export function generateStarterPocket(
  slot: Pick<GeneratedSpawnSlot, 'slotIndex' | 'x' | 'y'>,
  sectorSeed: string
): GeneratedAsteroid[] {
  const rng = new SeededRng(`${sectorSeed}:starter:${slot.slotIndex}`);
  const grid = new SpatialGrid(WORLD_CONFIG.ASTEROID_MIN_DISTANCE);
  const result: GeneratedAsteroid[] = [];

  for (const guaranteed of WORLD_CONFIG.STARTER_POCKET.GUARANTEED) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const distance = rng.nextFloat(
        WORLD_CONFIG.STARTER_POCKET.MIN_DIST,
        WORLD_CONFIG.STARTER_POCKET.MAX_DIST
      );
      const angle = rng.next() * Math.PI * 2;
      const point = {
        x: slot.x + Math.cos(angle) * distance,
        y: slot.y + Math.sin(angle) * distance,
      };
      if (!grid.isClear(point)) continue;
      grid.add(point);
      result.push(buildStarterAsteroid(point.x, point.y, guaranteed, rng));
      break;
    }
  }
  return result;
}

export const rareResourceForSector = (sectorX: number, sectorY: number) =>
  Math.abs(sectorX + sectorY) % 2 === 0 ? 'kyber_crystal' : 'astatine';

export function generateSector(
  sectorX: number,
  sectorY: number,
  worldSeed: string,
  role: SectorRole
): GeneratedSector {
  const seed = `${worldSeed}:${sectorX}:${sectorY}`;
  const rng = new SeededRng(seed);
  const bounds = sectorBounds(sectorX, sectorY);
  const spawnSlots = generateSpawnSlots(sectorX, sectorY, seed, role);
  const grid = new SpatialGrid(WORLD_CONFIG.ASTEROID_MIN_DISTANCE);
  const asteroids: GeneratedAsteroid[] = [];
  const distribution = WORLD_CONFIG.DISTRIBUTION[role];
  const rareResource = rareResourceForSector(sectorX, sectorY);
  const fieldPool = [...WORLD_CONFIG.FIELD_BASE_RESOURCES, { resource: rareResource, weight: 40 }];

  for (let field = 0; field < distribution.fieldCount; field += 1) {
    const center = {
      x: rng.nextFloat(bounds.minX + 2_500, bounds.maxX - 2_500),
      y: rng.nextFloat(bounds.minY + 2_500, bounds.maxY - 2_500),
    };
    const points =
      field % 2 === 0
        ? sampleCloud(
            center.x,
            center.y,
            rng.nextFloat(1_200, 2_200),
            distribution.asteroidsPerField,
            rng
          )
        : sampleBelt(
            center.x,
            center.y,
            rng.nextFloat(2_500, 4_500),
            rng.nextFloat(500, 1_000),
            distribution.asteroidsPerField,
            rng
          );
    const primaryResource =
      field === distribution.fieldCount - 1
        ? rareResource
        : pickWeighted(WORLD_CONFIG.FIELD_BASE_RESOURCES, rng);
    for (const point of points) {
      addAsteroid(
        point,
        primaryResource,
        fieldPool,
        WORLD_CONFIG.FIELD_SIZE_WEIGHTS,
        rng,
        bounds,
        spawnSlots,
        grid,
        asteroids
      );
    }
  }

  const backgroundRng = new SeededRng(`${seed}:background`);
  for (let index = 0; index < distribution.backgroundCount; index += 1) {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const point = {
        x: backgroundRng.nextFloat(bounds.minX, bounds.maxX),
        y: backgroundRng.nextFloat(bounds.minY, bounds.maxY),
      };
      const before = asteroids.length;
      addAsteroid(
        point,
        pickWeighted(WORLD_CONFIG.BACKGROUND_RESOURCES, backgroundRng),
        WORLD_CONFIG.BACKGROUND_RESOURCES,
        WORLD_CONFIG.BACKGROUND_SIZE_WEIGHTS,
        backgroundRng,
        bounds,
        spawnSlots,
        grid,
        asteroids
      );
      if (asteroids.length > before) break;
    }
  }

  return { sectorX, sectorY, role, seed, asteroids, spawnSlots };
}
