import { getDb, type Tx } from '../../lib/db/index.js';
import {
  insertStationResource,
  insertStationResources,
  listOwnedStationResources,
  listStationResourcesInKeyOrderForUpdate,
  setStationResourceAmount,
} from '../../repositories/station-resources.js';
import { findBuildingLevel } from '../../repositories/station-buildings.js';
import { findOwnedStation, findStationForUpdate } from '../../repositories/stations.js';
import { listMiningDeliveriesSince } from '../../repositories/spacecraft-trips.js';
import { listStationSpacecraftIds } from '../../repositories/station-spacecrafts.js';
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
} from '../../lib/game-execution-context.js';

// Initial resource amounts for new stations

const INITIAL_RESOURCES: Record<ResourceKey, number> = {
  carbon: 250,
  titanium: 300,
  hydrogenium: 275,
  kyber_crystal: 0,
  astatine: 0,
};

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

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

  await insertStationResources(db, rows);
};

export const getStationResources = async (
  userId: string,
  stationId: string
): Promise<ResourceMap> => {
  const db = getDb();
  const rows = await listOwnedStationResources(db, stationId, userId);
  if (rows.length === 0) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  return rows.reduce<ResourceMap>((acc, row) => {
    const key = row.resource.resourceKey;
    acc[key] = row.resource.amount;
    return acc;
  }, {});
};

export const getStationStorageCapacity = async (stationId: string): Promise<number> => {
  const warehouseLevel = await findBuildingLevel(getDb(), stationId, 'warehouse');

  return storageCapacity(warehouseLevel ?? 0);
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

  await findStationForUpdate(tx, stationId);

  const warehouseLevel = await findBuildingLevel(tx, stationId, 'warehouse');
  const capacity = storageCapacity(warehouseLevel ?? 0);
  const rows = await listStationResourcesInKeyOrderForUpdate(tx, stationId);
  const amounts = new Map(rows.map((row) => [row.resourceKey, row.amount]));
  const credited: ResourceMap = {};

  for (const resourceKey of resourceKeys) {
    const requested = cargo[resourceKey] ?? 0;
    if (requested <= 0) continue;
    const current = amounts.get(resourceKey) ?? 0;
    const accepted = Math.min(requested, Math.max(0, capacity - current));
    if (accepted <= 0) continue;

    const updated = await setStationResourceAmount(tx, stationId, resourceKey, current + accepted);
    if (!updated) {
      await insertStationResource(tx, { stationId, resourceKey, amount: current + accepted });
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
  const station = await findOwnedStation(db, stationId, userId);
  if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

  const ssRows = await listStationSpacecraftIds(db, stationId);

  if (ssRows.length === 0) return {};

  const ssIds = ssRows.map((s) => s.id);

  // Look at all arrived trips heading TO station in the last hour
  const oneHourAgo = new Date(context.now.getTime() - 3_600_000);
  const arrivedTrips = await listMiningDeliveriesSince(db, ssIds, oneHourAgo);

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
