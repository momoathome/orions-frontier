import { and, eq, inArray, lte } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { buildingDefinitions } from '../../lib/db/schema/building-definitions.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { getUserScannerStrength } from '../asteroid.service.js';
import type { BotAsteroidCandidate, BotMiningShip, EconomicBotState } from './economic-v1.js';
import type { ResourceKey, ResourceMap } from '@orions-frontier/shared';

const MINER_KEYS = ['mole', 'titan'] as const;

export async function loadEconomicBotState(userId: string): Promise<EconomicBotState | null> {
  const db = getDb();
  const [station] = await db
    .select({ id: stations.id, sectorId: stations.sectorId, x: stations.x, y: stations.y })
    .from(stations)
    .where(eq(stations.userId, userId))
    .limit(1);
  if (!station) return null;

  const scannerStrength = await getUserScannerStrength(userId);
  const [resourceRows, shipyardRows, definitions, asteroidRows] = await Promise.all([
    db.select().from(stationResources).where(eq(stationResources.stationId, station.id)),
    db
      .select({ level: stationBuildings.level, upgradeEndsAt: stationBuildings.upgradeEndsAt })
      .from(stationBuildings)
      .innerJoin(
        buildingDefinitions,
        eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
      )
      .where(
        and(eq(stationBuildings.stationId, station.id), eq(buildingDefinitions.key, 'shipyard'))
      )
      .limit(1),
    db.select().from(spacecraftDefinitions).where(inArray(spacecraftDefinitions.key, MINER_KEYS)),
    db
      .select({
        id: asteroids.id,
        x: asteroids.x,
        y: asteroids.y,
        resourceKey: asteroidVeins.resourceKey,
        remainingAmount: asteroidVeins.remainingAmount,
      })
      .from(asteroids)
      .innerJoin(asteroidVeins, eq(asteroidVeins.asteroidId, asteroids.id))
      .where(
        and(eq(asteroids.sectorId, station.sectorId), lte(asteroids.hiddenLevel, scannerStrength))
      ),
  ]);

  const definitionIds = definitions.map((definition) => definition.id);
  const [fleetRows, buildOrderRows] = await Promise.all([
    definitionIds.length
      ? db
          .select()
          .from(stationSpacecrafts)
          .where(
            and(
              eq(stationSpacecrafts.stationId, station.id),
              inArray(stationSpacecrafts.spacecraftDefinitionId, definitionIds)
            )
          )
      : [],
    definitionIds.length
      ? db
          .select()
          .from(spacecraftBuildOrders)
          .where(
            and(
              eq(spacecraftBuildOrders.stationId, station.id),
              inArray(spacecraftBuildOrders.spacecraftDefinitionId, definitionIds)
            )
          )
      : [],
  ]);

  const resources = Object.fromEntries(
    resourceRows.map((resource) => [resource.resourceKey, resource.amount])
  ) as ResourceMap;
  const ships: EconomicBotState['ships'] = {};
  for (const definition of definitions) {
    const key = definition.key as BotMiningShip['key'];
    const fleet = fleetRows.find((entry) => entry.spacecraftDefinitionId === definition.id);
    ships[key] = {
      definitionId: definition.id,
      key,
      amount: fleet?.amount ?? 0,
      lockedAmount: fleet?.lockedAmount ?? 0,
      inBuild: buildOrderRows
        .filter((order) => order.spacecraftDefinitionId === definition.id)
        .reduce((sum, order) => sum + order.amount, 0),
      cargo: definition.cargo,
      speed: definition.speed,
      miningRate: definition.miningRate,
    };
  }

  const candidates = new Map<string, BotAsteroidCandidate>();
  for (const row of asteroidRows) {
    const candidate = candidates.get(row.id) ?? {
      id: row.id,
      x: row.x,
      y: row.y,
      remainingByResource: {},
      remainingAmount: 0,
    };
    const resourceKey = row.resourceKey as ResourceKey;
    candidate.remainingByResource[resourceKey] =
      (candidate.remainingByResource[resourceKey] ?? 0) + row.remainingAmount;
    candidate.remainingAmount += row.remainingAmount;
    candidates.set(row.id, candidate);
  }

  const shipyard = shipyardRows[0];
  return {
    userId,
    station,
    resources,
    shipyardLevel: shipyard?.level ?? 0,
    shipyardUpgradeInProgress: Boolean(shipyard?.upgradeEndsAt),
    ships,
    asteroids: [...candidates.values()],
  };
}
