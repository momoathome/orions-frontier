import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../lib/db/index.js';
import {
  asteroids,
  asteroidAssignments,
  asteroidResourceStorage,
} from '../../lib/db/schema/asteroids.js';
import { spacecraftDefinitions } from '../../lib/db/schema/spacecraft-definitions.js';
import { stationResources } from '../../lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../lib/db/schema/station-spacecrafts.js';
import { spacecraftTrips, type CargoManifest } from '../../lib/db/schema/spacecraft-trips.js';

// ============================================================================
// Trip Handlers
//
// Each handler receives the drizzle transaction (tx) and the arrived trip row.
// Dispatched by settleTripArrival in trip-arrivals.service.ts.
//
// Handler → condition:
//   handleMineArrival            purpose='mine'|'return'  toType='asteroid'
//   handleRecallArrival          purpose='recall'
//   handleTransportOutbound      purpose='transport'      toType='asteroid'
//   handleTransporterReturn      purpose='return'         toType='station'
// ============================================================================

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];
type Trip = typeof spacecraftTrips.$inferSelect;

// ── Miner arrived at asteroid ────────────────────────────────────────────────
// Covers both the initial mine trip and the post-recall return trip.
// Updates assignment status from traveling_to_asteroid → at_asteroid.
export async function handleMineArrival(tx: Tx, trip: Trip): Promise<void> {
  await tx
    .update(asteroidAssignments)
    .set({ status: 'at_asteroid', lastTick: trip.arrivesAt })
    .where(
      and(
        eq(asteroidAssignments.asteroidId, trip.toId),
        eq(asteroidAssignments.status, 'traveling_to_asteroid'),
        sql`${asteroidAssignments.stationId} = (
          SELECT station_id FROM station_spacecrafts WHERE id = ${trip.stationSpacecraftId}
        )`,
        sql`${asteroidAssignments.spacecraftDefinitionId} = (
          SELECT spacecraft_definition_id FROM station_spacecrafts WHERE id = ${trip.stationSpacecraftId}
        )`
      )
    );
}

// ── Miner arrived at station after self-recall ───────────────────────────────
// Credits cargoManifest to the station, then either:
//   - Releases the lock if the source asteroid was destroyed (no assignment to update).
//   - Updates the assignment to traveling_to_asteroid for the pre-created return trip.
export async function handleRecallArrival(tx: Tx, trip: Trip): Promise<void> {
  // Credit resources to station
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

  // Check if the source asteroid still exists.
  // If it was destroyed, the assignment was cascade-deleted and no return trip exists —
  // release the miner lock here so the ships become available immediately on landing.
  // If the asteroid is still alive this is a normal recall: update assignment so miners fly back.
  const [sourceAsteroid] = await tx
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.id, trip.fromId))
    .limit(1);

  if (!sourceAsteroid) {
    // Asteroid destroyed → release lock on arrival at station
    await tx
      .update(stationSpacecrafts)
      .set({
        lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${trip.groupSize})`,
      })
      .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));
  } else {
    // Normal recall: return trip was already created at dispatch time.
    // Just update assignment status so miners fly back.
    await tx
      .update(asteroidAssignments)
      .set({ status: 'traveling_to_asteroid' })
      .where(
        and(
          eq(asteroidAssignments.asteroidId, trip.fromId),
          sql`${asteroidAssignments.stationId} = ${trip.toId}`,
          sql`${asteroidAssignments.spacecraftDefinitionId} = (
            SELECT spacecraft_definition_id FROM station_spacecrafts WHERE id = ${trip.stationSpacecraftId}
          )`
        )
      );
  }
}

// ── Transporter arrived at asteroid (outbound leg) ───────────────────────────
// Loads resources from the asteroid buffer at arrival time (not dispatch time)
// and writes them into the pre-created return trip's cargoManifest.
export async function handleTransportOutbound(tx: Tx, trip: Trip): Promise<void> {
  const asteroidId = trip.toId;
  const stationId = trip.fromId;

  const lockedBuffer = await tx
    .select({
      resourceKey: asteroidResourceStorage.resourceKey,
      amount: asteroidResourceStorage.amount,
    })
    .from(asteroidResourceStorage)
    .where(eq(asteroidResourceStorage.asteroidId, asteroidId))
    .for('update');

  const currentTotal = lockedBuffer.reduce((s, r) => s + r.amount, 0);
  if (currentTotal <= 0) return;

  // Determine the cargo capacity of this transporter so we don't overload.
  const [defRow] = await tx
    .select({ cargo: spacecraftDefinitions.cargo })
    .from(stationSpacecrafts)
    .innerJoin(
      spacecraftDefinitions,
      eq(stationSpacecrafts.spacecraftDefinitionId, spacecraftDefinitions.id)
    )
    .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId))
    .limit(1);

  const maxLoad = defRow ? trip.groupSize * defRow.cargo : currentTotal;
  const totalToLoad = Math.min(currentTotal, maxLoad);
  const loadFraction = totalToLoad / currentTotal;

  const cargoManifest: CargoManifest = {};
  for (const resource of lockedBuffer) {
    const amount = Math.floor(resource.amount * loadFraction);
    if (amount > 0) cargoManifest[resource.resourceKey] = amount;
  }

  // Decrement asteroid buffer
  for (const resource of lockedBuffer) {
    const deduct = Math.floor(resource.amount * loadFraction);
    if (deduct <= 0) continue;
    const newAmount = resource.amount - deduct;
    if (newAmount <= 0) {
      await tx
        .delete(asteroidResourceStorage)
        .where(
          and(
            eq(asteroidResourceStorage.asteroidId, asteroidId),
            eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
          )
        );
    } else {
      await tx
        .update(asteroidResourceStorage)
        .set({ amount: newAmount })
        .where(
          and(
            eq(asteroidResourceStorage.asteroidId, asteroidId),
            eq(asteroidResourceStorage.resourceKey, resource.resourceKey)
          )
        );
    }
  }

  // Update the pre-created return trip with the real cargoManifest
  await tx
    .update(spacecraftTrips)
    .set({ cargoManifest })
    .where(
      and(
        eq(spacecraftTrips.stationSpacecraftId, trip.stationSpacecraftId),
        eq(spacecraftTrips.purpose, 'return'),
        eq(spacecraftTrips.fromType, 'asteroid'),
        eq(spacecraftTrips.fromId, asteroidId),
        eq(spacecraftTrips.toType, 'station'),
        eq(spacecraftTrips.toId, stationId),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
}

// ── Transporter return leg arrived at station ────────────────────────────────
// Credits cargoManifest to the station and releases the spacecraft lock.
export async function handleTransporterReturn(tx: Tx, trip: Trip): Promise<void> {
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

  // Release locked ships
  await tx
    .update(stationSpacecrafts)
    .set({
      lockedAmount: sql`GREATEST(0, ${stationSpacecrafts.lockedAmount} - ${trip.groupSize})`,
    })
    .where(eq(stationSpacecrafts.id, trip.stationSpacecraftId));
}
