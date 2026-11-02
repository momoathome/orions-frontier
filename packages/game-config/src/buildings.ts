import { required } from '@orions-frontier/shared';
import { LAB_SPEED_PER_LEVEL } from './research.js';
import { applyBuildingCostDiscount } from './research-effects.js';
import { scaledUpgradeCosts, type UpgradeCostConfig } from './upgrade-cost.js';
import type {
  BuildingKey,
  BuildingEffectType,
  BuildingUpgradeCost,
  BuildingEffect,
} from '@orions-frontier/shared';

// Seed Definition

export interface BuildingSeedDefinition {
  key: BuildingKey;
  name: string;
  description: string;
  image: string | null;
  baseBuildTime: number; // seconds for level 1
  maxLevel: number;
  effectType: BuildingEffectType;
}

export const buildings: BuildingSeedDefinition[] = [
  {
    key: 'core',
    name: 'Core',
    description:
      'The heart of your station. Each level speeds up building and defense upgrades by 2%.',
    image: '/assets/buildings/core.webp',
    baseBuildTime: 60,
    maxLevel: 20,
    effectType: 'construction_speed',
  },
  {
    key: 'shipyard',
    name: 'Shipyard',
    description:
      'Constructs spacecraft. Higher levels unlock ship classes, build faster and add production slots at levels 5 and 10.',
    image: '/assets/buildings/shipyard.webp',
    baseBuildTime: 90,
    maxLevel: 15,
    effectType: 'production_slots',
  },
  {
    key: 'warehouse',
    name: 'Warehouse',
    description: 'Expands resource storage capacity and protects stored goods from raids.',
    image: '/assets/buildings/warehouse.webp',
    baseBuildTime: 45,
    maxLevel: 20,
    effectType: 'storage_capacity',
  },
  {
    key: 'scanner',
    name: 'Scanner',
    description:
      'Extends the circular detection range around this station for asteroids, wreckage and hostile vessels.',
    image: '/assets/buildings/scanner.webp',
    baseBuildTime: 60,
    maxLevel: 15,
    effectType: 'scanner_range',
  },
  {
    key: 'hangar',
    name: 'Hangar',
    description: 'Expands crew capacity, allowing the station to operate additional spacecraft.',
    image: '/assets/buildings/hangar.webp',
    baseBuildTime: 120,
    maxLevel: 20,
    effectType: 'hangar_capacity',
  },
  {
    key: 'laboratory',
    name: 'Laboratory',
    description:
      'Opens research tiers and caps research levels. Each level above 1 shortens research by 2%.',
    image: '/assets/buildings/laboratory.webp',
    baseBuildTime: 90,
    maxLevel: 15,
    effectType: 'research_speed',
  },
];

export const getBuilding = (key: BuildingKey) =>
  required(
    buildings.find((building) => building.key === key),
    `building ${key}`
  );

// Upgrade Cost Config

const UPGRADE_COST_CONFIG: Record<BuildingKey, UpgradeCostConfig> = {
  core: {
    factor: 1.6,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 300 },
      { resourceKey: 'titanium', baseAmount: 200 },
      { resourceKey: 'kyber_crystal', baseAmount: 40, unlocksAtLevel: 5 },
      { resourceKey: 'astatine', baseAmount: 20, unlocksAtLevel: 10 },
    ],
  },
  shipyard: {
    factor: 1.5,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 240 },
      { resourceKey: 'titanium', baseAmount: 160 },
      { resourceKey: 'hydrogenium', baseAmount: 60, unlocksAtLevel: 5 },
      { resourceKey: 'kyber_crystal', baseAmount: 30, unlocksAtLevel: 8 },
    ],
  },
  warehouse: {
    factor: 1.45,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 160 },
      { resourceKey: 'titanium', baseAmount: 120 },
      { resourceKey: 'hydrogenium', baseAmount: 40, unlocksAtLevel: 7 },
    ],
  },
  scanner: {
    factor: 1.5,
    resourceCosts: [
      { resourceKey: 'carbon', baseAmount: 180 },
      { resourceKey: 'titanium', baseAmount: 140 },
      { resourceKey: 'hydrogenium', baseAmount: 50, unlocksAtLevel: 6 },
      { resourceKey: 'kyber_crystal', baseAmount: 20, unlocksAtLevel: 10 },
    ],
  },
  hangar: {
    factor: 1.55,
    resourceCosts: [
      { resourceKey: 'titanium', baseAmount: 300 },
      { resourceKey: 'hydrogenium', baseAmount: 80 },
      { resourceKey: 'kyber_crystal', baseAmount: 40, unlocksAtLevel: 5 },
      { resourceKey: 'astatine', baseAmount: 30, unlocksAtLevel: 10 },
    ],
  },
  laboratory: {
    factor: 1.5,
    resourceCosts: [
      // Kyber and Astatine only after the levels that open Spectral and Deep Spectral Analysis.
      { resourceKey: 'carbon', baseAmount: 200 },
      { resourceKey: 'titanium', baseAmount: 150 },
      { resourceKey: 'hydrogenium', baseAmount: 80, unlocksAtLevel: 2 },
      { resourceKey: 'kyber_crystal', baseAmount: 30, unlocksAtLevel: 5 },
      { resourceKey: 'astatine', baseAmount: 15, unlocksAtLevel: 9 },
    ],
  },
};

