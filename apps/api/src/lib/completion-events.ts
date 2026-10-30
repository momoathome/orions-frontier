import { entriesOf, type ResourceMap } from '@orions-frontier/shared';

interface CompletionEventBase {
  eventId: string;
  occurredAt: Date;
  userId: string;
  /** Null for account-wide events such as research. */
  stationId: string | null;
}

export interface MiningDeliveryCompletedEvent extends CompletionEventBase {
  type: 'mining_delivery_completed';
  tripId: string;
  asteroidId: string | null;
  requested: ResourceMap;
  credited: ResourceMap;
  discarded: ResourceMap;
  targetVisibilityVerified: boolean;
  asteroidExhausted: boolean;
}

/** Idle miners sent to a new asteroid by Autonomous Rerouting or the Autonomous Mining Fleet. */
export interface MinersAssignedEvent extends CompletionEventBase {
  type: 'miners_assigned';
  assignmentId: string;
  asteroidId: string;
  spacecraftKey: string;
  amount: number;
  resourceKey: string;
  rerouted: boolean;
}

export interface BuildingCompletedEvent extends CompletionEventBase {
  type: 'building_completed';
  buildingKey: string;
  newLevel: number;
}

export interface DefenseCompletedEvent extends CompletionEventBase {
  type: 'defense_completed';
  defenseKey: string;
  newLevel: number;
}

export interface SpacecraftCompletedEvent extends CompletionEventBase {
  type: 'spacecraft_completed';
  orderId: string;
  spacecraftKey: string;
  amount: number;
}

export interface ResearchCompletedEvent extends CompletionEventBase {
  type: 'research_completed';
  researchId: string;
  technologyKey: string;
  newLevel: number;
}

export interface WorldMissionCompletedEvent extends CompletionEventBase {
  type: 'world_mission_completed';
  missionId: string;
  missionType: string;
  stage: 'target_reached' | 'returned' | 'arrived';
}

export interface ColonyEstablishedEvent extends CompletionEventBase {
  type: 'colony_established';
  missionId: string;
  colonyStationId: string;
  sectorX: number;
  sectorY: number;
}

export interface CombatResolvedEvent extends CompletionEventBase {
  type: 'combat_resolved';
  missionId: string;
  defenderStationId: string;
  winner: string;
  attackerLosses: number;
  defenderLosses: number;
  integrityDamage: number;
  defenderIntegrity: number | null;
  stationDestroyed: boolean;
  targetVisibilityVerified: boolean;
}

export interface LootAcquiredEvent extends CompletionEventBase {
  type: 'loot_acquired';
  missionId: string;
  resources: ResourceMap;
}

export interface LootDeliveredEvent extends CompletionEventBase {
  type: 'loot_delivered';
  missionId: string;
  requested: ResourceMap;
  credited: ResourceMap;
  discarded: ResourceMap;
}

export interface FleetLossesEvent extends CompletionEventBase {
  type: 'fleet_losses';
  missionId: string;
  attackerLosses: number;
  defenderLosses: number;
}

export interface DebrisCreatedEvent extends CompletionEventBase {
  type: 'debris_created';
  missionId: string;
  debrisId: string;
  resources: ResourceMap;
}

export interface SalvageCompletedEvent extends CompletionEventBase {
  type: 'salvage_completed';
  missionId: string;
  requested: ResourceMap;
  credited: ResourceMap;
  discarded: ResourceMap;
  targetVisibilityVerified: boolean;
}

export type PlaytestCompletionEvent =
  | MiningDeliveryCompletedEvent
  | MinersAssignedEvent
  | BuildingCompletedEvent
  | DefenseCompletedEvent
  | SpacecraftCompletedEvent
  | ResearchCompletedEvent
  | WorldMissionCompletedEvent
  | ColonyEstablishedEvent
  | CombatResolvedEvent
  | LootAcquiredEvent
  | LootDeliveredEvent
  | FleetLossesEvent
  | DebrisCreatedEvent
  | SalvageCompletedEvent;

export function completionEventId(
  kind: PlaytestCompletionEvent['type'],
  sourceId: string,
  stage = 'complete'
): string {
  return `${kind}:${sourceId}:${stage}`;
}

export function discardedResources(requested: ResourceMap, credited: ResourceMap): ResourceMap {
  const discarded: ResourceMap = {};
  for (const [key, requestedAmount] of entriesOf(requested)) {
    const amount = Math.max(0, requestedAmount - (credited[key] ?? 0));
    if (amount > 0) discarded[key] = amount;
  }
  return discarded;
}
