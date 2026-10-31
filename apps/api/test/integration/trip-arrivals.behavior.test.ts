import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import type { ResourceMap } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.js';
import { assertKnownSpacecraftKeys } from '../../src/services/station/index.js';
import { runWorldTick } from '../../src/services/simulation/simulation.js';
import {
  listDueTripsWithOwner,
  recordTripSettleFailure,
} from '../../src/services/fleet/repositories/spacecraft-trips.js';
import { deleteTestData } from '../helpers/fixtures.js';

let userId: string;
let stationId: string;
const spacecraftKey = 'mole';
let stationSpacecraftId: string;
const sectorId = randomUUID();

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  const suffix = randomUUID();

  await db.insert(sectors).values({
    id: sectorId,
    sectorX: 412,
    sectorY: 412,
    role: 'frontier',
    seed: suffix,
  });

  userId = (
    await db
      .insert(users)
      .values({
        username: `phase1-${suffix}`,
        email: `phase1-${suffix}@example.test`,
        passwordHash: 'not-used',
      })
      .returning({ id: users.id })
  )[0]!.id;
  stationId = (
    await db
      .insert(stations)
      .values({ userId, sectorId, name: 'Phase 1', x: 0, y: 0 })
      .returning({ id: stations.id })
  )[0]!.id;
  stationSpacecraftId = (
    await db
      .insert(stationSpacecrafts)
      .values({ stationId, spacecraftKey, amount: 2, lockedAmount: 2 })
      .returning({ id: stationSpacecrafts.id })
  )[0]!.id;
  await db.insert(stationBuildings).values({ stationId, buildingKey: 'warehouse', level: 1 });
});

after(async () => {
  await deleteTestData({ userIds: [userId], sectorIds: [sectorId] });
  await closeDb();
});

test('a trip that fails to settle waits longer before each retry', async () => {
  const db = getDb();
  const now = new Date();
  const [trip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId,
      groupSize: 1,
      fromType: 'station',
      fromId: stationId,
      toType: 'station',
      toId: stationId,
      departedAt: new Date(now.getTime() - 2_000),
      arrivesAt: new Date(now.getTime() - 1_000),
      purpose: 'relocate',
    })
    .returning();
  const isDue = async (at: Date) =>
    (await listDueTripsWithOwner(db, at)).some((due) => due.trip.id === trip!.id);
  try {
    assert.equal(await recordTripSettleFailure(db, trip!.id, now), 1);
    assert.equal(await isDue(now), false);
    assert.equal(await isDue(new Date(now.getTime() + 2_000)), true);

    assert.equal(await recordTripSettleFailure(db, trip!.id, now), 2);
    assert.equal(await isDue(new Date(now.getTime() + 2_000)), false);
    assert.equal(await isDue(new Date(now.getTime() + 4_000)), true);
  } finally {
    await db.delete(spacecraftTrips).where(eq(spacecraftTrips.id, trip!.id));
  }
});

test('a trip arrival is applied exactly once when two processors race', async () => {
  const db = getDb();
  const now = new Date();
  const [trip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId,
      groupSize: 1,
      fromType: 'asteroid',
      fromId: randomUUID(),
      toType: 'station',
      toId: stationId,
      departedAt: new Date(now.getTime() - 2_000),
      arrivesAt: new Date(now.getTime() - 1_000),
      purpose: 'mining_return',
      cargoManifest: { carbon: 10 },
    })
    .returning();
  assert.ok(trip);

  const results = await Promise.all([settleTripArrival(trip), settleTripArrival(trip)]);
  assert.deepEqual(results.map((result) => result.settled).sort(), [false, true]);

  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));
  assert.equal(resource?.amount, 10);
});

test('parallel mining returns store only free warehouse capacity', async () => {
  const db = getDb();
  await db
    .update(stationResources)
    .set({ amount: 4_990 })
    .where(eq(stationResources.stationId, stationId));
  const now = new Date();
  const trips = await db
    .insert(spacecraftTrips)
    .values(
      [1, 2].map((offset) => ({
        stationSpacecraftId,
        groupSize: 1,
        fromType: 'asteroid' as const,
        fromId: randomUUID(),
        toType: 'station' as const,
        toId: stationId,
        departedAt: new Date(now.getTime() - 2_000 - offset),
        arrivesAt: new Date(now.getTime() - 1_000 - offset),
        purpose: 'mining_return' as const,
        cargoManifest: { carbon: 10 },
      }))
    )
    .returning();

  await Promise.all(trips.map((trip) => settleTripArrival(trip)));

  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));
  const settled = await db
    .select({ cargoManifest: spacecraftTrips.cargoManifest })
    .from(spacecraftTrips)
    .where(
      inArray(
        spacecraftTrips.id,
        trips.map((trip) => trip.id)
      )
    );
  assert.equal(resource?.amount, 5_000);
  assert.equal(
    settled.reduce((sum, trip) => sum + (trip.cargoManifest?.carbon ?? 0), 0),
    10
  );
});

