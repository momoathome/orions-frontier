import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../middleware/auth.js';
import { getResearchState } from '../../../../services/research.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const { stationId } = request.params as { stationId: string };
    return {
      success: true,
      data: await getResearchState(stationId, request.user.userId),
    };
  });
}) satisfies FastifyPluginAsync;
