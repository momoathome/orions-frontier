import type { RequirementBlocker, Requirements } from './research.js';
import type { ResourceKey } from './resource.js';

export type SpacecraftRole = 'fighter' | 'bomber' | 'miner' | 'salvager';

export interface SpacecraftDefinition {
  key: string;
  name: string;
  description: string | null;
  role: SpacecraftRole;
  image: string | null;
  attack: number;
  defense: number;
  cargo: number;
  speed: number;
  miningRate: number;
  buildTime: number;
  /** Hangar crew places occupied by one spacecraft. */
  crew: number;
}

export interface SpacecraftDefinitionCost {
  resourceKey: ResourceKey;
  amount: number;
}

export interface SpacecraftBuildOrder {
  id: string;
  amount: number;
  endsAt: string; // ISO string
}

export interface StationSpacecraftWithDefinition {
  definition: SpacecraftDefinition & {
    costs: SpacecraftDefinitionCost[];
    requirements: Requirements;
  };
  /** Empty when the station can build it. */
  blockers: RequirementBlocker[];
  amount: number;
  lockedAmount: number;
  buildOrders: SpacecraftBuildOrder[];
}

/** Antwort von `GET /api/stations/:stationId/spacecrafts`. */
export interface StationSpacecraftsResponse {
  stationId: string;
  spacecrafts: StationSpacecraftWithDefinition[];
  hangar: { capacity: number; used: number };
  /** Ships the shipyard builds at the same time. */
  productionSlots: number;
  /** Factor on build times from the Shipyard bonus and Fabrication Lines. */
  buildTimeFactor: number;
}
