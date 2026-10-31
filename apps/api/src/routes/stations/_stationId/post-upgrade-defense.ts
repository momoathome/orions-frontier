import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { startDefenseUpgrade } from '../../../services/station/index.js';
import { defenseUpgradeKeys } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.post(
    '/defense/:upgradeKey/upgrade',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ upgradeKey: z.enum(defenseUpgradeKeys) }) },
    },
    async (request) => {
      const { stationId, upgradeKey } = request.params;

      return startDefenseUpgrade(stationId, upgradeKey, request.user.userId, undefined, true);
    }
  );
});
