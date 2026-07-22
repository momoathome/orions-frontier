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

    const asteroid = await getAsteroidById(id, request.user.userId);

    if (!asteroid) {
      return reply.status(404).send({ message: 'Asteroid not found' });
    }

    return asteroid;
  });
}) satisfies FastifyPluginAsync;
