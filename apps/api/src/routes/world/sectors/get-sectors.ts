import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { getKnownSectors } from '../../../services/missions/index.js';
import { defineRoute } from '../../../lib/route.js';

const QuerySchema = z.object({ stationId: z.uuid() });

export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { querystring: QuerySchema } },
    async (request) => {
      return getKnownSectors(request.user.userId, request.query.stationId);
    }
  );
});
