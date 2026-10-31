import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroids,
  asteroidAssignments,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { deleteTestData, grantResearch } from '../helpers/fixtures.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import {
  createAsteroidAssignment,
  requestAsteroidAssignmentRecall,
} from '../../src/services/mining/assignment.js';
import { createRealtimeExecutionContext } from '../../src/lib/game-execution-context.js';
import { getAsteroidById } from '../../src/services/world/asteroid.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.js';

const userId = randomUUID();
const stationId = randomUUID();
const spacecraftKey = 'mole';
const stationSpacecraftId = randomUUID();
const secondUserId = randomUUID();
const secondStationId = randomUUID();
const secondStationSpacecraftId = randomUUID();
const asteroidId = randomUUID();
const sectorId = randomUUID();
let assignmentId: string | undefined;

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  const suffix = randomUUID();

  await db.insert(sectors).values({
    id: sectorId,
    sectorX: 411,
    sectorY: 411,
    role: 'frontier',
    seed: suffix,
  });

  await db.insert(users).values([
    {
      id: userId,
      username: `mining-trip-${suffix}`,
      email: `mining-trip-${suffix}@example.test`,
      passwordHash: 'not-used',
    },
    {
      id: secondUserId,
      username: `mine2-${suffix}`,
      email: `mine2-${suffix}@example.test`,
      passwordHash: 'not-used',
    },
  ]);
  await db.insert(stations).values([
    { id: stationId, userId, sectorId, name: 'Mining Trip', x: 0, y: 0 },
    {
      id: secondStationId,
      userId: secondUserId,
      sectorId,
      name: 'Mining Trip Two',
      x: 0,
      y: 100,
    },
  ]);
  await db.insert(stationSpacecrafts).values([
    {
      id: stationSpacecraftId,
      stationId,
      spacecraftKey,
      amount: 1,
      lockedAmount: 0,
    },
    {
      id: secondStationSpacecraftId,
      stationId: secondStationId,
      spacecraftKey,
      amount: 1,
      lockedAmount: 0,
    },
  ]);
  await db.insert(stationBuildings).values([
    { stationId, buildingKey: 'scanner', level: 3 },
    { stationId: secondStationId, buildingKey: 'scanner', level: 3 },
  ]);
  await db.insert(asteroids).values({
    id: asteroidId,
    x: 1600,
    y: 0,
    chunkX: 1,
    chunkY: 0,
    size: 'small',
    sectorId,
  });
  await db.insert(asteroidVeins).values({
    asteroidId,
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 150,
  });
});

after(async () => {
  await deleteTestData({ userIds: [userId, secondUserId], sectorIds: [sectorId] });
  await closeDb();
});

async function resetMiningState() {
  const db = getDb();
  await db
    .delete(spacecraftTrips)
    .where(
      inArray(spacecraftTrips.stationSpacecraftId, [stationSpacecraftId, secondStationSpacecraftId])
    );
  await db.delete(asteroidAssignments).where(eq(asteroidAssignments.asteroidId, asteroidId));
  await db
    .delete(stationResources)
    .where(inArray(stationResources.stationId, [stationId, secondStationId]));
  const [asteroid] = await db
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId));
  if (!asteroid) {
    await db.insert(asteroids).values({
      id: asteroidId,
      x: 1600,
      y: 0,
      chunkX: 1,
      chunkY: 0,
      size: 'small',
      sectorId,
    });
    await db.insert(asteroidVeins).values({
      asteroidId,
      veinType: 'primary',
      resourceKey: 'carbon',
      remainingAmount: 150,
    });
  } else {
    await db
      .update(asteroidVeins)
      .set({ remainingAmount: 150 })
      .where(eq(asteroidVeins.asteroidId, asteroidId));
  }
  await db
    .update(stationSpacecrafts)
    .set({ amount: 1, lockedAmount: 0 })
    .where(inArray(stationSpacecrafts.id, [stationSpacecraftId, secondStationSpacecraftId]));
}

