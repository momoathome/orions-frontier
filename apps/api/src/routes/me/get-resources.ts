import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import {
  getUserAggregatedResources,
  getUserMiningRates,
  getTransportEffectiveRates,
} from '../../services/station-resource.service.js';

/**
 * GET /api/me/resources
 * Returns aggregated resources, theoretical mining rates, and effective
 * transport delivery rates (last hour) across all stations.
 */
export default defineRoute(async (app) => {
  app.get('/resources', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const [resources, rates, effectiveRates] = await Promise.all([
      getUserAggregatedResources(userId),
      getUserMiningRates(userId),
      getTransportEffectiveRates(userId),
    ]);

    return reply.send({
      success: true,
      data: { resources, rates, effectiveRates },
    });
  });
});
