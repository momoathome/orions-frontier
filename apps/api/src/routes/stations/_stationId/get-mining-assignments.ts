import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationMiningAssignments } from '../../../services/mining/assignment.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * GET /api/stations/:stationId/mining-assignments
 * Returns all active mining assignments for a station.
 */
export default defineRoute(async (app) => {
  app.get(
    '/mining-assignments',
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

      const assignments = await getStationMiningAssignments(station.id);

      return { assignments };
    }
  );
});
