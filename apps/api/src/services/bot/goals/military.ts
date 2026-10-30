import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import {
  getSpacecraft,
  calculateDefenseUpgradeCost,
  calculateDefenseUpgradeEffect,
  getDefenseUpgrade,
  requirementBlockers,
  spacecrafts,
} from '@orions-frontier/game-config';
import { type DefenseUpgradeKey } from '@orions-frontier/shared';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import {
  assignMinerTowardCosts,
  buildingUpgradeCost,
  canAcquireCosts,
  canAfford,
  freeCrewCapacity,
  getShipyardLevel,
  hasActiveMining,
  stationBuildingLevels,
  stationModifiers,
} from './shared.js';

// ---------------------------------------------------------------------------
// Defense & Strike Force
// ---------------------------------------------------------------------------

const TARGET_DEFENSE_SCORE = 50;
const TARGET_STRIKE_ATTACK = 80;

/** Defense score as combat counts it: defense upgrades times Shield Technology. */
function defenseScore(station: StationSnapshot): number {
  return (
    station.defense.reduce((sum, d) => {
      const effect = calculateDefenseUpgradeEffect(d.upgradeKey, d.level);
      return sum + effect.reduce((s, e) => s + e.value, 0);
    }, 0) * stationModifiers(station).stationDefense
  );
}

/** Available defense upgrades that can still be raised. */
function upgradeableDefenses(
  station: StationSnapshot
): { upgradeKey: DefenseUpgradeKey; level: number }[] {
  const buildings = stationBuildingLevels(station);
  return station.defense.filter((d) => {
    const def = getDefenseUpgrade(d.upgradeKey);
    return (
      d.level < def.maxLevel &&
      d.upgradeEndsAt === null &&
      requirementBlockers(def.requirements, station.research, buildings).length === 0
    );
  });
}

/** Total attack power of all fighters owned + in build at this station. */
function localFighterAttack(station: StationSnapshot): number {
  const analyticsFactor = stationModifiers(station).attack;
  const fleetPower = station.fleets
    .filter((f) => {
      const sc = getSpacecraft(f.spacecraftKey);
      return sc?.role === 'fighter';
    })
    .reduce(
      (sum, f) => sum + f.amount * (getSpacecraft(f.spacecraftKey)?.attack ?? 0) * analyticsFactor,
      0
    );
  const buildPower = station.builds
    .filter((b) => {
      const sc = getSpacecraft(b.spacecraftKey);
      return sc?.role === 'fighter';
    })
    .reduce(
      (sum, b) => sum + b.amount * (getSpacecraft(b.spacecraftKey)?.attack ?? 0) * analyticsFactor,
      0
    );
  return Math.floor(fleetPower + buildPower);
}

export function availableFighterAttack(station: StationSnapshot): number {
  const analyticsFactor = stationModifiers(station).attack;
  return Math.floor(
    station.fleets.reduce((sum, fleet) => {
      const spacecraft = getSpacecraft(fleet.spacecraftKey);
      return spacecraft?.role === 'fighter'
        ? sum + (fleet.amount - fleet.lockedAmount) * spacecraft.attack * analyticsFactor
        : sum;
    }, 0)
  );
}

export function wasRecentlyAttacked(
  state: GoalBotState,
  station: StationSnapshot,
  now: Date
): boolean {
  const cutoff = now.getTime() - 24 * 3_600_000;
  return state.combatReports.some(
    (report) =>
      report.defenderUserId === state.userId &&
      report.defenderStationId === station.id &&
      new Date(report.createdAt).getTime() >= cutoff
  );
}

/** Fighter types the station can build with its buildings and the owner's research. */
export function unlockedFighters(station: StationSnapshot): { key: string; attack: number }[] {
  const buildings = stationBuildingLevels(station);
  return spacecrafts
    .filter(
      (definition) =>
        definition.role === 'fighter' &&
        requirementBlockers(definition.requirements, station.research, buildings).length === 0
    )
    .map((definition) => ({ key: definition.key, attack: definition.attack }));
}

/** Choose the best defense upgrade by defense gain per cost. */
export function bestDefenseUpgrade(
  station: StationSnapshot,
  state?: GoalBotState
): { upgradeKey: DefenseUpgradeKey; targetLevel: number; gain: number } | null {
  const candidates = upgradeableDefenses(station);
  if (candidates.length === 0) return null;

  let best: {
    upgradeKey: DefenseUpgradeKey;
    targetLevel: number;
    gain: number;
    score: number;
  } | null = null;

  for (const d of candidates) {
    const targetLevel = d.level + 1;
    const currentEffect = calculateDefenseUpgradeEffect(d.upgradeKey, d.level);
    const nextEffect = calculateDefenseUpgradeEffect(d.upgradeKey, targetLevel);
    const gain =
      nextEffect.reduce((s, e) => s + e.value, 0) - currentEffect.reduce((s, e) => s + e.value, 0);
    const costs = calculateDefenseUpgradeCost(d.upgradeKey, targetLevel);
    if (state && !canAfford(station, costs) && !canAcquireCosts(state, station, costs)) continue;
    const totalCost = costs.reduce((s, c) => s + c.amount, 0);
    const costWeight = totalCost > 0 ? gain / totalCost : gain;
    const score = gain * 10 + costWeight * 100;

    if (!best || score > best.score) {
      best = { upgradeKey: d.upgradeKey, targetLevel, gain, score };
    }
  }

  return best
    ? { upgradeKey: best.upgradeKey, targetLevel: best.targetLevel, gain: best.gain }
    : null;
}

