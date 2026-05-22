import { Worker } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { logger as rootLogger } from '../../lib/logger.js';
import {
  processTripArrivals,
  reconcilePendingTrips,
} from '../../services/transport/trip-arrivals.service.js';

const logger = rootLogger.child({ name: 'transport-tick-worker' });

// ============================================================================
// Transport Tick Worker — Watchdog only (after Ticket B+C)
//
// Primary arrival processing is handled by trip-arrival-worker via delayed
// BullMQ jobs scheduled at dispatch time. This worker runs every 5 minutes as
// a safety net:
//   1. reconcilePendingTrips — registers delayed jobs for any orphaned trips
//      (e.g. after a crash or BullMQ restart).
//   2. processTripArrivals  — fallback poll that settles any trips whose
//      delayed job was somehow missed (should return 0 in normal operation).
//
// Dispatch (checkAndDispatchTransports) was moved to mining-tick-worker (Ticket C):
// transporters are now dispatched per asteroid immediately after each mining tick.
// ============================================================================

async function processTransportTickJob(job: { name: string }) {
  if (job.name !== 'tick-transport') {
    logger.warn({ jobName: job.name }, 'Unknown transport-tick job type');
    return;
  }

  // 1. Register delayed arrival jobs for any traveling trips without one.
  await reconcilePendingTrips();

  // 2. Fallback: settle trips that somehow have no delayed job (should be 0).
  const settled = await processTripArrivals();
  if (settled > 0) {
    logger.warn(
      { settled },
      'Settled orphaned trips via watchdog — delayed jobs may have been missed'
    );
  }
}

export const startTransportTickWorker = () => {
  const worker = new Worker('transport-tick', processTransportTickJob, {
    connection: bullmqRedis,
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Transport watchdog tick completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Transport watchdog tick failed');
  });

  logger.info('Transport tick worker started (watchdog mode)');
  return worker;
};
