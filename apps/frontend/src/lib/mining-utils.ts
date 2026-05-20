import type { AsteroidVein } from '@orions-frontier/shared';
import { VEIN_MODIFIER } from '@orions-frontier/shared';

// ── Constants ────────────────────────────────────────────────────────────────

/** Single source of truth: imported from @orions-frontier/shared (same as backend). */
export const VEIN_ALLOCATION: Record<string, number> = VEIN_MODIFIER;

/** Must stay in sync with WORLD_CONFIG.MINING_RATE_MULTIPLIER in world-config.ts */
export const MINING_RATE_MULTIPLIER = 1;

export const STABILITY_DEGRADATION_PER_HOUR = 0.05;
export const STABILITY_REGEN_PER_HOUR = 0.01;

export const RESOURCE_COLORS: Record<string, string> = {
  carbon: '#778899',
  titanium: '#6699bb',
  hydrogenium: '#22ccee',
  kyber_crystal: '#aa33ff',
  astatine: '#ff5533',
};

export const RESOURCE_NAMES: Record<string, string> = {
  carbon: 'Carbon',
  titanium: 'Titanium',
  hydrogenium: 'Hydrogenium',
  kyber_crystal: 'Kyber Crystal',
  astatine: 'Astatine',
};
export const SIZE_LABELS: Record<string, string> = {
  small: 'S',
  medium: 'M',
  large: 'L',
  massive: 'X',
};

// ── Display helpers ───────────────────────────────────────────────────────────

export function resourceColor(key: string | null): string {
  return key ? (RESOURCE_COLORS[key] ?? '#888888') : '#888888';
}

export function resourceName(key: string): string {
  return RESOURCE_NAMES[key] ?? key.toUpperCase();
}

export function stabilityColor(s: number): string {
  if (s >= 0.8) return '#44ddaa';
  if (s >= 0.5) return '#ffdd00';
  return '#ff5533';
}

// ── Rate calculations ─────────────────────────────────────────────────────────

/**
 * Compute effective mining rate per resource (units/h).
 * Stability does NOT affect the yield — it only drives the degradation mechanic.
 */
export function calcEffectiveRateByResource(
  totalMiningPower: number,
  veins: AsteroidVein[],
): Record<string, number> {
  if (totalMiningPower === 0) return {};
  const allocSum = veins.reduce((s, v) => s + (VEIN_ALLOCATION[v.veinType] ?? 0.7), 0);
  const result: Record<string, number> = {};
  for (const vein of veins) {
    const allocation = (VEIN_ALLOCATION[vein.veinType] ?? 0.7) / (allocSum || 1);
    const cappedRate = Math.min(totalMiningPower * allocation * vein.purity, vein.yieldPerHour);
    result[vein.resourceKey] =
      (result[vein.resourceKey] ?? 0) + cappedRate * MINING_RATE_MULTIPLIER;
  }
  return result;
}

/**
 * Sum of effective rates across all resources for an asteroid.
 */
export function calcTotalEffectiveRate(
  totalMiningPower: number,
  veins: AsteroidVein[],
): number {
  return Object.values(calcEffectiveRateByResource(totalMiningPower, veins)).reduce(
    (sum, r) => sum + r,
    0,
  );
}

/**
 * Stability change per hour based on mining load vs yield cap.
 * Returns null if there are no assignments.
 */
export function calcStabilityChangePerHour(
  totalMiningPower: number,
  veins: AsteroidVein[],
  hasAssignments: boolean,
): number | null {
  if (!hasAssignments) return null;
  const allocSum = veins.reduce((s, v) => s + (VEIN_ALLOCATION[v.veinType] ?? 0.7), 0);
  let totalMiningLoad = 0;
  let totalYieldCap = 0;
  for (const vein of veins) {
    const allocation = (VEIN_ALLOCATION[vein.veinType] ?? 0.7) / (allocSum || 1);
    totalMiningLoad += totalMiningPower * allocation;
    totalYieldCap += vein.yieldPerHour;
  }
  if (totalYieldCap === 0) return null;
  return totalMiningLoad > totalYieldCap
    ? -STABILITY_DEGRADATION_PER_HOUR * (totalMiningLoad / totalYieldCap)
    : STABILITY_REGEN_PER_HOUR;
}
