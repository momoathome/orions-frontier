import { entriesOf } from '@orions-frontier/shared';
/**
 * GB-16 – Conflict intelligence: hostility, target estimation, and reserve.
 *
 * Pure conflict logic used by raid/retaliate decisions (GB-17+).
 * No generators, no steps, no database queries — only math on already-loaded data.
 */
import type { CombatReport, StationVisualProfile } from '@orions-frontier/shared';
import type { DefenseUpgradeKey } from '@orions-frontier/shared';
import { getDefenseUpgrade, calculateDefenseUpgradeEffect } from '@orions-frontier/game-config';
import type { BotProfile } from '../../lib/db/schema/bot-controllers.js';
import { PROFILE_PARAMS } from './profiles.js';

// ---------------------------------------------------------------------------
// Hostility
// ---------------------------------------------------------------------------

/** Thresholds from GB-16. */
const HOSTILITY_RIVAL = 30;
const HOSTILITY_HOSTILE = 60;

/** Points per incoming attack. */
const HOSTILITY_PER_ATTACK = 15;
/** Points deducted per successful retaliation. */
const HOSTILITY_RETALIATION_REDUCTION = 20;
/** Decay per 24 hours without any combat activity. */
const HOSTILITY_DAILY_DECAY = 5;

/**
 * Calculate account-wide hostility score (0–100) from combat reports.
 *
 * @param userId   The bot's user id to determine attacker/defender role.
 * @param reports  All combat reports visible to this user.
 * @param now      Current timestamp for decay calculation.
 */
