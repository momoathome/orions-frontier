import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import { asteroids, asteroidAssignments, asteroidVeins } from '../../lib/db/schema/asteroids.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { stations } from '../../lib/db/schema/stations.js';
import { spacecraftTrips } from '../../lib/db/schema/spacecraft-trips.js';
import { claimMiningCargo } from '../mining/mining-claim.service.js';
import { calcArrivesAt, calcDistance } from '../../lib/travel.js';
import { getSpacecraft } from '@orions-frontier/game-config';

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
export async function handleMineArrival(tx: Tx, trip: Trip): Promise<void> {
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
  const spacecraft = getSpacecraft(assignment.spacecraftKey)!;

  const groupSize = Math.min(trip.groupSize, assignment.assignedAmount);
  const activeGroupSize = Math.max(0, groupSize - assignment.recallRequestedAmount);
  const claim =
    activeGroupSize === 0
      ? { claimedAmount: 0, cargoManifest: {} }
      : await claimMiningCargo(tx, trip.toId, activeGroupSize * spacecraft.cargo);
  const miningHours =
    claim.claimedAmount === 0 ? 0 : claim.claimedAmount / (activeGroupSize * spacecraft.miningRate);
  const departedAt = new Date(trip.arrivesAt.getTime() + miningHours * 3_600_000);
  const distance = calcDistance(
    { x: assignment.asteroidX, y: assignment.asteroidY },
    { x: assignment.stationX, y: assignment.stationY }
  );
  const arrivesAt = calcArrivesAt(departedAt, distance, spacecraft.speed);

  await tx.insert(spacecraftTrips).values({
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
  });

  await tx
    .update(asteroidAssignments)
    .set({ status: 'traveling_to_station' })
    .where(eq(asteroidAssignments.id, assignment.id));
}

// Starts the next outbound leg while free resources remain; otherwise the
// assignment ends and its ships become available at the station.
export async function handleMiningReturnArrival(tx: Tx, trip: Trip): Promise<void> {
  if (trip.cargoManifest) {
    for (const [resourceKey, amount] of Object.entries(trip.cargoManifest)) {
      if (amount <= 0) continue;
      await tx
        .insert(stationResources)
        .values({ stationId: trip.toId, resourceKey, amount })
        .onConflictDoUpdate({
          target: [stationResources.stationId, stationResources.resourceKey],
          set: { amount: sql`${stationResources.amount} + ${amount}` },
        });
    }
  }

  if (!trip.assignmentId) return;

  const [assignment] = await tx
    .select({
      id: asteroidAssignments.id,
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

  if (!assignment) return;
  const spacecraft = getSpacecraft(assignment.spacecraftKey)!;

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

    return;
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
  const arrivesAt = calcArrivesAt(departedAt, distance, spacecraft.speed);
  await tx.insert(spacecraftTrips).values({
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
  });

  await tx
    .update(asteroidAssignments)
    .set({ status: 'traveling_to_asteroid' })
    .where(eq(asteroidAssignments.id, assignment.id));
}
