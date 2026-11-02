import { entriesOf } from '@orions-frontier/shared';
import type {
  AttackForecast,
  DefenseUpgradeKey,
  StationVisualProfile,
} from '@orions-frontier/shared';
import {
  calculateDefenseUpgradeEffect,
  getDefenseUpgrade,
  type ResearchModifiers,
} from '@orions-frontier/game-config';
import { lootFromStock, resolveBattle } from './battle.js';

/**
 * Upper-bound level for each visual tier.
 * Tier 0 = 0, Tier 1 = 4, Tier 2 = 9, Tier 3 = max level of the upgrade.
 */
function tierMaxLevel(tier: number, upgradeKey: DefenseUpgradeKey): number {
  switch (tier) {
    case 0:
      return 0;
    case 1:
      return 4;
    case 2:
      return 9;
    case 3:
      return getDefenseUpgrade(upgradeKey).maxLevel;
    default:
      return 0;
  }
}

/**
 * Estimate a target station's defense score from its public visual profile.
 *
 * Uses upper-bound tier estimates so neither bots nor players underestimate an opponent's
 * strength (GB-16: "bekannten Obergrenzen der visuellen Tiers").
 */
export function estimateDefenseScore(profile: StationVisualProfile): number {
  let total = 0;

  for (const [key, tier] of entriesOf(profile.defense)) {
    const maxLvl = tierMaxLevel(tier, key);
    const effect = calculateDefenseUpgradeEffect(key, maxLvl);
    total += effect.reduce((s, e) => s + e.value, 0);
  }

  return total;
}

/** A forecast of "high" still wins against this much more defense than the estimate. */
const HIGH_CHANCE_MARGIN = 1.4;

// known-limit: docked defending ships and the defender's research are unseen and left out; lift
// once the scanner reveals them.
const UNSEEN_DEFENDER = { shipDefense: 1, stationDefense: 1 };

/** Leading-digit step that holds the amount: 1,234 → 1,000–2,000, 450 → 400–500. */
export function lootRange(amount: number): { min: number; max: number } {
  const step = 10 ** (String(Math.floor(amount)).length - 1);
  const min = Math.floor(amount / step) * step;
  return { min, max: min + step };
}

/**
 * The battle and plunder rules run against what the scanner shows: the upper estimate of the
 * station defense and the target's current stock. The target keeps producing and may be raided
 * by others before arrival, so the loot is only a range.
 */
export function forecastAttack(
  groups: readonly {
    key: string;
    amount: number;
    spacecraft: { attack: number; defense: number; cargo: number };
  }[],
  targetProfile: StationVisualProfile,
  attackerResearch: Pick<ResearchModifiers, 'attack' | 'shipDefense' | 'cargo'>,
  targetStock: {
    resources: readonly { resourceKey: string; amount: number }[];
    protectedAmount: number;
  }
): AttackForecast {
  const estimatedDefense = estimateDefenseScore(targetProfile);
  const battle = resolveBattle(groups, [], estimatedDefense, attackerResearch, UNSEEN_DEFENDER);
  if (battle.winner === 'defender') return { winChance: 'low', loot: {} };

  const safe = resolveBattle(
    groups,
    [],
    estimatedDefense * HIGH_CHANCE_MARGIN,
    attackerResearch,
    UNSEEN_DEFENDER
  );
  const cargoCapacity = Math.floor(
    groups.reduce(
      (sum, group) =>
        sum +
        (group.amount - (battle.attackerLosses.get(group.key) ?? 0)) *
          group.spacecraft.cargo *
          attackerResearch.cargo,
      0
    )
  );
  const resources = [...targetStock.resources].sort((a, b) =>
    a.resourceKey < b.resourceKey ? -1 : a.resourceKey > b.resourceKey ? 1 : 0
  );
  const loot = lootFromStock(resources, targetStock.protectedAmount, cargoCapacity);
  return {
    winChance: safe.winner === 'attacker' ? 'high' : 'medium',
    loot: Object.fromEntries(Object.entries(loot).map(([key, amount]) => [key, lootRange(amount)])),
  };
}
