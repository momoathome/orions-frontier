import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stations } from '../lib/db/schema/stations.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { calculateBuildingEffect } from '@orions-frontier/game-config';
import {
  isOneOf,
  AppError,
  ErrorCode,
  entriesOf,
  resourceKeys,
  type ResourceKey,
  type ResourceMap,
} from '@orions-frontier/shared';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../lib/game-execution-context.js';

// Initial resource amounts for new stations

const INITIAL_RESOURCES: Record<ResourceKey, number> = {
  carbon: 250,
  titanium: 300,
  hydrogenium: 275,
  kyber_crystal: 0,
  astatine: 0,
};

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;
type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

const storageCapacity = (warehouseLevel: number): number =>
  calculateBuildingEffect('warehouse', warehouseLevel).find(
    (effect) => effect.type === 'storage_capacity'
  )?.value ?? 0;

// Seed resources for a newly created station

export const seedStationResources = async (
  stationId: string,
  db: SeedDb = getDb(),
  amounts: ResourceMap = INITIAL_RESOURCES
): Promise<void> => {
  const rows = resourceKeys.map((resourceKey) => ({
    stationId,
    resourceKey,
    amount: amounts[resourceKey] ?? 0,
  }));

  await db.insert(stationResources).values(rows);
};

export const getStationResources = async (
  userId: string,
  stationId: string
): Promise<ResourceMap> => {
  const db = getDb();
  const rows = await db
    .select({ resource: stationResources })
    .from(stationResources)
    .innerJoin(stations, eq(stationResources.stationId, stations.id))
    .where(
      and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
    );
  if (rows.length === 0) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  return rows.reduce<ResourceMap>((acc, row) => {
    const key = row.resource.resourceKey;
    acc[key] = row.resource.amount;
    return acc;
  }, {});
};

export const getStationStorageCapacity = async (stationId: string): Promise<number> => {
  const [warehouse] = await getDb()
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'warehouse'))
    )
    .limit(1);

  return storageCapacity(warehouse?.level ?? 0);
};

/**
 * Credits as much cargo as fits into each resource's warehouse allocation.
 * Resource rows are locked in a stable order so concurrent arrivals cannot
 * exceed capacity.
 */
export const creditStationResources = async (
  tx: Tx,
  stationId: string,
  cargo: ResourceMap
): Promise<ResourceMap> => {
  const invalidKey = Object.keys(cargo).find((key) => !isOneOf(resourceKeys, key));
  if (invalidKey) throw new Error(`Unknown resource '${invalidKey}'`);

  await tx
    .select({ id: stations.id })
    .from(stations)
    .where(eq(stations.id, stationId))
    .for('update');

  const [warehouse] = await tx
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'warehouse'))
    )
    .limit(1);
  const capacity = storageCapacity(warehouse?.level ?? 0);
  const rows = await tx
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId))
    .orderBy(stationResources.resourceKey)
    .for('update');
  const amounts = new Map(rows.map((row) => [row.resourceKey, row.amount]));
  const credited: ResourceMap = {};

  for (const resourceKey of resourceKeys) {
    const requested = cargo[resourceKey] ?? 0;
    if (requested <= 0) continue;
    const current = amounts.get(resourceKey) ?? 0;
    const accepted = Math.min(requested, Math.max(0, capacity - current));
    if (accepted <= 0) continue;

    const [updated] = await tx
      .update(stationResources)
      .set({ amount: current + accepted })
      .where(
        and(
          eq(stationResources.stationId, stationId),
          eq(stationResources.resourceKey, resourceKey)
        )
      )
      .returning({ resourceKey: stationResources.resourceKey });
    if (!updated) {
      await tx
        .insert(stationResources)
        .values({ stationId, resourceKey, amount: current + accepted });
    }
    amounts.set(resourceKey, current + accepted);
    credited[resourceKey] = accepted;
  }

  return credited;
};

// Get actual mining deliveries during the last hour.

export const getDeliveredResourceRates = async (
  userId: string,
  stationId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<ResourceMap> => {
  const db = getDb();
  const [station] = await db
    .select({ id: stations.id })
    .from(stations)
    .where(
      and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
    );
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const ssRows = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));

  if (ssRows.length === 0) return {};

  const ssIds = ssRows.map((s) => s.id);

  // Look at all arrived trips heading TO station in the last hour
  const oneHourAgo = new Date(context.now.getTime() - 3_600_000);
  const arrivedTrips = await db
    .select({
      cargoManifest: spacecraftTrips.cargoManifest,
      arrivesAt: spacecraftTrips.arrivesAt,
    })
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.stationSpacecraftId, ssIds),
        eq(spacecraftTrips.status, 'arrived'),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.toType, 'station'),
        gte(spacecraftTrips.arrivesAt, oneHourAgo)
      )
    );

  // Sum up all delivered resources and express as /h
  // (all trips are within the 1-hour window, so sum = effective rate)
  const delivered: ResourceMap = {};
  for (const trip of arrivedTrips) {
    if (!trip.cargoManifest) continue;
    for (const [key, amount] of entriesOf(trip.cargoManifest)) {
      delivered[key] = (delivered[key] ?? 0) + amount;
    }
  }

  return delivered;
};
