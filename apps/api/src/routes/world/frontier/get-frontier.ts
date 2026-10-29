import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { getFrontierTargets } from '../../../services/missions/index.js';
import { defineRoute } from '../../../lib/route.js';

const QuerySchema = z.object({ stationId: z.uuid() });

export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { querystring: QuerySchema } },
    async (request) => {
      return getFrontierTargets(request.user.userId, request.query.stationId);
    }
  );
});
