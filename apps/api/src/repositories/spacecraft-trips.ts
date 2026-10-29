import { eq } from 'drizzle-orm';
import { required, type ResourceMap } from '@orions-frontier/shared';
import type { Tx } from '../lib/db/index.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';

export type TripRow = typeof spacecraftTrips.$inferSelect;

/** Returns the new trip's id. */
export async function insertTrip(tx: Tx, values: typeof spacecraftTrips.$inferInsert) {
  const [row] = await tx
    .insert(spacecraftTrips)
    .values(values)
    .returning({ id: spacecraftTrips.id });
  return required(row, 'trip').id;
}

export async function updateTripCargo(tx: Tx, id: string, cargoManifest: ResourceMap) {
  await tx.update(spacecraftTrips).set({ cargoManifest }).where(eq(spacecraftTrips.id, id));
}
