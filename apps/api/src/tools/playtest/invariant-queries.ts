import { and, eq, gt, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { calculateStorageCapacity as warehouseCapacity } from '@orions-frontier/game-config';
import { getDb } from '../../lib/db/index.js';
import { asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { combatMissions } from '../../lib/db/schema/combat-missions.js';
import { salvageMissions } from '../../lib/db/schema/debris-fields.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { userResearch } from '../../lib/db/schema/user-research.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { worldMissions } from '../../lib/db/schema/world-missions.js';

export type DatabaseInvariantCode =
  | 'negative_resource'
  | 'negative_asteroid_reserve'
  | 'negative_fleet'
  | 'invalid_fleet_lock'
  | 'negative_build_order'
  | 'overdue_active_work'
  | 'storage_capacity_exceeded'
  | 'active_work_without_fleet';

export interface RawDatabaseInvariantViolation {
  code: DatabaseInvariantCode;
  userId?: string;
  stationId?: string;
  entityKind?: 'asteroid' | 'trip' | 'order' | 'research' | 'mission' | 'work';
  entityId?: string;
  values: Record<string, string | number | boolean | null>;
}

export interface StationOwnerState {
  stationId: string;
  userId: string;
}

export async function queryDatabaseInvariantState(
  now: Date,
  controlledUserIds: readonly string[],
  trackedStationIds: readonly string[] = []
): Promise<{
  violations: RawDatabaseInvariantViolation[];
  stationOwners: StationOwnerState[];
}> {
  if (controlledUserIds.length === 0) return { violations: [], stationOwners: [] };
  const db = getDb();

  const [
    negativeVeins,
    invalidFleets,
    negativeOrders,
    resourceRows,
    warehouseRows,
    dueTrips,
    dueBuildings,
    dueOrders,
    dueResearch,
    dueWorldMissions,
    activeTrips,
    activeWorldMissions,
    activeCombatMissions,
    activeSalvageMissions,
    stationOwners,
  ] = await Promise.all([
    db
      .select({
        id: asteroidVeins.id,
        resourceKey: asteroidVeins.resourceKey,
        remainingAmount: asteroidVeins.remainingAmount,
      })
      .from(asteroidVeins)
      .where(lt(asteroidVeins.remainingAmount, 0)),
    db
      .select({
        id: stationSpacecrafts.id,
        userId: stations.userId,
        stationId: stationSpacecrafts.stationId,
        spacecraftKey: stationSpacecrafts.spacecraftKey,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(stationSpacecrafts)
      .innerJoin(stations, eq(stations.id, stationSpacecrafts.stationId))
      .where(
        and(
          inArray(stations.userId, controlledUserIds),
          or(
            lt(stationSpacecrafts.amount, 0),
            lt(stationSpacecrafts.lockedAmount, 0),
            gt(stationSpacecrafts.lockedAmount, stationSpacecrafts.amount)
          )
        )
      ),
    db
      .select({
        id: spacecraftBuildOrders.id,
        userId: stations.userId,
        stationId: spacecraftBuildOrders.stationId,
        amount: spacecraftBuildOrders.amount,
      })
      .from(spacecraftBuildOrders)
      .innerJoin(stations, eq(stations.id, spacecraftBuildOrders.stationId))
      .where(and(inArray(stations.userId, controlledUserIds), lt(spacecraftBuildOrders.amount, 0))),
    db
      .select({
        userId: stations.userId,
        stationId: stationResources.stationId,
        resourceKey: stationResources.resourceKey,
        amount: stationResources.amount,
      })
      .from(stationResources)
      .innerJoin(stations, eq(stations.id, stationResources.stationId))
      .where(inArray(stations.userId, controlledUserIds)),
    db
      .select({ stationId: stationBuildings.stationId, level: stationBuildings.level })
      .from(stationBuildings)
      .innerJoin(stations, eq(stations.id, stationBuildings.stationId))
      .where(
        and(
          inArray(stations.userId, controlledUserIds),
          eq(stationBuildings.buildingKey, 'warehouse')
        )
      ),
    db
      .select({
        id: spacecraftTrips.id,
        userId: stations.userId,
        stationId: stationSpacecrafts.stationId,
        dueAt: spacecraftTrips.arrivesAt,
      })
      .from(spacecraftTrips)
      .innerJoin(stationSpacecrafts, eq(stationSpacecrafts.id, spacecraftTrips.stationSpacecraftId))
      .innerJoin(stations, eq(stations.id, stationSpacecrafts.stationId))
      .where(
        and(
          inArray(stations.userId, controlledUserIds),
          eq(spacecraftTrips.status, 'traveling'),
          lte(spacecraftTrips.arrivesAt, now)
        )
      ),
    db
      .select({
        id: stationBuildings.id,
        userId: stations.userId,
        stationId: stationBuildings.stationId,
        dueAt: stationBuildings.upgradeEndsAt,
      })
      .from(stationBuildings)
      .innerJoin(stations, eq(stations.id, stationBuildings.stationId))
      .where(
        and(inArray(stations.userId, controlledUserIds), lte(stationBuildings.upgradeEndsAt, now))
      ),
    db
      .select({
        id: spacecraftBuildOrders.id,
        userId: stations.userId,
        stationId: spacecraftBuildOrders.stationId,
        dueAt: spacecraftBuildOrders.nextAt,
      })
      .from(spacecraftBuildOrders)
      .innerJoin(stations, eq(stations.id, spacecraftBuildOrders.stationId))
      .where(
        and(inArray(stations.userId, controlledUserIds), lte(spacecraftBuildOrders.nextAt, now))
      ),
    db
      .select({
        id: userResearch.id,
        userId: userResearch.userId,
        stationId: userResearch.paidByStationId,
        dueAt: userResearch.completesAt,
      })
      .from(userResearch)
      .where(
        and(inArray(userResearch.userId, controlledUserIds), lte(userResearch.completesAt, now))
      ),
    db
      .select({
        id: worldMissions.id,
        userId: worldMissions.userId,
        stationId: worldMissions.originStationId,
        dueAt: worldMissions.arrivesAt,
      })
      .from(worldMissions)
      .where(
        and(
          inArray(worldMissions.userId, controlledUserIds),
          ne(worldMissions.status, 'arrived'),
          lte(worldMissions.arrivesAt, now)
        )
      ),
    db
      .select({
        id: spacecraftTrips.id,
        userId: stations.userId,
        stationId: stationSpacecrafts.stationId,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(spacecraftTrips)
      .leftJoin(stationSpacecrafts, eq(stationSpacecrafts.id, spacecraftTrips.stationSpacecraftId))
      .leftJoin(stations, eq(stations.id, stationSpacecrafts.stationId))
      .where(
        and(
          inArray(stations.userId, controlledUserIds),
          eq(spacecraftTrips.status, 'traveling'),
          or(
            isNull(stationSpacecrafts.id),
            lte(stationSpacecrafts.amount, 0),
            lte(stationSpacecrafts.lockedAmount, 0)
          )
        )
      ),
    db
      .select({
        id: worldMissions.id,
        userId: worldMissions.userId,
        stationId: worldMissions.originStationId,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(worldMissions)
      .leftJoin(stationSpacecrafts, eq(stationSpacecrafts.id, worldMissions.stationSpacecraftId))
      .where(
        and(
          inArray(worldMissions.userId, controlledUserIds),
          ne(worldMissions.status, 'arrived'),
          or(
            isNull(stationSpacecrafts.id),
            lte(stationSpacecrafts.amount, 0),
            lte(stationSpacecrafts.lockedAmount, 0)
          )
        )
      ),
    db
      .select({
        id: combatMissions.id,
        userId: combatMissions.userId,
        stationId: combatMissions.attackerStationId,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(combatMissions)
      .leftJoin(
        stationSpacecrafts,
        and(
          eq(stationSpacecrafts.stationId, combatMissions.attackerStationId),
          sql`${combatMissions.attackerFleet} ? ${stationSpacecrafts.spacecraftKey}`
        )
      )
      .where(
        and(
          inArray(combatMissions.userId, controlledUserIds),
          ne(combatMissions.status, 'resolved'),
          or(
            isNull(stationSpacecrafts.id),
            lte(stationSpacecrafts.amount, 0),
            lte(stationSpacecrafts.lockedAmount, 0)
          )
        )
      ),
    db
      .select({
        id: salvageMissions.id,
        userId: salvageMissions.userId,
        stationId: salvageMissions.stationId,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(salvageMissions)
      .leftJoin(stationSpacecrafts, eq(stationSpacecrafts.id, salvageMissions.stationSpacecraftId))
      .where(
        and(
          inArray(salvageMissions.userId, controlledUserIds),
          ne(salvageMissions.status, 'resolved'),
          or(
            isNull(stationSpacecrafts.id),
            lte(stationSpacecrafts.amount, 0),
            lte(stationSpacecrafts.lockedAmount, 0)
          )
        )
      ),
    db
      .select({ stationId: stations.id, userId: stations.userId })
      .from(stations)
      .where(
        trackedStationIds.length > 0
          ? or(inArray(stations.userId, controlledUserIds), inArray(stations.id, trackedStationIds))
          : inArray(stations.userId, controlledUserIds)
      ),
  ]);

  const violations: RawDatabaseInvariantViolation[] = [];
  for (const row of resourceRows.filter((resource) => resource.amount < 0)) {
    violations.push({
      code: 'negative_resource',
      userId: row.userId,
      stationId: row.stationId,
      values: { resourceKey: row.resourceKey, amount: row.amount },
    });
  }
  for (const row of negativeVeins) {
    violations.push({
      code: 'negative_asteroid_reserve',
      entityKind: 'asteroid',
      entityId: row.id,
      values: { resourceKey: row.resourceKey, remainingAmount: row.remainingAmount },
    });
  }
  for (const row of invalidFleets) {
    violations.push({
      code: row.amount < 0 ? 'negative_fleet' : 'invalid_fleet_lock',
      userId: row.userId,
      stationId: row.stationId,
      entityKind: 'work',
      entityId: row.id,
      values: {
        spacecraftKey: row.spacecraftKey,
        amount: row.amount,
        lockedAmount: row.lockedAmount,
      },
    });
  }
  for (const row of negativeOrders) {
    violations.push({
      code: 'negative_build_order',
      userId: row.userId,
      stationId: row.stationId,
      entityKind: 'order',
      entityId: row.id,
      values: { amount: row.amount },
    });
  }

  const capacityByStation = new Map(
    warehouseRows.map((row) => [row.stationId, warehouseCapacity(row.level)])
  );
  for (const row of resourceRows) {
    const capacity = capacityByStation.get(row.stationId) ?? 0;
    if (row.amount > capacity) {
      violations.push({
        code: 'storage_capacity_exceeded',
        userId: row.userId,
        stationId: row.stationId,
        values: { resourceKey: row.resourceKey, amount: row.amount, capacity },
      });
    }
  }

  const dueCollections = [
    ['trip', dueTrips],
    ['work', dueBuildings],
    ['order', dueOrders],
    ['research', dueResearch],
    ['mission', dueWorldMissions],
  ] as const;
  for (const [entityKind, rows] of dueCollections) {
    for (const row of rows) {
      violations.push({
        code: 'overdue_active_work',
        userId: row.userId,
        stationId: row.stationId ?? undefined,
        entityKind,
        entityId: row.id,
        values: { dueAt: row.dueAt?.toISOString() ?? null, now: now.toISOString() },
      });
    }
  }

  for (const [entityKind, rows] of [
    ['trip', activeTrips],
    ['mission', activeWorldMissions],
    ['mission', activeCombatMissions],
    ['mission', activeSalvageMissions],
  ] as const) {
    for (const row of rows) {
      violations.push({
        code: 'active_work_without_fleet',
        userId: row.userId ?? undefined,
        stationId: row.stationId ?? undefined,
        entityKind,
        entityId: row.id,
        values: { amount: row.amount ?? null, lockedAmount: row.lockedAmount ?? null },
      });
    }
  }

  violations.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.stationId ?? '').localeCompare(right.stationId ?? '') ||
      (left.entityId ?? '').localeCompare(right.entityId ?? '')
  );
  return { violations, stationOwners };
}
