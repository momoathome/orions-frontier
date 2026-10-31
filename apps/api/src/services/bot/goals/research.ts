import type { BotProfile } from '../../../lib/db/schema/bot-controllers.js';
import {
  calculateResearchCost,
  getBuilding,
  getResearchDefinition,
  requirementBlockers,
  researchBlockers,
  researchDefinitions,
  researchModifiers,
  requireSpacecraft,
} from '@orions-frontier/game-config';
import type {
  BuildingKey,
  BuildingLevels,
  RequirementBlocker,
  ResearchKey,
  ResearchLane,
} from '@orions-frontier/shared';
import type { GoalBotState, StationSnapshot, GoalResult } from '../goal-state.js';
import type { GoalCandidate } from '../goal-driven-v1.js';
import { GOAL_CATEGORY } from '../goal-driven-v1.js';
import { unlockedFighters } from './military.js';
import {
  assignMinerTowardCosts,
  buildingUpgradeCost,
  canAcquireCosts,
  canAfford,
  hasActiveMining,
  isUpgrading,
  stationBuildingLevels,
} from './shared.js';

// ---------------------------------------------------------------------------
// Research goal — candidate generation and step execution
// ---------------------------------------------------------------------------

/** How much each profile cares about a research lane. */
const LANE_WEIGHT: Record<BotProfile, Record<ResearchLane, number>> = {
  technocrat: { extraction: 1.2, sensors: 1.2, engineering: 1.2, military: 1.2 },
  industrialist: { extraction: 1.2, sensors: 0.6, engineering: 1.1, military: 0.6 },
  pioneer: { extraction: 0.8, sensors: 1.2, engineering: 0.8, military: 0.6 },
  warlord: { extraction: 0.7, sensors: 0.6, engineering: 0.7, military: 1.3 },
};

/** Gates and level caps use the highest building levels across all own stations. */
export function highestBuildingLevels(state: GoalBotState): BuildingLevels {
  const levels: BuildingLevels = {};
  for (const station of state.ownStations) {
    for (const building of station.buildings) {
      levels[building.buildingKey] = Math.max(levels[building.buildingKey] ?? 0, building.level);
    }
  }
  return levels;
}

const isBuildingBlocker = (blocker: RequirementBlocker) =>
  blocker.type === 'lab_cap' || blocker.type === 'building';

/**
 * Research that unblocks a goal: the Titan and Collector, a first fighter, and expansion past
 * its limits. Each need is walked back through its research prerequisites.
 */
function unlockNeeds(state: GoalBotState, station: StationSnapshot): Set<ResearchKey> {
  const levels = state.research.levels;
  const highest = highestBuildingLevels(state);
  const needs = new Set<ResearchKey>();
  const visit = (key: ResearchKey) => {
    if (needs.has(key)) return;
    needs.add(key);
    for (const blocker of researchBlockers(key, levels, highest)) {
      if (blocker.type === 'research') visit(blocker.key);
    }
  };

  const buildings = stationBuildingLevels(station);
  const wanted = ['titan', 'collector', ...(unlockedFighters(station).length ? [] : ['merlin'])];
  for (const key of wanted) {
    const blockers = requirementBlockers(requireSpacecraft(key).requirements, levels, buildings);
    // A missing building is the owning goal's step; research only counts once buildings stand.
    if (blockers.some((blocker) => blocker.type === 'building')) continue;
    for (const blocker of blockers) if (blocker.type === 'research') visit(blocker.key);
  }
  const modifiers = researchModifiers(levels);
  if (!modifiers.canExplore) visit('long_range_survey');
  else if (state.ownStations.length >= modifiers.stationLimit) visit('colony_logistics');
  return needs;
}

