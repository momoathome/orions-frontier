import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  AppError,
  ErrorCode,
  resourceKeys,
  type DebrisField,
  type ResourceMap,
  type SalvageMission,
} from '@orions-frontier/shared';
import { getDb } from '../lib/db/index.js';
import { debrisFields, salvageMissions } from '../lib/db/schema/debris-fields.js';
import {
  spacecraftDefinitionCosts,
  spacecraftDefinitions,
} from '../lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationResources } from '../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { calcArrivesAt, calcDistance } from '../lib/travel.js';
import { WORLD_CONFIG } from '../lib/world-config.js';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Trip = typeof spacecraftTrips.$inferSelect;

const toMission = (row: typeof salvageMissions.$inferSelect): SalvageMission => ({
  id: row.id,
  stationId: row.stationId,
  debrisFieldId: row.debrisFieldId,
  amount: row.amount,
  cargo: (row.cargo ?? {}) as ResourceMap,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
});

export async function createDebrisFromLosses(
  tx: Tx,
  stationId: string,
  losses: Map<string, number>
): Promise<void> {
  const definitionIds = [...losses.keys()].filter((id) => (losses.get(id) ?? 0) > 0);
  if (definitionIds.length === 0) return;

  const [station, costs] = await Promise.all([
    tx
      .select({ sectorId: stations.sectorId, x: stations.x, y: stations.y })
      .from(stations)
      .where(eq(stations.id, stationId))
      .then((rows) => rows[0]),
    tx
      .select()
      .from(spacecraftDefinitionCosts)
      .where(inArray(spacecraftDefinitionCosts.spacecraftDefinitionId, definitionIds)),
  ]);
  if (!station) throw new Error('Combat station no longer exists');

  const resources: ResourceMap = {};
  for (const cost of costs) {
    const recovered = Math.floor(
      cost.amount * (losses.get(cost.spacecraftDefinitionId) ?? 0) * 0.3
    );
    if (recovered > 0) {
      const key = cost.resourceKey as keyof ResourceMap;
      resources[key] = (resources[key] ?? 0) + recovered;
    }
  }
  if (Object.keys(resources).length === 0) return;

  const x = station.x + 90;
  const y = station.y + 70;
  await tx.insert(debrisFields).values({
    sectorId: station.sectorId,
    x,
    y,
    chunkX: Math.floor(x / WORLD_CONFIG.CHUNK_SIZE),
    chunkY: Math.floor(y / WORLD_CONFIG.CHUNK_SIZE),
    resources,
  });
}

export async function getVisibleDebris(params: {
  minChunkX: number;
  maxChunkX: number;
  minChunkY: number;
  maxChunkY: number;
}): Promise<DebrisField[]> {
  const rows = await getDb()
    .select()
    .from(debrisFields)
    .where(
      and(
        sql`${debrisFields.chunkX} between ${params.minChunkX} and ${params.maxChunkX}`,
        sql`${debrisFields.chunkY} between ${params.minChunkY} and ${params.maxChunkY}`
      )
    );
  return rows.map((row) => ({
    id: row.id,
    x: row.x,
    y: row.y,
    chunkX: row.chunkX,
    chunkY: row.chunkY,
    resources: row.resources as ResourceMap,
  }));
}

export async function getDebrisById(id: string): Promise<DebrisField | null> {
  const [row] = await getDb().select().from(debrisFields).where(eq(debrisFields.id, id)).limit(1);
  return row
    ? {
        id: row.id,
        x: row.x,
        y: row.y,
        chunkX: row.chunkX,
        chunkY: row.chunkY,
        resources: row.resources as ResourceMap,
      }
    : null;
}

export async function getUserSalvageMissions(userId: string): Promise<SalvageMission[]> {
  const rows = await getDb()
    .select()
    .from(salvageMissions)
    .where(eq(salvageMissions.userId, userId));
  return rows.map(toMission);
}

