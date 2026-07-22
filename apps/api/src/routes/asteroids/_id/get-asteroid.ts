import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../middleware/auth.js';
import { getAsteroidById } from '../../../services/asteroid.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Asteroid id is required');
    }

    const query = request.query as Record<string, string | undefined>;
    const scannerBypass = request.user.role === 'admin' && query['scannerBypass'] === 'true';
    const asteroid = await getAsteroidById(id, request.user.userId, scannerBypass);

    if (!asteroid) {
      return reply.status(404).send({ message: 'Asteroid not found' });
    }

    return asteroid;
  });
}) satisfies FastifyPluginAsync;
