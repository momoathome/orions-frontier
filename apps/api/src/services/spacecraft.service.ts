import { eq, inArray, max, and, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { publishUserEvent } from '../lib/realtime.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import {
  spacecraftDefinitions,
  spacecraftDefinitionCosts,
} from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { stations } from '../lib/db/schema/stations.js';
import {
  calculateBuildingEffect,
  calculateHangarCapacity,
  SHIPYARD_UNLOCKS,
} from '@orions-frontier/game-config';
import type {
  SpacecraftRole,
  StationSpacecraftWithDefinition,
  ResourceKey,
} from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';
import { hasCompletedResearch } from './research.service.js';

export const getStationSpacecrafts = async (
  stationId: string
): Promise<StationSpacecraftWithDefinition[]> => {
  const db = getDb();

  const [shipyard] = await db
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .innerJoin(
      buildingDefinitions,
      eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
    )
    .where(and(eq(stationBuildings.stationId, stationId), eq(buildingDefinitions.key, 'shipyard')))
    .limit(1);
  const unlockedKeys = Object.entries(SHIPYARD_UNLOCKS)
    .filter(([level]) => (shipyard?.level ?? 0) >= Number(level))
    .flatMap(([, keys]) => keys);
  if (unlockedKeys.length === 0) return [];

  const definitions = await db
    .select()
    .from(spacecraftDefinitions)
    .where(inArray(spacecraftDefinitions.key, unlockedKeys));
  const definitionIds = definitions.map((definition) => definition.id);
  const stationRows = await db
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
  const stationRowByDefinition = new Map(
    stationRows.map((row) => [row.spacecraftDefinitionId, row])
  );

  const costs =
    definitionIds.length > 0
      ? await db
          .select()
          .from(spacecraftDefinitionCosts)
          .where(inArray(spacecraftDefinitionCosts.spacecraftDefinitionId, definitionIds))
      : [];

  const costsByDefinitionId = costs.reduce<
    Record<string, (typeof spacecraftDefinitionCosts.$inferSelect)[]>
  >((acc, cost) => {
    (acc[cost.spacecraftDefinitionId] ??= []).push(cost);
    return acc;
  }, {});

  // Load build orders for all definitions in this station
  const buildOrderRows =
    definitionIds.length > 0
      ? await db
          .select()
          .from(spacecraftBuildOrders)
          .where(eq(spacecraftBuildOrders.stationId, stationId))
      : [];

  const buildOrdersByDefId = buildOrderRows.reduce<
    Record<string, (typeof spacecraftBuildOrders.$inferSelect)[]>
  >((acc, o) => {
    (acc[o.spacecraftDefinitionId] ??= []).push(o);
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
    const stationRow = stationRowByDefinition.get(def.id);
    return {
      definition: {
        id: def.id,
        key: def.key,
        name: def.name,
        description: def.description,
        role: def.role as SpacecraftRole,
        image: def.image,
        attack: def.attack,
        defense: def.defense,
        cargo: def.cargo,
        speed: def.speed,
        miningRate: def.miningRate,
        buildTime: def.buildTime,
        costs: (costsByDefinitionId[def.id] ?? []).map((c) => ({
          resourceKey: c.resourceKey as ResourceKey,
          amount: c.amount,
        })),
      },
      amount: stationRow?.amount ?? 0,
      lockedAmount: stationRow?.lockedAmount ?? 0,
      buildOrders: (buildOrdersByDefId[def.id] ?? []).map((o) => ({
        id: o.id,
        amount: o.amount,
        endsAt: o.endsAt.toISOString(),
      })),
    };
  });
};

// ============================================================================
// Seed initial spacecrafts for a newly created station
// ============================================================================

const INITIAL_SPACECRAFTS: { key: string; amount: number }[] = [{ key: 'mole', amount: 1 }];

type SeedDb = Pick<ReturnType<typeof getDb>, 'select' | 'insert'>;

export const seedStationSpacecrafts = async (
  stationId: string,
  db: SeedDb = getDb()
): Promise<void> => {
  const keys = INITIAL_SPACECRAFTS.map((s) => s.key);
  const defs = await db
    .select({ id: spacecraftDefinitions.id, key: spacecraftDefinitions.key })
    .from(spacecraftDefinitions)
    .where(inArray(spacecraftDefinitions.key, keys));

  if (defs.length === 0) return;

  await db.insert(stationSpacecrafts).values(
    defs.map((def) => ({
      stationId,
      spacecraftDefinitionId: def.id,
      amount: INITIAL_SPACECRAFTS.find((s) => s.key === def.key)!.amount,
      lockedAmount: 0,
    }))
  );
};

// ============================================================================
// Build spacecrafts
// ============================================================================

export interface BuildOrder {
  spacecraftKey: string;
  amount: number;
}

export async function getStationHangar(stationId: string): Promise<{
  capacity: number;
  used: number;
}> {
  const db = getDb();
  const [core, fleet, queued] = await Promise.all([
    db
      .select({ level: stationBuildings.level })
      .from(stationBuildings)
      .innerJoin(
        buildingDefinitions,
        eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
      )
      .where(and(eq(stationBuildings.stationId, stationId), eq(buildingDefinitions.key, 'core')))
      .limit(1),
    db
      .select({ used: sql<number>`coalesce(sum(${stationSpacecrafts.amount}), 0)::int` })
      .from(stationSpacecrafts)
      .where(eq(stationSpacecrafts.stationId, stationId)),
    db
      .select({ used: sql<number>`coalesce(sum(${spacecraftBuildOrders.amount}), 0)::int` })
      .from(spacecraftBuildOrders)
      .where(eq(spacecraftBuildOrders.stationId, stationId)),
  ]);
  return {
    capacity: calculateHangarCapacity(core[0]?.level ?? 0),
    used: (fleet[0]?.used ?? 0) + (queued[0]?.used ?? 0),
  };
}

