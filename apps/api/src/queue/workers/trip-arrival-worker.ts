import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { bullmqRedis } from '../bullmq.js';
import { getDb } from '../../lib/db/index.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { settleTripArrival } from '../../services/transport/trip-arrivals.service.js';
import { getRedis } from '../../lib/redis.js';
import { logger as rootLogger } from '../../lib/logger.js';
import type { TripArrivalJobData } from '../queues/trip-arrival-queue.js';

const logger = rootLogger.child({ name: 'trip-arrival-worker' });

// ============================================================================
// Trip Arrival Worker
//
// Fires exactly at arrivesAt (via BullMQ delayed jobs scheduled at dispatch).
// Replaces the polling loop in processTripArrivals for all normal arrivals.
// processTripArrivals in transport-tick-worker remains as a watchdog fallback.
// ============================================================================

export const startTripArrivalWorker = () => {
  const worker = new Worker<TripArrivalJobData>(
    'trip-arrival',
    async (job) => {
      const db = getDb();

      // Single JOIN query: trip + stationSpacecraft + station (userId for WS).
      // Replaces 3 sequential SELECTs (trip, ssRow, stationRow) from before.
      const [row] = await db
        .select({
          trip: spacecraftTrips,
          userId: stations.userId,
        })
        .from(spacecraftTrips)
        .innerJoin(
          stationSpacecrafts,
          eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id)
        )
        .innerJoin(stations, eq(stationSpacecrafts.stationId, stations.id))
        .where(eq(spacecraftTrips.id, job.data.tripId))
        .limit(1);

      if (!row) {
        // Trip was cancelled (asteroid destroyed, etc.) — not an error.
        logger.debug({ tripId: job.data.tripId }, 'Trip not found — already cancelled or deleted');
        return;
      }
      if (row.trip.status !== 'traveling') {
        // Already settled by the watchdog fallback or a concurrent worker.
        logger.debug(
          { tripId: row.trip.id, status: row.trip.status },
          'Trip already settled, skipping'
        );
        return;
      }

      const settled = await settleTripArrival(row.trip);
      if (!settled) return;

      // Notify the owning station's user via WebSocket.
      try {
        const redis = getRedis();
        await redis.publish(
          `user:${row.userId}:events`,
          JSON.stringify({
            type: 'transport_tick_completed',
            payload: { settled: 1, dispatched: 0 },
            timestamp: Date.now(),
          })
        );
      } catch (err) {
        // WS notification failure is non-fatal — client will sync on next poll.
        logger.warn({ tripId: row.trip.id, err }, 'Failed to publish trip arrival event');
      }
    },
    { connection: bullmqRedis, concurrency: 10 }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, tripId: job?.data.tripId, err }, 'Trip arrival job failed');
  });

  logger.info('Trip arrival worker started');
  return worker;
};
