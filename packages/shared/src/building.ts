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
  | 'production_slots'
  | 'spacecraft_production_bonus'
  | 'storage_capacity'
  | 'protected_storage'
  | 'scanner_range'
  | 'research_speed';

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

/** Build slots of a station; building and defense upgrades share them. */
export interface BuildSlots {
  used: number;
  total: number;
}

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