export const buildSpacecrafts = async (
  stationId: string,
  userId: string,
  orders: BuildOrder[]
): Promise<void> => {
  const db = getDb();

  if (orders.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'No orders provided');
  }

  // Load spacecraft definitions for all requested keys
  const requestedKeys = [...new Set(orders.map((order) => order.spacecraftKey))];
  const defs = await db
    .select()
    .from(spacecraftDefinitions)
    .where(inArray(spacecraftDefinitions.key, requestedKeys));

  if (defs.length !== requestedKeys.length) {
    const foundKeys = new Set(defs.map((d) => d.key));
    const missing = requestedKeys.find((k) => !foundKeys.has(k));
    throw new AppError(ErrorCode.NOT_FOUND, `Spacecraft definition '${missing}' not found`);
  }

  const defByKey = new Map(defs.map((d) => [d.key, d]));

  // Load costs for all definitions
  const defIds = defs.map((d) => d.id);
  const costs = await db
    .select()
    .from(spacecraftDefinitionCosts)
    .where(inArray(spacecraftDefinitionCosts.spacecraftDefinitionId, defIds));

  const costsByDefId = costs.reduce<
    Record<string, (typeof spacecraftDefinitionCosts.$inferSelect)[]>
  >((acc, c) => {
    (acc[c.spacecraftDefinitionId] ??= []).push(c);
    return acc;
  }, {});

  // Load shipyard level
  const [shipyardDef] = await db
    .select({ id: buildingDefinitions.id })
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, 'shipyard'))
    .limit(1);

  if (!shipyardDef) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Shipyard building definition not found');
  }

  for (const order of orders) {
    if (!Number.isInteger(order.amount) || order.amount <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
    }
  }

  // Aggregate total resource costs across all orders
  const totalCosts = new Map<string, number>();
  for (const order of orders) {
    const def = defByKey.get(order.spacecraftKey)!;
    const defCosts = costsByDefId[def.id] ?? [];
    for (const cost of defCosts) {
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
      .where(and(eq(stations.id, stationId), eq(stations.userId, userId)))
      .for('update');
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [shipyardBuilding] = await tx
      .select({ level: stationBuildings.level })
      .from(stationBuildings)
      .where(
        and(
          eq(stationBuildings.stationId, stationId),
          eq(stationBuildings.buildingDefinitionId, shipyardDef.id)
        )
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

    const [coreBuilding, fleetUsage, queuedUsage] = await Promise.all([
      tx
        .select({ level: stationBuildings.level })
        .from(stationBuildings)
        .innerJoin(
          buildingDefinitions,
          eq(stationBuildings.buildingDefinitionId, buildingDefinitions.id)
        )
        .where(and(eq(stationBuildings.stationId, stationId), eq(buildingDefinitions.key, 'core')))
        .limit(1),
      tx
        .select({ used: sql<number>`coalesce(sum(${stationSpacecrafts.amount}), 0)::int` })
        .from(stationSpacecrafts)
        .where(eq(stationSpacecrafts.stationId, stationId)),
      tx
        .select({ used: sql<number>`coalesce(sum(${spacecraftBuildOrders.amount}), 0)::int` })
        .from(spacecraftBuildOrders)
        .where(eq(spacecraftBuildOrders.stationId, stationId)),
    ]);
    const hangarCapacity = calculateHangarCapacity(coreBuilding[0]?.level ?? 0);
    const hangarUsed = (fleetUsage[0]?.used ?? 0) + (queuedUsage[0]?.used ?? 0);
    const requestedAmount = orders.reduce((sum, order) => sum + order.amount, 0);
    if (hangarUsed + requestedAmount > hangarCapacity) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Hangar capacity exceeded: ${hangarUsed}/${hangarCapacity} occupied`
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
    const endsAtByDefId = new Map<string, Date>();
    for (const def of defs) {
      const [row] = await tx
        .select({ maxEndsAt: max(spacecraftBuildOrders.endsAt) })
        .from(spacecraftBuildOrders)
        .where(
          and(
            eq(spacecraftBuildOrders.stationId, stationId),
            eq(spacecraftBuildOrders.spacecraftDefinitionId, def.id)
          )
        );
      if (row?.maxEndsAt) endsAtByDefId.set(def.id, row.maxEndsAt);
    }
    const now = Date.now();
    const orderEndsAt = orders.map((order) => {
      const def = defByKey.get(order.spacecraftKey)!;
      const baseline = Math.max((endsAtByDefId.get(def.id) ?? new Date(0)).getTime(), now);
      const endsAt = new Date(
        baseline + Math.ceil(order.amount * def.buildTime * buildTimeMultiplier) * 1000
      );
      endsAtByDefId.set(def.id, endsAt);
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
        stationId,
        spacecraftDefinitionId: def.id,
        amount: order.amount,
        endsAt,
      });

      // Ensure stationSpacecrafts row exists (amount=0 if brand new)
      await tx
        .insert(stationSpacecrafts)
        .values({
          stationId,
          spacecraftDefinitionId: def.id,
          amount: 0,
          lockedAmount: 0,
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
