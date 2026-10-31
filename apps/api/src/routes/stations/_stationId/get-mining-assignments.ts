import { authenticate } from '../../../middleware/auth.js';
import { ownStation } from '../../../services/station/index.js';
import { getStationMiningAssignments } from '../../../services/mining/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/**
 * GET /api/stations/:stationId/mining-assignments
 * Returns all active mining assignments for a station.
 */
export default defineRoute(async (app) => {
  app.get(
    '/mining-assignments',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);

      const assignments = await getStationMiningAssignments(ownedStationId, request.user.userId);

      return { assignments };
    }
  );
});