test('rejects zero, negative and fractional miner amounts', async () => {
  for (const assignedAmount of [0, -1, 1.5]) {
    await assert.rejects(
      createAsteroidAssignment({ userId, asteroidId, stationId, spacecraftKey, assignedAmount }),
      /assignedAmount must be a positive integer/
    );
  }
});

test('rejects a mining assignment for a station owned by another user', async () => {
  await assert.rejects(
    createAsteroidAssignment({
      userId: randomUUID(),
      asteroidId,
      stationId,
      spacecraftKey,
      assignedAmount: 1,
    }),
    /Station not found/
  );
});

test('hides mining groups from players without their own presence at the asteroid', async () => {
  await resetMiningState();
  await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });

  const ownerView = await getAsteroidById(asteroidId, userId);
  const foreignView = await getAsteroidById(asteroidId, secondUserId);
  assert.equal(ownerView?.operationsVisible, true);
  assert.equal(ownerView.assignments.length, 1);
  assert.equal(ownerView.assignments[0]?.activeTrip?.purpose, 'mine');
  assert.equal(foreignView?.operationsVisible, false);
  assert.equal(foreignView.assignments.length, 0);
  assert.deepEqual(foreignView.inTransit, {});

  // Mining there too shows the other group, but not which station it belongs to.
  await createAsteroidAssignment({
    userId: secondUserId,
    asteroidId,
    stationId: secondStationId,
    spacecraftKey,
    assignedAmount: 1,
  });
  const coMinerView = await getAsteroidById(asteroidId, secondUserId);
  assert.deepEqual(coMinerView?.assignments.map((assignment) => assignment.stationId).sort(), [
    secondStationId,
    null,
  ]);

  // Co-miners see each other's cargo only in resources they researched themselves.
  await getDb()
    .update(spacecraftTrips)
    .set({ cargoManifest: { carbon: 10, kyber_crystal: 5 } })
    .where(eq(spacecraftTrips.stationSpacecraftId, stationSpacecraftId));
  const cargoView = await getAsteroidById(asteroidId, secondUserId);
  const foreignTrip = cargoView?.assignments.find((assignment) => assignment.stationId === null);
  assert.deepEqual(foreignTrip?.activeTrip?.cargoManifest, { carbon: 10 });
  assert.equal(cargoView?.inTransit['kyber_crystal'], undefined);

  await resetMiningState();
});

test('miner repeats partial round trips until the asteroid is exhausted', async () => {
  const db = getDb();
  const created = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });
  assignmentId = created.id;

  const [firstOutbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(firstOutbound);
  const firstArrival = firstOutbound.arrivesAt;

  assert.equal((await settleTripArrival(firstOutbound)).settled, true);

  const [firstReturn] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(firstReturn);
  assert.deepEqual(firstReturn.cargoManifest, { carbon: 100 });
  assert.equal(firstReturn.departedAt.getTime() - firstArrival.getTime(), 10 * 60_000);
  const miningView = await getAsteroidById(asteroidId, userId);
  assert.equal(miningView?.assignments[0]?.activeTrip?.purpose, 'mining_return');
  assert.deepEqual(miningView.assignments[0].activeTrip.cargoManifest, { carbon: 100 });
  assert.equal((await settleTripArrival(firstReturn)).settled, true);

  const [secondOutbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(secondOutbound);
  assert.equal((await settleTripArrival(secondOutbound)).settled, true);

  const pendingReturns = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  const secondReturn = pendingReturns[0];
  assert.ok(secondReturn);
  assert.deepEqual(secondReturn.cargoManifest, { carbon: 50 });
  assert.equal(secondReturn.departedAt.getTime() - secondOutbound.arrivesAt.getTime(), 5 * 60_000);

  assert.equal((await settleTripArrival(secondReturn)).settled, true);

  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));
  const [assignment] = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.id, assignmentId));
  const [asteroid] = await db
    .select({ id: asteroids.id })
    .from(asteroids)
    .where(eq(asteroids.id, asteroidId));

  assert.equal(resource?.amount, 150);
  assert.equal(fleet?.lockedAmount, 0);
  assert.equal(assignment, undefined);
  assert.equal(asteroid, undefined);
});

