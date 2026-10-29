import { authenticate } from '../../../middleware/auth.js';
import { getUserSalvageMissions } from '../../../services/combat/index.js';
import { defineRoute } from '../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get('/', { onRequest: [authenticate] }, async (request) =>
    getUserSalvageMissions(request.user.userId)
  );
});
