import { z } from 'zod';
import { authenticate } from '../../../middleware/auth.js';
import { getUserCombatReport } from '../../../services/combat/index.js';
import { defineRoute } from '../../../lib/route.js';

const ParamsSchema = z.object({ combatId: z.uuid() });

/** GET /api/me/combats/:combatId: one combat report the user flew or defended against. */
export default defineRoute(async (app) => {
  app.get(
    '/:combatId',
    { onRequest: [authenticate], schema: { params: ParamsSchema } },
    async (request) => getUserCombatReport(request.user.userId, request.params.combatId)
  );
});