test('recall finishes the claimed load and stops the group at its station', async () => {
  const db = getDb();
  await resetMiningState();

  const created = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });
  assignmentId = created.id;
  assert.equal(
    await requestAsteroidAssignmentRecall({
      assignmentId,
      asteroidId,
      userId: secondUserId,
    }),
    false
  );

  const [outbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(outbound);
  assert.equal((await settleTripArrival(outbound)).settled, true);
  assert.equal(await requestAsteroidAssignmentRecall({ assignmentId, asteroidId, userId }), true);

  const [returnTrip] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(returnTrip);
  assert.equal((await settleTripArrival(returnTrip)).settled, true);

  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  const [reserve] = await db
    .select({ amount: asteroidVeins.remainingAmount })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId));
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));
  const [assignment] = await db
    .select({ id: asteroidAssignments.id })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.id, assignmentId));
  const nextOutbound = await db
    .select({ id: spacecraftTrips.id })
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );

  assert.equal(resource?.amount, 100);
  assert.equal(reserve?.amount, 50);
  assert.equal(fleet?.lockedAmount, 0);
  assert.equal(assignment, undefined);
  assert.equal(nextOutbound.length, 0);
});

test('recall during outbound flight returns without claiming a new load', async () => {
  const db = getDb();
  await resetMiningState();

  const created = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });
  assignmentId = created.id;
  assert.equal(await requestAsteroidAssignmentRecall({ assignmentId, asteroidId, userId }), true);

  const [outbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(outbound);
  assert.equal((await settleTripArrival(outbound)).settled, true);

  const [returnTrip] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(returnTrip);
  assert.equal(returnTrip.cargoManifest, null);
  assert.equal(returnTrip.departedAt.getTime(), outbound.arrivesAt.getTime());
  assert.equal((await settleTripArrival(returnTrip)).settled, true);

  const [reserve] = await db
    .select({ amount: asteroidVeins.remainingAmount })
    .from(asteroidVeins)
    .where(eq(asteroidVeins.asteroidId, asteroidId));
  const [resource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));

  assert.equal(reserve?.amount, 150);
  assert.equal(resource, undefined);
  assert.equal(fleet?.lockedAmount, 0);
});

test('a miner group launches together and a recall stops a single miner', async () => {
  const db = getDb();
  await resetMiningState();
  await db
    .update(stationSpacecrafts)
    .set({ amount: 3 })
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));
  await db
    .update(asteroidVeins)
    .set({ remainingAmount: 1_000 })
    .where(eq(asteroidVeins.asteroidId, asteroidId));

  const now = new Date();
  const created = await createAsteroidAssignment(
    { userId, asteroidId, stationId, spacecraftKey, assignedAmount: 3 },
    createRealtimeExecutionContext(now)
  );
  assignmentId = created.id;
  const createdId = created.id;

  const tripsOf = (purpose: 'mine' | 'mining_return') =>
    db
      .select()
      .from(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.assignmentId, createdId),
          eq(spacecraftTrips.purpose, purpose),
          eq(spacecraftTrips.status, 'traveling')
        )
      )
      .orderBy(spacecraftTrips.arrivesAt);

  const outbound = await tripsOf('mine');
  assert.deepEqual(
    outbound.map((trip) => [trip.groupSize, (trip.departedAt.getTime() - now.getTime()) / 1000]),
    [[3, 0]]
  );

  // The recalled miner mines nothing; the other two bring a full load each.
  assert.equal(
    await requestAsteroidAssignmentRecall({ assignmentId, asteroidId, userId, amount: 1 }),
    true
  );
  for (const trip of outbound) assert.equal((await settleTripArrival(trip)).settled, true);
  const returns = await tripsOf('mining_return');
  assert.deepEqual(
    returns.map((trip) => [trip.groupSize, trip.cargoManifest]),
    [[3, { carbon: 200 }]]
  );
  for (const trip of returns) assert.equal((await settleTripArrival(trip)).settled, true);

  const [assignment] = await db
    .select({
      assignedAmount: asteroidAssignments.assignedAmount,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
      recallRequestedAt: asteroidAssignments.recallRequestedAt,
    })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.id, assignmentId));
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));

  assert.deepEqual(assignment, {
    assignedAmount: 2,
    recallRequestedAmount: 0,
    recallRequestedAt: null,
  });
  assert.deepEqual(
    (await tripsOf('mine')).map((trip) => trip.groupSize),
    [2]
  );
  assert.equal(fleet?.lockedAmount, 2);
});

