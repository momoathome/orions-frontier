import type { Tx } from '../../lib/db/index.js';
import {
  deleteAsteroid,
  deleteAsteroidAssignment,
  findAsteroidForUpdate,
  findAssignmentRouteForUpdate,
  hasAsteroidAssignments,
  listAsteroidVeins,
  sumAsteroidRemainingAmount,
  updateAsteroidAssignment,
} from '../../repositories/asteroids.js';
import {
  insertTrip,
  sumHomeboundGroupSize,
  updateTripCargo,
  type TripRow,
} from '../../repositories/spacecraft-trips.js';
import { releaseSpacecraftClamped } from '../../repositories/station-spacecrafts.js';
import { findStation } from '../../repositories/stations.js';
import { assignIdleMiners, claimMiningCargo, largestResource } from '../mining/index.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { requireSpacecraft } from '@orions-frontier/game-config';
import { creditStationResources } from '../station/index.js';
import {
  applyTravelSpeed,
  effectiveCargoCapacity,
  effectiveMiningRate,
  getStationResearchModifiers,
} from '../research/index.js';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import {
  completionEventId,
  discardedResources,
  type MiningDeliveryCompletedEvent,
  type PlaytestCompletionEvent,
} from '../../lib/completion-events.js';

// Trip Handlers
//
// Each handler receives the drizzle transaction (tx) and the arrived trip row.
// Dispatched by settleTripArrival in trip-arrivals.ts.
//
// Handler → condition:
//   handleMineArrival          purpose='mine'          toType='asteroid'
//   handleMiningReturnArrival  purpose='mining_return' toType='station'

type Trip = TripRow;

// Deep Core Drilling delivers more than the asteroid loses.
const withYield = (manifest: Record<string, number>, factor: number) =>
  Object.fromEntries(
    Object.entries(manifest).map(([key, amount]) => [key, Math.floor(amount * factor)])
  );
