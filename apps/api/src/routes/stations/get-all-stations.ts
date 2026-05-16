import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { getAllStations } from '../../services/station.service.js';

/**
 * GET /stations/all
 * Returns all stations in the database (admin / development use).
 */
export default defineRoute(async (app) => {
  app.get('/all', { preHandler: [authenticate] }, async (_request, reply) => {
    const data = await getAllStations();
    return reply.send({ success: true, data });
  });
});
