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
// Asteroid World Types
// ============================================================================

/**
 * Resource type found in an asteroid.
 * Uses the same keys as the rest of the resource system.
 */
export type AsteroidResourceType = ResourceKey;

/**
 * A chunk coordinate in the spatial partitioning grid.
 * Chunks are purely technical — not gameplay sectors.
 */
export interface ChunkCoordinate {
  x: number;
  y: number;
}

/**
 * Persistent asteroid instance in the world.
 */
export interface Asteroid {
  id: string;
  /** Global world coordinate */
  x: number;
  /** Global world coordinate */
  y: number;
  /** Derived spatial chunk coordinate */
  chunkX: number;
  /** Derived spatial chunk coordinate */
  chunkY: number;
  resourceType: AsteroidResourceType;
  /** Mining richness 1–100 */
  richness: number;
  /** Minimum scanner strength required to detect this asteroid */
  hiddenLevel: number;
  clusterId: string | null;
  isDepleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Asteroid cluster — a world generation influence zone.
 * Clusters bias asteroid density and resource type in a radius.
 * NOT a gameplay sector.
 */
export interface AsteroidCluster {
  id: string;
  name: string;
  centerX: number;
  centerY: number;
  radius: number;
  resourceBias: AsteroidResourceType;
  /** Seed string for deterministic procedural generation */
  seed: string;
  createdAt: string;
}

/**
 * Asteroid as returned by the chunk loading API.
 * Only visible asteroids (scanner_strength >= hidden_level) are included.
 */
export interface VisibleAsteroid {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  resourceType: AsteroidResourceType;
  richness: number;
  isVisible: true;
}

/**
 * Full asteroid detail returned by the GET /asteroids/:id API.
 * Includes all fields plus derived mining placeholder values.
 */
export interface AsteroidDetail {
  id: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  resourceType: AsteroidResourceType;
  richness: number;
  hiddenLevel: number;
  isDepleted: boolean;
  clusterId: string | null;
  /** Deterministic 0-100 stability score derived from asteroid id */
  stability: number;
  createdAt: string;
  updatedAt: string;
  /** Placeholder mining stats — not yet implemented */
  activeMiningAssignments: number;
  currentMiningRate: number;
  estimatedYield: number;
}
