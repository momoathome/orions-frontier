import type { ResourceMap } from './resource.js';

/** Resource balance and recent deliveries for one station. */
export interface UserResourceSummary {
  /** Current resource amounts of one station */
  resources: ResourceMap;
  /** Resources delivered during the last hour */
  rates: ResourceMap;
  /** Maximum amount stored per individual resource. */
  storageCapacity: number;
}

export interface CostShortfall {
  /** Missing amount per resource; empty when the cost is affordable now. */
  missing: { resourceKey: string; amount: number }[];
  /** Hours until recent income covers the gap; Infinity when a missing resource has no income. */
  hoursUntilAffordable: number;
}

/** What a cost lacks against current stock, and when the last hour's income would close the gap. */
export function getCostShortfall(
  costs: readonly { resourceKey: string; amount: number }[],
  stock: Partial<Record<string, number>>,
  ratesPerHour: Partial<Record<string, number>>
): CostShortfall {
  const missing = costs
    .map((cost) => ({
      resourceKey: cost.resourceKey,
      amount: Math.ceil(cost.amount - (stock[cost.resourceKey] ?? 0)),
    }))
    .filter((entry) => entry.amount > 0);
  const hoursUntilAffordable = missing.reduce((hours, entry) => {
    const rate = ratesPerHour[entry.resourceKey] ?? 0;
    return Math.max(hours, rate > 0 ? entry.amount / rate : Infinity);
  }, 0);
  return { missing, hoursUntilAffordable };
}
