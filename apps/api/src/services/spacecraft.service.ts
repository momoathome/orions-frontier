import { and, eq, isNull, max, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { publishUserEvent } from '../lib/realtime.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { stations } from '../lib/db/schema/stations.js';
import {
  calculateBuildingEffect,
  calculateHangarCapacity,
  getSpacecraft,
  SHIPYARD_UNLOCKS,
  spacecrafts,
} from '@orions-frontier/game-config';
import type { ResourceKey, StationSpacecraftWithDefinition } from '@orions-frontier/shared';
import { required, AppError, ErrorCode } from '@orions-frontier/shared';
import { hasCompletedResearch } from './research.service.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../lib/game-execution-context.js';

export const getStationSpacecrafts = async (
  stationId: string
): Promise<StationSpacecraftWithDefinition[]> => {
  const db = getDb();

  const [shipyard] = await db
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'shipyard'))
    )
    .limit(1);
  const unlockedKeys = Object.entries(SHIPYARD_UNLOCKS)
    .filter(([level]) => (shipyard?.level ?? 0) >= Number(level))
    .flatMap(([, keys]) => keys);
  if (unlockedKeys.length === 0) return [];

  const definitions = spacecrafts.filter((definition) => unlockedKeys.includes(definition.key));
  const stationRows = await db
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
  const stationRowByDefinition = new Map(stationRows.map((row) => [row.spacecraftKey, row]));

  // Load build orders for all definitions in this station
  const buildOrderRows = await db
    .select()
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));

  const buildOrdersByKey = buildOrderRows.reduce<
    Record<string, (typeof spacecraftBuildOrders.$inferSelect)[]>
  >((acc, o) => {
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
  await db.insert(stationSpacecrafts).values(
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

export async function getStationHangar(stationId: string): Promise<{
  capacity: number;
  used: number;
}> {
  const db = getDb();
  const [hangar, fleet, queued] = await Promise.all([
    db
      .select({ level: stationBuildings.level })
      .from(stationBuildings)
      .where(
        and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'hangar'))
      )
      .limit(1),
    db
      .select({
        spacecraftKey: stationSpacecrafts.spacecraftKey,
        amount: stationSpacecrafts.amount,
      })
      .from(stationSpacecrafts)
      .where(eq(stationSpacecrafts.stationId, stationId)),
    db
      .select({
        spacecraftKey: spacecraftBuildOrders.spacecraftKey,
        amount: spacecraftBuildOrders.amount,
      })
      .from(spacecraftBuildOrders)
      .where(eq(spacecraftBuildOrders.stationId, stationId)),
  ]);
  return {
    capacity: calculateHangarCapacity(hangar[0]?.level ?? 0),
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
    const [station] = await tx
      .select({ id: stations.id })
      .from(stations)
      .where(
        and(eq(stations.id, stationId), eq(stations.userId, userId), isNull(stations.destroyedAt))
      )
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [shipyardBuilding] = await tx
      .select({ level: stationBuildings.level })
      .from(stationBuildings)
      .where(
        and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'shipyard'))
      )
      .limit(1);
    const shipyardLevel = shipyardBuilding?.level ?? 0;
    const unlockedKeys = new Set<string>();
    for (const [level, keys] of Object.entries(SHIPYARD_UNLOCKS)) {
      if (shipyardLevel >= Number(level)) keys.forEach((key) => unlockedKeys.add(key));
    }
    for (const order of orders) {
      if (!unlockedKeys.has(order.spacecraftKey)) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          `Spacecraft '${order.spacecraftKey}' is not unlocked at current shipyard level`
        );
      }
    }

    const [hangarBuilding, fleet, queued] = await Promise.all([
      tx
        .select({ level: stationBuildings.level })
        .from(stationBuildings)
        .where(
          and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'hangar'))
        )
        .limit(1),
      tx
        .select({
          spacecraftKey: stationSpacecrafts.spacecraftKey,
          amount: stationSpacecrafts.amount,
        })
        .from(stationSpacecrafts)
        .where(eq(stationSpacecrafts.stationId, stationId)),
      tx
        .select({
          spacecraftKey: spacecraftBuildOrders.spacecraftKey,
          amount: spacecraftBuildOrders.amount,
        })
        .from(spacecraftBuildOrders)
        .where(eq(spacecraftBuildOrders.stationId, stationId)),
    ]);
    const hangarCapacity = calculateHangarCapacity(hangarBuilding[0]?.level ?? 0);
    const hangarUsed = calculateCrewUsage(fleet) + calculateCrewUsage(queued);
    const requestedCrew = orders.reduce(
      (sum, order) =>
        sum +
        order.amount *
          required(defByKey.get(order.spacecraftKey), 'defByKey.get(order.spacecraftKey)').crew,
      0
    );
    if (hangarUsed + requestedCrew > hangarCapacity) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Hangar crew capacity exceeded: ${hangarUsed}/${hangarCapacity} occupied`
      );
    }

    const resourceRows = await tx
      .select()
      .from(stationResources)
      .where(eq(stationResources.stationId, stationId));
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

    const researchBonus = (await hasCompletedResearch(tx, stationId, 'automated_shipyard'))
      ? 10
      : 0;
    const productionBonus =
      calculateBuildingEffect('shipyard', shipyardLevel).find(
        (effect) => effect.type === 'spacecraft_production_bonus'
      )?.value ?? 0;
    const buildTimeMultiplier = Math.max(0.25, 1 - (productionBonus + researchBonus) / 100);
    const endsAtByKey = new Map<string, Date>();
    for (const def of defs) {
      const [row] = await tx
        .select({ maxEndsAt: max(spacecraftBuildOrders.endsAt) })
        .from(spacecraftBuildOrders)
        .where(
          and(
            eq(spacecraftBuildOrders.stationId, stationId),
            eq(spacecraftBuildOrders.spacecraftKey, def.key)
          )
        );
      if (row?.maxEndsAt) endsAtByKey.set(def.key, row.maxEndsAt);
    }
    const now = context.now.getTime();
    const orderEndsAt = orders.map((order) => {
      const def = required(defByKey.get(order.spacecraftKey), 'defByKey.get(order.spacecraftKey)');
      const baseline = Math.max((endsAtByKey.get(def.key) ?? new Date(0)).getTime(), now);
      const endsAt = new Date(
        baseline + Math.ceil(order.amount * def.buildTime * buildTimeMultiplier) * 1000
      );
      endsAtByKey.set(def.key, endsAt);
      return { order, def, endsAt };
    });

    for (const [resourceKey, amount] of totalCosts.entries()) {
      await tx
        .update(stationResources)
        .set({ amount: sql`${stationResources.amount} - ${amount}` })
        .where(
          and(
            eq(stationResources.stationId, stationId),
            eq(stationResources.resourceKey, resourceKey)
          )
        );
      currentResources.set(resourceKey, (currentResources.get(resourceKey) ?? 0) - amount);
    }

    for (const { order, def, endsAt } of orderEndsAt) {
      await tx.insert(spacecraftBuildOrders).values({
        id: context.nextId('spacecraft-build-order'),
        stationId,
        spacecraftKey: def.key,
        amount: order.amount,
        endsAt,
        createdAt: context.now,
      });

      // Ensure stationSpacecrafts row exists (amount=0 if brand new)
      await tx
        .insert(stationSpacecrafts)
        .values({
          id: context.nextId('station-spacecraft'),
          stationId,
          spacecraftKey: def.key,
          amount: 0,
          lockedAmount: 0,
          createdAt: context.now,
          updatedAt: context.now,
        })
        .onConflictDoNothing();
    }

    return currentResources;
  });

  publishUserEvent(userId, 'resources_updated', {
    stationId,
    resources: Object.fromEntries(resourceMap),
  });
};
