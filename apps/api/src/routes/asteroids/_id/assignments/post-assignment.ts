import { defineRoute } from '../../../../lib/route-helper.js';
import { authenticate } from '../../../../middleware/auth.js';
import { createAsteroidAssignment } from '../../../../services/asteroid.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

// POST /api/asteroids/:id/assignments

export default defineRoute(async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id: asteroidId } = request.params as { id: string };
    const body = request.body as {
      stationId?: string;
      spacecraftDefinitionId?: string;
      assignedAmount?: number;
    };

    if (!body.stationId || !body.spacecraftDefinitionId) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'stationId and spacecraftDefinitionId are required');
    }

    const assignedAmount = Math.max(1, Math.floor(Number(body.assignedAmount ?? 1)));

    const result = await createAsteroidAssignment({
      asteroidId,
      stationId: body.stationId,
      spacecraftDefinitionId: body.spacecraftDefinitionId,
      assignedAmount,
    });

    if ('code' in result) {
      const status =
        result.code === 'SLOTS_FULL' ? 409 : result.code === 'ASTEROID_NOT_FOUND' ? 404 : 400;
      return reply.status(status).send({ message: result.message });
    }

    return reply.status(201).send({ data: { assignmentId: result.id } });
  });
});
