import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import {
  calculateHostility,
  calculateReserve,
  estimateDefenseScore,
  availableOffensivePower,
  SAFETY_MARGIN,
  scoreConflictTarget,
} from '../conflict-intel.js';
import { availableFighterAttack, wasRecentlyAttacked } from './military.js';
import { hasActiveMining, stationModifiers } from './shared.js';

// ---------------------------------------------------------------------------
// Raid & Retaliate
// ---------------------------------------------------------------------------

/** Cooldown durations in ms. */
const COOLDOWN_WIN_MS = 6 * 3_600_000;
const COOLDOWN_LOSS_MS = 24 * 3_600_000;
const COOLDOWN_RETRY_RETALIATION_MS = 1 * 3_600_000;

/** Find the smallest fighter group that can exceed required attack power. */
function smallestSufficientGroup(
  station: StationSnapshot,
  requiredAttack: number
): { spacecraftKey: string; amount: number; totalAttack: number } | null {
  const groups = station.fleets
    .filter((f) => {
      const sc = getSpacecraft(f.spacecraftKey);
      return sc?.role === 'fighter' && f.amount - f.lockedAmount > 0;
    })
    .map((f) => ({
      spacecraftKey: f.spacecraftKey,
      available: f.amount - f.lockedAmount,
      attackPerShip: Math.floor(
        (getSpacecraft(f.spacecraftKey)?.attack ?? 0) * stationModifiers(station).attack
      ),
    }))
    .filter((f) => f.attackPerShip > 0)
    .map((fighter) => {
      const amount = Math.ceil(requiredAttack / fighter.attackPerShip);
      return {
        spacecraftKey: fighter.spacecraftKey,
        amount,
        available: fighter.available,
        totalAttack: amount * fighter.attackPerShip,
      };
    })
    .filter((group) => group.amount <= group.available)
    .sort(
      (left, right) =>
        left.amount - right.amount ||
        left.totalAttack - right.totalAttack ||
        left.spacecraftKey.localeCompare(right.spacecraftKey)
    );

  const group = groups[0];
  return group
    ? {
        spacecraftKey: group.spacecraftKey,
        amount: group.amount,
        totalAttack: group.totalAttack,
      }
    : null;
}

export function isEligibleAttackSource(
  state: GoalBotState,
  station: StationSnapshot,
  targetStationId: string,
  profile: BotProfile
): boolean {
  const target = state.visibleStations.find((candidate) => candidate.id === targetStationId);
  if (!target) return false;
  const availableAttack = availableFighterAttack(station);
  const reserve = calculateReserve(
    availableAttack,
    profile,
    wasRecentlyAttacked(state, station, state.now),
    !hasActiveMining(station)
  );
  const requiredAttack = Math.max(
    1,
    Math.round(estimateDefenseScore(target.visualProfile) * SAFETY_MARGIN[profile])
  );
  const group = smallestSufficientGroup(station, requiredAttack);
  return group !== null && group.totalAttack <= availableOffensivePower(availableAttack, reserve);
}

/** Own station with an unresolved attack on one of the given stations, and that attack. */
function activeAttack(state: GoalBotState, targetStationIds: readonly string[]) {
  for (const station of state.ownStations) {
    const mission = station.combatMissions.find((candidate) =>
      targetStationIds.includes(candidate.defenderStationId)
    );
    if (mission) return { station, mission };
  }
  return undefined;
}

const nearestTo = (target: { x: number; y: number }) => (a: StationSnapshot, b: StationSnapshot) =>
  Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y) ||
  a.id.localeCompare(b.id);

/** Raid source: the station already attacking the target, else the nearest eligible one. */
export function raidSource(
  state: GoalBotState,
  targetStationId: string,
  profile: BotProfile
): StationSnapshot | undefined {
  const attacking = activeAttack(state, [targetStationId]);
  if (attacking) return attacking.station;
  const target = state.visibleStations.find((station) => station.id === targetStationId);
  if (!target) return undefined;
  return state.ownStations
    .filter((station) => isEligibleAttackSource(state, station, targetStationId, profile))
    .sort(nearestTo(target))[0];
}

