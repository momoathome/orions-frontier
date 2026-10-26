import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { startBuildingUpgrade } from '../../../services/building.service.js';
import { AppError, ErrorCode, buildingKeys } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * POST /api/stations/:stationId/buildings/:buildingKey/upgrade
 * Starts upgrading a building if the station has sufficient resources.
 */
export default defineRoute(async (app) => {
  app.post(
    '/buildings/:buildingKey/upgrade',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ buildingKey: z.enum(buildingKeys) }) },
    },
    async (request) => {
      const { stationId, buildingKey } = request.params;

      const db = getDb();

      const [station] = await db
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
      }

      const updatedBuilding = await startBuildingUpgrade(
        station.id,
        buildingKey,
        request.user.userId
      );

      return updatedBuilding;
    }
  );
});
