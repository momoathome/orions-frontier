// ============================================================================
// world-gen/types.ts
// All generation-result interfaces. AsteroidSize, VeinType and PurityTier are
// imported from @orions-frontier/shared — single source of truth.
// ============================================================================

import type { AsteroidSize, VeinType, PurityTier } from '@orions-frontier/shared';

export type { AsteroidSize, VeinType, PurityTier };

export interface GeneratedVein {
  veinType: VeinType;
  resourceKey: string;
  yieldPerHour: number;
  purity: number;
  purityTier: PurityTier;
}

export interface GeneratedAsteroid {
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  size: AsteroidSize;
  stability: number;
  /** Always 0 — column kept in DB for future scanner gameplay. */
  hiddenLevel: number;
  veins: GeneratedVein[];
}

export interface GeneratedSpawnSlot {
  slotIndex: number;
  x: number;
  y: number;
}

/** Sector-level point of interest (foundation — placement logic is future work). */
export interface GeneratedPOI {
  poiId: string;
  x: number;
  y: number;
}

/** Metadata about one field cluster generated within a sector. */
export interface GeneratedField {
  shapeKey: string;
  primaryResource: string;
  asteroidCount: number;
}

export interface GeneratedSector {
  sectorX: number;
  sectorY: number;
  /** Always 'none' — kept for DB schema compatibility. */
  archetypeId: string;
  seed: string;
  gameplayTags: string[];
  asteroids: GeneratedAsteroid[];
  spawnSlots: GeneratedSpawnSlot[];
  pois: GeneratedPOI[];
  /** Field clusters generated in this sector — one entry per shape cluster. */
  fields: GeneratedField[];
}
