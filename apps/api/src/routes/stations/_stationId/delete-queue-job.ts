import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { ownStation, removeQueuedStationJob } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/** DELETE /api/stations/:stationId/queue/:jobId: removes a waiting upgrade with a full refund. */
export default defineRoute(async (app) => {
  app.delete(
    '/queue/:jobId',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ jobId: z.uuid() }) },
    },
    async (request, reply) => {
      const { stationId, jobId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);
      await removeQueuedStationJob(ownedStationId, request.user.userId, jobId);
      return reply.status(204).send();
    }
  );
});
