import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { defineRoute } from '../../../lib/route.js';
import { getRanking } from '../../../services/ranking/index.js';

/**
 * GET /api/world/ranking
 * Server-wide ranking by Influence, plus the requesting player's own rank.
 */
export default defineRoute(async (app) => {
  app.get(
    '/',
    {
      onRequest: [authenticate],
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
      },
    },
    async (request) => getRanking(request.user.userId, request.query.limit)
  );
});
