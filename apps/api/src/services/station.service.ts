import { eq, isNull, asc } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stations } from '../lib/db/schema/stations.js';
import { spawnSlots } from '../lib/db/schema/spawn-slots.js';
import { seedStationResources } from './station-resource.service.js';
import { seedStationBuildings } from './building.service.js';
import { seedStationSpacecrafts } from './spacecraft.service.js';
import type { Station } from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';

const toStation = (row: typeof stations.$inferSelect): Station => ({
  id: row.id,
  userId: row.userId,
  name: row.name,
  x: row.x,
  y: row.y,
  createdAt: row.createdAt.toISOString(),
});

export const getUserStations = async (userId: string): Promise<Station[]> => {
  const db = getDb();
  const rows = await db.select().from(stations).where(eq(stations.userId, userId));
  return rows.map(toStation);
};

export const createStation = async (userId: string, data: { name: string }): Promise<Station> => {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [slot] = await tx
      .select()
      .from(spawnSlots)
      .where(isNull(spawnSlots.stationId))
      .orderBy(asc(spawnSlots.slotIndex))
      .limit(1)
      .for('update', { skipLocked: true });

    if (!slot) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'No spawn slots available. The server is full.'
      );
    }

    const [station] = await tx
      .insert(stations)
      .values({ userId, name: data.name, x: slot.x, y: slot.y })
      .returning();
    if (!station) throw new Error('Failed to create station');

    await tx.update(spawnSlots).set({ stationId: station.id }).where(eq(spawnSlots.id, slot.id));
    await seedStationResources(station.id, tx);
    await seedStationBuildings(station.id, tx);
    await seedStationSpacecrafts(station.id, tx);

    return toStation(station);
  });
};
