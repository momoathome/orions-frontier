import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { getStationDefenseUpgrades } from '../../../services/defense.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get(
    '/defense',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const [station] = await getDb()
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

      const upgrades = await getStationDefenseUpgrades(station.id);
      return { stationId: station.id, upgrades };
    }
  );
});
