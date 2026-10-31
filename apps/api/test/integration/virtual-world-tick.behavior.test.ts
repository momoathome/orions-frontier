import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { calculateBuildingBuildTime } from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroidAssignments,
  asteroids,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { queuedJobs } from '../../src/lib/db/schema/queued-jobs.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { createSeededExecutionContext } from '../../src/lib/game-execution-context.js';
import type { MiningDeliveryCompletedEvent } from '../../src/lib/completion-events.js';
import { createAsteroidAssignment } from '../../src/services/mining/assignment.js';
import { runWorldTick } from '../../src/services/simulation/simulation.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  grantResearch,
  setTestResources,
} from '../helpers/fixtures.js';

let userId = '';
let lateUserId = '';
let stationId = '';
let sectorId = '';
let asteroidId = '';

before(async () => {
  await runMigrations();
  await initDb();
  const suffix = Number.parseInt(randomUUID().slice(0, 6), 16) % 100_000;
  const sector = await createTestSector({
    sectorX: 200_000 + suffix,
    sectorY: -(200_000 + suffix),
  });
  const user = await createTestUser();
  const station = await createTestStation({
    userId: user.id,
    sectorId: sector.id,
    x: 800_000 + suffix,
    y: -(800_000 + suffix),
  });
  userId = user.id;
  stationId = station.id;
  sectorId = sector.id;

  asteroidId = randomUUID();
  await getDb()
    .insert(asteroids)
    .values({
      id: asteroidId,
      sectorId,
      x: station.x + 100,
      y: station.y,
      chunkX: Math.floor((station.x + 100) / 1_000),
      chunkY: Math.floor(station.y / 1_000),
      size: 'small',
    });
  await getDb().insert(asteroidVeins).values({
    id: randomUUID(),
    asteroidId,
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 1,
  });
});

after(async () => {
  await deleteTestData({ userIds: [userId, lateUserId], sectorIds: [sectorId] });
  await closeDb();
});

test('one world tick drains every due travel leg before deciding each bot once', async () => {
  const context = createSeededExecutionContext({
    now: new Date('2050-01-01T00:00:00.000Z'),
    seed: `world-tick-drain:${stationId}`,
  });
  const assignment = await createAsteroidAssignment(
    {
      userId,
      stationId,
      asteroidId,
      spacecraftKey: 'mole',
      assignedAmount: 1,
    },
    context
  );
  const [outbound] = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.assignmentId, assignment.id));

  const jumpContext = context.at(new Date(outbound!.arrivesAt.getTime() + 24 * 3_600_000));
  await getDb().insert(botControllers).values({
    userId,
    strategy: 'unknown_for_tick_test',
    strategyVersion: '1',
    profile: 'industrialist',
    nextDecisionAt: jumpContext.now,
  });

  const result = await runWorldTick(jumpContext);
  assert.deepEqual(
    result.phases.map((phase) => phase.phase),
    ['transports', 'buildings', 'spacecraft', 'research', 'world_missions']
  );
  assert.ok(result.passes >= 2);
  assert.ok((result.phases.find((phase) => phase.phase === 'transports')?.completed ?? 0) >= 2);
  // The shared dev database may hold other due trips; only this station's delivery is asserted.
  const delivery = result.events.find(
    (event): event is MiningDeliveryCompletedEvent =>
      event.type === 'mining_delivery_completed' && event.stationId === stationId
  );
  assert.ok(delivery);
  assert.deepEqual(delivery.requested, { carbon: 1 });
  assert.deepEqual(delivery.credited, { carbon: 1 });
  assert.deepEqual(delivery.discarded, {});
  const ownDecisions = result.botDecisions.filter((outcome) => outcome.botUserId === userId);
  assert.equal(ownDecisions.length, 1);
  assert.equal(ownDecisions[0]?.resultKind, 'idle');

  const trips = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.stationSpacecraftId, outbound!.stationSpacecraftId));
  assert.equal(trips.length, 2);
  assert.ok(trips.every((trip) => trip.status === 'arrived'));
  const returnTrip = trips.find((trip) => trip.purpose === 'mining_return');
  assert.equal(
    returnTrip?.departedAt.toISOString(),
    new Date(outbound!.arrivesAt.getTime() + 6_000).toISOString()
  );
  assert.equal(
    (
      await getDb()
        .select()
        .from(asteroidAssignments)
        .where(eq(asteroidAssignments.id, assignment.id))
    ).length,
    0
  );

  const repeated = await runWorldTick(jumpContext);
  assert.equal(repeated.passes, 0);
  assert.deepEqual(repeated.events, []);
  assert.equal(repeated.botDecisions.filter((outcome) => outcome.botUserId === userId).length, 0);
});

test('one late world tick replays due work in time order', async () => {
  const user = await createTestUser();
  lateUserId = user.id;
  const station = await createTestStation({ userId: user.id, sectorId, x: 1_000, y: 1_000 });
  await grantResearch(user.id, { parallel_construction: 1 });
  await setTestResources(station.id, 5_000); // full at warehouse level 1
  const db = getDb();
  const t1 = new Date('2050-06-01T00:00:00.000Z');
  const second = (s: number) => new Date(t1.getTime() + s * 1_000);
  const scannerSeconds = calculateBuildingBuildTime('scanner', 2);
  const t3 = second(scannerSeconds + 30); // the second slot frees after the short job ends
  const setUpgrade = (buildingKey: string, upgradeEndsAt: Date) =>
    db
      .update(stationBuildings)
      .set({ upgradeEndsAt, upgradePaidCost: [] })
      .where(
        and(
          eq(stationBuildings.stationId, station.id),
          eq(stationBuildings.buildingKey, buildingKey)
        )
      );
  await setUpgrade('warehouse', t1);
  await setUpgrade('laboratory', t3);
  for (const key of ['scanner', 'hangar']) {
    await db.insert(queuedJobs).values({
      userId: user.id,
      stationId: station.id,
      kind: 'building',
      key,
      targetLevel: 2,
      paidCost: [],
      createdAt: second(-60),
    });
  }
  const [fleet] = await db
    .select()
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, station.id))
    .limit(1);
  const [returnTrip] = await db
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId: fleet!.id,
      groupSize: 1,
      fromType: 'asteroid',
      fromId: asteroidId,
      toType: 'station',
      toId: station.id,
      departedAt: second(-50),
      arrivesAt: second(10),
      purpose: 'mining_return',
      cargoManifest: { carbon: 1_000 },
    })
    .returning();

  const result = await runWorldTick(
    createSeededExecutionContext({ now: second(scannerSeconds + 60), seed: `late:${station.id}` })
  );

  // The warehouse finished before the cargo arrived, so it fits.
  const delivery = result.events.find(
    (event): event is MiningDeliveryCompletedEvent =>
      event.type === 'mining_delivery_completed' && event.tripId === returnTrip!.id
  );
  assert.ok(delivery);
  assert.deepEqual(delivery.credited, { carbon: 1_000 });
  assert.deepEqual(delivery.discarded, {});
  // The hangar takes the slot the scanner freed, not the one the laboratory freed later.
  const [hangar] = await db
    .select()
    .from(stationBuildings)
    .where(
      and(eq(stationBuildings.stationId, station.id), eq(stationBuildings.buildingKey, 'hangar'))
    );
  assert.equal(
    hangar?.upgradeEndsAt?.toISOString(),
    second(scannerSeconds + calculateBuildingBuildTime('hangar', 2)).toISOString()
  );
});
