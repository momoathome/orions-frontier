import { and, asc, eq, lte } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { botControllers } from '../../lib/db/schema/bot-controllers.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { loadGoalBotState } from './goal-loader.service.js';
import {
  checkUrgentMaintenance,
  determineNextStep,
  selectGoalForState,
} from './goal-lifecycle.service.js';
import type { GoalResult } from './goal-lifecycle.service.js';
import { BotIntentRejected, executeBotIntent } from './bot-intent.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { analyzeConflictOpportunities, type ConflictOpportunitySnapshot } from './goal-economy.js';

const logger = rootLogger.child({ name: 'bots' });
const DECISION_INTERVAL_MS = 60_000;
const DECISION_OFFSET_MAX_MS = 15_000;
const MAX_BLOCKED_INTERVALS = 5;

export type BotDecisionResultKind =
  'success' | 'waiting' | 'saving' | 'blocked' | 'complete' | 'idle' | 'failed';

export interface BotDecisionOutcome {
  botUserId: string;
  decidedAt: Date;
  strategy: string;
  profile: BotProfile;
  activeGoalBefore: string | null;
  activeGoalTargetBefore: string | null;
  activeGoalAfter: string | null;
  activeGoalTargetAfter: string | null;
  completedGoalType: string | null;
  action: string;
  resultKind: BotDecisionResultKind;
  reason: string;
  normalizedReason: string;
  hasProgress: boolean;
  conflictOpportunity: ConflictOpportunitySnapshot | null;
}

interface BotActionResult {
  action: string;
  reason: string;
  hasProgress: boolean;
  completedGoalType: string | null;
}

export function normalizeBotDecisionReason(reason: string): string {
  return reason
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
    .replace(/\b-?\d+(?:\.\d+)?\b/g, '<number>')
    .slice(0, 255);
}

