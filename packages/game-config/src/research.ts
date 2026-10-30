import {
  buildingKeys,
  entriesOf,
  isOneOf,
  required,
  researchKeys,
  type BuildingKey,
  type BuildingLevels,
  type RequirementBlocker,
  type Requirements,
  type ResearchCost,
  type ResearchDefinition,
  type ResearchKey,
  type ResearchLevels,
  type ResearchTier,
} from '@orions-frontier/shared';
import { defenseUpgrades } from './defense.js';
import { spacecrafts } from './spacecrafts.js';

/** Each tier opens with a Laboratory level; Tier 3 and 5 also need the matching spectral scan. */
export const RESEARCH_TIERS: Record<
  ResearchTier,
  { requirements: Requirements; costs: ResearchCost[]; minutes: number }
> = {
  1: {
    requirements: { buildings: { laboratory: 1 } },
    costs: [{ resourceKey: 'hydrogenium', amount: 150 }],
    minutes: 10,
  },
  2: {
    requirements: { buildings: { laboratory: 3 } },
    costs: [{ resourceKey: 'hydrogenium', amount: 400 }],
    minutes: 30,
  },
  3: {
    requirements: { buildings: { laboratory: 5 }, research: { spectral_analysis: 1 } },
    costs: [
      { resourceKey: 'hydrogenium', amount: 900 },
      { resourceKey: 'kyber_crystal', amount: 150 },
    ],
    minutes: 90,
  },
  4: {
    requirements: { buildings: { laboratory: 8 } },
    costs: [
      { resourceKey: 'hydrogenium', amount: 2_000 },
      { resourceKey: 'kyber_crystal', amount: 400 },
    ],
    minutes: 240,
  },
  5: {
    requirements: { buildings: { laboratory: 11 }, research: { deep_spectral_analysis: 1 } },
    costs: [
      { resourceKey: 'hydrogenium', amount: 4_500 },
      { resourceKey: 'kyber_crystal', amount: 1_000 },
      { resourceKey: 'astatine', amount: 200 },
    ],
    minutes: 600,
  },
};

/** Costs and durations grow by this factor per research level. */
const LEVEL_FACTOR = 1.5;
/** Percent each Laboratory level above 1 takes off research time. */
export const LAB_SPEED_PER_LEVEL = 2;