/**
 * Retaliation source: the station already attacking one of the owner's visible stations, else the
 * eligible station nearest to one of them, more free attack breaking ties.
 */
export function retaliationSource(
  state: GoalBotState,
  ownerId: string,
  profile: BotProfile
): StationSnapshot | undefined {
  const targets = state.visibleStations.filter(
    (station) => station.ownerId === ownerId && !station.isOwn
  );
  const attacking = activeAttack(
    state,
    targets.map((target) => target.id)
  );
  if (attacking) return attacking.station;
  const distance = (station: StationSnapshot) =>
    Math.min(
      ...targets
        .filter((target) => isEligibleAttackSource(state, station, target.id, profile))
        .map((target) => Math.hypot(station.x - target.x, station.y - target.y))
    );
  return state.ownStations
    .filter((station) => Number.isFinite(distance(station)))
    .sort(
      (a, b) =>
        distance(a) - distance(b) ||
        availableFighterAttack(b) - availableFighterAttack(a) ||
        a.id.localeCompare(b.id)
    )[0];
}

/**
 * Check if this station has attacked the given owner recently (cooldown). `ownAttack` tells
 * whether the newest report is the bot's own attack.
 */
function hasCooldown(
  state: GoalBotState,
  ownerId: string,
  now: Date
): { onCooldown: boolean; ownAttack?: boolean; reason?: string } {
  const relevant = state.combatReports.filter(
    (r) =>
      (r.attackerUserId === state.userId || r.defenderUserId === state.userId) &&
      (r.attackerUserId === ownerId || r.defenderUserId === ownerId)
  );
  const last = [...relevant].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  if (!last) return { onCooldown: false };

  const elapsed = now.getTime() - new Date(last.createdAt).getTime();
  const isAttacker = last.attackerUserId === state.userId;

  if (isAttacker && last.winner === 'attacker') {
    if (elapsed < COOLDOWN_WIN_MS) {
      return {
        onCooldown: true,
        ownAttack: true,
        reason: `Cooldown after won attack (${Math.round((COOLDOWN_WIN_MS - elapsed) / 60_000)}min remaining)`,
      };
    }
  } else if (isAttacker && last.winner !== 'attacker') {
    if (elapsed < COOLDOWN_LOSS_MS) {
      return {
        onCooldown: true,
        ownAttack: true,
        reason: `Cooldown after lost attack (${Math.round((COOLDOWN_LOSS_MS - elapsed) / 60_000)}min remaining)`,
      };
    }
  } else if (!isAttacker) {
    const hasRetaliated = relevant.some(
      (r) => r.attackerUserId === state.userId && r.defenderUserId === ownerId
    );
    if (hasRetaliated && elapsed < COOLDOWN_WIN_MS) {
      return { onCooldown: true, reason: `Already retaliated recently` };
    }
    if (elapsed < COOLDOWN_RETRY_RETALIATION_MS) {
      return {
        onCooldown: true,
        reason: `Recent attack, waiting for retaliation window (${Math.round((COOLDOWN_RETRY_RETALIATION_MS - elapsed) / 60_000)}min)`,
      };
    }
  }

  return { onCooldown: false };
}

