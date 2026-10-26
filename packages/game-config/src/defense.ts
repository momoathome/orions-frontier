import { required } from '@orions-frontier/shared';
import type {
  DefenseUpgradeCost,
  DefenseUpgradeDefinition,
  DefenseUpgradeEffect,
  DefenseUpgradeKey,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';

export interface DefenseUpgradeSeedDefinition extends DefenseUpgradeDefinition {
  startingLevel: number;
}

export const defenseUpgrades: DefenseUpgradeSeedDefinition[] = [
  {
    key: 'armor_plating',
    name: 'Armor Plating',
    description: 'Adds reinforced armor segments that raise the station defense score.',
    image: '/assets/buildings/shield.webp',
    baseBuildTime: 75,
    maxLevel: 15,
    startingLevel: 0,
  },
  {
    key: 'guardian_cannon',
    name: 'Guardian Cannon',
    description: 'Installs a heavy station cannon for stronger static defense.',
    image: '/assets/buildings/Guardian.webp',
    baseBuildTime: 120,
    maxLevel: 12,
    startingLevel: 0,
  },
  {
    key: 'defense_drones',
    name: 'Defense Drones',
    description: 'Deploys short-range patrol drones around the station perimeter.',
    image: null,
    baseBuildTime: 90,
    maxLevel: 15,
    startingLevel: 0,
  },
  {
    key: 'minefield',
    name: 'Minefield',
    description: 'Seeds proximity mines around the station approach lanes.',
    image: null,
    baseBuildTime: 105,
    maxLevel: 12,
    startingLevel: 0,
  },
];

export const getDefenseUpgrade = (key: DefenseUpgradeKey) =>
  required(
    defenseUpgrades.find((upgrade) => upgrade.key === key),
    `defense upgrade ${key}`
  );

interface ResourceCostEntry {
  resourceKey: ResourceKey;
  baseAmount: number;
  unlocksAtLevel?: number;
}

interface UpgradeCostConfig {
  resourceCosts: ResourceCostEntry[];
  factor: number;
}

const UPGRADE_COST_CONFIG: Record<DefenseUpgradeKey, UpgradeCostConfig> = {
  armor_plating: {
    factor: 1.36,
    resourceCosts: [
      { resourceKey: 'titanium', baseAmount: 130 },
      { resourceKey: 'carbon', baseAmount: 70 },
      { resourceKey: 'astatine', baseAmount: 8, unlocksAtLevel: 7 },
    ],
  },
  guardian_cannon: {
    factor: 1.42,
    resourceCosts: [
      { resourceKey: 'titanium', baseAmount: 170 },
      { resourceKey: 'hydrogenium', baseAmount: 50 },
      { resourceKey: 'kyber_crystal', baseAmount: 18, unlocksAtLevel: 5 },
      { resourceKey: 'astatine', baseAmount: 12, unlocksAtLevel: 8 },
    ],
  },
  defense_drones: {
    factor: 1.38,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 110 },
      { resourceKey: 'titanium', baseAmount: 90 },
      { resourceKey: 'hydrogenium', baseAmount: 35, unlocksAtLevel: 4 },
      { resourceKey: 'kyber_crystal', baseAmount: 10, unlocksAtLevel: 8 },
    ],
  },
  minefield: {
    factor: 1.4,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 90 },
      { resourceKey: 'titanium', baseAmount: 120 },
      { resourceKey: 'hydrogenium', baseAmount: 30, unlocksAtLevel: 5 },
    ],
  },
};

export function calculateDefenseUpgradeCost(
  upgradeKey: DefenseUpgradeKey,
  targetLevel: number
): DefenseUpgradeCost[] {
  const config = UPGRADE_COST_CONFIG[upgradeKey];
  const multiplier = Math.pow(config.factor, targetLevel - 1);

  return config.resourceCosts
    .filter((entry) => entry.unlocksAtLevel === undefined || targetLevel >= entry.unlocksAtLevel)
    .map((entry) => ({
      resourceKey: entry.resourceKey,
      amount: Math.max(10, Math.round((entry.baseAmount * multiplier) / 10) * 10),
    }));
}

export function calculateDefenseUpgradeBuildTime(
  upgradeKey: DefenseUpgradeKey,
  targetLevel: number
): number {
  return Math.round(getDefenseUpgrade(upgradeKey).baseBuildTime * Math.pow(1.4, targetLevel - 1));
}

export function calculateDefenseUpgradeEffect(
  upgradeKey: DefenseUpgradeKey,
  level: number
): DefenseUpgradeEffect[] {
  switch (upgradeKey) {
    case 'armor_plating':
      return [{ type: 'defense_score', value: level * 6 }];
    case 'guardian_cannon':
      return [{ type: 'defense_score', value: level * 12 }];
    case 'defense_drones':
      return [{ type: 'defense_score', value: level * 5 }];
    case 'minefield':
      return [{ type: 'defense_score', value: level * 8 }];
  }
}