/**
 * Calculates the resource costs required to upgrade a building to targetLevel.
 * targetLevel must be >= 2 (upgrading from level targetLevel-1 to targetLevel).
 */
export function calculateBuildingUpgradeCost(
  buildingKey: BuildingKey,
  targetLevel: number
): BuildingUpgradeCost[] {
  return scaledUpgradeCosts(UPGRADE_COST_CONFIG[buildingKey], targetLevel);
}

/** What the player pays: the upgrade cost after the Nanite Assembly factor (research `buildingCost`). */
export const discountedBuildingUpgradeCost = (
  buildingKey: BuildingKey,
  targetLevel: number,
  costFactor: number
): BuildingUpgradeCost[] =>
  applyBuildingCostDiscount(calculateBuildingUpgradeCost(buildingKey, targetLevel), costFactor);

// Build Time Calculation

/**
 * Returns the build time in seconds for upgrading to targetLevel, before Core and research speed-ups.
 * Scales exponentially from baseBuildTime: buildTime = base * 1.45^(targetLevel-1)
 */
export function calculateBuildingBuildTime(buildingKey: BuildingKey, targetLevel: number): number {
  const def = buildings.find((b) => b.key === buildingKey);
  if (!def) return 60;
  return Math.round(def.baseBuildTime * Math.pow(1.45, targetLevel - 1));
}

// Effect Calculation

/**
 * Calculates explicit building effects for a given level.
 * All effects are deterministic — no generic modifier engine.
 */
export function calculateBuildingEffect(buildingKey: BuildingKey, level: number): BuildingEffect[] {
  switch (buildingKey) {
    case 'core':
      return [{ type: 'construction_speed', value: calculateConstructionSpeedBonus(level) }];

    case 'shipyard':
      return [
        { type: 'production_slots', value: calculateProductionSlots(level) },
        { type: 'spacecraft_production_bonus', value: calculateShipyardBuildBonus(level) },
      ];

    case 'warehouse':
      return [
        { type: 'storage_capacity', value: calculateStorageCapacity(level) },
        { type: 'protected_storage', value: calculateProtectedStorage(level) },
      ];

    case 'scanner':
      return [{ type: 'scanner_range', value: calculateScannerRange(level) }];

    case 'hangar':
      return [{ type: 'hangar_capacity', value: calculateHangarCapacity(level) }];

    case 'laboratory':
      return [{ type: 'research_speed', value: (Math.max(1, level) - 1) * LAB_SPEED_PER_LEVEL }];
  }
}

/** Percent the Core takes off building and defense upgrade times; level 1 is the baseline. */
export const calculateConstructionSpeedBonus = (coreLevel: number): number =>
  Math.max(0, coreLevel - 1) * 2;

/**
 * +500 up to level 4, then +200: the scanner identifies, it does not gate sight, so late levels
 * grow to about one sector (6,000 wide) instead of far past it.
 */
export const calculateScannerRange = (level: number): number =>
  level <= 0 ? 0 : 1_000 + Math.min(level - 1, 3) * 500 + Math.max(level - 4, 0) * 200;

/** Ships the Shipyard builds at the same time. */
export const calculateProductionSlots = (shipyardLevel: number): number =>
  1 + Number(shipyardLevel >= 5) + Number(shipyardLevel >= 10);

/** Percent the Shipyard takes off ship build times. */
export const calculateShipyardBuildBonus = (shipyardLevel: number): number => shipyardLevel * 3;

/** Per resource. Grows with upgrade costs so the next upgrade always fits and storage lasts overnight. */
export const calculateStorageCapacity = (warehouseLevel: number): number =>
  Math.round((5000 * 1.45 ** (warehouseLevel - 1)) / 100) * 100;

/** Stock per resource that attackers cannot loot. */
export const calculateProtectedStorage = (warehouseLevel: number): number => warehouseLevel * 100;

/**
 * Crew places provided by a station hangar; the square term keeps late levels worth their cost,
 * and the 1.25 leaves room for a strike force beside the miners.
 */
export const calculateHangarCapacity = (hangarLevel: number): number =>
  Math.floor((10 + hangarLevel * 10 + Math.max(0, hangarLevel - 1) ** 2) * 1.25);

/** Crew the hangar holds once Fleet Coordination (`crewFactor`) is applied. */
export const calculateCrewCapacity = (hangarLevel: number, crewFactor: number): number =>
  Math.floor(calculateHangarCapacity(hangarLevel) * crewFactor);
