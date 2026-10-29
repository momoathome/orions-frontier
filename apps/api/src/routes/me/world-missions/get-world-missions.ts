import { authenticate } from '../../../middleware/auth.js';
import { getUserWorldMissions } from '../../../services/missions/index.js';
import { defineRoute } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate] }, async (request) =>
    getUserWorldMissions(request.user.userId)
  );
});