/** Generate raid candidates for visible foreign stations. */
export function generateRaidCandidates(state: GoalBotState, _profile: BotProfile): GoalCandidate[] {
  const candidates = new Map<string, GoalCandidate>();
  const now = state.now;

  for (const station of state.ownStations) {
    const availableAttack = availableFighterAttack(station);
    const reserve = calculateReserve(
      availableAttack,
      _profile,
      wasRecentlyAttacked(state, station, now),
      !hasActiveMining(station)
    );
    const offensive = availableOffensivePower(availableAttack, reserve);
    if (offensive <= 0) continue;

    for (const target of state.visibleStations) {
      if (target.isOwn) continue;
      if (state.blockedRaidOwners?.has(target.ownerId)) continue;
      if (!isEligibleAttackSource(state, station, target.id, _profile)) continue;

      const cooldown = hasCooldown(state, target.ownerId, now);
      if (cooldown.onCooldown) continue;

      const dist = Math.hypot(target.x - station.x, target.y - station.y);
      const hostility = calculateHostility(state.userId, state.combatReports, now, target.ownerId);
      const scored = scoreConflictTarget({
        distance: dist,
        visualProfile: target.visualProfile,
        hostilityScore: hostility,
        profile: _profile,
        ownAttackPower: offensive,
      });
      if (scored.score <= 0) continue;

      const candidate: GoalCandidate = {
        goalType: 'raid',
        category: GOAL_CATEGORY.raid,
        targetRef: `station:${target.id}`,
        baseNeed: Math.min(scored.score, 100),
        opportunity: scored.breakdown.lootValue,
        longTermValue: Math.round(scored.breakdown.retaliationValue / 2),
        commitment: 0,
        cost: Math.round(scored.breakdown.defensePenalty / 2),
        risk: Math.round(scored.breakdown.defensePenalty),
        blockers: 0,
      };
      const existing = candidates.get(candidate.targetRef);
      if (
        !existing ||
        candidate.baseNeed + candidate.opportunity - candidate.risk >
          existing.baseNeed + existing.opportunity - existing.risk
      ) {
        candidates.set(candidate.targetRef, candidate);
      }
    }
  }

  return [...candidates.values()];
}

export type ConflictOpportunityStage =
  | 'no_visible_target'
  | 'target_protected'
  | 'target_on_cooldown'
  | 'insufficient_fleet_or_reserve'
  | 'non_positive_target_score'
  | 'viable_target';

export interface ConflictOpportunitySnapshot {
  visibleTargets: number;
  eligibleAfterProtectionAndCooldown: number;
  sufficientFleetAndReserve: number;
  viableTargets: number;
  lastExclusionStage: ConflictOpportunityStage;
}

/**
 * Explain how far visible raid targets progressed through the authoritative filters.
 * This is diagnostic-only and deliberately separate from candidate generation.
 */
export function analyzeConflictOpportunities(
  state: GoalBotState,
  profile: BotProfile
): ConflictOpportunitySnapshot {
  const visibleTargets = state.visibleStations.filter((target) => !target.isOwn);
  if (visibleTargets.length === 0) {
    return {
      visibleTargets: 0,
      eligibleAfterProtectionAndCooldown: 0,
      sufficientFleetAndReserve: 0,
      viableTargets: 0,
      lastExclusionStage: 'no_visible_target',
    };
  }

  const protectedOwnerIds = new Set(state.conflictDiagnostics.protectedOwnerIds);
  const eligibleTargets = [];
  let protectedTargets = 0;
  let cooldownTargets = 0;
  for (const target of visibleTargets) {
    if (protectedOwnerIds.has(target.ownerId)) {
      protectedTargets += 1;
      continue;
    }
    const cooldown = hasCooldown(state, target.ownerId, state.now);
    if (cooldown.onCooldown) {
      cooldownTargets += 1;
      continue;
    }
    eligibleTargets.push(target);
  }

  const sufficientlyPowered = eligibleTargets.filter((target) =>
    state.ownStations.some((station) => isEligibleAttackSource(state, station, target.id, profile))
  );
  const viableTargetIds = new Set(
    generateRaidCandidates(state, profile).map((candidate) => candidate.targetRef.slice(8))
  );
  const viableTargets = sufficientlyPowered.filter((target) =>
    viableTargetIds.has(target.id)
  ).length;

  let lastExclusionStage: ConflictOpportunityStage;
  if (viableTargets > 0) lastExclusionStage = 'viable_target';
  else if (sufficientlyPowered.length > 0) lastExclusionStage = 'non_positive_target_score';
  else if (eligibleTargets.length > 0) lastExclusionStage = 'insufficient_fleet_or_reserve';
  else if (cooldownTargets > 0) lastExclusionStage = 'target_on_cooldown';
  else if (protectedTargets > 0) lastExclusionStage = 'target_protected';
  else lastExclusionStage = 'no_visible_target';

  return {
    visibleTargets: visibleTargets.length,
    eligibleAfterProtectionAndCooldown: eligibleTargets.length,
    sufficientFleetAndReserve: sufficientlyPowered.length,
    viableTargets,
    lastExclusionStage,
  };
}

