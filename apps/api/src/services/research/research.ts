import {
  AppError,
  ErrorCode,
  QUEUE_LIMIT,
  buildingKeys,
  isOneOf,
  type BuildingLevels,
  type BuildingUpgradeCost,
  type QueuedJob,
  type RequirementBlocker,
  type ResearchKey,
  type ResearchLevels,
  type ResearchState,
  type ResourceMap,
} from '@orions-frontier/shared';
import {
  calculateResearchCost,
  calculateResearchDuration,
  getResearchDefinition,
  researchBlockers,
  researchDefinitions,
  researchModifiers,
  researchRequirements,
} from '@orions-frontier/game-config';
import { getDb, type QueryDb, type Tx } from '../../lib/db/index.js';
import { logger } from '../../lib/logger.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { listHighestBuildingLevelsByUser } from '../../repositories/station-buildings.js';
import {
  cancelResearchLevel,
  completeResearchLevel,
  listDueResearch,
  listUserResearch,
  lockUserResearch,
  startResearchLevel,
} from '../../repositories/user-research.js';
import {
  deductStationResource,
  listStationResourcesForUpdate,
} from '../../repositories/station-resources.js';
import { findOwnedStationForUpdate, findStationForUpdate } from '../../repositories/stations.js';
import {
  deleteQueuedJob,
  insertQueuedJob,
  listResearchQueue,
  type QueuedJobRow,
} from '../../repositories/queued-jobs.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import {
  completionEventId,
  type QueueJobDroppedEvent,
  type ResearchCompletedEvent,
} from '../../lib/completion-events.js';
import { toResearchLevels } from './effects.js';

async function highestBuildingLevels(db: QueryDb, userId: string): Promise<BuildingLevels> {
  const levels: BuildingLevels = {};
  for (const row of await listHighestBuildingLevelsByUser(db, userId)) {
    if (isOneOf(buildingKeys, row.buildingKey)) levels[row.buildingKey] = row.level;
  }
  return levels;
}

/** "Requires Laboratory 5 and Weapons 3", for API errors. */
export function describeBlockers(blockers: RequirementBlocker[]): string {
  const parts = blockers.map((blocker) => {
    switch (blocker.type) {
      case 'maxed':
        return 'max level';
      case 'lab_cap':
        return `Laboratory ${blocker.level}`;
      case 'building':
        return `${blocker.key[0]?.toUpperCase()}${blocker.key.slice(1)} ${blocker.level}`;
      case 'research':
        return `${getResearchDefinition(blocker.key)?.name ?? blocker.key} ${blocker.level}`;
    }
  });
  return blockers[0]?.type === 'maxed'
    ? 'Research is at max level'
    : `Requires ${parts.join(' and ')}`;
}

