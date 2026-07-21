import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../middleware/auth.js';
import {
  getStationResources,
  getDeliveredResourceRates,
} from '../../services/station-resource.service.js';

const QuerySchema = z.object({ stationId: z.string().uuid() });

export default (async (app) => {
  app.get('/resources', { preHandler: [authenticate] }, async (request) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'stationId is required');
    const { userId } = request.user;
    const { stationId } = parsed.data;
    const [resources, rates] = await Promise.all([
      getStationResources(userId, stationId),
      getDeliveredResourceRates(userId, stationId),
    ]);

    return { resources, rates };
  });
}) satisfies FastifyPluginAsync;
