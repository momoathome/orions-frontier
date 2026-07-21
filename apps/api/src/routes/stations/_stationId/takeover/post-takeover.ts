import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../middleware/auth.js';
import { takeOverStation } from '../../../../services/influence.service.js';

export default (async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request) => {
    const { stationId } = request.params as { stationId: string };
    await takeOverStation(request.user.userId, stationId);
    return null;
  });
}) satisfies FastifyPluginAsync;
