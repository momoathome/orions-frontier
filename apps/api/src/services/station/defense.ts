import {
  calculateDefenseUpgradeBuildTime,
  calculateDefenseUpgradeCost,
  calculateDefenseUpgradeEffect,
  defenseUpgrades,
  getDefenseUpgrade,
  requirementBlockers,
  researchModifiers,
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
import { getDb } from '../../lib/db/index.js';
import { publishUserEvent } from '../../lib/realtime.js';
import {
  findStationBuildingByKeyForUpdate,
  insertStationBuildingIfMissing,
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
  applyConstructionSpeed,
  constructionFactor,
  describeBlockers,
  getResearchLevels,
  getStationResearchModifiers,
} from '../research/index.js';
import { assertFreeBuildSlot, cancelStationUpgrade, toBuildingLevels } from './construction.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export const seedStationDefenseUpgrades = async (
  stationId: string,
  db: SeedDb = getDb(),
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  await insertStationBuildingsIfMissing(
    db,
    defenseUpgrades.map((upgrade) => ({
      id: context.nextId('station-defense'),
      stationId,
      buildingKey: upgrade.key,
      level: upgrade.startingLevel,
      createdAt: context.now,
      updatedAt: context.now,
    }))
  );
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
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<StationDefenseUpgradeWithDefinition[]> => {
  const db = getDb();
  const [rows, research] = await Promise.all([
    listStationBuildings(db, stationId),
    getResearchLevels(db, userId),
  ]);
  const buildingLevels = toBuildingLevels(rows);
  const byKey = new Map(rows.map((row) => [row.buildingKey, row]));
  const now = context.now;
  // The same speed-up as starting an upgrade, so the shown time matches the real one.
  const speed = constructionFactor(
    researchModifiers(research).constructionBonus,
    buildingLevels.core ?? 1
  );

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
        : Math.round(calculateDefenseUpgradeBuildTime(definition.key, level + 1) * speed),
      blockers:
        level > definition.startingLevel
          ? []
          : requirementBlockers(definition.requirements, research, buildingLevels),
    };
  });
};

export async function getStationDefenseScore(stationId: string): Promise<number> {
  const rows = await listBuildingLevels(getDb(), stationId);
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
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const upgrade = await insertStationBuildingIfMissing(tx, {
      id: context.nextId('station-defense'),
      stationId,
      buildingKey: upgradeKey,
      level: def.startingLevel,
      createdAt: context.now,
      updatedAt: context.now,
    });

    const stationUpgrade =
      upgrade ?? (await findStationBuildingByKeyForUpdate(tx, stationId, upgradeKey));

    if (!stationUpgrade) throw new AppError(ErrorCode.NOT_FOUND, 'Defense upgrade not found');
    if (stationUpgrade.upgradeEndsAt) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Defense upgrade is already upgrading');
    }
    if (stationUpgrade.level >= def.maxLevel) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Defense upgrade is already at max level');
    }
    if (stationUpgrade.level === def.startingLevel) {
      const blockers = requirementBlockers(
        def.requirements,
        await getResearchLevels(tx, userId),
        toBuildingLevels(await listBuildingLevels(tx, stationId))
      );
      if (blockers.length > 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, describeBlockers(blockers));
      }
    }
    const modifiers = await getStationResearchModifiers(tx, stationId);
    await assertFreeBuildSlot(tx, stationId, modifiers, context.now);

    const targetLevel = stationUpgrade.level + 1;
    const costs = calculateDefenseUpgradeCost(upgradeKey, targetLevel);
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

    const baseUpgradeEndsAt = new Date(
      context.now.getTime() + calculateDefenseUpgradeBuildTime(upgradeKey, targetLevel) * 1000
    );
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

    await updateStationBuilding(tx, stationUpgrade.id, { upgradeEndsAt, updatedAt: context.now });

    return currentResources;
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resourceMap),
  });

  return required(
    (await getStationDefenseUpgrades(stationId, userId, context)).find(
      (upgrade) => upgrade.definition.key === upgradeKey
    ),
    `defense upgrade ${upgradeKey}`
  );
};

/** Cancels a running defense upgrade and refunds its cost. */
export const cancelDefenseUpgrade = (
  stationId: string,
  upgradeKey: DefenseUpgradeKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> =>
  cancelStationUpgrade(
    stationId,
    userId,
    upgradeKey,
    (row) => calculateDefenseUpgradeCost(upgradeKey, row.level + 1),
    context
  );
