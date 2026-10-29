import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { ownStation, startBuildingUpgrade } from '../../../services/station/index.js';
import { buildingKeys } from '@orions-frontier/shared';
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

      const ownedStationId = await ownStation(request.user.userId, stationId);

      const updatedBuilding = await startBuildingUpgrade(
        ownedStationId,
        buildingKey,
        request.user.userId
      );

      return updatedBuilding;
    }
  );
});
