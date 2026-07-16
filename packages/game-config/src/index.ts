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
