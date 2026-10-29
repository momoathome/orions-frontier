import { required } from '@orions-frontier/shared';
import type { getDb } from '../../lib/db/index.js';
import { insertAsteroids, insertAsteroidVeins } from '../../repositories/asteroids.js';
import {
  findSectorByCoordinates,
  insertSectorIfAbsent,
  listSectorCoordinates,
} from '../../repositories/sectors.js';
import { insertSpawnSlots } from '../../repositories/spawn-slots.js';
import { generateSector } from '../../lib/world-gen/sector-gen.js';
import type { GeneratedAsteroid, SectorRole } from '../../lib/world-gen/types.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

type SectorDb = Pick<ReturnType<typeof getDb>, 'insert' | 'select'>;
const BATCH_SIZE = 500;

export async function insertGeneratedAsteroids(
  db: Pick<SectorDb, 'insert'>,
  sectorId: string,
  generated: GeneratedAsteroid[],
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  for (let offset = 0; offset < generated.length; offset += BATCH_SIZE) {
    const batch = generated.slice(offset, offset + BATCH_SIZE);
    const asteroidRows = batch.map((asteroid) => ({
      id: context.nextId('asteroid'),
      x: asteroid.x,
      y: asteroid.y,
      chunkX: asteroid.chunkX,
      chunkY: asteroid.chunkY,
      size: asteroid.size,
      sectorId,
      createdAt: context.now,
      updatedAt: context.now,
    }));
    await insertAsteroids(db, asteroidRows);

    const veins = asteroidRows.flatMap((asteroid, index) =>
      required(batch[index], 'batch[index]').veins.map((vein) => ({
        id: context.nextId('asteroid-vein'),
        asteroidId: asteroid.id,
        veinType: vein.veinType,
        resourceKey: vein.resourceKey,
        remainingAmount: vein.remainingAmount,
        initialAmount: vein.remainingAmount,
        createdAt: context.now,
      }))
    );
    if (veins.length > 0) await insertAsteroidVeins(db, veins);
  }
}

export async function ensureSector(
  db: SectorDb,
  sectorX: number,
  sectorY: number,
  role: SectorRole,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<{ id: string; created: boolean; role: SectorRole }> {
  const generated = generateSector(sectorX, sectorY, context.worldSeed, role);
  const created = await insertSectorIfAbsent(db, {
    id: context.nextId('sector'),
    sectorX,
    sectorY,
    role,
    seed: generated.seed,
    createdAt: context.now,
  });

  if (!created) {
    const existing = await findSectorByCoordinates(db, sectorX, sectorY);
    if (!existing) throw new Error('Sector creation raced without a persisted winner');
    return { id: existing.id, created: false, role: existing.role };
  }

  await insertGeneratedAsteroids(db, created.id, generated.asteroids, context);
  if (generated.spawnSlots.length > 0) {
    await insertSpawnSlots(
      db,
      generated.spawnSlots.map((slot) => ({
        id: context.nextId('spawn-slot'),
        sectorId: created.id,
        slotIndex: slot.slotIndex,
        slotType: slot.slotType,
        x: slot.x,
        y: slot.y,
        createdAt: context.now,
      }))
    );
  }
  return { id: created.id, created: true, role };
}

export async function openNextSettlementSector(
  db: SectorDb,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<string> {
  const existing = await listSectorCoordinates(db);
  const occupied = new Set(existing.map(({ sectorX, sectorY }) => `${sectorX},${sectorY}`));
  const candidateMap = new Map<string, { sectorX: number; sectorY: number }>();
  for (const { sectorX, sectorY } of existing) {
    for (const candidate of [
      { sectorX: sectorX + 1, sectorY },
      { sectorX: sectorX - 1, sectorY },
      { sectorX, sectorY: sectorY + 1 },
      { sectorX, sectorY: sectorY - 1 },
    ]) {
      const key = `${candidate.sectorX},${candidate.sectorY}`;
      if (!occupied.has(key)) candidateMap.set(key, candidate);
    }
  }
  const candidates = [...candidateMap.values()].sort(
    (left, right) =>
      Math.max(Math.abs(left.sectorX), Math.abs(left.sectorY)) -
        Math.max(Math.abs(right.sectorX), Math.abs(right.sectorY)) ||
      Math.abs(left.sectorX) +
        Math.abs(left.sectorY) -
        (Math.abs(right.sectorX) + Math.abs(right.sectorY)) ||
      left.sectorY - right.sectorY ||
      left.sectorX - right.sectorX
  );
  if (candidates.length === 0) candidates.push({ sectorX: 0, sectorY: 0 });

  for (const candidate of candidates) {
    const sector = await ensureSector(
      db,
      candidate.sectorX,
      candidate.sectorY,
      'settlement',
      context
    );
    if (sector.role === 'settlement') return sector.id;
  }
  throw new Error('No settlement sector coordinate is available');
}
