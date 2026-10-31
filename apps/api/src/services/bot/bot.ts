import { getDb } from '../../lib/db/index.js';
import {
  claimBotDecision,
  goalTypes,
  listDueBotControllerUserIds,
  updateBotController,
  type BotControllerRow,
  type BotControllerUpdate,
} from './repositories/bot-controllers.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { loadGoalBotState } from './goal-loader.js';
import { checkUrgentMaintenance, determineNextStep, selectGoalForState } from './goal-lifecycle.js';
import type { GoalBotState, GoalResult } from './goal-state.js';
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
  type CategoryWeights,
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

/** One decision's logged result and the controller fields it changes. */
type BotDecision = BotActionResult & { update: BotControllerUpdate };

function normalizeBotDecisionReason(reason: string): string {
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

const CLEARED_GOAL = {
  activeGoalType: null,
  activeGoalTarget: null,
  goalStartedAt: null,
  blockedCount: 0,
} satisfies BotControllerUpdate;

/** What one step did: its result kind, the action logged for it and why. */
export interface StepRun {
  type: 'success' | 'waiting' | 'saving' | 'blocked' | 'complete';
  action: string;
  reason: string;
  retryAfterMs?: number;
}

/** Executes a step's intent; a rejected or failed intent becomes the step's result. */
async function runStep(
  userId: string,
  step: GoalResult,
  context: GameExecutionContext
): Promise<StepRun> {
  if (step.type !== 'success') return { type: step.type, action: step.type, reason: step.reason };
  try {
    await executeBotIntent(userId, step.intent, context);
    return { type: 'success', action: step.intent.type, reason: step.reason };
  } catch (error) {
    if (error instanceof BotIntentRejected) {
      return {
        type: error.kind,
        action: error.kind,
        reason: error.message,
        retryAfterMs: error.retryAfterMs,
      };
    }
    // An unexpected error counts as blocked, so a goal that keeps failing is released.
    logger.warn({ botUserId: userId, error }, 'Bot action failed');
    return {
      type: 'blocked',
      action: `${step.intent.type}_failed`,
      reason: error instanceof Error ? error.message : 'Unknown bot error',
    };
  }
}

/** Raid blocks that still hold at `now`; expired entries are dropped. */
export function activeRaidBlocks(
  blocks: Record<string, string>,
  now: Date
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(blocks).filter(([, until]) => new Date(until).getTime() > now.getTime())
  );
}

/** Owner of a raid (`station:<id>`) or retaliation (`user:<id>`) target the bot can see. */
function targetOwnerId(state: GoalBotState, targetRef: string): string | undefined {
  const [kind, id] = targetRef.split(':');
  if (kind === 'user') return id;
  if (kind === 'station') return state.visibleStations.find((s) => s.id === id)?.ownerId;
  return undefined;
}

/** The controller update and logged result after one step toward a goal. */
export function goalOutcome(
  controller: Pick<
    BotControllerRow,
    'activeGoalType' | 'activeGoalTarget' | 'blockedCount' | 'goalStartedAt' | 'raidBlockedOwners'
  >,
  goal: { goalType: GoalType; targetRef: string; ownerId?: string },
  run: StepRun,
  now: Date
): { update: BotControllerUpdate; result: BotActionResult } {
  const result: BotActionResult = {
    action: run.action,
    reason: run.reason,
    hasProgress: run.type === 'success',
    completedGoalType: null,
  };
  if (run.type === 'complete') {
    return { update: CLEARED_GOAL, result: { ...result, completedGoalType: goal.goalType } };
  }
  // A protected owner is skipped by raid and retaliation; the bot goes on with its economy.
  if (run.retryAfterMs) {
    return {
      update: {
        ...CLEARED_GOAL,
        ...(goal.ownerId
          ? {
              raidBlockedOwners: {
                ...activeRaidBlocks(controller.raidBlockedOwners, now),
                [goal.ownerId]: new Date(now.getTime() + run.retryAfterMs).toISOString(),
              },
            }
          : {}),
      },
      result: { ...result, reason: `${run.reason}; target skipped for a while` },
    };
  }
  const isNewGoal =
    controller.activeGoalType !== goal.goalType || controller.activeGoalTarget !== goal.targetRef;
  const blockedCount = run.type === 'blocked' ? (isNewGoal ? 0 : controller.blockedCount) + 1 : 0;
  if (blockedCount >= MAX_BLOCKED_INTERVALS) {
    return {
      update: CLEARED_GOAL,
      result: {
        ...result,
        action: 'blocked',
        reason: `${run.reason}; goal released after ${MAX_BLOCKED_INTERVALS} blocked intervals`,
      },
    };
  }
  return {
    update: {
      activeGoalType: goal.goalType,
      activeGoalTarget: goal.targetRef,
      goalStartedAt: isNewGoal ? now : (controller.goalStartedAt ?? now),
      blockedCount,
      ...(run.type === 'success' ? { lastProgressAt: now } : {}),
    },
    result,
  };
}

