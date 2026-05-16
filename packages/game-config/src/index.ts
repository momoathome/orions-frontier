// ============================================================================
// Game Configuration
// Diese Datei enthält die Spielkonfiguration und Balancing-Werte.
// In späteren Phasen wird dies erweitert.
// ============================================================================

export { resources } from './resources.js';
export { spacecrafts } from './spacecrafts.js';
export type { SpacecraftSeedDefinition } from './spacecrafts.js';
export {
  buildings,
  calculateBuildingUpgradeCost,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  getBuildingUnlockMilestones,
  SHIPYARD_UNLOCKS,
} from './buildings.js';
export type { BuildingSeedDefinition } from './buildings.js';

export interface BuildingConfig {
  id: string;
  name: string;
  description: string;
  type: 'mine' | 'factory' | 'defense';
  baseCost: {
    metal: number;
    crystal: number;
    deuterium: number;
  };
  baseTime: number; // in seconds
  baseProduction?: {
    metal?: number;
    crystal?: number;
    deuterium?: number;
    energy?: number;
  };
}

export interface SpacecraftConfig {
  id: string;
  name: string;
  description: string;
  type: 'fighter' | 'cruiser' | 'battleship';
  cost: {
    metal: number;
    crystal: number;
    deuterium: number;
  };
  buildTime: number; // in seconds
  stats: {
    attack: number;
    defense: number;
    speed: number;
    cargo: number;
  };
}

export interface ResourceConfig {
  id: string;
  name: string;
  baseValue: number;
  description: string;
}