test('cargo compression claims whole units and deep core drilling delivers more than it mines', async () => {
  const db = getDb();
  await resetMiningState();
  await db
    .update(asteroidVeins)
    .set({ remainingAmount: 1_000 })
    .where(eq(asteroidVeins.asteroidId, asteroidId));
  await grantResearch(userId, { cargo_compression: 2, deep_core_drilling: 1 });

  try {
    const created = await createAsteroidAssignment({
      userId,
      asteroidId,
      stationId,
      spacecraftKey,
      assignedAmount: 1,
    });

    const [outbound] = await db
      .select()
      .from(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.assignmentId, created.id),
          eq(spacecraftTrips.purpose, 'mine'),
          eq(spacecraftTrips.status, 'traveling')
        )
      );
    assert.ok(outbound);
    assert.equal((await settleTripArrival(outbound)).settled, true);

    const [returnTrip] = await db
      .select()
      .from(spacecraftTrips)
      .where(
        and(
          eq(spacecraftTrips.assignmentId, created.id),
          eq(spacecraftTrips.purpose, 'mining_return'),
          eq(spacecraftTrips.status, 'traveling')
        )
      );
    assert.ok(returnTrip);
    // 110 units leave the asteroid; Deep Core Drilling 1 delivers floor(110 × 1.06).
    assert.deepEqual(returnTrip.cargoManifest, { carbon: 116 });
    const [vein] = await db
      .select({ remainingAmount: asteroidVeins.remainingAmount })
      .from(asteroidVeins)
      .where(eq(asteroidVeins.asteroidId, asteroidId));
    assert.equal(vein?.remainingAmount, 890);
  } finally {
    await resetMiningState();
    await db.delete(userResearch).where(eq(userResearch.userId, userId));
  }
});

test('the exhausted asteroid remains until the last mining group returns', async () => {
  const db = getDb();
  await resetMiningState();
  await db
    .update(stationSpacecrafts)
    .set({ amount: 2 })
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));

  const first = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });
  const second = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });

  const outbounds = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.assignmentId, [first.id, second.id]),
        eq(spacecraftTrips.purpose, 'mine')
      )
    );
  assert.equal(outbounds.length, 2);
  for (const outbound of outbounds) assert.equal((await settleTripArrival(outbound)).settled, true);

  const returns = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        inArray(spacecraftTrips.assignmentId, [first.id, second.id]),
        eq(spacecraftTrips.purpose, 'mining_return')
      )
    );
  assert.equal(returns.length, 2);
  assert.equal((await settleTripArrival(returns[0]!)).settled, true);
  assert.equal(
    (await db.select({ id: asteroids.id }).from(asteroids).where(eq(asteroids.id, asteroidId)))
      .length,
    1
  );

  assert.equal((await settleTripArrival(returns[1]!)).settled, true);
  assert.equal(
    (await db.select({ id: asteroids.id }).from(asteroids).where(eq(asteroids.id, asteroidId)))
      .length,
    0
  );
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));
  assert.equal(fleet?.lockedAmount, 0);
});

test('parallel players may both travel to the same finite asteroid', async () => {
  await resetMiningState();

  const results = await Promise.all([
    createAsteroidAssignment({
      userId,
      asteroidId,
      stationId,
      spacecraftKey,
      assignedAmount: 1,
    }),
    createAsteroidAssignment({
      userId: secondUserId,
      asteroidId,
      stationId: secondStationId,
      spacecraftKey,
      assignedAmount: 1,
    }),
  ]);

  assert.equal(results.length, 2);
});
