import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { getAttackForecast } from '../../../../services/combat/index.js';
import { defineRoute, shipAmount, stationParams } from '../../../../lib/route.js';

const BodySchema = z.object({
  targetStationId: z.uuid(),
  fleet: z.record(z.string().min(1), shipAmount),
});

/** POST /api/stations/:stationId/attacks/forecast: win chance and loot range for a planned attack. */
export default defineRoute(async (app) => {
  app.post(
    '/forecast',
    { onRequest: [authenticate], schema: { params: stationParams, body: BodySchema } },
    async (request) =>
      getAttackForecast({
        userId: request.user.userId,
        stationId: request.params.stationId,
        ...request.body,
      })
  );
});
