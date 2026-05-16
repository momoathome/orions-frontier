import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stations } from '../lib/db/schema/stations.js';
import { seedStationResources } from './station-resource.service.js';
import { seedStationBuildings } from './building.service.js';
import type { Station } from '@orions-frontier/shared';

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

export const getAllStations = async (): Promise<Station[]> => {
  const db = getDb();
  const rows = await db.select().from(stations);
  return rows.map(toStation);
};

export const createStation = async (
  userId: string,
  data: { name: string; x: number; y: number },
): Promise<Station> => {
  const db = getDb();

  const [station] = await db
    .insert(stations)
    .values({ userId, name: data.name, x: data.x, y: data.y })
    .returning();

  await seedStationResources(station!.id);
  await seedStationBuildings(station!.id);

  return toStation(station!);
};
