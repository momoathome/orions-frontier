import { and, desc, eq, gte, ne, or } from 'drizzle-orm';
import { required } from '@orions-frontier/shared';
import type { QueryDb, Tx } from '../../../lib/db/index.js';
import { combatMissions } from '../../../lib/db/schema/combat-missions.js';
import { spacecraftTrips } from '../../../lib/db/schema/spacecraft-trips.js';
import { stations } from '../../../lib/db/schema/stations.js';

export type CombatMissionRow = typeof combatMissions.$inferSelect;

export async function insertCombatMission(tx: Tx, values: typeof combatMissions.$inferInsert) {
  const [row] = await tx.insert(combatMissions).values(values).returning();
  return required(row, 'created');
}

/** Missions the user flew or defended against, newest first, with defender and arrival time. */
export function listCombatMissionsByUser(db: QueryDb, userId: string, limit: number, since?: Date) {
  return db
    .select({
      mission: combatMissions,
      defenderUserId: stations.userId,
      arrivesAt: spacecraftTrips.arrivesAt,
    })
    .from(combatMissions)
    .innerJoin(stations, eq(combatMissions.defenderStationId, stations.id))
    .innerJoin(spacecraftTrips, eq(combatMissions.outboundTripId, spacecraftTrips.id))
    .where(
      and(
        or(eq(combatMissions.userId, userId), eq(stations.userId, userId)),
        since ? gte(combatMissions.createdAt, since) : undefined
      )
    )
    .orderBy(desc(combatMissions.createdAt))
    .limit(limit);
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
