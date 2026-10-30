import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { cancelResearch } from '../../../services/research/index.js';
import { recordLogbookEvents } from '../../../services/logbook/index.js';
import { creditStationResources } from '../../../services/station/index.js';
import { defineRoute } from '../../../lib/route.js';

/** DELETE /api/me/research/:technologyKey: cancels running research; refunds as far as storage allows. */
export default defineRoute(async (app) => {
  app.delete(
    '/:technologyKey',
    {
      onRequest: [authenticate],
      schema: { params: z.object({ technologyKey: z.string().min(1).max(64) }) },
    },
    async (request, reply) => {
      const dropped = await cancelResearch(
        request.user.userId,
        request.params.technologyKey,
        creditStationResources
      );
      await recordLogbookEvents(dropped);
      return reply.status(204).send();
    }
  );
});