test('simulation tick catches up a trip that became due while the API was offline', async () => {
  const db = getDb();
  const now = new Date();
  const [trip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId,
      groupSize: 1,
      fromType: 'station',
      fromId: stationId,
      toType: 'station',
      toId: randomUUID(),
      departedAt: now,
      arrivesAt: new Date(now.getTime() + 60_000),
      purpose: 'combat',
    })
    .returning();
  assert.ok(trip);

  await runWorldTick(new Date(trip.arrivesAt.getTime() + 1));

  const [settled] = await db
    .select({ status: spacecraftTrips.status })
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, trip.id));
  assert.equal(settled?.status, 'arrived');
});

test('a failing due trip does not block later simulation work', async () => {
  const db = getDb();
  const now = new Date();

  const corruptManifest: ResourceMap = JSON.parse('{"poison":1}');
  const [poisonTrip, validTrip] = await db
    .insert(spacecraftTrips)
    .values([
      {
        stationSpacecraftId,
        groupSize: 1,
        fromType: 'asteroid',
        fromId: randomUUID(),
        toType: 'station',
        toId: randomUUID(),
        departedAt: new Date(now.getTime() - 3_000),
        arrivesAt: new Date(now.getTime() - 2_000),
        purpose: 'mining_return',
        cargoManifest: corruptManifest,
      },
      {
        stationSpacecraftId,
        groupSize: 1,
        fromType: 'station',
        fromId: stationId,
        toType: 'station',
        toId: randomUUID(),
        departedAt: new Date(now.getTime() - 2_000),
        arrivesAt: new Date(now.getTime() - 1_000),
        purpose: 'combat',
      },
    ])
    .returning();
  assert.ok(poisonTrip && validTrip);

  await runWorldTick(now);

  const statuses = await db
    .select({ id: spacecraftTrips.id, status: spacecraftTrips.status })
    .from(spacecraftTrips)
    .where(inArray(spacecraftTrips.id, [poisonTrip.id, validTrip.id]));
  assert.equal(statuses.find((trip) => trip.id === poisonTrip.id)?.status, 'traveling');
  assert.equal(statuses.find((trip) => trip.id === validTrip.id)?.status, 'arrived');
  await db
    .update(spacecraftTrips)
    .set({ status: 'cancelled' })
    .where(eq(spacecraftTrips.id, poisonTrip.id));
});

test('the API refuses to start while ships of a removed type exist', async () => {
  await assertKnownSpacecraftKeys();
  const [row] = await getDb()
    .insert(stationSpacecrafts)
    .values({ stationId, spacecraftKey: 'retired_hull', amount: 1 })
    .returning();
  try {
    await assert.rejects(assertKnownSpacecraftKeys(), /retired_hull/);
  } finally {
    await getDb().delete(stationSpacecrafts).where(eq(stationSpacecrafts.id, row!.id));
  }
});

test('simulation tick completes due building and spacecraft work exactly once', async () => {
  const db = getDb();
  const now = new Date();
  const [building] = await db
    .insert(stationBuildings)
    .values({
      stationId,
      buildingKey: 'core',
      level: 1,
      upgradeEndsAt: new Date(now.getTime() - 1_000),
      upgradePaidCost: [],
    })
    .returning({ id: stationBuildings.id });
  const [order] = await db
    .insert(spacecraftBuildOrders)
    .values({
      stationId,
      spacecraftKey,
      amount: 3,
      orderedAmount: 3,
      unitCost: [],
      nextAt: new Date(now.getTime() - 1_000),
      endsAt: new Date(now.getTime() - 1_000),
    })
    .returning({ id: spacecraftBuildOrders.id });
  assert.ok(building && order);

  await Promise.all([runWorldTick(now), runWorldTick(now)]);

  const [completedBuilding] = await db
    .select({ level: stationBuildings.level, upgradeEndsAt: stationBuildings.upgradeEndsAt })
    .from(stationBuildings)
    .where(eq(stationBuildings.id, building.id));
  const [fleet] = await db
    .select({ amount: stationSpacecrafts.amount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));
  const [remainingOrder] = await db
    .select({ id: spacecraftBuildOrders.id })
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.id, order.id));

  assert.deepEqual(completedBuilding, { level: 2, upgradeEndsAt: null });
  assert.equal(fleet?.amount, 5);
  assert.equal(remainingOrder, undefined);
});
