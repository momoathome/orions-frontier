import { requireSpacecraft, type ResearchModifiers } from '@orions-frontier/game-config';

/**
 * One fight without side effects. Every attacking group loses the same share of its ships; the
 * attack destroys docked defending ships weakest first and spills the rest of its damage over to
 * the next fleet. Returns the losses per attacking group key and per defending fleet row id.
 */
export function resolveBattle(
  groups: readonly {
    key: string;
    amount: number;
    spacecraft: { attack: number; defense: number };
  }[],
  defenderFleets: readonly {
    id: string;
    spacecraftKey: string;
    amount: number;
    lockedAmount: number;
  }[],
  stationDefense: number,
  attackerResearch: Pick<ResearchModifiers, 'attack' | 'shipDefense'>,
  defenderResearch: Pick<ResearchModifiers, 'shipDefense' | 'stationDefense'>
) {
  const fleets = defenderFleets
    .map((fleet) => ({
      id: fleet.id,
      docked: Math.max(0, fleet.amount - fleet.lockedAmount),
      defense: requireSpacecraft(fleet.spacecraftKey).defense * defenderResearch.shipDefense,
    }))
    .sort((a, b) => a.defense - b.defense || a.id.localeCompare(b.id));
  const defenderPower =
    fleets.reduce((sum, fleet) => sum + fleet.docked * fleet.defense, 0) +
    stationDefense * defenderResearch.stationDefense;
  const attackerPower = groups.reduce(
    (sum, group) => sum + group.amount * group.spacecraft.attack * attackerResearch.attack,
    0
  );
  const attackerDefense = groups.reduce(
    (sum, group) =>
      sum + group.amount * Math.max(1, group.spacecraft.defense * attackerResearch.shipDefense),
    0
  );

  // Every group loses the same share, so bombers are neither shielded nor singled out.
  const lossShare = Math.min(1, defenderPower / Math.max(1, attackerDefense));
  const attackerLosses = new Map<string, number>();
  let survivorTotal = 0;
  for (const group of groups) {
    const losses = Math.floor(group.amount * lossShare);
    survivorTotal += group.amount - losses;
    if (losses > 0) attackerLosses.set(group.key, losses);
  }

  const defenderLosses = new Map<string, number>();
  let remainingDamage = attackerPower;
  for (const fleet of fleets) {
    const losses = Math.min(fleet.docked, Math.floor(remainingDamage / Math.max(1, fleet.defense)));
    if (losses === 0) continue;
    defenderLosses.set(fleet.id, losses);
    remainingDamage -= losses * Math.max(1, fleet.defense);
  }

  const winner: 'attacker' | 'defender' =
    survivorTotal > 0 && attackerPower > defenderPower ? 'attacker' : 'defender';
  return { attackerLosses, defenderLosses, winner, attackerPower, defenderPower };
}

/** A won wave takes 10% of every unprotected resource, in the given order, until the cargo is full. */
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
    const amount = Math.min(cargoLeft, Math.floor(available * 0.1));
    if (amount <= 0) continue;
    loot[resource.resourceKey] = amount;
    cargoLeft -= amount;
  }
  return loot;
}
