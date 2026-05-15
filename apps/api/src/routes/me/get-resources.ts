import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { getUserAggregatedResources } from '../../services/station-resource.service.js';

/**
 * GET /api/me/resources
 * Returns aggregated resources across all stations of the authenticated user.
 */
export default defineRoute(async (app) => {
  app.get('/resources', { preHandler: [authenticate] }, async (request, reply) => {
    const resources = await getUserAggregatedResources(request.user.userId);

    return reply.send({
      success: true,
      data: resources,
    });
  });
});
