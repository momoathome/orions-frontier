import type { ResourceKey } from './resource.js';

export type SpacecraftRole = 'fighter' | 'miner' | 'transporter' | 'salvager';

export interface SpacecraftDefinition {
  id: string;
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
}

export interface SpacecraftDefinitionCost {
  resourceKey: ResourceKey;
  amount: number;
}

export interface StationSpacecraft {
  id: string;
  stationId: string;
  spacecraftDefinitionId: string;
  amount: number;
  lockedAmount: number;
}

export interface StationSpacecraftWithDefinition {
  definition: SpacecraftDefinition & { costs: SpacecraftDefinitionCost[] };
  amount: number;
  lockedAmount: number;
}
