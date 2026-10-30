import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { cancelBuildOrder, ownStation } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

/** DELETE /api/stations/:stationId/spacecrafts/orders/:orderId: cancels with a full refund. */
export default defineRoute(async (app) => {
  app.delete(
    '/spacecrafts/orders/:orderId',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ orderId: z.uuid() }) },
    },
    async (request, reply) => {
      const { stationId, orderId } = request.params;
      const ownedStationId = await ownStation(request.user.userId, stationId);
      await cancelBuildOrder(ownedStationId, request.user.userId, orderId);
      return reply.status(204).send();
    }
  );
});
