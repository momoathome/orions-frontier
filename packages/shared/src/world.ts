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

export type WorldTripPurpose =
  | 'mine'
  | 'mining_return'
  | 'combat'
  | 'combat_return'
  | 'expedition'
  | 'colonization'
  | 'salvage'
  | 'salvage_return';

export interface OwnWorldTrip {
  kind: 'own_trip';
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  departedAt: string;
  arrivesAt: string;
  purpose: WorldTripPurpose;
  groupSize: number;
  ownerType: 'player' | 'bot';
  spacecraft: {
    name: string;
    image: string | null;
    role: SpacecraftRole;
  };
}

export interface RadarContact {
  kind: 'radar_contact';
  id: string;
  x: number;
  y: number;
  observedAt: string;
  /** World units per second. */
  velocityX: number;
  /** World units per second. */
  velocityY: number;
  signature: SpacecraftRole;
}

export type VisibleWorldMovement = OwnWorldTrip | RadarContact;
