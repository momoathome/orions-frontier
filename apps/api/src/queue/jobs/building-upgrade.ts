import { eq, and } from 'drizzle-orm';
import type { BuildingUpgradeJobData } from '../queues/action-queue.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { getDb } from '../../lib/db/index.js';
import { getRedis } from '../../lib/redis.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { buildingDefinitions } from '../../lib/db/schema/building-definitions.js';

const logger = rootLogger.child({ name: 'queue-jobs' });

export const handleBuildingUpgradeFinished = async (data: BuildingUpgradeJobData) => {
  const { stationId, buildingKey, userId } = data;
  logger.info({ userId, stationId, buildingKey }, 'Completing building upgrade');

  const db = getDb();

  const [def] = await db
    .select({ id: buildingDefinitions.id, maxLevel: buildingDefinitions.maxLevel })
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, buildingKey))
    .limit(1);

  if (!def) {
    logger.error({ buildingKey }, 'Building definition not found — skipping job');
    return;
  }

  const [building] = await db
    .select({ id: stationBuildings.id, level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(
        eq(stationBuildings.stationId, stationId),
        eq(stationBuildings.buildingDefinitionId, def.id)
      )
    )
    .limit(1);

  if (!building) {
    logger.error({ stationId, buildingKey }, 'Station building not found — skipping job');
    return;
  }

  const newLevel = Math.min(building.level + 1, def.maxLevel);

  await db
    .update(stationBuildings)
    .set({ level: newLevel, upgradeEndsAt: null, updatedAt: new Date() })
    .where(eq(stationBuildings.id, building.id));

  await getRedis().publish(
    `user:${userId}:events`,
    JSON.stringify({
      type: 'building_upgrade_completed',
      payload: { stationId, buildingKey, newLevel },
      timestamp: Date.now(),
    })
  );

  logger.info({ stationId, buildingKey, level: newLevel }, 'Building upgrade completed');
};