// Each arriving miner claims one load and creates its timed mining return trip.
export async function handleMineArrival(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<void> {
  if (!trip.assignmentId) return;

  const assignment = await findAssignmentRouteForUpdate(tx, trip.assignmentId);

  if (!assignment) return;
  const spacecraft = requireSpacecraft(assignment.spacecraftKey);

  // Miners already heading home absorb recalls first; any recall left over turns this
  // miner back empty. The assignment row lock keeps parallel arrivals from double-counting.
  const homebound = await sumHomeboundGroupSize(tx, assignment.id);
  const groupSize = Math.min(trip.groupSize, assignment.assignedAmount);
  const unclaimedRecall = Math.max(0, assignment.recallRequestedAmount - homebound);
  const activeGroupSize = Math.max(0, groupSize - unclaimedRecall);
  const modifiers = await getStationResearchModifiers(tx, assignment.stationId);
  const effectiveCargo = await effectiveCargoCapacity(tx, assignment.stationId, spacecraft.cargo);
  const cargoCapacity = Math.floor(activeGroupSize * effectiveCargo);
  const claim =
    activeGroupSize === 0
      ? { claimedAmount: 0, cargoManifest: {} }
      : await claimMiningCargo(tx, trip.toId, cargoCapacity, modifiers.visibleResources);
  const effectiveRate = await effectiveMiningRate(tx, assignment.stationId, spacecraft.miningRate);
  const miningHours =
    claim.claimedAmount === 0 ? 0 : claim.claimedAmount / (activeGroupSize * effectiveRate);
  const departedAt = new Date(trip.arrivesAt.getTime() + miningHours * 3_600_000);
  const distance = calcDistance(
    { x: assignment.asteroidX, y: assignment.asteroidY },
    { x: assignment.stationX, y: assignment.stationY }
  );
  const baseArrivesAt = calcArrivesAt(departedAt, distance, spacecraft.speed);
  const arrivesAt = await applyTravelSpeed(tx, assignment.stationId, baseArrivesAt, departedAt);

  await insertTrip(tx, {
    id: context.nextId('trip'),
    stationSpacecraftId: trip.stationSpacecraftId,
    assignmentId: assignment.id,
    groupSize,
    fromType: 'asteroid',
    fromId: trip.toId,
    fromX: assignment.asteroidX,
    fromY: assignment.asteroidY,
    toType: 'station',
    toId: assignment.stationId,
    toX: assignment.stationX,
    toY: assignment.stationY,
    departedAt,
    arrivesAt,
    purpose: 'mining_return',
    cargoManifest: claim.claimedAmount > 0 ? withYield(claim.cargoManifest, modifiers.yield) : null,
    // Mining starts on arrival; the map orbits the asteroid from this moment.
    createdAt: trip.arrivesAt,
  });

  await updateAsteroidAssignment(tx, assignment.id, { status: 'traveling_to_station' });
}

// Starts the next outbound leg while free resources remain; otherwise the
// assignment ends and its ships become available at the station.
export async function handleMiningReturnArrival(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<PlaytestCompletionEvent[]> {
  let delivery: MiningDeliveryCompletedEvent | null = null;
  const events: PlaytestCompletionEvent[] = [];
  if (trip.cargoManifest) {
    const requested = { ...trip.cargoManifest };
    const credited = await creditStationResources(tx, trip.toId, requested);
    await updateTripCargo(tx, trip.id, credited);
    const station = await findStation(tx, trip.toId);
    if (station) {
      delivery = {
        type: 'mining_delivery_completed',
        eventId: completionEventId('mining_delivery_completed', trip.id),
        occurredAt: trip.arrivesAt,
        userId: station.userId,
        stationId: trip.toId,
        tripId: trip.id,
        asteroidId: null,
        requested,
        credited,
        discarded: discardedResources(requested, credited),
        targetVisibilityVerified: true,
        asteroidExhausted: false,
      };
      events.push(delivery);
    }
  }

  if (!trip.assignmentId) return events;

  // Serialize returns for one asteroid (trip.fromId). Without this lock, two miners
  // could both observe the other assignment and leave an exhausted asteroid behind.
  await findAsteroidForUpdate(tx, trip.fromId);

  const assignment = await findAssignmentRouteForUpdate(tx, trip.assignmentId);

  if (!assignment) return events;
  if (delivery) delivery.asteroidId = assignment.asteroidId;
  const spacecraft = requireSpacecraft(assignment.spacecraftKey);

  // Miners only see researched veins; the asteroid itself lasts until every vein is empty.
  const { visibleResources } = await getStationResearchModifiers(tx, assignment.stationId);
  const exhausted =
    (await sumAsteroidRemainingAmount(tx, assignment.asteroidId, visibleResources)) <= 0;

  // Recalls stop the arriving miners; an exhausted asteroid stops all of them.
  const recalledAmount = Math.min(assignment.recallRequestedAmount, trip.groupSize);
  const stoppingAmount = exhausted ? trip.groupSize : recalledAmount;
  const continuingAmount = trip.groupSize - stoppingAmount;

  if (stoppingAmount > 0) {
    await releaseSpacecraftClamped(tx, trip.stationSpacecraftId, stoppingAmount);

    const assignedAmount = assignment.assignedAmount - stoppingAmount;
    const recallRequestedAmount = assignment.recallRequestedAmount - recalledAmount;
    if (assignedAmount <= 0) {
      await deleteAsteroidAssignment(tx, assignment.id);
    } else {
      await updateAsteroidAssignment(tx, assignment.id, {
        assignedAmount,
        recallRequestedAmount,
        ...(recallRequestedAmount === 0 ? { recallRequestedAt: null } : {}),
      });
    }
  }

  if (exhausted) {
    if (delivery) delivery.asteroidExhausted = true;
    // Miners that came back empty still reroute to the asteroid's main resource.
    const resourceKey =
      largestResource(trip.cargoManifest ?? {}) ??
      largestResource(
        Object.fromEntries(
          (await listAsteroidVeins(tx, assignment.asteroidId, visibleResources)).map((vein) => [
            vein.resourceKey,
            vein.initialAmount,
          ])
        )
      );
    if (
      (await sumAsteroidRemainingAmount(tx, assignment.asteroidId)) <= 0 &&
      !(await hasAsteroidAssignments(tx, assignment.asteroidId))
    ) {
      await deleteAsteroid(tx, assignment.asteroidId);
    }
    // Recalled miners stay home; the rest may move on to the next asteroid.
    const rerouted = await assignIdleMiners(
      tx,
      {
        stationId: assignment.stationId,
        spacecraftKey: assignment.spacecraftKey,
        amount: trip.groupSize - recalledAmount,
        resourceKey,
        departedAt: trip.arrivesAt,
      },
      context
    );
    if (rerouted) events.push(rerouted);
  }

  if (continuingAmount <= 0) return events;

  const departedAt = trip.arrivesAt;
  const distance = calcDistance(
    { x: assignment.stationX, y: assignment.stationY },
    { x: assignment.asteroidX, y: assignment.asteroidY }
  );
  const baseArrivesAt = calcArrivesAt(departedAt, distance, spacecraft.speed);
  const arrivesAt = await applyTravelSpeed(tx, assignment.stationId, baseArrivesAt, departedAt);
  await insertTrip(tx, {
    id: context.nextId('trip'),
    stationSpacecraftId: trip.stationSpacecraftId,
    assignmentId: assignment.id,
    groupSize: continuingAmount,
    fromType: 'station',
    fromId: trip.toId,
    fromX: assignment.stationX,
    fromY: assignment.stationY,
    toType: 'asteroid',
    toId: assignment.asteroidId,
    toX: assignment.asteroidX,
    toY: assignment.asteroidY,
    departedAt,
    arrivesAt,
    purpose: 'mine',
    createdAt: departedAt,
  });

  await updateAsteroidAssignment(tx, assignment.id, { status: 'traveling_to_asteroid' });

  return events;
}
