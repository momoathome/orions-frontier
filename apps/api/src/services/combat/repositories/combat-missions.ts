import { and, desc, eq, gte, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { required } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../../../lib/db/index.js';
import { combatMissions } from '../../../lib/db/schema/combat-missions.js';
import { spacecraftTrips } from '../../../lib/db/schema/spacecraft-trips.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { users } from '../../../lib/db/schema/users.js';

export type CombatMissionRow = typeof combatMissions.$inferSelect;

export async function insertCombatMission(tx: Tx, values: typeof combatMissions.$inferInsert) {
  const [row] = await tx.insert(combatMissions).values(values).returning();
  return required(row, 'created');
}

const attackerStations = alias(stations, 'attacker_station');
const attackerUsers = alias(users, 'attacker_user');
const defenderUsers = alias(users, 'defender_user');

/**
 * Missions the user flew or defended against, newest first, with both sides' station and player
 * names and the arrival time; `id` narrows it to one mission.
 */
export function listCombatMissionsByUser(
  db: QueryDb,
  userId: string,
  { since, limit, offset, id }: { since?: Date; limit: number; offset: number; id?: string }
) {
  return (
    db
      .select({
        mission: combatMissions,
        defenderUserId: stations.userId,
        arrivesAt: spacecraftTrips.arrivesAt,
        attacker: {
          userName: attackerUsers.username,
          stationName: attackerStations.name,
          x: attackerStations.x,
          y: attackerStations.y,
        },
        defender: {
          userName: defenderUsers.username,
          stationName: stations.name,
          x: stations.x,
          y: stations.y,
        },
      })
      .from(combatMissions)
      .innerJoin(stations, eq(combatMissions.defenderStationId, stations.id))
      .innerJoin(attackerStations, eq(combatMissions.attackerStationId, attackerStations.id))
      .innerJoin(attackerUsers, eq(combatMissions.userId, attackerUsers.id))
      .innerJoin(defenderUsers, eq(stations.userId, defenderUsers.id))
      .innerJoin(spacecraftTrips, eq(combatMissions.outboundTripId, spacecraftTrips.id))
      .where(
        and(
          or(eq(combatMissions.userId, userId), eq(stations.userId, userId)),
          since ? gte(combatMissions.createdAt, since) : undefined,
          id ? eq(combatMissions.id, id) : undefined
        )
      )
      // Traveling missions first, so an incoming attack is never pushed off the first page.
      .orderBy(
        desc(sql`${combatMissions.status} = 'traveling'`),
        desc(combatMissions.createdAt),
        desc(combatMissions.id)
      )
      .limit(limit)
      .offset(offset)
  );
}

/** Locks the mission whose outbound trip this is, while it is still traveling. */
export async function findTravelingCombatMissionForUpdate(tx: Tx, outboundTripId: string) {
  const [row] = await tx
    .select()
    .from(combatMissions)
    .where(
      and(eq(combatMissions.outboundTripId, outboundTripId), eq(combatMissions.status, 'traveling'))
    )
    .for('update');
  return row;
}

/** Locks the mission whose return trip this is, while it is still returning. */
export async function findReturningCombatMissionForUpdate(tx: Tx, returnTripId: string) {
  const [row] = await tx
    .select()
    .from(combatMissions)
    .where(
      and(eq(combatMissions.returnTripId, returnTripId), eq(combatMissions.status, 'returning'))
    )
    .for('update');
  return row;
}

export async function updateCombatMission(
  tx: Tx,
  id: string,
  values: Partial<typeof combatMissions.$inferInsert>
) {
  await tx.update(combatMissions).set(values).where(eq(combatMissions.id, id));
}

/** Resolves the mission flying this trip, whatever its status; undefined if none. */
export async function resolveCombatMissionByTrip(
  tx: Tx,
  leg: 'outbound' | 'return',
  tripId: string,
  resolvedAt: Date
) {
  const column = leg === 'outbound' ? combatMissions.outboundTripId : combatMissions.returnTripId;
  const [mission] = await tx
    .update(combatMissions)
    .set({ status: 'resolved', resolvedAt })
    .where(eq(column, tripId))
    .returning();
  return mission;
}

export function listUnresolvedCombatMissionsByUser(db: QueryDb, userId: string) {
  return db
    .select()
    .from(combatMissions)
    .where(and(eq(combatMissions.userId, userId), ne(combatMissions.status, 'resolved')));
}

/** What the user's newest wave with survivors against this station reported, if any. */
export async function findLatestScouting(db: QueryDb, userId: string, defenderStationId: string) {
  const [row] = await db
    .select({ scouting: combatMissions.scouting })
    .from(combatMissions)
    .where(
      and(
        eq(combatMissions.userId, userId),
        eq(combatMissions.defenderStationId, defenderStationId),
        isNotNull(combatMissions.scouting),
        // A wiped-out wave saw the target but brought nothing home.
        lt(combatMissions.attackerLosses, combatMissions.attackerAmount)
      )
    )
    .orderBy(desc(combatMissions.createdAt), desc(combatMissions.id))
    .limit(1);
  return row?.scouting ?? null;
}