export const researchDefinitions: ResearchDefinition[] = [
  // Extraction
  {
    key: 'extraction_algorithms',
    name: 'Extraction Algorithms',
    description: 'Raises the mining rate of miners and salvagers.',
    lane: 'extraction',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Mining rate', perLevel: 5, format: 'percent' },
  },
  {
    key: 'cargo_compression',
    name: 'Cargo Compression',
    description: 'Raises the cargo capacity of every ship, for mining, salvage and loot.',
    lane: 'extraction',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Cargo', perLevel: 5, format: 'percent' },
  },
  {
    key: 'auto_reroute',
    name: 'Autonomous Rerouting',
    description:
      'When an asteroid runs dry, its miners fly on to the nearest visible asteroid with the same resource.',
    lane: 'extraction',
    tier: 3,
    kind: 'capability',
    maxLevel: 1,
    requirements: { research: { extraction_algorithms: 3, sensor_arrays: 2 } },
    effect: null,
  },
  {
    key: 'deep_core_drilling',
    name: 'Deep Core Drilling',
    description: 'Deliveries carry more than the asteroid loses.',
    lane: 'extraction',
    tier: 4,
    kind: 'stat',
    maxLevel: 5,
    requirements: { research: { extraction_algorithms: 6, cargo_compression: 4 } },
    effect: { label: 'Yield', perLevel: 6, format: 'percent' },
  },
  {
    key: 'autonomous_fleet',
    name: 'Autonomous Mining Fleet',
    description:
      'New miners and miners without a rerouting target pick the best visible asteroid on their own.',
    lane: 'extraction',
    tier: 5,
    kind: 'capability',
    maxLevel: 1,
    requirements: { research: { auto_reroute: 1, deep_core_drilling: 3 } },
    effect: null,
  },

  // Navigation & Sensors
  {
    key: 'ion_propulsion',
    name: 'Ion Propulsion',
    description: 'Raises the speed of all ships on every trip.',
    lane: 'sensors',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Speed', perLevel: 5, format: 'percent' },
  },
  {
    key: 'sensor_arrays',
    name: 'Sensor Arrays',
    description: 'Extends the range of every station scanner.',
    lane: 'sensors',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Scan range', perLevel: 5, format: 'percent' },
  },
  {
    key: 'spectral_analysis',
    name: 'Spectral Analysis',
    description: 'Kyber Crystal deposits show up in scans and can be mined. Opens Tier 3.',
    lane: 'sensors',
    tier: 2,
    kind: 'capability',
    maxLevel: 1,
    requirements: { research: { sensor_arrays: 2 }, buildings: { scanner: 3 } },
    effect: null,
  },
  {
    key: 'long_range_survey',
    name: 'Long-Range Survey',
    description: 'Allows expeditions into unexplored sectors.',
    lane: 'sensors',
    tier: 2,
    kind: 'capability',
    maxLevel: 1,
    requirements: { research: { ion_propulsion: 2, sensor_arrays: 1 } },
    effect: null,
  },
  {
    key: 'signature_analysis',
    name: 'Signature Analysis',
    description: 'Incoming hostile fleets reveal their composition.',
    lane: 'sensors',
    tier: 3,
    kind: 'capability',
    maxLevel: 1,
    requirements: { research: { sensor_arrays: 4 }, buildings: { scanner: 5 } },
    effect: null,
  },
  {
    key: 'colony_logistics',
    name: 'Colony Logistics',
    description: 'Each level allows one more colony besides the home station.',
    lane: 'sensors',
    tier: 3,
    kind: 'capability',
    maxLevel: 3,
    requirements: {
      research: { long_range_survey: 1, ion_propulsion: 4 },
      buildings: { core: 5 },
    },
    effect: { label: 'Colonies', perLevel: 1, format: 'count' },
  },
  {
    key: 'deep_spectral_analysis',
    name: 'Deep Spectral Analysis',
    description: 'Astatine deposits show up in scans and can be mined. Opens Tier 5.',
    lane: 'sensors',
    tier: 4,
    kind: 'capability',
    maxLevel: 1,
    requirements: {
      research: { spectral_analysis: 1, sensor_arrays: 6 },
      buildings: { scanner: 7 },
    },
    effect: null,
  },
  {
    key: 'frontier_charter',
    name: 'Frontier Charter',
    description: 'Each level allows one more colony and one more expedition at a time.',
    lane: 'sensors',
    tier: 5,
    kind: 'capability',
    maxLevel: 2,
    requirements: { research: { colony_logistics: 3, deep_spectral_analysis: 1 } },
    effect: { label: 'Colonies and expeditions', perLevel: 1, format: 'count' },
  },

  // Engineering
  {
    key: 'construction_robotics',
    name: 'Construction Robotics',
    description: 'Shortens building and defense upgrades, on top of the Core.',
    lane: 'engineering',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Upgrade time', perLevel: 3, format: 'percent_less' },
  },
  {
    key: 'fabrication_lines',
    name: 'Fabrication Lines',
    description: 'Shortens spacecraft construction, on top of the Shipyard.',
    lane: 'engineering',
    tier: 2,
    kind: 'stat',
    maxLevel: 10,
    requirements: { buildings: { shipyard: 3 } },
    effect: { label: 'Ship build time', perLevel: 3, format: 'percent_less' },
  },
  {
    key: 'parallel_construction',
    name: 'Parallel Construction',
    description: 'Each level adds a build slot, so more building or defense upgrades run at once.',
    lane: 'engineering',
    tier: 3,
    kind: 'capability',
    maxLevel: 2,
    requirements: { research: { construction_robotics: 4 }, buildings: { core: 6 } },
    levelRequirements: { 2: { buildings: { core: 12 } } },
    effect: { label: 'Build slots', perLevel: 1, format: 'count' },
  },
  {
    key: 'research_network',
    name: 'Research Network',
    description: 'Adds a second research slot.',
    lane: 'engineering',
    tier: 4,
    kind: 'capability',
    maxLevel: 1,
    requirements: { research: { construction_robotics: 5 }, buildings: { laboratory: 10 } },
    effect: { label: 'Research slots', perLevel: 1, format: 'count' },
  },
  {
    key: 'nanite_assembly',
    name: 'Nanite Assembly',
    description: 'Lowers the cost of building upgrades.',
    lane: 'engineering',
    tier: 5,
    kind: 'stat',
    maxLevel: 5,
    requirements: { research: { parallel_construction: 1, construction_robotics: 8 } },
    effect: { label: 'Building cost', perLevel: 4, format: 'percent_less' },
  },

  // Military
  {
    key: 'weapons',
    name: 'Weapons Technology',
    description: 'Raises the attack of all ships.',
    lane: 'military',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Ship attack', perLevel: 5, format: 'percent' },
  },
  {
    key: 'armor',
    name: 'Armor Technology',
    description: 'Raises the defense of all ships.',
    lane: 'military',
    tier: 1,
    kind: 'stat',
    maxLevel: 10,
    requirements: {},
    effect: { label: 'Ship defense', perLevel: 5, format: 'percent' },
  },
  {
    key: 'shields',
    name: 'Shield Technology',
    description: 'Raises the defense value of every station.',
    lane: 'military',
    tier: 2,
    kind: 'stat',
    maxLevel: 10,
    requirements: { research: { armor: 2 } },
    effect: { label: 'Station defense', perLevel: 5, format: 'percent' },
  },
  {
    key: 'fleet_coordination',
    name: 'Fleet Coordination',
    description: 'Raises the crew slots of every hangar.',
    lane: 'military',
    tier: 5,
    kind: 'stat',
    maxLevel: 5,
    requirements: { research: { weapons: 6, armor: 6, shields: 4 } },
    effect: { label: 'Crew slots', perLevel: 5, format: 'percent' },
  },
];

