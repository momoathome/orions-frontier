import {
  AppError,
  ErrorCode,
  resourceKeys,
  type DebrisField,
  type ResourceMap,
  type SalvageMission,
} from '@orions-frontier/shared';
import { getDb, type Tx } from '../../lib/db/index.js';
import {
  deleteDebrisField,
  findDebrisField,
  findDebrisFieldForUpdate,
  findReturningSalvageMissionForUpdate,
  findTravelingSalvageMissionForUpdate,
  hasUnresolvedSalvageOnDebris,
  insertDebrisField,
  insertSalvageMission,
  listDebrisFieldsInChunks,
  updateDebrisFieldResources,
  updateSalvageMission,
  type SalvageMissionRow,
} from '../../repositories/debris-fields.js';
import { insertTrip, updateTripCargo, type TripRow } from '../../repositories/spacecraft-trips.js';
import {
  findStationSpacecraft,
  findStationSpacecraftByKey,
  releaseSpacecraft,
  reserveSpacecraft,
} from '../../repositories/station-spacecrafts.js';
import { findOwnedStation, findStation } from '../../repositories/stations.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { getSpacecraft, requireSpacecraft } from '@orions-frontier/game-config';
import {
  getUserScannerCoverages,
  isPointVisible,
  type ScannerCoverage,
  type VisibilityProjectionStats,
  visibleChunkBounds,
} from '../map/index.js';
import { creditStationResources } from '../station/index.js';
import { applySpeed, applyTravelSpeed, getStationResearchModifiers } from '../research/index.js';
import {
  createRealtimeExecutionContext,
  type GameExecutionContext,
} from '../../lib/game-execution-context.js';
import {
  completionEventId,
  discardedResources,
  type PlaytestCompletionEvent,
} from '../../lib/completion-events.js';

type Trip = TripRow;

const toMission = (row: SalvageMissionRow): SalvageMission => ({
  id: row.id,
  stationId: row.stationId,
  debrisFieldId: row.debrisFieldId,
  amount: row.amount,
  cargo: row.cargo ?? {},
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  resolvedAt: row.resolvedAt?.toISOString() ?? null,
});

export async function createDebrisFromLosses(
  tx: Tx,
  stationId: string,
  losses: Map<string, number>,
  context: GameExecutionContext,
  /** Further remains, e.g. the storage and investment of a destroyed station. */
  extra: ResourceMap = {}
): Promise<{ id: string; resources: ResourceMap } | null> {
  const station = await findStation(tx, stationId);
  if (!station) throw new Error('Combat station no longer exists');

  const resources: ResourceMap = { ...extra };
  for (const [spacecraftKey, amount] of losses) {
    for (const cost of getSpacecraft(spacecraftKey)?.costs ?? []) {
      const recovered = Math.floor(cost.amount * amount * 0.3);
      if (recovered > 0) {
        resources[cost.resourceKey] = (resources[cost.resourceKey] ?? 0) + recovered;
      }
    }
  }
  if (Object.keys(resources).length === 0) return null;

  const x = station.x + 90;
  const y = station.y + 70;
  const id = context.nextId('debris');
  await insertDebrisField(tx, {
    id,
    sectorId: station.sectorId,
    x,
    y,
    chunkX: Math.floor(x / WORLD_CONFIG.CHUNK_SIZE),
    chunkY: Math.floor(y / WORLD_CONFIG.CHUNK_SIZE),
    resources,
    createdAt: context.now,
  });
  return { id, resources };
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
  const rows = await listDebrisFieldsInChunks(getDb(), bounds);
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
            resources: row.resources,
          },
        ]
      : []
  );
}

export async function getDebrisById(id: string, userId: string): Promise<DebrisField | null> {
  const [row, coverages] = await Promise.all([
    findDebrisField(getDb(), id),
    getUserScannerCoverages(userId),
  ]);
  return row && isPointVisible(coverages, row)
    ? {
        id: row.id,
        x: row.x,
        y: row.y,
        chunkX: row.chunkX,
        chunkY: row.chunkY,
        resources: row.resources,
      }
    : null;
}

