import { getDb } from '../../lib/db/index.js';
import {
  insertStationBuildingsIfMissing,
  listStationBuildings,
} from '../../repositories/station-buildings.js';
import {
  calculateBuildingEffect,
  buildings,
  getBuilding,
  unlocksByBuildingLevel,
} from '@orions-frontier/game-config';
import type { StationBuildingWithDefinition, BuildingKey } from '@orions-frontier/shared';
import { isOneOf, buildingKeys, required } from '@orions-frontier/shared';
import { getStationResearchModifiers } from '../research/index.js';
import {
  cancelStationUpgrade,
  plannedLevels,
  queueStationUpgrade,
  upgradeCost,
} from './construction.js';
import { listStationQueue } from '../../repositories/queued-jobs.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

// Seed station buildings (initialize all buildings at level 1 for new station)

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export const seedStationBuildings = async (
  stationId: string,
  db: SeedDb = getDb(),
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  await insertStationBuildingsIfMissing(
    db,
    buildings.map((building) => ({
      id: context.nextId('station-building'),
      stationId,
      buildingKey: building.key,
      level: 1,
      createdAt: context.now,
      updatedAt: context.now,
    }))
  );
};

// Get all buildings for a station (with computed effects / costs)

export const getStationBuildings = async (
  stationId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<StationBuildingWithDefinition[]> => {
  const db = getDb();

  const [rows, modifiers, queue] = await Promise.all([
    listStationBuildings(db, stationId),
    getStationResearchModifiers(db, stationId),
    listStationQueue(db, stationId),
  ]);
  const planned = plannedLevels(rows, queue);

  const now = context.now;

  return rows
    .flatMap((building) => {
      const key = building.buildingKey;
      if (!isOneOf(buildingKeys, key)) return [];
      const definition = getBuilding(key);
      const level = building.level;
      const upgradeEndsAt = building.upgradeEndsAt;
      const isUpgrading = upgradeEndsAt !== null && upgradeEndsAt > now;
      const isAtMax = level >= definition.maxLevel;
      const queuedLevel = planned.get(key) ?? level;

      return {
        definition,
        level,
        upgradeEndsAt: upgradeEndsAt ? upgradeEndsAt.toISOString() : null,
        isUpgrading,
        effects: calculateBuildingEffect(key, level),
        nextLevelEffects: isAtMax ? null : calculateBuildingEffect(key, level + 1),
        queuedLevel,
        upgradeCosts:
          queuedLevel >= definition.maxLevel
            ? []
            : upgradeCost(key, queuedLevel + 1, modifiers.buildingCost),
        unlockMilestones: unlocksByBuildingLevel(key),
      };
    })
    .sort((a, b) => a.definition.key.localeCompare(b.definition.key));
};

// Start building upgrade

/** Starts the next level now, or with `queue` adds it to the station queue. */
export const startBuildingUpgrade = async (
  stationId: string,
  buildingKey: BuildingKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext(),
  queue = false
): Promise<StationBuildingWithDefinition> => {
  await queueStationUpgrade(stationId, userId, 'building', buildingKey, context, queue);
  return required(
    (await getStationBuildings(stationId, context)).find((b) => b.definition.key === buildingKey),
    `building ${buildingKey}`
  );
};

/** Cancels a running building upgrade and refunds what it cost. */
export const cancelBuildingUpgrade = async (
  stationId: string,
  buildingKey: BuildingKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  const factor = (await getStationResearchModifiers(getDb(), stationId)).buildingCost;
  await cancelStationUpgrade(
    stationId,
    userId,
    buildingKey,
    (row) => upgradeCost(buildingKey, row.level + 1, factor),
    context
  );
};