type GoalChoice = { completedGoalType: GoalType | null } & (
  | { goal: { goalType: GoalType; targetRef: string }; step: GoalResult }
  | { goal: null; reason: string }
);

/**
 * Picks the goal to step toward: the active one, a better candidate it may give way to, or a new
 * selection once it completed or none is active.
 */
export async function chooseGoalStep(
  state: GoalBotState,
  profile: BotProfile,
  controller: Pick<
    BotControllerRow,
    'activeGoalType' | 'activeGoalTarget' | 'goalStartedAt' | 'lastProgressAt'
  >,
  weights: CategoryWeights,
  now: Date
): Promise<GoalChoice> {
  const stepToward = async (goalType: GoalType, targetRef: string) => ({
    goal: { goalType, targetRef },
    step: await determineNextStep(state, profile, goalType, targetRef),
  });

  // Continue an active goal. Waiting and saving are valid persistent states.
  let completedGoalType: GoalType | null = null;
  if (controller.activeGoalType && controller.activeGoalTarget) {
    const active = await stepToward(controller.activeGoalType, controller.activeGoalTarget);
    if (active.step.type === 'complete') {
      completedGoalType = active.goal.goalType;
    } else {
      // Apply hysteresis while the active goal is still a generated candidate. A running mission
      // may disappear from generators; it stays bound until its commitment has faded, then the
      // mission runs on in the world while the bot pursues something else.
      if (active.step.type !== 'blocked') {
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
          active.goal,
          weights,
          commitment
        );
        const mayLeave =
          selection.activeCandidateFound || (active.step.type === 'waiting' && commitment === 0);
        if (
          mayLeave &&
          selection.selected &&
          (selection.selected.goalType !== active.goal.goalType ||
            selection.selected.targetRef !== active.goal.targetRef)
        ) {
          return {
            completedGoalType,
            ...(await stepToward(selection.selected.goalType, selection.selected.targetRef)),
          };
        }
      }
      return { completedGoalType, ...active };
    }
  }

  // Select a new goal, including saving or waiting first steps.
  const selection = await selectGoalForState(state, profile, null, weights);
  if (!selection.selected) return { completedGoalType, goal: null, reason: selection.reason };
  return {
    completedGoalType,
    ...(await stepToward(selection.selected.goalType, selection.selected.targetRef)),
  };
}

