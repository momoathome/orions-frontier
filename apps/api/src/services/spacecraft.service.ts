import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import {
  spacecraftDefinitions,
  spacecraftDefinitionCosts,
} from '../lib/db/schema/spacecraft-definitions.js';
import type { SpacecraftRole, StationSpacecraftWithDefinition, ResourceKey } from '@orions-frontier/shared';

export const getStationSpacecrafts = async (
  stationId: string,
): Promise<StationSpacecraftWithDefinition[]> => {
  const db = getDb();

  const rows = await db
    .select()
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id),
    )
    .where(eq(stationSpacecrafts.stationId, stationId));

  const definitionIds = [...new Set(rows.map((r) => r.spacecraft_definitions.id))];

  const costs =
    definitionIds.length > 0
      ? await db
          .select()
          .from(spacecraftDefinitionCosts)
          .where(inArray(spacecraftDefinitionCosts.spacecraftDefinitionId, definitionIds))
      : [];

  const costsByDefinitionId = costs.reduce<
    Record<string, typeof spacecraftDefinitionCosts.$inferSelect[]>
  >((acc, cost) => {
    (acc[cost.spacecraftDefinitionId] ??= []).push(cost);
    return acc;
  }, {});

  return rows.map((row) => {
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
};
