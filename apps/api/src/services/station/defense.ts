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
  defenseUpgradeKeys,
  type DefenseUpgradeKey,
  type StationDefenseUpgradeWithDefinition,
} from '@orions-frontier/shared';
import { getDb, type QueryDb } from '../../lib/db/index.js';
import {
  insertStationBuildingsIfMissing,
  listBuildingLevels,
  listStationBuildings,
} from './repositories/station-buildings.js';
import { constructionFactor, getResearchLevels } from '../research/index.js';
import {
  asBuildingLevels,
  cancelStationUpgrade,
  plannedLevels,
  queueStationUpgrade,
  toBuildingLevels,
} from './construction.js';
import { listStationQueue } from './repositories/queued-jobs.js';
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

function calculateStationDefenseScore(levels: Partial<Record<DefenseUpgradeKey, number>>): number {
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
  const [rows, research, queue] = await Promise.all([
    listStationBuildings(db, stationId),
    getResearchLevels(db, userId),
    listStationQueue(db, stationId),
  ]);
  const planned = plannedLevels(rows, queue);
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
    const queuedLevel = planned.get(definition.key) ?? level;
    const queuedMax = queuedLevel >= definition.maxLevel;

    return {
      definition,
      level,
      upgradeEndsAt: upgradeEndsAt ? upgradeEndsAt.toISOString() : null,
      isUpgrading,
      effects: calculateDefenseUpgradeEffect(definition.key, level),
      nextLevelEffects: isAtMax ? null : calculateDefenseUpgradeEffect(definition.key, level + 1),
      queuedLevel,
      upgradeCosts: queuedMax ? [] : calculateDefenseUpgradeCost(definition.key, queuedLevel + 1),
      upgradeDurationSeconds: queuedMax
        ? null
        : Math.round(calculateDefenseUpgradeBuildTime(definition.key, queuedLevel + 1) * speed),
      blockers:
        queuedLevel > definition.startingLevel
          ? []
          : requirementBlockers(definition.requirements, research, asBuildingLevels(planned)),
    };
  });
};

/** Defense power of the station's own upgrades, before research applies. */
export async function getStationDefenseScore(db: QueryDb, stationId: string): Promise<number> {
  const rows = await listBuildingLevels(db, stationId);
  const levels: Partial<Record<DefenseUpgradeKey, number>> = {};
  for (const row of rows) {
    if (isOneOf(defenseUpgradeKeys, row.buildingKey)) {
      levels[row.buildingKey] = row.level;
    }
  }
  return calculateStationDefenseScore(levels);
}

/** Starts the next level now, or with `queue` adds it to the station queue. */
export const startDefenseUpgrade = async (
  stationId: string,
  upgradeKey: DefenseUpgradeKey,
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext(),
  queue = false
): Promise<StationDefenseUpgradeWithDefinition> => {
  await queueStationUpgrade(stationId, userId, 'defense', upgradeKey, context, queue);
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
): Promise<void> => cancelStationUpgrade(stationId, userId, upgradeKey, context);
