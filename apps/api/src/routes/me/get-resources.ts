import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import {
  getUserAggregatedResources,
  getDeliveredResourceRates,
} from '../../services/station-resource.service.js';

/**
 * GET /api/me/resources
 * Returns aggregated resources and actual deliveries during the last hour.
 */
export default (async (app) => {
  app.get('/resources', { preHandler: [authenticate] }, async (request, reply) => {
    const { userId } = request.user;
    const [resources, rates] = await Promise.all([
      getUserAggregatedResources(userId),
      getDeliveredResourceRates(userId),
    ]);

    return reply.send({
      success: true,
      data: { resources, rates },
    });
  });
}) satisfies FastifyPluginAsync;
