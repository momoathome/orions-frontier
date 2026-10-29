import { authenticate } from '../../../../middleware/auth.js';
import { getResearchState } from '../../../../services/research/index.js';
import { defineRoute, stationParams } from '../../../../lib/route.js';

export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { params: stationParams } },
    async (request) => {
      const { stationId } = request.params;
      return getResearchState(stationId, request.user.userId);
    }
  );
});
