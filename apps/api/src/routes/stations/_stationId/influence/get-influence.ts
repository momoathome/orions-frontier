import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../middleware/auth.js';
import { getStationInfluence } from '../../../../services/influence.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const { stationId } = request.params as { stationId: string };
    return {
      success: true,
      data: await getStationInfluence(request.user.userId, stationId),
    };
  });
}) satisfies FastifyPluginAsync;
