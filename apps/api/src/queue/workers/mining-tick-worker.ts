import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { bullmqRedis } from '../bullmq.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { getDb } from '../../lib/db/index.js';
import { asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { calculateMiningTick } from '../../services/mining-tick.service.js';

const logger = rootLogger.child({ name: 'mining-tick-worker' });

export const startMiningTickWorker = () => {
  const worker = new Worker(
    'mining-tick',
    async (job) => {
      if (job.name !== 'tick-all-assignments') {
        logger.warn({ jobName: job.name }, 'Unknown mining-tick job type');
        return;
      }

      const db = getDb();
      const assignments = await db
        .select({ id: asteroidAssignments.id })
        .from(asteroidAssignments);

      logger.info({ count: assignments.length }, 'Starting mining tick for all assignments');

      let ticked = 0;
      for (const assignment of assignments) {
        try {
          const result = await calculateMiningTick(assignment.id);
          if (result) ticked++;
        } catch (err) {
          logger.error({ assignmentId: assignment.id, err }, 'Failed to tick assignment');
        }
      }

      logger.info({ ticked, total: assignments.length }, 'Mining tick complete');
    },
    { connection: bullmqRedis },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Mining tick job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Mining tick job failed');
  });

  logger.info('Mining tick worker started');
  return worker;
};
