import {
  AppError,
  ErrorCode,
  buildingKeys,
  isOneOf,
  type BuildingLevels,
  type RequirementBlocker,
  type ResearchKey,
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
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { completionEventId, type ResearchCompletedEvent } from '../../lib/completion-events.js';
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
  const [rows, buildings] = await Promise.all([
    listUserResearch(db, userId),
    highestBuildingLevels(db, userId),
  ]);
  const levels = toResearchLevels(rows);
  const byKey = new Map(rows.map((row) => [row.technologyKey, row]));
  const laboratory = buildings.laboratory ?? 0;
  return {
    slots: researchModifiers(levels).researchSlots,
    highestLaboratory: laboratory,
    technologies: researchDefinitions.map((definition) => {
      const row = byKey.get(definition.key);
      const level = levels[definition.key] ?? 0;
      const running = row?.completesAt && row.completesAt > context.now ? row : null;
      const nextLevel = level + 1;
      return {
        definition,
        level,
        startedAt: running?.startedAt?.toISOString() ?? null,
        completesAt: running?.completesAt?.toISOString() ?? null,
        next:
          nextLevel > definition.maxLevel
            ? null
            : {
                level: nextLevel,
                costs: calculateResearchCost(definition.key, nextLevel),
                durationSeconds: calculateResearchDuration(definition.key, nextLevel, laboratory),
                requirements: researchRequirements(definition.key, nextLevel),
              },
        blockers: researchBlockers(definition.key, levels, buildings),
      };
    }),
  };
}

export async function startResearch(
  userId: string,
  stationId: string,
  technologyKey: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const definition = getResearchDefinition(technologyKey);
  if (!definition) throw new AppError(ErrorCode.NOT_FOUND, 'Research not found');
  const key: ResearchKey = definition.key;

  const resources = await getDb().transaction(async (tx) => {
    await lockUserResearch(tx, userId);
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [rows, buildings] = await Promise.all([
      listUserResearch(tx, userId),
      highestBuildingLevels(tx, userId),
    ]);
    const levels = toResearchLevels(rows);
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

    const nextLevel = (levels[key] ?? 0) + 1;
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
    const duration = calculateResearchDuration(key, nextLevel, buildings.laboratory ?? 0);
    const started = await startResearchLevel(tx, {
      id: context.nextId('user-research'),
      userId,
      technologyKey: key,
      startedAt: context.now,
      completesAt: new Date(context.now.getTime() + duration * 1000),
      paidByStationId: stationId,
    });
    if (!started) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research is already running');
    return Object.fromEntries(stock);
  });
  publishUserEvent(userId, 'resources_updated', { stationId, resources });
}

/**
 * Stops running research and refunds its cost to the station that paid, as far as storage allows.
 * `credit` is the station service's storage-capped credit; research sits below it.
 */
export async function cancelResearch(
  userId: string,
  technologyKey: string,
  credit: (tx: Tx, stationId: string, resources: ResourceMap) => Promise<ResourceMap>,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> {
  const definition = getResearchDefinition(technologyKey);
  if (!definition) throw new AppError(ErrorCode.NOT_FOUND, 'Research not found');

  const refundedTo = await getDb().transaction(async (tx) => {
    await lockUserResearch(tx, userId);
    const cancelled = await cancelResearchLevel(tx, userId, definition.key, context.now);
    if (!cancelled) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Research is not running');
    if (!cancelled.paidByStationId) return null;
    // A destroyed payer keeps its id (soft delete); its refund is lost like its other stock.
    const payer = await findStationForUpdate(tx, cancelled.paidByStationId);
    if (!payer || payer.destroyedAt) return null;
    const refund: ResourceMap = {};
    for (const cost of calculateResearchCost(definition.key, cancelled.level + 1)) {
      refund[cost.resourceKey] = cost.amount;
    }
    await credit(tx, cancelled.paidByStationId, refund);
    const rows = await listStationResourcesForUpdate(tx, cancelled.paidByStationId);
    return {
      stationId: cancelled.paidByStationId,
      resources: Object.fromEntries(rows.map((row) => [row.resourceKey, row.amount])),
    };
  });
  if (refundedTo) publishUserEvent(userId, 'resources_updated', refundedTo);
}

export interface ResearchPassResult {
  completed: number;
  failed: number;
  events: ResearchCompletedEvent[];
}

/** Raises every due research by one level, at most once per started level. */
export async function completeDueResearch(now = new Date()): Promise<ResearchPassResult> {
  const db = getDb();
  const result: ResearchPassResult = { completed: 0, failed: 0, events: [] };
  for (const research of await listDueResearch(db, now)) {
    try {
      const completesAt = research.completesAt;
      if (!completesAt) continue;
      const completed = await completeResearchLevel(db, research.id, now);
      if (!completed) continue;
      result.completed += 1;
      result.events.push({
        type: 'research_completed',
        eventId: completionEventId('research_completed', research.id, String(completed.level)),
        occurredAt: completesAt,
        userId: research.userId,
        stationId: null,
        researchId: research.id,
        technologyKey: research.technologyKey,
        newLevel: completed.level,
      });
      publishUserEvent(research.userId, 'research_completed', {
        technologyKey: research.technologyKey,
        newLevel: completed.level,
      });
    } catch (error) {
      result.failed += 1;
      logger.error({ researchId: research.id, err: error }, 'Failed to complete research');
    }
  }
  return result;
}
