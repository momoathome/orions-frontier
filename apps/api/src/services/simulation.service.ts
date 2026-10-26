import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { getBuilding } from '@orions-frontier/game-config';
import { required, isOneOf, buildingKeys, defenseUpgradeKeys } from '@orions-frontier/shared';
import {
  createRealtimeExecutionContext,
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../lib/game-execution-context.js';
import { getDb } from '../lib/db/index.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { logger as rootLogger } from '../lib/logger.js';
import { publishUserEvent } from '../lib/realtime.js';
import { completionEventId, type PlaytestCompletionEvent } from '../lib/playtest/events.js';
import { runBotDecisionTick, type BotDecisionOutcome } from './bot/bot.service.js';
import { defenseUpgradeMaxLevel } from './defense.service.js';
import { completeDueResearchDetailed } from './research.service.js';
import { settleTripArrivalDetailed } from './transport/trip-arrivals.service.js';
import { completeDueWorldMissionsDetailed } from './world-mission.service.js';

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
  const dueTrips = await db
    .select({ trip: spacecraftTrips, userId: stations.userId })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
    .where(
      and(eq(spacecraftTrips.status, 'traveling'), lte(spacecraftTrips.arrivesAt, context.now))
    )
    .orderBy(asc(spacecraftTrips.arrivesAt), asc(spacecraftTrips.id));
  let completed = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];

  for (const { trip, userId } of dueTrips) {
    try {
      const arrival = await settleTripArrivalDetailed(trip, context);
      if (arrival.settled) {
        completed += 1;
        events.push(...arrival.events);
        publishUserEvent(userId, 'transport_tick_completed', { settled: 1 });
        if (trip.purpose === 'combat' && trip.toType === 'station') {
          const [defender] = await db
            .select({ userId: stations.userId })
            .from(stations)
            .where(eq(stations.id, trip.toId));
          if (defender && defender.userId !== userId) {
            publishUserEvent(defender.userId, 'transport_tick_completed', { settled: 1 });
          }
        }
      }
    } catch (error) {
      failed += 1;
      logger.error({ tripId: trip.id, err: error }, 'Failed to settle due trip');
    }
  }
  return { phase: 'transports', completed, failed, events };
}

async function completeDueBuildings(
  context: GameExecutionContext
): Promise<SimulationPhasePassResult> {
  const db = getDb();
  const dueBuildings = await db
    .select({
      id: stationBuildings.id,
      stationId: stationBuildings.stationId,
      userId: stations.userId,
      buildingKey: stationBuildings.buildingKey,
      upgradeEndsAt: stationBuildings.upgradeEndsAt,
    })
    .from(stationBuildings)
    .innerJoin(stations, eq(stationBuildings.stationId, stations.id))
    .where(lte(stationBuildings.upgradeEndsAt, context.now))
    .orderBy(asc(stationBuildings.upgradeEndsAt), asc(stationBuildings.id));
  let completedCount = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];

  for (const building of dueBuildings) {
    try {
      const maxLevel = isOneOf(buildingKeys, building.buildingKey)
        ? getBuilding(building.buildingKey).maxLevel
        : defenseUpgradeMaxLevel(building.buildingKey);
      if (maxLevel === null || building.upgradeEndsAt === null) continue;
      const [completed] = await db
        .update(stationBuildings)
        .set({
          level: sql`least(${stationBuildings.level} + 1, ${maxLevel})`,
          upgradeEndsAt: null,
          updatedAt: building.upgradeEndsAt,
        })
        .where(
          and(
            eq(stationBuildings.id, building.id),
            lte(stationBuildings.upgradeEndsAt, context.now)
          )
        )
        .returning({ level: stationBuildings.level });
      if (!completed) continue;
      completedCount += 1;
      if (isOneOf(defenseUpgradeKeys, building.buildingKey)) {
        events.push({
          type: 'defense_completed',
          eventId: completionEventId('defense_completed', building.id, String(completed.level)),
          occurredAt: building.upgradeEndsAt,
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
          occurredAt: building.upgradeEndsAt,
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
  const dueBuildOrders = await db
    .select({
      id: spacecraftBuildOrders.id,
      stationId: spacecraftBuildOrders.stationId,
      spacecraftKey: spacecraftBuildOrders.spacecraftKey,
      amount: spacecraftBuildOrders.amount,
      endsAt: spacecraftBuildOrders.endsAt,
      userId: stations.userId,
    })
    .from(spacecraftBuildOrders)
    .innerJoin(stations, eq(spacecraftBuildOrders.stationId, stations.id))
    .where(lte(spacecraftBuildOrders.endsAt, context.now))
    .orderBy(asc(spacecraftBuildOrders.endsAt), asc(spacecraftBuildOrders.id));
  let completedCount = 0;
  let failed = 0;
  const events: PlaytestCompletionEvent[] = [];

  for (const order of dueBuildOrders) {
    try {
      const completed = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .delete(spacecraftBuildOrders)
          .where(
            and(
              eq(spacecraftBuildOrders.id, order.id),
              lte(spacecraftBuildOrders.endsAt, context.now)
            )
          )
          .returning({ id: spacecraftBuildOrders.id });
        if (!claimed) return false;

        await tx
          .update(stationSpacecrafts)
          .set({
            amount: sql`${stationSpacecrafts.amount} + ${order.amount}`,
            updatedAt: order.endsAt,
          })
          .where(
            and(
              eq(stationSpacecrafts.stationId, order.stationId),
              eq(stationSpacecrafts.spacecraftKey, order.spacecraftKey)
            )
          );
        return true;
      });

      if (completed) {
        completedCount += 1;
        events.push({
          type: 'spacecraft_completed',
          eventId: completionEventId('spacecraft_completed', order.id),
          occurredAt: order.endsAt,
          userId: order.userId,
          stationId: order.stationId,
          orderId: order.id,
          spacecraftKey: order.spacecraftKey,
          amount: order.amount,
        });
        publishUserEvent(order.userId, 'spacecraft_build_completed', {
          stationId: order.stationId,
          spacecraftKey: order.spacecraftKey,
          amount: order.amount,
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

async function runCompletionPass(
  context: GameExecutionContext,
  includeWorldMissions: boolean
): Promise<SimulationPhasePassResult[]> {
  const results: SimulationPhasePassResult[] = [
    await completeDueTransports(context),
    await completeDueBuildings(context),
    await completeDueSpacecraft(context),
  ];
  const researchEvents = await completeDueResearchDetailed(context.now);
  results.push({
    phase: 'research',
    completed: researchEvents.length,
    failed: 0,
    events: researchEvents,
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
