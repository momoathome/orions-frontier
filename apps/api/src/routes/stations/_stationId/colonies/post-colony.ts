import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { startColonization } from '../../../../services/world-mission.service.js';
import { defineRoute, stationParams } from '../../../../lib/route.js';

const BodySchema = z.object({
  sectorX: z.number().int(),
  sectorY: z.number().int(),
  name: z.string().trim().min(1).max(128),
});

export default defineRoute(async (app) => {
  app.post(
    '/',
    { onRequest: [authenticate], schema: { params: stationParams, body: BodySchema } },
    async (request, reply) => {
      const { stationId } = request.params;
      const mission = await startColonization({
        userId: request.user.userId,
        stationId,
        ...request.body,
      });
      return reply.status(201).send(mission);
    }
  );
});
