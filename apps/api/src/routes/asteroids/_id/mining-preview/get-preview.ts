import { and, eq, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '../../../../lib/db/index.js';
import { authenticate } from '../../../../middleware/auth.js';
import { asteroids, asteroidVeins } from '../../../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../../../lib/db/schema/spacecraft-definitions.js';
import { stationSpacecrafts } from '../../../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../../../lib/db/schema/stations.js';
import { calculateMiningCycle } from '../../../../lib/mining-cycle.js';
import { calcDistance } from '../../../../lib/travel.js';
import { getUserScannerStrength } from '../../../../services/asteroid.service.js';

export default (async (app) => {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const { id: asteroidId } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;
    const stationId = query['stationId'];
    const spacecraftDefinitionId = query['spacecraftDefinitionId'];
    const minerCount = Math.floor(Number(query['minerCount'] ?? 1));

    if (!stationId || !spacecraftDefinitionId || !Number.isInteger(minerCount) || minerCount < 1) {
      return reply
        .status(400)
        .send({ message: 'Valid station, spacecraft and miner count required' });
    }

    const db = getDb();
    const scannerStrength = await getUserScannerStrength(request.user.userId);
    const [row] = await db
      .select({
        stationX: stations.x,
        stationY: stations.y,
        asteroidX: asteroids.x,
        asteroidY: asteroids.y,
        speed: spacecraftDefinitions.speed,
        miningRate: spacecraftDefinitions.miningRate,
        cargoCapacity: spacecraftDefinitions.cargo,
        available: sql<number>`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount}`,
      })
      .from(stations)
      .innerJoin(
        stationSpacecrafts,
        and(
          eq(stationSpacecrafts.stationId, stations.id),
          eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitionId)
        )
      )
      .innerJoin(
        spacecraftDefinitions,
        eq(spacecraftDefinitions.id, stationSpacecrafts.spacecraftDefinitionId)
      )
      .innerJoin(asteroids, eq(asteroids.id, asteroidId))
      .where(
        and(
          eq(stations.id, stationId),
          eq(stations.userId, request.user.userId),
          lte(asteroids.hiddenLevel, scannerStrength)
        )
      )
      .limit(1);

    if (!row) return reply.status(404).send({ message: 'Station, miner or asteroid not found' });
    if (row.speed <= 0 || row.miningRate <= 0 || row.cargoCapacity <= 0) {
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

    return reply.send({
      data: {
        distance,
        speed: row.speed,
        miningRate: row.miningRate,
        cargoCapacity: row.cargoCapacity,
        remainingAmount,
        ...calculateMiningCycle({
          distance,
          speed: row.speed,
          miningRate: row.miningRate,
          cargoCapacity: row.cargoCapacity,
          minerCount,
          remainingAmount,
        }),
      },
    });
  });
}) satisfies FastifyPluginAsync;
