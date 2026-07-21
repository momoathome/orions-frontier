import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { authenticate } from '../../../../middleware/auth.js';
import { startSalvage } from '../../../../services/salvage.service.js';

const BodySchema = z.object({
  stationId: z.string().uuid(),
  spacecraftDefinitionId: z.string().uuid(),
  amount: z.number().int().positive(),
});

export default (async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid salvage order');
    const { id } = request.params as { id: string };
    const mission = await startSalvage({
      userId: request.user.userId,
      debrisFieldId: id,
      ...parsed.data,
    });
    return reply.status(201).send({ success: true, data: mission });
  });
}) satisfies FastifyPluginAsync;
