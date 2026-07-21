import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationBuildings } from '../../../services/building.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/**
 * GET /api/stations/:stationId/buildings
 * Returns all buildings for the station with computed effects, costs, and milestones.
 */
export default (async (app) => {
  app.get('/buildings', { preHandler: [authenticate] }, async (request) => {
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

    const buildings = await getStationBuildings(station.id);

    return { stationId: station.id, buildings };
  });
}) satisfies FastifyPluginAsync;
