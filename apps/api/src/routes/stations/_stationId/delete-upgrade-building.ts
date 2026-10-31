import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { cancelBuildingUpgrade } from '../../../services/station/index.js';
import { buildingKeys } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

/** DELETE /api/stations/:stationId/buildings/:buildingKey/upgrade: cancels with a refund. */
export default defineRoute(async (app) => {
  app.delete(
    '/buildings/:buildingKey/upgrade',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ buildingKey: z.enum(buildingKeys) }) },
    },
    async (request, reply) => {
      const { stationId, buildingKey } = request.params;
      await cancelBuildingUpgrade(stationId, buildingKey, request.user.userId);
      return reply.status(204).send();
    }
  );
});
