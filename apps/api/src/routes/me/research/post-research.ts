import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { startResearch } from '../../../services/research/index.js';
import { defineRoute } from '../../../lib/route.js';

/** POST /api/me/research/:technologyKey: starts the next level, paid by `stationId`. */
export default defineRoute(async (app) => {
  app.post(
    '/:technologyKey',
    {
      onRequest: [authenticate],
      schema: {
        params: z.object({ technologyKey: z.string().min(1).max(64) }),
        body: z.object({ stationId: z.uuid() }),
      },
    },
    async (request, reply) => {
      await startResearch(
        request.user.userId,
        request.body.stationId,
        request.params.technologyKey
      );
      return reply.status(202).send();
    }
  );
});
