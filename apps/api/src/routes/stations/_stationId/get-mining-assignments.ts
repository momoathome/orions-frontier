import { and, eq } from 'drizzle-orm';
import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationMiningAssignments } from '../../../services/asteroid.service.js';
import { tickStationAssignments } from '../../../services/mining-tick.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/**
 * GET /api/stations/:stationId/mining-assignments
 * Returns all active mining assignments for a station (triggers lazy tick).
 */
export default defineRoute(async (app) => {
  app.get(
    '/mining-assignments',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { stationId } = request.params as { stationId: string };
      const db = getDb();

      const [station] = await db
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
      }

      // Trigger lazy tick for all assignments before returning data
      await tickStationAssignments(station.id);

      const assignments = await getStationMiningAssignments(station.id);

      return reply.send({ success: true, data: { assignments } });
    },
  );
});
