import { z } from 'zod';
import { defineRoute } from '../../lib/route-helper.js';
import { authenticate } from '../../middleware/auth.js';
import { createStation } from '../../services/station.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

const CreateStationSchema = z.object({
  name: z.string().min(1).max(128),
  x: z.number().int(),
  y: z.number().int(),
});

/**
 * POST /api/stations
 * Creates a new station for the authenticated user and seeds initial resources.
 */
export default defineRoute(async (app) => {
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = CreateStationSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Invalid request body', {
        issues: parsed.error.issues,
      });
    }

    const { name, x, y } = parsed.data;
    const station = await createStation(request.user.userId, { name, x, y });

    return reply.status(201).send({ success: true, data: station });
  });
});
