import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { createAsteroidAssignment } from '../../../../services/mining/assignment.service.js';
import { publishUserEvent } from '../../../../lib/realtime.js';
import { defineRoute, idParams } from '../../../../lib/route.js';

// POST /api/asteroids/:id/assignments

export default defineRoute(async (app) => {
  app.post(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        params: idParams,
        body: z.object({
          stationId: z.uuid(),
          spacecraftKey: z.string().min(1),
          assignedAmount: z.number().int().min(1).default(1),
        }),
      },
    },
    async (request, reply) => {
      const result = await createAsteroidAssignment({
        userId: request.user.userId,
        asteroidId: request.params.id,
        ...request.body,
      });

      if ('code' in result) {
        const status = result.code === 'ASTEROID_NOT_FOUND' ? 404 : 400;
        return reply.status(status).send({ message: result.message });
      }

      publishUserEvent(request.user.userId, 'mining_tick_completed', {});

      return reply.status(201).send({ assignmentId: result.id });
    }
  );
});
