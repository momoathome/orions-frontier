import { publishUserEvent } from '../../lib/realtime.js';
import { getDb } from '../../lib/db/index.js';
import {
  findStationBuildingByKeyForUpdate,
  insertStationBuildingsIfMissing,
  listBuildingLevels,
  listStationBuildings,
  updateStationBuilding,
} from '../../repositories/station-buildings.js';
import {
  deductStationResource,
  listStationResources,
} from '../../repositories/station-resources.js';
import { findOwnedStationForUpdate } from '../../repositories/stations.js';
import {
  calculateBuildingUpgradeCost,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  buildings,
  getBuilding,
  applyBuildingCostDiscount,
  unlocksByBuildingLevel,
} from '@orions-frontier/game-config';
import type { StationBuildingWithDefinition, BuildingKey } from '@orions-frontier/shared';
import { isOneOf, AppError, ErrorCode, buildingKeys } from '@orions-frontier/shared';
import { applyConstructionSpeed, getStationResearchModifiers } from '../research/index.js';
import { assertFreeBuildSlot, cancelStationUpgrade } from './construction.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

/** Upgrade cost after the Nanite Assembly discount. */
const upgradeCost = (key: BuildingKey, targetLevel: number, factor: number) =>
  applyBuildingCostDiscount(calculateBuildingUpgradeCost(key, targetLevel), factor);

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

  const [rows, modifiers] = await Promise.all([
    listStationBuildings(db, stationId),
    getStationResearchModifiers(db, stationId),
  ]);

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

      return {
        definition,
        level,
        upgradeEndsAt: upgradeEndsAt ? upgradeEndsAt.toISOString() : null,
        isUpgrading,
        effects: calculateBuildingEffect(key, level),
        nextLevelEffects: isAtMax ? null : calculateBuildingEffect(key, level + 1),
        upgradeCosts: isAtMax ? [] : upgradeCost(key, level + 1, modifiers.buildingCost),
        unlockMilestones: unlocksByBuildingLevel(key),
      };
    })
    .sort((a, b) => a.definition.key.localeCompare(b.definition.key));
};

// Start building upgrade

export const startBuildingUpgrade = async (
  stationId: string,
  buildingKey: BuildingKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<StationBuildingWithDefinition> => {
  const db = getDb();

  const def = getBuilding(buildingKey);

  const resourceMap = await db.transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const stationBuilding = await findStationBuildingByKeyForUpdate(tx, stationId, buildingKey);

    if (!stationBuilding) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Station building not found');
    }
    if (stationBuilding.upgradeEndsAt) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already upgrading');
    }
    if (stationBuilding.level >= def.maxLevel) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already at max level');
    }

    const modifiers = await getStationResearchModifiers(tx, stationId);
    await assertFreeBuildSlot(tx, stationId, modifiers, context.now);

    const targetLevel = stationBuilding.level + 1;
    const costs = upgradeCost(buildingKey, targetLevel, modifiers.buildingCost);
    const resourceRows = await listStationResources(tx, stationId);
    const currentResources = new Map(resourceRows.map((row) => [row.resourceKey, row.amount]));

    for (const cost of costs) {
      const current = currentResources.get(cost.resourceKey) ?? 0;
      if (current < cost.amount) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Insufficient ${cost.resourceKey}: need ${cost.amount}, have ${current}`
        );
      }
    }

    const buildTimeSeconds = calculateBuildingBuildTime(buildingKey, targetLevel);
    const baseUpgradeEndsAt = new Date(context.now.getTime() + buildTimeSeconds * 1000);
    const coreLevel =
      (await listBuildingLevels(tx, stationId)).find((row) => row.buildingKey === 'core')?.level ??
      1;
    const upgradeEndsAt = applyConstructionSpeed(
      modifiers.constructionBonus,
      coreLevel,
      baseUpgradeEndsAt,
      context.now
    );
    for (const cost of costs) {
      await deductStationResource(tx, stationId, cost.resourceKey, cost.amount);
      currentResources.set(
        cost.resourceKey,
        (currentResources.get(cost.resourceKey) ?? 0) - cost.amount
      );
    }

    await updateStationBuilding(tx, stationBuilding.id, { upgradeEndsAt, updatedAt: context.now });

    return currentResources;
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resourceMap),
  });

  const allBuildings = await getStationBuildings(stationId, context);
  const result = allBuildings.find((b) => b.definition.key === buildingKey);

  if (!result) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Failed to retrieve updated building');
  }

  return result;
};

/** Cancels a running building upgrade and refunds its cost. */
export const cancelBuildingUpgrade = async (
  stationId: string,
  buildingKey: BuildingKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  // ponytail: refunds at today's Nanite discount, which can only be lower than what was paid.
  const factor = (await getStationResearchModifiers(getDb(), stationId)).buildingCost;
  await cancelStationUpgrade(
    stationId,
    userId,
    buildingKey,
    (row) => upgradeCost(buildingKey, row.level + 1, factor),
    context
  );
};
