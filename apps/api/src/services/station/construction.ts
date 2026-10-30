import {
  AppError,
  ErrorCode,
  QUEUE_LIMIT,
  buildingKeys,
  defenseUpgradeKeys,
  isOneOf,
  type BuildingLevels,
  type BuildingUpgradeCost,
  type BuildSlots,
  type QueuedJob,
  type RequirementBlocker,
  type ResearchLevels,
  type ResourceMap,
} from '@orions-frontier/shared';
import {
  applyBuildingCostDiscount,
  calculateBuildingBuildTime,
  calculateBuildingUpgradeCost,
  calculateDefenseUpgradeBuildTime,
  calculateDefenseUpgradeCost,
  getBuilding,
  getDefenseUpgrade,
  requirementBlockers,
  type ResearchModifiers,
} from '@orions-frontier/game-config';
import { getDb, type QueryDb, type Tx } from '../../lib/db/index.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { completionEventId, type QueueJobDroppedEvent } from '../../lib/completion-events.js';
import {
  findStationBuildingByKeyForUpdate,
  insertStationBuildingIfMissing,
  listStationBuildings,
  updateStationBuilding,
  type StationBuildingRow,
} from '../../repositories/station-buildings.js';
import {
  deleteQueuedJob,
  insertQueuedJob,
  listStationQueue,
  type QueuedJobRow,
} from '../../repositories/queued-jobs.js';
import {
  deductStationResource,
  listStationResources,
} from '../../repositories/station-resources.js';
import { findOwnedStationForUpdate } from '../../repositories/stations.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import {
  applyConstructionSpeed,
  describeBlockers,
  getResearchLevels,
  getStationResearchModifiers,
} from '../research/index.js';
import { creditStationResources } from './resources.js';

export const toBuildingLevels = (rows: { buildingKey: string; level: number }[]) => {
  const levels: BuildingLevels = {};
  for (const row of rows) {
    if (isOneOf(buildingKeys, row.buildingKey)) levels[row.buildingKey] = row.level;
  }
  return levels;
};

/** Upgrade cost after the Nanite Assembly discount. */
export const upgradeCost = (
  key: (typeof buildingKeys)[number],
  targetLevel: number,
  factor: number
) => applyBuildingCostDiscount(calculateBuildingUpgradeCost(key, targetLevel), factor);

export type StationJobKind = 'building' | 'defense';

interface UpgradeRules {
  label: string;
  startingLevel: number;
  maxLevel: number;
  cost: (level: number, modifiers: ResearchModifiers) => BuildingUpgradeCost[];
  buildSeconds: (level: number) => number;
  blockers: (
    level: number,
    research: ResearchLevels,
    built: BuildingLevels
  ) => RequirementBlocker[];
}

/** Buildings and defenses share slots and the station queue; only these rules differ. */
function upgradeRules(kind: string, key: string): UpgradeRules | null {
  if (kind === 'building' && isOneOf(buildingKeys, key)) {
    return {
      label: 'Building',
      startingLevel: 1,
      maxLevel: getBuilding(key).maxLevel,
      cost: (level, modifiers) => upgradeCost(key, level, modifiers.buildingCost),
      buildSeconds: (level) => calculateBuildingBuildTime(key, level),
      blockers: () => [],
    };
  }
  if (kind === 'defense' && isOneOf(defenseUpgradeKeys, key)) {
    const def = getDefenseUpgrade(key);
    return {
      label: 'Defense upgrade',
      startingLevel: def.startingLevel,
      maxLevel: def.maxLevel,
      cost: (level) => calculateDefenseUpgradeCost(key, level),
      buildSeconds: (level) => calculateDefenseUpgradeBuildTime(key, level),
      // Requirements unlock the first level only.
      blockers: (level, research, built) =>
        level === def.startingLevel + 1
          ? requirementBlockers(def.requirements, research, built)
          : [],
    };
  }
  return null;
}

const countRunningUpgrades = (rows: StationBuildingRow[], now: Date) =>
  rows.filter((row) => row.upgradeEndsAt !== null && row.upgradeEndsAt > now).length;

const toResourceMap = (costs: BuildingUpgradeCost[]) => {
  const map: ResourceMap = {};
  for (const cost of costs) map[cost.resourceKey] = (map[cost.resourceKey] ?? 0) + cost.amount;
  return map;
};

export const toQueuedJob = (row: QueuedJobRow): QueuedJob => ({
  id: row.id,
  kind: row.kind,
  key: row.key,
  targetLevel: row.targetLevel,
  stationId: row.stationId,
  paidCost: row.paidCost,
});

/** Build slots in use by building and defense upgrades, and the jobs waiting for one. */
export async function getBuildSlots(stationId: string, now: Date): Promise<BuildSlots> {
  const db = getDb();
  const [rows, modifiers, queue] = await Promise.all([
    listStationBuildings(db, stationId),
    getStationResearchModifiers(db, stationId),
    listStationQueue(db, stationId),
  ]);
  return {
    used: countRunningUpgrades(rows, now),
    total: modifiers.buildSlots,
    queue: queue.map(toQueuedJob),
  };
}

