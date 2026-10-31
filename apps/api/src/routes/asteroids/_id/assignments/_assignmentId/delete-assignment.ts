import { z } from 'zod';
import { authenticate } from '../../../../../middleware/auth.js';
import { requestAsteroidAssignmentRecall } from '../../../../../services/mining/index.js';
import { publishUserEvent } from '../../../../../lib/realtime.js';
import { defineRoute, shipAmountQuery } from '../../../../../lib/route.js';

// DELETE /api/asteroids/:id/assignments/:assignmentId

export default defineRoute(async (app) => {
  app.delete(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        params: z.object({ id: z.uuid(), assignmentId: z.uuid() }),
        querystring: z.object({ amount: shipAmountQuery.default(1) }),
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
