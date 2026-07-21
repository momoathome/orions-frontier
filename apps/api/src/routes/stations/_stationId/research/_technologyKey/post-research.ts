import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../../middleware/auth.js';
import { startResearch } from '../../../../../services/research.service.js';

export default (async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { stationId, technologyKey } = request.params as {
      stationId: string;
      technologyKey: string;
    };
    await startResearch(stationId, request.user.userId, technologyKey);
    return reply.status(202).send();
  });
}) satisfies FastifyPluginAsync;