export async function startSalvage(params: {
  userId: string;
  stationId: string;
  debrisFieldId: string;
  spacecraftDefinitionId: string;
  amount: number;
}): Promise<SalvageMission> {
  if (!Number.isInteger(params.amount) || params.amount < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
  }
  const created = await getDb().transaction(async (tx) => {
    const [station] = await tx
      .select({ id: stations.id, x: stations.x, y: stations.y })
      .from(stations)
      .where(and(eq(stations.id, params.stationId), eq(stations.userId, params.userId)))
      .limit(1);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const [debris] = await tx
      .select()
      .from(debrisFields)
      .where(eq(debrisFields.id, params.debrisFieldId))
      .limit(1);
    if (!debris) throw new AppError(ErrorCode.NOT_FOUND, 'Debris field not found');

    const [fleet] = await tx
      .select({
        id: stationSpacecrafts.id,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
        role: spacecraftDefinitions.role,
        speed: spacecraftDefinitions.speed,
      })
      .from(stationSpacecrafts)
      .innerJoin(
        spacecraftDefinitions,
        eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
      )
      .where(
        and(
          eq(stationSpacecrafts.stationId, station.id),
          eq(stationSpacecrafts.spacecraftDefinitionId, params.spacecraftDefinitionId)
        )
      )
      .limit(1);
    if (!fleet || fleet.role !== 'salvager' || fleet.speed <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Selected spacecraft cannot salvage');
    }
    const [locked] = await tx
      .update(stationSpacecrafts)
      .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} + ${params.amount}` })
      .where(
        and(
          eq(stationSpacecrafts.id, fleet.id),
          sql`${stationSpacecrafts.amount} - ${stationSpacecrafts.lockedAmount} >= ${params.amount}`
        )
      )
      .returning({ id: stationSpacecrafts.id });
    if (!locked) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Not enough spacecraft available');

    const departedAt = new Date();
    const [trip] = await tx
      .insert(spacecraftTrips)
      .values({
        stationSpacecraftId: fleet.id,
        groupSize: params.amount,
        fromType: 'station',
        fromId: station.id,
        toType: 'debris',
        toId: debris.id,
        departedAt,
        arrivesAt: calcArrivesAt(departedAt, calcDistance(station, debris), fleet.speed),
        purpose: 'salvage',
      })
      .returning({ id: spacecraftTrips.id });
    const [mission] = await tx
      .insert(salvageMissions)
      .values({
        userId: params.userId,
        stationId: station.id,
        debrisFieldId: debris.id,
        stationSpacecraftId: fleet.id,
        outboundTripId: trip!.id,
        amount: params.amount,
      })
      .returning();
    return mission!;
  });
  return toMission(created);
}

async function resolveSalvageOutbound(tx: Tx, trip: Trip): Promise<void> {
  const [mission] = await tx
    .select()
    .from(salvageMissions)
    .where(
      and(eq(salvageMissions.outboundTripId, trip.id), eq(salvageMissions.status, 'traveling'))
    )
    .for('update');
  if (!mission) return;

  const [fleet] = await tx
    .select({ cargo: spacecraftDefinitions.cargo, speed: spacecraftDefinitions.speed })
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(stationSpacecrafts.id, mission.stationSpacecraftId));
  const [station] = await tx
    .select({ x: stations.x, y: stations.y })
    .from(stations)
    .where(eq(stations.id, mission.stationId));
  if (!fleet || !station) throw new Error('Salvage fleet or station no longer exists');

  const debris = mission.debrisFieldId
    ? (
        await tx
          .select()
          .from(debrisFields)
          .where(eq(debrisFields.id, mission.debrisFieldId))
          .for('update')
      )[0]
    : undefined;
  if (!debris) throw new Error('Salvage debris no longer exists');
  const cargo: ResourceMap = {};
  let capacity = fleet.cargo * mission.amount;
  const remaining = { ...(debris.resources as ResourceMap) };
  for (const key of resourceKeys) {
    const amount = Math.min(capacity, remaining[key] ?? 0);
    if (amount <= 0) continue;
    cargo[key] = amount;
    remaining[key] = (remaining[key] ?? 0) - amount;
    capacity -= amount;
    if (capacity === 0) break;
  }
  await tx.update(debrisFields).set({ resources: remaining }).where(eq(debrisFields.id, debris.id));

  const departedAt = trip.arrivesAt;
  const [returnTrip] = await tx
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId: mission.stationSpacecraftId,
      groupSize: mission.amount,
      fromType: 'debris',
      fromId: mission.debrisFieldId ?? trip.toId,
      toType: 'station',
      toId: mission.stationId,
      departedAt,
      arrivesAt: calcArrivesAt(departedAt, calcDistance(debris, station), fleet.speed),
      purpose: 'salvage_return',
      cargoManifest: cargo,
    })
    .returning({ id: spacecraftTrips.id });
  await tx
    .update(salvageMissions)
    .set({ returnTripId: returnTrip!.id, cargo, status: 'returning' })
    .where(eq(salvageMissions.id, mission.id));
}

async function resolveSalvageReturn(tx: Tx, trip: Trip): Promise<void> {
  const [mission] = await tx
    .select()
    .from(salvageMissions)
    .where(and(eq(salvageMissions.returnTripId, trip.id), eq(salvageMissions.status, 'returning')))
    .for('update');
  if (!mission) return;

  for (const [resourceKey, amount] of Object.entries(mission.cargo ?? {})) {
    if (amount <= 0) continue;
    await tx
      .insert(stationResources)
      .values({ stationId: mission.stationId, resourceKey, amount })
      .onConflictDoUpdate({
        target: [stationResources.stationId, stationResources.resourceKey],
        set: { amount: sql`${stationResources.amount} + ${amount}` },
      });
  }
  await tx
    .update(stationSpacecrafts)
    .set({ lockedAmount: sql`${stationSpacecrafts.lockedAmount} - ${mission.amount}` })
    .where(eq(stationSpacecrafts.id, mission.stationSpacecraftId));
  const debrisFieldId = mission.debrisFieldId;
  await tx
    .update(salvageMissions)
    .set({ debrisFieldId: null, status: 'resolved', resolvedAt: trip.arrivesAt })
    .where(eq(salvageMissions.id, mission.id));

  if (debrisFieldId) {
    const [active] = await tx
      .select({ id: salvageMissions.id })
      .from(salvageMissions)
      .where(
        and(
          eq(salvageMissions.debrisFieldId, debrisFieldId),
          ne(salvageMissions.status, 'resolved')
        )
      )
      .limit(1);
    const [debris] = await tx
      .select({ resources: debrisFields.resources })
      .from(debrisFields)
      .where(eq(debrisFields.id, debrisFieldId));
    if (!active && debris && Object.values(debris.resources).every((amount) => amount <= 0)) {
      await tx.delete(debrisFields).where(eq(debrisFields.id, debrisFieldId));
    }
  }
}

export async function handleSalvageTripArrival(tx: Tx, trip: Trip): Promise<void> {
  if (trip.purpose === 'salvage') await resolveSalvageOutbound(tx, trip);
  else if (trip.purpose === 'salvage_return') await resolveSalvageReturn(tx, trip);
}
