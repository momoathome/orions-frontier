import type { ResourceMap, VisibleStation } from '@orions-frontier/shared';
import type { CombatReport } from '@orions-frontier/shared';

/** Per-station snapshot for the goal-driven bot strategy. */
export interface StationSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  resources: ResourceMap;
  buildings: { buildingKey: string; level: number; upgradeEndsAt: Date | null }[];
  defense: { upgradeKey: string; level: number; upgradeEndsAt: Date | null }[];
  fleets: { spacecraftKey: string; amount: number; lockedAmount: number }[];
  builds: { spacecraftKey: string; amount: number }[];
  research: { technologyKey: string; status: string; completesAt: Date | null }[];
  missions: { missionType: string; status: string; arrivesAt: Date }[];
}

/** Account-wide snapshot built from publicly visible data only. */
export interface GoalBotState {
  userId: string;
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
}
