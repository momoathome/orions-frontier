import type { SpacecraftRole } from './station-spacecraft.js';

export interface VisibleStation {
  id: string;
  name: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  ownerType: 'player' | 'bot';
  isOwn: boolean;
}

export interface VisibleWorldTrip {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  departedAt: string;
  arrivesAt: string;
  purpose:
    | 'mine'
    | 'mining_return'
    | 'combat'
    | 'combat_return'
    | 'expedition'
    | 'colonization'
    | 'salvage'
    | 'salvage_return';
  /** Exact fleet size is private to its owner. */
  groupSize: number | null;
  ownerType: 'player' | 'bot';
  spacecraft: {
    name: string;
    image: string | null;
    role: SpacecraftRole;
  };
}