/** Generate retaliation candidates from combat reports. */
export function generateRetaliateCandidates(
  state: GoalBotState,
  _profile: BotProfile
): GoalCandidate[] {
  const candidates = new Map<string, GoalCandidate>();
  const now = state.now;
  const recentCutoff = now.getTime() - 24 * 3_600_000;

  const attackerIds = new Set<string>();
  for (const report of state.combatReports) {
    if (
      report.defenderUserId === state.userId &&
      new Date(report.createdAt).getTime() >= recentCutoff
    ) {
      attackerIds.add(report.attackerUserId);
    }
  }

  for (const station of state.ownStations) {
    const availableAttack = availableFighterAttack(station);
    const reserve = calculateReserve(
      availableAttack,
      _profile,
      wasRecentlyAttacked(state, station, now),
      !hasActiveMining(station)
    );
    const offensive = availableOffensivePower(availableAttack, reserve);
    if (offensive <= 0) continue;

    for (const ownerId of attackerIds) {
      if (state.blockedRaidOwners?.has(ownerId)) continue;
      const target = state.visibleStations.find((s) => s.ownerId === ownerId && !s.isOwn);
      if (!target) continue;
      if (!isEligibleAttackSource(state, station, target.id, _profile)) continue;

      const cooldown = hasCooldown(state, ownerId, now);
      if (cooldown.onCooldown) continue;

      const dist = Math.hypot(target.x - station.x, target.y - station.y);
      const hostility = calculateHostility(state.userId, state.combatReports, now, ownerId);
      const scored = scoreConflictTarget({
        distance: dist,
        visualProfile: target.visualProfile,
        hostilityScore: hostility,
        profile: _profile,
        ownAttackPower: offensive,
      });

      const candidate: GoalCandidate = {
        goalType: 'retaliate',
        category: GOAL_CATEGORY.retaliate,
        targetRef: `user:${ownerId}`,
        baseNeed: Math.min(scored.score + 20, 100),
        opportunity: scored.breakdown.lootValue,
        longTermValue: 50,
        commitment: 0,
        cost: Math.round(scored.breakdown.defensePenalty / 2),
        risk: Math.round(scored.breakdown.defensePenalty),
        blockers: 0,
      };
      const existing = candidates.get(candidate.targetRef);
      if (
        !existing ||
        candidate.baseNeed + candidate.opportunity - candidate.risk >
          existing.baseNeed + existing.opportunity - existing.risk
      ) {
        candidates.set(candidate.targetRef, candidate);
      }
    }
  }

  return [...candidates.values()];
}

