// ============================================================================
// world-gen/types.ts
// All generation-result interfaces. AsteroidSize and VeinType are
// imported from @orions-frontier/shared — single source of truth.
// ============================================================================

import type { AsteroidSize, VeinType } from '@orions-frontier/shared';

export type { AsteroidSize, VeinType };

export interface GeneratedVein {
  veinType: VeinType;
  resourceKey: string;
  remainingAmount: number;
}

export interface GeneratedAsteroid {
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  size: AsteroidSize;
  /** Always 0 — column kept in DB for future scanner gameplay. */
  hiddenLevel: number;
  veins: GeneratedVein[];
}

export interface GeneratedSpawnSlot {
  slotIndex: number;
  x: number;
  y: number;
}

export interface GeneratedSector {
  sectorX: number;
  sectorY: number;
  /** Always 'none' — kept for DB schema compatibility. */
  archetypeId: string;
  seed: string;
  asteroids: GeneratedAsteroid[];
  spawnSlots: GeneratedSpawnSlot[];
}
