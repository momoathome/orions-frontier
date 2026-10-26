import { and, eq, sql } from 'drizzle-orm';
import {
  calculateDefenseUpgradeBuildTime,
  calculateDefenseUpgradeCost,
  calculateDefenseUpgradeEffect,
  defenseUpgrades,
  getDefenseUpgrade,
} from '@orions-frontier/game-config';
import {
  required,
  isOneOf,
  AppError,
  defenseUpgradeKeys,
  ErrorCode,
  type DefenseUpgradeKey,
  type StationDefenseUpgradeWithDefinition,
} from '@orions-frontier/shared';
import { getDb } from '../lib/db/index.js';
import { publishUserEvent } from '../lib/realtime.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stations } from '../lib/db/schema/stations.js';
import { applyGridOptimization } from './research-effects.js';
import { hasCompletedResearch } from './research.service.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../lib/game-execution-context.js';

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export const seedStationDefenseUpgrades = async (
  stationId: string,
  db: SeedDb = getDb(),
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  await db
    .insert(stationBuildings)
    .values(
      defenseUpgrades.map((upgrade) => ({
        id: context.nextId('station-defense'),
        stationId,
        buildingKey: upgrade.key,
        level: upgrade.startingLevel,
        createdAt: context.now,
        updatedAt: context.now,
      }))
    )
    .onConflictDoNothing();
};

export const defenseUpgradeMaxLevel = (key: string): number | null =>
  isOneOf(defenseUpgradeKeys, key) ? getDefenseUpgrade(key).maxLevel : null;

export function calculateStationDefenseScore(
  levels: Partial<Record<DefenseUpgradeKey, number>>
): number {
  return defenseUpgradeKeys.reduce(
    (sum, key) =>
      sum +
      calculateDefenseUpgradeEffect(key, levels[key] ?? 0).reduce(
        (effectSum, effect) => effectSum + effect.value,
        0
      ),
    0
  );
}

export const getStationDefenseUpgrades = async (
  stationId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<StationDefenseUpgradeWithDefinition[]> => {
  const rows = await getDb()
    .select()
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId));
  const byKey = new Map(rows.map((row) => [row.buildingKey, row]));
  const now = context.now;

  return defenseUpgrades.map((definition) => {
    const row = byKey.get(definition.key);
    const level = row?.level ?? definition.startingLevel;
    const upgradeEndsAt = row?.upgradeEndsAt ?? null;
    const isUpgrading = upgradeEndsAt !== null && upgradeEndsAt > now;
    const isAtMax = level >= definition.maxLevel;

    return {
      definition,
      level,
      upgradeEndsAt: upgradeEndsAt ? upgradeEndsAt.toISOString() : null,
      isUpgrading,
      effects: calculateDefenseUpgradeEffect(definition.key, level),
      nextLevelEffects: isAtMax ? null : calculateDefenseUpgradeEffect(definition.key, level + 1),
      upgradeCosts: isAtMax ? [] : calculateDefenseUpgradeCost(definition.key, level + 1),
      upgradeDurationSeconds: isAtMax
        ? null
        : calculateDefenseUpgradeBuildTime(definition.key, level + 1),
    };
  });
};

export async function getStationDefenseScore(stationId: string): Promise<number> {
  const rows = await getDb()
    .select({ buildingKey: stationBuildings.buildingKey, level: stationBuildings.level })
    .from(stationBuildings)
    .where(eq(stationBuildings.stationId, stationId));
  const levels: Partial<Record<DefenseUpgradeKey, number>> = {};
  for (const row of rows) {
    if (isOneOf(defenseUpgradeKeys, row.buildingKey)) {
      levels[row.buildingKey] = row.level;
    }
  }
  return calculateStationDefenseScore(levels);
}

export const startDefenseUpgrade = async (
  stationId: string,
  upgradeKey: DefenseUpgradeKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<StationDefenseUpgradeWithDefinition> => {
  const db = getDb();
  const def = getDefenseUpgrade(upgradeKey);

  const resourceMap = await db.transaction(async (tx) => {
    const [station] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [upgrade] = await tx
      .insert(stationBuildings)
      .values({
        id: context.nextId('station-defense'),
        stationId,
        buildingKey: upgradeKey,
        level: def.startingLevel,
        createdAt: context.now,
        updatedAt: context.now,
      })
      .onConflictDoNothing()
      .returning();

    const [stationUpgrade] =
      upgrade === undefined
        ? await tx
            .select()
            .from(stationBuildings)
            .where(
              and(
                eq(stationBuildings.stationId, stationId),
                eq(stationBuildings.buildingKey, upgradeKey)
              )
            )
            .limit(1)
            .for('update')
        : [upgrade];

    if (!stationUpgrade) throw new AppError(ErrorCode.NOT_FOUND, 'Defense upgrade not found');
    if (stationUpgrade.upgradeEndsAt) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Defense upgrade is already upgrading');
    }
    if (stationUpgrade.level >= def.maxLevel) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Defense upgrade is already at max level');
    }

    const targetLevel = stationUpgrade.level + 1;
    const costs = calculateDefenseUpgradeCost(upgradeKey, targetLevel);
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

    const baseUpgradeEndsAt = new Date(
      context.now.getTime() + calculateDefenseUpgradeBuildTime(upgradeKey, targetLevel) * 1000
    );
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
      .where(eq(stationBuildings.id, stationUpgrade.id));

    return currentResources;
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resourceMap),
  });

  return required(
    (await getStationDefenseUpgrades(stationId, context)).find(
      (upgrade) => upgrade.definition.key === upgradeKey
    ),
    `defense upgrade ${upgradeKey}`
  );
};
