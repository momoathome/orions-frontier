import { getDb } from '../../lib/db/index.js';
import {
  claimBotDecision,
  findBotController,
  goalTypes,
  listDueBotControllerUserIds,
  updateBotController,
  updateBotControllerReturningGoal,
  type BotControllerUpdate,
} from '../../repositories/bot-controllers.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { loadGoalBotState } from './goal-loader.js';
import { checkUrgentMaintenance, determineNextStep, selectGoalForState } from './goal-lifecycle.js';
import type { GoalResult } from './goal-state.js';
import { BotIntentRejected, executeBotIntent } from './intent.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import type { BotProfile, GoalType } from '../../lib/db/schema/bot-controllers.js';
import { isOneOf } from '@orions-frontier/shared';
import {
  analyzeConflictOpportunities,
  type ConflictOpportunitySnapshot,
} from './goals/conflict.js';
import {
  activeGoalCommitment,
  adaptCategoryWeights,
  categoryWeightsFor,
  type WeightSignal,
} from './goal-driven-v1.js';

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

/** Derives learning signals from one decision's before/after goal state. */
function weightSignals(
  before: GoalType | null,
  after: GoalType | null,
  completedGoalType: string | null,
  resultKind: BotDecisionResultKind
): { goalType: GoalType; signal: WeightSignal }[] {
  const signals: { goalType: GoalType; signal: WeightSignal }[] = [];
  if (completedGoalType && isOneOf(goalTypes, completedGoalType)) {
    signals.push({ goalType: completedGoalType, signal: 'complete' });
  }
  if (before && !after && resultKind === 'blocked') {
    signals.push({ goalType: before, signal: 'released' });
  }
  if (after && resultKind === 'saving') signals.push({ goalType: after, signal: 'saving' });
  return signals;
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
  const controller = await findBotController(db, userId);
  if (!controller) {
    return {
      action: 'wait',
      reason: 'No controller',
      hasProgress: false,
      completedGoalType: null,
    };
  }

  const profile = controller.profile;
  const weights = categoryWeightsFor(profile, controller.categoryWeights);
  if (profile === 'warlord') {
    observeConflictOpportunity?.(analyzeConflictOpportunities(state, profile));
  }

  const clearGoal = async (): Promise<void> => {
    await updateBotController(db, userId, {
      activeGoalType: null,
      activeGoalTarget: null,
      goalStartedAt: null,
      blockedCount: 0,
      updatedAt: now,
    });
  };

  const applyStep = async (
    goalType: GoalType,
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
        await updateBotController(db, userId, {
          ...baseGoalUpdate,
          blockedCount: 0,
          lastProgressAt: now,
        });
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
        await updateBotController(db, userId, {
          ...baseGoalUpdate,
          blockedCount,
          ...(error.retryAfterMs
            ? { nextDecisionAt: new Date(now.getTime() + error.retryAfterMs) }
            : {}),
        });
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
      await updateBotController(db, userId, { ...baseGoalUpdate, blockedCount });
      return {
        action: 'blocked',
        reason: step.reason,
        hasProgress: false,
        completedGoalType: null,
      };
    }

    await updateBotController(db, userId, { ...baseGoalUpdate, blockedCount: 0 });
    return {
      action: step.type,
      reason: step.reason,
      hasProgress: false,
      completedGoalType: null,
    };
  };

  // 1. Urgent maintenance uses the regular dispatcher and consumes this interval's action.
  const maintenance = await checkUrgentMaintenance(
    state,
    profile,
    {},
    controller.activeGoalType && controller.activeGoalTarget
      ? { goalType: controller.activeGoalType, targetRef: controller.activeGoalTarget }
      : null
  );
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
      // Apply hysteresis while the active goal is still a generated candidate. A running mission
      // may disappear from generators; it stays bound until its commitment has faded, then the
      // mission runs on in the world while the bot pursues something else.
      if (activeStep.type !== 'blocked') {
        // Progress made for an earlier goal does not count toward this one.
        const commitment = activeGoalCommitment(
          now.getTime() -
            Math.max(
              controller.lastProgressAt?.getTime() ?? 0,
              controller.goalStartedAt?.getTime() ?? now.getTime()
            )
        );
        const selection = await selectGoalForState(
          state,
          profile,
          { goalType: controller.activeGoalType, targetRef: controller.activeGoalTarget },
          weights,
          commitment
        );
        const mayLeave =
          selection.activeCandidateFound || (activeStep.type === 'waiting' && commitment === 0);
        if (
          mayLeave &&
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
  const selection = await selectGoalForState(state, profile, null, weights);

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
  const due = await listDueBotControllerUserIds(db, now);

  for (const bot of due) {
    const offsetMs = botOffsetMs(bot.userId);
    const nextDecisionAt = new Date(now.getTime() + DECISION_INTERVAL_MS + offsetMs);
    const claimed = await claimBotDecision(db, bot.userId, now, nextDecisionAt);
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
    const updates: BotControllerUpdate = {
      lastAction: action,
      lastReason: reason.slice(0, 255),
      updatedAt: now,
    };
    if (hasProgress) {
      updates.lastProgressAt = now;
    }
    const updated = await updateBotControllerReturningGoal(db, bot.userId, updates);
    const resultKind = decisionResultKind(action, hasProgress);
    if (claimed.strategy === 'goal_v1') {
      await updateBotController(db, bot.userId, {
        categoryWeights: adaptCategoryWeights(
          categoryWeightsFor(claimed.profile, claimed.categoryWeights),
          claimed.profile,
          weightSignals(
            claimed.activeGoalType,
            updated?.activeGoalType ?? null,
            completedGoalType,
            resultKind
          )
        ),
      });
    }
    outcomes.push({
      botUserId: bot.userId,
      decidedAt: now,
      strategy: claimed.strategy,
      profile: claimed.profile,
      activeGoalBefore: claimed.activeGoalType,
      activeGoalTargetBefore: claimed.activeGoalTarget,
      activeGoalAfter: updated?.activeGoalType ?? null,
      activeGoalTargetAfter: updated?.activeGoalTarget ?? null,
      completedGoalType,
      action,
      resultKind,
      reason,
      normalizedReason: normalizeBotDecisionReason(reason),
      hasProgress,
      conflictOpportunity,
    });
  }
  return outcomes;
}
