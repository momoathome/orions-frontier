import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { cancelBuildOrder } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/** DELETE /api/stations/:stationId/spacecrafts/orders/:orderId: cancels; refunds as far as storage allows. */
export default defineRoute(async (app) => {
  app.delete(
    '/spacecrafts/orders/:orderId',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ orderId: z.uuid() }) },
    },
    async (request, reply) => {
      const { stationId, orderId } = request.params;
      await cancelBuildOrder(stationId, request.user.userId, orderId);
      return reply.status(204).send();
    }
  );
});
