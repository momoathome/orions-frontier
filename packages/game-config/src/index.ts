export {
  COLONIZATION_COST,
  ATTACK_PROTECTION_DURATION_MS,
  calculateColonizationCost,
  resources,
} from './resources.js';
export {
  currentIntegrity,
  integrityWaveDamage,
  coarseIntegrity,
  MAX_STATION_INTEGRITY,
} from './integrity.js';
export { getSpacecraft, requireSpacecraft, spacecrafts } from './spacecrafts.js';
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
export {
  calculateInfluence,
  INFLUENCE_FLEET_SHARE,
  INFLUENCE_RESOURCES_PER_POINT,
} from './influence.js';
export type { InfluenceInput } from './influence.js';
