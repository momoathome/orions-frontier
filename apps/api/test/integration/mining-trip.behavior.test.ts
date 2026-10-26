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
import { stationResearch } from '../../src/lib/db/schema/station-research.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import {
  createAsteroidAssignment,
  requestAsteroidAssignmentRecall,
} from '../../src/services/mining/assignment.service.js';
import { getAsteroidById } from '../../src/services/asteroid.service.js';
import { settleTripArrival } from '../../src/services/transport/trip-arrivals.service.js';

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
    remainingAmount: 75,
  });
});

after(async () => {
  const db = getDb();
  await db
    .delete(spacecraftTrips)
    .where(
      inArray(spacecraftTrips.stationSpacecraftId, [stationSpacecraftId, secondStationSpacecraftId])
    );
  await db
    .delete(stationResources)
    .where(inArray(stationResources.stationId, [stationId, secondStationId]));
  await db
    .delete(stationBuildings)
    .where(inArray(stationBuildings.stationId, [stationId, secondStationId]));
  await db
    .delete(stationResearch)
    .where(inArray(stationResearch.stationId, [stationId, secondStationId]));
  if (assignmentId) {
    await db.delete(asteroidAssignments).where(eq(asteroidAssignments.id, assignmentId));
  }
  await db.delete(asteroids).where(eq(asteroids.id, asteroidId));
  await db
    .delete(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.id, [stationSpacecraftId, secondStationSpacecraftId]));
  await db.delete(stations).where(inArray(stations.id, [stationId, secondStationId]));
  await db.delete(users).where(inArray(users.id, [userId, secondUserId]));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
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
      remainingAmount: 75,
    });
  } else {
    await db
      .update(asteroidVeins)
      .set({ remainingAmount: 75 })
      .where(eq(asteroidVeins.asteroidId, asteroidId));
  }
  await db
    .update(stationSpacecrafts)
    .set({ amount: 1, lockedAmount: 0 })
    .where(inArray(stationSpacecrafts.id, [stationSpacecraftId, secondStationSpacecraftId]));
}

test('rejects zero, negative and fractional miner amounts', async () => {
  for (const assignedAmount of [0, -1, 1.5]) {
    const result = await createAsteroidAssignment({
      userId,
      asteroidId,
      stationId,
      spacecraftKey,
      assignedAmount,
    });
    assert.equal('code' in result ? result.code : undefined, 'INVALID_AMOUNT');
  }
});

test('rejects a mining assignment for a station owned by another user', async () => {
  const result = await createAsteroidAssignment({
    userId: randomUUID(),
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });

  assert.deepEqual(result, { code: 'STATION_NOT_FOUND', message: 'Station not found' });
});

test('hides mining groups from players without their own presence at the asteroid', async () => {
  await resetMiningState();
  const created = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 1,
  });
  assert.ok(!('code' in created));

  const ownerView = await getAsteroidById(asteroidId, userId);
  const foreignView = await getAsteroidById(asteroidId, secondUserId);
  assert.equal(ownerView?.operationsVisible, true);
  assert.equal(ownerView.assignments.length, 1);
  assert.equal(ownerView.assignments[0]?.activeTrip?.purpose, 'mine');
  assert.equal(foreignView?.operationsVisible, false);
  assert.equal(foreignView.assignments.length, 0);
  assert.deepEqual(foreignView.inTransit, {});

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
  assert.ok(!('code' in created));
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

  assert.equal(await settleTripArrival(firstOutbound), true);

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
  assert.deepEqual(firstReturn.cargoManifest, { carbon: 50 });
  assert.equal(firstReturn.departedAt.getTime() - firstArrival.getTime(), 5 * 60_000);
  const miningView = await getAsteroidById(asteroidId, userId);
  assert.equal(miningView?.assignments[0]?.activeTrip?.purpose, 'mining_return');
  assert.deepEqual(miningView.assignments[0].activeTrip.cargoManifest, { carbon: 50 });
  assert.equal(await settleTripArrival(firstReturn), true);

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
  assert.equal(await settleTripArrival(secondOutbound), true);

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
  assert.deepEqual(secondReturn.cargoManifest, { carbon: 25 });
  assert.equal(secondReturn.departedAt.getTime() - secondOutbound.arrivesAt.getTime(), 150_000);

  assert.equal(await settleTripArrival(secondReturn), true);

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

  assert.equal(resource?.amount, 75);
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
  assert.ok(!('code' in created));
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
  assert.equal(await settleTripArrival(outbound), true);
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
  assert.equal(await settleTripArrival(returnTrip), true);

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

  assert.equal(resource?.amount, 50);
  assert.equal(reserve?.amount, 25);
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
  assert.ok(!('code' in created));
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
  assert.equal(await settleTripArrival(outbound), true);

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
  assert.equal(await settleTripArrival(returnTrip), true);

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

  assert.equal(reserve?.amount, 75);
  assert.equal(resource, undefined);
  assert.equal(fleet?.lockedAmount, 0);
});

