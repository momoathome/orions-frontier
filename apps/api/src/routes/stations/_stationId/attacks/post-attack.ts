import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { startAttack } from '../../../../services/combat/index.js';
import { defineRoute, stationParams } from '../../../../lib/route.js';

const BodySchema = z.object({
  targetStationId: z.uuid(),
  fleet: z.record(z.string().min(1), z.number().int().positive()),
});

export default defineRoute(async (app) => {
  app.post(
    '/',
    { onRequest: [authenticate], schema: { params: stationParams, body: BodySchema } },
    async (request, reply) => {
      const { stationId } = request.params;
      const report = await startAttack({
        userId: request.user.userId,
        stationId,
        ...request.body,
      });
      return reply.status(201).send(report);
    }
  );
});
