import { required } from '@orions-frontier/shared';
import {
  createRealtimeExecutionContext,
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { getDb } from '../../lib/db/index.js';
import { listDueTripsWithOwner, recordTripSettleFailure } from '../fleet/index.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { publishUserEvent } from '../../lib/realtime.js';
import type { PlaytestCompletionEvent } from '../../lib/completion-events.js';
import { type BotDecisionOutcome, runBotDecisionTick } from '../bot/index.js';
import {
  advanceStationQueue,
  completeDueBuildings,
  completeDueResearch,
  completeDueSpacecraft,
  creditStationResources,
  findStation,
  findStationForUpdate,
  listActiveStationsByUser,
  recheckResearchQueue,
  type ResearchQueueHooks,
} from '../station/index.js';
import { settleTripArrival } from '../transport/index.js';
import { completeDueWorldMissions } from '../missions/index.js';
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
      const arrival = await settleTripArrival(trip, context);
      if (arrival.settled) {
        completed += 1;
        events.push(...arrival.events);
        notify(userId);
        if (trip.purpose === 'combat' && trip.toType === 'station') {
          const defender = await findStation(db, trip.toId);
          if (defender && defender.userId !== userId) notify(defender.userId);
          // A fallen laboratory can strand queued research; drop it with a refund instead.
          // Own transaction: research locks come before station locks, combat holds the station.
          if (defender?.destroyedAt) {
            try {
              events.push(
                ...(await recheckResearchQueue(
                  defender.userId,
                  trip.arrivesAt,
                  creditStationResources
                ))
              );
            } catch (error) {
              // The trip is settled; a retry would not run this again, so only log it.
              logger.error({ userId: defender.userId, err: error }, 'Research recheck failed');
            }
          }
        }
      }
    } catch (error) {
      failed += 1;
      const failures = await recordTripSettleFailure(db, trip.id, context.now);
      logger.error(
        { tripId: trip.id, failures, err: error },
        failures >= 10 ? 'Trip keeps failing to settle; needs repair' : 'Failed to settle due trip'
      );
    }
  }
  for (const [userId, settled] of settledByUser) {
    publishUserEvent(userId, 'transport_tick_completed', { settled });
  }
  return { phase: 'transports', completed, failed, events };
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
    { phase: 'buildings', ...(await completeDueBuildings(context.now)) },
    {
      phase: 'spacecraft',
      // The Autonomous Mining Fleet sends new miners out right away.
      ...(await completeDueSpacecraft(context.now, (built) =>
        getDb().transaction((tx) =>
          assignIdleMiners(
            tx,
            {
              stationId: built.stationId,
              spacecraftKey: built.spacecraftKey,
              amount: built.amount,
              resourceKey: null,
              departedAt: built.builtAt,
            },
            context
          )
        )
      )),
    },
  ];
  results.push({
    phase: 'research',
    ...(await completeDueResearch(context.now, researchQueueHooks)),
  });
  if (includeWorldMissions) {
    results.push({ phase: 'world_missions', ...(await completeDueWorldMissions(context)) });
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
