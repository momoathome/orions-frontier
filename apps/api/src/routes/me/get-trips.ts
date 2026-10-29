import { authenticate } from '../../middleware/auth.js';
import { getActiveUserTrips } from '../../services/transport/index.js';
import { defineRoute } from '../../lib/route.js';

/**
 * GET /api/me/trips
 * Returns all active (traveling) spacecraft trips across all stations of the user.
 * Used by the map to render in-flight spacecraft with interpolated positions.
 */
export default defineRoute(async (app) => {
  app.get('/trips', { onRequest: [authenticate] }, async (request) =>
    getActiveUserTrips(request.user.userId)
  );
});
