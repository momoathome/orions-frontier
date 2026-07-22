import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../middleware/auth.js';
import { getDebrisById } from '../../../services/salvage.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const debris = await getDebrisById(id, request.user.userId);
    if (!debris) throw new AppError(ErrorCode.NOT_FOUND, 'Debris field not found');
    return debris;
  });
}) satisfies FastifyPluginAsync;
