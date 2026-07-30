import { and, eq, inArray, ne } from 'drizzle-orm';
import { defenseUpgradeKeys, type ResourceMap } from '@orions-frontier/shared';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import { getDb } from '../db/index.js';
import { asteroids, asteroidVeins } from '../db/schema/asteroids.js';
import { botControllers, type BotProfile } from '../db/schema/bot-controllers.js';
import { combatMissions } from '../db/schema/combat-missions.js';
import { debrisFields, salvageMissions } from '../db/schema/debris-fields.js';
import { sectors } from '../db/schema/sectors.js';
import { spacecraftBuildOrders } from '../db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../db/schema/spacecraft-trips.js';
import { stationBuildings } from '../db/schema/station-buildings.js';
import { stationResearch } from '../db/schema/station-research.js';
import { stationResources } from '../db/schema/station-resources.js';
import { stationSpacecrafts } from '../db/schema/station-spacecrafts.js';
import { stations } from '../db/schema/stations.js';
import { users } from '../db/schema/users.js';
import { worldMissions } from '../db/schema/world-missions.js';
import { PlaytestAliasRegistry } from './aliases.js';
import type { CollectorSnapshot } from './collector.js';
import type { PopulationKind } from './population.js';
import { progressFingerprint } from './progress-fingerprint.js';

interface StationAccumulator {
  resources: ResourceMap;
  resourceUnits: number;
  storageCapacityPerResource: number;
  buildingLevelTotal: number;
  defenseLevelTotal: number;
  spacecraftByKey: Record<string, number>;
  spacecraftUnits: number;
  lockedSpacecraftUnits: number;
  completedResearch: number;
  activeBuildingUpgrades: number;
  activeBuildOrders: number;
  activeResearch: number;
  activeTrips: number;
  activeWorldMissions: number;
  activeCombatMissions: number;
  activeSalvageMissions: number;
}

export interface PlaytestStationSnapshot extends StationAccumulator {
  stationAlias: string;
  ownerAlias: string;
  progressFingerprint: string;
}

export interface PlaytestBotSnapshot {
  botAlias: string;
  populationKind: PopulationKind;
  profile: BotProfile;
  stationCount: number;
  resourceUnits: number;
  spacecraftUnits: number;
  lockedSpacecraftUnits: number;
  completedResearch: number;
  activeWork: number;
  activeGoal: string | null;
  lastAction: string | null;
  progressFingerprint: string;
}

export interface PlaytestStateSnapshot extends CollectorSnapshot {
  bots: PlaytestBotSnapshot[];
  stations: PlaytestStationSnapshot[];
  world: PlaytestWorldSnapshot;
}

export interface PlaytestWorldSnapshot {
  sectorsByRole: Record<string, number>;
  populationByKind: Record<string, number>;
  populationByProfile: Record<string, number>;
  stations: number;
  asteroids: number;
  asteroidResources: ResourceMap;
  debrisFields: number;
  debrisResources: ResourceMap;
}

function emptyStation(): StationAccumulator {
  return {
    resources: {},
    resourceUnits: 0,
    storageCapacityPerResource: 0,
    buildingLevelTotal: 0,
    defenseLevelTotal: 0,
    spacecraftByKey: {},
    spacecraftUnits: 0,
    lockedSpacecraftUnits: 0,
    completedResearch: 0,
    activeBuildingUpgrades: 0,
    activeBuildOrders: 0,
    activeResearch: 0,
    activeTrips: 0,
    activeWorldMissions: 0,
    activeCombatMissions: 0,
    activeSalvageMissions: 0,
  };
}

const warehouseCapacity = (level: number): number =>
  calculateBuildingEffect('warehouse', level).find((effect) => effect.type === 'storage_capacity')
    ?.value ?? 0;

function emptyWorld(): PlaytestWorldSnapshot {
  return {
    sectorsByRole: {},
    populationByKind: {},
    populationByProfile: {},
    stations: 0,
    asteroids: 0,
    asteroidResources: {},
    debrisFields: 0,
    debrisResources: {},
  };
}

