import type { ResourceMap, VisibleStation } from '@orions-frontier/shared';
import type { CombatReport } from '@orions-frontier/shared';

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
  buildings: { buildingKey: string; level: number; upgradeEndsAt: Date | null }[];
  defense: { upgradeKey: string; level: number; upgradeEndsAt: Date | null }[];
  fleets: { spacecraftKey: string; amount: number; lockedAmount: number }[];
  builds: { spacecraftKey: string; amount: number }[];
  research: { technologyKey: string; status: string; completesAt: Date | null }[];
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
