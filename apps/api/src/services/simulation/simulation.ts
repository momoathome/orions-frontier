import { getBuilding } from '@orions-frontier/game-config';
import { required, isOneOf, buildingKeys, defenseUpgradeKeys } from '@orions-frontier/shared';
import {
  createRealtimeExecutionContext,
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { getDb } from '../../lib/db/index.js';
import { claimBuiltShips, listDueBuildOrders } from '../../repositories/spacecraft-build-orders.js';
import { listDueTripsWithOwner } from '../../repositories/spacecraft-trips.js';
import {
  completeBuildingUpgrade,
  listDueBuildingUpgrades,
} from '../../repositories/station-buildings.js';
import { addBuiltSpacecraft } from '../../repositories/station-spacecrafts.js';
import {
  findStation,
  findStationForUpdate,
  listActiveStationsByUser,
} from '../../repositories/stations.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { completionEventId, type PlaytestCompletionEvent } from '../../lib/completion-events.js';
import { type BotDecisionOutcome, runBotDecisionTick } from '../bot/index.js';
import {
  advanceStationQueue,
  creditStationResources,
  defenseUpgradeMaxLevel,
} from '../station/index.js';
import {
  completeDueResearch,
  recheckResearchQueue,
  type ResearchQueueHooks,
} from '../research/index.js';
import { settleTripArrivalDetailed } from '../transport/index.js';
import { completeDueWorldMissionsDetailed } from '../missions/index.js';
import { recordLogbookEvents } from '../logbook/index.js';
import { assignIdleMiners } from '../mining/index.js';

const logger = rootLogger.child({ name: 'simulation' });
const MAX_DRAIN_PASSES = 10_000;

export type SimulationPhase =
  'transports' | 'buildings' | 'spacecraft' | 'research' | 'world_missions';

export interface SimulationPhaseResult {
  phase: SimulationPhase;
  completed: number;
  failed: number;
}

export interface SimulationDrainResult {
  passes: number;
  phases: SimulationPhaseResult[];
  events: PlaytestCompletionEvent[];
}

export interface WorldTickResult extends SimulationDrainResult {
  now: Date;
  botDecisions: BotDecisionOutcome[];
}

interface SimulationPhasePassResult extends SimulationPhaseResult {
  events: PlaytestCompletionEvent[];
}

async function completeDueTransports(
  context: GameExecutionContext
): Promise<SimulationPhasePassResult> {
  const db = getDb();
  const dueTrips = await listDueTripsWithOwner(db, context.now);
  let completed = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];
  // One notification per user per pass; clients reload once instead of once per trip.
  const settledByUser = new Map<string, number>();
  const notify = (id: string) => settledByUser.set(id, (settledByUser.get(id) ?? 0) + 1);

  for (const { trip, userId } of dueTrips) {
    try {
      const arrival = await settleTripArrivalDetailed(trip, context);
      if (arrival.settled) {
        completed += 1;
        events.push(...arrival.events);
        notify(userId);
        if (trip.purpose === 'combat' && trip.toType === 'station') {
          const defender = await findStation(db, trip.toId);
          if (defender && defender.userId !== userId) notify(defender.userId);
          // A fallen laboratory can strand queued research; drop it with a refund instead.
          if (defender?.destroyedAt) {
            events.push(
              ...(await recheckResearchQueue(
                defender.userId,
                trip.arrivesAt,
                creditStationResources
              ))
            );
          }
        }
      }
    } catch (error) {
      failed += 1;
      logger.error({ tripId: trip.id, err: error }, 'Failed to settle due trip');
    }
  }
  for (const [userId, settled] of settledByUser) {
    publishUserEvent(userId, 'transport_tick_completed', { settled });
  }
  return { phase: 'transports', completed, failed, events };
}

