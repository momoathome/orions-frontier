import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getAsteroidById, getUserScannerStrength } from '../../../services/asteroid.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Asteroid id is required');
    }

    const scannerStrength = await getUserScannerStrength(request.user.userId);
    const asteroid = await getAsteroidById(id, scannerStrength);

    if (!asteroid) {
      return reply
        .status(404)
        .send({ message: 'Asteroid not found or not visible at current scanner strength' });
    }

    return reply.send({ data: { asteroid } });
  });
}) satisfies FastifyPluginAsync;
