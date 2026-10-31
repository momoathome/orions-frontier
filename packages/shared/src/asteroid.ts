import type { ResourceKey, ResourceMap } from './resource.js';

export type AsteroidSize = 'small' | 'medium' | 'large' | 'massive';

export type VeinType = 'primary' | 'secondary' | 'trace';

export interface AsteroidVein {
  id: string;
  veinType: VeinType;
  resourceKey: ResourceKey;
  /** Resource units not yet committed to a mining cycle. */
  remainingAmount: number;
  /** Generated reserve of this vein. */
  initialAmount: number;
}

export interface Asteroid {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  /** Size category determines the generated reserve range. */
  size: AsteroidSize;
  createdAt: string;
  updatedAt: string;
}

export interface VisibleAsteroid {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  /** False outside scanner coverage: only the position is known, details below are null. */
  scanned: boolean;
  size: AsteroidSize | null;
  /** Primary vein resource — used for map color rendering */
  primaryResourceKey: ResourceKey | null;
  /** Remaining share of the generated reserve (0–1); the map shrinks mined-out asteroids. */
  remainingFraction: number | null;
}

export interface AsteroidDetailAssignment {
  id: string;
  /** Null for other players' miners: their station stays as hidden as the scanner says. */
  stationId: string | null;
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

export interface AsteroidDetail extends Omit<Asteroid, 'size'> {
  /** False outside scanner coverage: size and veins stay unknown until own miners work it. */
  scanned: boolean;
  size: AsteroidSize | null;
  veins: AsteroidVein[];
  /** Exact operations are visible only while the requesting player has ships here. */
  operationsVisible: boolean;
  assignments: AsteroidDetailAssignment[];
  /** Resources claimed by mining groups and currently returning from this asteroid */
  inTransit: Record<string, number>;
}
