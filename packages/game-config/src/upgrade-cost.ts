import type { ResourceKey } from '@orions-frontier/shared';

interface ResourceCostEntry {
  resourceKey: ResourceKey;
  baseAmount: number;
  unlocksAtLevel?: number; // resource is added to cost starting at this level
}

/** Shared by buildings and defense upgrades. */
export interface UpgradeCostConfig {
  resourceCosts: ResourceCostEntry[];
  /** Exponential scale factor applied per level (cost = base * factor^(targetLevel-1)) */
  factor: number;
}

/** Costs of targetLevel: base * factor^(targetLevel-1), rounded to tens, at least 10. */
export function scaledUpgradeCosts(
  config: UpgradeCostConfig,
  targetLevel: number
): { resourceKey: ResourceKey; amount: number }[] {
  const multiplier = Math.pow(config.factor, targetLevel - 1);
  return config.resourceCosts
    .filter((entry) => entry.unlocksAtLevel === undefined || targetLevel >= entry.unlocksAtLevel)
    .map((entry) => ({
      resourceKey: entry.resourceKey,
      amount: Math.max(10, Math.round((entry.baseAmount * multiplier) / 10) * 10),
    }));
}
