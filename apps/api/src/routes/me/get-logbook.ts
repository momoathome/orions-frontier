import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { defineRoute } from '../../lib/route.js';
import { getLogbook } from '../../services/logbook/index.js';

/**
 * GET /api/me/logbook
 * Returns the authenticated player's most recent logbook entries, newest first.
 */
export default defineRoute(async (app) => {
  app.get(
    '/logbook',
    {
      onRequest: [authenticate],
      schema: {
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
      },
    },
    async (request) => getLogbook(request.user.userId, request.query.limit)
  );
});
