import { and, eq, inArray } from 'drizzle-orm';
import { defineRoute } from '../../../lib/route-helper.js';
import { authenticate } from '../../../middleware/auth.js';
import { getDb } from '../../../lib/db/index.js';
import { stations } from '../../../lib/db/schema/stations.js';
import { stationSpacecrafts } from '../../../lib/db/schema/station-spacecrafts.js';
import {
  spacecraftDefinitions,
  spacecraftDefinitionCosts,
} from '../../../lib/db/schema/spacecraft-definitions.js';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import type {
  SpacecraftRole,
  StationSpacecraftWithDefinition,
} from '@orions-frontier/shared';
import type { ResourceKey } from '@orions-frontier/shared';

/**
 * GET /api/stations/:stationId/spacecrafts
 * Returns the fleet of a station owned by the authenticated user,
 * including definition data and resource costs.
 */
export default defineRoute(async (app) => {
  app.get(
    '/spacecrafts',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { stationId } = request.params as { stationId: string };
      const db = getDb();

      // Verify ownership
      const [station] = await db
        .select({ id: stations.id })
        .from(stations)
        .where(and(eq(stations.id, stationId), eq(stations.userId, request.user.userId)))
        .limit(1);

      if (!station) {
        throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
      }

      // Fetch spacecraft stacks joined with their definitions
      const rows = await db
        .select()
        .from(stationSpacecrafts)
        .innerJoin(
          spacecraftDefinitions,
          eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id),
        )
        .where(eq(stationSpacecrafts.stationId, station.id));

      // Batch-fetch costs for all referenced definitions
      const definitionIds = [...new Set(rows.map((r) => r.spacecraft_definitions.id))];

      const costs =
        definitionIds.length > 0
          ? await db
              .select()
              .from(spacecraftDefinitionCosts)
              .where(
                inArray(spacecraftDefinitionCosts.spacecraftDefinitionId, definitionIds),
              )
          : [];

      const costsByDefinitionId = costs.reduce<
        Record<string, typeof spacecraftDefinitionCosts.$inferSelect[]>
      >((acc, cost) => {
        (acc[cost.spacecraftDefinitionId] ??= []).push(cost);
        return acc;
      }, {});

      const spacecrafts: StationSpacecraftWithDefinition[] = rows.map((row) => {
        const def = row.spacecraft_definitions;
        return {
          definition: {
            id: def.id,
            key: def.key,
            name: def.name,
            description: def.description,
            role: def.role as SpacecraftRole,
            image: def.image,
            attack: def.attack,
            defense: def.defense,
            cargo: def.cargo,
            speed: def.speed,
            miningRate: def.miningRate,
            buildTime: def.buildTime,
            costs: (costsByDefinitionId[def.id] ?? []).map((c) => ({
              resourceKey: c.resourceKey as ResourceKey,
              amount: c.amount,
            })),
          },
          amount: row.station_spacecrafts.amount,
          lockedAmount: row.station_spacecrafts.lockedAmount,
        };
      });

      return reply.send({
        success: true,
        data: {
          stationId: station.id,
          spacecrafts,
        },
      });
    },
  );
});
