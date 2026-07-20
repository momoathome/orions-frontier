import type { ResourceKey } from './resource.js';

// ============================================================================
// Vein Allocation
//
// Fraction of a miner's power directed at each vein type.
// Single source of truth — imported by API (world-config) and frontend (mining-utils).
// ============================================================================

export const VEIN_MODIFIER = {
  primary: 0.7,
  secondary: 0.25,
  trace: 0.05,
} as const;

// ============================================================================
// Asteroid Core Types
// ============================================================================

export type AsteroidSize = 'small' | 'medium' | 'large' | 'massive';

export type VeinType = 'primary' | 'secondary' | 'trace';

// ============================================================================
// Asteroid Vein
// ============================================================================

export interface AsteroidVein {
  id: string;
  veinType: VeinType;
  resourceKey: ResourceKey;
  /** Resource units not yet committed to a mining cycle. */
  remainingAmount: number;
}

// ============================================================================
// Asteroid
// ============================================================================

export interface Asteroid {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  /** Size category determines reserve range and mining slot count */
  size: AsteroidSize;
  hiddenLevel: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// VisibleAsteroid — returned by the chunk loading API
// Minimal data for map rendering. Only visible asteroids are included.
// ============================================================================

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

// ============================================================================
// AsteroidDetailAssignment — extended assignment row returned inside AsteroidDetail
// ============================================================================

export interface AsteroidDetailAssignment {
  id: string;
  stationId: string;
  spacecraftDefinitionId: string;
  spacecraftName: string;
  spacecraftMiningRate: number;
  /** Cargo capacity per single spacecraft of this type */
  spacecraftCargo: number;
  assignedAmount: number;
  assignedAt: string;
  recallRequestedAt: string | null;
}

// ============================================================================
// AsteroidDetail — returned by GET /asteroids/:id
// Full detail including veins and assignments.
// ============================================================================

export interface AsteroidDetail extends Asteroid {
  veins: AsteroidVein[];
  assignments: AsteroidDetailAssignment[];
  /** Resources claimed by mining groups and currently returning from this asteroid */
  inTransit: Record<string, number>;
}
