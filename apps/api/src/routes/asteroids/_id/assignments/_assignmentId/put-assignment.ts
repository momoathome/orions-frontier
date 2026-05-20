import { defineRoute } from '../../../../../lib/route-helper.js';
import { authenticate } from '../../../../../middleware/auth.js';
import { updateAsteroidAssignment } from '../../../../../services/asteroid.service.js';
import { getRedis } from '../../../../../lib/redis.js';
import { requireStation } from '../../../../../middleware/require-station.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

// PUT /api/asteroids/:id/assignments/:assignmentId

export default defineRoute(async (app) => {
  app.put('/', { preHandler: [authenticate, requireStation] }, async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const station = (request as any).station as { id: string };
    const body = request.body as { assignedAmount?: unknown };

    const assignedAmount = Math.floor(Number(body.assignedAmount));
    if (!Number.isFinite(assignedAmount) || assignedAmount < 1) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'assignedAmount must be a positive integer');
    }

    const updated = await updateAsteroidAssignment(assignmentId, station.id, assignedAmount);

    if (!updated) {
      return reply
        .status(404)
        .send({ message: 'Assignment not found or not owned by your station' });
    }

    if ('code' in updated) {
      const status = updated.code === 'INSUFFICIENT_SPACECRAFT' ? 400 : 400;
      return reply.status(status).send({ message: updated.message });
    }

    await getRedis().publish(
      `user:${request.user.userId}:events`,
      JSON.stringify({ type: 'mining_tick_completed', payload: {}, timestamp: Date.now() })
    );

    return reply.send({ success: true, data: { assignmentId: updated.id, assignedAmount } });
  });
});
