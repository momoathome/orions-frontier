import { getDb } from '../../lib/db/index.js';
import {
  listAsteroidAssignmentsByStations,
  listAsteroidVeinsInChunks,
} from '../../repositories/asteroids.js';
import { listUnresolvedCombatMissionsByUser } from '../../repositories/combat-missions.js';
import {
  listDebrisFieldsInChunks,
  listUnresolvedSalvageMissionsByUser,
} from '../../repositories/debris-fields.js';
import { listBuildOrdersByStations } from '../../repositories/spacecraft-build-orders.js';
import { listTravelingTripsByStations } from '../../repositories/spacecraft-trips.js';
import { listStationBuildingsByStations } from '../../repositories/station-buildings.js';
import { listStationResearchByStations } from '../../repositories/station-research.js';
import { listStationResourcesByStations } from '../../repositories/station-resources.js';
import { listStationSpacecraftsByStations } from '../../repositories/station-spacecrafts.js';
import { listActiveStationsWithSectorByUser } from '../../repositories/stations.js';
import {
  countArrivedExpeditionsByUser,
  listMovingWorldMissionsByStations,
} from '../../repositories/world-missions.js';
import { buildingKeys, defenseUpgradeKeys, isOneOf } from '@orions-frontier/shared';
import type { ResourceMap } from '@orions-frontier/shared';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { getUserScannerCoverages, isPointVisible, scannerChunkBounds } from '../map/index.js';
import { getVisibleChunkStations } from '../world/index.js';
import { getUserCombatReports } from '../combat/index.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';

export async function loadGoalBotState(
  userId: string,
  now = new Date()
): Promise<GoalBotState | null> {
  const db = getDb();
  const ownStationRows = await listActiveStationsWithSectorByUser(db, userId);
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
    completedExpeditions,
  ] = await Promise.all([
    listStationResourcesByStations(db, stationIds),
    listStationBuildingsByStations(db, stationIds),
    listStationSpacecraftsByStations(db, stationIds),
    listBuildOrdersByStations(db, stationIds),
    listStationResearchByStations(db, stationIds),
    listAsteroidAssignmentsByStations(db, stationIds),
    listTravelingTripsByStations(db, stationIds),
    listMovingWorldMissionsByStations(db, stationIds),
    listUnresolvedCombatMissionsByUser(db, userId),
    listUnresolvedSalvageMissionsByUser(db, userId),
    countArrivedExpeditionsByUser(db, userId),
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
      resources: Object.fromEntries(stResources.map((r) => [r.resourceKey, r.amount])),
      buildings: stBuildings.flatMap((building) =>
        isOneOf(buildingKeys, building.buildingKey)
          ? [
              {
                buildingKey: building.buildingKey,
                level: building.level,
                upgradeEndsAt: building.upgradeEndsAt,
              },
            ]
          : []
      ),
      defense: stBuildings.flatMap((b) =>
        isOneOf(defenseUpgradeKeys, b.buildingKey)
          ? [{ upgradeKey: b.buildingKey, level: b.level, upgradeEndsAt: b.upgradeEndsAt }]
          : []
      ),
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
  const [asteroidRows, debrisRows, viewStations, combatReports] = await Promise.all([
    coverageBounds.length > 0 ? listAsteroidVeinsInChunks(db, coverageBounds) : Promise.resolve([]),
    coverageBounds.length > 0 ? listDebrisFieldsInChunks(db, coverageBounds) : Promise.resolve([]),
    coverageBounds.length > 0
      ? getVisibleChunkStations(allBounds, userId, coverages, undefined, false, conflictDiagnostics)
      : Promise.resolve([]),
    getUserCombatReports(userId, {
      since: new Date(now.getTime() - 30 * 24 * 3_600_000),
    }),
  ]);

  // Bots act only on scanned stations; the map projection also lists unscanned ones.
  const visibleStations = viewStations.filter((station) => station.scanned);

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
      remainingByResource: {},
      remainingAmount: 0,
    };
    const resourceKey = row.resourceKey;
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
      resources: row.resources,
    }));

  return {
    userId,
    now,
    completedExpeditions,
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
