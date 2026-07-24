import type { ResourceKey } from './resource.js';

export type SpacecraftRole = 'fighter' | 'miner' | 'salvager';

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
  definition: SpacecraftDefinition & { costs: SpacecraftDefinitionCost[] };
  amount: number;
  lockedAmount: number;
  buildOrders: SpacecraftBuildOrder[];
}
