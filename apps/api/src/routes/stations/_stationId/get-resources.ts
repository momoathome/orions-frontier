import { and, eq } from 'drizzle-orm';
import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationResources } from '../../../services/station-resource.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/**
 * GET /api/stations/:stationId/resources
 * Returns the resource map for a station owned by the authenticated user.
 */
export default defineRoute(async (app) => {
  app.get('/resources', { preHandler: [authenticate] }, async (request, reply) => {
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

    const resources = await getStationResources(station.id);

    return reply.send({
      success: true,
      data: {
        stationId: station.id,
        resources,
      },
    });
  });
});
