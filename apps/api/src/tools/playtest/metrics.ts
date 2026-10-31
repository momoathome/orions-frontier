import { entriesOf, type ResourceMap } from '@orions-frontier/shared';
import type { Milestones } from './milestones.js';
import {
  emptyWorld,
  type PlaytestStateSnapshot,
  type PlaytestStationSnapshot,
  type PlaytestWorldSnapshot,
} from './snapshot-loader.js';

export interface GoalMetrics {
  selections: number;
  activeDurationMs: number;
  switches: number;
  completions: number;
  success: number;
  failed: number;
  waiting: number;
  saving: number;
  blocked: number;
  maximumBindingDurationMs: number;
}

export interface EconomyMetrics {
  minedResources: ResourceMap;
  deliveredResources: ResourceMap;
  discardedResources: ResourceMap;
  weightedDeliveredUnits: number;
  minimumResources: ResourceMap;
  fullStorageDurationMs: number;
  fullStorageDurationByStationMs: Record<string, number>;
  exhaustedAsteroids: number;
  unreachableResourceNeeds: number;
}

export interface DevelopmentMetrics {
  buildingLevelTotal: number;
  defenseLevelTotal: number;
  completedResearch: number;
  influence: number;
  spacecraftUnits: number;
  spacecraftBuilt: Record<string, number>;
  queueActiveSamples: number;
  snapshotSamples: number;
  queueUtilization: number;
}

export interface ExpansionMetrics {
  expeditions: number;
  colonies: number;
  colonyStabilizationDurationMs: number | null;
  coloniesByStation: Record<string, { foundedAt: string; stabilizationDurationMs: number | null }>;
  stations: number;
}

export interface ConflictMetrics {
  attacks: number;
  retaliations: number;
  protectionRejections: number;
  wins: number;
  losses: number;
  attackerLosses: number;
  defenderLosses: number;
  loot: ResourceMap;
  targets: Record<string, number>;
  maximumObservedReserve: number;
  opportunitySamples: number;
  visibleTargets: number;
  eligibleAfterProtectionAndCooldown: number;
  sufficientFleetAndReserve: number;
  viableTargets: number;
  opportunityStages: Record<string, number>;
}

export interface SalvageMetrics {
  debrisCreatedResources: ResourceMap;
  salvagedResources: ResourceMap;
  remainingDebrisResources: ResourceMap;
  missions: number;
  collectorBuilds: number;
}

export interface BotMetrics {
  botAlias: string;
  profile: string;
  populationKind: string;
  joinedAt: string;
  goals: Record<string, GoalMetrics>;
  milestones: Milestones;
  economy: EconomyMetrics;
  development: DevelopmentMetrics;
  expansion: ExpansionMetrics;
  conflict: ConflictMetrics;
  salvage: SalvageMetrics;
}

export interface AggregateMetrics {
  bots: number;
  goals: Record<string, GoalMetrics>;
  milestonesReached: Record<string, number>;
  economy: EconomyMetrics;
  development: DevelopmentMetrics;
  expansion: ExpansionMetrics;
  conflict: ConflictMetrics;
  salvage: SalvageMetrics;
}

export interface ProfileMetrics extends AggregateMetrics {
  profile: string;
}

export interface PlaytestMetrics {
  bots: BotMetrics[];
  profiles: ProfileMetrics[];
  run: AggregateMetrics;
  stations: PlaytestStationSnapshot[];
  world: PlaytestWorldSnapshot;
  finalSnapshotAt: string | null;
}

export function emptyGoalMetrics(): GoalMetrics {
  return {
    selections: 0,
    activeDurationMs: 0,
    switches: 0,
    completions: 0,
    success: 0,
    failed: 0,
    waiting: 0,
    saving: 0,
    blocked: 0,
    maximumBindingDurationMs: 0,
  };
}

export function emptyEconomyMetrics(): EconomyMetrics {
  return {
    minedResources: {},
    deliveredResources: {},
    discardedResources: {},
    weightedDeliveredUnits: 0,
    minimumResources: {},
    fullStorageDurationMs: 0,
    fullStorageDurationByStationMs: {},
    exhaustedAsteroids: 0,
    unreachableResourceNeeds: 0,
  };
}

export function emptyDevelopmentMetrics(): DevelopmentMetrics {
  return {
    buildingLevelTotal: 0,
    defenseLevelTotal: 0,
    completedResearch: 0,
    influence: 0,
    spacecraftUnits: 0,
    spacecraftBuilt: {},
    queueActiveSamples: 0,
    snapshotSamples: 0,
    queueUtilization: 0,
  };
}

export function emptyExpansionMetrics(): ExpansionMetrics {
  return {
    expeditions: 0,
    colonies: 0,
    colonyStabilizationDurationMs: null,
    coloniesByStation: {},
    stations: 0,
  };
}

export function emptyConflictMetrics(): ConflictMetrics {
  return {
    attacks: 0,
    retaliations: 0,
    protectionRejections: 0,
    wins: 0,
    losses: 0,
    attackerLosses: 0,
    defenderLosses: 0,
    loot: {},
    targets: {},
    maximumObservedReserve: 0,
    opportunitySamples: 0,
    visibleTargets: 0,
    eligibleAfterProtectionAndCooldown: 0,
    sufficientFleetAndReserve: 0,
    viableTargets: 0,
    opportunityStages: {},
  };
}

export function emptySalvageMetrics(): SalvageMetrics {
  return {
    debrisCreatedResources: {},
    salvagedResources: {},
    remainingDebrisResources: {},
    missions: 0,
    collectorBuilds: 0,
  };
}

export function addResources(target: ResourceMap, source: ResourceMap): void {
  for (const [key, amount] of entriesOf(source)) {
    target[key] = (target[key] ?? 0) + amount;
  }
}

export function resourceTotal(resources: Record<string, number | undefined>): number {
  return Object.values(resources).reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
}

export function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : 0;
}

export function snapshotWorld(snapshot: PlaytestStateSnapshot | null): PlaytestWorldSnapshot {
  return snapshot?.world ?? emptyWorld();
}