/**
 * Building and defense upgrades share the station's build slots. Call under the station lock so
 * two starts cannot both take the last slot.
 */
export async function assertFreeBuildSlot(
  tx: QueryDb,
  stationId: string,
  modifiers: ResearchModifiers,
  now: Date
): Promise<void> {
  const running = countRunningUpgrades(await listStationBuildings(tx, stationId), now);
  if (running >= modifiers.buildSlots) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `No free build slot (${running}/${modifiers.buildSlots})`
    );
  }
}

/** Level each building reaches once its running upgrade and the given jobs are done. */
export function plannedLevels(
  rows: { buildingKey: string; level: number; upgradeEndsAt: Date | null }[],
  jobs: { key: string; targetLevel: number }[]
) {
  const levels = new Map(
    rows.map((row) => [row.buildingKey, row.level + (row.upgradeEndsAt ? 1 : 0)])
  );
  for (const job of jobs) levels.set(job.key, job.targetLevel);
  return levels;
}

export const asBuildingLevels = (levels: Map<string, number>) =>
  toBuildingLevels([...levels].map(([buildingKey, level]) => ({ buildingKey, level })));

/**
 * Re-checks the queue as a chain and starts waiting jobs while build slots are free. A job whose
 * level no longer follows (an earlier level was cancelled) or whose requirement fell away is
 * dropped with a full refund, and so is everything that built on it. Jobs start at `at`, the
 * moment the slot freed, so an offline chain plays out the same as a watched one.
 * Call under the station lock.
 */
export async function advanceStationQueue(
  tx: Tx,
  station: { id: string; userId: string },
  at: Date
): Promise<{ started: string[]; dropped: QueueJobDroppedEvent[] }> {
  const jobs = await listStationQueue(tx, station.id);
  if (jobs.length === 0) return { started: [], dropped: [] };
  const [rows, research, modifiers] = await Promise.all([
    listStationBuildings(tx, station.id),
    getResearchLevels(tx, station.userId),
    getStationResearchModifiers(tx, station.id),
  ]);

  const planned = plannedLevels(rows, []);
  const valid: { job: QueuedJobRow; rules: UpgradeRules }[] = [];
  const dropped: QueueJobDroppedEvent[] = [];
  for (const job of jobs) {
    const rules = upgradeRules(job.kind, job.key);
    const follows =
      rules !== null &&
      job.targetLevel === (planned.get(job.key) ?? rules.startingLevel) + 1 &&
      job.targetLevel <= rules.maxLevel &&
      rules.blockers(job.targetLevel, research, asBuildingLevels(planned)).length === 0;
    if (rules && follows) {
      planned.set(job.key, job.targetLevel);
      valid.push({ job, rules });
      continue;
    }
    await deleteQueuedJob(tx, job.id);
    const refunded = await creditStationResources(tx, station.id, toResourceMap(job.paidCost));
    dropped.push({
      type: 'queue_job_dropped',
      eventId: completionEventId('queue_job_dropped', job.id),
      occurredAt: at,
      userId: station.userId,
      stationId: station.id,
      jobId: job.id,
      kind: job.kind,
      key: job.key,
      targetLevel: job.targetLevel,
      refunded,
    });
  }

  const byKey = new Map(rows.map((row) => [row.buildingKey, row]));
  const built = toBuildingLevels(rows);
  const busy = new Set(rows.filter((row) => row.upgradeEndsAt).map((row) => row.buildingKey));
  let free = modifiers.buildSlots - countRunningUpgrades(rows, at);
  const started: string[] = [];
  for (const { job, rules } of valid) {
    if (free <= 0) break;
    // Later levels wait for the running one; a job waits for a requirement still in the queue.
    const row = byKey.get(job.key);
    if (busy.has(job.key) || job.targetLevel !== (row?.level ?? rules.startingLevel) + 1) continue;
    if (rules.blockers(job.targetLevel, research, built).length > 0) continue;

    const baseEndsAt = new Date(at.getTime() + rules.buildSeconds(job.targetLevel) * 1000);
    const upgradeEndsAt = applyConstructionSpeed(
      modifiers.constructionBonus,
      built.core ?? 1,
      baseEndsAt,
      at
    );
    // A defense row is created on its first upgrade; it takes the job's id.
    const target =
      row ??
      (await insertStationBuildingIfMissing(tx, {
        id: job.id,
        stationId: station.id,
        buildingKey: job.key,
        level: rules.startingLevel,
        createdAt: at,
        updatedAt: at,
      })) ??
      (await findStationBuildingByKeyForUpdate(tx, station.id, job.key));
    if (!target) continue;
    await updateStationBuilding(tx, target.id, {
      upgradeEndsAt,
      upgradePaidCost: job.paidCost,
      updatedAt: at,
    });
    await deleteQueuedJob(tx, job.id);
    busy.add(job.key);
    free -= 1;
    started.push(job.id);
  }
  return { started, dropped };
}

