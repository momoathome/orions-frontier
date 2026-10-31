import { getBuilding } from '@orions-frontier/game-config';
import { isOneOf, buildingKeys, defenseUpgradeKeys } from '@orions-frontier/shared';
import { getDb } from '../../lib/db/index.js';
import { logger as rootLogger } from '../../lib/logger.js';
import { publishUserEvent } from '../../lib/realtime.js';
import { completionEventId, type PlaytestCompletionEvent } from '../../lib/completion-events.js';
import { claimBuiltShips, listDueBuildOrders } from './repositories/spacecraft-build-orders.js';
import {
  completeBuildingUpgrade,
  findStationBuildingByKeyForUpdate,
  listDueBuildingUpgrades,
  updateStationBuilding,
} from './repositories/station-buildings.js';
import { addBuiltSpacecraft } from './repositories/station-spacecrafts.js';
import { findStationForUpdate } from './repositories/stations.js';
import { advanceStationQueue, dropStationUpgrade } from './construction.js';
import { defenseUpgradeMaxLevel } from './defense.js';

const logger = rootLogger.child({ name: 'station-completion' });

export interface CompletionPassResult {
  completed: number;
  failed: number;
  events: PlaytestCompletionEvent[];
}

export interface BuiltSpacecraft {
  stationId: string;
  spacecraftKey: string;
  amount: number;
  builtAt: Date;
}

export async function completeDueBuildings(now: Date): Promise<CompletionPassResult> {
  const db = getDb();
  const result: CompletionPassResult = { completed: 0, failed: 0, events: [] };

  for (const building of await listDueBuildingUpgrades(db, now)) {
    try {
      const maxLevel = isOneOf(buildingKeys, building.buildingKey)
        ? getBuilding(building.buildingKey).maxLevel
        : defenseUpgradeMaxLevel(building.buildingKey);
      const endsAt = building.upgradeEndsAt;
      if (endsAt === null) continue;
      if (maxLevel === null) {
        result.failed += 1;
        result.events.push(...(await dropUnknownUpgrade(building, endsAt)));
        continue;
      }
      // The freed slot goes to the next queued job at the moment it freed.
      const completed = await db.transaction(async (tx) => {
        const station = await findStationForUpdate(tx, building.stationId);
        const done = await completeBuildingUpgrade(tx, building.id, maxLevel, endsAt, now);
        if (!done) return null;
        const queue =
          station && !station.destroyedAt ? await advanceStationQueue(tx, station, endsAt) : null;
        return { level: done.level, dropped: queue?.dropped ?? [] };
      });
      if (!completed) continue;
      result.completed += 1;
      result.events.push(...completed.dropped);
      if (isOneOf(defenseUpgradeKeys, building.buildingKey)) {
        result.events.push({
          type: 'defense_completed',
          eventId: completionEventId('defense_completed', building.id, String(completed.level)),
          occurredAt: endsAt,
          userId: building.userId,
          stationId: building.stationId,
          defenseKey: building.buildingKey,
          newLevel: completed.level,
        });
        publishUserEvent(building.userId, 'defense_upgrade_completed', {
          stationId: building.stationId,
          upgradeKey: building.buildingKey,
          newLevel: completed.level,
        });
      } else {
        result.events.push({
          type: 'building_completed',
          eventId: completionEventId('building_completed', building.id, String(completed.level)),
          occurredAt: endsAt,
          userId: building.userId,
          stationId: building.stationId,
          buildingKey: building.buildingKey,
          newLevel: completed.level,
        });
        publishUserEvent(building.userId, 'building_upgrade_completed', {
          stationId: building.stationId,
          buildingKey: building.buildingKey,
          newLevel: completed.level,
        });
      }
    } catch (error) {
      result.failed += 1;
      logger.error({ buildingId: building.id, error }, 'Failed to complete building upgrade');
    }
  }
  return result;
}

/**
 * A building type removed from the config can never complete; its upgrade is dropped with a
 * refund, like a broken queued job, instead of being retried every tick.
 */
async function dropUnknownUpgrade(
  building: { id: string; stationId: string; buildingKey: string },
  endsAt: Date
) {
  logger.error(
    { buildingId: building.id, buildingKey: building.buildingKey },
    'Dropping the upgrade of an unknown building'
  );
  return getDb().transaction(async (tx) => {
    const station = await findStationForUpdate(tx, building.stationId);
    const row = await findStationBuildingByKeyForUpdate(
      tx,
      building.stationId,
      building.buildingKey
    );
    if (!row?.upgradeEndsAt) return [];
    if (station && !station.destroyedAt) {
      const paidCost = row.upgradePaidCost ?? [];
      return dropStationUpgrade(tx, station, { id: row.id, paidCost }, endsAt);
    }
    // A destroyed station gets nothing back and keeps no queue, as when an upgrade completes there.
    await updateStationBuilding(tx, row.id, {
      upgradeEndsAt: null,
      upgradePaidCost: null,
      updatedAt: endsAt,
    });
    return [];
  });
}

/** `afterBuilt` runs after the ships are committed, in its own transaction. */
export async function completeDueSpacecraft(
  now: Date,
  afterBuilt: (built: BuiltSpacecraft) => Promise<PlaytestCompletionEvent | null>
): Promise<CompletionPassResult> {
  const db = getDb();
  const result: CompletionPassResult = { completed: 0, failed: 0, events: [] };

  for (const order of await listDueBuildOrders(db, now)) {
    // Ships come one per step; a late tick catches up on every step that has passed.
    const built =
      order.stepMs > 0
        ? Math.min(
            order.amount,
            Math.floor((now.getTime() - order.nextAt.getTime()) / order.stepMs) + 1
          )
        : order.amount;
    const builtAt = new Date(order.nextAt.getTime() + (built - 1) * order.stepMs);
    const nextAt = new Date(builtAt.getTime() + order.stepMs);
    const finished = built >= order.amount;
    try {
      // Station lock first, like every other station write, so the order cannot deadlock.
      const claimed = await db.transaction(async (tx) => {
        await findStationForUpdate(tx, order.stationId);
        if (!(await claimBuiltShips(tx, order.id, order.amount, built, nextAt))) return false;
        await addBuiltSpacecraft(tx, order.stationId, order.spacecraftKey, built, builtAt);
        return true;
      });
      if (!claimed) continue;

      result.completed += 1;
      // The logbook notes the whole order once its last ship is done.
      if (finished) {
        result.events.push({
          type: 'spacecraft_completed',
          eventId: completionEventId('spacecraft_completed', order.id),
          occurredAt: builtAt,
          userId: order.userId,
          stationId: order.stationId,
          orderId: order.id,
          spacecraftKey: order.spacecraftKey,
          amount: order.orderedAmount,
        });
      }
      publishUserEvent(order.userId, 'spacecraft_build_completed', {
        stationId: order.stationId,
        spacecraftKey: order.spacecraftKey,
        amount: built,
        orderId: order.id,
      });
    } catch (error) {
      result.failed += 1;
      logger.error({ orderId: order.id, error }, 'Failed to complete spacecraft build');
      continue;
    }
    try {
      const followUp = await afterBuilt({
        stationId: order.stationId,
        spacecraftKey: order.spacecraftKey,
        amount: built,
        builtAt,
      });
      if (followUp) result.events.push(followUp);
    } catch (error) {
      logger.error({ orderId: order.id, error }, 'Failed to dispatch built spacecraft');
    }
  }
  return result;
}
