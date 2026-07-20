import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../middleware/auth.js';
import { createAsteroidAssignment } from '../../../../services/mining/assignment.service.js';
import { publishUserEvent } from '../../../../lib/realtime.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

// POST /api/asteroids/:id/assignments

export default (async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id: asteroidId } = request.params as { id: string };
    const body = request.body as {
      stationId?: string;
      spacecraftDefinitionId?: string;
      assignedAmount?: number;
    };

    if (!body.stationId || !body.spacecraftDefinitionId) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'stationId and spacecraftDefinitionId are required'
      );
    }

    const assignedAmount = body.assignedAmount ?? 1;
    if (!Number.isInteger(assignedAmount) || assignedAmount < 1) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'assignedAmount must be a positive integer');
    }

    const result = await createAsteroidAssignment({
      userId: request.user.userId,
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

    publishUserEvent(request.user.userId, 'mining_tick_completed');

    return reply.status(201).send({ data: { assignmentId: result.id } });
  });
}) satisfies FastifyPluginAsync;
