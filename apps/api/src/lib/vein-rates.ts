import { WORLD_CONFIG } from './world-config.js';

// ============================================================================
// Vein Rate Utilities — single source of truth for all mining rate math
//
// Consumed by:
//   services/mining/mining-tick.service.ts     — per-assignment production tick
//   services/mining/asteroid-lifecycle.service.ts — stability load calculation
//   services/station-resource.service.ts       — aggregated rate for TopHud
//
// The normalization rule: miners spread their power proportionally across all
// veins that are actually present on the asteroid, so a single-vein asteroid
// receives 100 % of mining power, not just 70 % (primary fraction).
// ============================================================================

export interface VeinRateInput {
  veinType: string;
  purity: number;
  yieldPerHour: number;
  resourceKey: string;
}

/** Raw allocation fraction for a vein type (falls back to primary). */
export function veinAlloc(veinType: string): number {
  return (
    (WORLD_CONFIG.VEIN_MODIFIER as Record<string, number>)[veinType] ??
    WORLD_CONFIG.VEIN_MODIFIER.primary
  );
}

/**
 * Effective mining rate (units/h) for a single vein.
 *
 * @param totalMiningRate  Combined miningRate × assignedAmount for ALL miners on the asteroid
 * @param vein             Vein data (type, purity, yieldPerHour cap, resourceKey)
 * @param allocation       Normalized fraction (0–1) already accounted for present veins.
 *                         If omitted, the raw VEIN_MODIFIER fraction is used (non-normalized).
 */
export function calcVeinRate(
  totalMiningRate: number,
  vein: VeinRateInput,
  allocation?: number
): number {
  const resolvedAlloc = allocation ?? veinAlloc(vein.veinType);
  const miningPower = totalMiningRate * resolvedAlloc;
  return (
    Math.min(miningPower * vein.purity, vein.yieldPerHour) * WORLD_CONFIG.MINING_RATE_MULTIPLIER
  );
}

/**
 * Compute effective mining rates per resource key for a set of veins.
 *
 * Normalizes allocations across the veins actually present so that a single-vein
 * asteroid doesn't waste 30 % of mining power.
 *
 * @param combinedMiningRate  Sum of (miningRate × assignedAmount) across ALL assignments
 * @param veins               All veins present on the asteroid
 * @returns                   { resourceKey: units/h }
 */
export function calcMiningRatesByResource(
  combinedMiningRate: number,
  veins: VeinRateInput[]
): Record<string, number> {
  if (combinedMiningRate <= 0 || veins.length === 0) return {};
  const allocSum = veins.reduce((s, v) => s + veinAlloc(v.veinType), 0);
  const result: Record<string, number> = {};
  for (const vein of veins) {
    const normalizedAlloc = veinAlloc(vein.veinType) / (allocSum || 1);
    const rate = calcVeinRate(combinedMiningRate, vein, normalizedAlloc);
    result[vein.resourceKey] = (result[vein.resourceKey] ?? 0) + rate;
  }
  return result;
}

/**
 * Compute the total mining load vs yield cap for stability calculations.
 *
 * Used by applyAsteroidStabilityTick to determine if miners are over-extracting.
 *
 * @returns  { totalMiningLoad, totalYieldCap } — compare to determine stability direction
 */
export function calcMiningLoad(
  combinedMiningRate: number,
  veins: { veinType: string; yieldPerHour: number }[]
): { totalMiningLoad: number; totalYieldCap: number } {
  const allocSum = veins.reduce((s, v) => s + veinAlloc(v.veinType), 0);
  let totalMiningLoad = 0;
  let totalYieldCap = 0;
  for (const vein of veins) {
    const allocation = veinAlloc(vein.veinType) / (allocSum || 1);
    totalMiningLoad += combinedMiningRate * allocation;
    totalYieldCap += vein.yieldPerHour;
  }
  return { totalMiningLoad, totalYieldCap };
}
