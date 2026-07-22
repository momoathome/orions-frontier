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

export interface KnownSector extends FrontierTarget {
  id: string;
  role: 'settlement' | 'frontier';
  hasOwnStation: boolean;
}
