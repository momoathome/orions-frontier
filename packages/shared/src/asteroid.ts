import type { ResourceKey, ResourceMap } from './resource.js';

export type AsteroidSize = 'small' | 'medium' | 'large' | 'massive';

export type VeinType = 'primary' | 'secondary' | 'trace';

export interface AsteroidVein {
  id: string;
  veinType: VeinType;
  resourceKey: ResourceKey;
  /** Resource units not yet committed to a mining cycle. */
  remainingAmount: number;
}

export interface Asteroid {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  /** Size category determines the generated reserve range. */
  size: AsteroidSize;
  hiddenLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface VisibleAsteroid {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  size: AsteroidSize;
  /** Primary vein resource — used for map color rendering */
  primaryResourceKey: ResourceKey;
}

export interface AsteroidDetailAssignment {
  id: string;
  stationId: string;
  spacecraftKey: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  /** Cargo capacity per single spacecraft of this type */
  spacecraftCargo: number;
  assignedAmount: number;
  assignedAt: string;
  recallRequestedAt: string | null;
  recallRequestedAmount: number;
  activeTrip: {
    id: string;
    purpose: 'mine' | 'mining_return';
    groupSize: number;
    departedAt: string;
    arrivesAt: string;
    cargoManifest: ResourceMap | null;
  } | null;
}

export interface AsteroidDetail extends Asteroid {
  veins: AsteroidVein[];
  /** Exact operations are visible only while the requesting player has ships here. */
  operationsVisible: boolean;
  assignments: AsteroidDetailAssignment[];
  /** Resources claimed by mining groups and currently returning from this asteroid */
  inTransit: Record<string, number>;
}
