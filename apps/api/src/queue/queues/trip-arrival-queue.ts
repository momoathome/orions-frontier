import { Queue } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';

export interface TripArrivalJobData {
  tripId: string;
}

export const tripArrivalQueue = new Queue<TripArrivalJobData>('trip-arrival', {
  connection: bullmqRedis,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 200,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
  },
});

/**
 * Schedules a delayed BullMQ job that fires exactly when the trip arrives.
 * jobId uses a hyphen separator — BullMQ forbids colons in custom IDs.
 * Idempotent: safe to call multiple times for the same trip (reconciliation, retries).
 */
export async function scheduleTripArrival(tripId: string, arrivesAt: Date): Promise<void> {
  const delay = Math.max(0, arrivesAt.getTime() - Date.now());
  await tripArrivalQueue.add(
    'settle-trip',
    { tripId },
    { delay, jobId: `trip-arrival-${tripId}` },
  );
}
