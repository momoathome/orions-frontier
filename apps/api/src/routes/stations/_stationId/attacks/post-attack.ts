import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../../middleware/auth.js';
import { startAttack } from '../../../../services/combat.service.js';

const BodySchema = z.object({
  targetStationId: z.string().uuid(),
  spacecraftKey: z.string().min(1),
  amount: z.number().int().positive(),
});

export default (async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid attack');
    const { stationId } = request.params as { stationId: string };
    const report = await startAttack({
      userId: request.user.userId,
      stationId,
      ...parsed.data,
    });
    return reply.status(201).send(report);
  });
}) satisfies FastifyPluginAsync;
