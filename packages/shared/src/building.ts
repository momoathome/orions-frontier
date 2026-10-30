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
  /** Building and defense jobs waiting for a slot, in order. */
  queue: QueuedJob[];
}

export interface StationBuildingWithDefinition {
  definition: BuildingDefinition;
  level: number;
  upgradeEndsAt: string | null;
  isUpgrading: boolean;
  effects: BuildingEffect[];
  nextLevelEffects: BuildingEffect[] | null;
  /** Level once the running upgrade and the queued jobs are done. */
  queuedLevel: number;
  /** Cost of the next level to order, `queuedLevel + 1`. */
  upgradeCosts: BuildingUpgradeCost[];
  unlockMilestones: Record<number, string[]>;
}

export const queuedJobKinds = ['building', 'defense', 'research'] as const;
export type QueuedJobKind = (typeof queuedJobKinds)[number];

/**
 * A paid upgrade or research level waiting for a free slot. Building and defense jobs queue per
 * station, research per account; `stationId` is the station that paid.
 */
export interface QueuedJob {
  id: string;
  kind: QueuedJobKind;
  key: string;
  targetLevel: number;
  stationId: string;
  paidCost: BuildingUpgradeCost[];
}

/** At most this many waiting jobs per station queue and per research queue. */
export const QUEUE_LIMIT = 10;
