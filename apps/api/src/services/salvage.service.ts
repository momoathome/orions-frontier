import { and, between, eq, ne, or, sql } from 'drizzle-orm';
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
import { spacecraftTrips } from '../lib/db/schema/spacecraft-trips.js';
import { stationSpacecrafts } from '../lib/db/schema/station-spacecrafts.js';
import { stations } from '../lib/db/schema/stations.js';
import { calcArrivesAt, calcDistance } from '../lib/travel.js';
import { WORLD_CONFIG } from '../lib/world-config.js';
import { getSpacecraft } from '@orions-frontier/game-config';
import {
  getUserScannerCoverages,
  isPointVisible,
  visibleChunkBounds,
  type ScannerCoverage,
  type VisibilityProjectionStats,
} from './scanner-visibility.service.js';
import { creditStationResources } from './station-resource.service.js';
import { effectiveCargoCapacity, applyVectorNavigation } from './research-effects.js';

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
  const [station] = await tx
    .select({ sectorId: stations.sectorId, x: stations.x, y: stations.y })
    .from(stations)
    .where(eq(stations.id, stationId));
  if (!station) throw new Error('Combat station no longer exists');

  const resources: ResourceMap = {};
  for (const [spacecraftKey, amount] of losses) {
    for (const cost of getSpacecraft(spacecraftKey)?.costs ?? []) {
      const recovered = Math.floor(cost.amount * amount * 0.3);
      if (recovered > 0) {
        resources[cost.resourceKey] = (resources[cost.resourceKey] ?? 0) + recovered;
      }
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

export async function getVisibleDebris(
  params: {
    minChunkX: number;
    maxChunkX: number;
    minChunkY: number;
    maxChunkY: number;
  },
  coverages: readonly ScannerCoverage[],
  stats?: VisibilityProjectionStats,
  scannerBypass = false
): Promise<DebrisField[]> {
  const bounds = scannerBypass
    ? [params]
    : visibleChunkBounds(coverages, params, WORLD_CONFIG.CHUNK_SIZE);
  if (bounds.length === 0) return [];
  const rows = await getDb()
    .select()
    .from(debrisFields)
    .where(
      or(
        ...bounds.map((bound) =>
          and(
            between(debrisFields.chunkX, bound.minChunkX, bound.maxChunkX),
            between(debrisFields.chunkY, bound.minChunkY, bound.maxChunkY)
          )
        )
      )
    );
  if (stats) stats.debrisCandidates = rows.length;
  return rows.flatMap((row) =>
    scannerBypass || isPointVisible(coverages, row)
      ? [
          {
            id: row.id,
            x: row.x,
            y: row.y,
            chunkX: row.chunkX,
            chunkY: row.chunkY,
            resources: row.resources as ResourceMap,
          },
        ]
      : []
  );
}

export async function getDebrisById(id: string, userId: string): Promise<DebrisField | null> {
  const [[row], coverages] = await Promise.all([
    getDb().select().from(debrisFields).where(eq(debrisFields.id, id)).limit(1),
    getUserScannerCoverages(userId),
  ]);
  return row && isPointVisible(coverages, row)
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
  spacecraftKey: string;
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
    const coverages = await getUserScannerCoverages(params.userId, tx);
    if (!isPointVisible(coverages, debris)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Debris field not found');
    }

    const [fleet] = await tx
      .select({
        id: stationSpacecrafts.id,
        amount: stationSpacecrafts.amount,
        lockedAmount: stationSpacecrafts.lockedAmount,
        spacecraftKey: stationSpacecrafts.spacecraftKey,
      })
      .from(stationSpacecrafts)
      .where(
        and(
          eq(stationSpacecrafts.stationId, station.id),
          eq(stationSpacecrafts.spacecraftKey, params.spacecraftKey)
        )
      )
      .limit(1);
    const spacecraft = fleet ? getSpacecraft(fleet.spacecraftKey) : undefined;
    if (!fleet || !spacecraft || spacecraft.role !== 'salvager' || spacecraft.speed <= 0) {
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
        fromX: station.x,
        fromY: station.y,
        toType: 'debris',
        toId: debris.id,
        toX: debris.x,
        toY: debris.y,
        departedAt,
        arrivesAt: await applyVectorNavigation(
          tx,
          station.id,
          calcArrivesAt(departedAt, calcDistance(station, debris), spacecraft.speed),
          departedAt
        ),
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
    .select({ spacecraftKey: stationSpacecrafts.spacecraftKey })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, mission.stationSpacecraftId));
  const [station] = await tx
    .select({ x: stations.x, y: stations.y })
    .from(stations)
    .where(eq(stations.id, mission.stationId));
  if (!fleet || !station) throw new Error('Salvage fleet or station no longer exists');
  const spacecraft = getSpacecraft(fleet.spacecraftKey)!;

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
  const effectiveCargo = await effectiveCargoCapacity(
    tx,
    mission.stationId,
    spacecraft.cargo,
    'salvager'
  );
  const cargo: ResourceMap = {};
  let capacity = effectiveCargo * mission.amount;
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
      fromX: debris.x,
      fromY: debris.y,
      toType: 'station',
      toId: mission.stationId,
      toX: station.x,
      toY: station.y,
      departedAt,
      arrivesAt: await applyVectorNavigation(
        tx,
        mission.stationId,
        calcArrivesAt(departedAt, calcDistance(debris, station), spacecraft.speed),
        departedAt
      ),
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

  const credited = await creditStationResources(tx, mission.stationId, mission.cargo ?? {});
  await tx
    .update(spacecraftTrips)
    .set({ cargoManifest: credited })
    .where(eq(spacecraftTrips.id, trip.id));
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
