import { Queue } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';

export const miningTickQueue = new Queue('mining-tick', {
  connection: bullmqRedis,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 100,
  },
});

/**
 * Schedules the recurring cron job that ticks all active mining assignments.
 * BullMQ deduplicates by jobId — safe to call on every startup.
 */
export const scheduleMiningTickCron = async (): Promise<void> => {
  await miningTickQueue.add(
    'tick-all-assignments',
    {},
    {
      repeat: { every: WORLD_CONFIG.MINING_TICK_INTERVAL_MS },
      jobId: 'mining-tick-cron',
    }
  );
};
