import { authenticate } from '../../../middleware/auth.js';
import { ownStation } from '../../../services/station.service.js';
import { getStationBuildings } from '../../../services/building.service.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * GET /api/stations/:stationId/buildings
 * Returns all buildings for the station with computed effects, costs, and milestones.
 */
export default defineRoute(async (app) => {
  app.get(
    '/buildings',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);

      const buildings = await getStationBuildings(ownedStationId);

      return { stationId: ownedStationId, buildings };
    }
  );
});
