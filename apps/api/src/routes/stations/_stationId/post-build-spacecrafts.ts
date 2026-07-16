import { and, eq } from 'drizzle-orm';
import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { buildSpacecrafts } from '../../../services/spacecraft.service.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/**
 * POST /api/stations/:stationId/spacecrafts/build
 * Enqueues spacecraft build orders for the given station.
 * Body: { orders: [{ spacecraftKey: string, amount: number }] }
 */
export default defineRoute(async (app) => {
  app.post('/spacecrafts/build', { preHandler: [authenticate] }, async (request, reply) => {
    const { stationId } = request.params as { stationId: string };

    const body = request.body as { orders?: unknown };
    if (!body || !Array.isArray(body.orders) || body.orders.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'orders must be a non-empty array');
    }

    const orders = body.orders as { spacecraftKey: unknown; amount: unknown }[];
    for (const order of orders) {
      if (typeof order.spacecraftKey !== 'string' || !order.spacecraftKey) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Each order must have a valid spacecraftKey'
        );
      }
      if (
        typeof order.amount !== 'number' ||
        !Number.isInteger(order.amount) ||
        order.amount <= 0
      ) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          'Each order must have a positive integer amount'
        );
      }
    }

    const db = getDb();
    const [station] = await db
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
      .limit(1);

    if (!station) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    }

    await buildSpacecrafts(
      station.id,
      request.user.userId,
      orders as { spacecraftKey: string; amount: number }[]
    );

    return reply.status(202).send({ success: true });
  });
});
