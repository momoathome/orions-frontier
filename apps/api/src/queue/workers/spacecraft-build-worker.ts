import { Worker } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import type {
  SpacecraftBuildJobData,
  SpacecraftBuildJobName,
} from '../queues/spacecraft-build-queue.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { handleSpacecraftBuild } from '../jobs/spacecraft-build.js';

const logger = rootLogger.child({ name: 'spacecraft-build-worker' });

export const startSpacecraftBuildWorker = () => {
  const worker = new Worker<SpacecraftBuildJobData, void, SpacecraftBuildJobName>(
    'spacecraft-build',
    async (job) => {
      await handleSpacecraftBuild(job.data);
    },
    { connection: bullmqRedis },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Spacecraft build job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Spacecraft build job failed');
  });

  logger.info('Spacecraft build worker started');

  return worker;
};
