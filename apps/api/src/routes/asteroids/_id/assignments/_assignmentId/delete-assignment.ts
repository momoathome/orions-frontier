import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../../../../middleware/auth.js';
import { requestAsteroidAssignmentRecall } from '../../../../../services/mining/assignment.service.js';
import { publishUserEvent } from '../../../../../lib/realtime.js';
import { getDb } from '../../../../../lib/db/index.js';
import { asteroidAssignments } from '../../../../../lib/db/schema/asteroids.js';
import { stations } from '../../../../../lib/db/schema/stations.js';
import { and, eq } from 'drizzle-orm';

// DELETE /api/asteroids/:id/assignments/:assignmentId

export default (async (app) => {
  app.delete('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id, assignmentId } = request.params as { id: string; assignmentId: string };
    const [owned] = await getDb()
      .select({ stationId: asteroidAssignments.stationId })
      .from(asteroidAssignments)
      .innerJoin(stations, eq(asteroidAssignments.stationId, stations.id))
      .where(
        and(
          eq(asteroidAssignments.id, assignmentId),
          eq(asteroidAssignments.asteroidId, id),
          eq(stations.userId, request.user.userId)
        )
      )
      .limit(1);

    if (!owned || !(await requestAsteroidAssignmentRecall(assignmentId, owned.stationId))) {
      return reply
        .status(404)
        .send({ message: 'Assignment not found or not owned by your station' });
    }

    publishUserEvent(request.user.userId, 'mining_tick_completed');

    return reply.status(202).send({ success: true });
  });
}) satisfies FastifyPluginAsync;
