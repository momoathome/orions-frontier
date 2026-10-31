import { getDb, type QueryDb } from '../../lib/db/index.js';
import {
  listBuildOrdersByStations,
  listStationBuildingsByStations,
  listStationResourcesByStations,
  listStationSpacecraftsByStations,
  listActiveStationsWithSectorByUser,
  getUserScannerCoverages,
} from '../station/index.js';
import { listTravelingTripsByStations } from '../fleet/index.js';
import { listUserResearch } from '../research/index.js';
import {
  countArrivedExpeditionsByUser,
  listMovingWorldMissionsByStations,
} from '../missions/index.js';
import { buildingKeys, defenseUpgradeKeys, isOneOf } from '@orions-frontier/shared';
import type { ResearchKey, ResearchLevels, ResourceMap } from '@orions-frontier/shared';
import {
  calculateStorageCapacity,
  isResearchKey,
  researchModifiers,
} from '@orions-frontier/game-config';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import {
  isPointVisible,
  scannerChunkBounds,
  listAsteroidAssignmentsByStations,
  listAsteroidVeinsInChunks,
} from '../map/index.js';
import { getVisibleChunkStations } from '../world/index.js';
import {
  getUserCombatReports,
  listUnresolvedCombatMissionsByUser,
  listDebrisFieldsInChunks,
  listUnresolvedSalvageMissionsByUser,
} from '../combat/index.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';

type Rows<T extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<T>>;
type StationRow = Rows<typeof listActiveStationsWithSectorByUser>[number];

/** One station's rows from each per-station query. */
interface StationRows {
  resources: Rows<typeof listStationResourcesByStations>;
  buildings: Rows<typeof listStationBuildingsByStations>;
  fleets: Rows<typeof listStationSpacecraftsByStations>;
  builds: Rows<typeof listBuildOrdersByStations>;
  assignments: Rows<typeof listAsteroidAssignmentsByStations>;
  trips: Rows<typeof listTravelingTripsByStations>;
  missions: Rows<typeof listMovingWorldMissionsByStations>;
  combatMissions: Rows<typeof listUnresolvedCombatMissionsByUser>;
  salvageMissions: Rows<typeof listUnresolvedSalvageMissionsByUser>;
}

export async function loadGoalBotState(
  userId: string,
  now = new Date()
): Promise<GoalBotState | null> {
  const db = getDb();
  const ownStationRows = await listActiveStationsWithSectorByUser(db, userId);
  if (ownStationRows.length === 0) return null;

  const [own, coverages, completedExpeditions] = await Promise.all([
    loadOwnStations(db, userId, ownStationRows),
    getUserScannerCoverages(userId),
    countArrivedExpeditionsByUser(db, userId),
  ]);
  const world = await loadVisibleWorld(db, userId, coverages, own.research.levels, now);

  return {
    userId,
    now,
    completedExpeditions,
    research: {
      ...own.research,
      slots: researchModifiers(own.research.levels).researchSlots,
    },
    ownStations: own.stations,
    ...world,
  };
}

/** Snapshots of the bot's stations and its research. */
async function loadOwnStations(db: QueryDb, userId: string, rows: readonly StationRow[]) {
  const stationIds = rows.map((s) => s.id);
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
    listStationResourcesByStations(db, stationIds),
    listStationBuildingsByStations(db, stationIds),
    listStationSpacecraftsByStations(db, stationIds),
    listBuildOrdersByStations(db, stationIds),
    listUserResearch(db, userId),
    listAsteroidAssignmentsByStations(db, stationIds),
    listTravelingTripsByStations(db, stationIds),
    listMovingWorldMissionsByStations(db, stationIds),
    listUnresolvedCombatMissionsByUser(db, userId),
    listUnresolvedSalvageMissionsByUser(db, userId),
  ]);

  const groupBy = <T>(items: readonly T[], stationIdOf: (item: T) => string) => {
    const grouped = new Map<string, T[]>();
    for (const item of items) {
      const stationId = stationIdOf(item);
      const existing = grouped.get(stationId);
      if (existing) existing.push(item);
      else grouped.set(stationId, [item]);
    }
    return (stationId: string) => grouped.get(stationId) ?? [];
  };
  const resourcesOf = groupBy(allResources, (row) => row.stationId);
  const buildingsOf = groupBy(allBuildings, (row) => row.stationId);
  const fleetsOf = groupBy(allFleets, (row) => row.stationId);
  const buildsOf = groupBy(allBuildOrders, (row) => row.stationId);
  const assignmentsOf = groupBy(allAssignments, (row) => row.stationId);
  const tripsOf = groupBy(allTrips, (row) => row.stationId);
  const missionsOf = groupBy(allMissions, (mission) => mission.originStationId);
  const combatMissionsOf = groupBy(allCombatMissions, (mission) => mission.attackerStationId);
  const salvageMissionsOf = groupBy(allSalvageMissions, (mission) => mission.stationId);

  const levels: ResearchLevels = {};
  const active: ResearchKey[] = [];
  for (const row of allResearch) {
    if (!isResearchKey(row.technologyKey)) continue;
    if (row.level > 0) levels[row.technologyKey] = row.level;
    if (row.completesAt) active.push(row.technologyKey);
  }

  const stations = rows.map((station) =>
    toStationSnapshot(
      station,
      {
        resources: resourcesOf(station.id),
        buildings: buildingsOf(station.id),
        fleets: fleetsOf(station.id),
        builds: buildsOf(station.id),
        assignments: assignmentsOf(station.id),
        trips: tripsOf(station.id),
        missions: missionsOf(station.id),
        combatMissions: combatMissionsOf(station.id),
        salvageMissions: salvageMissionsOf(station.id),
      },
      levels
    )
  );
  return { stations, research: { levels, active } };
}

