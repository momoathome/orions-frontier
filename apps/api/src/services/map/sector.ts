import { required } from '@orions-frontier/shared';
import type { getDb, Tx } from '../../lib/db/index.js';
import {
  insertAsteroids,
  insertAsteroidVeins,
  listAsteroidPositionsInSector,
} from './repositories/asteroids.js';
import {
  claimFrontierSectorForSettlement,
  findSectorByCoordinates,
  insertSectorIfAbsent,
  listSectorCoordinates,
  listUnsettledFrontierSectors,
  lockSectorColonization,
} from './repositories/sectors.js';
import { insertSpawnSlots } from './repositories/spawn-slots.js';
import { generateSector, generateSpawnSlots } from '../../lib/world-gen/sector-gen.js';
import type {
  GeneratedAsteroid,
  GeneratedSpawnSlot,
  SectorRole,
} from '../../lib/world-gen/types.js';
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
  await insertSectorSpawnSlots(db, created.id, generated.spawnSlots, context);
  return { id: created.id, created: true, role };
}

async function insertSectorSpawnSlots(
  db: Pick<SectorDb, 'insert'>,
  sectorId: string,
  slots: GeneratedSpawnSlot[],
  context: GameExecutionContext
): Promise<void> {
  if (slots.length === 0) return;
  await insertSpawnSlots(
    db,
    slots.map((slot) => ({
      id: context.nextId('spawn-slot'),
      sectorId,
      slotIndex: slot.slotIndex,
      slotType: slot.slotType,
      x: slot.x,
      y: slot.y,
      createdAt: context.now,
    }))
  );
}

/**
 * Turns an explored frontier sector without stations into a settlement. Its asteroids stay, so the
 * spawn slots search around them; false if no player slot fits or the sector no longer qualifies.
 */
export async function settleFrontierSector(
  tx: Tx,
  sector: { id: string; sectorX: number; sectorY: number; seed: string },
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<boolean> {
  await lockSectorColonization(tx, sector.id);
  const slots = generateSpawnSlots(
    sector.sectorX,
    sector.sectorY,
    sector.seed,
    'settlement',
    await listAsteroidPositionsInSector(tx, sector.id)
  );
  if (!slots.some((slot) => slot.slotType === 'player')) return false;
  if (!(await claimFrontierSectorForSettlement(tx, sector.id))) return false;
  await insertSectorSpawnSlots(tx, sector.id, slots, context);
  return true;
}

/**
 * Opens the settlement nearest the world center: a new sector next to a known one, or an explored
 * frontier sector nobody lives in, so exploration does not push new players outward.
 */
export async function openNextSettlementSector(
  tx: Tx,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<string> {
  const existing = await listSectorCoordinates(tx);
  const occupied = new Set(existing.map(({ sectorX, sectorY }) => `${sectorX},${sectorY}`));
  const candidateMap = new Map<
    string,
    { sectorX: number; sectorY: number; frontier?: Parameters<typeof settleFrontierSector>[1] }
  >();
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
  for (const frontier of await listUnsettledFrontierSectors(tx)) {
    candidateMap.set(`${frontier.sectorX},${frontier.sectorY}`, { ...frontier, frontier });
  }
  const candidates = [...candidateMap.values()].sort(
    (left, right) =>
      Math.max(Math.abs(left.sectorX), Math.abs(left.sectorY)) -
        Math.max(Math.abs(right.sectorX), Math.abs(right.sectorY)) ||
      Math.abs(left.sectorX) +
        Math.abs(left.sectorY) -
        (Math.abs(right.sectorX) + Math.abs(right.sectorY)) ||
      // At the same distance a fresh sector wins: all its slots are free of asteroids.
      Number(left.frontier !== undefined) - Number(right.frontier !== undefined) ||
      left.sectorY - right.sectorY ||
      left.sectorX - right.sectorX
  );
  if (candidates.length === 0) candidates.push({ sectorX: 0, sectorY: 0 });

  for (const candidate of candidates) {
    if (candidate.frontier) {
      if (await settleFrontierSector(tx, candidate.frontier, context)) return candidate.frontier.id;
      continue;
    }
    const sector = await ensureSector(
      tx,
      candidate.sectorX,
      candidate.sectorY,
      'settlement',
      context
    );
    if (sector.role === 'settlement') return sector.id;
  }
  throw new Error('No settlement sector coordinate is available');
}
