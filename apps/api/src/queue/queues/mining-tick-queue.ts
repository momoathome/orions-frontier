import { Queue } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';

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
      repeat: { every: 5 * 60 * 1000 }, // every 5 minutes
      jobId: 'mining-tick-cron',
    },
  );
};
