import { authenticate } from '../../../middleware/auth.js';
import { getResearchState } from '../../../services/research/index.js';
import { defineRoute } from '../../../lib/route.js';

/** GET /api/me/research: account-wide research levels, running research and blockers. */
export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate] }, async (request) =>
    getResearchState(request.user.userId)
  );
});
