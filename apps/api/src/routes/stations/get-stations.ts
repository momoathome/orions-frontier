import { authenticate } from '../../middleware/auth.js';
import { getUserStations } from '../../services/station/index.js';
import { defineRoute } from '../../lib/route.js';

/**
 * GET /stations
 * Returns all stations belonging to the authenticated user.
 */
export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate] }, async (request) => {
    return getUserStations(request.user.userId);
  });
});
