import type { ResourceKey } from './resource.js';

// ============================================================================
// Building Keys
// ============================================================================

export const buildingKeys = [
  'core',
  'shipyard',
  'warehouse',
  'scanner',
  'guardian',
  'laboratory',
] as const;

export type BuildingKey = (typeof buildingKeys)[number];

// ============================================================================
// Building Effect Types
// ============================================================================

export type BuildingEffectType =
  | 'station_progression'
  | 'spacecraft_unlock'
  | 'spacecraft_production_bonus'
  | 'storage_capacity'
  | 'protected_storage'
  | 'scanner_strength'
  | 'defense_power'
  | 'research_points';

// ============================================================================
// Building Definition (static / seeded)
// ============================================================================

export interface BuildingDefinition {
  id: string;
  key: BuildingKey;
  name: string;
  description: string;
  image: string | null;
  baseBuildTime: number;
  maxLevel: number;
  effectType: BuildingEffectType;
  createdAt: string;
}

// ============================================================================
// Station Building (runtime per station)
// ============================================================================

export interface StationBuilding {
  id: string;
  stationId: string;
  buildingDefinitionId: string;
  level: number;
  upgradeEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Upgrade Cost
// ============================================================================

export interface BuildingUpgradeCost {
  resourceKey: ResourceKey;
  amount: number;
}

// ============================================================================
// Building Effect (calculated)
// ============================================================================

export interface BuildingEffect {
  type: BuildingEffectType;
  value: number;
}

// ============================================================================
// Full station building with computed data
// ============================================================================

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