function decisionResultKind(action: string, hasProgress: boolean): BotDecisionResultKind {
  if (hasProgress) return 'success';
  if (action.endsWith('_failed')) return 'failed';
  if (action === 'waiting' || action === 'saving' || action === 'blocked') return action;
  if (action === 'complete') return 'complete';
  return 'idle';
}

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
  context: GameExecutionContext,
  observeConflictOpportunity?: (snapshot: ConflictOpportunitySnapshot) => void
): Promise<BotActionResult> {
  const { now } = context;
  const state = await loadGoalBotState(userId, now);
  if (!state || state.ownStations.length === 0) {
    return {
      action: 'wait',
      reason: 'Bot has no station',
      hasProgress: false,
      completedGoalType: null,
    };
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
  if (!controller) {
    return {
      action: 'wait',
      reason: 'No controller',
      hasProgress: false,
      completedGoalType: null,
    };
  }

  const profile = controller.profile as import('../../lib/db/schema/bot-controllers.js').BotProfile;
  if (profile === 'warlord') {
    observeConflictOpportunity?.(analyzeConflictOpportunities(state, profile));
  }

  const clearGoal = async (): Promise<void> => {
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
  };

  const applyStep = async (
    goalType: string,
    targetRef: string,
    step: GoalResult,
    isNewGoal: boolean,
    currentBlockedCount: number
  ): Promise<BotActionResult> => {
    if (step.type === 'complete') {
      await clearGoal();
      return {
        action: 'complete',
        reason: step.reason,
        hasProgress: false,
        completedGoalType: goalType,
      };
    }

    const baseGoalUpdate = {
      activeGoalType: goalType,
      activeGoalTarget: targetRef,
      goalStartedAt: isNewGoal ? now : (controller.goalStartedAt ?? now),
      updatedAt: now,
    };

    if (step.type === 'success') {
      try {
        await executeBotIntent(userId, step.intent, context);
        await db
          .update(botControllers)
          .set({
            ...baseGoalUpdate,
            blockedCount: 0,
            lastProgressAt: now,
          })
          .where(eq(botControllers.userId, userId));
        return {
          action: step.intent.type,
          reason: step.reason,
          hasProgress: true,
          completedGoalType: null,
        };
      } catch (error) {
        if (!(error instanceof BotIntentRejected)) throw error;
        const blockedCount = error.kind === 'blocked' ? currentBlockedCount + 1 : 0;
        if (blockedCount >= MAX_BLOCKED_INTERVALS) {
          await clearGoal();
          return {
            action: 'blocked',
            reason: `${error.message}; goal released after ${MAX_BLOCKED_INTERVALS} blocked intervals`,
            hasProgress: false,
            completedGoalType: null,
          };
        }
        await db
          .update(botControllers)
          .set({
            ...baseGoalUpdate,
            blockedCount,
            ...(error.retryAfterMs
              ? { nextDecisionAt: new Date(now.getTime() + error.retryAfterMs) }
              : {}),
          })
          .where(eq(botControllers.userId, userId));
        return {
          action: error.kind,
          reason: error.message,
          hasProgress: false,
          completedGoalType: null,
        };
      }
    }

    if (step.type === 'blocked') {
      const blockedCount = currentBlockedCount + 1;
      if (blockedCount >= MAX_BLOCKED_INTERVALS) {
        await clearGoal();
        return {
          action: 'blocked',
          reason: `${step.reason}; goal released after ${MAX_BLOCKED_INTERVALS} blocked intervals`,
          hasProgress: false,
          completedGoalType: null,
        };
      }
      await db
        .update(botControllers)
        .set({ ...baseGoalUpdate, blockedCount })
        .where(eq(botControllers.userId, userId));
      return {
        action: 'blocked',
        reason: step.reason,
        hasProgress: false,
        completedGoalType: null,
      };
    }

    await db
      .update(botControllers)
      .set({ ...baseGoalUpdate, blockedCount: 0 })
      .where(eq(botControllers.userId, userId));
    return {
      action: step.type,
      reason: step.reason,
      hasProgress: false,
      completedGoalType: null,
    };
  };

  // 1. Urgent maintenance uses the regular dispatcher and consumes this interval's action.
  const maintenance = await checkUrgentMaintenance(state, profile, {});
  if (maintenance?.type === 'success') {
    try {
      await executeBotIntent(userId, maintenance.intent, context);
      return {
        action: maintenance.intent.type,
        reason: maintenance.reason,
        hasProgress: true,
        completedGoalType: null,
      };
    } catch (error) {
      if (!(error instanceof BotIntentRejected)) throw error;
      return {
        action: error.kind,
        reason: error.message,
        hasProgress: false,
        completedGoalType: null,
      };
    }
  }

  // 2. Continue an active goal. Waiting and saving are valid persistent states.
  let completedGoalType: string | null = null;
  if (controller.activeGoalType && controller.activeGoalTarget) {
    const activeStep = await determineNextStep(
      state,
      profile,
      controller.activeGoalType,
      controller.activeGoalTarget
    );

    if (activeStep.type === 'complete') {
      await clearGoal();
      completedGoalType = controller.activeGoalType;
    } else {
      // Apply hysteresis only when the active goal is still a generated candidate. A running
      // mission may temporarily disappear from generators and must stay bound.
      if (activeStep.type !== 'waiting' && activeStep.type !== 'blocked') {
        const selection = await selectGoalForState(state, profile, {
          goalType: controller.activeGoalType,
          targetRef: controller.activeGoalTarget,
        });
        if (
          selection.activeCandidateFound &&
          selection.selected &&
          (selection.selected.goalType !== controller.activeGoalType ||
            selection.selected.targetRef !== controller.activeGoalTarget)
        ) {
          const selectedStep = await determineNextStep(
            state,
            profile,
            selection.selected.goalType,
            selection.selected.targetRef
          );
          return applyStep(
            selection.selected.goalType,
            selection.selected.targetRef,
            selectedStep,
            true,
            0
          );
        }
      }
      return applyStep(
        controller.activeGoalType,
        controller.activeGoalTarget,
        activeStep,
        false,
        controller.blockedCount
      );
    }
  }

  // 3. Select and persist a new goal, including saving or waiting first steps.
  const selection = await selectGoalForState(state, profile, null);

  if (!selection.selected) {
    return {
      action: 'wait',
      reason: selection.reason,
      hasProgress: false,
      completedGoalType,
    };
  }

  // 4. Execute the next step toward the selected goal
  const step = await determineNextStep(
    state,
    profile,
    selection.selected.goalType,
    selection.selected.targetRef
  );

  const result = await applyStep(
    selection.selected.goalType,
    selection.selected.targetRef,
    step,
    true,
    0
  );
  return {
    ...result,
    completedGoalType: result.completedGoalType ?? completedGoalType,
  };
}

export async function runBotDecisionTick(
  contextOrNow?: GameExecutionContext | Date
): Promise<BotDecisionOutcome[]> {
  const context = resolveGameExecutionContext(contextOrNow);
  const { now } = context;
  const db = getDb();
  const outcomes: BotDecisionOutcome[] = [];
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
      .returning({
        strategy: botControllers.strategy,
        profile: botControllers.profile,
        activeGoalType: botControllers.activeGoalType,
        activeGoalTarget: botControllers.activeGoalTarget,
      });
    if (!claimed) continue;

    let action = 'wait';
    let reason = 'Bot has no station';
    let hasProgress = false;
    let completedGoalType: string | null = null;
    let conflictOpportunity: ConflictOpportunitySnapshot | null = null;
    let errorMessage: string | null = null;
    try {
      if (claimed.strategy === 'goal_v1') {
        const r = await handleGoalV1(bot.userId, context, (snapshot) => {
          conflictOpportunity = snapshot;
        });
        action = r.action;
        reason = r.reason;
        hasProgress = r.hasProgress;
        completedGoalType = r.completedGoalType;
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
    if (hasProgress) {
      updates['lastProgressAt'] = now;
    }
    const [updated] = await db
      .update(botControllers)
      .set(updates)
      .where(eq(botControllers.userId, bot.userId))
      .returning({
        activeGoalType: botControllers.activeGoalType,
        activeGoalTarget: botControllers.activeGoalTarget,
      });
    outcomes.push({
      botUserId: bot.userId,
      decidedAt: now,
      strategy: claimed.strategy,
      profile: claimed.profile as BotProfile,
      activeGoalBefore: claimed.activeGoalType,
      activeGoalTargetBefore: claimed.activeGoalTarget,
      activeGoalAfter: updated?.activeGoalType ?? null,
      activeGoalTargetAfter: updated?.activeGoalTarget ?? null,
      completedGoalType,
      action,
      resultKind: decisionResultKind(action, hasProgress),
      reason,
      normalizedReason: normalizeBotDecisionReason(reason),
      hasProgress,
      conflictOpportunity,
    });
  }
  return outcomes;
}
