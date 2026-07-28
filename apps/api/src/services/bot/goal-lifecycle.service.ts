import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import type { GoalBotState } from './goal-state.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Outcome of a single bot decision cycle.
 * Exactly one of these is returned per tick.
 */
export type GoalResult =
  | { type: 'success'; actionLabel: string; reason: string }
  | { type: 'waiting'; detail: string; reason: string }
  | { type: 'saving'; detail: string; reason: string }
  | { type: 'blocked'; detail: string; reason: string }
  | { type: 'complete'; goalType: string; targetRef: string; reason: string };

// ---------------------------------------------------------------------------
// Urgent maintenance
// ---------------------------------------------------------------------------

/**
 * Check for urgent maintenance actions before the goal step.
 * Returns a maintenance result if one was taken, or null if no maintenance needed.
 *
 * Urgent maintenance includes:
 * - Reassigning an idle miner to a visible asteroid
 * - (future: responding to an immediate threat)
 *
 * Maintenance must not spend resources below the active goal's reserved costs.
 */
export function checkUrgentMaintenance(
  _state: GoalBotState,
  _profile: BotProfile,
  _reservedCosts: Record<string, number>
): GoalResult | null {
  // GB-12+ will implement actual maintenance checks (reassign idle miners, etc.)
  // For now, no maintenance actions exist yet.
  return null;
}

// ---------------------------------------------------------------------------
// Goal progress & completion checks
// ---------------------------------------------------------------------------

const MAX_BLOCKED_INTERVALS = 5;

/**
 * Evaluate the current active goal's status.
 *
 * @returns A GoalResult if the goal should transition (complete/blocked-release),
 *          or null if the goal is still in progress.
 */
export function evaluateActiveGoal(
  _state: GoalBotState,
  activeGoalType: string,
  activeGoalTarget: string,
  _goalStartedAt: Date | null,
  _lastProgressAt: Date | null,
  blockedCount: number,
  hasProgressThisTick: boolean
): GoalResult | null {
  // GB-12+ will implement concrete goal completion checks.
  // For now, no goals can complete — they remain in progress until blocked-release.

  if (hasProgressThisTick) {
    // Progress was made — reset blocked counter
    return null;
  }

  // No progress this tick — check if goal is blocked
  const newBlockedCount = blockedCount + 1;

  if (newBlockedCount >= MAX_BLOCKED_INTERVALS) {
    return {
      type: 'complete',
      goalType: activeGoalType,
      targetRef: activeGoalTarget,
      reason: `Goal ${activeGoalType} target=${activeGoalTarget} released after ${MAX_BLOCKED_INTERVALS} blocked ticks without progress`,
    };
  }

  return {
    type: 'blocked',
    detail: `No progress for ${newBlockedCount}/${MAX_BLOCKED_INTERVALS} intervals`,
    reason: `Goal ${activeGoalType} target=${activeGoalTarget} blocked (${newBlockedCount}/${MAX_BLOCKED_INTERVALS})`,
  };
}

// ---------------------------------------------------------------------------
// Next step toward a goal
// ---------------------------------------------------------------------------

/**
 * Determine the next legal step toward a goal.
 *
 * @returns A GoalResult describing the action taken / state, or null if
 *          the goal should be re-evaluated (e.g., complete).
 */
export function determineNextStep(
  _state: GoalBotState,
  _profile: BotProfile,
  goalType: string,
  _targetRef: string
): GoalResult {
  // GB-12+ will implement concrete goal step logic.
  // For now, all goals are blocked — no generators exist yet.
  return {
    type: 'blocked',
    detail: `No implementation for goal type: ${goalType}`,
    reason: `No step implementation for ${goalType}`,
  };
}
