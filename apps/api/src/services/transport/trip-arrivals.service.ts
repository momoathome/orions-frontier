import { and, eq, lt, lte } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ name: 'trip-arrivals' });
import {
  handleMineArrival,
  handleRecallArrival,
  handleTransportOutbound,
  handleTransporterReturn,
} from './trip-handlers.js';

// ============================================================================
// Trip Arrivals Service
//
// processTripArrivals — settles all spacecraft_trips where arrivesAt <= now.
// settleTripArrival   — dispatches a single trip to the correct handler.
//
// Called by the transport-tick BullMQ worker every minute.
// ============================================================================

export async function processTripArrivals(): Promise<number> {
  const db = getDb();
  const now = new Date();

  const arrivedTrips = await db
    .select()
    .from(spacecraftTrips)
    .where(and(eq(spacecraftTrips.status, 'traveling'), lte(spacecraftTrips.arrivesAt, now)));

  let settled = 0;
  for (const trip of arrivedTrips) {
    try {
      await settleTripArrival(trip);
      settled++;
    } catch (err) {
      logger.error({ tripId: trip.id, err }, 'Failed to settle trip arrival');
    }
  }

  // Delete arrived trips older than 24 h — keeps the table small while
  // still covering the 1 h window used by getTransportEffectiveRates.
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await db
    .delete(spacecraftTrips)
    .where(and(eq(spacecraftTrips.status, 'arrived'), lt(spacecraftTrips.arrivesAt, cutoff)));

  return settled;
}

async function settleTripArrival(trip: typeof spacecraftTrips.$inferSelect): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    // Mark trip as arrived
    await tx
      .update(spacecraftTrips)
      .set({ status: 'arrived' })
      .where(eq(spacecraftTrips.id, trip.id));

    if ((trip.purpose === 'mine' || trip.purpose === 'return') && trip.toType === 'asteroid') {
      await handleMineArrival(tx, trip);
    } else if (trip.purpose === 'recall') {
      await handleRecallArrival(tx, trip);
    } else if (trip.purpose === 'transport' && trip.toType === 'asteroid') {
      await handleTransportOutbound(tx, trip);
    } else if (trip.purpose === 'return' && trip.toType === 'station') {
      await handleTransporterReturn(tx, trip);
    }
  });
}
