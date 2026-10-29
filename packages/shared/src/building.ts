import type { ResourceKey } from './resource.js';

// Building Keys

export const buildingKeys = [
  'core',
  'shipyard',
  'warehouse',
  'scanner',
  'hangar',
  'laboratory',
] as const;

export type BuildingKey = (typeof buildingKeys)[number];

// Building Effect Types

export type BuildingEffectType =
  | 'construction_speed'
  | 'hangar_capacity'
  | 'spacecraft_unlock'
  | 'spacecraft_production_bonus'
  | 'storage_capacity'
  | 'protected_storage'
  | 'scanner_range'
  | 'research_capacity';

// Building Definition (static game config)

export interface BuildingDefinition {
  key: BuildingKey;
  name: string;
  description: string;
  image: string | null;
  baseBuildTime: number;
  maxLevel: number;
  effectType: BuildingEffectType;
}

// Upgrade Cost

export interface BuildingUpgradeCost {
  resourceKey: ResourceKey;
  amount: number;
}

// Building Effect (calculated)

export interface BuildingEffect {
  type: BuildingEffectType;
  value: number;
}

// Full station building with computed data

export interface StationBuildingWithDefinition {
  definition: BuildingDefinition;
  level: number;
  upgradeEndsAt: string | null;
  isUpgrading: boolean;
  effects: BuildingEffect[];
  nextLevelEffects: BuildingEffect[] | null;
  upgradeCosts: BuildingUpgradeCost[];
  unlockMilestones: Record<number, string[]>;
}
