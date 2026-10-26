import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { ownStation } from '../../../services/station.service.js';
import { startDefenseUpgrade } from '../../../services/defense.service.js';
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

      const ownedStationId = await ownStation(request.user.userId, stationId);

      return startDefenseUpgrade(ownedStationId, upgradeKey, request.user.userId);
    }
  );
});
