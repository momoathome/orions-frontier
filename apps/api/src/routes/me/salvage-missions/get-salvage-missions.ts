import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getUserSalvageMissions } from '../../../services/salvage.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) =>
    getUserSalvageMissions(request.user.userId)
  );
}) satisfies FastifyPluginAsync;
