import { authenticate } from '../../../middleware/auth.js';
import { getUserWorldMissions } from '../../../services/missions/index.js';
import { defineRoute, pageQuery } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate], schema: { querystring: pageQuery } }, async (request) =>
    getUserWorldMissions(request.user.userId, request.query)
  );
});
