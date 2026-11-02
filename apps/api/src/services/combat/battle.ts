import { requireSpacecraft, type ResearchModifiers } from '@orions-frontier/game-config';

/** How steeply the winner's losses fall with its superiority; higher spares a clear winner more. */
const LOSS_EXPONENT = 1.5;

/**
 * One fight without side effects. Attack power (fleet attack) meets defense power (station defense
 * plus docked ships' defense). The stronger side wins; the loser loses every ship in the fight and
 * the winner loses `(loser ÷ winner)^LOSS_EXPONENT` of each group, rounded down. Station defense is never
 * destroyed, and a ship's defense only counts at home. Returns the losses per attacking group key
 * and per defending fleet row id.
 */
export function resolveBattle(
  groups: readonly { key: string; amount: number; spacecraft: { attack: number } }[],
  defenderFleets: readonly {
    id: string;
    spacecraftKey: string;
    amount: number;
    lockedAmount: number;
  }[],
  stationDefense: number,
  attackerResearch: Pick<ResearchModifiers, 'attack'>,
  defenderResearch: Pick<ResearchModifiers, 'shipDefense' | 'stationDefense'>
) {
  const fleets = defenderFleets.map((fleet) => ({
    id: fleet.id,
    docked: Math.max(0, fleet.amount - fleet.lockedAmount),
    defense: requireSpacecraft(fleet.spacecraftKey).defense * defenderResearch.shipDefense,
  }));
  const defenderPower =
    fleets.reduce((sum, fleet) => sum + fleet.docked * fleet.defense, 0) +
    stationDefense * defenderResearch.stationDefense;
  const attackerPower = groups.reduce(
    (sum, group) => sum + group.amount * group.spacecraft.attack * attackerResearch.attack,
    0
  );

  const winner: 'attacker' | 'defender' = attackerPower > defenderPower ? 'attacker' : 'defender';
  // Below 1 for the winner, so each of its groups keeps at least one ship.
  const winnerShare =
    winner === 'attacker'
      ? (defenderPower / attackerPower) ** LOSS_EXPONENT
      : defenderPower > 0
        ? (attackerPower / defenderPower) ** LOSS_EXPONENT
        : 0;
  const attackerShare = winner === 'attacker' ? winnerShare : 1;
  const defenderShare = winner === 'defender' ? winnerShare : 1;

  const attackerLosses = new Map<string, number>();
  for (const group of groups) {
    const losses = Math.floor(group.amount * attackerShare);
    if (losses > 0) attackerLosses.set(group.key, losses);
  }
  const defenderLosses = new Map<string, number>();
  for (const fleet of fleets) {
    const losses = Math.floor(fleet.docked * defenderShare);
    if (losses > 0) defenderLosses.set(fleet.id, losses);
  }
  return { attackerLosses, defenderLosses, winner, attackerPower, defenderPower };
}

/** A won wave takes 30% of every unprotected resource, in the given order, until the cargo is full. */
export function lootFromStock(
  resources: readonly { resourceKey: string; amount: number }[],
  protectedAmount: number,
  cargoCapacity: number
): Record<string, number> {
  const loot: Record<string, number> = {};
  let cargoLeft = cargoCapacity;
  for (const resource of resources) {
    if (cargoLeft <= 0) break;
    const available = Math.max(0, resource.amount - protectedAmount);
    const amount = Math.min(cargoLeft, Math.floor(available * 0.3));
    if (amount <= 0) continue;
    loot[resource.resourceKey] = amount;
    cargoLeft -= amount;
  }
  return loot;
}
