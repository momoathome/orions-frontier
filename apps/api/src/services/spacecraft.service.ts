import { eq, inArray, max, and, sql } from 'drizzle-orm';
import { getDb } from '../lib/db/index.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import {
  spacecraftDefinitions,
  spacecraftDefinitionCosts,
} from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftBuildOrders } from '../lib/db/schema/spacecraft-build-orders.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationBuildings } from '../lib/db/schema/station-buildings.js';
import { buildingDefinitions } from '../lib/db/schema/building-definitions.js';
import { SHIPYARD_UNLOCKS } from '@orions-frontier/game-config';
import { spacecraftBuildQueue } from '../queue/queues/spacecraft-build-queue.js';
import type {
  SpacecraftRole,
  StationSpacecraftWithDefinition,
  ResourceKey,
} from '@orions-frontier/shared';
import { AppError, ErrorCode } from '@orions-frontier/shared';

export const getStationSpacecrafts = async (
  stationId: string,
): Promise<StationSpacecraftWithDefinition[]> => {
  const db = getDb();

  const rows = await db
    .select()
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id),
    )
    .where(eq(stationSpacecrafts.stationId, stationId));

  const definitionIds = [...new Set(rows.map((r) => r.spacecraft_definitions.id))];

  const costs =
    definitionIds.length > 0
      ? await db
          .select()
          .from(spacecraftDefinitionCosts)
          .where(inArray(spacecraftDefinitionCosts.spacecraftDefinitionId, definitionIds))
      : [];

  const costsByDefinitionId = costs.reduce<
    Record<string, typeof spacecraftDefinitionCosts.$inferSelect[]>
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
    Record<string, typeof spacecraftBuildOrders.$inferSelect[]>
  >((acc, o) => {
    (acc[o.spacecraftDefinitionId] ??= []).push(o);
    return acc;
  }, {});

  return rows.map((row) => {
    const def = row.spacecraft_definitions;
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
      amount: row.station_spacecrafts.amount,
      lockedAmount: row.station_spacecrafts.lockedAmount,
      buildOrders: (buildOrdersByDefId[def.id] ?? []).map((o) => ({
        id: o.id,
        amount: o.amount,
        endsAt: o.endsAt.toISOString(),
      })),
    };
  });
};

// ============================================================================
// Build spacecrafts
// ============================================================================

export interface BuildOrder {
  spacecraftKey: string;
  amount: number;
}

export const buildSpacecrafts = async (
  stationId: string,
  userId: string,
  orders: BuildOrder[],
): Promise<void> => {
  const db = getDb();

  if (orders.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'No orders provided');
  }

  // Load spacecraft definitions for all requested keys
  const requestedKeys = orders.map((o) => o.spacecraftKey);
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

  const costsByDefId = costs.reduce<Record<string, typeof spacecraftDefinitionCosts.$inferSelect[]>>(
    (acc, c) => {
      (acc[c.spacecraftDefinitionId] ??= []).push(c);
      return acc;
    },
    {},
  );

  // Load shipyard level
  const [shipyardDef] = await db
    .select({ id: buildingDefinitions.id })
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, 'shipyard'))
    .limit(1);

  if (!shipyardDef) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Shipyard building definition not found');
  }

  const [shipyardBuilding] = await db
    .select({ level: stationBuildings.level })
    .from(stationBuildings)
    .where(
      and(
        eq(stationBuildings.stationId, stationId),
        eq(stationBuildings.buildingDefinitionId, shipyardDef.id),
      ),
    )
    .limit(1);

  const shipyardLevel = shipyardBuilding?.level ?? 0;

  // Compute unlocked spacecraft keys from shipyard level
  const unlockedKeys = new Set<string>();
  for (const [lvl, keys] of Object.entries(SHIPYARD_UNLOCKS)) {
    if (shipyardLevel >= Number(lvl)) {
      keys.forEach((k) => unlockedKeys.add(k));
    }
  }

  // Validate all orders can be built
  for (const order of orders) {
    if (!unlockedKeys.has(order.spacecraftKey)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Spacecraft '${order.spacecraftKey}' is not unlocked at current shipyard level`,
      );
    }
    if (order.amount <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be greater than 0');
    }
  }

  // Aggregate total resource costs across all orders
  const totalCosts = new Map<string, number>();
  for (const order of orders) {
    const def = defByKey.get(order.spacecraftKey)!;
    const defCosts = costsByDefId[def.id] ?? [];
    for (const cost of defCosts) {
      totalCosts.set(cost.resourceKey, (totalCosts.get(cost.resourceKey) ?? 0) + cost.amount * order.amount);
    }
  }

  // Load station resources and validate
  const resourceRows = await db
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));

  const resourceMap = new Map(resourceRows.map((r) => [r.resourceKey, r.amount]));

  for (const [resourceKey, needed] of totalCosts.entries()) {
    const current = resourceMap.get(resourceKey) ?? 0;
    if (current < needed) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Insufficient ${resourceKey}: need ${needed}, have ${current}`,
      );
    }
  }

  // Compute endsAt per order (sequential append for same type)
  // Load current max endsAt per definition for this station
  const endsAtByDefId = new Map<string, Date>();

  for (const def of defs) {
    const [row] = await db
      .select({ maxEndsAt: max(spacecraftBuildOrders.endsAt) })
      .from(spacecraftBuildOrders)
      .where(
        and(
          eq(spacecraftBuildOrders.stationId, stationId),
          eq(spacecraftBuildOrders.spacecraftDefinitionId, def.id),
        ),
      );
    if (row?.maxEndsAt) {
      endsAtByDefId.set(def.id, row.maxEndsAt);
    }
  }

  // Calculate endsAt for each order
  const orderEndsAt = orders.map((order) => {
    const def = defByKey.get(order.spacecraftKey)!;
    const baseline = Math.max(
      (endsAtByDefId.get(def.id) ?? new Date(0)).getTime(),
      Date.now(),
    );
    const endsAt = new Date(baseline + order.amount * def.buildTime * 1000);
    // Update running baseline for next order of same type (within same request)
    endsAtByDefId.set(def.id, endsAt);
    return { order, def, endsAt };
  });

  // Transaction: deduct resources, insert build orders, upsert stationSpacecrafts
  const insertedOrders: { orderId: string; def: typeof defs[0]; order: BuildOrder; endsAt: Date }[] = [];

  await db.transaction(async (tx) => {
    // Deduct resources
    for (const [resourceKey, amount] of totalCosts.entries()) {
      await tx
        .update(stationResources)
        .set({ amount: sql`${stationResources.amount} - ${amount}` })
        .where(
          and(
            eq(stationResources.stationId, stationId),
            eq(stationResources.resourceKey, resourceKey),
          ),
        );
    }

    // Insert build orders
    for (const { order, def, endsAt } of orderEndsAt) {
      const [inserted] = await tx
        .insert(spacecraftBuildOrders)
        .values({
          stationId,
          spacecraftDefinitionId: def.id,
          amount: order.amount,
          endsAt,
        })
        .returning({ id: spacecraftBuildOrders.id });

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

      insertedOrders.push({ orderId: inserted!.id, def, order, endsAt });
    }
  });

  // Schedule BullMQ jobs after transaction
  for (const { orderId, def, order, endsAt } of insertedOrders) {
    const delay = Math.max(0, endsAt.getTime() - Date.now());
    await spacecraftBuildQueue.add(
      'spacecraft-build',
      {
        userId,
        stationId,
        spacecraftDefinitionId: def.id,
        spacecraftKey: def.key,
        orderId,
        amount: order.amount,
      },
      { delay },
    );
  }
};
