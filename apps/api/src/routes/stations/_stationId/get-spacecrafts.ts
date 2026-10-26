import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationHangar, getStationSpacecrafts } from '../../../services/spacecraft.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * GET /api/stations/:stationId/spacecrafts
 * Returns the fleet of a station owned by the authenticated user,
 * including definition data and resource costs.
 */
export default defineRoute(async (app) => {
  app.get(
    '/spacecrafts',
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

      const [spacecrafts, hangar] = await Promise.all([
        getStationSpacecrafts(station.id),
        getStationHangar(station.id),
      ]);

      return { stationId: station.id, spacecrafts, hangar };
    }
  );
});