/** Execute a raid against a visible target station. */
export async function stepRaid(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  profile: BotProfile
): Promise<GoalResult> {
  const [, targetStationId = ''] = targetRef.split(':');

  const attack = activeAttack(_state, [targetStationId]);
  if (attack) {
    return {
      type: 'waiting',
      reason: `Attack on ${targetStationId} from ${attack.station.name} is ${attack.mission.status}`,
    };
  }

  const attackPower = availableFighterAttack(station);
  if (attackPower <= 0) {
    return {
      type: 'blocked',
      reason: `No fighter attack power at ${station.name}`,
    };
  }

  const target = _state.visibleStations.find((s) => s.id === targetStationId);
  if (!target) {
    return {
      type: 'blocked',
      reason: `Target station ${targetStationId} not visible`,
    };
  }

  const cooldown = hasCooldown(_state, target.ownerId, _state.now);
  if (cooldown.onCooldown) {
    // Only the bot's own attack finishes the raid; a cooldown from being attacked only delays it.
    return cooldown.ownAttack
      ? {
          type: 'complete',
          goalType: 'raid',
          targetRef,
          reason: cooldown.reason ?? `Attack on ${targetStationId} completed`,
        }
      : { type: 'waiting', reason: cooldown.reason ?? `Raid on ${targetStationId} delayed` };
  }

  const estimatedDefense = estimateDefenseScore(target.visualProfile);
  const margin = SAFETY_MARGIN[profile];
  const requiredAttack = Math.max(1, Math.round(estimatedDefense * margin));

  const reserve = calculateReserve(
    attackPower,
    profile,
    wasRecentlyAttacked(_state, station, _state.now),
    !hasActiveMining(station)
  );
  const offensive = availableOffensivePower(attackPower, reserve);
  if (offensive <= 0) {
    return {
      type: 'blocked',
      reason: `All ${attackPower} attack power reserved (need ${reserve} reserve)`,
    };
  }

  const group = smallestSufficientGroup(station, requiredAttack);
  if (!group || group.totalAttack > offensive) {
    return {
      type: 'saving',
      reason: `Need ${requiredAttack} attack to breach ${estimatedDefense} defense, have ${offensive} offensive power`,
    };
  }

  // Docked bombers join the raid; they only add integrity damage if the fighters win.
  const fleet: Record<string, number> = { [group.spacecraftKey]: group.amount };
  for (const row of station.fleets) {
    const available = row.amount - row.lockedAmount;
    if (getSpacecraft(row.spacecraftKey)?.role === 'bomber' && available > 0) {
      fleet[row.spacecraftKey] = available;
    }
  }
  const composition = Object.entries(fleet)
    .map(([key, amount]) => `${amount}x ${key}`)
    .join(', ');

  return {
    type: 'success',
    intent: {
      type: 'start_attack',
      stationId: station.id,
      targetStationId,
      fleet,
    },
    reason: `Attacking ${target.name || targetStationId} with ${composition} (${group.totalAttack} attack vs est. ${estimatedDefense} defense)`,
  };
}

/** Execute a retaliation against a known attacker. */
export async function stepRetaliate(
  _state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  profile: BotProfile
): Promise<GoalResult> {
  const [, ownerId = ''] = targetRef.split(':');
  const ownerStations = _state.visibleStations.filter(
    (candidate) => candidate.ownerId === ownerId && !candidate.isOwn
  );

  // Launched fighters are locked, so no source stays eligible until the attack resolves.
  const attack = activeAttack(
    _state,
    ownerStations.map((candidate) => candidate.id)
  );
  if (attack) {
    return {
      type: 'waiting',
      reason: `Retaliation on ${ownerId} from ${attack.station.name} is ${attack.mission.status}`,
    };
  }
  const cooldown = hasCooldown(_state, ownerId, _state.now);
  if (cooldown.onCooldown && cooldown.ownAttack) {
    return {
      type: 'complete',
      goalType: 'retaliate',
      targetRef,
      reason: cooldown.reason ?? `Retaliation on ${ownerId} completed`,
    };
  }

  const target = ownerStations
    .filter((candidate) => isEligibleAttackSource(_state, station, candidate.id, profile))
    .sort((a, b) => {
      const distanceA = Math.hypot(a.x - station.x, a.y - station.y);
      const distanceB = Math.hypot(b.x - station.x, b.y - station.y);
      return distanceA - distanceB || a.id.localeCompare(b.id);
    })[0];
  if (!target) {
    return {
      type: 'blocked',
      reason: `No visible station for attacker ${ownerId}`,
    };
  }

  return stepRaid(_state, station, `station:${target.id}`, profile);
}
