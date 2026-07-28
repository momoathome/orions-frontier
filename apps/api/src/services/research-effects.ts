import { hasCompletedResearch, type QueryDb } from './research.service.js';

const EXTRACTION_ALGORITHMS = 'extraction_algorithms';
const MODULAR_CARGO_FRAMES = 'modular_cargo_frames';
const VECTOR_NAVIGATION = 'vector_navigation';
const COMBAT_ANALYTICS = 'combat_analytics';

/** Returns the effective mining rate for a miner at the given station. */
export async function effectiveMiningRate(
  db: QueryDb,
  stationId: string,
  baseRate: number
): Promise<number> {
  if (await hasCompletedResearch(db, stationId, EXTRACTION_ALGORITHMS)) {
    return baseRate * 1.1;
  }
  return baseRate;
}

/** Returns the effective cargo capacity for a miner or salvager at the given station. */
export async function effectiveCargoCapacity(
  db: QueryDb,
  stationId: string,
  baseCargo: number,
  role: 'miner' | 'salvager'
): Promise<number> {
  if (role === 'miner' || role === 'salvager') {
    if (await hasCompletedResearch(db, stationId, MODULAR_CARGO_FRAMES)) {
      return baseCargo * 1.1;
    }
  }
  return baseCargo;
}

/**
 * Adjusts a `calcArrivesAt` timestamp if the station has completed vector_navigation.
 * Should be called right after creating a new trip arrival time.
 */
export async function applyVectorNavigation(
  db: QueryDb,
  stationId: string,
  arrivesAt: Date,
  departedAt: Date
): Promise<Date> {
  if (await hasCompletedResearch(db, stationId, VECTOR_NAVIGATION)) {
    const originalDuration = arrivesAt.getTime() - departedAt.getTime();
    return new Date(departedAt.getTime() + Math.round(originalDuration * 0.9));
  }
  return arrivesAt;
}

/**
 * Returns the effective attack power for a fighter from the given station.
 */
export async function effectiveAttackPower(
  db: QueryDb,
  stationId: string,
  baseAttack: number
): Promise<number> {
  if (await hasCompletedResearch(db, stationId, COMBAT_ANALYTICS)) {
    return baseAttack * 1.1;
  }
  return baseAttack;
}

/**
 * Returns the upgrade end timestamp with station_grid_optimization applied.
 */
export function applyGridOptimization(hasResearch: boolean, baseUpgradeEndsAt: Date): Date {
  if (hasResearch) {
    const now = Date.now();
    const baseDuration = baseUpgradeEndsAt.getTime() - now;
    return new Date(now + Math.round(baseDuration * 0.9));
  }
  return baseUpgradeEndsAt;
}
