import { getSpacecraft } from '@orions-frontier/game-config';
import { entriesOf, type ResourceKey, type ResourceMap } from '@orions-frontier/shared';
import type { Tx } from '../../lib/db/index.js';
import { completionEventId, type MinersAssignedEvent } from '../../lib/completion-events.js';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import { calculateMiningCycle } from '../../lib/mining-cycle.js';
import { calcDistance } from '../../lib/travel.js';
import { WORLD_CONFIG } from '../../lib/world-config.js';
import { findAsteroidForUpdate, listAsteroidVeinsInChunks } from '../../repositories/asteroids.js';
import {
  findStationSpacecraftByKey,
  reserveSpacecraft,
} from '../../repositories/station-spacecrafts.js';
import { findActiveStation } from '../../repositories/stations.js';
import { getUserScannerCoverages, isPointVisible, scannerChunkBounds } from '../map/index.js';
import { getStationResearchModifiers } from '../research/index.js';
import { launchReservedMiners } from './assignment.js';

export interface MiningTarget {
  id: string;
  x: number;
  y: number;
  remainingByResource: ResourceMap;
  remainingAmount: number;
}

/**
 * With a resource: the nearest asteroid that still has it. Without one: the best expected delivery
 * per hour. Ties go to the nearer asteroid, then the lower id, so the choice is deterministic.
 */
export function selectMiningTarget(
  station: { x: number; y: number },
  targets: readonly MiningTarget[],
  resourceKey: ResourceKey | null,
  deliveryPerHour: (distance: number, remainingAmount: number) => number
): MiningTarget | null {
  let best: { target: MiningTarget; score: number; distance: number } | null = null;
  for (const target of targets) {
    const remaining = resourceKey
      ? (target.remainingByResource[resourceKey] ?? 0)
      : target.remainingAmount;
    if (remaining <= 0) continue;
    const distance = calcDistance(station, target);
    const score = resourceKey ? -distance : deliveryPerHour(distance, remaining);
    if (
      !best ||
      score > best.score ||
      (score === best.score &&
        (distance < best.distance || (distance === best.distance && target.id < best.target.id)))
    ) {
      best = { target, score, distance };
    }
  }
  return best?.target ?? null;
}

export const largestResource = (map: ResourceMap): ResourceKey | null => {
  let largest: [ResourceKey, number] | null = null;
  for (const [key, amount] of entriesOf(map)) {
    if (amount > 0 && (!largest || amount > largest[1])) largest = [key, amount];
  }
  return largest?.[0] ?? null;
};

/**
 * Sends idle miners to a new asteroid when research allows it: Autonomous Rerouting keeps the
 * resource they mined, the Autonomous Mining Fleet picks the best target otherwise.
 */
export async function assignIdleMiners(
  tx: Tx,
  params: {
    stationId: string;
    spacecraftKey: string;
    amount: number;
    /** The resource the miners mined before; null for newly built miners. */
    resourceKey: ResourceKey | null;
    departedAt: Date;
  },
  context: GameExecutionContext
): Promise<MinersAssignedEvent | null> {
  const spacecraft = getSpacecraft(params.spacecraftKey);
  // Salvagers can mine too, but they are built for debris and stay home for salvage orders.
  if (
    spacecraft?.role !== 'miner' ||
    spacecraft.miningRate <= 0 ||
    spacecraft.cargo <= 0 ||
    params.amount <= 0
  ) {
    return null;
  }
  const modifiers = await getStationResearchModifiers(tx, params.stationId);
  const reroute = params.resourceKey !== null && modifiers.autoReroute;
  if (!reroute && !modifiers.autonomousFleet) return null;

  const station = await findActiveStation(tx, params.stationId);
  if (!station) return null;
  const coverages = await getUserScannerCoverages(station.userId, tx);
  const bounds = scannerChunkBounds(coverages, WORLD_CONFIG.CHUNK_SIZE);
  if (bounds.length === 0) return null;

  const targets = new Map<string, MiningTarget>();
  for (const row of await listAsteroidVeinsInChunks(tx, bounds, modifiers.visibleResources)) {
    if (!isPointVisible(coverages, row)) continue;
    const target = targets.get(row.id) ?? {
      id: row.id,
      x: row.x,
      y: row.y,
      remainingByResource: {},
      remainingAmount: 0,
    };
    target.remainingByResource[row.resourceKey] =
      (target.remainingByResource[row.resourceKey] ?? 0) + row.remainingAmount;
    target.remainingAmount += row.remainingAmount;
    targets.set(row.id, target);
  }

  const deliveryPerHour = (distance: number, remainingAmount: number) =>
    calculateMiningCycle({
      distance,
      speed: spacecraft.speed * modifiers.speed,
      miningRate: spacecraft.miningRate * modifiers.miningRate,
      cargoCapacity: spacecraft.cargo * modifiers.cargo,
      minerCount: params.amount,
      remainingAmount,
    }).totalDeliveryPerHour;
  const candidates = [...targets.values()];
  const sameResource = reroute
    ? selectMiningTarget(station, candidates, params.resourceKey, deliveryPerHour)
    : null;
  const target =
    sameResource ??
    (modifiers.autonomousFleet
      ? selectMiningTarget(station, candidates, null, deliveryPerHour)
      : null);
  if (!target || !(await findAsteroidForUpdate(tx, target.id))) return null;

  const stationSpacecraft = await findStationSpacecraftByKey(
    tx,
    params.stationId,
    params.spacecraftKey
  );
  if (!stationSpacecraft) return null;
  if (!(await reserveSpacecraft(tx, stationSpacecraft.id, params.amount))) return null;

  const assignmentId = await launchReservedMiners(
    tx,
    {
      station,
      stationSpacecraftId: stationSpacecraft.id,
      spacecraftKey: params.spacecraftKey,
      asteroid: target,
      amount: params.amount,
      departedAt: params.departedAt,
    },
    context
  );
  return {
    type: 'miners_assigned',
    eventId: completionEventId('miners_assigned', assignmentId),
    occurredAt: params.departedAt,
    userId: station.userId,
    stationId: station.id,
    assignmentId,
    asteroidId: target.id,
    spacecraftKey: params.spacecraftKey,
    amount: params.amount,
    resourceKey:
      (sameResource ? params.resourceKey : largestResource(target.remainingByResource)) ?? 'carbon',
    rerouted: sameResource !== null,
  };
}
