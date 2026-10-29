import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../lib/db/index.js';
import { asteroids, asteroidAssignments, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { claimMiningCargo } from '../mining/mining-claim.service.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { requireSpacecraft } from '@orions-frontier/game-config';
import { creditStationResources } from '../station-resource.service.js';
import {
  effectiveMiningRate,
  effectiveCargoCapacity,
  applyVectorNavigation,
} from '../research-effects.js';
import type { GameExecutionContext } from '../../lib/game-execution-context.js';
import {
  completionEventId,
  discardedResources,
  type MiningDeliveryCompletedEvent,
} from '../../lib/completion-events.js';

// Trip Handlers
//
// Each handler receives the drizzle transaction (tx) and the arrived trip row.
// Dispatched by settleTripArrival in trip-arrivals.service.ts.
//
// Handler → condition:
//   handleMineArrival          purpose='mine'          toType='asteroid'
//   handleMiningReturnArrival  purpose='mining_return' toType='station'

type Trip = typeof spacecraftTrips.$inferSelect;
// Each arriving miner claims one load and creates its timed mining return trip.
export async function handleMineArrival(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<void> {
  if (!trip.assignmentId) return;

  const [assignment] = await tx
    .select({
      id: asteroidAssignments.id,
      stationId: asteroidAssignments.stationId,
      assignedAmount: asteroidAssignments.assignedAmount,
      spacecraftKey: asteroidAssignments.spacecraftKey,
      stationX: stations.x,
      stationY: stations.y,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
    })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(asteroidAssignments.stationId, stations.id))
    .innerJoin(asteroids, eq(asteroidAssignments.asteroidId, asteroids.id))
    .where(eq(asteroidAssignments.id, trip.assignmentId))
    .for('update', { of: asteroidAssignments });

  if (!assignment) return;
  const spacecraft = requireSpacecraft(assignment.spacecraftKey);

  // Miners already heading home absorb recalls first; any recall left over turns this
  // miner back empty. The assignment row lock keeps parallel arrivals from double-counting.
  const [homebound] = await tx
    .select({ amount: sql<number>`coalesce(sum(${spacecraftTrips.groupSize}), 0)::int` })
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignment.id),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  const groupSize = Math.min(trip.groupSize, assignment.assignedAmount);
  const unclaimedRecall = Math.max(0, assignment.recallRequestedAmount - (homebound?.amount ?? 0));
  const activeGroupSize = Math.max(0, groupSize - unclaimedRecall);
  const effectiveCargo = await effectiveCargoCapacity(tx, assignment.stationId, spacecraft.cargo);
  const cargoCapacity = Math.floor(activeGroupSize * effectiveCargo);
  const claim =
    activeGroupSize === 0
      ? { claimedAmount: 0, cargoManifest: {} }
      : await claimMiningCargo(tx, trip.toId, cargoCapacity);
  const effectiveRate = await effectiveMiningRate(tx, assignment.stationId, spacecraft.miningRate);
  const miningHours =
    claim.claimedAmount === 0 ? 0 : claim.claimedAmount / (activeGroupSize * effectiveRate);
  const departedAt = new Date(trip.arrivesAt.getTime() + miningHours * 3_600_000);
  const distance = calcDistance(
    { x: assignment.asteroidX, y: assignment.asteroidY },
    { x: assignment.stationX, y: assignment.stationY }
  );
  const baseArrivesAt = calcArrivesAt(departedAt, distance, spacecraft.speed);
  const arrivesAt = await applyVectorNavigation(
    tx,
    assignment.stationId,
    baseArrivesAt,
    departedAt
  );

  await tx.insert(spacecraftTrips).values({
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
    cargoManifest: claim.claimedAmount > 0 ? claim.cargoManifest : null,
    // Mining starts on arrival; the map orbits the asteroid from this moment.
    createdAt: trip.arrivesAt,
  });

  await tx
    .update(asteroidAssignments)
    .set({ status: 'traveling_to_station' })
    .where(eq(asteroidAssignments.id, assignment.id));
}

