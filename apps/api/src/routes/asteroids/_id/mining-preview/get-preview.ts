import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../../../lib/db/index.js';
import { authenticate } from '../../../../middleware/auth.js';
import { asteroids, asteroidVeins } from '../../../../lib/db/schema/asteroids.js';
import { stationSpacecrafts } from '../../../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../../../lib/db/schema/stations.js';
import { calculateMiningCycle } from '../../../../lib/mining-cycle.js';
import { calcDistance } from '../../../../lib/travel.js';
import {
  getUserScannerCoverages,
  isPointVisible,
} from '../../../../services/scanner-visibility.service.js';
import { getSpacecraft } from '@orions-frontier/game-config';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id: asteroidId } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;
    const stationId = query['stationId'];
    const spacecraftKey = query['spacecraftKey'];
    const minerCount = Math.floor(Number(query['minerCount'] ?? 1));

    if (!stationId || !spacecraftKey || !Number.isInteger(minerCount) || minerCount < 1) {
      return reply
        .status(400)
        .send({ message: 'Valid station, spacecraft and miner count required' });
    }

    const db = getDb();
    const spacecraft = getSpacecraft(spacecraftKey);
    if (!spacecraft) return reply.status(404).send({ message: 'Spacecraft not found' });
    const [[row], coverages] = await Promise.all([
      db
        .select({
          stationX: stations.x,
          stationY: stations.y,
          asteroidX: asteroids.x,
          asteroidY: asteroids.y,
          available: sql<number>`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount}`,
        })
        .from(stations)
        .innerJoin(
          stationSpacecrafts,
          and(
            eq(stationSpacecrafts.stationId, stations.id),
            eq(stationSpacecrafts.spacecraftKey, spacecraftKey)
          )
        )
        .innerJoin(asteroids, eq(asteroids.id, asteroidId))
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1),
      getUserScannerCoverages(request.user.userId),
    ]);

    if (!row || !isPointVisible(coverages, { x: row.asteroidX, y: row.asteroidY })) {
      return reply.status(404).send({ message: 'Station, miner or asteroid not found' });
    }
    if (spacecraft.speed <= 0 || spacecraft.miningRate <= 0 || spacecraft.cargo <= 0) {
      return reply.status(400).send({ message: 'Selected spacecraft cannot perform mining trips' });
    }
    if (minerCount > row.available) {
      return reply.status(400).send({ message: `Only ${row.available} miners available` });
    }

    const [reserve] = await db
      .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
      .from(asteroidVeins)
      .where(eq(asteroidVeins.asteroidId, asteroidId));
    const remainingAmount = reserve?.amount ?? 0;
    const distance = calcDistance(
      { x: row.stationX, y: row.stationY },
      { x: row.asteroidX, y: row.asteroidY }
    );

    return {
      distance,
      speed: spacecraft.speed,
      miningRate: spacecraft.miningRate,
      cargoCapacity: spacecraft.cargo,
      remainingAmount,
      ...calculateMiningCycle({
        distance,
        speed: spacecraft.speed,
        miningRate: spacecraft.miningRate,
        cargoCapacity: spacecraft.cargo,
        minerCount,
        remainingAmount,
      }),
    };
  });
}) satisfies FastifyPluginAsync;
