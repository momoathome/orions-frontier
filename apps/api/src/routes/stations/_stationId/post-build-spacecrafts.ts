import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { buildSpacecrafts } from '../../../services/spacecraft.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { defineRoute, stationParams } from '../../../lib/route.js';

const BodySchema = z.object({
  orders: z
    .array(z.object({ spacecraftKey: z.string().min(1), amount: z.number().int().positive() }))
    .min(1),
});

/**
 * POST /api/stations/:stationId/spacecrafts/build
 * Enqueues spacecraft build orders for the given station.
 */
export default defineRoute(async (app) => {
  app.post(
    '/spacecrafts/build',
    { onRequest: [authenticate], schema: { params: stationParams, body: BodySchema } },
    async (request, reply) => {
      const { stationId } = request.params;

      const db = getDb();
      const [station] = await db
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
      }

      await buildSpacecrafts(station.id, request.user.userId, request.body.orders);

      return reply.status(202).send();
    }
  );
});
