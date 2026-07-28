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
import { PROFILE_PARAMS } from './bot-profiles.js';

// ---------------------------------------------------------------------------
// Hostility
// ---------------------------------------------------------------------------

export type HostilityLabel = 'neutral' | 'rival' | 'hostile';

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
export function calculateHostility(userId: string, reports: CombatReport[], now: Date): number {
  let score = 0;
  let lastActivity: number | null = null;

  for (const report of reports) {
    const createdAt = new Date(report.createdAt).getTime();

    if (report.defenderUserId === userId) {
      // Incoming attack
      score += HOSTILITY_PER_ATTACK;
      if (lastActivity === null || createdAt > lastActivity) lastActivity = createdAt;
    } else if (report.attackerUserId === userId && report.winner === 'attacker') {
      // Successful retaliation — reduces hostility
      score -= HOSTILITY_RETALIATION_REDUCTION;
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

/** Map a numeric hostility score to a label. */
export function hostilityLabel(score: number): HostilityLabel {
  if (score >= HOSTILITY_HOSTILE) return 'hostile';
  if (score >= HOSTILITY_RIVAL) return 'rival';
  return 'neutral';
}

/** Check if a target is hostile enough to consider conflict actions. */
export function isSignificantHostility(score: number): boolean {
  return score >= HOSTILITY_RIVAL;
}

// ---------------------------------------------------------------------------
// Target defense estimation (public data only)
// ---------------------------------------------------------------------------

/**
 * Upper-bound level for each visual tier.
 * Tier 0 = 0, Tier 1 = 4, Tier 2 = 9, Tier 3 = max level of the upgrade.
 */
function tierMaxLevel(tier: number, upgradeKey: string): number {
  switch (tier) {
    case 0:
      return 0;
    case 1:
      return 4;
    case 2:
      return 9;
    case 3:
      return getDefenseUpgrade(upgradeKey as DefenseUpgradeKey).maxLevel;
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

  for (const [key, tier] of Object.entries(profile.defense)) {
    const maxLvl = tierMaxLevel(tier as number, key);
    const effect = calculateDefenseUpgradeEffect(key as DefenseUpgradeKey, maxLvl);
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
  let ratio = RESERVE_RATIO[profile];
  if (hasRecentAttack) ratio += RECENT_ATTACK_BONUS;
  if (isUnstableColony) ratio += UNSTABLE_COLONY_BONUS;
  ratio = Math.min(ratio, RESERVE_CAP);
  return Math.round(localFighterAttack * ratio);
}

// ---------------------------------------------------------------------------
// Target scoring
// ---------------------------------------------------------------------------

export interface ScoredConflictTarget {
  targetStationId: string;
  ownerId: string;
  distance: number;
  hostilityScore: number;
  hostilityLabel: HostilityLabel;
  estimatedDefense: number;
  estimatedLoot: number;
  reserveAttack: number;
  /** Net score for comparison (higher = better target). */
  score: number;
  breakdown: {
    retaliationValue: number;
    lootValue: number;
    distancePenalty: number;
    defensePenalty: number;
    aggressionMultiplier: number;
    affinityBonus: number;
  };
}

/**
 * Score a potential conflict target.
 * Higher score = more attractive target.
 */
export function scoreConflictTarget(params: {
  targetStationId: string;
  ownerId: string;
  distance: number;
  visualProfile: StationVisualProfile;
  hostilityScore: number;
  profile: BotProfile;
  ownAttackPower: number;
  botUserId: string;
}): ScoredConflictTarget {
  const {
    targetStationId,
    ownerId,
    distance,
    visualProfile,
    hostilityScore,
    profile,
    ownAttackPower,
    botUserId,
  } = params;

  const estimatedDefense = estimateDefenseScore(visualProfile);
  const estimatedLoot = estimateLootValue(visualProfile);
  const label = hostilityLabel(hostilityScore);
  const profileParams = PROFILE_PARAMS[profile];

  // Hostility-based retaliation value
  const retaliationValue =
    hostilityScore >= HOSTILITY_HOSTILE ? 40 : hostilityScore >= HOSTILITY_RIVAL ? 20 : 0;

  // Loot value
  const lootValue = estimatedLoot;

  // Distance penalty: closer is better
  const maxDist = 200_000;
  const distancePenalty = Math.round(30 * Math.min(1, distance / maxDist));

  // Defense penalty: don't attack heavily defended targets
  const defensePenalty = Math.round(Math.min(estimatedDefense / 10, 30));

  // Profile aggression multiplier
  const aggressionMultiplier = profileParams.aggressionFactor;

  // Stable affinity to break ties — derived from XOR of both IDs
  const affinityRaw =
    (botUserId.charCodeAt(0) ^ ownerId.charCodeAt(0)) +
    (botUserId.charCodeAt(botUserId.length - 1) ^ ownerId.charCodeAt(ownerId.length - 1));
  const affinityBonus = (affinityRaw % 5) / 100; // 0–0.04 fractional tie-breaker

  const rawScore =
    retaliationValue +
    lootValue +
    (ownAttackPower > estimatedDefense ? 15 : 0) - // confidence bonus
    distancePenalty -
    defensePenalty;

  const score = Math.round(rawScore * aggressionMultiplier + affinityBonus);

  return {
    targetStationId,
    ownerId,
    distance,
    hostilityScore,
    hostilityLabel: label,
    estimatedDefense,
    estimatedLoot,
    reserveAttack: 0, // filled by caller if needed
    score,
    breakdown: {
      retaliationValue,
      lootValue,
      distancePenalty,
      defensePenalty,
      aggressionMultiplier,
      affinityBonus,
    },
  };
}

// ---------------------------------------------------------------------------
// Available excess attack power
// ---------------------------------------------------------------------------

/**
 * Calculate how much attack power is available for offensive actions
 * after deducting the local reserve.
 */
export function availableOffensivePower(localFighterAttack: number, reserveAttack: number): number {
  return Math.max(0, localFighterAttack - reserveAttack);
}