/** Check if station has a shipyard at least at the given level. */
function hasShipyardLevel(station: StationSnapshot, level: number): boolean {
  return getShipyardLevel(station) >= level;
}

// ---------------------------------------------------------------------------
// Fortify generators & steps
// ---------------------------------------------------------------------------

export function generateFortifyCandidate(
  _state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  const current = defenseScore(station);
  if (current >= TARGET_DEFENSE_SCORE) return null;
  if (!bestDefenseUpgrade(station, _state)) return null;

  // Higher base need for new colonies, recently attacked, or valuable stations
  const isNewColony = !hasActiveMining(station);
  const totalBuildings = station.buildings.filter((b) => b.level > 0).length;
  const valueFactor = Math.min(totalBuildings / 10, 1);

  let baseNeed = 30;
  if (isNewColony) baseNeed += 20;
  if (wasRecentlyAttacked(_state, station, _state.now)) baseNeed += 25;
  if (totalBuildings > 5) baseNeed += 15;
  baseNeed += Math.round((1 - current / TARGET_DEFENSE_SCORE) * 30);

  return {
    goalType: 'fortify_station',
    category: GOAL_CATEGORY.fortify_station,
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: 10,
    longTermValue: Math.round(30 * valueFactor),
    commitment: 0,
    cost: 15,
    risk: 5,
    blockers: 0,
  };
}

export async function stepFortifyStation(
  _state: GoalBotState,
  station: StationSnapshot,
  _targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const current = defenseScore(station);
  if (current >= TARGET_DEFENSE_SCORE) {
    return {
      type: 'complete',
      goalType: 'fortify_station',
      targetRef: `station:${station.id}`,
      reason: `Station defense ${current} meets target ${TARGET_DEFENSE_SCORE}`,
    };
  }

  const best = bestDefenseUpgrade(station, _state);
  if (!best) {
    return {
      type: 'blocked',
      detail: 'no_upgradeable_defense',
      reason: `All defenses at max level or upgrading`,
    };
  }

  // Check if already upgrading this defense
  const isUpgradingDef = station.defense.some(
    (d) => d.upgradeKey === best.upgradeKey && d.upgradeEndsAt !== null
  );
  if (isUpgradingDef) {
    return {
      type: 'waiting',
      detail: 'defense_upgrading',
      reason: `Defense ${best.upgradeKey} upgrading to level ${best.targetLevel}`,
    };
  }

  const costs = calculateDefenseUpgradeCost(best.upgradeKey, best.targetLevel);
  if (!canAfford(station, costs)) {
    const supply = assignMinerTowardCosts(
      _state,
      station,
      costs,
      `${best.upgradeKey} level ${best.targetLevel}`
    );
    if (supply) return supply;
    return {
      type: 'saving',
      detail: 'defense_cost',
      reason: `Saving resources for ${best.upgradeKey} level ${best.targetLevel} (+${best.gain} defense)`,
    };
  }

  return {
    type: 'success',
    intent: {
      type: 'upgrade_defense',
      stationId: station.id,
      upgradeKey: best.upgradeKey,
    },
    reason: `Upgrading ${best.upgradeKey} to level ${best.targetLevel} (+${best.gain} defense)`,
  };
}

// ---------------------------------------------------------------------------
// Strike Force generators & steps
// ---------------------------------------------------------------------------

export function generateBuildStrikeForceCandidate(
  _state: GoalBotState,
  station: StationSnapshot
): GoalCandidate | null {
  const unlocked = unlockedFighters(station);
  if (unlocked.length === 0) return null;
  if (
    !unlocked.some((fighter) => {
      const costs = getSpacecraft(fighter.key)?.costs ?? [];
      return canAfford(station, costs) || canAcquireCosts(_state, station, costs);
    })
  ) {
    return null;
  }

  const current = localFighterAttack(station);
  if (current >= TARGET_STRIKE_ATTACK) return null;

  // Higher need for warlord, or if station was recently attacked
  const isNewColony = !hasActiveMining(station);
  let baseNeed = 30;
  if (!isNewColony) baseNeed += 10; // Established stations more likely to build force
  baseNeed += Math.round((1 - current / TARGET_STRIKE_ATTACK) * 30);

  return {
    goalType: 'build_strike_force',
    category: GOAL_CATEGORY.build_strike_force,
    targetRef: `station:${station.id}`,
    baseNeed,
    opportunity: 15,
    longTermValue: 40,
    commitment: 0,
    cost: 25,
    risk: 10,
    blockers: 0,
  };
}

