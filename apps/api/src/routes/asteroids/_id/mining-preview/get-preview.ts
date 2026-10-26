import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../../lib/db/index.js';
import { authenticate } from '../../../../middleware/auth.js';
import { asteroids, asteroidVeins } from '../../../../lib/db/schema/asteroids.js';
import { stationSpacecrafts } from '../../../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../../../lib/db/schema/stations.js';
import { calculateMiningCycle } from '../../../../lib/mining-cycle.js';
import { calcDistance } from '../../../../lib/travel.js';
import {
  getUserRevealedAsteroidIds,
  getUserScannerCoverages,
  isPointVisible,
} from '../../../../services/scanner-visibility.service.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import {
  effectiveMiningRate,
  effectiveCargoCapacity,
} from '../../../../services/research-effects.js';
import { hasCompletedResearch } from '../../../../services/research.service.js';
import { defineRoute, idParams } from '../../../../lib/route.js';

const QuerySchema = z.object({
  stationId: z.uuid(),
  spacecraftKey: z.string().min(1),
  minerCount: z.coerce.number().int().min(1).default(1),
});

export default defineRoute(async (app) => {
  app.get(
    '/',
    { onRequest: [authenticate], schema: { params: idParams, querystring: QuerySchema } },
    async (request, reply) => {
      const { id: asteroidId } = request.params;
      const { stationId, spacecraftKey, minerCount } = request.query;

      const db = getDb();
      const spacecraft = getSpacecraft(spacecraftKey);
      if (!spacecraft) return reply.status(404).send({ message: 'Spacecraft not found' });
      const [[row], coverages, revealedIds] = await Promise.all([
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
        getUserRevealedAsteroidIds(request.user.userId),
      ]);

      if (!row) {
        return reply.status(404).send({ message: 'Station, miner or asteroid not found' });
      }
      if (spacecraft.speed <= 0 || spacecraft.miningRate <= 0 || spacecraft.cargo <= 0) {
        return reply
          .status(400)
          .send({ message: 'Selected spacecraft cannot perform mining trips' });
      }
      if (minerCount > row.available) {
        return reply.status(400).send({ message: `Only ${row.available} miners available` });
      }

      const [reserve] = await db
        .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
        .from(asteroidVeins)
        .where(eq(asteroidVeins.asteroidId, asteroidId));
      const remainingAmount = reserve?.amount ?? 0;
      const scanned =
        revealedIds.has(asteroidId) ||
        isPointVisible(coverages, { x: row.asteroidX, y: row.asteroidY });
      const distance = calcDistance(
        { x: row.stationX, y: row.stationY },
        { x: row.asteroidX, y: row.asteroidY }
      );
      const effectiveRate = await effectiveMiningRate(db, stationId, spacecraft.miningRate);
      const effectiveCargo = await effectiveCargoCapacity(db, stationId, spacecraft.cargo);
      const hasVectorNav = await hasCompletedResearch(db, stationId, 'vector_navigation');
      const effectiveSpeed = hasVectorNav ? spacecraft.speed / 0.9 : spacecraft.speed;

      const cycle = calculateMiningCycle({
        distance,
        speed: effectiveSpeed,
        miningRate: effectiveRate,
        cargoCapacity: effectiveCargo,
        minerCount,
        remainingAmount,
      });

      // Blind mining: timing is known, the reserve is not.
      return scanned
        ? {
            distance,
            speed: spacecraft.speed,
            miningRate: effectiveRate,
            cargoCapacity: effectiveCargo,
            remainingAmount,
            ...cycle,
          }
        : {
            distance,
            speed: spacecraft.speed,
            miningRate: effectiveRate,
            cargoCapacity: effectiveCargo,
            ...cycle,
            remainingAmount: null,
            estimatedDepletionHours: null,
            finalBatchAmount: null,
          };
    }
  );
});