export function calculateHostility(
  userId: string,
  reports: CombatReport[],
  now: Date,
  opponentId?: string
): number {
  let score = 0;
  let lastActivity: number | null = null;

  for (const report of reports) {
    const reportOpponent =
      report.attackerUserId === userId
        ? report.defenderUserId
        : report.defenderUserId === userId
          ? report.attackerUserId
          : null;
    if (reportOpponent === null || (opponentId !== undefined && reportOpponent !== opponentId)) {
      continue;
    }
    const createdAt = new Date(report.createdAt).getTime();

    if (report.defenderUserId === userId) {
      // Incoming attack
      score += HOSTILITY_PER_ATTACK + Math.min(30, report.defenderLosses * 2);
      if (lastActivity === null || createdAt > lastActivity) lastActivity = createdAt;
    } else if (report.attackerUserId === userId && report.winner === 'attacker') {
      // Successful retaliation — reduces hostility
      score -= HOSTILITY_RETALIATION_REDUCTION;
      if (lastActivity === null || createdAt > lastActivity) lastActivity = createdAt;
    } else if (report.attackerUserId === userId) {
      score += Math.min(20, report.attackerLosses * 2);
      if (lastActivity === null || createdAt > lastActivity) lastActivity = createdAt;
    }
  }

  // Decay: subtract for each full 24h since last activity
  if (lastActivity !== null) {
    const hoursSinceActivity = (now.getTime() - lastActivity) / 3_600_000;
    const fullDays = Math.floor(hoursSinceActivity / 24);
    score -= fullDays * HOSTILITY_DAILY_DECAY;
  }

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Target defense estimation (public data only)
// ---------------------------------------------------------------------------

/**
 * Upper-bound level for each visual tier.
 * Tier 0 = 0, Tier 1 = 4, Tier 2 = 9, Tier 3 = max level of the upgrade.
 */
function tierMaxLevel(tier: number, upgradeKey: DefenseUpgradeKey): number {
  switch (tier) {
    case 0:
      return 0;
    case 1:
      return 4;
    case 2:
      return 9;
    case 3:
      return getDefenseUpgrade(upgradeKey).maxLevel;
    default:
      return 0;
  }
}

/**
 * Estimate a target station's defense score from its public visual profile.
 *
 * Uses upper-bound tier estimates so the bot does not underestimate
 * an opponent's strength (GB-16: "bekannten Obergrenzen der visuellen Tiers").
 */
export function estimateDefenseScore(profile: StationVisualProfile): number {
  let total = 0;

  for (const [key, tier] of entriesOf(profile.defense)) {
    const maxLvl = tierMaxLevel(tier, key);
    const effect = calculateDefenseUpgradeEffect(key, maxLvl);
    total += effect.reduce((s, e) => s + e.value, 0);
  }

  return total;
}

/**
 * Rough loot estimate from a target station's scale tier.
 * Higher-scale stations have more accumulated resources.
 */
export function estimateLootValue(profile: StationVisualProfile): number {
  // Scale tier approximates total building level → economic development
  switch (profile.scaleTier) {
    case 0:
      return 10;
    case 1:
      return 40;
    case 2:
      return 80;
    case 3:
      return 150;
  }
}

// ---------------------------------------------------------------------------
// Reserve calculation
// ---------------------------------------------------------------------------

/**
 * Reserve ratios per profile (fraction of own fighter attack kept as reserve).
 * Industrialist 70%, Pioneer 60%, Technocrat 60%, Warlord 37.5%
 */
const RESERVE_RATIO: Record<BotProfile, number> = {
  industrialist: 0.7,
  pioneer: 0.6,
  technocrat: 0.6,
  warlord: 0.375,
};

/** Safety margins on estimated target defense per profile (GB-17). */
export const SAFETY_MARGIN: Record<BotProfile, number> = {
  industrialist: 1.4,
  pioneer: 1.3,
  technocrat: 1.25,
  warlord: 1.15,
};

const RECENT_ATTACK_BONUS = 0.15;
const UNSTABLE_COLONY_BONUS = 0.1;
const RESERVE_CAP = 0.9;

/**
 * Calculate the minimum attack power that must be kept at a station as reserve.
 */
export function calculateReserve(
  localFighterAttack: number,
  profile: BotProfile,
  hasRecentAttack: boolean,
  isUnstableColony: boolean
): number {
  return Math.round(localFighterAttack * reserveRatio(profile, hasRecentAttack, isUnstableColony));
}

function reserveRatio(
  profile: BotProfile,
  hasRecentAttack: boolean,
  isUnstableColony: boolean
): number {
  let ratio = RESERVE_RATIO[profile];
  if (hasRecentAttack) ratio += RECENT_ATTACK_BONUS;
  if (isUnstableColony) ratio += UNSTABLE_COLONY_BONUS;
  return Math.min(ratio, RESERVE_CAP);
}

// ---------------------------------------------------------------------------
// Target scoring
// ---------------------------------------------------------------------------

export interface ScoredConflictTarget {
  /** Net score for comparison (higher = better target). */
  score: number;
  breakdown: {
    retaliationValue: number;
    lootValue: number;
    defensePenalty: number;
  };
}

/**
 * Score a potential conflict target.
 * Higher score = more attractive target.
 */
export function scoreConflictTarget(params: {
  distance: number;
  visualProfile: StationVisualProfile;
  hostilityScore: number;
  profile: BotProfile;
  ownAttackPower: number;
}): ScoredConflictTarget {
  const { distance, visualProfile, hostilityScore, profile, ownAttackPower } = params;

  const estimatedDefense = estimateDefenseScore(visualProfile);
  const profileParams = PROFILE_PARAMS[profile];

  // Hostility-based retaliation value
  const retaliationValue =
    hostilityScore >= HOSTILITY_HOSTILE ? 40 : hostilityScore >= HOSTILITY_RIVAL ? 20 : 0;

  const lootValue = estimateLootValue(visualProfile);

  // Distance penalty: closer is better
  const maxDist = 200_000;
  const distancePenalty = Math.round(30 * Math.min(1, distance / maxDist));

  // Defense penalty: don't attack heavily defended targets
  const defensePenalty = Math.round(Math.min(estimatedDefense / 10, 30));

  // Profile aggression multiplier
  const aggressionMultiplier = profileParams.aggressionFactor;

  const rawScore =
    retaliationValue +
    lootValue +
    (ownAttackPower > estimatedDefense ? 15 : 0) - // confidence bonus
    distancePenalty -
    defensePenalty;

  return {
    score: Math.round(rawScore * aggressionMultiplier),
    breakdown: { retaliationValue, lootValue, defensePenalty },
  };
}

// ---------------------------------------------------------------------------
// Available excess attack power
// ---------------------------------------------------------------------------

/**
 * Fighter attack a station needs so that the part above its reserve fits a raid group on
 * `defense`: the margin, rounded up to whole ships of `shipAttack`, plus one for the rounded reserve.
 */
export function raidStrikeAttack(
  defense: number,
  profile: BotProfile,
  shipAttack: number,
  hasRecentAttack: boolean,
  isUnstableColony: boolean
): number {
  const required = Math.max(1, Math.round(defense * SAFETY_MARGIN[profile]));
  const group = shipAttack > 0 ? Math.ceil(required / shipAttack) * shipAttack : required;
  const ratio = reserveRatio(profile, hasRecentAttack, isUnstableColony);
  return Math.ceil((group + 1) / (1 - ratio));
}

/**
 * Calculate how much attack power is available for offensive actions
 * after deducting the local reserve.
 */
export function availableOffensivePower(localFighterAttack: number, reserveAttack: number): number {
  return Math.max(0, localFighterAttack - reserveAttack);
}
