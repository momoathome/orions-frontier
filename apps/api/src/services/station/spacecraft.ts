import { getDb } from '../../lib/db/index.js';
import { publishUserEvent } from '../../lib/realtime.js';
import {
  insertStationSpacecraftIfMissing,
  insertStationSpacecrafts,
  listSpacecraftAmounts,
  listStationSpacecrafts,
  listUsedSpacecraftKeys,
} from './repositories/station-spacecrafts.js';
import {
  deleteBuildOrderBefore,
  insertBuildOrder,
  listBuildOrderAmounts,
  listBuildOrders,
  listBuildSlotEnds,
  updateBuildOrderTimes,
  type BuildOrderRow,
} from './repositories/spacecraft-build-orders.js';
import { listStationResources, payStationCosts } from './repositories/station-resources.js';
import { findBuildingLevel, listBuildingLevels } from './repositories/station-buildings.js';
import { findOwnedStationForUpdate } from './repositories/stations.js';
import {
  calculateCrewCapacity,
  calculateCrewUsage,
  calculateProductionSlots,
  calculateShipyardBuildBonus,
  durationFactor,
  getSpacecraft,
  requirementBlockers,
  researchModifiers,
  spacecrafts,
} from '@orions-frontier/game-config';
import type {
  ResourceKey,
  ResourceMap,
  StationSpacecraftWithDefinition,
} from '@orions-frontier/shared';
import { required, AppError, ErrorCode, QUEUE_LIMIT } from '@orions-frontier/shared';
import type { QueryDb } from '../../lib/db/index.js';
import { listStationOwnerResearch, toResearchLevels } from '../research/index.js';
import { describeBlockers } from './research-queue.js';
import { toBuildingLevels } from './construction.js';
import { creditStationResources } from './resources.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';

/** Owner research and this station's building levels: what decides which ships it can build. */
async function loadUnlockState(db: QueryDb, stationId: string) {
  const [research, buildings] = await Promise.all([
    listStationOwnerResearch(db, stationId),
    listBuildingLevels(db, stationId),
  ]);
  const levels = toResearchLevels(research);
  return {
    research: levels,
    buildings: toBuildingLevels(buildings),
    modifiers: researchModifiers(levels),
  };
}

export const getStationSpacecrafts = async (
  stationId: string
): Promise<StationSpacecraftWithDefinition[]> => {
  const db = getDb();

  const unlocks = await loadUnlockState(db, stationId);
  const definitions = [...spacecrafts];
  const stationRows = await listStationSpacecrafts(db, stationId);
  const stationRowByDefinition = new Map(stationRows.map((row) => [row.spacecraftKey, row]));

  // Load build orders for all definitions in this station
  const buildOrderRows = await listBuildOrders(db, stationId);

  const buildOrdersByKey = buildOrderRows.reduce<Record<string, BuildOrderRow[]>>((acc, o) => {
    (acc[o.spacecraftKey] ??= []).push(o);
    return acc;
  }, {});

  // Sort definitions by role and then by cumulative attack+defense.
  const ROLE_ORDER = ['miner', 'salvager', 'fighter'];

  definitions.sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    const ia = ra === -1 ? Number.MAX_SAFE_INTEGER : ra;
    const ib = rb === -1 ? Number.MAX_SAFE_INTEGER : rb;
    if (ia !== ib) return ia - ib;

    const sa = a.attack + a.defense;
    const sb = b.attack + b.defense;
    return sa - sb; // lower combined stats first
  });

  return definitions.map((def) => {
    const stationRow = stationRowByDefinition.get(def.key);
    return {
      definition: def,
      blockers: requirementBlockers(def.requirements, unlocks.research, unlocks.buildings),
      amount: stationRow?.amount ?? 0,
      lockedAmount: stationRow?.lockedAmount ?? 0,
      buildOrders: (buildOrdersByKey[def.key] ?? []).map((o) => ({
        id: o.id,
        amount: o.amount,
        endsAt: o.endsAt.toISOString(),
      })),
    };
  });
};

// Seed initial spacecrafts for a newly created station

// Three Moles: each delivery covers a meaningful share of the next early upgrade.
const INITIAL_SPACECRAFTS: { key: string; amount: number }[] = [{ key: 'mole', amount: 3 }];

type SeedDb = Pick<ReturnType<typeof getDb>, 'insert'>;

