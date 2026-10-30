import { authenticate } from '../../../middleware/auth.js';
import {
  getStationHangar,
  getStationShipyard,
  getStationSpacecrafts,
  ownStation,
} from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * GET /api/stations/:stationId/spacecrafts
 * Returns the fleet of a station owned by the authenticated user,
 * including definition data and resource costs.
 */
export default defineRoute(async (app) => {
  app.get(
    '/spacecrafts',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);

      const [spacecrafts, hangar, shipyard] = await Promise.all([
        getStationSpacecrafts(ownedStationId),
        getStationHangar(ownedStationId),
        getStationShipyard(ownedStationId),
      ]);

      return { stationId: ownedStationId, spacecrafts, hangar, ...shipyard };
    }
  );
});
