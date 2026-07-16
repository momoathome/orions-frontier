import type {
  BuildingKey,
  BuildingEffectType,
  BuildingUpgradeCost,
  BuildingEffect,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';

// ============================================================================
// Seed Definition
// ============================================================================

export interface BuildingSeedDefinition {
  key: BuildingKey;
  name: string;
  description: string;
  image: string;
  baseBuildTime: number; // seconds for level 1
  maxLevel: number;
  effectType: BuildingEffectType;
}

export const buildings: BuildingSeedDefinition[] = [
  {
    key: 'core',
    name: 'Core',
    description:
      'The heart of your station. Increases overall station capacity and unlocks advanced systems.',
    image: '/assets/buildings/core.webp',
    baseBuildTime: 60,
    maxLevel: 20,
    effectType: 'station_progression',
  },
  {
    key: 'shipyard',
    name: 'Shipyard',
    description: 'Constructs and upgrades spacecraft. Higher levels unlock advanced ship classes.',
    image: '/assets/buildings/shipyard.webp',
    baseBuildTime: 90,
    maxLevel: 15,
    effectType: 'spacecraft_unlock',
  },
  {
    key: 'warehouse',
    name: 'Warehouse',
    description: 'Expands resource storage capacity and protects stored goods from raids.',
    image: '/assets/buildings/warehouse.webp',
    baseBuildTime: 45,
    maxLevel: 20,
    effectType: 'storage_capacity',
  },
  {
    key: 'scanner',
    name: 'Scanner',
    description:
      'Extends detection range for asteroids and hostile vessels in surrounding sectors.',
    image: '/assets/buildings/scanner.webp',
    baseBuildTime: 60,
    maxLevel: 15,
    effectType: 'scanner_strength',
  },
  {
    key: 'guardian',
    name: 'Guardian',
    description: 'Reinforces station turrets and shielding systems against hostile attacks.',
    image: '/assets/buildings/guardian.webp',
    baseBuildTime: 120,
    maxLevel: 15,
    effectType: 'defense_power',
  },
  {
    key: 'laboratory',
    name: 'Laboratory',
    description: 'Generates research points used for unlocking advanced technologies.',
    image: '/assets/buildings/laboratory.webp',
    baseBuildTime: 90,
    maxLevel: 15,
    effectType: 'research_points',
  },
];

// ============================================================================
// Upgrade Cost Config
// ============================================================================

interface ResourceCostEntry {
  resourceKey: ResourceKey;
  baseAmount: number;
  unlocksAtLevel?: number; // resource is added to cost starting at this level
}

interface UpgradeCostConfig {
  resourceCosts: ResourceCostEntry[];
  /** Exponential scale factor applied per level (cost = base * factor^(targetLevel-1)) */
  factor: number;
}

const UPGRADE_COST_CONFIG: Record<BuildingKey, UpgradeCostConfig> = {
  core: {
    factor: 1.5,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 150 },
      { resourceKey: 'titanium', baseAmount: 100 },
      { resourceKey: 'kyber_crystal', baseAmount: 20, unlocksAtLevel: 5 },
      { resourceKey: 'astatine', baseAmount: 10, unlocksAtLevel: 10 },
    ],
  },
  shipyard: {
    factor: 1.4,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 120 },
      { resourceKey: 'titanium', baseAmount: 80 },
      { resourceKey: 'hydrogenium', baseAmount: 30, unlocksAtLevel: 5 },
      { resourceKey: 'kyber_crystal', baseAmount: 15, unlocksAtLevel: 8 },
    ],
  },
  warehouse: {
    factor: 1.35,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 80 },
      { resourceKey: 'titanium', baseAmount: 60 },
      { resourceKey: 'hydrogenium', baseAmount: 20, unlocksAtLevel: 7 },
    ],
  },
  scanner: {
    factor: 1.4,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 90 },
      { resourceKey: 'titanium', baseAmount: 70 },
      { resourceKey: 'hydrogenium', baseAmount: 25, unlocksAtLevel: 6 },
      { resourceKey: 'kyber_crystal', baseAmount: 10, unlocksAtLevel: 10 },
    ],
  },
  guardian: {
    factor: 1.45,
    resourceCosts: [
      { resourceKey: 'titanium', baseAmount: 150 },
      { resourceKey: 'hydrogenium', baseAmount: 40 },
      { resourceKey: 'kyber_crystal', baseAmount: 20, unlocksAtLevel: 5 },
      { resourceKey: 'astatine', baseAmount: 15, unlocksAtLevel: 10 },
    ],
  },
  laboratory: {
    factor: 1.4,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 100 },
      { resourceKey: 'kyber_crystal', baseAmount: 10 },
      { resourceKey: 'astatine', baseAmount: 5, unlocksAtLevel: 5 },
    ],
  },
};