export const seedStationSpacecrafts = async (
  stationId: string,
  db: SeedDb = getDb(),
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  await insertStationSpacecrafts(
    db,
    INITIAL_SPACECRAFTS.map((spacecraft) => ({
      id: context.nextId('station-spacecraft'),
      stationId,
      spacecraftKey: spacecraft.key,
      amount: spacecraft.amount,
      lockedAmount: 0,
      createdAt: context.now,
      updatedAt: context.now,
    }))
  );
};

// Build spacecrafts

export interface BuildOrder {
  spacecraftKey: string;
  amount: number;
}

/** Build time factor of the Shipyard bonus and Fabrication Lines, which add up. */
const shipBuildFactor = (shipyardLevel: number, shipBuildBonus: number) =>
  durationFactor(calculateShipyardBuildBonus(shipyardLevel) + shipBuildBonus);

/** Production slots and build time factor, as the shipyard applies them to new orders. */
export const getStationShipyard = async (stationId: string) => {
  const unlocks = await loadUnlockState(getDb(), stationId);
  const shipyardLevel = unlocks.buildings.shipyard ?? 0;
  return {
    productionSlots: calculateProductionSlots(shipyardLevel),
    buildTimeFactor: shipBuildFactor(shipyardLevel, unlocks.modifiers.shipBuildBonus),
  };
};

export async function getStationHangar(stationId: string): Promise<{
  capacity: number;
  used: number;
}> {
  const db = getDb();
  const [hangarLevel, fleet, queued, unlocks] = await Promise.all([
    findBuildingLevel(db, stationId, 'hangar'),
    listSpacecraftAmounts(db, stationId),
    listBuildOrderAmounts(db, stationId),
    loadUnlockState(db, stationId),
  ]);
  return {
    capacity: calculateCrewCapacity(hangarLevel ?? 0, unlocks.modifiers.crew),
    used: calculateCrewUsage(fleet) + calculateCrewUsage(queued),
  };
}

