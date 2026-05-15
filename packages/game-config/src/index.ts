// ============================================================================
// Game Configuration
// Diese Datei enthält die Spielkonfiguration und Balancing-Werte.
// In späteren Phasen wird dies erweitert.
// ============================================================================

export { resources } from './resources.js';

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

// ============================================================================
// Placeholder Configurations (erweitert in späteren Phasen)
// ============================================================================

export const BUILDINGS: Record<string, BuildingConfig> = {
  metal_mine: {
    id: 'metal_mine',
    name: 'Metallmine',
    description: 'Fördert Metall aus dem Asteroidenfeld',
    type: 'mine',
    baseCost: {
      metal: 100,
      crystal: 50,
      deuterium: 0,
    },
    baseTime: 60,
    baseProduction: {
      metal: 10,
    },
  },
  crystal_mine: {
    id: 'crystal_mine',
    name: 'Kristallmine',
    description: 'Fördert Kristalle aus dem Asteroidenfeld',
    type: 'mine',
    baseCost: {
      metal: 150,
      crystal: 100,
      deuterium: 0,
    },
    baseTime: 90,
    baseProduction: {
      crystal: 8,
    },
  },
};

export const SPACECRAFTS: Record<string, SpacecraftConfig> = {
  fighter: {
    id: 'fighter',
    name: 'Jäger',
    description: 'Leichtes und schnelles Kampfschiff',
    type: 'fighter',
    cost: {
      metal: 200,
      crystal: 100,
      deuterium: 50,
    },
    buildTime: 120,
    stats: {
      attack: 50,
      defense: 20,
      speed: 100,
      cargo: 50,
    },
  },
};

export const RESOURCES: Record<string, ResourceConfig> = {
  metal: {
    id: 'metal',
    name: 'Metall',
    baseValue: 1,
    description: 'Grundlegender Rohstoff für Konstruktionen',
  },
  crystal: {
    id: 'crystal',
    name: 'Kristall',
    baseValue: 2,
    description: 'Wertvoller Rohstoff für fortgeschrittene Technologie',
  },
  deuterium: {
    id: 'deuterium',
    name: 'Deuterium',
    baseValue: 3,
    description: 'Treibstoff für Raumschiffe',
  },
  energy: {
    id: 'energy',
    name: 'Energie',
    baseValue: 1,
    description: 'Notwendig für den Betrieb von Gebäuden',
  },
};

export const GAME_CONFIG = {
  START_RESOURCES: {
    metal: 1000,
    crystal: 500,
    deuterium: 100,
    energy: 0,
  },
  QUEUE_TICK_INTERVAL_MS: 1000,
  MAX_BUILD_QUEUE_SIZE: 10,
  MAX_RESEARCH_QUEUE_SIZE: 5,
} as const;
