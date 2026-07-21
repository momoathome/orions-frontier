import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../middleware/auth.js';
import { getDiscoveredSectors } from '../../../services/world-mission.service.js';

const QuerySchema = z.object({ stationId: z.string().uuid() });

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'stationId is required');
    return {
      success: true,
      data: await getDiscoveredSectors(request.user.userId, parsed.data.stationId),
    };
  });
}) satisfies FastifyPluginAsync;
