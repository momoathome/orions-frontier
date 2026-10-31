import { authenticate } from '../../../middleware/auth.js';
import { getUserCombatReports } from '../../../services/combat/index.js';
import { defineRoute, pageQuery } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate], schema: { querystring: pageQuery } }, async (request) =>
    getUserCombatReports(request.user.userId, request.query)
  );
});
