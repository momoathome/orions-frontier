import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getUserCombatReports } from '../../../services/combat.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => ({
    success: true,
    data: await getUserCombatReports(request.user.userId),
  }));
}) satisfies FastifyPluginAsync;
