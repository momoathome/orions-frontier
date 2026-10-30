import type { RequirementBlocker, Requirements } from './research.js';
import type { ResourceKey } from './resource.js';

export const defenseUpgradeKeys = [
  'armor_plating',
  'guardian_cannon',
  'defense_drones',
  'minefield',
] as const;

export type DefenseUpgradeKey = (typeof defenseUpgradeKeys)[number];

export type DefenseEffectType = 'defense_score';

export interface DefenseUpgradeDefinition {
  key: DefenseUpgradeKey;
  name: string;
  description: string;
  image: string | null;
  baseBuildTime: number;
  maxLevel: number;
  requirements: Requirements;
}

export interface DefenseUpgradeCost {
  resourceKey: ResourceKey;
  amount: number;
}

export interface DefenseUpgradeEffect {
  type: DefenseEffectType;
  value: number;
}

export interface StationDefenseUpgradeWithDefinition {
  definition: DefenseUpgradeDefinition;
  level: number;
  upgradeEndsAt: string | null;
  isUpgrading: boolean;
  effects: DefenseUpgradeEffect[];
  nextLevelEffects: DefenseUpgradeEffect[] | null;
  upgradeCosts: DefenseUpgradeCost[];
  upgradeDurationSeconds: number | null;
  /** Blocks the first level only; empty once unlocked. */
  blockers: RequirementBlocker[];
}
