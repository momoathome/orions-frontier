import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { removeQueuedResearch } from '../../../services/research/index.js';
import { recordLogbookEvents } from '../../../services/logbook/index.js';
import { creditStationResources } from '../../../services/station/index.js';
import { defineRoute } from '../../../lib/route.js';

/** DELETE /api/me/research/queue/:jobId: removes waiting research; refunds as far as storage allows. */
export default defineRoute(async (app) => {
  app.delete(
    '/queue/:jobId',
    {
      onRequest: [authenticate],
      schema: { params: z.object({ jobId: z.uuid() }) },
    },
    async (request, reply) => {
      const dropped = await removeQueuedResearch(
        request.user.userId,
        request.params.jobId,
        creditStationResources
      );
      await recordLogbookEvents(dropped);
      return reply.status(204).send();
    }
  );
});
