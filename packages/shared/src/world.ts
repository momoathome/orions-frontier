import type { BuildingKey } from './building.js';
import type { DefenseUpgradeKey } from './defense.js';
import type { ResourceMap } from './resource.js';
import type { SpacecraftRole } from './station-spacecraft.js';

export type StationVisualTier = 0 | 1 | 2 | 3;

export interface StationVisualProfile {
  scaleTier: StationVisualTier;
  modules: Record<BuildingKey, StationVisualTier>;
  defense: Record<DefenseUpgradeKey, StationVisualTier>;
  traffic: {
    civilian: StationVisualTier;
    military: StationVisualTier;
  };
}

export interface VisibleStation {
  id: string;
  name: string;
  x: number;
  y: number;
  chunkX: number;
  chunkY: number;
  ownerType: 'player' | 'bot';
  ownerId: string;
  isOwn: boolean;
  /** False outside scanner coverage: the visual profile is a neutral placeholder. */
  scanned: boolean;
  visualProfile: StationVisualProfile;
  /** Exact for own stations, rounded up to a quarter when scanned, null outside coverage. */
  integrity: number | null;
}

/** Influence points per investment category; `total` is their sum. */
export interface InfluenceBreakdown {
  buildings: number;
  research: number;
  defense: number;
  fleet: number;
  total: number;
}

/** One row of the server-wide ranking (GET /api/world/ranking); public data only. */
export interface RankingEntry {
  rank: number;
  userId: string;
  username: string;
  ownerType: 'player' | 'bot';
  stationCount: number;
  /** Total Influence; how others split it across categories stays private. */
  influence: number;
}

export interface Ranking {
  top: RankingEntry[];
  /** The requesting player's own row with its breakdown; null until they found a station. */
  me: (RankingEntry & { breakdown: InfluenceBreakdown }) | null;
  totalPlayers: number;
}

export type WorldTripPurpose =
  | 'mine'
  | 'mining_return'
  | 'combat'
  | 'combat_return'
  | 'expedition'
  | 'colonization'
  | 'salvage'
  | 'salvage_return'
  | 'relocate';

export type TripEndpointType = 'station' | 'asteroid' | 'debris';

/** Row of GET /me/trips: a traveling trip of one of the player's own stations. */
export interface UserTrip {
  id: string;
  groupSize: number;
  fromType: TripEndpointType;
  fromId: string;
  toType: TripEndpointType;
  toId: string;
  departedAt: string;
  arrivesAt: string;
  purpose: WorldTripPurpose;
  cargoManifest: ResourceMap | null;
  spacecraft: {
    role: SpacecraftRole;
    speed: number;
    cargo: number;
    name: string;
    image: string;
  } | null;
}

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
  /** Start of the mining phase; only set on mining_return trips. */
  miningStartedAt?: string;
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
  /** Null outside scanner coverage: an anonymous civil contact. */
  signature: SpacecraftRole | null;
}

export type VisibleWorldMovement = OwnWorldTrip | RadarContact;
