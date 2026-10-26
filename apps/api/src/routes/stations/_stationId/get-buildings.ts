import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationBuildings } from '../../../services/building.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * GET /api/stations/:stationId/buildings
 * Returns all buildings for the station with computed effects, costs, and milestones.
 */
export default defineRoute(async (app) => {
  app.get(
    '/buildings',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const db = getDb();

      const [station] = await db
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
      }

      const buildings = await getStationBuildings(station.id);

      return { stationId: station.id, buildings };
    }
  );
});