export const getResearchDefinition = (key: string): ResearchDefinition | undefined =>
  researchDefinitions.find((definition) => definition.key === key);

export const requireResearchDefinition = (key: ResearchKey): ResearchDefinition =>
  required(getResearchDefinition(key), `research ${key}`);

export const isResearchKey = (key: string): key is ResearchKey => isOneOf(researchKeys, key);

/** Hydrogenium in Tier 1 and 2, Kyber from Tier 3, Astatine in Tier 5; ×1.5 per level. */
export function calculateResearchCost(key: ResearchKey, level: number): ResearchCost[] {
  const multiplier = LEVEL_FACTOR ** (level - 1);
  return RESEARCH_TIERS[requireResearchDefinition(key).tier].costs.map((cost) => ({
    resourceKey: cost.resourceKey,
    amount: Math.round((cost.amount * multiplier) / 10) * 10,
  }));
}

/** Research time in seconds; every Laboratory level above 1 takes 2% off. */
export function calculateResearchDuration(
  key: ResearchKey,
  level: number,
  laboratoryLevel: number
): number {
  const base = RESEARCH_TIERS[requireResearchDefinition(key).tier].minutes * 60;
  const labFactor = 1 - (Math.max(1, laboratoryLevel) - 1) * (LAB_SPEED_PER_LEVEL / 100);
  return Math.round(base * LEVEL_FACTOR ** (level - 1) * labFactor);
}

const mergeLevels = <K extends string>(
  ...maps: (Partial<Record<K, number>> | undefined)[]
): Partial<Record<K, number>> => {
  const merged: Partial<Record<K, number>> = {};
  for (const map of maps) {
    for (const [key, level] of entriesOf(map ?? {})) {
      merged[key] = Math.max(merged[key] ?? 0, level);
    }
  }
  return merged;
};

/** Tier gate plus the research's own requirements for that level. */
export function researchRequirements(key: ResearchKey, level: number): Requirements {
  const definition = requireResearchDefinition(key);
  const parts = [RESEARCH_TIERS[definition.tier].requirements, definition.requirements];
  for (let target = 2; target <= level; target++) {
    const extra = definition.levelRequirements?.[target];
    if (extra) parts.push(extra);
  }
  return {
    research: mergeLevels(...parts.map((part) => part.research)),
    buildings: mergeLevels(...parts.map((part) => part.buildings)),
  };
}

/** Missing research and building levels; empty when the requirements are met. */
export function requirementBlockers(
  requirements: Requirements,
  research: ResearchLevels,
  buildings: BuildingLevels
): RequirementBlocker[] {
  const blockers: RequirementBlocker[] = [];
  for (const key of buildingKeys) {
    const level = requirements.buildings?.[key];
    const current = buildings[key] ?? 0;
    if (level !== undefined && current < level) {
      blockers.push({ type: 'building', key, level, current });
    }
  }
  for (const key of researchKeys) {
    const level = requirements.research?.[key];
    const current = research[key] ?? 0;
    if (level !== undefined && current < level) {
      blockers.push({ type: 'research', key, level, current });
    }
  }
  return blockers;
}

/**
 * Why the next level of a research cannot start. Building levels are the account's highest
 * across its active stations; the Laboratory also caps every research level.
 */
export function researchBlockers(
  key: ResearchKey,
  research: ResearchLevels,
  highestBuildings: BuildingLevels
): RequirementBlocker[] {
  const next = (research[key] ?? 0) + 1;
  if (next > requireResearchDefinition(key).maxLevel) return [{ type: 'maxed' }];
  const blockers = requirementBlockers(researchRequirements(key, next), research, highestBuildings);
  const laboratory = highestBuildings.laboratory ?? 0;
  if (next > laboratory) blockers.push({ type: 'lab_cap', level: next, current: laboratory });
  return blockers;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** What each level of a building opens up, for the building's level overview. */
export function unlocksByBuildingLevel(building: BuildingKey): Record<number, string[]> {
  const unlocks: Record<number, string[]> = {};
  const add = (requirements: Requirements, name: string) => {
    const level = requirements.buildings?.[building];
    if (level !== undefined) (unlocks[level] ??= []).push(name);
  };
  for (const [tier, gate] of Object.entries(RESEARCH_TIERS)) {
    add(gate.requirements, `Tier ${tier} research`);
  }
  for (const definition of researchDefinitions) {
    add(definition.requirements, definition.name);
    for (const [level, extra] of Object.entries(definition.levelRequirements ?? {})) {
      add(extra, `${definition.name} ${ROMAN[Number(level)] ?? level}`);
    }
  }
  for (const spacecraft of spacecrafts) add(spacecraft.requirements, spacecraft.name);
  for (const upgrade of defenseUpgrades) add(upgrade.requirements, upgrade.name);
  return unlocks;
}
