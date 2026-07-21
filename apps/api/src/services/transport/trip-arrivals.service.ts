import { and, eq } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { handleMineArrival, handleMiningReturnArrival } from './trip-handlers.js';
import { handleCombatTripArrival } from '../combat.service.js';
import { handleSalvageTripArrival } from '../salvage.service.js';

// ============================================================================
// Trip Arrivals Service
//
// settleTripArrival   — dispatches a single trip to the correct handler.
// ============================================================================

export async function settleTripArrival(
  trip: typeof spacecraftTrips.$inferSelect
): Promise<boolean> {
  const db = getDb();

  return db.transaction(async (tx) => {
    // Claim the trip atomically. Overlapping scheduler ticks may race each other.
    const [claimed] = await tx
      .update(spacecraftTrips)
      .set({ status: 'arrived' })
      .where(and(eq(spacecraftTrips.id, trip.id), eq(spacecraftTrips.status, 'traveling')))
      .returning({ id: spacecraftTrips.id });

    if (!claimed) return false;

    if (trip.purpose === 'mine' && trip.toType === 'asteroid') {
      await handleMineArrival(tx, trip);
    } else if (trip.purpose === 'mining_return' && trip.toType === 'station') {
      await handleMiningReturnArrival(tx, trip);
    } else if (trip.purpose === 'combat' || trip.purpose === 'combat_return') {
      await handleCombatTripArrival(tx, trip);
    } else if (trip.purpose === 'salvage' || trip.purpose === 'salvage_return') {
      await handleSalvageTripArrival(tx, trip);
    }

    return true;
  });
}
