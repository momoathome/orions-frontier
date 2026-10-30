import type { ResourceKey } from '@orions-frontier/shared';
import type { Tx } from '../../lib/db/index.js';
import type { CargoManifest } from '../../lib/db/schema/spacecraft-trips.js';
import {
  listAsteroidVeinsForUpdate,
  updateAsteroidVeinRemaining,
} from '../../repositories/asteroids.js';

export interface MiningClaim {
  cargoManifest: CargoManifest;
  claimedAmount: number;
  remainingAmount: number;
}

/**
 * Claim at most one group load from the veins the miner's owner can see. The caller persists the
 * mining cycle in the same transaction.
 */
export async function claimMiningCargo(
  tx: Tx,
  asteroidId: string,
  maxAmount: number,
  resourceKeys: readonly ResourceKey[]
): Promise<MiningClaim> {
  if (!Number.isInteger(maxAmount) || maxAmount <= 0) {
    throw new RangeError('maxAmount must be an integer greater than 0');
  }

  const veins = await listAsteroidVeinsForUpdate(tx, asteroidId, resourceKeys);

  const totalAvailable = veins.reduce((sum, vein) => sum + vein.remainingAmount, 0);
  const totalToClaim = Math.min(totalAvailable, maxAmount);
  const cargoManifest: CargoManifest = {};
  let available = totalAvailable;
  let unclaimed = totalToClaim;

  for (const vein of veins) {
    const amount =
      available === vein.remainingAmount
        ? unclaimed
        : Math.min(
            vein.remainingAmount,
            Math.floor((unclaimed * vein.remainingAmount) / available)
          );

    if (amount > 0) {
      cargoManifest[vein.resourceKey] = (cargoManifest[vein.resourceKey] ?? 0) + amount;
      await updateAsteroidVeinRemaining(tx, vein.id, vein.remainingAmount - amount);
    }

    available -= vein.remainingAmount;
    unclaimed -= amount;
  }

  return {
    cargoManifest,
    claimedAmount: totalToClaim,
    remainingAmount: totalAvailable - totalToClaim,
  };
}
