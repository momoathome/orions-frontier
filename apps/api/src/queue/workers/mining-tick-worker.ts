import { Worker } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { getDb } from '../../lib/db/index.js';
import { asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { stations } from '../../lib/db/schema/stations.js';
import { inArray } from 'drizzle-orm';
import {
  calculateMiningTick,
  applyAsteroidStabilityTick,
  checkAndDispatchMinerRecall,
} from '../../services/mining-tick.service.js';
import { checkAndDispatchTransports } from '../../services/transport-tick.service.js';
import { getRedis } from '../../lib/redis.js';

const logger = rootLogger.child({ name: 'mining-tick-worker' });

async function processMiningTickJob(job: { name: string }) {
  if (job.name !== 'tick-all-assignments') {
    logger.warn({ jobName: job.name }, 'Unknown mining-tick job type');
    return;
  }

  const db = getDb();
  const assignments = await db
    .select({
      id: asteroidAssignments.id,
      asteroidId: asteroidAssignments.asteroidId,
      stationId: asteroidAssignments.stationId,
    })
    .from(asteroidAssignments);

  logger.info({ count: assignments.length }, 'Starting mining tick for all assignments');

  // Track which asteroids ticked and which stationIds were involved
  const asteroidIds = new Set<string>();
  const stationIds = new Set<string>();
  let ticked = 0;
  for (const assignment of assignments) {
    try {
      const result = await calculateMiningTick(assignment.id);
      if (result) {
        ticked++;
        asteroidIds.add(assignment.asteroidId);
        stationIds.add(assignment.stationId);
      }
    } catch (err) {
      logger.error({ assignmentId: assignment.id, err }, 'Failed to tick assignment');
    }
  }

  // Apply one stability tick per affected asteroid
  for (const asteroidId of asteroidIds) {
    try {
      await applyAsteroidStabilityTick(asteroidId);
    } catch (err) {
      logger.error({ asteroidId, err }, 'Failed to apply stability tick');
    }
  }

  // First: give transporters a chance to pick up resources before miner recall
  for (const stationId of stationIds) {
    try {
      await checkAndDispatchTransports(stationId);
    } catch (err) {
      logger.error({ stationId, err }, 'Failed to dispatch transporters after mining tick');
    }
  }

  // Check for miner self-recall (buffer full) per affected asteroid
  for (const asteroidId of asteroidIds) {
    try {
      await checkAndDispatchMinerRecall(asteroidId);
    } catch (err) {
      logger.error({ asteroidId, err }, 'Failed to check miner recall');
    }
  }

  // Publish mining_tick_completed per affected user so TopHud can refetch rates
  if (stationIds.size > 0) {
    const stationIdArray = [...stationIds];
    const stationRows = await db
      .select({ userId: stations.userId })
      .from(stations)
      .where(inArray(stations.id, stationIdArray));

    const userIds = new Set(stationRows.map((r) => r.userId));
    const redis = getRedis();
    for (const userId of userIds) {
      await redis.publish(
        `user:${userId}:events`,
        JSON.stringify({ type: 'mining_tick_completed', payload: {}, timestamp: Date.now() })
      );
    }
  }

  logger.info({ ticked, total: assignments.length }, 'Mining tick complete');
}

export const startMiningTickWorker = () => {
  const worker = new Worker('mining-tick', processMiningTickJob, { connection: bullmqRedis });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Mining tick job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Mining tick job failed');
  });

  logger.info('Mining tick worker started');
  return worker;
};
