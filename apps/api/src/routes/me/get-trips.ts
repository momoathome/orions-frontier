import type { FastifyPluginAsync } from 'fastify';
import { authenticate } from '../../middleware/auth.js';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { stations } from '../../lib/db/schema/stations.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { getSpacecraft } from '@orions-frontier/game-config';

/**
 * GET /api/me/trips
 * Returns all active (traveling) spacecraft trips across all stations of the user.
 * Used by the map to render in-flight spacecraft with interpolated positions.
 */
export default (async (app) => {
  app.get('/trips', { preHandler: [authenticate] }, async (request) => {
    const { userId } = request.user;
    const db = getDb();

    // Use stations.userId not id
    const stationRows = await db
      .select({ id: stations.id })
      .from(stations)
      .where(eq(stations.userId, userId));

    if (stationRows.length === 0) {
      return [];
    }

    const stationIds = stationRows.map((s) => s.id);

    // Get all stationSpacecraft ids for this user's stations
    const ssRows = await db
      .select({
        id: stationSpacecrafts.id,
        spacecraftKey: stationSpacecrafts.spacecraftKey,
      })
      .from(stationSpacecrafts)
      .where(inArray(stationSpacecrafts.stationId, stationIds));

    if (ssRows.length === 0) {
      return [];
    }

    const ssIds = ssRows.map((s) => s.id);
    const ssInfoMap = new Map(ssRows.map((s) => [s.id, s]));

    // Get all active trips
    const trips = await db
      .select()
      .from(spacecraftTrips)
      .where(
        and(
          inArray(spacecraftTrips.stationSpacecraftId, ssIds),
          eq(spacecraftTrips.status, 'traveling')
        )
      );

    const data = trips.map((trip) => {
      const ss = ssInfoMap.get(trip.stationSpacecraftId);
      const spacecraft = ss ? getSpacecraft(ss.spacecraftKey) : undefined;
      return {
        id: trip.id,
        groupSize: trip.groupSize,
        fromType: trip.fromType,
        fromId: trip.fromId,
        toType: trip.toType,
        toId: trip.toId,
        departedAt: trip.departedAt.toISOString(),
        arrivesAt: trip.arrivesAt.toISOString(),
        purpose: trip.purpose,
        cargoManifest: trip.cargoManifest,
        spacecraft: spacecraft
          ? {
              role: spacecraft.role,
              speed: spacecraft.speed,
              cargo: spacecraft.cargo,
              name: spacecraft.name,
              image: spacecraft.image,
            }
          : null,
      };
    });

    return data;
  });
}) satisfies FastifyPluginAsync;
