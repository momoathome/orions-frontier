import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { getUserStations } from '../../services/station.service.js';

/**
 * GET /stations
 * Returns all stations belonging to the authenticated user.
 */
export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const data = await getUserStations(request.user.userId);
    return reply.send({ success: true, data });
  });
}) satisfies FastifyPluginAsync;
