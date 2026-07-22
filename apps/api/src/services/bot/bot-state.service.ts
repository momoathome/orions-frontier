import { and, between, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import {
  getUserScannerCoverages,
  isPointVisible,
  scannerChunkBounds,
} from '../scanner-visibility.service.js';
import type { BotAsteroidCandidate, BotMiningShip, EconomicBotState } from './economic-v1.js';
import type { ResourceKey, ResourceMap } from '@orions-frontier/shared';
import { spacecrafts } from '@orions-frontier/game-config';
import { WORLD_CONFIG } from '../../lib/world-config.js';

const MINER_KEYS = ['mole', 'titan'] as const;

export async function loadEconomicBotState(userId: string): Promise<EconomicBotState | null> {
  const db = getDb();
  const [station] = await db
    .select({ id: stations.id, sectorId: stations.sectorId, x: stations.x, y: stations.y })
    .from(stations)
    .where(eq(stations.userId, userId))
    .limit(1);
  if (!station) return null;

  const coverages = await getUserScannerCoverages(userId);
  const coverageBounds = scannerChunkBounds(coverages, WORLD_CONFIG.CHUNK_SIZE);
  const definitions = spacecrafts.filter((spacecraft) =>
    MINER_KEYS.includes(spacecraft.key as (typeof MINER_KEYS)[number])
  );
  const [resourceRows, shipyardRows, asteroidRows] = await Promise.all([
    db.select().from(stationResources).where(eq(stationResources.stationId, station.id)),
    db
      .select({ level: stationBuildings.level, upgradeEndsAt: stationBuildings.upgradeEndsAt })
      .from(stationBuildings)
      .where(
        and(
          eq(stationBuildings.stationId, station.id),
          eq(stationBuildings.buildingKey, 'shipyard')
        )
      )
      .limit(1),
    coverageBounds.length
      ? db
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
            or(
              ...coverageBounds.map((bound) =>
                and(
                  between(asteroids.chunkX, bound.minChunkX, bound.maxChunkX),
                  between(asteroids.chunkY, bound.minChunkY, bound.maxChunkY)
                )
              )
            )
          )
      : [],
  ]);

  const definitionKeys = definitions.map((definition) => definition.key);
  const [fleetRows, buildOrderRows] = await Promise.all([
    definitionKeys.length
      ? db
          .select()
          .from(stationSpacecrafts)
          .where(
            and(
              eq(stationSpacecrafts.stationId, station.id),
              inArray(stationSpacecrafts.spacecraftKey, definitionKeys)
            )
          )
      : [],
    definitionKeys.length
      ? db
          .select()
          .from(spacecraftBuildOrders)
          .where(
            and(
              eq(spacecraftBuildOrders.stationId, station.id),
              inArray(spacecraftBuildOrders.spacecraftKey, definitionKeys)
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
    const fleet = fleetRows.find((entry) => entry.spacecraftKey === definition.key);
    ships[key] = {
      spacecraftKey: definition.key,
      key,
      amount: fleet?.amount ?? 0,
      lockedAmount: fleet?.lockedAmount ?? 0,
      inBuild: buildOrderRows
        .filter((order) => order.spacecraftKey === definition.key)
        .reduce((sum, order) => sum + order.amount, 0),
      cargo: definition.cargo,
      speed: definition.speed,
      miningRate: definition.miningRate,
    };
  }

  const candidates = new Map<string, BotAsteroidCandidate>();
  for (const row of asteroidRows) {
    if (!isPointVisible(coverages, row)) continue;
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
