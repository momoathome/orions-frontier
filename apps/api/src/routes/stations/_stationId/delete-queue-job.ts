import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { removeQueuedStationJob } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/** DELETE /api/stations/:stationId/queue/:jobId: removes a waiting upgrade; refunds as far as storage allows. */
export default defineRoute(async (app) => {
  app.delete(
    '/queue/:jobId',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ jobId: z.uuid() }) },
    },
    async (request, reply) => {
      const { stationId, jobId } = request.params;
      await removeQueuedStationJob(stationId, request.user.userId, jobId);
      return reply.status(204).send();
    }
  );
});
