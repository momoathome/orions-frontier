import { eq } from 'drizzle-orm';
import type { getDb } from '../../lib/db/index.js';
import { asteroidVeins } from '../../lib/db/schema/asteroids.js';
import type { CargoManifest } from '../../lib/db/schema/spacecraft-trips.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export interface MiningClaim {
  cargoManifest: CargoManifest;
  claimedAmount: number;
  remainingAmount: number;
}

/** Claim at most one group load. The caller persists the mining cycle in the same transaction. */
export async function claimMiningCargo(
  tx: Tx,
  asteroidId: string,
  maxAmount: number
): Promise<MiningClaim> {
  if (!Number.isInteger(maxAmount) || maxAmount <= 0) {
    throw new RangeError('maxAmount must be an integer greater than 0');
  }

  const veins = await tx
    .select({
      id: asteroidVeins.id,
      resourceKey: asteroidVeins.resourceKey,
      remainingAmount: asteroidVeins.remainingAmount,
    })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId))
    .orderBy(asteroidVeins.createdAt, asteroidVeins.id)
    .for('update');

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
      await tx
        .update(asteroidVeins)
        .set({ remainingAmount: vein.remainingAmount - amount })
        .where(eq(asteroidVeins.id, vein.id));
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
