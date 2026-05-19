import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import {
  getUserAggregatedResources,
  getUserMiningRates,
} from '../../services/station-resource.service.js';

/**
 * GET /api/me/resources
 * Returns aggregated resources and theoretical mining rates across all stations.
 */
export default defineRoute(async (app) => {
  app.get('/resources', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const [resources, rates] = await Promise.all([
      getUserAggregatedResources(userId),
      getUserMiningRates(userId),
    ]);

    return reply.send({
      success: true,
      data: { resources, rates },
    });
  });
});
