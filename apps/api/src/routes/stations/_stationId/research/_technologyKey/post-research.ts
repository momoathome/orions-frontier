import { z } from 'zod';
import { authenticate } from '../../../../../middleware/auth.js';
import { startResearch } from '../../../../../services/research/index.js';
import { defineRoute, stationParams } from '../../../../../lib/route.js';

export default defineRoute(async (app) => {
  app.post(
    '/',
    {
      onRequest: [authenticate],
      schema: { params: stationParams.extend({ technologyKey: z.string().min(1) }) },
    },
    async (request, reply) => {
      const { stationId, technologyKey } = request.params;
      await startResearch(stationId, request.user.userId, technologyKey);
      return reply.status(202).send();
    }
  );
});