test('recalls one miner while the rest of its group continues mining', async () => {
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

  const created = await createAsteroidAssignment({
    userId,
    asteroidId,
    stationId,
    spacecraftKey,
    assignedAmount: 3,
  });
  assert.ok(!('code' in created));
  assignmentId = created.id;
  assert.equal(
    await requestAsteroidAssignmentRecall({ assignmentId, asteroidId, userId, amount: 1 }),
    true
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
  assert.equal(await settleTripArrival(outbound), true);

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
  assert.equal(returnTrip.groupSize, 3);
  assert.deepEqual(returnTrip.cargoManifest, { carbon: 100 });
  assert.equal(await settleTripArrival(returnTrip), true);

  const [assignment] = await db
    .select({
      assignedAmount: asteroidAssignments.assignedAmount,
      recallRequestedAmount: asteroidAssignments.recallRequestedAmount,
      recallRequestedAt: asteroidAssignments.recallRequestedAt,
    })
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.id, assignmentId));
  const [nextOutbound] = await db
    .select({ groupSize: spacecraftTrips.groupSize })
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignmentId),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  const [fleet] = await db
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.id, stationSpacecraftId));

  assert.deepEqual(assignment, {
    assignedAmount: 2,
    recallRequestedAmount: 0,
    recallRequestedAt: null,
  });
  assert.equal(nextOutbound?.groupSize, 2);
  assert.equal(fleet?.lockedAmount, 2);
});

test('modular cargo frames claims whole resource units for a Mole', async () => {
  const db = getDb();
  await resetMiningState();
  await db
    .update(asteroidVeins)
    .set({ remainingAmount: 1_000 })
    .where(eq(asteroidVeins.asteroidId, asteroidId));
  const completedAt = new Date();
  await db.insert(stationResearch).values({
    stationId,
    technologyKey: 'modular_cargo_frames',
    status: 'completed',
    completesAt: completedAt,
    completedAt,
  });

  try {
    const created = await createAsteroidAssignment({
      userId,
      asteroidId,
      stationId,
      spacecraftKey,
      assignedAmount: 1,
    });
    assert.ok(!('code' in created));

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
    assert.equal(await settleTripArrival(outbound), true);

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
    assert.deepEqual(returnTrip.cargoManifest, { carbon: 55 });
  } finally {
    await resetMiningState();
    await db.delete(stationResearch).where(eq(stationResearch.stationId, stationId));
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
  assert.ok(!('code' in first));
  assert.ok(!('code' in second));

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
  for (const outbound of outbounds) assert.equal(await settleTripArrival(outbound), true);

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
  assert.equal(await settleTripArrival(returns[0]!), true);
  assert.equal(
    (await db.select({ id: asteroids.id }).from(asteroids).where(eq(asteroids.id, asteroidId)))
      .length,
    1
  );

  assert.equal(await settleTripArrival(returns[1]!), true);
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

  assert.equal(results.filter((result) => !('code' in result)).length, 2);
});
