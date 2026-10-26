import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { startDefenseUpgrade } from '../../../services/defense.service.js';
import { AppError, defenseUpgradeKeys, ErrorCode } from '@orions-frontier/shared';
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

      const [station] = await getDb()
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

      return startDefenseUpgrade(station.id, upgradeKey, request.user.userId);
    }
  );
});