export function generateResearchCandidates(
  state: GoalBotState,
  station: StationSnapshot,
  profile: BotProfile = 'technocrat'
): GoalCandidate[] {
  if (state.research.active.length >= state.research.slots) return [];
  const hasIncome = hasActiveMining(station);
  const buildings = highestBuildingLevels(state);
  const needs = unlockNeeds(state, station);
  const candidates: GoalCandidate[] = [];

  for (const def of researchDefinitions) {
    if (state.research.active.includes(def.key)) continue;
    const need = needs.has(def.key);
    const blockers = researchBlockers(def.key, state.research.levels, buildings);
    // A needed step that only waits on a building still counts; the step upgrades that building.
    if (blockers.length > 0 && !(need && blockers.every(isBuildingBlocker))) continue;
    const level = (state.research.levels[def.key] ?? 0) + 1;
    const costs = calculateResearchCost(def.key, level);
    const affordable = canAfford(station, costs);
    if (!affordable && (!hasIncome || !canAcquireCosts(state, station, costs))) continue;

    // Early levels pay off most; unlocking something the bot wants counts extra.
    const score = Math.round((40 / level + (need ? 30 : 0)) * LANE_WEIGHT[profile][def.lane]);
    if (score <= 0) continue;
    candidates.push({
      goalType: 'research_technology',
      category: GOAL_CATEGORY.research_technology,
      targetRef: `tech:${station.id}:${def.key}:${level}`,
      baseNeed: affordable ? score : Math.round(score / 2),
      opportunity: affordable ? 30 : 10,
      longTermValue: score,
      commitment: 0,
      cost: Math.round(costs.reduce((sum, cost) => sum + cost.amount, 0) / 10),
      risk: 5,
      blockers: 0,
    });
  }

  return candidates;
}

export async function stepResearchTechnology(
  state: GoalBotState,
  station: StationSnapshot,
  targetRef: string,
  _profile: BotProfile
): Promise<GoalResult> {
  // targetRef format: tech:<stationId>:<key>:<level>
  const [, , techKey, levelPart] = targetRef.split(':');
  const def = techKey ? getResearchDefinition(techKey) : undefined;
  const level = Number(levelPart);
  if (!def || !Number.isInteger(level)) {
    return {
      type: 'blocked',
      reason: `Invalid research target: ${targetRef}`,
    };
  }

  if ((state.research.levels[def.key] ?? 0) >= level) {
    return {
      type: 'complete',
      goalType: 'research_technology',
      targetRef,
      reason: `${def.name} ${level} completed`,
    };
  }
  if (state.research.active.includes(def.key)) {
    return {
      type: 'waiting',
      reason: `Waiting for ${def.name} ${level}`,
    };
  }
  if (state.research.active.length >= state.research.slots) {
    return { type: 'waiting', reason: 'Waiting for a research slot' };
  }

  const blockers = researchBlockers(def.key, state.research.levels, highestBuildingLevels(state));
  if (blockers.length > 0) {
    // Only buildings are in the bot's hands; missing research or a maxed level ends the goal.
    if (!blockers.every(isBuildingBlocker)) {
      return { type: 'blocked', reason: `${def.name} is locked` };
    }
    const blocker = blockers[0];
    const buildingKey: BuildingKey = blocker?.type === 'building' ? blocker.key : 'laboratory';
    const name = getBuilding(buildingKey).name;
    // The gate counts the highest level across stations, so raise it where it is highest.
    const levelAt = (own: StationSnapshot) => stationBuildingLevels(own)[buildingKey] ?? 0;
    const target = state.ownStations.reduce(
      (best, own) => (levelAt(own) > levelAt(best) ? own : best),
      station
    );
    if (isUpgrading(target, buildingKey)) {
      return {
        type: 'waiting',
        reason: `Waiting for ${name} for ${def.name}`,
      };
    }
    const costs = buildingUpgradeCost(target, buildingKey);
    if (canAfford(target, costs)) {
      return {
        type: 'success',
        intent: { type: 'upgrade_building', stationId: target.id, buildingKey },
        reason: `Upgrading ${name} for ${def.name}`,
      };
    }
    const supply = assignMinerTowardCosts(state, target, costs, `${name} for ${def.name}`);
    if (supply) return supply;
    const reachable = hasActiveMining(target) && canAcquireCosts(state, target, costs);
    return {
      type: reachable ? 'saving' : 'blocked',
      reason: reachable
        ? `Saving for ${name} required by ${def.name}`
        : `${name} resources for ${def.name} are not reachable`,
    };
  }

  const costs = calculateResearchCost(def.key, level);
  if (!canAfford(station, costs)) {
    const reachable = hasActiveMining(station) && canAcquireCosts(state, station, costs);
    const supply = assignMinerTowardCosts(state, station, costs, def.name);
    if (supply) return supply;
    return {
      type: reachable ? 'saving' : 'blocked',
      reason: reachable
        ? `Saving resources for ${def.name}`
        : `Resources for ${def.name} are not reachable`,
    };
  }

  return {
    type: 'success',
    intent: { type: 'start_research', stationId: station.id, technologyKey: def.key },
    reason: `Starting research ${def.name} ${level}`,
  };
}
