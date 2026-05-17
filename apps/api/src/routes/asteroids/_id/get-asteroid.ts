import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getAsteroidById } from '../../../services/asteroid.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

export default defineRoute(async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = request.query as Record<string, string | undefined>;
    const scannerStrength = Math.max(0, parseInt(q['scannerStrength'] ?? '0', 10) || 0);

    if (!id) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Asteroid id is required');
    }

    const asteroid = await getAsteroidById(id, scannerStrength);

    if (!asteroid) {
      return reply
        .status(404)
        .send({ message: 'Asteroid not found or not visible at current scanner strength' });
    }

    return reply.send({ data: { asteroid } });
  });
});
