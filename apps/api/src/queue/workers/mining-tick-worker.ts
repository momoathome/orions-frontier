import { Worker } from 'bullmq';
import { bullmqRedis } from '../bullmq.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { getDb } from '../../lib/db/index.js';
import { asteroidAssignments } from '../../lib/db/schema/asteroids.js';
import { stations } from '../../lib/db/schema/stations.js';
import { eq, inArray } from 'drizzle-orm';
import { calculateMiningTick } from '../../services/mining/mining-tick.service.js';
import { applyAsteroidStabilityTick } from '../../services/mining/asteroid-lifecycle.service.js';
import { checkAndDispatchMinerRecall } from '../../services/mining/miner-recall.service.js';
import { checkAndDispatchTransports } from '../../services/transport/transport-dispatch.service.js';
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
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.status, 'at_asteroid')); // Ticket A: nur aktive Miner

  logger.info({ count: assignments.length }, 'Starting mining tick for all assignments');

  // Ticket C: Track asteroid→stations mapping for per-asteroid dispatch.
  // This replaces the separate asteroidIds and stationIds sets from before.
  const asteroidStations = new Map<string, Set<string>>();
  const stationIds = new Set<string>(); // kept for WS notification query
  let ticked = 0;

  for (const assignment of assignments) {
    try {
      const result = await calculateMiningTick(assignment.id);
      if (result) {
        ticked++;
        stationIds.add(assignment.stationId);
        const stationSet = asteroidStations.get(assignment.asteroidId) ?? new Set<string>();
        stationSet.add(assignment.stationId);
        asteroidStations.set(assignment.asteroidId, stationSet);
      }
    } catch (err) {
      logger.error({ assignmentId: assignment.id, err }, 'Failed to tick assignment');
    }
  }

  // Single combined loop: stability → per-asteroid dispatch → recall.
  // Dispatch is now per asteroid (Ticket C) so transporters are scored against
  // the asteroid that just produced resources, not blindly against all asteroids.
  for (const [asteroidId, stationSet] of asteroidStations) {
    try {
      await applyAsteroidStabilityTick(asteroidId);
    } catch (err) {
      logger.error({ asteroidId, err }, 'Failed to apply stability tick');
    }

    for (const stationId of stationSet) {
      try {
        await checkAndDispatchTransports(stationId, asteroidId);
      } catch (err) {
        logger.error(
          { stationId, asteroidId, err },
          'Failed to dispatch transporters after mining tick'
        );
      }
    }

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
