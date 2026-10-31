import { getDb, type Tx } from '../../lib/db/index.js';
import {
  findOwnedStation,
  findOwnedStationInSector,
  insertStation,
  listActiveStationsByUser,
  listStationDestroyedAtByUser,
  lockStationCreation,
  type StationRow,
} from './repositories/stations.js';
import { updateUser } from '../auth/index.js';
import { seedStationResources } from './resources.js';
import { seedStationBuildings } from './buildings.js';
import { seedStationDefenseUpgrades } from './defense.js';
import { seedStationSpacecrafts } from './spacecraft.js';
import type { ResourceMap, Station } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { generateStarterPocket } from '../../lib/world-gen/sector-gen.js';
import {
  insertGeneratedAsteroids,
  openNextSettlementSector,
  assignSpawnSlot,
  findFreeSpawnSlotForUpdate,
} from '../map/index.js';
import { getUserScannerCoverages } from './scanner-coverage.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import {
  ATTACK_PROTECTION_DURATION_MS,
  calculateScannerRange,
  currentIntegrity,
} from '@orions-frontier/game-config';
import { getResearchModifiers } from '../research/index.js';
import { getStationVisualProfiles, starterStationVisualProfile } from './visual.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

const toStation = (
  row: StationRow,
  scannerRange: number,
  visualProfile = starterStationVisualProfile()
): Station => ({
  id: row.id,
  userId: row.userId,
  sectorId: row.sectorId,
  name: row.name,
  x: row.x,
  y: row.y,
  scannerRange,
  visualProfile,
  integrity: currentIntegrity(row.integrity, row.integrityUpdatedAt, new Date()),
  createdAt: row.createdAt.toISOString(),
});

/** Returns the station id when it belongs to the user, otherwise throws NOT_FOUND. */
export const ownStation = async (userId: string, stationId: string): Promise<string> => {
  const station = await findOwnedStation(getDb(), stationId, userId);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
  return station.id;
};

export const getUserStations = async (userId: string): Promise<Station[]> => {
  const db = getDb();
  const [rows, coverages] = await Promise.all([
    listActiveStationsByUser(db, userId),
    getUserScannerCoverages(userId),
  ]);
  const ranges = new Map(coverages.map((coverage) => [coverage.stationId, coverage.range]));
  const visualProfiles = await getStationVisualProfiles(rows.map((row) => row.id));
  return rows.map((row) => toStation(row, ranges.get(row.id) ?? 0, visualProfiles.get(row.id)));
};

/** Inserts a station with its starting resources, buildings and defenses; no ships. */
export async function insertSeededStation(
  tx: Tx,
  values: { userId: string; name: string; sectorId: string; x: number; y: number },
  context: GameExecutionContext,
  resources?: ResourceMap
): Promise<StationRow> {
  const station = await insertStation(tx, {
    id: context.nextId('station'),
    ...values,
    chunkX: Math.floor(values.x / WORLD_CONFIG.CHUNK_SIZE),
    chunkY: Math.floor(values.y / WORLD_CONFIG.CHUNK_SIZE),
    createdAt: context.now,
  });
  if (!station) throw new Error('Failed to create station');
  await seedStationResources(station.id, tx, resources);
  await seedStationBuildings(station.id, tx, context);
  await seedStationDefenseUpgrades(station.id, tx, context);
  return station;
}

export const createStation = async (
  userId: string,
  data: { name: string; slotType?: 'player' | 'bot'; sectorId?: string },
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<Station> => {
  const db = getDb();
  const slotType = data.slotType ?? 'player';

  return db.transaction(async (tx) => {
    // A new station starts with a level 1 scanner; Sensor Arrays is account-wide.
    const scannerRange = async () =>
      calculateScannerRange(1) * (await getResearchModifiers(userId, tx)).scannerRange;
    await lockStationCreation(tx);
    if (slotType === 'player') {
      const owned = await listStationDestroyedAtByUser(tx, userId);
      if (owned.some((station) => !station.destroyedAt)) {
        throw new AppError(ErrorCode.ALREADY_EXISTS, 'User already has an initial station');
      }
      // A restart after losing every station renews the attack protection.
      if (owned.length > 0) {
        await updateUser(tx, userId, {
          protectedUntil: new Date(context.now.getTime() + ATTACK_PROTECTION_DURATION_MS),
          attackProtectionBrokenAt: null,
        });
      }
    } else if (data.sectorId) {
      const existing = await findOwnedStationInSector(tx, userId, data.sectorId);
      if (existing) return toStation(existing, await scannerRange());
    }

    const findSlot = () => findFreeSpawnSlotForUpdate(tx, slotType, data.sectorId);

    let slot = await findSlot();
    if (!slot && slotType === 'player' && !data.sectorId) {
      await openNextSettlementSector(tx, context);
      slot = await findSlot();
    }

    if (!slot) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `No ${slotType} spawn slot is available.`);
    }

    const station = await insertSeededStation(
      tx,
      { userId, name: data.name, sectorId: slot.slot.sectorId, x: slot.slot.x, y: slot.slot.y },
      context
    );
    await assignSpawnSlot(tx, slot.slot.id, station.id);
    await seedStationSpacecrafts(station.id, tx, context);
    await insertGeneratedAsteroids(
      tx,
      slot.slot.sectorId,
      generateStarterPocket(slot.slot, slot.sectorSeed),
      context
    );

    return toStation(station, await scannerRange());
  });
};
