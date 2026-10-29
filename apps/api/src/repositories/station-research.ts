import { and, eq, inArray } from 'drizzle-orm';
import type { QueryDb } from '../lib/db/index.js';
import { stationResearch } from '../lib/db/schema/station-research.js';

export function listCompletedResearchByStations(db: QueryDb, stationIds: string[]) {
  return db
    .select({ stationId: stationResearch.stationId, technologyKey: stationResearch.technologyKey })
    .from(stationResearch)
    .where(
      and(inArray(stationResearch.stationId, stationIds), eq(stationResearch.status, 'completed'))
    );
}