/**
 * Calculates the resource costs required to upgrade a building to targetLevel.
 * targetLevel must be >= 2 (upgrading from level targetLevel-1 to targetLevel).
 */
export function calculateBuildingUpgradeCost(
  buildingKey: BuildingKey,
  targetLevel: number
): BuildingUpgradeCost[] {
  const config = UPGRADE_COST_CONFIG[buildingKey];
  const multiplier = Math.pow(config.factor, targetLevel - 1);

  const costs: BuildingUpgradeCost[] = [];

  for (const entry of config.resourceCosts) {
    if (entry.unlocksAtLevel !== undefined && targetLevel < entry.unlocksAtLevel) {
      continue;
    }
    const amount = Math.max(10, Math.round((entry.baseAmount * multiplier) / 10) * 10);
    costs.push({ resourceKey: entry.resourceKey, amount });
  }

  return costs;
}

// ============================================================================
// Build Time Calculation
// ============================================================================

/**
 * Returns the build time in seconds for upgrading to targetLevel.
 * Scales exponentially from baseBuildTime: buildTime = base * 1.4^(targetLevel-1)
 */
export function calculateBuildingBuildTime(buildingKey: BuildingKey, targetLevel: number): number {
  const def = buildings.find((b) => b.key === buildingKey);
  if (!def) return 60;
  return Math.round(def.baseBuildTime * Math.pow(1.4, targetLevel - 1));
}

// ============================================================================
// Effect Calculation
// ============================================================================

/**
 * Calculates explicit building effects for a given level.
 * All effects are deterministic — no generic modifier engine.
 */
export function calculateBuildingEffect(buildingKey: BuildingKey, level: number): BuildingEffect[] {
  switch (buildingKey) {
    case 'core':
      return [{ type: 'station_progression', value: level * 5 }];

    case 'shipyard':
      return [
        { type: 'spacecraft_unlock', value: level },
        { type: 'spacecraft_production_bonus', value: level * 3 },
      ];

    case 'warehouse':
      return [
        { type: 'storage_capacity', value: 1000 + level * 500 },
        { type: 'protected_storage', value: level * 100 },
      ];

    case 'scanner':
      return [{ type: 'scanner_strength', value: level * 10 }];

    case 'guardian':
      return [{ type: 'defense_power', value: level * 15 }];

    case 'laboratory':
      return [{ type: 'research_points', value: level * 5 }];
  }
}

// ============================================================================
// Unlock Milestones
// ============================================================================

/**
 * Maps shipyard level → spacecraft keys unlocked at that level.
 * Spacecraft only become buildable once the shipyard reaches the required level.
 */
export const SHIPYARD_UNLOCKS: Record<number, string[]> = {
  1: ['mole'],
  2: ['merlin'],
  5: ['comet'],
  8: ['javelin'],
};

/**
 * Returns all unlock milestones for a given building.
 * Key = required level, value = list of unlocked entity keys.
 */
export function getBuildingUnlockMilestones(buildingKey: BuildingKey): Record<number, string[]> {
  switch (buildingKey) {
    case 'shipyard':
      return SHIPYARD_UNLOCKS;
    default:
      return {};
  }
}
