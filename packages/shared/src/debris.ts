import type { ResourceMap } from './resource.js';

export interface DebrisField {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  resources: ResourceMap;
}

export interface SalvageMission {
  id: string;
  stationId: string;
  debrisFieldId: string | null;
  amount: number;
  cargo: ResourceMap;
  status: 'traveling' | 'returning' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}
