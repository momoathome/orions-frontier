import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { cancelDefenseUpgrade } from '../../../services/station/index.js';
import { defenseUpgradeKeys } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

/** DELETE /api/stations/:stationId/defense/:upgradeKey/upgrade: cancels with a refund. */
export default defineRoute(async (app) => {
  app.delete(
    '/defense/:upgradeKey/upgrade',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ upgradeKey: z.enum(defenseUpgradeKeys) }) },
    },
    async (request, reply) => {
      const { stationId, upgradeKey } = request.params;
      await cancelDefenseUpgrade(stationId, upgradeKey, request.user.userId);
      return reply.status(204).send();
    }
  );
});
