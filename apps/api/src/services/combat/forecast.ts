import { entriesOf } from '@orions-frontier/shared';
import type {
  AttackForecast,
  CombatScouting,
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

// known-limit: the defender's research is unseen and counts as none (a combat report's station
// defense already includes it), and the scanner misses docked ships; lift once the scanner shows them.
const UNSEEN_DEFENDER = { shipDefense: 1, stationDefense: 1 };

/** Leading-digit step that holds the amount: 1,234 → 1,000–2,000, 450 → 400–500. */
export function lootRange(amount: number): { min: number; max: number } {
  const step = 10 ** (String(Math.floor(amount)).length - 1);
  const min = Math.floor(amount / step) * step;
  return { min, max: min + step };
}

interface ForecastGroup {
  key: string;
  amount: number;
  spacecraft: { attack: number; cargo: number };
}

/** "high" when the attack beats the expected defense by `HIGH_CHANCE_MARGIN`. */
function winChance(battle: ReturnType<typeof resolveBattle>): AttackForecast['winChance'] {
  if (battle.winner === 'defender') return 'low';
  return battle.attackerPower > battle.defenderPower * HIGH_CHANCE_MARGIN ? 'high' : 'medium';
}

/**
 * The battle and plunder rules run against what the scanner shows: the upper estimate of the
 * station defense and the target's current stock. The target keeps producing and may be raided
 * by others before arrival, so the loot is only a range.
 */
export function forecastAttack(
  groups: readonly ForecastGroup[],
  targetProfile: StationVisualProfile,
  attackerResearch: Pick<ResearchModifiers, 'attack' | 'cargo'>,
  targetStock: {
    resources: readonly { resourceKey: string; amount: number }[];
    protectedAmount: number;
  }
): AttackForecast {
  const battle = resolveBattle(
    groups,
    [],
    estimateDefenseScore(targetProfile),
    attackerResearch,
    UNSEEN_DEFENDER
  );
  if (battle.winner === 'defender') return { winChance: 'low', loot: {}, basis: 'scanner' };

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
    winChance: winChance(battle),
    loot: Object.fromEntries(Object.entries(loot).map(([key, amount]) => [key, lootRange(amount)])),
    basis: 'scanner',
  };
}

/**
 * Outside the scanner: the defense and docked ships the last surviving wave saw. The stock is
 * unseen, so there is no loot estimate; the target may have built up since.
 */
export function forecastFromScouting(
  groups: readonly ForecastGroup[],
  scouting: CombatScouting,
  attackerResearch: Pick<ResearchModifiers, 'attack'>
): AttackForecast {
  const docked = Object.entries(scouting.dockedShips).map(([key, amount]) => ({
    id: key,
    spacecraftKey: key,
    amount,
    lockedAmount: 0,
  }));
  const battle = resolveBattle(
    groups,
    docked,
    scouting.stationDefense,
    attackerResearch,
    UNSEEN_DEFENDER
  );
  return { winChance: winChance(battle), loot: {}, basis: 'last_report' };
}
