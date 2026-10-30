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
  calculateConstructionSpeedBonus,
  calculateHangarCapacity,
  calculateScannerRange,
  calculateProductionSlots,
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
export {
  calculateResearchCost,
  calculateResearchDuration,
  getResearchDefinition,
  isResearchKey,
  LAB_SPEED_PER_LEVEL,
  requireResearchDefinition,
  requirementBlockers,
  researchBlockers,
  researchDefinitions,
  researchRequirements,
  RESEARCH_TIERS,
  unlocksByBuildingLevel,
} from './research.js';
export { applyBuildingCostDiscount, researchModifiers } from './research-effects.js';
export type { ResearchModifiers } from './research-effects.js';
export {
  calculateInfluence,
  INFLUENCE_FLEET_SHARE,
  INFLUENCE_RESOURCES_PER_POINT,
} from './influence.js';
export type { InfluenceInput } from './influence.js';
