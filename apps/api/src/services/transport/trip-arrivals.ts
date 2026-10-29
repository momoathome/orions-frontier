import { getDb } from '../../lib/db/index.js';
import { claimTripArrival, type TripRow } from '../../repositories/spacecraft-trips.js';
import { handleMineArrival, handleMiningReturnArrival } from './trip-handlers.js';
import {
  handleCombatTripArrival,
  handleRelocateArrival,
  handleSalvageTripArrival,
} from '../combat/index.js';
import {
  resolveGameExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import type { PlaytestCompletionEvent } from '../../lib/completion-events.js';

// Trip Arrivals Service
//
// settleTripArrival   — dispatches a single trip to the correct handler.

export interface TripArrivalResult {
  settled: boolean;
  events: PlaytestCompletionEvent[];
}

export async function settleTripArrivalDetailed(
  trip: TripRow,
  contextOrNow?: GameExecutionContext | Date
): Promise<TripArrivalResult> {
  const db = getDb();
  const context = resolveGameExecutionContext(contextOrNow).at(trip.arrivesAt);

  return db.transaction(async (tx) => {
    // Claim the trip atomically. Overlapping scheduler ticks may race each other, and a station
    // destruction may have cancelled it since it was read.
    const claimed = await claimTripArrival(tx, trip.id);

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
    } else if (trip.purpose === 'relocate') {
      await handleRelocateArrival(tx, trip);
    }

    return { settled: true, events };
  });
}

export async function settleTripArrival(
  trip: TripRow,
  contextOrNow?: GameExecutionContext | Date
): Promise<boolean> {
  return (await settleTripArrivalDetailed(trip, contextOrNow)).settled;
}
