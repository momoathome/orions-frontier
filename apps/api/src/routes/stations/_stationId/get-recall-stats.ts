import { and, eq, gte, sql } from 'drizzle-orm';
import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { stationSpacecrafts } from '../../../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips } from '../../../lib/db/schema/spacecraft-trips.js';
import { spacecraftDefinitions } from '../../../lib/db/schema/spacecraft-definitions.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';

/**
 * GET /api/stations/:stationId/recall-stats
 * Returns miner self-recall statistics for the last 24 hours.
 * A recall trip (purpose='recall') means a miner's buffer filled up and it
 * flew resources back to the station autonomously — indicating the transport
 * network didn't keep up with mining output at that asteroid.
 */
export default defineRoute(async (app) => {
  app.get('/recall-stats', { preHandler: [authenticate] }, async (request, reply) => {
    const { stationId } = request.params as { stationId: string };
    const db = getDb();

    const [station] = await db
      .select({ id: stations.id })
      .from(stations)
      .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
      .limit(1);

    if (!station) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Count arrived recall trips in the last 24h for this station's fleet.
    // We use arrivesAt as a proxy for arrival time (no separate arrivedAt column).
    const [row] = await db
      .select({
        recallCount: sql<number>`cast(count(*) as int)`,
        shipCount: sql<number>`cast(coalesce(sum(${spacecraftTrips.groupSize}), 0) as int)`,
      })
      .from(spacecraftTrips)
      .innerJoin(
        stationSpacecrafts,
        eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id)
      )
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(stationSpacecrafts.stationId, station.id),
          eq(spacecraftTrips.purpose, 'recall'),
          eq(spacecraftTrips.status, 'arrived'),
          gte(spacecraftTrips.arrivesAt, since)
        )
      );

    return reply.send({
      success: true,
      data: {
        recallTrips: row?.recallCount ?? 0,
        recallShips: row?.shipCount ?? 0,
        windowHours: 24,
      },
    });
  });
});