const publishResources = async (tx: QueryDb, userId: string, stationId: string) => {
  const rows = await listStationResources(tx, stationId);
  return () => {
    publishUserEvent(userId, 'resources_updated', {
      stationId,
      resources: Object.fromEntries(rows.map((row) => [row.resourceKey, row.amount])),
    });
  };
};

/**
 * Pays the next level of a building or defense and queues it; it starts right away when a slot
 * is free. Without `queue` (bots, direct starts) it must start now or nothing is paid.
 */
export async function queueStationUpgrade(
  stationId: string,
  userId: string,
  kind: StationJobKind,
  key: string,
  context: GameExecutionContext,
  queue: boolean
): Promise<void> {
  const rules = upgradeRules(kind, key);
  if (!rules) throw new AppError(ErrorCode.NOT_FOUND, `${kind} ${key} not found`);

  const publish = await getDb().transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const [rows, jobs, research, modifiers] = await Promise.all([
      listStationBuildings(tx, stationId),
      listStationQueue(tx, stationId),
      getResearchLevels(tx, userId),
      getStationResearchModifiers(tx, stationId),
    ]);

    if (!queue) {
      if (rows.some((row) => row.buildingKey === key && row.upgradeEndsAt)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, `${rules.label} is already upgrading`);
      }
      await assertFreeBuildSlot(tx, stationId, modifiers, context.now);
    }
    if (jobs.length >= QUEUE_LIMIT) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Queue is full (${QUEUE_LIMIT} jobs)`);
    }
    // A queued job may rely on earlier jobs of this queue; a direct start only on what is built.
    const planned = plannedLevels(rows, queue ? jobs : []);
    const targetLevel = (planned.get(key) ?? rules.startingLevel) + 1;
    if (targetLevel > rules.maxLevel) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `${rules.label} is already at max level`);
    }
    const blockers = rules.blockers(
      targetLevel,
      research,
      queue ? asBuildingLevels(planned) : toBuildingLevels(rows)
    );
    if (blockers.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, describeBlockers(blockers));
    }

    const costs = rules.cost(targetLevel, modifiers);
    const stock = new Map(
      (await listStationResources(tx, stationId)).map((row) => [row.resourceKey, row.amount])
    );
    for (const cost of costs) {
      const have = stock.get(cost.resourceKey) ?? 0;
      if (have < cost.amount) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Insufficient ${cost.resourceKey}: need ${cost.amount}, have ${have}`
        );
      }
    }
    for (const cost of costs) {
      await deductStationResource(tx, stationId, cost.resourceKey, cost.amount);
    }

    const jobId = context.nextId('queued-job');
    await insertQueuedJob(tx, {
      id: jobId,
      userId,
      stationId,
      kind,
      key,
      targetLevel,
      paidCost: costs,
      createdAt: context.now,
    });
    const { started } = await advanceStationQueue(tx, station, context.now);
    if (!queue && !started.includes(jobId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'No free build slot');
    }
    return publishResources(tx, userId, stationId);
  });
  publish();
}

/** Removes a waiting job with a full refund; jobs that built on it are dropped too. */
export async function removeQueuedStationJob(
  stationId: string,
  userId: string,
  jobId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const publish = await getDb().transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const job = (await listStationQueue(tx, stationId)).find((row) => row.id === jobId);
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'Queued job not found');
    await deleteQueuedJob(tx, job.id);
    await creditStationResources(tx, stationId, toResourceMap(job.paidCost));
    await advanceStationQueue(tx, station, context.now);
    return publishResources(tx, userId, stationId);
  });
  publish();
}

/**
 * Stops an upgrade that is not due yet and refunds what it cost as far as storage allows. Queued
 * levels that built on it are dropped with a refund; the freed slot goes to the next job.
 * Completion only claims due upgrades, so a cancel and a completion cannot both succeed.
 */
export async function cancelStationUpgrade(
  stationId: string,
  userId: string,
  key: string,
  /** For upgrades started before the paid cost was stored. */
  refund: (row: StationBuildingRow) => BuildingUpgradeCost[],
  context: GameExecutionContext
): Promise<void> {
  const publish = await getDb().transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const row = await findStationBuildingByKeyForUpdate(tx, stationId, key);
    if (!row?.upgradeEndsAt || row.upgradeEndsAt <= context.now) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'No running upgrade to cancel');
    }
    await updateStationBuilding(tx, row.id, {
      upgradeEndsAt: null,
      upgradePaidCost: null,
      updatedAt: context.now,
    });
    await creditStationResources(tx, stationId, toResourceMap(row.upgradePaidCost ?? refund(row)));
    await advanceStationQueue(tx, station, context.now);
    return publishResources(tx, userId, stationId);
  });
  publish();
}
