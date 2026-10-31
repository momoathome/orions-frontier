import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { buildSpacecrafts } from '../../../services/station/index.js';
import { defineRoute, stationParams } from '../../../lib/route.js';

const BodySchema = z.object({
  orders: z
    .array(z.object({ spacecraftKey: z.string().min(1), amount: z.number().int().positive() }))
    .min(1),
});

/**
 * POST /api/stations/:stationId/spacecrafts/build
 * Enqueues spacecraft build orders for the given station.
 */
export default defineRoute(async (app) => {
  app.post(
    '/spacecrafts/build',
    { onRequest: [authenticate], schema: { params: stationParams, body: BodySchema } },
    async (request, reply) => {
      const { stationId } = request.params;

      await buildSpacecrafts(stationId, request.user.userId, request.body.orders);

      return reply.status(202).send();
    }
  );
});
