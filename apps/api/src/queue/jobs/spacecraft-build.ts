import { eq, and, sql } from 'drizzle-orm';
import type { SpacecraftBuildJobData } from '../queues/spacecraft-build-queue.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { getDb } from '../../lib/db/index.js';
import { getRedis } from '../../lib/redis.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';

const logger = rootLogger.child({ name: 'queue-jobs' });

export const handleSpacecraftBuild = async (data: SpacecraftBuildJobData) => {
  const { userId, stationId, spacecraftDefinitionId, spacecraftKey, orderId, amount } = data;
  logger.info({ userId, stationId, spacecraftKey, orderId, amount }, 'Completing spacecraft build');

  const db = getDb();

  // Verify order still exists (idempotency guard)
  const [order] = await db
    .select({ id: spacecraftBuildOrders.id })
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.id, orderId))
    .limit(1);

  if (!order) {
    logger.warn({ orderId }, 'Spacecraft build order not found — already processed or missing');
    return;
  }

  // Increment stationSpacecrafts amount
  await db
    .update(stationSpacecrafts)
    .set({
      amount: sql`${stationSpacecrafts.amount} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitionId),
        eq(stationSpacecrafts.stationId, stationId)
      )
    );

  // Delete the completed order
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.id, orderId));

  // Publish real-time event
  await getRedis().publish(
    `user:${userId}:events`,
    JSON.stringify({
      type: 'spacecraft_build_completed',
      payload: { stationId, spacecraftKey, amount, orderId },
      timestamp: Date.now(),
    })
  );

  logger.info({ stationId, spacecraftKey, amount }, 'Spacecraft build completed and published');
};