async function completeDueBuildings(
  context: GameExecutionContext
): Promise<SimulationPhasePassResult> {
  const db = getDb();
  const dueBuildings = await listDueBuildingUpgrades(db, context.now);
  let completedCount = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];

  for (const building of dueBuildings) {
    try {
      const maxLevel = isOneOf(buildingKeys, building.buildingKey)
        ? getBuilding(building.buildingKey).maxLevel
        : defenseUpgradeMaxLevel(building.buildingKey);
      const endsAt = building.upgradeEndsAt;
      if (maxLevel === null || endsAt === null) continue;
      // The freed slot goes to the next queued job at the moment it freed.
      const completed = await db.transaction(async (tx) => {
        const station = await findStationForUpdate(tx, building.stationId);
        const done = await completeBuildingUpgrade(tx, building.id, maxLevel, endsAt, context.now);
        if (!done) return null;
        const queue =
          station && !station.destroyedAt ? await advanceStationQueue(tx, station, endsAt) : null;
        return { level: done.level, dropped: queue?.dropped ?? [] };
      });
      if (!completed) continue;
      completedCount += 1;
      events.push(...completed.dropped);
      if (isOneOf(defenseUpgradeKeys, building.buildingKey)) {
        events.push({
          type: 'defense_completed',
          eventId: completionEventId('defense_completed', building.id, String(completed.level)),
          occurredAt: endsAt,
          userId: building.userId,
          stationId: building.stationId,
          defenseKey: building.buildingKey,
          newLevel: completed.level,
        });
        publishUserEvent(building.userId, 'defense_upgrade_completed', {
          stationId: building.stationId,
          upgradeKey: building.buildingKey,
          newLevel: completed.level,
        });
      } else {
        events.push({
          type: 'building_completed',
          eventId: completionEventId('building_completed', building.id, String(completed.level)),
          occurredAt: endsAt,
          userId: building.userId,
          stationId: building.stationId,
          buildingKey: building.buildingKey,
          newLevel: completed.level,
        });
        publishUserEvent(building.userId, 'building_upgrade_completed', {
          stationId: building.stationId,
          buildingKey: building.buildingKey,
          newLevel: completed.level,
        });
      }
    } catch (error) {
      failed += 1;
      logger.error({ buildingId: building.id, error }, 'Failed to complete building upgrade');
    }
  }
  return { phase: 'buildings', completed: completedCount, failed, events };
}

async function completeDueSpacecraft(
  context: GameExecutionContext
): Promise<SimulationPhasePassResult> {
  const db = getDb();
  const dueBuildOrders = await listDueBuildOrders(db, context.now);
  let completedCount = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];

  for (const order of dueBuildOrders) {
    // Ships come one per step; a late tick catches up on every step that has passed.
    const built =
      order.stepMs > 0
        ? Math.min(
            order.amount,
            Math.floor((context.now.getTime() - order.nextAt.getTime()) / order.stepMs) + 1
          )
        : order.amount;
    const builtAt = new Date(order.nextAt.getTime() + (built - 1) * order.stepMs);
    const nextAt = new Date(builtAt.getTime() + order.stepMs);
    const finished = built >= order.amount;
    try {
      const completed = await db.transaction(async (tx) => {
        if (!(await claimBuiltShips(tx, order.id, order.amount, built, nextAt))) return false;

        await addBuiltSpacecraft(tx, order.stationId, order.spacecraftKey, built, builtAt);
        // The Autonomous Mining Fleet sends new miners out right away.
        const assigned = await assignIdleMiners(
          tx,
          {
            stationId: order.stationId,
            spacecraftKey: order.spacecraftKey,
            amount: built,
            resourceKey: null,
            departedAt: builtAt,
          },
          context
        );
        return { assigned };
      });

      if (completed) {
        completedCount += 1;
        // The logbook notes the whole order once its last ship is done.
        if (finished) {
          events.push({
            type: 'spacecraft_completed',
            eventId: completionEventId('spacecraft_completed', order.id),
            occurredAt: builtAt,
            userId: order.userId,
            stationId: order.stationId,
            orderId: order.id,
            spacecraftKey: order.spacecraftKey,
            amount: order.orderedAmount,
          });
        }
        if (completed.assigned) events.push(completed.assigned);
        publishUserEvent(order.userId, 'spacecraft_build_completed', {
          stationId: order.stationId,
          spacecraftKey: order.spacecraftKey,
          amount: built,
          orderId: order.id,
        });
      }
    } catch (error) {
      failed += 1;
      logger.error({ orderId: order.id, error }, 'Failed to complete spacecraft build');
    }
  }
  return { phase: 'spacecraft', completed: completedCount, failed, events };
}