// Starts the next outbound leg while free resources remain; otherwise the
// assignment ends and its ships become available at the station.
export async function handleMiningReturnArrival(
  tx: Tx,
  trip: Trip,
  context: GameExecutionContext
): Promise<MiningDeliveryCompletedEvent | null> {
  let delivery: MiningDeliveryCompletedEvent | null = null;
  if (trip.cargoManifest) {
    const requested = { ...trip.cargoManifest };
    const credited = await creditStationResources(tx, trip.toId, requested);
    await tx
      .update(spacecraftTrips)
      .set({ cargoManifest: credited })
      .where(eq(spacecraftTrips.id, trip.id));
    const [station] = await tx
      .select({ userId: stations.userId })
      .from(stations)
      .where(eq(stations.id, trip.toId));
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
    }
  }

  if (!trip.assignmentId) return delivery;

  // Serialize returns for one asteroid (trip.fromId). Without this lock, two miners
  // could both observe the other assignment and leave an exhausted asteroid behind.
  await tx
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.id, trip.fromId))
    .for('update');

  const [assignment] = await tx
    .select({
      id: asteroidAssignments.id,
      stationId: asteroidAssignments.stationId,
      asteroidId: asteroidAssignments.asteroidId,
      spacecraftKey: asteroidAssignments.spacecraftKey,
      stationX: stations.x,
      stationY: stations.y,
      asteroidX: asteroids.x,
      asteroidY: asteroids.y,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
      assignedAmount: asteroidAssignments.assignedAmount,
    })
    .from(asteroidAssignments)
    .innerJoin(stations, eq(asteroidAssignments.stationId, stations.id))
    .innerJoin(asteroids, eq(asteroidAssignments.asteroidId, asteroids.id))
    .where(eq(asteroidAssignments.id, trip.assignmentId))
    .for('update', { of: asteroidAssignments });

  if (!assignment) return delivery;
  if (delivery) delivery.asteroidId = assignment.asteroidId;
  const spacecraft = requireSpacecraft(assignment.spacecraftKey);

  const [reserve] = await tx
    .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, assignment.asteroidId));
  const exhausted = (reserve?.amount ?? 0) <= 0;

  // Recalls stop the arriving miners; an exhausted asteroid stops all of them.
  const recalledAmount = Math.min(assignment.recallRequestedAmount, trip.groupSize);
  const stoppingAmount = exhausted ? trip.groupSize : recalledAmount;
  const continuingAmount = trip.groupSize - stoppingAmount;

  if (stoppingAmount > 0) {
    await tx
      .update(stationSpacecrafts)
      .set({
        lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${stoppingAmount})`,
      })
      .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));

    const assignedAmount = assignment.assignedAmount - stoppingAmount;
    const recallRequestedAmount = assignment.recallRequestedAmount - recalledAmount;
    if (assignedAmount <= 0) {
      await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.id, assignment.id));
    } else {
      await tx
        .update(asteroidAssignments)
        .set({
          assignedAmount,
          recallRequestedAmount,
          ...(recallRequestedAmount === 0 ? { recallRequestedAt: null } : {}),
        })
        .where(eq(asteroidAssignments.id, assignment.id));
    }
  }

  if (exhausted) {
    if (delivery) delivery.asteroidExhausted = true;
    const [remainingAssignment] = await tx
      .select({ id: asteroidAssignments.id })
      .from(asteroidAssignments)
      .where(eq(asteroidAssignments.asteroidId, assignment.asteroidId))
      .limit(1);
    if (!remainingAssignment) {
      await tx.delete(asteroids).where(eq(asteroids.id, assignment.asteroidId));
    }
  }

  if (continuingAmount <= 0) return delivery;

  const departedAt = trip.arrivesAt;
  const distance = calcDistance(
    { x: assignment.stationX, y: assignment.stationY },
    { x: assignment.asteroidX, y: assignment.asteroidY }
  );
  const baseArrivesAt = calcArrivesAt(departedAt, distance, spacecraft.speed);
  const arrivesAt = await applyVectorNavigation(
    tx,
    assignment.stationId,
    baseArrivesAt,
    departedAt
  );
  await tx.insert(spacecraftTrips).values({
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

  await tx
    .update(asteroidAssignments)
    .set({ status: 'traveling_to_asteroid' })
    .where(eq(asteroidAssignments.id, assignment.id));

  return delivery;
}
