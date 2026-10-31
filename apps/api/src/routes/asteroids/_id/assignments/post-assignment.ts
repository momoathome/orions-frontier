import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { createAsteroidAssignment } from '../../../../services/mining/index.js';
import { publishUserEvent } from '../../../../lib/realtime.js';
import { defineRoute, idParams, shipAmount } from '../../../../lib/route.js';

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
          assignedAmount: shipAmount.default(1),
        }),
      },
    },
    async (request, reply) => {
      const { id } = await createAsteroidAssignment({
        userId: request.user.userId,
        asteroidId: request.params.id,
        ...request.body,
      });

      publishUserEvent(request.user.userId, 'mining_tick_completed', {});

      return reply.status(201).send({ assignmentId: id });
    }
  );
});
