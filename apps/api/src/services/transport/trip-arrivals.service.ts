import { and, eq } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { handleMineArrival, handleMiningReturnArrival } from './trip-handlers.js';
import { handleCombatTripArrival } from '../combat.service.js';
import { handleSalvageTripArrival } from '../salvage.service.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import type { PlaytestCompletionEvent } from '../../lib/playtest/events.js';

// Trip Arrivals Service
//
// settleTripArrival   — dispatches a single trip to the correct handler.

export interface TripArrivalResult {
  settled: boolean;
  events: PlaytestCompletionEvent[];
}

export async function settleTripArrivalDetailed(
  trip: typeof spacecraftTrips.$inferSelect,
  contextOrNow?: GameExecutionContext | Date
): Promise<TripArrivalResult> {
  const db = getDb();
  const context = resolveGameExecutionContext(contextOrNow).at(trip.arrivesAt);

  return db.transaction(async (tx) => {
    // Claim the trip atomically. Overlapping scheduler ticks may race each other.
    const [claimed] = await tx
      .update(spacecraftTrips)
      .set({ status: 'arrived' })
      .where(and(eq(spacecraftTrips.id, trip.id), eq(spacecraftTrips.status, 'traveling')))
      .returning({ id: spacecraftTrips.id });

    if (!claimed) return { settled: false, events: [] };

    let events: PlaytestCompletionEvent[] = [];
    if (trip.purpose === 'mine' && trip.toType === 'asteroid') {
      await handleMineArrival(tx, trip, context);
    } else if (trip.purpose === 'mining_return' && trip.toType === 'station') {
      const delivery = await handleMiningReturnArrival(tx, trip, context);
      if (delivery) events = [delivery];
    } else if (trip.purpose === 'combat' || trip.purpose === 'combat_return') {
      events = await handleCombatTripArrival(tx, trip, context);
    } else if (trip.purpose === 'salvage' || trip.purpose === 'salvage_return') {
      events = await handleSalvageTripArrival(tx, trip, context);
    }

    return { settled: true, events };
  });
}

export async function settleTripArrival(
  trip: typeof spacecraftTrips.$inferSelect,
  contextOrNow?: GameExecutionContext | Date
): Promise<boolean> {
  return (await settleTripArrivalDetailed(trip, contextOrNow)).settled;
}
