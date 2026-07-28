import { and, between, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { debrisFields } from '../../lib/db/schema/debris-fields.js';
import { spacecraftBuildOrders } from '../../lib/db/schema/spacecraft-build-orders.js';
import { stationBuildings } from '../../lib/db/schema/station-buildings.js';
import { stationResearch } from '../../lib/db/schema/station-research.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { worldMissions } from '../../lib/db/schema/world-missions.js';
import { defenseUpgradeKeys } from '@orions-frontier/shared';
import type { ResourceKey, ResourceMap } from '@orions-frontier/shared';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import {
  getUserScannerCoverages,
  isPointVisible,
  scannerChunkBounds,
} from '../scanner-visibility.service.js';
import { getVisibleChunkStations } from '../world.service.js';
import { getUserCombatReports } from '../combat.service.js';
import type { GoalBotState, StationSnapshot } from './goal-state.js';

export async function loadGoalBotState(userId: string): Promise<GoalBotState | null> {
  const db = getDb();
  const ownStationRows = await db.select().from(stations).where(eq(stations.userId, userId));
  if (ownStationRows.length === 0) return null;

  // Build per-station snapshots
  const stationIds = ownStationRows.map((s) => s.id);
  const [allResources, allBuildings, allFleets, allBuildOrders, allResearch, allMissions] =
    await Promise.all([
      db.select().from(stationResources).where(inArray(stationResources.stationId, stationIds)),
      db.select().from(stationBuildings).where(inArray(stationBuildings.stationId, stationIds)),
      db.select().from(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds)),
      db
        .select()
        .from(spacecraftBuildOrders)
        .where(inArray(spacecraftBuildOrders.stationId, stationIds)),
      db.select().from(stationResearch).where(inArray(stationResearch.stationId, stationIds)),
      db.select().from(worldMissions).where(inArray(worldMissions.originStationId, stationIds)),
    ]);

  const ownStations: StationSnapshot[] = ownStationRows.map((station) => {
    const stResources = allResources.filter((r) => r.stationId === station.id);
    const stBuildings = allBuildings.filter((b) => b.stationId === station.id);
    const stFleets = allFleets.filter((f) => f.stationId === station.id);
    const stBuildOrders = allBuildOrders.filter((o) => o.stationId === station.id);
    const stResearch = allResearch.filter((r) => r.stationId === station.id);
    const stMissions = allMissions.filter((m) => m.originStationId === station.id);

    return {
      id: station.id,
      name: station.name,
      x: station.x,
      y: station.y,
      sectorId: station.sectorId,
      resources: Object.fromEntries(
        stResources.map((r) => [r.resourceKey, r.amount])
      ) as ResourceMap,
      buildings: stBuildings.map((b) => ({
        buildingKey: b.buildingKey,
        level: b.level,
        upgradeEndsAt: b.upgradeEndsAt,
      })),
      defense: stBuildings
        .filter((b) => (defenseUpgradeKeys as readonly string[]).includes(b.buildingKey))
        .map((b) => ({
          upgradeKey: b.buildingKey,
          level: b.level,
          upgradeEndsAt: b.upgradeEndsAt,
        })),
      fleets: stFleets.map((f) => ({
        spacecraftKey: f.spacecraftKey,
        amount: f.amount,
        lockedAmount: f.lockedAmount,
      })),
      builds: stBuildOrders.map((o) => ({
        spacecraftKey: o.spacecraftKey,
        amount: o.amount,
      })),
      research: stResearch.map((r) => ({
        technologyKey: r.technologyKey,
        status: r.status,
        completesAt: r.completesAt,
      })),
      missions: stMissions.map((m) => ({
        missionType: m.missionType,
        status: m.status,
        arrivesAt: m.arrivesAt,
        targetSectorX: m.targetSectorX,
        targetSectorY: m.targetSectorY,
      })),
    };
  });

  // Visible world objects from union of all scanner coverages
  const coverages = await getUserScannerCoverages(userId);
  const coverageBounds = scannerChunkBounds(coverages, WORLD_CONFIG.CHUNK_SIZE);

  const [asteroidRows, debrisRows] = await Promise.all(
    coverageBounds.length > 0
      ? [
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
              or(
                ...coverageBounds.map((bound) =>
                  and(
                    between(asteroids.chunkX, bound.minChunkX, bound.maxChunkX),
                    between(asteroids.chunkY, bound.minChunkY, bound.maxChunkY)
                  )
                )
              )
            ),
          db
            .select()
            .from(debrisFields)
            .where(
              or(
                ...coverageBounds.map((bound) =>
                  and(
                    between(debrisFields.chunkX, bound.minChunkX, bound.maxChunkX),
                    between(debrisFields.chunkY, bound.minChunkY, bound.maxChunkY)
                  )
                )
              )
            ),
        ]
      : [[], []]
  );

  const visibleAsteroidsMap = new Map<
    string,
    { id: string; x: number; y: number; remainingByResource: ResourceMap; remainingAmount: number }
  >();
  for (const row of asteroidRows) {
    if (!isPointVisible(coverages, row)) continue;
    const candidate = visibleAsteroidsMap.get(row.id) ?? {
      id: row.id,
      x: row.x,
      y: row.y,
      remainingByResource: {} as ResourceMap,
      remainingAmount: 0,
    };
    const resourceKey = row.resourceKey as ResourceKey;
    candidate.remainingByResource[resourceKey] =
      (candidate.remainingByResource[resourceKey] ?? 0) + row.remainingAmount;
    candidate.remainingAmount += row.remainingAmount;
    visibleAsteroidsMap.set(row.id, candidate);
  }

  const visibleDebris = debrisRows
    .filter((row) => isPointVisible(coverages, row))
    .map((row) => ({
      id: row.id,
      x: row.x,
      y: row.y,
      resources: row.resources as ResourceMap,
    }));

  // Visible foreign stations via getVisibleChunkStations (uses the same coverages)
  // Use a generous chunk range that covers the union of all scanner coverages
  const allBounds = coverageBounds.reduce(
    (acc, b) => ({
      minChunkX: Math.min(acc.minChunkX, b.minChunkX),
      maxChunkX: Math.max(acc.maxChunkX, b.maxChunkX),
      minChunkY: Math.min(acc.minChunkY, b.minChunkY),
      maxChunkY: Math.max(acc.maxChunkY, b.maxChunkY),
    }),
    { minChunkX: Infinity, maxChunkX: -Infinity, minChunkY: Infinity, maxChunkY: -Infinity }
  );
  const visibleStations =
    coverageBounds.length > 0 ? await getVisibleChunkStations(allBounds, userId, coverages) : [];

  // Combat reports for conflict history
  const combatReports = await getUserCombatReports(userId);

  return {
    userId,
    ownStations,
    visibleAsteroids: [...visibleAsteroidsMap.values()],
    visibleStations,
    visibleDebris,
    combatReports,
  };
}
