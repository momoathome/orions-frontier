import { Worker } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { ActionJobData, ActionJobName } from '../queues/action-queue.js';
import { handleBuildingUpgradeFinished } from '../jobs/building-upgrade.js';
import { logger as rootLogger } from '../../lib/logger.js';

const logger = rootLogger.child({ name: 'action-worker' });

export const startActionWorker = () => {
  const worker = new Worker<ActionJobData, void, ActionJobName>(
    'actions',
    async (job) => {
      logger.info({ jobId: job.id, jobName: job.name }, 'Processing action job');

      switch (job.name) {
        case 'building-upgrade-finished':
          await handleBuildingUpgradeFinished(job.data);
          break;
        default:
          logger.warn({ jobName: job.name }, 'Unknown job type');
      }
    },
    {
      connection: bullmqRedis,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Job failed');
  });

  logger.info('Action worker started');

  return worker;
};
