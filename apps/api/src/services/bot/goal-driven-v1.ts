import { entriesOf, required } from '@orions-frontier/shared';
import type { BotProfile, GoalType } from '../../lib/db/schema/bot-controllers.js';
import { PROFILE_PARAMS } from './profiles.js';

// ---------------------------------------------------------------------------
// Category system
// ---------------------------------------------------------------------------

export type GoalCategory = 'economy' | 'research' | 'expansion' | 'conflict';

export type { GoalType } from '../../lib/db/schema/bot-controllers.js';

/** Maps each goal type to its strategic category. */
export const GOAL_CATEGORY: Record<GoalType, GoalCategory> = {
  stabilize_station: 'economy',
  increase_income: 'economy',
  increase_capacity: 'economy',
  research_technology: 'research',
  explore_sector: 'expansion',
  establish_colony: 'expansion',
  fortify_station: 'conflict',
  build_strike_force: 'conflict',
  raid: 'conflict',
  retaliate: 'conflict',
  salvage: 'economy',
};

/**
 * Profile category weights from the plan.
 * Index by profile then category.
 */
export type CategoryWeights = Record<GoalCategory, number>;

export const CATEGORY_WEIGHTS: Record<BotProfile, CategoryWeights> = {
  industrialist: { economy: 1.5, research: 0.8, expansion: 0.9, conflict: 0.6 },
  pioneer: { economy: 1.0, research: 0.8, expansion: 1.5, conflict: 0.7 },
  technocrat: { economy: 1.0, research: 1.5, expansion: 0.9, conflict: 0.8 },
  warlord: { economy: 1.0, research: 0.7, expansion: 0.8, conflict: 1.5 },
};

// ---------------------------------------------------------------------------
// Adaptive weights
// ---------------------------------------------------------------------------

const MIN_CATEGORY_WEIGHT = 0.4;
const MAX_CATEGORY_WEIGHT = 2.0;
/** Share of the gap to the profile start weight closed on every decision. */
const WEIGHT_REVERSION = 0.02;
const COMPLETE_BONUS = 0.1;
const RELEASE_PENALTY = 0.15;
/** Each saving interval costs a little patience, so stalled goals can be overtaken. */
const SAVING_DRIFT = 0.03;

const ACTIVE_COMMITMENT = 25;
/** Without progress, the active goal's commitment bonus fades to zero over this window. */
const COMMITMENT_FADE_MS = 30 * 60_000;

/** Commitment bonus of the active goal after `stalledMs` without progress. */
export function activeGoalCommitment(stalledMs: number): number {
  return ACTIVE_COMMITMENT * Math.max(0, 1 - Math.max(0, stalledMs) / COMMITMENT_FADE_MS);
}

export type WeightSignal = 'complete' | 'released' | 'saving';

/** Restores persisted weights, falling back to the profile start weight per category. */
export function categoryWeightsFor(
  profile: BotProfile,
  stored: Record<string, number> | null | undefined
): CategoryWeights {
  const base = CATEGORY_WEIGHTS[profile];
  const read = (category: GoalCategory): number => {
    const value = stored?.[category];
    return typeof value === 'number' && Number.isFinite(value) ? value : base[category];
  };
  return {
    economy: read('economy'),
    research: read('research'),
    expansion: read('expansion'),
    conflict: read('conflict'),
  };
}

/**
 * Shifts weights after one decision: outcomes nudge their goal's category, then every
 * category drifts back toward the profile start weight. Deterministic and clamped.
 */
