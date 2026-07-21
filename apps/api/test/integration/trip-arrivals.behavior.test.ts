import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
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
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.service.js';
import { runSimulationTick } from '../../src/services/simulation.service.js';

let userId: string;
let stationId: string;
const spacecraftKey = 'mole';
let stationSpacecraftId: string;
const sectorId = randomUUID();
const tripIds: string[] = [];

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

  [{ id: userId }] = await db
    .insert(users)
    .values({
      username: `phase1-${suffix}`,
      email: `phase1-${suffix}@example.test`,
      passwordHash: 'not-used',
    })
    .returning({ id: users.id });
  [{ id: stationId }] = await db
    .insert(stations)
    .values({ userId, sectorId, name: 'Phase 1', x: 0, y: 0 })
    .returning({ id: stations.id });
  [{ id: stationSpacecraftId }] = await db
    .insert(stationSpacecrafts)
    .values({ stationId, spacecraftKey, amount: 2, lockedAmount: 2 })
    .returning({ id: stationSpacecrafts.id });
});

after(async () => {
  const db = getDb();
  if (tripIds.length) {
    await db.delete(spacecraftTrips).where(inArray(spacecraftTrips.id, tripIds));
  }
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.id, stationSpacecraftId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await closeDb();
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
      cargoManifest: { phase_one: 10 },
    })
    .returning();
  assert.ok(trip);
  tripIds.push(trip.id);

  const results = await Promise.all([settleTripArrival(trip), settleTripArrival(trip)]);
  assert.deepEqual(results.sort(), [false, true]);

  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));
  assert.equal(resource?.amount, 10);
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
  tripIds.push(trip.id);

  await runSimulationTick(new Date(trip.arrivesAt.getTime() + 1));

  const [settled] = await db
    .select({ status: spacecraftTrips.status })
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.id, trip.id));
  assert.equal(settled?.status, 'arrived');
});

test('a failing due trip does not block later simulation work', async () => {
  const db = getDb();
  const now = new Date();
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
        cargoManifest: { poison: 1 },
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
  tripIds.push(poisonTrip.id, validTrip.id);

  await runSimulationTick(now);

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
    })
    .returning({ id: stationBuildings.id });
  const [order] = await db
    .insert(spacecraftBuildOrders)
    .values({
      stationId,
      spacecraftKey,
      amount: 3,
      endsAt: new Date(now.getTime() - 1_000),
    })
    .returning({ id: spacecraftBuildOrders.id });
  assert.ok(building && order);

  await Promise.all([runSimulationTick(now), runSimulationTick(now)]);

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
