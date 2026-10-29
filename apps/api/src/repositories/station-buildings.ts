import { inArray } from 'drizzle-orm';
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