export const buildSpacecrafts = async (
  stationId: string,
  userId: string,
  orders: BuildOrder[],
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  const db = getDb();

  if (orders.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'No orders provided');
  }

  const requestedKeys = [...new Set(orders.map((order) => order.spacecraftKey))];
  const defs = requestedKeys.map(getSpacecraft).filter((definition) => definition !== undefined);

  if (defs.length !== requestedKeys.length) {
    const foundKeys = new Set(defs.map((d) => d.key));
    const missing = requestedKeys.find((k) => !foundKeys.has(k));
    throw new AppError(ErrorCode.NOT_FOUND, `Spacecraft definition '${missing}' not found`);
  }

  const defByKey = new Map(defs.map((d) => [d.key, d]));

  for (const order of orders) {
    if (!Number.isInteger(order.amount) || order.amount <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
    }
  }

  // Aggregate total resource costs across all orders
  const totalCosts = new Map<ResourceKey, number>();
  for (const order of orders) {
    const def = required(defByKey.get(order.spacecraftKey), 'defByKey.get(order.spacecraftKey)');
    for (const cost of def.costs) {
      totalCosts.set(
        cost.resourceKey,
        (totalCosts.get(cost.resourceKey) ?? 0) + cost.amount * order.amount
      );
    }
  }

  const resources = await db.transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const unlocks = await loadUnlockState(tx, stationId);
    const shipyardLevel = unlocks.buildings.shipyard ?? 0;
    for (const def of defs) {
      const blockers = requirementBlockers(def.requirements, unlocks.research, unlocks.buildings);
      if (blockers.length > 0) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `${def.name}: ${describeBlockers(blockers)}`
        );
      }
    }

    const [fleet, queued] = await Promise.all([
      listSpacecraftAmounts(tx, stationId),
      listBuildOrderAmounts(tx, stationId),
    ]);
    if (queued.length + orders.length > QUEUE_LIMIT) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Queue is full (${QUEUE_LIMIT} orders)`);
    }
    const capacity = calculateCrewCapacity(unlocks.buildings.hangar ?? 0, unlocks.modifiers.crew);
    const hangarUsed = calculateCrewUsage(fleet) + calculateCrewUsage(queued);
    const requestedCrew = orders.reduce(
      (sum, order) =>
        sum +
        order.amount *
          required(defByKey.get(order.spacecraftKey), 'defByKey.get(order.spacecraftKey)').crew,
      0
    );
    if (hangarUsed + requestedCrew > capacity) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Hangar crew capacity exceeded: ${hangarUsed}/${capacity} occupied`
      );
    }

    const short = await payStationCosts(tx, stationId, Object.fromEntries(totalCosts));
    if (short) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Insufficient ${short.resourceKey}: need ${totalCosts.get(short.resourceKey)}, have ${short.have}`
      );
    }

    const buildTimeMultiplier = shipBuildFactor(shipyardLevel, unlocks.modifiers.shipBuildBonus);
    const slots = calculateProductionSlots(shipyardLevel);
    // Each production slot builds one order at a time, its ships one after another. A new order
    // goes to the slot that is free first.
    const slotEnds = Array.from({ length: slots }, () => context.now.getTime());
    for (const { slot, endsAt } of await listBuildSlotEnds(tx, stationId)) {
      if (slot < slots && endsAt)
        slotEnds[slot] = Math.max(context.now.getTime(), endsAt.getTime());
    }
    const orderEndsAt = orders.map((order) => {
      const def = required(defByKey.get(order.spacecraftKey), 'defByKey.get(order.spacecraftKey)');
      const start = Math.min(...slotEnds);
      const slot = slotEnds.indexOf(start);
      const stepMs = Math.ceil(def.buildTime * buildTimeMultiplier) * 1000;
      slotEnds[slot] = start + stepMs * order.amount;
      return {
        order,
        def,
        slot,
        stepMs,
        nextAt: new Date(start + stepMs),
        endsAt: new Date(start + stepMs * order.amount),
      };
    });

    for (const { order, def, slot, stepMs, nextAt, endsAt } of orderEndsAt) {
      await insertBuildOrder(tx, {
        id: context.nextId('spacecraft-build-order'),
        stationId,
        spacecraftKey: def.key,
        amount: order.amount,
        orderedAmount: order.amount,
        unitCost: def.costs,
        slot,
        stepMs,
        nextAt,
        endsAt,
        createdAt: context.now,
      });

      // Ensure stationSpacecrafts row exists (amount=0 if brand new)
      await insertStationSpacecraftIfMissing(tx, {
        id: context.nextId('station-spacecraft'),
        stationId,
        spacecraftKey: def.key,
        amount: 0,
        lockedAmount: 0,
        createdAt: context.now,
        updatedAt: context.now,
      });
    }

    return listStationResources(tx, stationId);
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resources.map((row) => [row.resourceKey, row.amount])),
  });
};

/**
 * Cancels one build order; finished ships stay and the rest is refunded in full, as far as storage
 * allows. Later orders in its slot move up by the time it no longer takes: all of it while it
 * waited, the rest of it while it ran.
 */
export const cancelBuildOrder = async (
  stationId: string,
  userId: string,
  orderId: string,
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<void> => {
  const resources = await getDb().transaction(async (tx) => {
    const station = await findOwnedStationForUpdate(tx, stationId, userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');
    const stationOrders = await listBuildOrders(tx, stationId);
    const slot = stationOrders.find((order) => order.id === orderId)?.slot;
    const orders = stationOrders
      .filter((order) => order.slot === slot)
      .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
    const index = orders.findIndex((order) => order.id === orderId);
    const order = orders[index];
    if (!order) throw new AppError(ErrorCode.NOT_FOUND, 'Build order not found');
    // The amount as deleted, so a ship a concurrent tick just finished is not refunded too.
    const unbuilt = await deleteBuildOrderBefore(tx, order.id, context.now);
    if (unbuilt === undefined) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Build order is already completing');
    }

    const startedAt = Math.max(
      orders[index - 1]?.endsAt.getTime() ?? 0,
      order.createdAt.getTime(),
      context.now.getTime()
    );
    const saved = order.endsAt.getTime() - startedAt;
    for (const later of orders.slice(index + 1)) {
      await updateBuildOrderTimes(
        tx,
        later.id,
        new Date(later.nextAt.getTime() - saved),
        new Date(later.endsAt.getTime() - saved)
      );
    }

    const refund: ResourceMap = {};
    for (const cost of order.unitCost) {
      refund[cost.resourceKey] = (refund[cost.resourceKey] ?? 0) + cost.amount * unbuilt;
    }
    await creditStationResources(tx, stationId, refund);
    return listStationResources(tx, stationId);
  });
  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resources.map((row) => [row.resourceKey, row.amount])),
  });
};

/**
 * Arrivals, combat and build completion look up every ship type they touch. A type removed from
 * the config while ships of it exist would make that work fail on every retry, so the API refuses
 * to start until a migration has moved those rows to a known type.
 */
export async function assertKnownSpacecraftKeys(): Promise<void> {
  const unknown = (await listUsedSpacecraftKeys(getDb())).filter((key) => !getSpacecraft(key));
  if (unknown.length > 0) {
    throw new Error(`Spacecraft types missing from the game config: ${unknown.join(', ')}`);
  }
}
