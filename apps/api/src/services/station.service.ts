import { and, eq, isNull, asc, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stations } from '../lib/db/schema/stations.js';
import { spawnSlots } from '../lib/db/schema/spawn-slots.js';
import { sectors } from '../lib/db/schema/sectors.js';
import { seedStationResources } from './station-resource.service.js';
import { seedStationBuildings } from './building.service.js';
import { seedStationDefenseUpgrades } from './defense.service.js';
import { seedStationSpacecrafts } from './spacecraft.service.js';
import type { Station } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { generateStarterPocket } from '../lib/world-gen/sector-gen.js';
import { insertGeneratedAsteroids, openNextSettlementSector } from './sector.service.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { calculateScannerRange } from '@orions-frontier/game-config';
import { getUserScannerCoverages } from './scanner-visibility.service.js';
import { getStationVisualProfiles, starterStationVisualProfile } from './station-visual.service.js';

const toStation = (
  row: typeof stations.$inferSelect,
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
  createdAt: row.createdAt.toISOString(),
});

export const getUserStations = async (userId: string): Promise<Station[]> => {
  const db = getDb();
  const [rows, coverages] = await Promise.all([
    db.select().from(stations).where(eq(stations.userId, userId)),
    getUserScannerCoverages(userId),
  ]);
  const ranges = new Map(coverages.map((coverage) => [coverage.stationId, coverage.range]));
  const visualProfiles = await getStationVisualProfiles(rows.map((row) => row.id));
  return rows.map((row) => toStation(row, ranges.get(row.id) ?? 0, visualProfiles.get(row.id)));
};

export const createStation = async (
  userId: string,
  data: { name: string; slotType?: 'player' | 'bot'; sectorId?: string }
): Promise<Station> => {
  const db = getDb();
  const slotType = data.slotType ?? 'player';

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1869772101)`);
    if (slotType === 'player') {
      const [existing] = await tx
        .select({ id: stations.id })
        .from(stations)
        .where(eq(stations.userId, userId))
        .limit(1);
      if (existing) {
        throw new AppError(ErrorCode.ALREADY_EXISTS, 'User already has an initial station');
      }
    } else if (data.sectorId) {
      const [existing] = await tx
        .select()
        .from(stations)
        .where(and(eq(stations.userId, userId), eq(stations.sectorId, data.sectorId)))
        .limit(1);
      if (existing) return toStation(existing, calculateScannerRange(1));
    }

    const findSlot = () => {
      const conditions = [
        isNull(spawnSlots.stationId),
        eq(spawnSlots.slotType, slotType),
        eq(sectors.role, 'settlement'),
      ];
      if (data.sectorId) conditions.push(eq(sectors.id, data.sectorId));
      return tx
        .select({ slot: spawnSlots, sectorSeed: sectors.seed })
        .from(spawnSlots)
        .innerJoin(sectors, eq(spawnSlots.sectorId, sectors.id))
        .where(and(...conditions))
        .orderBy(asc(sectors.createdAt), asc(spawnSlots.slotIndex))
        .limit(1)
        .for('update');
    };

    let [slot] = await findSlot();
    if (!slot && slotType === 'player' && !data.sectorId) {
      await openNextSettlementSector(tx);
      [slot] = await findSlot();
    }

    if (!slot) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `No ${slotType} spawn slot is available.`);
    }

    const [station] = await tx
      .insert(stations)
      .values({
        userId,
        name: data.name,
        sectorId: slot.slot.sectorId,
        x: slot.slot.x,
        y: slot.slot.y,
        chunkX: Math.floor(slot.slot.x / WORLD_CONFIG.CHUNK_SIZE),
        chunkY: Math.floor(slot.slot.y / WORLD_CONFIG.CHUNK_SIZE),
      })
      .returning();
    if (!station) throw new Error('Failed to create station');

    await tx
      .update(spawnSlots)
      .set({ stationId: station.id })
      .where(eq(spawnSlots.id, slot.slot.id));
    await seedStationResources(station.id, tx);
    await seedStationBuildings(station.id, tx);
    await seedStationDefenseUpgrades(station.id, tx);
    await seedStationSpacecrafts(station.id, tx);
    await insertGeneratedAsteroids(
      tx,
      slot.slot.sectorId,
      generateStarterPocket(slot.slot, slot.sectorSeed)
    );

    return toStation(station, calculateScannerRange(1));
  });
};
