import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../../middleware/auth.js';
import { requestAsteroidAssignmentRecall } from '../../../../../services/mining/assignment.service.js';
import { publishUserEvent } from '../../../../../lib/realtime.js';

// DELETE /api/asteroids/:id/assignments/:assignmentId

export default (async (app) => {
  app.delete('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string };
    const amount = Number((request.query as { amount?: string }).amount ?? 1);
    if (!Number.isInteger(amount) || amount < 1) {
      return reply.status(400).send({ message: 'amount must be a positive integer' });
    }
    if (
      !(await requestAsteroidAssignmentRecall({
        assignmentId,
        asteroidId: id,
        userId: request.user.userId,
        amount,
      }))
    ) {
      return reply
        .status(404)
        .send({ message: 'Assignment not found or not enough active miners remain' });
    }

    publishUserEvent(request.user.userId, 'mining_tick_completed');

    return reply.status(202).send();
  });
}) satisfies FastifyPluginAsync;
