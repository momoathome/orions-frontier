import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { required, type WorldMissionType } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../lib/db/index.js';
import { botControllers } from '../lib/db/schema/bot-controllers.js';
import { stations } from '../lib/db/schema/stations.js';
import { worldMissions } from '../lib/db/schema/world-missions.js';

/**
 * Missions under way or returning whose path may cross the bounds, with their origin position and
 * bot flag. A mission without a colony position flies to `sector` times its sector coordinates.
 */
export function listMovingWorldMissionsInBounds(
  db: QueryDb,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  sector: { WIDTH: number; HEIGHT: number }
) {
  const targetX = sql`coalesce(${worldMissions.targetX}, ${worldMissions.targetSectorX} * ${sector.WIDTH})`;
  const targetY = sql`coalesce(${worldMissions.targetY}, ${worldMissions.targetSectorY} * ${sector.HEIGHT})`;
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
    .where(
      and(
        inArray(worldMissions.status, ['traveling', 'returning']),
        // Out and back share one straight path, so its bounding box must touch the view.
        sql`least(${stations.x}, ${targetX}) < ${bounds.maxX}`,
        sql`greatest(${stations.x}, ${targetX}) >= ${bounds.minX}`,
        sql`least(${stations.y}, ${targetY}) < ${bounds.maxY}`,
        sql`greatest(${stations.y}, ${targetY}) >= ${bounds.minY}`
      )
    );
}

/** Locks the missions under way or returning that fly ships of these fleet rows. */
export function listMovingWorldMissionsBySpacecraftForUpdate(
  tx: Tx,
  stationSpacecraftIds: string[]
) {
  return tx
    .select()
    .from(worldMissions)
    .where(
      and(
        inArray(worldMissions.stationSpacecraftId, stationSpacecraftIds),
        inArray(worldMissions.status, ['traveling', 'returning'])
      )
    )
    .for('update');
}

export async function updateWorldMission(
  tx: Tx,
  id: string,
  values: Partial<typeof worldMissions.$inferInsert>
) {
  await tx.update(worldMissions).set(values).where(eq(worldMissions.id, id));
}

export type WorldMissionRow = typeof worldMissions.$inferSelect;

/** Serializes the user's mission starts for the rest of the transaction. */
export async function lockUserWorldMissions(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

/** Serializes colonization of one sector for the rest of the transaction. */
export async function lockSectorColonization(tx: Tx, sectorId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'colony:' + sectorId}))`);
}

/** True if the user already has a mission of that type traveling to the sector. */
export async function hasTravelingWorldMission(
  db: QueryDb,
  params: { userId: string; missionType: WorldMissionType; sectorX: number; sectorY: number }
) {
  const [active] = await db
    .select({ id: worldMissions.id })
    .from(worldMissions)
    .where(
      and(
        eq(worldMissions.userId, params.userId),
        eq(worldMissions.missionType, params.missionType),
        eq(worldMissions.targetSectorX, params.sectorX),
        eq(worldMissions.targetSectorY, params.sectorY),
        eq(worldMissions.status, 'traveling')
      )
    )
    .limit(1);
  return active !== undefined;
}

/** Colony positions reserved by colonizations traveling to the sector. */
export function listReservedColonyPositions(db: QueryDb, sectorX: number, sectorY: number) {
  return db
    .select({ x: worldMissions.targetX, y: worldMissions.targetY })
    .from(worldMissions)
    .where(
      and(
        eq(worldMissions.missionType, 'colonization'),
        eq(worldMissions.targetSectorX, sectorX),
        eq(worldMissions.targetSectorY, sectorY),
        eq(worldMissions.status, 'traveling'),
        sql`${worldMissions.targetX} is not null`,
        sql`${worldMissions.targetY} is not null`
      )
    );
}

export async function insertWorldMission(tx: Tx, values: typeof worldMissions.$inferInsert) {
  const [created] = await tx.insert(worldMissions).values(values).returning();
  return required(created, 'created');
}

export async function findWorldMission(db: QueryDb, id: string) {
  const [row] = await db.select().from(worldMissions).where(eq(worldMissions.id, id));
  return row;
}

/** The user's newest missions first. */
export function listWorldMissionsByUser(db: QueryDb, userId: string, limit: number) {
  return db
    .select()
    .from(worldMissions)
    .where(eq(worldMissions.userId, userId))
    .orderBy(desc(worldMissions.createdAt))
    .limit(limit);
}

/** Missions under way or returning that arrive by `now`, oldest first. */
export function listDueWorldMissionIds(db: QueryDb, now: Date) {
  return db
    .select({ id: worldMissions.id })
    .from(worldMissions)
    .where(
      and(
        inArray(worldMissions.status, ['traveling', 'returning']),
        lte(worldMissions.arrivesAt, now)
      )
    )
    .orderBy(asc(worldMissions.arrivesAt), asc(worldMissions.id));
}

/** Locks the mission if it is still due; undefined if another worker completed it. */
export async function findDueWorldMissionForUpdate(tx: Tx, id: string, now: Date) {
  const [mission] = await tx
    .select()
    .from(worldMissions)
    .where(
      and(
        eq(worldMissions.id, id),
        inArray(worldMissions.status, ['traveling', 'returning']),
        lte(worldMissions.arrivesAt, now)
      )
    )
    .for('update');
  return mission;
}

export function listMovingWorldMissionsByStations(db: QueryDb, originStationIds: string[]) {
  return db
    .select()
    .from(worldMissions)
    .where(
      and(
        inArray(worldMissions.originStationId, originStationIds),
        inArray(worldMissions.status, ['traveling', 'returning'])
      )
    );
}

export async function countArrivedExpeditionsByUser(db: QueryDb, userId: string) {
  const [row] = await db
    .select({ count: count() })
    .from(worldMissions)
    .where(
      and(
        eq(worldMissions.userId, userId),
        eq(worldMissions.missionType, 'expedition'),
        eq(worldMissions.status, 'arrived')
      )
    );
  return row?.count ?? 0;
}

/** Missions of that type still under way: traveling out or returning. */
export async function countMovingWorldMissionsByUser(
  db: QueryDb,
  userId: string,
  missionType: WorldMissionType
) {
  const [row] = await db
    .select({ count: count() })
    .from(worldMissions)
    .where(
      and(
        eq(worldMissions.userId, userId),
        eq(worldMissions.missionType, missionType),
        inArray(worldMissions.status, ['traveling', 'returning'])
      )
    );
  return row?.count ?? 0;
}
