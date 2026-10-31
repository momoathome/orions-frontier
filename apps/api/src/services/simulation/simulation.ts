import { required } from '@orions-frontier/shared';
import {
  createRealtimeExecutionContext,
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import { getDb, withExclusiveLock } from '../../lib/db/index.js';
import {
  findNextTripDueAt,
  listDueTripsWithOwner,
  recordTripSettleFailure,
} from '../fleet/index.js';
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
  findNextBuildingUpgradeDueAt,
  findNextBuildOrderDueAt,
  findStation,
  findStationForUpdate,
  listActiveStationsByUser,
  recheckResearchQueue,
  type ResearchQueueHooks,
} from '../station/index.js';
import { settleTripArrival } from '../transport/index.js';
import { completeDueWorldMissions, findNextWorldMissionDueAt } from '../missions/index.js';
import { findNextResearchDueAt } from '../research/index.js';
import { recordLogbookEvents } from '../logbook/index.js';
import { assignIdleMiners } from '../mining/index.js';

const logger = rootLogger.child({ name: 'simulation' });
const MAX_DRAIN_PASSES = 10_000;
// Bounds one realtime tick; bots left over stay due and go first in the next tick.
const BOT_DECISIONS_PER_TICK = 20;
// Due work older than this means downtime or a stalled tick; only then step through it in time order.
const CATCH_UP_STEP_AFTER_MS = 5_000;

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

/** Parallel Construction adds a build slot, which every station's queue may use at once. */
const researchQueueHooks: ResearchQueueHooks = {
  credit: creditStationResources,
  afterComplete: async (tx, userId, technologyKey, at) => {
    if (technologyKey !== 'parallel_construction') return [];
    const dropped = [];
    // Id order, so two transactions locking several stations cannot deadlock.
    const ids = (await listActiveStationsByUser(tx, userId)).map((station) => station.id).sort();
    for (const id of ids) {
      const station = await findStationForUpdate(tx, id);
      if (station) dropped.push(...(await advanceStationQueue(tx, station, at)).dropped);
    }
    return dropped;
  },
};

type StationWorkResults = Record<Exclude<SimulationPhase, 'transports'>, SimulationPhasePassResult>;

const addResult = (
  total: SimulationPhasePassResult,
  result: Omit<SimulationPhasePassResult, 'phase'>
) => {
  total.completed += result.completed;
  total.failed += result.failed;
  total.events.push(...result.events);
};

/**
 * Buildings, spacecraft, research and world missions due by `context.now`, in phase order.
 * `tickNow` is the tick's real time; failures back off from it.
 */
async function completeDueStationWork(
  context: GameExecutionContext,
  totals: StationWorkResults,
  tickNow: Date
) {
  addResult(totals.buildings, await completeDueBuildings(context.now));
  addResult(
    totals.spacecraft,
    // The Autonomous Mining Fleet sends new miners out right away.
    await completeDueSpacecraft(context.now, (built) =>
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
    )
  );
  addResult(totals.research, await completeDueResearch(context.now, researchQueueHooks));
  // A failure backs off from the tick's time, so later steps of this tick do not retry it.
  addResult(totals.world_missions, await completeDueWorldMissions(context, tickNow));
}