function toStationSnapshot(
  station: StationRow,
  rows: StationRows,
  research: ResearchLevels
): StationSnapshot {
  return {
    id: station.id,
    name: station.name,
    x: station.x,
    y: station.y,
    sectorId: station.sectorId,
    sectorX: station.sectorX,
    sectorY: station.sectorY,
    createdAt: station.createdAt,
    storageCapacity: calculateStorageCapacity(
      rows.buildings.find((building) => building.buildingKey === 'warehouse')?.level ?? 0
    ),
    resources: Object.fromEntries(rows.resources.map((r) => [r.resourceKey, r.amount])),
    buildings: rows.buildings.flatMap((building) =>
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
    defense: rows.buildings.flatMap((b) =>
      isOneOf(defenseUpgradeKeys, b.buildingKey)
        ? [{ upgradeKey: b.buildingKey, level: b.level, upgradeEndsAt: b.upgradeEndsAt }]
        : []
    ),
    fleets: rows.fleets.map((f) => ({
      spacecraftKey: f.spacecraftKey,
      amount: f.amount,
      lockedAmount: f.lockedAmount,
    })),
    builds: rows.builds.map((o) => ({
      spacecraftKey: o.spacecraftKey,
      amount: o.amount,
    })),
    research,
    miningAssignments: rows.assignments.map((assignment) => ({
      id: assignment.id,
      asteroidId: assignment.asteroidId,
      spacecraftKey: assignment.spacecraftKey,
      assignedAmount: assignment.assignedAmount,
      status: assignment.status,
    })),
    trips: rows.trips.map((trip) => ({
      id: trip.id,
      purpose: trip.purpose,
      status: trip.status,
      arrivesAt: trip.arrivesAt,
      toId: trip.toId,
    })),
    missions: rows.missions.map((m) => ({
      missionType: m.missionType,
      status: m.status,
      arrivesAt: m.arrivesAt,
      targetSectorX: m.targetSectorX,
      targetSectorY: m.targetSectorY,
    })),
    combatMissions: rows.combatMissions.map((mission) => ({
      id: mission.id,
      defenderStationId: mission.defenderStationId,
      status: mission.status,
      createdAt: mission.createdAt,
    })),
    salvageMissions: rows.salvageMissions.map((mission) => ({
      id: mission.id,
      debrisFieldId: mission.debrisFieldId,
      status: mission.status,
      createdAt: mission.createdAt,
    })),
  };
}

/** Asteroids, debris and scanned stations in the union of the bot's scanner coverages. */
async function loadVisibleWorld(
  db: QueryDb,
  userId: string,
  coverages: Rows<typeof getUserScannerCoverages>,
  researchLevels: ResearchLevels,
  now: Date
) {
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
    coverageBounds.length > 0
      ? listAsteroidVeinsInChunks(
          db,
          coverageBounds,
          researchModifiers(researchLevels).visibleResources
        )
      : Promise.resolve([]),
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
    visibleAsteroids: [...visibleAsteroidsMap.values()],
    visibleStations,
    visibleDebris,
    combatReports,
    conflictDiagnostics: {
      protectedOwnerIds: [...conflictDiagnostics.protectedOwnerIds].sort(),
    },
  };
}
