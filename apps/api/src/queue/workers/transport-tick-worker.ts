import { Worker } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { getDb } from '../../lib/db/index.js';
import { stations } from '../../lib/db/schema/stations.js';
import { processTripArrivals } from '../../services/transport/trip-arrivals.service.js';
import { checkAndDispatchTransports } from '../../services/transport/transport-dispatch.service.js';
import { getRedis } from '../../lib/redis.js';

const logger = rootLogger.child({ name: 'transport-tick-worker' });

async function processTransportTickJob(job: { name: string }) {
  if (job.name !== 'tick-transport') {
    logger.warn({ jobName: job.name }, 'Unknown transport-tick job type');
    return;
  }

  const db = getDb();

  // 1. Settle all arrived trips
  const settled = await processTripArrivals();
  if (settled > 0) {
    logger.info({ settled }, 'Settled arrived trips');
  }

  // 2. Dispatch idle transporters per station
  const allStations = await db
    .select({ id: stations.id, userId: stations.userId })
    .from(stations);

  let totalDispatched = 0;
  const affectedUserIds = new Set<string>();

  for (const station of allStations) {
    try {
      const dispatched = await checkAndDispatchTransports(station.id);
      if (dispatched > 0) {
        totalDispatched += dispatched;
        affectedUserIds.add(station.userId);
      }
    } catch (err) {
      logger.error({ stationId: station.id, err }, 'Failed to dispatch transporters for station');
    }
  }

  if (totalDispatched > 0) {
    logger.info({ totalDispatched }, 'Dispatched transporters');
  }

  // 3. Notify affected users via WebSocket (trips started/updated)
  if (settled > 0 || totalDispatched > 0) {
    const redis = getRedis();
    for (const userId of affectedUserIds) {
      await redis.publish(
        `user:${userId}:events`,
        JSON.stringify({
          type: 'transport_tick_completed',
          payload: { settled, dispatched: totalDispatched },
          timestamp: Date.now(),
        })
      );
    }
  }
}

export const startTransportTickWorker = () => {
  const worker = new Worker('transport-tick', processTransportTickJob, {
    connection: bullmqRedis,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Transport tick job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Transport tick job failed');
  });

  logger.info('Transport tick worker started');
  return worker;
};
