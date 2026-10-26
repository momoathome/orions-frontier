import type { AsteroidSize, ResourceKey, VeinType } from '@orions-frontier/shared';

export type { AsteroidSize, VeinType };
export type SectorRole = 'settlement' | 'frontier';
export type SpawnSlotType = 'player' | 'bot';

export interface GeneratedVein {
  veinType: VeinType;
  resourceKey: ResourceKey;
  remainingAmount: number;
}

export interface GeneratedAsteroid {
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  size: AsteroidSize;
  veins: GeneratedVein[];
}

export interface GeneratedSpawnSlot {
  slotIndex: number;
  slotType: SpawnSlotType;
  x: number;
  y: number;
}

export interface GeneratedSector {
  sectorX: number;
  sectorY: number;
  role: SectorRole;
  seed: string;
  asteroids: GeneratedAsteroid[];
  spawnSlots: GeneratedSpawnSlot[];
}