async function completeDueTransports(
  context: GameExecutionContext,
  stationWork: StationWorkResults,
  tickNow: Date
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
    if (trip.purpose === 'combat' && trip.toType === 'station') {
      // Work due before the attack lands first: finished fighters defend, and the attack may
      // destroy the station the rest belongs to.
      await completeDueStationWork(context.at(trip.arrivesAt), stationWork, tickNow);
    }
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
      const failures = await recordTripSettleFailure(db, trip.id, tickNow);
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

async function runCompletionPass(
  context: GameExecutionContext,
  tickNow: Date
): Promise<SimulationPhasePassResult[]> {
  const totals: StationWorkResults = {
    buildings: { phase: 'buildings', completed: 0, failed: 0, events: [] },
    spacecraft: { phase: 'spacecraft', completed: 0, failed: 0, events: [] },
    research: { phase: 'research', completed: 0, failed: 0, events: [] },
    world_missions: { phase: 'world_missions', completed: 0, failed: 0, events: [] },
  };
  const transports = await completeDueTransports(context, totals, tickNow);
  await completeDueStationWork(context, totals, tickNow);
  return [transports, totals.buildings, totals.spacecraft, totals.research, totals.world_missions];
}

const PHASES: SimulationPhase[] = [
  'transports',
  'buildings',
  'spacecraft',
  'research',
  'world_missions',
];

/** Earliest work due in (after, now] in any phase; null if none. */
async function findNextDueAt(after: Date | null, now: Date): Promise<Date | null> {
  const db = getDb();
  const times = await Promise.all([
    findNextTripDueAt(db, after, now),
    findNextBuildingUpgradeDueAt(db, after, now),
    findNextBuildOrderDueAt(db, after, now),
    findNextResearchDueAt(db, after, now),
    findNextWorldMissionDueAt(db, after, now),
  ]);
  return times.reduce<Date | null>((min, at) => (at && (!min || at < min) ? at : min), null);
}

/**
 * Steps through due work in time order, so a late tick after downtime plays out like the watched
 * timeline. Each step re-lists everything due by its time: new legs and queue starts due later get
 * their own step, and work an earlier step left behind is retried. A last drain at `now` keeps the
 * rest. A regular tick has no backlog and skips the steps, which cost queries per due time.
 */
async function drainDueWork(context: GameExecutionContext): Promise<SimulationDrainResult> {
  const drained: SimulationDrainResult = {
    passes: 0,
    phases: PHASES.map((phase) => ({ phase, completed: 0, failed: 0 })),
    events: [],
  };
  let at = await findNextDueAt(null, context.now);
  if (at && context.now.getTime() - at.getTime() <= CATCH_UP_STEP_AFTER_MS) at = null;
  while (at) {
    await drainAt(context.at(at), context.now, drained);
    at = await findNextDueAt(at, context.now);
  }
  await drainAt(context, context.now, drained);
  return drained;
}

/** Repeats completion passes at `context.now` until one completes nothing. */
async function drainAt(
  context: GameExecutionContext,
  tickNow: Date,
  drained: SimulationDrainResult
): Promise<void> {
  let lastCompletedPhase: SimulationPhase | null = null;

  for (let pass = 1; pass <= MAX_DRAIN_PASSES; pass += 1) {
    const results = await runCompletionPass(context, tickNow);
    await recordLogbookEvents(results.flatMap((result) => result.events));
    let passCompleted = 0;
    for (const result of results) {
      const total = required(
        drained.phases.find((candidate) => candidate.phase === result.phase),
        `phase total ${result.phase}`
      );
      total.completed += result.completed;
      total.failed += result.failed;
      drained.events.push(...result.events);
      passCompleted += result.completed;
      if (result.completed > 0) lastCompletedPhase = result.phase;
    }
    if (passCompleted === 0) return;
    drained.passes += 1;
  }

  throw new Error(
    `Simulation drain exceeded ${MAX_DRAIN_PASSES} passes at ${context.now.toISOString()}; ` +
      `last completed phase: ${lastCompletedPhase ?? 'none'}`
  );
}

export async function runWorldTick(
  contextOrNow?: GameExecutionContext | Date,
  botLimit?: number
): Promise<WorldTickResult> {
  const context = resolveGameExecutionContext(contextOrNow);
  const drained = await drainDueWork(context);
  const botDecisions = await runBotDecisionTick(context, botLimit);
  return {
    now: context.now,
    ...drained,
    botDecisions,
  };
}

/** One world tick across all API processes; a process that finds another ticking skips this one. */
export function runExclusiveWorldTick(): Promise<WorldTickResult | undefined> {
  return withExclusiveLock('world-tick', () =>
    runWorldTick(createRealtimeExecutionContext(), BOT_DECISIONS_PER_TICK)
  );
}

export function startSimulationScheduler(intervalMs = 1_000): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void runExclusiveWorldTick()
      .catch((error: unknown) => {
        logger.error({ error }, 'Simulation tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}
