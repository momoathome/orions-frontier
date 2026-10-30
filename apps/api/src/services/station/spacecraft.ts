import { getDb } from '../../lib/db/index.js';
import { publishUserEvent } from '../../lib/realtime.js';
import {
  insertStationSpacecraftIfMissing,
  insertStationSpacecrafts,
  listSpacecraftAmounts,
  listStationSpacecrafts,
} from '../../repositories/station-spacecrafts.js';
import {
  findLatestBuildOrderEnd,
  insertBuildOrder,
  listBuildOrderAmounts,
  listBuildOrders,
  type BuildOrderRow,
} from '../../repositories/spacecraft-build-orders.js';
import {
  deductStationResource,
  listStationResources,
} from '../../repositories/station-resources.js';
import { findBuildingLevel, listBuildingLevels } from '../../repositories/station-buildings.js';
import { findOwnedStationForUpdate } from '../../repositories/stations.js';
import { listStationOwnerResearch } from '../../repositories/user-research.js';
import {
  calculateBuildingEffect,
  calculateHangarCapacity,
  calculateProductionSlots,
  getSpacecraft,
  requirementBlockers,
  researchModifiers,
  spacecrafts,
} from '@orions-frontier/game-config';
import type { ResourceKey, StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { required, AppError, ErrorCode } from '@orions-frontier/shared';
import type { QueryDb } from '../../lib/db/index.js';
import { describeBlockers, toResearchLevels } from '../research/index.js';
import { toBuildingLevels } from './construction.js';
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

const calculateCrewUsage = (
  entries: readonly { spacecraftKey: string; amount: number }[]
): number =>
  entries.reduce((used, entry) => {
    const definition = getSpacecraft(entry.spacecraftKey);
    if (!definition) throw new Error(`Unknown spacecraft definition '${entry.spacecraftKey}'`);
    return used + entry.amount * definition.crew;
  }, 0);

/** Fleet Coordination raises the crew the hangar holds. */
const hangarCapacity = (hangarLevel: number, crew: number) =>
  Math.floor(calculateHangarCapacity(hangarLevel) * crew);

export const getStationProductionSlots = async (stationId: string) =>
  calculateProductionSlots((await findBuildingLevel(getDb(), stationId, 'shipyard')) ?? 0);

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
    capacity: hangarCapacity(hangarLevel ?? 0, unlocks.modifiers.crew),
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

  const resourceMap = await db.transaction(async (tx) => {
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
    const capacity = hangarCapacity(unlocks.buildings.hangar ?? 0, unlocks.modifiers.crew);
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

    const resourceRows = await listStationResources(tx, stationId);
    const currentResources = new Map(resourceRows.map((row) => [row.resourceKey, row.amount]));
    for (const [resourceKey, needed] of totalCosts.entries()) {
      const current = currentResources.get(resourceKey) ?? 0;
      if (current < needed) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Insufficient ${resourceKey}: need ${needed}, have ${current}`
        );
      }
    }

    const productionBonus =
      calculateBuildingEffect('shipyard', shipyardLevel).find(
        (effect) => effect.type === 'spacecraft_production_bonus'
      )?.value ?? 0;
    const buildTimeMultiplier = Math.max(
      0.25,
      1 - (productionBonus + unlocks.modifiers.shipBuildBonus) / 100
    );
    const slots = calculateProductionSlots(shipyardLevel);
    // One queue per station: each order starts when the previous one ends.
    let queueEnd = Math.max(
      (await findLatestBuildOrderEnd(tx, stationId))?.getTime() ?? 0,
      context.now.getTime()
    );
    const orderEndsAt = orders.map((order) => {
      const def = required(defByKey.get(order.spacecraftKey), 'defByKey.get(order.spacecraftKey)');
      queueEnd +=
        Math.ceil(Math.ceil(order.amount / slots) * def.buildTime * buildTimeMultiplier) * 1000;
      return { order, def, endsAt: new Date(queueEnd) };
    });

    for (const [resourceKey, amount] of totalCosts.entries()) {
      await deductStationResource(tx, stationId, resourceKey, amount);
      currentResources.set(resourceKey, (currentResources.get(resourceKey) ?? 0) - amount);
    }

    for (const { order, def, endsAt } of orderEndsAt) {
      await insertBuildOrder(tx, {
        id: context.nextId('spacecraft-build-order'),
        stationId,
        spacecraftKey: def.key,
        amount: order.amount,
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

    return currentResources;
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resourceMap),
  });
};
