import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { startSalvage } from '../../../../services/combat/index.js';
import { defineRoute, idParams } from '../../../../lib/route.js';

const BodySchema = z.object({
  stationId: z.uuid(),
  spacecraftKey: z.string().min(1),
  amount: z.number().int().positive(),
});

export default defineRoute(async (app) => {
  app.post(
    '/',
    { onRequest: [authenticate], schema: { params: idParams, body: BodySchema } },
    async (request, reply) => {
      const mission = await startSalvage({
        userId: request.user.userId,
        debrisFieldId: request.params.id,
        ...request.body,
      });
      return reply.status(201).send(mission);
    }
  );
});