function incrementStation(
  byStation: Map<string, StationAccumulator>,
  stationId: string,
  field: Exclude<keyof StationAccumulator, 'resources' | 'spacecraftByKey'>,
  amount = 1
): void {
  const station = byStation.get(stationId);
  if (station) station[field] += amount;
}

export async function loadPlaytestSnapshot(
  now: Date,
  aliases: PlaytestAliasRegistry
): Promise<PlaytestStateSnapshot> {
  const db = getDb();
  const controlledUserIds = aliases.userIds();
  if (controlledUserIds.length === 0) {
    return { capturedAt: now.toISOString(), bots: [], stations: [], world: emptyWorld() };
  }
  const stationRows = await db
    .select({
      id: stations.id,
      userId: stations.userId,
      createdAt: stations.createdAt,
      profile: botControllers.profile,
      activeGoal: botControllers.activeGoalType,
      lastAction: botControllers.lastAction,
      role: users.role,
    })
    .from(stations)
    .innerJoin(users, eq(users.id, stations.userId))
    .innerJoin(botControllers, eq(botControllers.userId, stations.userId))
    .where(inArray(stations.userId, controlledUserIds));
  const userIds = [...new Set(stationRows.map((station) => station.userId))];
  const stationIds = stationRows.map((station) => station.id);
  if (stationIds.length === 0) {
    return { capturedAt: now.toISOString(), bots: [], stations: [], world: emptyWorld() };
  }

  const orderedStations = [...stationRows].sort(
    (left, right) =>
      aliases.user(left.userId).localeCompare(aliases.user(right.userId)) ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id)
  );
  for (const station of orderedStations) aliases.registerStation(station.userId, station.id);

  const [
    resourceRows,
    buildingRows,
    spacecraftRows,
    researchRows,
    buildOrderRows,
    tripRows,
    worldMissionRows,
    combatRows,
    salvageRows,
    sectorRows,
    asteroidRows,
    debrisRows,
  ] = await Promise.all([
    db
      .select({
        stationId: stationResources.stationId,
        resourceKey: stationResources.resourceKey,
        amount: stationResources.amount,
      })
      .from(stationResources)
      .where(inArray(stationResources.stationId, stationIds)),
    db
      .select({
        stationId: stationBuildings.stationId,
        buildingKey: stationBuildings.buildingKey,
        level: stationBuildings.level,
        upgradeEndsAt: stationBuildings.upgradeEndsAt,
      })
      .from(stationBuildings)
      .where(inArray(stationBuildings.stationId, stationIds)),
    db
      .select({
        id: stationSpacecrafts.id,
        stationId: stationSpacecrafts.stationId,
        spacecraftKey: stationSpacecrafts.spacecraftKey,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
      })
      .from(stationSpacecrafts)
      .where(inArray(stationSpacecrafts.stationId, stationIds)),
    db
      .select({ stationId: stationResearch.stationId, status: stationResearch.status })
      .from(stationResearch)
      .where(inArray(stationResearch.stationId, stationIds)),
    db
      .select({ stationId: spacecraftBuildOrders.stationId })
      .from(spacecraftBuildOrders)
      .where(inArray(spacecraftBuildOrders.stationId, stationIds)),
    db
      .select({ stationId: stationSpacecrafts.stationId })
      .from(spacecraftTrips)
      .innerJoin(stationSpacecrafts, eq(stationSpacecrafts.id, spacecraftTrips.stationSpacecraftId))
      .where(
        and(
          inArray(stationSpacecrafts.stationId, stationIds),
          eq(spacecraftTrips.status, 'traveling')
        )
      ),
    db
      .select({ stationId: worldMissions.originStationId })
      .from(worldMissions)
      .where(and(inArray(worldMissions.userId, userIds), ne(worldMissions.status, 'arrived'))),
    db
      .select({ stationId: combatMissions.attackerStationId })
      .from(combatMissions)
      .where(and(inArray(combatMissions.userId, userIds), ne(combatMissions.status, 'resolved'))),
    db
      .select({ stationId: salvageMissions.stationId })
      .from(salvageMissions)
      .where(and(inArray(salvageMissions.userId, userIds), ne(salvageMissions.status, 'resolved'))),
    db.select({ role: sectors.role }).from(sectors),
    db
      .select({
        asteroidId: asteroids.id,
        resourceKey: asteroidVeins.resourceKey,
        remainingAmount: asteroidVeins.remainingAmount,
      })
      .from(asteroids)
      .leftJoin(asteroidVeins, eq(asteroidVeins.asteroidId, asteroids.id)),
    db.select({ id: debrisFields.id, resources: debrisFields.resources }).from(debrisFields),
  ]);

  const byStation = new Map(stationIds.map((stationId) => [stationId, emptyStation()]));
  for (const resource of resourceRows) {
    const station = byStation.get(resource.stationId)!;
    station.resources[resource.resourceKey as keyof ResourceMap] = resource.amount;
    station.resourceUnits += resource.amount;
  }
  for (const building of buildingRows) {
    if (building.buildingKey === 'warehouse') {
      byStation.get(building.stationId)!.storageCapacityPerResource = warehouseCapacity(
        building.level
      );
    }
    const defense = (defenseUpgradeKeys as readonly string[]).includes(building.buildingKey);
    incrementStation(
      byStation,
      building.stationId,
      defense ? 'defenseLevelTotal' : 'buildingLevelTotal',
      building.level
    );
    if (building.upgradeEndsAt) {
      incrementStation(byStation, building.stationId, 'activeBuildingUpgrades');
    }
  }
  for (const spacecraft of spacecraftRows) {
    const station = byStation.get(spacecraft.stationId)!;
    station.spacecraftByKey[spacecraft.spacecraftKey] =
      (station.spacecraftByKey[spacecraft.spacecraftKey] ?? 0) + spacecraft.amount;
    incrementStation(byStation, spacecraft.stationId, 'spacecraftUnits', spacecraft.amount);
    incrementStation(
      byStation,
      spacecraft.stationId,
      'lockedSpacecraftUnits',
      spacecraft.lockedAmount
    );
  }
  for (const research of researchRows) {
    incrementStation(
      byStation,
      research.stationId,
      research.status === 'completed' ? 'completedResearch' : 'activeResearch'
    );
  }
  for (const order of buildOrderRows) {
    incrementStation(byStation, order.stationId, 'activeBuildOrders');
  }
  for (const trip of tripRows) incrementStation(byStation, trip.stationId, 'activeTrips');
  for (const mission of worldMissionRows) {
    incrementStation(byStation, mission.stationId, 'activeWorldMissions');
  }
  for (const mission of combatRows) {
    incrementStation(byStation, mission.stationId, 'activeCombatMissions');
  }
  for (const mission of salvageRows) {
    incrementStation(byStation, mission.stationId, 'activeSalvageMissions');
  }

  const stationSnapshots = orderedStations.map((station): PlaytestStationSnapshot => {
    const values = byStation.get(station.id)!;
    const normalizedResources = Object.fromEntries(
      Object.entries(values.resources).sort(([left], [right]) => left.localeCompare(right))
    ) as ResourceMap;
    const reportValues = {
      ...values,
      resources: normalizedResources,
      spacecraftByKey: Object.fromEntries(
        Object.entries(values.spacecraftByKey).sort(([left], [right]) => left.localeCompare(right))
      ),
    };
    return {
      stationAlias: aliases.station(station.id),
      ownerAlias: aliases.user(station.userId),
      ...reportValues,
      progressFingerprint: progressFingerprint(reportValues),
    };
  });

  const stationRowsByUser = new Map<string, typeof stationRows>();
  for (const station of stationRows) {
    const rows = stationRowsByUser.get(station.userId) ?? [];
    rows.push(station);
    stationRowsByUser.set(station.userId, rows);
  }
  const bots = [...stationRowsByUser.entries()]
    .map(([userId, ownedStations]): PlaytestBotSnapshot => {
      const owned = stationSnapshots.filter(
        (station) => station.ownerAlias === aliases.user(userId)
      );
      const activeWork = owned.reduce(
        (sum, station) =>
          sum +
          station.activeBuildingUpgrades +
          station.activeBuildOrders +
          station.activeResearch +
          station.activeTrips +
          station.activeWorldMissions +
          station.activeCombatMissions +
          station.activeSalvageMissions,
        0
      );
      const values = {
        stationCount: owned.length,
        resourceUnits: owned.reduce((sum, station) => sum + station.resourceUnits, 0),
        spacecraftUnits: owned.reduce((sum, station) => sum + station.spacecraftUnits, 0),
        lockedSpacecraftUnits: owned.reduce(
          (sum, station) => sum + station.lockedSpacecraftUnits,
          0
        ),
        completedResearch: owned.reduce((sum, station) => sum + station.completedResearch, 0),
        activeWork,
        activeGoal: ownedStations[0]!.activeGoal,
        lastAction: ownedStations[0]!.lastAction,
      };
      return {
        botAlias: aliases.user(userId),
        populationKind: ownedStations[0]!.role === 'bot' ? 'resident_bot' : 'synthetic_player',
        profile: ownedStations[0]!.profile as BotProfile,
        ...values,
        progressFingerprint: progressFingerprint({
          ...values,
          stations: owned.map((station) => station.progressFingerprint),
        }),
      };
    })
    .sort((left, right) => left.botAlias.localeCompare(right.botAlias));

  const sectorsByRole: Record<string, number> = {};
  for (const sector of sectorRows) {
    sectorsByRole[sector.role] = (sectorsByRole[sector.role] ?? 0) + 1;
  }
  const asteroidResources: ResourceMap = {};
  const asteroidIds = new Set<string>();
  for (const asteroid of asteroidRows) {
    asteroidIds.add(asteroid.asteroidId);
    if (asteroid.resourceKey && (asteroid.remainingAmount ?? 0) > 0) {
      const key = asteroid.resourceKey as keyof ResourceMap;
      asteroidResources[key] = (asteroidResources[key] ?? 0) + (asteroid.remainingAmount ?? 0);
    }
  }
  const debrisResources: ResourceMap = {};
  for (const debris of debrisRows) {
    for (const [resourceKey, amount] of Object.entries(debris.resources)) {
      const key = resourceKey as keyof ResourceMap;
      debrisResources[key] = (debrisResources[key] ?? 0) + amount;
    }
  }
  const populationByKind: Record<string, number> = {};
  const populationByProfile: Record<string, number> = {};
  for (const bot of bots) {
    populationByKind[bot.populationKind] = (populationByKind[bot.populationKind] ?? 0) + 1;
    populationByProfile[bot.profile] = (populationByProfile[bot.profile] ?? 0) + 1;
  }

  return {
    capturedAt: now.toISOString(),
    bots,
    stations: stationSnapshots,
    world: {
      sectorsByRole: Object.fromEntries(
        Object.entries(sectorsByRole).sort(([left], [right]) => left.localeCompare(right))
      ),
      populationByKind: Object.fromEntries(
        Object.entries(populationByKind).sort(([left], [right]) => left.localeCompare(right))
      ),
      populationByProfile: Object.fromEntries(
        Object.entries(populationByProfile).sort(([left], [right]) => left.localeCompare(right))
      ),
      stations: stationRows.length,
      asteroids: asteroidIds.size,
      asteroidResources,
      debrisFields: debrisRows.length,
      debrisResources,
    },
  };
}
