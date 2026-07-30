import { and, asc, between, eq, inArray, ne, or } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { combatMissions } from '../../lib/db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../../lib/db/schema/debris-fields.js';
import { sectors } from '../../lib/db/schema/sectors.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stationResearch } from '../../lib/db/schema/station-research.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { worldMissions } from '../../lib/db/schema/world-missions.js';
import { buildingKeys, defenseUpgradeKeys } from '@orions-frontier/shared';
import type { ResourceKey, ResourceMap } from '@orions-frontier/shared';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import {
  getUserScannerCoverages,
  isPointVisible,
  scannerChunkBounds,
} from '../scanner-visibility.service.js';
import { getVisibleChunkStations } from '../world.service.js';
import { getUserCombatReports } from '../combat.service.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';

export async function loadGoalBotState(
  userId: string,
  now = new Date()
): Promise<GoalBotState | null> {
  const db = getDb();
  const ownStationRows = await db
    .select({
      id: stations.id,
      userId: stations.userId,
      name: stations.name,
      sectorId: stations.sectorId,
      x: stations.x,
      y: stations.y,
      chunkX: stations.chunkX,
      chunkY: stations.chunkY,
      createdAt: stations.createdAt,
      sectorX: sectors.sectorX,
      sectorY: sectors.sectorY,
    })
    .from(stations)
    .innerJoin(sectors, eq(stations.sectorId, sectors.id))
    .where(eq(stations.userId, userId))
    .orderBy(asc(stations.id));
  if (ownStationRows.length === 0) return null;

  // Build per-station snapshots
  const stationIds = ownStationRows.map((s) => s.id);
  const [
    allResources,
    allBuildings,
    allFleets,
    allBuildOrders,
    allResearch,
    allAssignments,
    allTrips,
    allMissions,
    allCombatMissions,
    allSalvageMissions,
  ] = await Promise.all([
    db.select().from(stationResources).where(inArray(stationResources.stationId, stationIds)),
    db.select().from(stationBuildings).where(inArray(stationBuildings.stationId, stationIds)),
    db.select().from(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds)),
    db
      .select()
      .from(spacecraftBuildOrders)
      .where(inArray(spacecraftBuildOrders.stationId, stationIds)),
    db.select().from(stationResearch).where(inArray(stationResearch.stationId, stationIds)),
    db.select().from(asteroidAssignments).where(inArray(asteroidAssignments.stationId, stationIds)),
    db
      .select({
        id: spacecraftTrips.id,
        stationId: stationSpacecrafts.stationId,
        purpose: spacecraftTrips.purpose,
        status: spacecraftTrips.status,
        arrivesAt: spacecraftTrips.arrivesAt,
        toId: spacecraftTrips.toId,
      })
      .from(spacecraftTrips)
      .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
      .where(
        and(
          inArray(stationSpacecrafts.stationId, stationIds),
          eq(spacecraftTrips.status, 'traveling')
        )
      ),
    db
      .select()
      .from(worldMissions)
      .where(
        and(
          inArray(worldMissions.originStationId, stationIds),
          inArray(worldMissions.status, ['traveling', 'returning'])
        )
      ),
    db
      .select()
      .from(combatMissions)
      .where(and(eq(combatMissions.userId, userId), ne(combatMissions.status, 'resolved'))),
    db
      .select()
      .from(salvageMissions)
      .where(and(eq(salvageMissions.userId, userId), ne(salvageMissions.status, 'resolved'))),
  ]);

  const groupByStation = <T extends { stationId: string }>(
    rows: readonly T[]
  ): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const existing = grouped.get(row.stationId);
      if (existing) existing.push(row);
      else grouped.set(row.stationId, [row]);
    }
    return grouped;
  };

  const resourcesByStation = groupByStation(allResources);
  const buildingsByStation = groupByStation(allBuildings);
  const fleetsByStation = groupByStation(allFleets);
  const buildsByStation = groupByStation(allBuildOrders);
  const researchByStation = groupByStation(allResearch);
  const assignmentsByStation = groupByStation(allAssignments);
  const tripsByStation = groupByStation(allTrips);
  const missionsByStation = groupByStation(
    allMissions.map((mission) => ({ ...mission, stationId: mission.originStationId }))
  );
  const combatsByStation = groupByStation(
    allCombatMissions.map((mission) => ({ ...mission, stationId: mission.attackerStationId }))
  );
  const salvageByStation = groupByStation(allSalvageMissions);

  const ownStations: StationSnapshot[] = ownStationRows.map((station) => {
    const stResources = resourcesByStation.get(station.id) ?? [];
    const stBuildings = buildingsByStation.get(station.id) ?? [];
    const stFleets = fleetsByStation.get(station.id) ?? [];
    const stBuildOrders = buildsByStation.get(station.id) ?? [];
    const stResearch = researchByStation.get(station.id) ?? [];
    const stAssignments = assignmentsByStation.get(station.id) ?? [];
    const stTrips = tripsByStation.get(station.id) ?? [];
    const stMissions = missionsByStation.get(station.id) ?? [];
    const stCombatMissions = combatsByStation.get(station.id) ?? [];
    const stSalvageMissions = salvageByStation.get(station.id) ?? [];

    return {
      id: station.id,
      name: station.name,
      x: station.x,
      y: station.y,
      sectorId: station.sectorId,
      sectorX: station.sectorX,
      sectorY: station.sectorY,
      createdAt: station.createdAt,
      storageCapacity:
        calculateBuildingEffect(
          'warehouse',
          stBuildings.find((building) => building.buildingKey === 'warehouse')?.level ?? 0
        ).find((effect) => effect.type === 'storage_capacity')?.value ?? 0,
      resources: Object.fromEntries(
        stResources.map((r) => [r.resourceKey, r.amount])
      ) as ResourceMap,
      buildings: stBuildings
        .filter((building) => (buildingKeys as readonly string[]).includes(building.buildingKey))
        .map((building) => ({
          buildingKey: building.buildingKey,
          level: building.level,
          upgradeEndsAt: building.upgradeEndsAt,
        })),
      defense: stBuildings
        .filter((b) => (defenseUpgradeKeys as readonly string[]).includes(b.buildingKey))
        .map((b) => ({
          upgradeKey: b.buildingKey,
          level: b.level,
          upgradeEndsAt: b.upgradeEndsAt,
        })),
      fleets: stFleets.map((f) => ({
        spacecraftKey: f.spacecraftKey,
        amount: f.amount,
        lockedAmount: f.lockedAmount,
      })),
      builds: stBuildOrders.map((o) => ({
        spacecraftKey: o.spacecraftKey,
        amount: o.amount,
      })),
      research: stResearch.map((r) => ({
        technologyKey: r.technologyKey,
        status: r.status,
        completesAt: r.completesAt,
      })),
      miningAssignments: stAssignments.map((assignment) => ({
        id: assignment.id,
        asteroidId: assignment.asteroidId,
        spacecraftKey: assignment.spacecraftKey,
        assignedAmount: assignment.assignedAmount,
        status: assignment.status,
      })),
      trips: stTrips.map((trip) => ({
        id: trip.id,
        purpose: trip.purpose,
        status: trip.status,
        arrivesAt: trip.arrivesAt,
        toId: trip.toId,
      })),
      missions: stMissions.map((m) => ({
        missionType: m.missionType,
        status: m.status,
        arrivesAt: m.arrivesAt,
        targetSectorX: m.targetSectorX,
        targetSectorY: m.targetSectorY,
      })),
      combatMissions: stCombatMissions.map((mission) => ({
        id: mission.id,
        defenderStationId: mission.defenderStationId,
        status: mission.status,
        createdAt: mission.createdAt,
      })),
      salvageMissions: stSalvageMissions.map((mission) => ({
        id: mission.id,
        debrisFieldId: mission.debrisFieldId,
        status: mission.status,
        createdAt: mission.createdAt,
      })),
    };
  });

  // Visible world objects from union of all scanner coverages
  const coverages = await getUserScannerCoverages(userId);
  const coverageBounds = scannerChunkBounds(coverages, WORLD_CONFIG.CHUNK_SIZE);
  const allBounds = coverageBounds.reduce(
    (acc, bound) => ({
      minChunkX: Math.min(acc.minChunkX, bound.minChunkX),
      maxChunkX: Math.max(acc.maxChunkX, bound.maxChunkX),
      minChunkY: Math.min(acc.minChunkY, bound.minChunkY),
      maxChunkY: Math.max(acc.maxChunkY, bound.maxChunkY),
    }),
    { minChunkX: Infinity, maxChunkX: -Infinity, minChunkY: Infinity, maxChunkY: -Infinity }
  );
  const conflictDiagnostics = { now, protectedOwnerIds: new Set<string>() };
  const [asteroidRows, debrisRows, visibleStations, combatReports] = await Promise.all([
    coverageBounds.length > 0
      ? db
          .select({
            id: asteroids.id,
            x: asteroids.x,
            y: asteroids.y,
            resourceKey: asteroidVeins.resourceKey,
            remainingAmount: asteroidVeins.remainingAmount,
          })
          .from(asteroids)
          .innerJoin(asteroidVeins, eq(asteroidVeins.asteroidId, asteroids.id))
          .where(
            or(
              ...coverageBounds.map((bound) =>
                and(
                  between(asteroids.chunkX, bound.minChunkX, bound.maxChunkX),
                  between(asteroids.chunkY, bound.minChunkY, bound.maxChunkY)
                )
              )
            )
          )
      : Promise.resolve([]),
    coverageBounds.length > 0
      ? db
          .select()
          .from(debrisFields)
          .where(
            or(
              ...coverageBounds.map((bound) =>
                and(
                  between(debrisFields.chunkX, bound.minChunkX, bound.maxChunkX),
                  between(debrisFields.chunkY, bound.minChunkY, bound.maxChunkY)
                )
              )
            )
          )
      : Promise.resolve([]),
    coverageBounds.length > 0
      ? getVisibleChunkStations(allBounds, userId, coverages, undefined, false, conflictDiagnostics)
      : Promise.resolve([]),
    getUserCombatReports(userId, {
      since: new Date(now.getTime() - 30 * 24 * 3_600_000),
    }),
  ]);

  const visibleAsteroidsMap = new Map<
    string,
    { id: string; x: number; y: number; remainingByResource: ResourceMap; remainingAmount: number }
  >();
  for (const row of asteroidRows) {
    if (!isPointVisible(coverages, row)) continue;
    const candidate = visibleAsteroidsMap.get(row.id) ?? {
      id: row.id,
      x: row.x,
      y: row.y,
      remainingByResource: {} as ResourceMap,
      remainingAmount: 0,
    };
    const resourceKey = row.resourceKey as ResourceKey;
    candidate.remainingByResource[resourceKey] =
      (candidate.remainingByResource[resourceKey] ?? 0) + row.remainingAmount;
    candidate.remainingAmount += row.remainingAmount;
    visibleAsteroidsMap.set(row.id, candidate);
  }

  const visibleDebris = debrisRows
    .filter((row) => isPointVisible(coverages, row))
    .map((row) => ({
      id: row.id,
      x: row.x,
      y: row.y,
      resources: row.resources as ResourceMap,
    }));

  return {
    userId,
    now,
    ownStations,
    visibleAsteroids: [...visibleAsteroidsMap.values()],
    visibleStations,
    visibleDebris,
    combatReports,
    conflictDiagnostics: {
      protectedOwnerIds: [...conflictDiagnostics.protectedOwnerIds].sort(),
    },
  };
}