export async function getResearchState(
  userId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<ResearchState> {
  const db = getDb();
  const [rows, buildings, queue] = await Promise.all([
    listUserResearch(db, userId),
    highestBuildingLevels(db, userId),
    listResearchQueue(db, userId),
  ]);
  const levels = toResearchLevels(rows);
  const planned = plannedResearch(rows, queue);
  const byKey = new Map(rows.map((row) => [row.technologyKey, row]));
  const laboratory = buildings.laboratory ?? 0;
  return {
    slots: researchModifiers(levels).researchSlots,
    highestLaboratory: laboratory,
    queue: queue.map((job): QueuedJob => ({
      id: job.id,
      kind: job.kind,
      key: job.key,
      targetLevel: job.targetLevel,
      stationId: job.stationId,
      paidCost: job.paidCost,
    })),
    technologies: researchDefinitions.map((definition) => {
      const row = byKey.get(definition.key);
      const level = levels[definition.key] ?? 0;
      const running = row?.completesAt && row.completesAt > context.now ? row : null;
      const queuedLevel = planned[definition.key] ?? 0;
      const nextLevel = queuedLevel + 1;
      return {
        definition,
        level,
        startedAt: running?.startedAt?.toISOString() ?? null,
        completesAt: running?.completesAt?.toISOString() ?? null,
        queuedLevel,
        next:
          nextLevel > definition.maxLevel
            ? null
            : {
                level: nextLevel,
                costs: calculateResearchCost(definition.key, nextLevel),
                durationSeconds: calculateResearchDuration(definition.key, nextLevel, laboratory),
                requirements: researchRequirements(definition.key, nextLevel),
              },
        blockers: researchBlockers(definition.key, planned, buildings),
      };
    }),
  };
}

/** Storage-capped credit of the station service; research sits below it. */
export type CreditStation = (
  tx: Tx,
  stationId: string,
  resources: ResourceMap
) => Promise<ResourceMap>;

const toResourceMap = (costs: BuildingUpgradeCost[]) => {
  const map: ResourceMap = {};
  for (const cost of costs) map[cost.resourceKey] = (map[cost.resourceKey] ?? 0) + cost.amount;
  return map;
};

/** Level each technology reaches once running research and the given jobs are done. */
function plannedResearch(
  rows: { technologyKey: string; level: number; completesAt: Date | null }[],
  jobs: QueuedJobRow[]
): ResearchLevels {
  const planned = toResearchLevels(
    rows.map((row) => ({ ...row, level: row.level + (row.completesAt ? 1 : 0) }))
  );
  for (const job of jobs) {
    const definition = getResearchDefinition(job.key);
    if (definition) planned[definition.key] = job.targetLevel;
  }
  return planned;
}

/** Refunds to the paying station; a destroyed payer loses it like the rest of its stock. */
async function refundToPayer(
  tx: Tx,
  stationId: string | null,
  costs: BuildingUpgradeCost[],
  credit: CreditStation
): Promise<{ stationId: string; resources: ResourceMap; refunded: ResourceMap } | null> {
  if (!stationId) return null;
  const payer = await findStationForUpdate(tx, stationId);
  if (!payer || payer.destroyedAt) return null;
  const refunded = await credit(tx, stationId, toResourceMap(costs));
  const rows = await listStationResourcesForUpdate(tx, stationId);
  return {
    stationId,
    resources: Object.fromEntries(rows.map((row) => [row.resourceKey, row.amount])),
    refunded,
  };
}

/**
 * Re-checks the research queue as a chain: a job whose level no longer follows (an earlier level
 * was cancelled) or whose requirement fell away (a laboratory was destroyed) is dropped with a
 * refund, and so is everything that built on it. Call under the research lock.
 */
async function dropBrokenResearchJobs(
  tx: Tx,
  userId: string,
  at: Date,
  credit: CreditStation
): Promise<QueueJobDroppedEvent[]> {
  const [rows, buildings, jobs] = await Promise.all([
    listUserResearch(tx, userId),
    highestBuildingLevels(tx, userId),
    listResearchQueue(tx, userId),
  ]);
  const planned = plannedResearch(rows, []);
  const dropped: QueueJobDroppedEvent[] = [];
  for (const job of jobs) {
    const definition = getResearchDefinition(job.key);
    if (
      definition &&
      job.targetLevel === (planned[definition.key] ?? 0) + 1 &&
      researchBlockers(definition.key, planned, buildings).length === 0
    ) {
      planned[definition.key] = job.targetLevel;
      continue;
    }
    await deleteQueuedJob(tx, job.id);
    const refund = await refundToPayer(tx, job.stationId, job.paidCost, credit);
    dropped.push({
      type: 'queue_job_dropped',
      eventId: completionEventId('queue_job_dropped', job.id),
      occurredAt: at,
      userId,
      stationId: job.stationId,
      jobId: job.id,
      kind: job.kind,
      key: job.key,
      targetLevel: job.targetLevel,
      refunded: refund?.refunded ?? {},
    });
  }
  return dropped;
}

/**
 * Starts waiting research in queue order while research slots are free, at `at`, the moment the
 * slot freed. A job waits while its technology runs or a requirement is still queued.
 * Call under the research lock.
 */
async function startQueuedResearch(tx: Tx, userId: string, at: Date): Promise<string[]> {
  const jobs = await listResearchQueue(tx, userId);
  if (jobs.length === 0) return [];
  const [rows, buildings] = await Promise.all([
    listUserResearch(tx, userId),
    highestBuildingLevels(tx, userId),
  ]);
  const levels = toResearchLevels(rows);
  const busy = new Set(rows.filter((row) => row.completesAt).map((row) => row.technologyKey));
  let free =
    researchModifiers(levels).researchSlots -
    rows.filter((row) => row.completesAt && row.completesAt > at).length;
  const started: string[] = [];
  for (const job of jobs) {
    if (free <= 0) break;
    const definition = getResearchDefinition(job.key);
    if (!definition || busy.has(definition.key)) continue;
    if (job.targetLevel !== (levels[definition.key] ?? 0) + 1) continue;
    if (researchBlockers(definition.key, levels, buildings).length > 0) continue;
    const duration = calculateResearchDuration(
      definition.key,
      job.targetLevel,
      buildings.laboratory ?? 0
    );
    // The job's id becomes the research row's id if the technology has none yet.
    const ok = await startResearchLevel(tx, {
      id: job.id,
      userId,
      technologyKey: definition.key,
      startedAt: at,
      completesAt: new Date(at.getTime() + duration * 1000),
      paidByStationId: job.stationId,
    });
    if (!ok) continue;
    await deleteQueuedJob(tx, job.id);
    busy.add(definition.key);
    free -= 1;
    started.push(job.id);
  }
  return started;
}

/**
 * Pays the next level from `stationId` and queues it; it starts right away when a slot is free.
 * Without `queue` (bots, direct starts) it must start now or nothing is paid.
 */
export async function startResearch(
  userId: string,
  stationId: string,
  technologyKey: string,
  context: GameExecutionContext = createRealtimeExecutionContext(),
  queue = false
): Promise<void> {
  const definition = getResearchDefinition(technologyKey);
  if (!definition) throw new AppError(ErrorCode.NOT_FOUND, 'Research not found');
  const key: ResearchKey = definition.key;

  const resources = await getDb().transaction(async (tx) => {
    await lockUserResearch(tx, userId);
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [rows, buildings, jobs] = await Promise.all([
      listUserResearch(tx, userId),
      highestBuildingLevels(tx, userId),
      listResearchQueue(tx, userId),
    ]);
    const levels = toResearchLevels(rows);
    if (!queue) {
      const running = rows.filter((row) => row.completesAt && row.completesAt > context.now);
      if (running.some((row) => row.technologyKey === key)) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research is already running');
      }
      if (rows.some((row) => row.technologyKey === key && row.completesAt)) {
        // Due but not claimed yet; the next simulation pass raises the level.
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research is completing, try again shortly');
      }
      const blockers = researchBlockers(key, levels, buildings);
      if (blockers.length > 0) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, describeBlockers(blockers));
      }
      if (running.length >= researchModifiers(levels).researchSlots) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, 'No free research slot');
      }
    }
    if (jobs.length >= QUEUE_LIMIT) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Queue is full (${QUEUE_LIMIT} jobs)`);
    }
    // A queued level may rely on earlier jobs of this queue, never on queued buildings.
    const planned = plannedResearch(rows, jobs);
    const blockers = researchBlockers(key, planned, buildings);
    if (blockers.length > 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, describeBlockers(blockers));
    }

    const nextLevel = (planned[key] ?? 0) + 1;
    const costs = calculateResearchCost(key, nextLevel);
    const stock = new Map(
      (await listStationResourcesForUpdate(tx, stationId)).map((row) => [
        row.resourceKey,
        row.amount,
      ])
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
      stock.set(cost.resourceKey, (stock.get(cost.resourceKey) ?? 0) - cost.amount);
    }
    const jobId = context.nextId('queued-job');
    await insertQueuedJob(tx, {
      id: jobId,
      userId,
      stationId,
      kind: 'research',
      key,
      targetLevel: nextLevel,
      paidCost: costs,
      createdAt: context.now,
    });
    const started = await startQueuedResearch(tx, userId, context.now);
    if (!queue && !started.includes(jobId)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research is already running');
    }
    return Object.fromEntries(stock);
  });
  publishUserEvent(userId, 'resources_updated', { stationId, resources });
}

/**
 * Stops running research and refunds its cost to the station that paid, as far as storage allows.
 * Queued levels that built on it are dropped with a refund; the freed slot goes to the next job.
 */
export async function cancelResearch(
  userId: string,
  technologyKey: string,
  credit: CreditStation,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const definition = getResearchDefinition(technologyKey);
  if (!definition) throw new AppError(ErrorCode.NOT_FOUND, 'Research not found');

  const refundedTo = await getDb().transaction(async (tx) => {
    await lockUserResearch(tx, userId);
    const cancelled = await cancelResearchLevel(tx, userId, definition.key, context.now);
    if (!cancelled) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research is not running');
    const refund = await refundToPayer(
      tx,
      cancelled.paidByStationId,
      calculateResearchCost(definition.key, cancelled.level + 1),
      credit
    );
    await dropBrokenResearchJobs(tx, userId, context.now, credit);
    await startQueuedResearch(tx, userId, context.now);
    return refund;
  });
  if (refundedTo) publishUserEvent(userId, 'resources_updated', refundedTo);
}

/** Removes a waiting research job with a full refund; jobs that built on it are dropped too. */
export async function removeQueuedResearch(
  userId: string,
  jobId: string,
  credit: CreditStation,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const refundedTo = await getDb().transaction(async (tx) => {
    await lockUserResearch(tx, userId);
    const job = (await listResearchQueue(tx, userId)).find((row) => row.id === jobId);
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'Queued job not found');
    await deleteQueuedJob(tx, job.id);
    const refund = await refundToPayer(tx, job.stationId, job.paidCost, credit);
    await dropBrokenResearchJobs(tx, userId, context.now, credit);
    await startQueuedResearch(tx, userId, context.now);
    return refund;
  });
  if (refundedTo) publishUserEvent(userId, 'resources_updated', refundedTo);
}

export interface ResearchPassResult {
  completed: number;
  failed: number;
  events: (ResearchCompletedEvent | QueueJobDroppedEvent)[];
}

/** What the simulation hands in so completed research can move the queues on. */
export interface ResearchQueueHooks {
  credit: CreditStation;
  /** Runs in the completing transaction, after the research lock; returns jobs it dropped. */
  afterComplete?: (
    tx: Tx,
    userId: string,
    technologyKey: string,
    at: Date
  ) => Promise<QueueJobDroppedEvent[]>;
}

/**
 * Raises every due research by one level, at most once per started level, and starts the next
 * queued research in the same transaction. Without hooks the queue only starts, never drops.
 */
export async function completeDueResearch(
  now = new Date(),
  hooks?: ResearchQueueHooks
): Promise<ResearchPassResult> {
  const db = getDb();
  const result: ResearchPassResult = { completed: 0, failed: 0, events: [] };
  for (const research of await listDueResearch(db, now)) {
    try {
      const completesAt = research.completesAt;
      if (!completesAt) continue;
      const done = await db.transaction(async (tx) => {
        await lockUserResearch(tx, research.userId);
        const completed = await completeResearchLevel(tx, research.id, now);
        if (!completed) return null;
        const dropped = hooks
          ? await dropBrokenResearchJobs(tx, research.userId, completesAt, hooks.credit)
          : [];
        await startQueuedResearch(tx, research.userId, completesAt);
        const after =
          (await hooks?.afterComplete?.(
            tx,
            research.userId,
            research.technologyKey,
            completesAt
          )) ?? [];
        return { level: completed.level, dropped: [...dropped, ...after] };
      });
      if (!done) continue;
      result.completed += 1;
      result.events.push(
        {
          type: 'research_completed',
          eventId: completionEventId('research_completed', research.id, String(done.level)),
          occurredAt: completesAt,
          userId: research.userId,
          stationId: null,
          researchId: research.id,
          technologyKey: research.technologyKey,
          newLevel: done.level,
        },
        ...done.dropped
      );
      publishUserEvent(research.userId, 'research_completed', {
        technologyKey: research.technologyKey,
        newLevel: done.level,
      });
    } catch (error) {
      result.failed += 1;
      logger.error({ researchId: research.id, err: error }, 'Failed to complete research');
    }
  }
  return result;
}