export async function startSalvage(
  params: {
    userId: string;
    stationId: string;
    debrisFieldId: string;
    spacecraftKey: string;
    amount: number;
  },
  context: GameExecutionContext = createRealtimeExecutionContext()
): Promise<SalvageMission> {
  if (!Number.isInteger(params.amount) || params.amount < 1) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, 'Amount must be a positive integer');
  }
  const created = await getDb().transaction(async (tx) => {
    const station = await findOwnedStation(tx, params.stationId, params.userId);
    if (!station) throw new AppError(ErrorCode.NOT_FOUND, 'Station not found');

    const debris = await findDebrisField(tx, params.debrisFieldId);
    if (!debris) throw new AppError(ErrorCode.NOT_FOUND, 'Debris field not found');
    const coverages = await getUserScannerCoverages(params.userId, tx);
    if (!isPointVisible(coverages, debris)) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Debris field not found');
    }

    const fleet = await findStationSpacecraftByKey(tx, station.id, params.spacecraftKey);
    const spacecraft = fleet ? getSpacecraft(fleet.spacecraftKey) : undefined;
    if (!fleet || spacecraft?.role !== 'salvager' || spacecraft.speed <= 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Selected spacecraft cannot salvage');
    }
    if (!(await reserveSpacecraft(tx, fleet.id, params.amount)))
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Not enough spacecraft available');

    const departedAt = context.now;
    const tripId = await insertTrip(tx, {
      id: context.nextId('trip'),
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
      arrivesAt: await applyTravelSpeed(
        tx,
        station.id,
        calcArrivesAt(departedAt, calcDistance(station, debris), spacecraft.speed),
        departedAt
      ),
      purpose: 'salvage',
      createdAt: context.now,
    });
    return insertSalvageMission(tx, {
      id: context.nextId('salvage-mission'),
      userId: params.userId,
      stationId: station.id,
      debrisFieldId: debris.id,
      stationSpacecraftId: fleet.id,
      outboundTripId: tripId,
      amount: params.amount,
      createdAt: context.now,
    });
  });
  return toMission(created);
}

async function resolveSalvageOutbound(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<void> {
  const mission = await findTravelingSalvageMissionForUpdate(tx, trip.id);
  if (!mission) return;

  const fleet = await findStationSpacecraft(tx, mission.stationSpacecraftId);
  const station = await findStation(tx, mission.stationId);
  if (!fleet || !station) throw new Error('Salvage fleet or station no longer exists');
  const spacecraft = requireSpacecraft(fleet.spacecraftKey);

  const debris = mission.debrisFieldId
    ? await findDebrisFieldForUpdate(tx, mission.debrisFieldId)
    : undefined;
  if (!debris) throw new Error('Salvage debris no longer exists');
  const modifiers = await getStationResearchModifiers(tx, mission.stationId);
  const cargo: ResourceMap = {};
  let capacity = Math.floor(spacecraft.cargo * modifiers.cargo * mission.amount);
  const remaining = { ...debris.resources };
  for (const key of resourceKeys) {
    const amount = Math.min(capacity, remaining[key] ?? 0);
    if (amount <= 0) continue;
    cargo[key] = amount;
    remaining[key] = (remaining[key] ?? 0) - amount;
    capacity -= amount;
    if (capacity === 0) break;
  }
  await updateDebrisFieldResources(tx, debris.id, remaining);

  const departedAt = trip.arrivesAt;
  const returnTripId = await insertTrip(tx, {
    id: context.nextId('trip'),
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
    arrivesAt: applySpeed(
      calcArrivesAt(departedAt, calcDistance(debris, station), spacecraft.speed),
      departedAt,
      modifiers.speed
    ),
    purpose: 'salvage_return',
    cargoManifest: cargo,
    createdAt: departedAt,
  });
  await updateSalvageMission(tx, mission.id, { returnTripId, cargo, status: 'returning' });
}

async function resolveSalvageReturn(tx: Tx, trip: Trip): Promise<PlaytestCompletionEvent[]> {
  const mission = await findReturningSalvageMissionForUpdate(tx, trip.id);
  if (!mission) return [];

  const requested = { ...(mission.cargo ?? {}) };
  const credited = await creditStationResources(tx, mission.stationId, requested);
  await updateTripCargo(tx, trip.id, credited);
  await releaseSpacecraft(tx, mission.stationSpacecraftId, mission.amount);
  const debrisFieldId = mission.debrisFieldId;
  await updateSalvageMission(tx, mission.id, {
    debrisFieldId: null,
    status: 'resolved',
    resolvedAt: trip.arrivesAt,
  });

  if (debrisFieldId) {
    const active = await hasUnresolvedSalvageOnDebris(tx, debrisFieldId);
    const debris = await findDebrisField(tx, debrisFieldId);
    if (!active && debris && Object.values(debris.resources).every((amount) => amount <= 0)) {
      await deleteDebrisField(tx, debrisFieldId);
    }
  }
  return [
    {
      type: 'salvage_completed',
      eventId: completionEventId('salvage_completed', mission.id),
      occurredAt: trip.arrivesAt,
      userId: mission.userId,
      stationId: mission.stationId,
      missionId: mission.id,
      requested,
      credited,
      discarded: discardedResources(requested, credited),
      targetVisibilityVerified: true,
    },
  ];
}

export async function handleSalvageTripArrival(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<PlaytestCompletionEvent[]> {
  if (trip.purpose === 'salvage') {
    await resolveSalvageOutbound(tx, trip, context);
    return [];
  }
  if (trip.purpose === 'salvage_return') return resolveSalvageReturn(tx, trip);
  return [];
}
