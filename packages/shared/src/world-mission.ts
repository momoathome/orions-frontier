import type { ResourceMap } from './resource.js';

export type WorldMissionType = 'expedition' | 'colonization';
export type WorldMissionStatus = 'traveling' | 'returning' | 'arrived' | 'cancelled';

export interface WorldMission {
  id: string;
  originStationId: string;
  missionType: WorldMissionType;
  targetSectorX: number;
  targetSectorY: number;
  targetX: number | null;
  targetY: number | null;
  colonyName: string | null;
  spacecraftName: string;
  departedAt: string;
  arrivesAt: string;
  status: WorldMissionStatus;
}

export interface FrontierTarget {
  sectorX: number;
  sectorY: number;
  x: number;
  y: number;
  distance: number;
  travelHours: number | null;
}

/** GET /world/frontier: targets plus the research limits for expeditions and colonies. */
export interface FrontierResponse {
  targets: FrontierTarget[];
  expeditions: { active: number; limit: number; canExplore: boolean };
  /** `stations` counts own stations plus colonization missions under way. */
  colonization: { cost: ResourceMap; stations: number; limit: number };
}

export interface KnownSector extends FrontierTarget {
  id: string;
  role: 'settlement' | 'frontier';
  hasOwnStation: boolean;
}