export async function stepBuildStrikeForce(
  _state: GoalBotState,
  station: StationSnapshot,
  _targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  const current = localFighterAttack(station);
  if (current >= TARGET_STRIKE_ATTACK) {
    return {
      type: 'complete',
      goalType: 'build_strike_force',
      targetRef: `station:${station.id}`,
      reason: `Fighter attack ${current} meets target ${TARGET_STRIKE_ATTACK}`,
    };
  }

  // Missing research ends the goal so the research goal can pick up the unlock.
  if (unlockedFighters(station).length === 0 && hasShipyardLevel(station, 2)) {
    return { type: 'blocked', detail: 'research_locked', reason: 'Fighters need research' };
  }
  // Need shipyard level 2 for first fighter
  if (!hasShipyardLevel(station, 2)) {
    // Check if shipyard can be upgraded
    const shipyard = station.buildings.find((b) => b.buildingKey === 'shipyard');
    if (shipyard?.upgradeEndsAt === null) {
      if (!canAfford(station, buildingUpgradeCost(station, 'shipyard'))) {
        return {
          type: 'saving',
          detail: 'shipyard_cost',
          reason: `Saving for Shipyard level ${shipyard.level + 1}`,
        };
      }
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'shipyard' },
        reason: `Building Shipyard to level ${shipyard.level + 1} for fighter unlock`,
      };
    }
    if (shipyard) {
      return {
        type: 'waiting',
        detail: 'shipyard_upgrading',
        reason: `Shipyard upgrading for fighter unlock`,
      };
    }
    return {
      type: 'blocked',
      detail: 'no_shipyard',
      reason: `Shipyard level too low for fighters`,
    };
  }

  // If shipyard already at level 2+, check hangar capacity
  const crewCapacity = freeCrewCapacity(station);
  if (crewCapacity <= 0) {
    // Try upgrading hangar
    const hangar = station.buildings.find((b) => b.buildingKey === 'hangar');
    if (hangar?.upgradeEndsAt === null) {
      if (!canAfford(station, buildingUpgradeCost(station, 'hangar'))) {
        return {
          type: 'saving',
          detail: 'hangar_cost',
          reason: `Saving for Hangar level ${hangar.level + 1}`,
        };
      }
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: station.id, buildingKey: 'hangar' },
        reason: `Building Hangar to level ${hangar.level + 1} for more crew capacity`,
      };
    }
    if (hangar) {
      return {
        type: 'waiting',
        detail: 'hangar_upgrading',
        reason: `Hangar upgrading for crew capacity`,
      };
    }
    return {
      type: 'blocked',
      detail: 'no_hangar_capacity',
      reason: `No crew capacity for more fighters`,
    };
  }

  // Pick the best fighter: best attack per crew ratio among unlocked, affordable types
  const unlocked = unlockedFighters(station);
  let best: { key: string; attack: number } | null = null;

  for (const f of unlocked) {
    const sc = getSpacecraft(f.key);
    if (!sc) continue;
    const costs = sc.costs;
    if (!canAfford(station, costs)) continue;
    const maxCount = Math.min(
      Math.floor(crewCapacity / sc.crew),
      1 // Build one at a time
    );
    if (maxCount < 1) continue;
    const efficiency = sc.attack / sc.crew;
    if (!best || efficiency > best.attack / (getSpacecraft(best.key)?.crew ?? 1)) {
      best = { key: f.key, attack: sc.attack };
    }
  }

  if (!best) {
    const reachable = unlocked
      .flatMap((fighter) => {
        const definition = getSpacecraft(fighter.key);
        return definition ? [definition] : [];
      })
      .filter((fighter) => fighter.crew <= crewCapacity)
      .filter(
        (fighter) =>
          canAcquireCosts(_state, station, fighter.costs) && !canAfford(station, fighter.costs)
      )
      .sort(
        (left, right) =>
          right.attack / right.crew - left.attack / left.crew || left.key.localeCompare(right.key)
      )[0];
    if (!reachable) {
      return {
        type: 'blocked',
        detail: 'fighter_resources',
        reason: `No unlocked fighter has a reachable resource path at ${station.name}`,
      };
    }
    const supply = assignMinerTowardCosts(
      _state,
      station,
      reachable.costs,
      `${reachable.name} strike force`
    );
    if (supply) return supply;
    return {
      type: 'saving',
      detail: 'fighter_cost',
      reason: `Saving for ${reachable.key} at ${station.name}`,
    };
  }

  return {
    type: 'success',
    intent: {
      type: 'build_spacecraft',
      stationId: station.id,
      spacecraftKey: best.key,
      amount: 1,
    },
    reason: `Building 1 ${best.key} (attack ${best.attack}, crew ${getSpacecraft(best.key)?.crew})`,
  };
}
