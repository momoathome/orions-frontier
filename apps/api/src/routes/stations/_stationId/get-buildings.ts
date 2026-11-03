import { authenticate } from '../../../middleware/auth.js';
import { getBuildSlots, getStationBuildings, ownStation } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';
import { gameNow } from '../../../lib/game-execution-context.js';

/**
 * GET /api/stations/:stationId/buildings
 * Returns all buildings for the station with computed effects, costs, and milestones, plus the
 * build slots that building and defense upgrades share.
 */
export default defineRoute(async (app) => {
  app.get(
    '/buildings',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);

      const [buildings, buildSlots] = await Promise.all([
        getStationBuildings(ownedStationId),
        getBuildSlots(ownedStationId, gameNow()),
      ]);

      return { stationId: ownedStationId, buildings, buildSlots };
    }
  );
});
