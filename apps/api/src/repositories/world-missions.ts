import { eq, inArray } from 'drizzle-orm';
import type { QueryDb } from '../lib/db/index.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { stations } from '../lib/db/schema/stations.js';
import { worldMissions } from '../lib/db/schema/world-missions.js';

/** Missions under way or returning, with their origin position and bot flag. */
export function listMovingWorldMissions(db: QueryDb) {
  return db
    .select({
      id: worldMissions.id,
      fromX: stations.x,
      fromY: stations.y,
      targetSectorX: worldMissions.targetSectorX,
      targetSectorY: worldMissions.targetSectorY,
      targetX: worldMissions.targetX,
      targetY: worldMissions.targetY,
      departedAt: worldMissions.departedAt,
      arrivesAt: worldMissions.arrivesAt,
      status: worldMissions.status,
      purpose: worldMissions.missionType,
      spacecraftKey: worldMissions.spacecraftKey,
      userId: worldMissions.userId,
      botUserId: botControllers.userId,
    })
    .from(worldMissions)
    .innerJoin(stations, eq(worldMissions.originStationId, stations.id))
    .leftJoin(botControllers, eq(botControllers.userId, worldMissions.userId))
    .where(inArray(worldMissions.status, ['traveling', 'returning']));
}
