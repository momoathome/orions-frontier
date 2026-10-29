import { and, eq, sql } from 'drizzle-orm';
import type { ResourceKey } from '@orions-frontier/shared';
import type { Tx } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';

export function listStationResourcesForUpdate(tx: Tx, stationId: string) {
  return tx
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId))
    .for('update');
}

/** Subtracts without checking; the caller has verified the stock. */
export async function deductStationResource(
  tx: Tx,
  stationId: string,
  resourceKey: ResourceKey,
  amount: number
) {
  await tx
    .update(stationResources)
    .set({ amount: sql`${stationResources.amount} - ${amount}` })
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, resourceKey))
    );
}
