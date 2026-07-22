export { COLONIZATION_COST, resources } from './resources.js';
export { getSpacecraft, spacecrafts } from './spacecrafts.js';
export type { SpacecraftSeedDefinition } from './spacecrafts.js';
export {
  buildings,
  getBuilding,
  calculateBuildingUpgradeCost,
  calculateBuildingBuildTime,
  calculateBuildingEffect,
  calculateHangarCapacity,
  calculateScannerRange,
  SHIPYARD_UNLOCKS,
} from './buildings.js';
export type { BuildingSeedDefinition } from './buildings.js';
export {
  calculateDefenseUpgradeBuildTime,
  calculateDefenseUpgradeCost,
  calculateDefenseUpgradeEffect,
  defenseUpgrades,
  getDefenseUpgrade,
} from './defense.js';
export type { DefenseUpgradeSeedDefinition } from './defense.js';
export { getResearchDefinition, researchDefinitions } from './research.js';
export type { ResearchDefinition } from './research.js';
