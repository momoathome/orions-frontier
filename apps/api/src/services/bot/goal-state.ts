import type {
  BuildingKey,
  DefenseUpgradeKey,
  ResearchKey,
  ResearchLevels,
  ResourceMap,
  VisibleStation,
} from '@orions-frontier/shared';
import type { CombatReport } from '@orions-frontier/shared';
import type { BotIntent } from './intent.js';

/** Per-station snapshot for the goal-driven bot strategy. */
export interface StationSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  sectorId: string;
  sectorX: number;
  sectorY: number;
  createdAt: Date;
  storageCapacity: number;
  resources: ResourceMap;
  buildings: { buildingKey: BuildingKey; level: number; upgradeEndsAt: Date | null }[];
  defense: { upgradeKey: DefenseUpgradeKey; level: number; upgradeEndsAt: Date | null }[];
  fleets: { spacecraftKey: string; amount: number; lockedAmount: number }[];
  builds: { spacecraftKey: string; amount: number }[];
  /** Account-wide research levels, copied onto every station for the station-level helpers. */
  research: ResearchLevels;
  miningAssignments: {
    id: string;
    asteroidId: string;
    spacecraftKey: string;
    assignedAmount: number;
    status: string;
  }[];
  trips: {
    id: string;
    purpose: string;
    status: string;
    arrivesAt: Date;
    toId: string;
  }[];
  missions: {
    missionType: string;
    status: string;
    arrivesAt: Date;
    targetSectorX: number;
    targetSectorY: number;
  }[];
  combatMissions: {
    id: string;
    defenderStationId: string;
    status: string;
    createdAt: Date;
  }[];
  salvageMissions: {
    id: string;
    debrisFieldId: string | null;
    status: string;
    createdAt: Date;
  }[];
}

/** Account-wide snapshot built from publicly visible data only. */
export interface GoalBotState {
  userId: string;
  now: Date;
  completedExpeditions: number;
  research: { levels: ResearchLevels; active: ResearchKey[]; slots: number };
  ownStations: StationSnapshot[];
  visibleAsteroids: {
    id: string;
    x: number;
    y: number;
    remainingByResource: ResourceMap;
    remainingAmount: number;
  }[];
  visibleStations: VisibleStation[];
  visibleDebris: {
    id: string;
    x: number;
    y: number;
    resources: ResourceMap;
  }[];
  combatReports: CombatReport[];
  /** Authoritative diagnostic inputs which never participate in candidate selection. */
  conflictDiagnostics: {
    protectedOwnerIds: string[];
  };
}

export type GoalResult =
  | { type: 'success'; intent: BotIntent; reason: string }
  | { type: 'waiting'; detail: string; reason: string }
  | { type: 'saving'; detail: string; reason: string }
  | { type: 'blocked'; detail: string; reason: string }
  | { type: 'complete'; goalType: string; targetRef: string; reason: string };
