import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { botControllers } from '../../lib/db/schema/bot-controllers.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { startBuildingUpgrade } from '../building.service.js';
import { createAsteroidAssignment } from '../mining/assignment.service.js';
import { buildSpacecrafts } from '../spacecraft.service.js';
import { loadEconomicBotState } from './bot-state.service.js';
import { decideEconomicAction } from './economic-v1.js';
import { loadGoalBotState } from './goal-loader.service.js';
import { checkUrgentMaintenance, evaluateActiveGoal } from './goal-lifecycle.service.js';
import type { BotIntent } from './economic-v1.js';

const logger = rootLogger.child({ name: 'bots' });
const DECISION_INTERVAL_MS = 60_000;
const DECISION_OFFSET_MAX_MS = 15_000;

/** Stable bot-dependent offset in [0, 15000) ms based on userId hash. */
function botOffsetMs(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % DECISION_OFFSET_MAX_MS;
}

async function executeIntent(userId: string, intent: BotIntent): Promise<void> {
  switch (intent.type) {
    case 'wait':
      return;
    case 'assign_miner': {
      const result = await createAsteroidAssignment({
        userId,
        asteroidId: intent.asteroidId,
        stationId: intent.stationId,
        spacecraftKey: intent.spacecraftKey,
        assignedAmount: intent.amount,
      });
      if ('code' in result) throw new Error(`${result.code}: ${result.message}`);
      return;
    }
    case 'build_spacecraft':
      await buildSpacecrafts(intent.stationId, userId, [
        { spacecraftKey: intent.spacecraftKey, amount: intent.amount },
      ]);
      return;
    case 'upgrade_building':
      await startBuildingUpgrade(intent.stationId, intent.buildingKey, userId);
  }
}

async function handleEconomicV1(userId: string) {
  const state = await loadEconomicBotState(userId);
  if (!state) return { action: 'wait', reason: 'Bot has no station' };
  const intent = decideEconomicAction(state);
  await executeIntent(userId, intent);
  return { action: intent.type, reason: intent.reason };
}

async function handleGoalV1(
  userId: string,
  _now: Date
): Promise<{ action: string; reason: string }> {
  const state = await loadGoalBotState(userId);
  if (!state || state.ownStations.length === 0) {
    return { action: 'wait', reason: 'Bot has no station' };
  }

  const controller = await getDb()
    .select({
      profile: botControllers.profile,
      activeGoalType: botControllers.activeGoalType,
      activeGoalTarget: botControllers.activeGoalTarget,
      goalStartedAt: botControllers.goalStartedAt,
      lastProgressAt: botControllers.lastProgressAt,
      blockedCount: botControllers.blockedCount,
    })
    .from(botControllers)
    .where(eq(botControllers.userId, userId))
    .limit(1)
    .then((rows) => rows[0]);
  if (!controller) return { action: 'wait', reason: 'No controller' };

  const profile = controller.profile as import('../../lib/db/schema/bot-controllers.js').BotProfile;

  // 1. Urgent maintenance
  const maintenance = checkUrgentMaintenance(state, profile, {});
  if (maintenance) {
    return { action: maintenance.type, reason: maintenance.reason };
  }

  // 2. Evaluate active goal
  if (controller.activeGoalType && controller.activeGoalTarget) {
    const evaluation = evaluateActiveGoal(
      state,
      controller.activeGoalType,
      controller.activeGoalTarget,
      controller.goalStartedAt,
      controller.lastProgressAt,
      controller.blockedCount,
      false // hasProgressThisTick — GB-12+ will set this
    );

    if (evaluation) {
      if (evaluation.type === 'complete' || evaluation.type === 'blocked') {
        // Clear goal or increment blocked count
        const updates: Record<string, unknown> = {};
        if (evaluation.type === 'complete') {
          updates['activeGoalType'] = null;
          updates['activeGoalTarget'] = null;
          updates['goalStartedAt'] = null;
          updates['blockedCount'] = 0;
        } else {
          updates['blockedCount'] = controller.blockedCount + 1;
        }
        await getDb().update(botControllers).set(updates).where(eq(botControllers.userId, userId));
      }
      return { action: evaluation.type, reason: evaluation.reason };
    }
  }

  // 3. No active goal or current goal is in progress — determine next step
  // GB-12+ will generate candidates and call selectGoal from goal-driven-v1
  // For now, return a placeholder

  return { action: 'wait', reason: 'Goal system active — awaiting generators (GB-12+)' };
}

export async function runBotDecisionTick(now = new Date()): Promise<void> {
  const db = getDb();
  const due = await db
    .select({ userId: botControllers.userId })
    .from(botControllers)
    .where(lte(botControllers.nextDecisionAt, now))
    .orderBy(asc(botControllers.nextDecisionAt), asc(botControllers.userId));

  for (const bot of due) {
    const offsetMs = botOffsetMs(bot.userId);
    const nextDecisionAt = new Date(now.getTime() + DECISION_INTERVAL_MS + offsetMs);
    const [claimed] = await db
      .update(botControllers)
      .set({ nextDecisionAt, updatedAt: now })
      .where(and(eq(botControllers.userId, bot.userId), lte(botControllers.nextDecisionAt, now)))
      .returning({ strategy: botControllers.strategy, profile: botControllers.profile });
    if (!claimed) continue;

    let action = 'wait';
    let reason = 'Bot has no station';
    let errorMessage: string | null = null;
    try {
      if (claimed.strategy === 'economic_v1') {
        const r = await handleEconomicV1(bot.userId);
        action = r.action;
        reason = r.reason;
      } else if (claimed.strategy === 'goal_v1') {
        const r = await handleGoalV1(bot.userId, now);
        action = r.action;
        reason = r.reason;
      } else {
        action = 'wait';
        reason = `Unknown bot strategy: ${claimed.strategy}`;
      }
    } catch (error) {
      action = `${action}_failed`;
      errorMessage = error instanceof Error ? error.message : 'Unknown bot error';
      logger.warn({ botUserId: bot.userId, error }, 'Bot action failed');
    }
    if (errorMessage !== null) {
      reason = errorMessage;
    }

    // Update action/reason (and lastProgressAt if this was a successful action)
    const updates: Record<string, unknown> = {
      lastAction: action,
      lastReason: reason.slice(0, 255),
      updatedAt: now,
    };
    if (action !== 'wait' && action !== 'blocked' && !action.endsWith('_failed')) {
      updates['lastProgressAt'] = now;
    }
    await db.update(botControllers).set(updates).where(eq(botControllers.userId, bot.userId));
  }
}