async function handleGoalV1(
  userId: string,
  controller: BotControllerRow,
  context: GameExecutionContext,
  observeConflictOpportunity?: (snapshot: ConflictOpportunitySnapshot) => void
): Promise<BotDecision> {
  const { now } = context;
  const state = await loadGoalBotState(userId, now);
  if (!state || state.ownStations.length === 0) {
    return {
      action: 'wait',
      reason: 'Bot has no station',
      hasProgress: false,
      completedGoalType: null,
      update: {},
    };
  }

  state.blockedRaidOwners = new Set(
    Object.keys(activeRaidBlocks(controller.raidBlockedOwners, now))
  );

  const profile = controller.profile;
  const weights = categoryWeightsFor(profile, controller.categoryWeights);
  if (profile === 'warlord') {
    observeConflictOpportunity?.(analyzeConflictOpportunities(state, profile));
  }

  // Urgent maintenance uses the regular dispatcher and consumes this interval's action.
  const maintenance = await checkUrgentMaintenance(
    state,
    profile,
    controller.activeGoalType && controller.activeGoalTarget
      ? { goalType: controller.activeGoalType, targetRef: controller.activeGoalTarget }
      : null
  );
  if (maintenance?.type === 'success') {
    const run = await runStep(userId, maintenance, context);
    return {
      action: run.action,
      reason: run.reason,
      hasProgress: run.type === 'success',
      completedGoalType: null,
      update: {},
    };
  }

  const choice = await chooseGoalStep(state, profile, controller, weights, now);
  const { completedGoalType } = choice;
  if (!choice.goal) {
    return {
      action: 'wait',
      reason: choice.reason,
      hasProgress: false,
      completedGoalType,
      update: completedGoalType ? CLEARED_GOAL : {},
    };
  }
  const run = await runStep(userId, choice.step, context);
  const { update, result } = goalOutcome(
    completedGoalType ? { ...controller, ...CLEARED_GOAL } : controller,
    { ...choice.goal, ownerId: targetOwnerId(state, choice.goal.targetRef) },
    run,
    now
  );
  return {
    ...result,
    completedGoalType: result.completedGoalType ?? completedGoalType,
    update,
  };
}

export async function runBotDecisionTick(
  contextOrNow?: GameExecutionContext | Date,
  limit?: number
): Promise<BotDecisionOutcome[]> {
  const context = resolveGameExecutionContext(contextOrNow);
  const { now } = context;
  const db = getDb();
  const outcomes: BotDecisionOutcome[] = [];
  const due = await listDueBotControllerUserIds(db, now, limit);

  for (const bot of due) {
    const offsetMs = botOffsetMs(bot.userId);
    const nextDecisionAt = new Date(now.getTime() + DECISION_INTERVAL_MS + offsetMs);
    const claimed = await claimBotDecision(db, bot.userId, now, nextDecisionAt);
    if (!claimed) continue;

    let decision: BotDecision = {
      action: 'wait',
      reason: `Unknown bot strategy: ${claimed.strategy}`,
      hasProgress: false,
      completedGoalType: null,
      update: {},
    };
    let conflictOpportunity: ConflictOpportunitySnapshot | null = null;
    try {
      if (claimed.strategy === 'goal_v1') {
        decision = await handleGoalV1(bot.userId, claimed, context, (snapshot) => {
          conflictOpportunity = snapshot;
        });
      }
    } catch (error) {
      logger.warn({ botUserId: bot.userId, error }, 'Bot action failed');
      decision = {
        action: 'wait_failed',
        reason: error instanceof Error ? error.message : 'Unknown bot error',
        hasProgress: false,
        completedGoalType: null,
        update: {},
      };
    }

    const { action, reason, hasProgress, completedGoalType, update } = decision;
    const resultKind = decisionResultKind(action, hasProgress);
    const activeGoalAfter =
      update.activeGoalType === undefined ? claimed.activeGoalType : update.activeGoalType;
    const activeGoalTargetAfter =
      update.activeGoalTarget === undefined ? claimed.activeGoalTarget : update.activeGoalTarget;
    // One failed bookkeeping write must not end the tick for every bot after this one.
    try {
      await updateBotController(db, bot.userId, {
        ...update,
        ...(claimed.strategy === 'goal_v1'
          ? {
              categoryWeights: adaptCategoryWeights(
                categoryWeightsFor(claimed.profile, claimed.categoryWeights),
                claimed.profile,
                weightSignals(
                  claimed.activeGoalType,
                  activeGoalAfter,
                  completedGoalType,
                  resultKind
                )
              ),
            }
          : {}),
        lastAction: action,
        lastReason: reason.slice(0, 255),
        updatedAt: now,
      });
    } catch (error) {
      logger.warn({ botUserId: bot.userId, error }, 'Bot controller update failed');
    }
    outcomes.push({
      botUserId: bot.userId,
      decidedAt: now,
      strategy: claimed.strategy,
      profile: claimed.profile,
      activeGoalBefore: claimed.activeGoalType,
      activeGoalTargetBefore: claimed.activeGoalTarget,
      activeGoalAfter,
      activeGoalTargetAfter,
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
