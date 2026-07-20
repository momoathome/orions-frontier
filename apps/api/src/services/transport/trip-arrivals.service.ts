import { and, eq } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { handleMineArrival, handleMiningReturnArrival } from './trip-handlers.js';

const logger = rootLogger.child({ name: 'trip-arrivals' });

// ============================================================================
// Trip Arrivals Service
//
// settleTripArrival   — dispatches a single trip to the correct handler.
// ============================================================================

type ScheduleTripArrival = (tripId: string, arrivesAt: Date) => Promise<void>;

// Exported so trip-arrival-worker.ts can settle individual trips directly.
export async function settleTripArrival(
  trip: typeof spacecraftTrips.$inferSelect,
  schedule?: ScheduleTripArrival
): Promise<boolean> {
  const db = getDb();

  const result = await db.transaction(async (tx) => {
    // Claim the trip atomically. Overlapping scheduler ticks may race each other.
    const [claimed] = await tx
      .update(spacecraftTrips)
      .set({ status: 'arrived' })
      .where(and(eq(spacecraftTrips.id, trip.id), eq(spacecraftTrips.status, 'traveling')))
      .returning({ id: spacecraftTrips.id });

    if (!claimed) return { settled: false, createdTrip: null };

    let createdTrip: { id: string; arrivesAt: Date } | null = null;
    if (trip.purpose === 'mine' && trip.toType === 'asteroid') {
      createdTrip = await handleMineArrival(tx, trip);
    } else if (trip.purpose === 'mining_return' && trip.toType === 'station') {
      createdTrip = await handleMiningReturnArrival(tx, trip);
    }

    return { settled: true, createdTrip };
  });

  if (!result.settled) return false;

  if (result.createdTrip && schedule) {
    try {
      await schedule(result.createdTrip.id, result.createdTrip.arrivesAt);
    } catch (err) {
      logger.warn(
        { tripId: result.createdTrip.id, err },
        'Scheduling chained trip failed; reconciliation will recover'
      );
    }
  }

  return true;
}
