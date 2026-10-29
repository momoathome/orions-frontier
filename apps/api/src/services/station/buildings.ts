import { and, eq, isNull, sql } from 'drizzle-orm';
import { publishUserEvent } from '../../lib/realtime.js';
import { getDb } from '../../lib/db/index.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stations } from '../../lib/db/schema/stations.js';
import {
  calculateBuildingUpgradeCost,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  buildings,
  getBuilding,
  SHIPYARD_UNLOCKS,
} from '@orions-frontier/game-config';
import type { StationBuildingWithDefinition, BuildingKey } from '@orions-frontier/shared';
import { isOneOf, AppError, ErrorCode, buildingKeys } from '@orions-frontier/shared';
import { applyGridOptimization, hasCompletedResearch } from '../research/index.js';
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
  await db
    .insert(stationBuildings)
    .values(
      buildings.map((building) => ({
        id: context.nextId('station-building'),
        stationId,
        buildingKey: building.key,
        level: 1,
        createdAt: context.now,
        updatedAt: context.now,
      }))
    )
    .onConflictDoNothing();
};

// Get all buildings for a station (with computed effects / costs)

export const getStationBuildings = async (
  stationId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<StationBuildingWithDefinition[]> => {
  const db = getDb();

  const rows = await db
    .select()
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId));

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
        upgradeCosts: isAtMax ? [] : calculateBuildingUpgradeCost(key, level + 1),
        unlockMilestones: key === 'shipyard' ? SHIPYARD_UNLOCKS : {},
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
    const [station] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(
        and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
      )
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [stationBuilding] = await tx
      .select()
      .from(stationBuildings)
      .where(
        and(
          eq(stationBuildings.stationId, stationId),
          eq(stationBuildings.buildingKey, buildingKey)
        )
      )
      .limit(1)
      .for('update');

    if (!stationBuilding) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Station building not found');
    }
    if (stationBuilding.upgradeEndsAt) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already upgrading');
    }
    if (stationBuilding.level >= def.maxLevel) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Building is already at max level');
    }

    const targetLevel = stationBuilding.level + 1;
    const costs = calculateBuildingUpgradeCost(buildingKey, targetLevel);
    const resourceRows = await tx
      .select()
      .from(stationResources)
      .where(eq(stationResources.stationId, stationId));
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
    const hasGridOpt = await hasCompletedResearch(tx, stationId, 'station_grid_optimization');
    const upgradeEndsAt = applyGridOptimization(hasGridOpt, baseUpgradeEndsAt, context.now);
    for (const cost of costs) {
      await tx
        .update(stationResources)
        .set({ amount: sql`${stationResources.amount} - ${cost.amount}` })
        .where(
          and(
            eq(stationResources.stationId, stationId),
            eq(stationResources.resourceKey, cost.resourceKey)
          )
        );
      currentResources.set(
        cost.resourceKey,
        (currentResources.get(cost.resourceKey) ?? 0) - cost.amount
      );
    }

    await tx
      .update(stationBuildings)
      .set({ upgradeEndsAt, updatedAt: context.now })
      .where(eq(stationBuildings.id, stationBuilding.id));

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
