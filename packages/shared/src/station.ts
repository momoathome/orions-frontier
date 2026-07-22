import type { StationVisualProfile } from './world.js';

export interface Station {
  id: string;
  userId: string;
  sectorId: string;
  name: string;
  x: number;
  y: number;
  scannerRange: number;
  visualProfile: StationVisualProfile;
  createdAt: string;
}
