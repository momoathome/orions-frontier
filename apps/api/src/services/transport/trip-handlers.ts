import { and, eq, sql } from 'drizzle-orm';
import type { getDb } from '../../lib/db/index.js';
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
} from '../../lib/playtest/events.js';

// Trip Handlers
//
// Each handler receives the drizzle transaction (tx) and the arrived trip row.
// Dispatched by settleTripArrival in trip-arrivals.service.ts.
//
// Handler → condition:
//   handleMineArrival          purpose='mine'          toType='asteroid'
//   handleMiningReturnArrival  purpose='mining_return' toType='station'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Trip = typeof spacecraftTrips.$inferSelect;
// Linked groups claim one load and create their timed mining return trip.
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
    .where(
      and(
        eq(asteroidAssignments.id, trip.assignmentId),
        eq(asteroidAssignments.status, 'traveling_to_asteroid')
      )
    )
    .limit(1);

  if (!assignment) return;
  const spacecraft = requireSpacecraft(assignment.spacecraftKey);

  const groupSize = Math.min(trip.groupSize, assignment.assignedAmount);
  const activeGroupSize = Math.max(0, groupSize - assignment.recallRequestedAmount);
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
    createdAt: departedAt,
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
    .limit(1);

  if (!assignment) return delivery;
  if (delivery) delivery.asteroidId = assignment.asteroidId;
  const spacecraft = requireSpacecraft(assignment.spacecraftKey);

  // Serialize the final returns for one asteroid. Without this lock, two groups
  // could both observe the other assignment and leave an exhausted asteroid behind.
  await tx
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.id, assignment.asteroidId))
    .for('update');

  const [reserve] = await tx
    .select({ amount: sql<number>`coalesce(sum(${asteroidVeins.remainingAmount}), 0)::int` })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, assignment.asteroidId));

  const recalledAmount = Math.min(assignment.recallRequestedAmount, trip.groupSize);
  const continuingAmount = trip.groupSize - recalledAmount;

  if (continuingAmount <= 0 || (reserve?.amount ?? 0) <= 0) {
    if (delivery && (reserve?.amount ?? 0) <= 0) delivery.asteroidExhausted = true;
    await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.id, assignment.id));
    await tx
      .update(stationSpacecrafts)
      .set({
        lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${trip.groupSize})`,
      })
      .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));

    if ((reserve?.amount ?? 0) <= 0) {
      const [remainingAssignment] = await tx
        .select({ id: asteroidAssignments.id })
        .from(asteroidAssignments)
        .where(eq(asteroidAssignments.asteroidId, assignment.asteroidId))
        .limit(1);

      if (!remainingAssignment) {
        await tx.delete(asteroids).where(eq(asteroids.id, assignment.asteroidId));
      }
    }

    return delivery;
  }

  if (recalledAmount > 0) {
    await tx
      .update(stationSpacecrafts)
      .set({
        lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${recalledAmount})`,
      })
      .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));

    await tx
      .update(asteroidAssignments)
      .set({
        assignedAmount: assignment.assignedAmount - recalledAmount,
        recallRequestedAmount: 0,
        recallRequestedAt: null,
      })
      .where(eq(asteroidAssignments.id, assignment.id));
  }

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
