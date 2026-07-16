import { and, eq } from 'drizzle-orm';
import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { startBuildingUpgrade } from '../../../services/building.service.js';
import { AppError, ErrorCode, buildingKeys } from '@orions-frontier/shared';
import type { BuildingKey } from '@orions-frontier/shared';

/**
 * POST /api/stations/:stationId/buildings/:buildingKey/upgrade
 * Starts upgrading a building if the station has sufficient resources.
 */
export default defineRoute(async (app) => {
  app.post(
    '/buildings/:buildingKey/upgrade',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { stationId, buildingKey } = request.params as {
        stationId: string;
        buildingKey: string;
      };

      if (!(buildingKeys as readonly string[]).includes(buildingKey)) {
        throw new AppError(ErrorCode.INVALID_INPUT, `Unknown building key: ${buildingKey}`);
      }

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
        buildingKey as BuildingKey,
        request.user.userId
      );

      return reply.send({ success: true, data: updatedBuilding });
    }
  );
});
