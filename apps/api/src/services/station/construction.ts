import {
  AppError,
  ErrorCode,
  buildingKeys,
  isOneOf,
  type BuildingLevels,
  type BuildSlots,
  type ResourceKey,
  type ResourceMap,
} from '@orions-frontier/shared';
import type { ResearchModifiers } from '@orions-frontier/game-config';
import { getDb, type QueryDb, type Tx } from '../../lib/db/index.js';
import { publishUserEvent } from '../../lib/realtime.js';
import {
  findStationBuildingByKeyForUpdate,
  listStationBuildings,
  updateStationBuilding,
  type StationBuildingRow,
} from '../../repositories/station-buildings.js';
import { listStationResources } from '../../repositories/station-resources.js';
import { findOwnedStationForUpdate } from '../../repositories/stations.js';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import { getStationResearchModifiers } from '../research/index.js';
import { creditStationResources } from './resources.js';

export const toBuildingLevels = (rows: { buildingKey: string; level: number }[]) => {
  const levels: BuildingLevels = {};
  for (const row of rows) {
    if (isOneOf(buildingKeys, row.buildingKey)) levels[row.buildingKey] = row.level;
  }
  return levels;
};

const countRunningUpgrades = async (db: QueryDb, stationId: string, now: Date) =>
  (await listStationBuildings(db, stationId)).filter(
    (row) => row.upgradeEndsAt !== null && row.upgradeEndsAt > now
  ).length;

/** Build slots in use by building and defense upgrades, for the station views. */
export async function getBuildSlots(stationId: string, now: Date): Promise<BuildSlots> {
  const db = getDb();
  const [used, modifiers] = await Promise.all([
    countRunningUpgrades(db, stationId, now),
    getStationResearchModifiers(db, stationId),
  ]);
  return { used, total: modifiers.buildSlots };
}

/**
 * Building and defense upgrades share the station's build slots. Call under the station lock so
 * two starts cannot both take the last slot.
 */
export async function assertFreeBuildSlot(
  tx: Tx,
  stationId: string,
  modifiers: ResearchModifiers,
  now: Date
): Promise<void> {
  const running = await countRunningUpgrades(tx, stationId, now);
  if (running >= modifiers.buildSlots) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `No free build slot (${running}/${modifiers.buildSlots})`
    );
  }
}

/**
 * Stops an upgrade that is not due yet and refunds `refund(row)` as far as storage allows.
 * Completion only claims due upgrades, so a cancel and a completion cannot both succeed.
 */
export async function cancelStationUpgrade(
  stationId: string,
  userId: string,
  key: string,
  refund: (row: StationBuildingRow) => { resourceKey: ResourceKey; amount: number }[],
  context: GameExecutionContext
): Promise<void> {
  const resources = await getDb().transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const row = await findStationBuildingByKeyForUpdate(tx, stationId, key);
    if (!row?.upgradeEndsAt || row.upgradeEndsAt <= context.now) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'No running upgrade to cancel');
    }
    await updateStationBuilding(tx, row.id, { upgradeEndsAt: null, updatedAt: context.now });
    const cargo: ResourceMap = {};
    for (const cost of refund(row)) cargo[cost.resourceKey] = cost.amount;
    await creditStationResources(tx, stationId, cargo);
    return listStationResources(tx, stationId);
  });
  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resources.map((row) => [row.resourceKey, row.amount])),
  });
}
