import { and, eq, inArray } from 'drizzle-orm';
import type { QueryDb } from '../lib/db/index.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';

export function listBuildingLevelsByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select({
      stationId: stationBuildings.stationId,
      buildingKey: stationBuildings.buildingKey,
      level: stationBuildings.level,
    })
    .from(stationBuildings)
    .where(inArray(stationBuildings.stationId, stationIds));
}

/** Level of one building; undefined if the station has no such row. */
export async function findBuildingLevel(db: QueryDb, stationId: string, buildingKey: string) {
  const [row] = await db
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, buildingKey))
    )
    .limit(1);
  return row?.level;
}
