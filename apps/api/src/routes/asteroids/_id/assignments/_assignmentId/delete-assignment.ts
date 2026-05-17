import { defineRoute } from '../../../../../lib/route-helper.js';
import { authenticate } from '../../../../../middleware/auth.js';
import { removeAsteroidAssignment } from '../../../../../services/asteroid.service.js';
import { requireStation } from '../../../../../middleware/require-station.js';

// DELETE /api/asteroids/:id/assignments/:assignmentId

export default defineRoute(async (app) => {
  app.delete('/', { preHandler: [authenticate, requireStation] }, async (request, reply) => {
    const { assignmentId } = request.params as { assignmentId: string };
    const station = (request as any).station as { id: string };

    const removed = await removeAsteroidAssignment(assignmentId, station.id);

    if (!removed) {
      return reply.status(404).send({ message: 'Assignment not found or not owned by your station' });
    }

    return reply.status(204).send();
  });
});
