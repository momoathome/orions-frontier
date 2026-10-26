import { authenticate } from '../../../middleware/auth.js';
import { ownStation } from '../../../services/station.service.js';
import { getStationDefenseUpgrades } from '../../../services/defense.service.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get(
    '/defense',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);

      const upgrades = await getStationDefenseUpgrades(ownedStationId);
      return { stationId: ownedStationId, upgrades };
    }
  );
});