/** Parallel Construction adds a build slot, which every station's queue may use at once. */
const researchQueueHooks: ResearchQueueHooks = {
  credit: creditStationResources,
  afterComplete: async (tx, userId, technologyKey, at) => {
    if (technologyKey !== 'parallel_construction') return [];
    const dropped = [];
    for (const { id } of await listActiveStationsByUser(tx, userId)) {
      const station = await findStationForUpdate(tx, id);
      if (station) dropped.push(...(await advanceStationQueue(tx, station, at)).dropped);
    }
    return dropped;
  },
};

async function runCompletionPass(
  context: GameExecutionContext,
  includeWorldMissions: boolean
): Promise<SimulationPhasePassResult[]> {
  const results: SimulationPhasePassResult[] = [
    await completeDueTransports(context),
    await completeDueBuildings(context),
    await completeDueSpacecraft(context),
  ];
  results.push({
    phase: 'research',
    ...(await completeDueResearch(context.now, researchQueueHooks)),
  });
  if (includeWorldMissions) {
    const worldMissions = await completeDueWorldMissionsDetailed(context);
    results.push({
      phase: 'world_missions',
      completed: worldMissions.completed,
      failed: 0,
      events: worldMissions.events,
    });
  }
  return results;
}

function emptyPhaseTotals(includeWorldMissions: boolean): SimulationPhaseResult[] {
  const phases: SimulationPhase[] = [
    'transports',
    'buildings',
    'spacecraft',
    'research',
    ...(includeWorldMissions ? (['world_missions'] as const) : []),
  ];
  return phases.map((phase) => ({ phase, completed: 0, failed: 0 }));
}

async function drainDueWork(
  context: GameExecutionContext,
  includeWorldMissions: boolean
): Promise<SimulationDrainResult> {
  const totals = emptyPhaseTotals(includeWorldMissions);
  const events: PlaytestCompletionEvent[] = [];
  let productivePasses = 0;
  let lastCompletedPhase: SimulationPhase | null = null;

  for (let pass = 1; pass <= MAX_DRAIN_PASSES; pass += 1) {
    const results = await runCompletionPass(context, includeWorldMissions);
    await recordLogbookEvents(results.flatMap((result) => result.events));
    let passCompleted = 0;
    for (const result of results) {
      const total = required(
        totals.find((candidate) => candidate.phase === result.phase),
        `phase total ${result.phase}`
      );
      total.completed += result.completed;
      total.failed += result.failed;
      events.push(...result.events);
      passCompleted += result.completed;
      if (result.completed > 0) lastCompletedPhase = result.phase;
    }
    if (passCompleted === 0) {
      return { passes: productivePasses, phases: totals, events };
    }
    productivePasses += 1;
  }

  throw new Error(
    `Simulation drain exceeded ${MAX_DRAIN_PASSES} passes at ${context.now.toISOString()}; ` +
      `last completed phase: ${lastCompletedPhase ?? 'none'}`
  );
}

export async function runSimulationTick(
  contextOrNow?: GameExecutionContext | Date
): Promise<SimulationDrainResult> {
  return drainDueWork(resolveGameExecutionContext(contextOrNow), false);
}

export async function runWorldTick(
  contextOrNow?: GameExecutionContext | Date
): Promise<WorldTickResult> {
  const context = resolveGameExecutionContext(contextOrNow);
  const drained = await drainDueWork(context, true);
  const botDecisions = await runBotDecisionTick(context);
  return {
    now: context.now,
    ...drained,
    botDecisions,
  };
}

export function startSimulationScheduler(intervalMs = 1_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void runWorldTick(createRealtimeExecutionContext())
      .catch((error: unknown) => {
        logger.error({ error }, 'Simulation tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}
