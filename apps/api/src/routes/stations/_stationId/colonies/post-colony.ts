import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../../middleware/auth.js';
import { startColonization } from '../../../../services/world-mission.service.js';

const BodySchema = z.object({
  sectorX: z.number().int(),
  sectorY: z.number().int(),
  name: z.string().trim().min(1).max(128),
});

export default (async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid colony');
    const { stationId } = request.params as { stationId: string };
    const mission = await startColonization({
      userId: request.user.userId,
      stationId,
      ...parsed.data,
    });
    return reply.status(201).send({ success: true, data: mission });
  });
}) satisfies FastifyPluginAsync;
