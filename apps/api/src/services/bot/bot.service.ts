import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { botControllers } from '../../lib/db/schema/bot-controllers.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { loadGoalBotState } from './goal-loader.service.js';
import {
  checkUrgentMaintenance,
  evaluateActiveGoal,
  determineNextStep,
  selectGoalForState,
} from './goal-lifecycle.service.js';

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

async function handleGoalV1(
  userId: string,
  now: Date
): Promise<{ action: string; reason: string; hasProgress: boolean }> {
  const state = await loadGoalBotState(userId);
  if (!state || state.ownStations.length === 0) {
    return { action: 'wait', reason: 'Bot has no station', hasProgress: false };
  }

  const db = getDb();
  const controller = await db
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
  if (!controller) return { action: 'wait', reason: 'No controller', hasProgress: false };

  const profile = controller.profile as import('../../lib/db/schema/bot-controllers.js').BotProfile;

  // 1. Urgent maintenance (before goal step)
  const maintenance = await checkUrgentMaintenance(state, profile, {});
  if (maintenance) {
    return { action: maintenance.type, reason: maintenance.reason, hasProgress: true };
  }

  let hasProgress = false;

  // 2. Evaluate active goal
  if (controller.activeGoalType && controller.activeGoalTarget) {
    const evaluation = await evaluateActiveGoal(
      state,
      controller.activeGoalType,
      controller.activeGoalTarget,
      controller.goalStartedAt,
      controller.lastProgressAt,
      controller.blockedCount,
      false
    );

    if (evaluation) {
      if (evaluation.type === 'complete') {
        // Goal completed or released — clear it
        await db
          .update(botControllers)
          .set({
            activeGoalType: null,
            activeGoalTarget: null,
            goalStartedAt: null,
            blockedCount: 0,
            updatedAt: now,
          })
          .where(eq(botControllers.userId, userId));
        // Fall through to select a new goal
      } else if (evaluation.type === 'blocked') {
        await db
          .update(botControllers)
          .set({ blockedCount: controller.blockedCount + 1, updatedAt: now })
          .where(eq(botControllers.userId, userId));
        return { action: evaluation.type, reason: evaluation.reason, hasProgress: false };
      } else {
        // Goal still in progress — determine next step
        const step = await determineNextStep(
          state,
          profile,
          controller.activeGoalType,
          controller.activeGoalTarget
        );
        hasProgress = step.type === 'success';
        return { action: step.type, reason: step.reason, hasProgress };
      }
    }
  }

  // 3. Select new goal if no active goal
  const activeGoal = controller.activeGoalType
    ? { goalType: controller.activeGoalType, targetRef: controller.activeGoalTarget! }
    : null;
  const selection = await selectGoalForState(state, profile, activeGoal);

  if (!selection.selected) {
    return { action: 'wait', reason: selection.reason, hasProgress: false };
  }

  // 4. Execute the next step toward the selected goal
  const step = await determineNextStep(
    state,
    profile,
    selection.selected.goalType,
    selection.selected.targetRef
  );

  if (step.type === 'success') {
    // Goal was just selected — set it
    await db
      .update(botControllers)
      .set({
        activeGoalType: selection.selected.goalType,
        activeGoalTarget: selection.selected.targetRef,
        goalStartedAt: now,
        blockedCount: 0,
        updatedAt: now,
      })
      .where(eq(botControllers.userId, userId));
    hasProgress = true;
  }

  return { action: step.type, reason: step.reason, hasProgress };
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
    let hasProgress = false;
    let errorMessage: string | null = null;
    try {
      if (claimed.strategy === 'goal_v1') {
        const r = await handleGoalV1(bot.userId, now);
        action = r.action;
        reason = r.reason;
        hasProgress = r.hasProgress;
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
    if (hasProgress || (action !== 'wait' && action !== 'blocked' && !action.endsWith('_failed'))) {
      updates['lastProgressAt'] = now;
    }
    await db.update(botControllers).set(updates).where(eq(botControllers.userId, bot.userId));
  }
}
