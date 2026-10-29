import { z } from 'zod';
import { authenticate } from '../../../../middleware/auth.js';
import { getMiningPreview } from '../../../../services/mining/index.js';
import { defineRoute, idParams } from '../../../../lib/route.js';

const QuerySchema = z.object({
  stationId: z.uuid(),
  spacecraftKey: z.string().min(1),
  minerCount: z.coerce.number().int().min(1).default(1),
});

export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { params: idParams, querystring: QuerySchema } },
    async (request, reply) => {
      const result = await getMiningPreview({
        userId: request.user.userId,
        asteroidId: request.params.id,
        ...request.query,
      });
      if (!result.ok) return reply.status(result.status).send({ message: result.message });
      return result.preview;
    }
  );
});
