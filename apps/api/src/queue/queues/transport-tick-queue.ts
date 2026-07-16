import { Queue } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';

export const transportTickQueue = new Queue('transport-tick', {
  connection: bullmqRedis,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 100,
  },
});

/**
 * Schedules the recurring cron job that processes trip arrivals
 * and dispatches idle transporters. Runs every minute.
 * BullMQ deduplicates by jobId — safe to call on every startup.
 */
export const scheduleTransportTickCron = async (): Promise<void> => {
  await transportTickQueue.add(
    'tick-transport',
    {},
    {
      repeat: { every: WORLD_CONFIG.TRANSPORT_TICK_INTERVAL_MS },
      jobId: 'transport-tick-cron',
    }
  );
};
