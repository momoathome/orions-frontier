import type { ResourceMap } from './resource.js';

/** Server→Client-Events über den WebSocket. Server und Client teilen diese Payloads. */
export interface RealtimeEvents {
  mining_tick_completed: Record<string, never>;
  transport_tick_completed: { settled: number };
  resources_updated: { stationId: string; resources: ResourceMap };
  building_upgrade_completed: { stationId: string; buildingKey: string; newLevel: number };
  defense_upgrade_completed: { stationId: string; upgradeKey: string; newLevel: number };
  spacecraft_build_completed: {
    stationId: string;
    spacecraftKey: string;
    amount: number;
    orderId: string;
  };
  world_mission_completed: { missionId: string; missionType: string };
  research_completed: { technologyKey: string; newLevel: number };
  /** An attack on one of the player's stations was launched; composition stays hidden. */
  incoming_attack: { missionId: string; defenderStationId: string; arrivesAt: string };
}

export type RealtimeEventType = keyof RealtimeEvents;
