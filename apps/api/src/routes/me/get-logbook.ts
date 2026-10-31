import { authenticate } from '../../middleware/auth.js';
import { defineRoute, pageQuery } from '../../lib/route.js';
import { getLogbook } from '../../services/logbook/index.js';

/**
 * GET /api/me/logbook
 * Returns the authenticated player's logbook entries, newest first, one page at a time.
 */
export default defineRoute(async (app) => {
  app.get(
    '/logbook',
    {
      onRequest: [authenticate],
      schema: { querystring: pageQuery },
    },
    async (request) => getLogbook(request.user.userId, request.query)
  );
});
