import type { ResourceKey } from './resource.js';

// ============================================================================
// World Architecture Constants
// ============================================================================

/**
 * Size of each spatial chunk in world units.
 * chunk_x = floor(x / CHUNK_SIZE), chunk_y = floor(y / CHUNK_SIZE)
 * Must match the value used in the backend world-gen utility.
 */
export const CHUNK_SIZE = 1000;

// ============================================================================
// Asteroid Core Types
// ============================================================================

export type AsteroidResourceType = ResourceKey;

export type AsteroidSize = 'small' | 'medium' | 'large' | 'massive';

export type VeinType = 'primary' | 'secondary' | 'trace';

export type PurityTier = 'impure' | 'normal' | 'rich' | 'pure' | 'pristine';

export interface ChunkCoordinate {
  x: number;
  y: number;
}

// ============================================================================
// Asteroid Vein
// ============================================================================

export interface AsteroidVein {
  id: string;
  asteroidId: string;
  veinType: VeinType;
  resourceKey: ResourceKey;
  /** Max yield per hour: baseBudget × tierModifier × veinModifier */
  yieldPerHour: number;
  /** Purity multiplier 0.4–3.0, applied to actual miner output */
  purity: number;
  purityTier: PurityTier;
}

// ============================================================================
// Asteroid Resource Storage (local buffer)
// ============================================================================

export interface AsteroidResourceStorage {
  id: string;
  asteroidId: string;
  resourceKey: ResourceKey;
  amount: number;
  updatedAt: string;
}

// ============================================================================
// Asteroid Assignment
// ============================================================================

export interface AsteroidAssignment {
  id: string;
  asteroidId: string;
  stationId: string;
  spacecraftDefinitionId: string;
  assignedAmount: number;
  assignedAt: string;
  lastTick: string;
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
  /** Size category determines yield budget and mining slot count */
  size: AsteroidSize;
  /** Stability 0.0–1.0 — degrades on overmining, regens when load < yield */
  stability: number;
  hiddenLevel: number;
  clusterId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Asteroid Cluster
// ============================================================================

export interface AsteroidCluster {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  radius: number;
  resourceBias: AsteroidResourceType;
  seed: string;
  createdAt: string;
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
  isVisible: true;
}

// ============================================================================
// AsteroidDetail — returned by GET /asteroids/:id
// Full detail including veins, buffer, and assignments.
// ============================================================================

export interface AsteroidDetail extends Asteroid {
  veins: AsteroidVein[];
  storage: AsteroidResourceStorage[];
  /** Count of active assignment rows */
  activeMiningAssignments: number;
}