export function adaptCategoryWeights(
  weights: CategoryWeights,
  profile: BotProfile,
  signals: readonly { goalType: GoalType; signal: WeightSignal }[]
): CategoryWeights {
  const base = CATEGORY_WEIGHTS[profile];
  const delta: Record<WeightSignal, number> = {
    complete: COMPLETE_BONUS,
    released: -RELEASE_PENALTY,
    saving: -SAVING_DRIFT,
  };
  const next = { ...weights };
  for (const { goalType, signal } of signals) next[GOAL_CATEGORY[goalType]] += delta[signal];
  for (const [category, value] of entriesOf(next)) {
    const reverted = value + (base[category] - value) * WEIGHT_REVERSION;
    const clamped = Math.min(MAX_CATEGORY_WEIGHT, Math.max(MIN_CATEGORY_WEIGHT, reverted));
    next[category] = Math.round(clamped * 1000) / 1000;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Candidate types
// ---------------------------------------------------------------------------

/**
 * A candidate goal for evaluation.
 * All score components live on a 0-100 scale (except where noted).
 */
export interface GoalCandidate {
  goalType: GoalType;
  category: GoalCategory;
  /** Canonical target reference, e.g. `station:<uuid>`, `sector:<x>:<y>`, `tech:<key>`. */
  targetRef: string;
  /** How badly this goal is needed right now (0-100). */
  baseNeed: number;
  /** Current situational opportunity (0-100). */
  opportunity: number;
  /** Expected long-term strategic value (0-100). */
  longTermValue: number;
  /** Commitment / progress bonus for an already-started goal (0-100). */
  commitment: number;
  /** Total resource / ship / time cost (0-100, higher = more expensive). */
  cost: number;
  /** Risk of failure / loss (0-100). */
  risk: number;
  /** Blocked prerequisites (0 = none, 100 = completely blocked). */
  blockers: number;
}

export interface ScoredCandidate extends GoalCandidate {
  score: number;
  scoreBreakdown: {
    baseNeedWeighted: number;
    opportunity: number;
    longTermValueWeighted: number;
    commitment: number;
    cost: number;
    riskWeighted: number;
    blockers: number;
  };
}

export interface GoalSelection {
  selected: GoalCandidate | null;
  /** The scored candidate that won, if any. */
  scored: ScoredCandidate | null;
  /** Human-readable internal reason for the decision. */
  reason: string;
  /** All scored candidates for traceability. */
  allScored: ScoredCandidate[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Hysteresis threshold: a new candidate must score at least this fraction higher than the current goal to replace it. */
const HYSTERESIS_THRESHOLD = 1.25;

/**
 * Score a single candidate for the given profile.
 * Returns the score and its breakdown.
 */
export function scoreCandidate(
  candidate: GoalCandidate,
  profile: BotProfile,
  weights: CategoryWeights = CATEGORY_WEIGHTS[profile]
): ScoredCandidate {
  const params = PROFILE_PARAMS[profile];
  const categoryWeight = weights[candidate.category];

  const baseNeedWeighted = candidate.baseNeed * categoryWeight;
  const longTermValueWeighted = candidate.longTermValue * params.futureWeight;
  const riskWeighted = candidate.risk * params.riskWeight;

  const score =
    baseNeedWeighted +
    candidate.opportunity +
    longTermValueWeighted +
    candidate.commitment -
    candidate.cost -
    riskWeighted -
    candidate.blockers;

  return {
    ...candidate,
    score,
    scoreBreakdown: {
      baseNeedWeighted,
      opportunity: candidate.opportunity,
      longTermValueWeighted,
      commitment: candidate.commitment,
      cost: candidate.cost,
      riskWeighted,
      blockers: candidate.blockers,
    },
  };
}

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

function compareCandidates(a: GoalCandidate, b: GoalCandidate): number {
  // First by goalType (stable string ordering), then by targetRef
  const typeOrder = a.goalType.localeCompare(b.goalType);
  if (typeOrder !== 0) return typeOrder;
  return a.targetRef.localeCompare(b.targetRef);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Select the best goal from a list of candidates for a given profile.
 *
 * @param candidates   All available goal candidates.
 * @param profile      The bot's playstyle profile.
 * @param activeGoal   The currently active goal, if any (for hysteresis).
 * @param weights      Learned category weights; defaults to the profile start weights.
 * @returns            The selection result with breakdown.
 */
export function selectGoal(
  candidates: GoalCandidate[],
  profile: BotProfile,
  activeGoal: { goalType: GoalType; targetRef: string } | null,
  weights: CategoryWeights = CATEGORY_WEIGHTS[profile]
): GoalSelection {
  if (candidates.length === 0) {
    return {
      selected: null,
      scored: null,
      reason: 'No candidates available',
      allScored: [],
    };
  }

  // Score all candidates
  const scored = candidates.map((c) => scoreCandidate(c, profile, weights));

  // Sort by score descending, then by tie-breaking
  scored.sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return compareCandidates(a, b);
  });

  const best = required(scored[0], 'scored[0]');

  // If there's an active goal, check hysteresis
  if (activeGoal) {
    const activeScored = scored.find(
      (s) => s.goalType === activeGoal.goalType && s.targetRef === activeGoal.targetRef
    );

    if (activeScored) {
      // Active goal is still a candidate — check if another candidate is sufficiently better
      if (best.goalType === activeGoal.goalType && best.targetRef === activeGoal.targetRef) {
        // Current goal is still the best
        return {
          selected: activeScored,
          scored: activeScored,
          reason: `Continuing current goal: ${activeGoal.goalType} (score ${activeScored.score.toFixed(1)})`,
          allScored: scored,
        };
      }

      // A different candidate scored highest — apply hysteresis
      if (best.score > activeScored.score * HYSTERESIS_THRESHOLD) {
        return {
          selected: best,
          scored: best,
          reason: `Switching from ${activeGoal.goalType} (${activeScored.score.toFixed(1)}) to ${best.goalType} (${best.score.toFixed(1)}) — exceeds 25% threshold`,
          allScored: scored,
        };
      }

      // Not enough difference — keep current goal
      return {
        selected: activeScored,
        scored: activeScored,
        reason: `Keeping current goal: ${activeGoal.goalType} (score ${activeScored.score.toFixed(1)}, best alternative ${best.goalType} ${best.score.toFixed(1)})`,
        allScored: scored,
      };
    }

    // Active goal is no longer in candidates — forced switch
    // Fall through to pick the best
  }

  // No active goal, or active goal is gone — pick the best with positive score
  if (best.score > 0) {
    return {
      selected: best,
      scored: best,
      reason: `Selected ${best.goalType} target=${best.targetRef} (score ${best.score.toFixed(1)})`,
      allScored: scored,
    };
  }

  // No candidate has a positive score
  return {
    selected: null,
    scored: null,
    reason: `All candidates have non-positive scores (best: ${best.goalType} ${best.score.toFixed(1)})`,
    allScored: scored,
  };
}
