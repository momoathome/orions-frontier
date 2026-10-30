import { authenticate } from '../../../middleware/auth.js';
import { getStationDefenseUpgrades, ownStation } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get(
    '/defense',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);

      const upgrades = await getStationDefenseUpgrades(ownedStationId, request.user.userId);
      return { stationId: ownedStationId, upgrades };
    }
  );
});
