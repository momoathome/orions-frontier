import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { startColonization } from '../../../../services/missions/index.js';
import { defineRoute, stationParams } from '../../../../lib/route.js';

// Far beyond any world; larger values would overflow the integer sector columns.
const sectorCoord = z.number().int().min(-1_000_000).max(1_000_000);
const BodySchema = z.object({
  sectorX: sectorCoord,
  sectorY: sectorCoord,
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
