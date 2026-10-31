import { z } from 'zod';
import { authenticate } from '../../../../../middleware/auth.js';
import { requestAsteroidAssignmentRecall } from '../../../../../services/mining/index.js';
import { publishUserEvent } from '../../../../../lib/realtime.js';
import { defineRoute } from '../../../../../lib/route.js';

// DELETE /api/asteroids/:id/assignments/:assignmentId

export default defineRoute(async (app) => {
  app.delete(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
        // Bounded to the integer column it is compared with.
        querystring: z.object({
          amount: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
        }),
      },
    },
    async (request, reply) => {
      const { id, assignmentId } = request.params;
      if (
        !(await requestAsteroidAssignmentRecall({
          assignmentId,
          asteroidId: id,
          userId: request.user.userId,
          amount: request.query.amount,
        }))
      ) {
        return reply
          .status(404)
          .send({ message: 'Assignment not found or not enough active miners remain' });
      }

      publishUserEvent(request.user.userId, 'mining_tick_completed', {});

      return reply.status(202).send();
    }
  );
});
