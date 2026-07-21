import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getUserWorldMissions } from '../../../services/world-mission.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) =>
    getUserWorldMissions(request.user.userId)
  );
}) satisfies FastifyPluginAsync;
