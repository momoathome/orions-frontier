import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroidAssignments,
  asteroids,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { debrisFields } from '../../src/lib/db/schema/debris-fields.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { getAsteroidById, getVisibleChunkAsteroids } from '../../src/services/world/asteroid.js';
import { researchModifiers } from '@orions-frontier/game-config';
import { startAttack } from '../../src/services/combat/combat.js';
import {
  createAsteroidAssignment,
  getStationMiningAssignments,
} from '../../src/services/mining/assignment.js';
import {
  getDebrisById,
  getVisibleDebris,
  startSalvage,
} from '../../src/services/combat/salvage.js';
import { getUserScannerCoverages } from '../../src/services/station/scanner-coverage.js';
import { starterStationVisualProfile } from '../../src/services/station/visual.js';
import {
  getVisibleChunkStations,
  getVisibleWorldMovements,
} from '../../src/services/world/world.js';
import { buildTestApp } from '../helpers/test-app.js';

const viewerId = randomUUID();
const targetId = randomUUID();
const sectorId = randomUUID();
const viewerStationId = randomUUID();
const remoteViewerStationId = randomUUID();
const visibleTargetStationId = randomUUID();
const hiddenTargetStationId = randomUUID();
const viewerFleetId = randomUUID();
const targetFleetId = randomUUID();
const visibleAsteroidId = randomUUID();
const hiddenAsteroidId = randomUUID();
const visibleDebrisId = randomUUID();
const hiddenDebrisId = randomUUID();
const tripId = randomUUID();
const now = new Date('2026-07-22T12:00:00Z');
const range = { minChunkX: -2, maxChunkX: 14, minChunkY: -2, maxChunkY: 2 };

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  await db.insert(users).values([
    {
      id: viewerId,
      username: `scanner-viewer-${viewerId.slice(0, 8)}`,
      email: `scanner-viewer-${viewerId}@example.test`,
      passwordHash: 'unused',
    },
    {
      id: targetId,
      username: `scanner-target-${targetId.slice(0, 8)}`,
      email: `scanner-target-${targetId}@example.test`,
      passwordHash: 'unused',
    },
  ]);
  await db.insert(sectors).values({
    id: sectorId,
    sectorX: 900,
    sectorY: 900,
    role: 'frontier',
    seed: sectorId,
  });
  await db.insert(stations).values([
    {
      id: viewerStationId,
      userId: viewerId,
      sectorId,
      name: 'Viewer',
      x: 0,
      y: 0,
      chunkX: 0,
      chunkY: 0,
    },
    {
      id: remoteViewerStationId,
      userId: viewerId,
      sectorId,
      name: 'Remote Viewer',
      x: 10_000,
      y: 0,
      chunkX: 10,
      chunkY: 0,
    },
    {
      id: visibleTargetStationId,
      userId: targetId,
      sectorId,
      name: 'Visible Target',
      x: 1_500,
      y: 0,
      chunkX: 1,
      chunkY: 0,
    },
    {
      id: hiddenTargetStationId,
      userId: targetId,
      sectorId,
      name: 'Hidden Target',
      x: 5_000,
      y: 0,
      chunkX: 5,
      chunkY: 0,
    },
  ]);
  await db.insert(stationBuildings).values([
    { stationId: viewerStationId, buildingKey: 'scanner', level: 3 },
    { stationId: remoteViewerStationId, buildingKey: 'scanner', level: 5 },
  ]);
  await db.insert(stationSpacecrafts).values([
    {
      id: viewerFleetId,
      stationId: viewerStationId,
      spacecraftKey: 'mole',
      amount: 1,
    },
    {
      id: targetFleetId,
      stationId: visibleTargetStationId,
      spacecraftKey: 'mole',
      amount: 1,
      lockedAmount: 1,
    },
  ]);
  await db.insert(asteroids).values([
    {
      id: visibleAsteroidId,
      sectorId,
      x: 1_900,
      y: 0,
      chunkX: 1,
      chunkY: 0,
      size: 'small',
    },
    {
      id: hiddenAsteroidId,
      sectorId,
      x: 2_100,
      y: 0,
      chunkX: 2,
      chunkY: 0,
      size: 'small',
    },
  ]);
  await db.insert(asteroidVeins).values([
    {
      asteroidId: visibleAsteroidId,
      veinType: 'primary',
      resourceKey: 'carbon',
      remainingAmount: 100,
    },
    {
      asteroidId: hiddenAsteroidId,
      veinType: 'primary',
      resourceKey: 'carbon',
      remainingAmount: 100,
    },
  ]);
  await db.insert(debrisFields).values([
    {
      id: visibleDebrisId,
      sectorId,
      x: 1_800,
      y: 0,
      chunkX: 1,
      chunkY: 0,
      resources: { carbon: 10 },
    },
    {
      id: hiddenDebrisId,
      sectorId,
      x: 2_200,
      y: 0,
      chunkX: 2,
      chunkY: 0,
      resources: { carbon: 10 },
    },
  ]);
  await db.insert(spacecraftTrips).values({
    id: tripId,
    stationSpacecraftId: targetFleetId,
    groupSize: 1,
    fromType: 'station',
    fromId: visibleTargetStationId,
    fromX: 2_500,
    fromY: 0,
    toType: 'station',
    toId: hiddenTargetStationId,
    toX: -2_500,
    toY: 0,
    departedAt: new Date(now.getTime() - 5_000),
    arrivesAt: new Date(now.getTime() + 5_000),
    purpose: 'combat',
  });
});

after(async () => {
  const db = getDb();
  await db
    .delete(spacecraftTrips)
    .where(inArray(spacecraftTrips.stationSpacecraftId, [viewerFleetId, targetFleetId]));
  // Trips before assignments, like the arrival worker locks them, so a dev worker settling a
  // test trip concurrently cannot deadlock this cleanup.
  await db.transaction(async (tx) => {
    const testAssignments = tx
      .select({ id: asteroidAssignments.id })
      .from(asteroidAssignments)
      .where(inArray(asteroidAssignments.asteroidId, [visibleAsteroidId, hiddenAsteroidId]));
    await tx.delete(spacecraftTrips).where(inArray(spacecraftTrips.assignmentId, testAssignments));
    await tx
      .delete(asteroidAssignments)
      .where(inArray(asteroidAssignments.asteroidId, [visibleAsteroidId, hiddenAsteroidId]));
  });
  await db.delete(debrisFields).where(eq(debrisFields.sectorId, sectorId));
  await db.delete(asteroids).where(eq(asteroids.sectorId, sectorId));
  await db
    .delete(stationBuildings)
    .where(inArray(stationBuildings.stationId, [viewerStationId, remoteViewerStationId]));
  await db
    .delete(stationSpacecrafts)
    .where(inArray(stationSpacecrafts.id, [viewerFleetId, targetFleetId]));
  // A dev worker settling a test trip may have credited cargo to a test station.
  await db
    .delete(stationResources)
    .where(
      inArray(
        stationResources.stationId,
        db.select({ id: stations.id }).from(stations).where(eq(stations.sectorId, sectorId))
      )
    );
  await db.delete(stations).where(eq(stations.sectorId, sectorId));
  await db.delete(users).where(inArray(users.id, [viewerId, targetId]));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await closeDb();
});

test('each station keeps its own scanner range', async () => {
  const coverages = await getUserScannerCoverages(viewerId);
  assert.deepEqual(
    coverages
      .map(({ stationId, range: scannerRange }) => ({ stationId, scannerRange }))
      .sort((left, right) => left.stationId.localeCompare(right.stationId)),
    [
      { stationId: viewerStationId, scannerRange: 2_000 },
      { stationId: remoteViewerStationId, scannerRange: 3_000 },
    ].sort((left, right) => left.stationId.localeCompare(right.stationId))
  );
});

test('the map lists everything while the scanner decides the detail level', async () => {
  const coverages = await getUserScannerCoverages(viewerId);
  const [listedAsteroids, listedStations, visibleDebris] = await Promise.all([
    getVisibleChunkAsteroids(range, coverages, researchModifiers({}).visibleResources),
    getVisibleChunkStations(range, viewerId, coverages),
    getVisibleDebris(range, coverages),
  ]);

  const scannedAsteroid = listedAsteroids.find(({ id }) => id === visibleAsteroidId);
  assert.equal(scannedAsteroid?.scanned, true);
  assert.equal(scannedAsteroid.size, 'small');
  assert.equal(scannedAsteroid.primaryResourceKey, 'carbon');
  assert.deepEqual(
    listedAsteroids.find(({ id }) => id === hiddenAsteroidId),
    {
      id: hiddenAsteroidId,
      x: 2_100,
      y: 0,
      chunkX: 2,
      chunkY: 0,
      scanned: false,
      size: null,
      primaryResourceKey: null,
      remainingFraction: null,
    }
  );

  const scannedStation = listedStations.find(({ id }) => id === visibleTargetStationId);
  const unscannedStation = listedStations.find(({ id }) => id === hiddenTargetStationId);
  assert.equal(scannedStation?.scanned, true);
  assert.equal(unscannedStation?.scanned, false);
  assert.equal(unscannedStation.name, 'Hidden Target');
  assert.equal(unscannedStation.ownerType, 'player');
  assert.deepEqual(unscannedStation.visualProfile, starterStationVisualProfile());

  assert.equal(
    visibleDebris.some(({ id }) => id === visibleDebrisId),
    true
  );
  assert.equal(
    visibleDebris.some(({ id }) => id === hiddenDebrisId),
    false
  );

  assert.equal((await getAsteroidById(visibleAsteroidId, viewerId))?.veins.length, 1);
  const hiddenDetail = await getAsteroidById(hiddenAsteroidId, viewerId);
  assert.equal(hiddenDetail?.scanned, false);
  assert.equal(hiddenDetail.size, null);
  assert.deepEqual(hiddenDetail.veins, []);
  assert.ok(await getDebrisById(visibleDebrisId, viewerId));
  assert.equal(await getDebrisById(hiddenDebrisId, viewerId), null);
});

test('blind mining reveals an unscanned asteroid once the first cargo heads home', async () => {
  const created = await createAsteroidAssignment({
    userId: viewerId,
    stationId: viewerStationId,
    asteroidId: hiddenAsteroidId,
    spacecraftKey: 'mole',
    assignedAmount: 1,
  });
  assert.ok('id' in created);
  assert.equal((await getAsteroidById(hiddenAsteroidId, viewerId))?.scanned, false);

  // The station's assignment list keeps the blind asteroid's size, resource and reserve hidden.
  const [scannedAssignment] = await getDb()
    .insert(asteroidAssignments)
    .values({ asteroidId: visibleAsteroidId, stationId: viewerStationId, spacecraftKey: 'mole' })
    .returning();
  const listed = await getStationMiningAssignments(viewerStationId, viewerId);
  const blind = listed.find(({ id }) => id === created.id);
  const known = listed.find(({ id }) => id === scannedAssignment?.id);
  assert.deepEqual(
    [blind?.asteroidSize, blind?.asteroidPrimaryResourceKey, blind?.asteroidRemainingAmount],
    [null, null, null]
  );
  assert.deepEqual(
    [known?.asteroidSize, known?.asteroidPrimaryResourceKey, known?.asteroidRemainingAmount],
    ['small', 'carbon', 100]
  );
  await getDb()
    .delete(asteroidAssignments)
    .where(eq(asteroidAssignments.id, scannedAssignment?.id ?? ''));

  // Outside the scanner a co-miner's cargo stays out of the viewer's in-transit total.
  const [foreignAssignment] = await getDb()
    .insert(asteroidAssignments)
    .values({
      asteroidId: hiddenAsteroidId,
      stationId: visibleTargetStationId,
      spacecraftKey: 'mole',
      status: 'traveling_to_station',
    })
    .returning();
  await getDb()
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId: targetFleetId,
      assignmentId: foreignAssignment?.id,
      groupSize: 1,
      fromType: 'asteroid',
      fromId: hiddenAsteroidId,
      fromX: 2_100,
      fromY: 0,
      toType: 'station',
      toId: visibleTargetStationId,
      toX: 1_500,
      toY: 0,
      departedAt: now,
      arrivesAt: new Date(now.getTime() + 3_600_000),
      purpose: 'mining_return',
      cargoManifest: { carbon: 10 },
    });
  const blindDetail = await getAsteroidById(hiddenAsteroidId, viewerId);
  assert.equal(blindDetail?.operationsVisible, true);
  assert.deepEqual(blindDetail.inTransit, {});
  assert.deepEqual(
    blindDetail.assignments.map(({ id }) => id),
    [created.id]
  );
  await getDb().transaction(async (tx) => {
    const foreignId = foreignAssignment?.id ?? '';
    await tx.delete(spacecraftTrips).where(eq(spacecraftTrips.assignmentId, foreignId));
    await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.id, foreignId));
  });

  await getDb()
    .insert(spacecraftTrips)
    .values({
      stationSpacecraftId: viewerFleetId,
      assignmentId: created.id,
      groupSize: 1,
      fromType: 'asteroid',
      fromId: hiddenAsteroidId,
      fromX: 2_100,
      fromY: 0,
      toType: 'station',
      toId: viewerStationId,
      toX: 0,
      toY: 0,
      departedAt: now,
      arrivesAt: new Date(now.getTime() + 60_000),
      purpose: 'mining_return',
    });

  const revealed = await getAsteroidById(hiddenAsteroidId, viewerId);
  assert.equal(revealed?.scanned, true);
  assert.equal(revealed.veins.length, 1);
  assert.equal((await getAsteroidById(hiddenAsteroidId, targetId))?.scanned, false);

  // Stop the blind mining again so a running dev worker cannot mine out the shared fixture.
  await getDb().transaction(async (tx) => {
    await tx.delete(spacecraftTrips).where(eq(spacecraftTrips.assignmentId, created.id));
    await tx.delete(asteroidAssignments).where(eq(asteroidAssignments.id, created.id));
  });
});

test('salvage and attacks still require scanner coverage', async () => {
  await assert.rejects(
    startSalvage({
      userId: viewerId,
      stationId: viewerStationId,
      debrisFieldId: hiddenDebrisId,
      spacecraftKey: 'collector',
      amount: 1,
    }),
    /Debris field not found/
  );
  await assert.rejects(
    startAttack({
      userId: viewerId,
      stationId: viewerStationId,
      targetStationId: hiddenTargetStationId,
      fleet: { javelin: 1 },
    }),
    /Target station not found/
  );
});

test('foreign movement is a route-free contact while the owner keeps its full trip', async () => {
  assert.equal(
    (await getVisibleWorldMovements(range, viewerId, new Date(now.getTime() - 5_000))).some(
      ({ id }) => id === tripId
    ),
    false
  );
  const [contact] = (await getVisibleWorldMovements(range, viewerId, now)).filter(
    ({ id }) => id === tripId
  );
  assert.equal(contact?.kind, 'radar_contact');
  assert.deepEqual(
    { x: contact.x, y: contact.y },
    {
      x: 0,
      y: 0,
    }
  );
  for (const privateField of [
    'fromX',
    'toX',
    'groupSize',
    'ownerType',
    'cargoManifest',
    'assignmentId',
  ]) {
    assert.equal(privateField in contact, false);
  }
  assert.equal(
    (await getVisibleWorldMovements(range, viewerId, new Date(now.getTime() + 5_000))).some(
      ({ id }) => id === tripId
    ),
    false
  );

  const [ownTrip] = (await getVisibleWorldMovements(range, targetId, now)).filter(
    ({ id }) => id === tripId
  );
  assert.equal(ownTrip?.kind, 'own_trip');
  assert.equal(ownTrip.fromX, 2_500);
  assert.equal(ownTrip.toX, -2_500);
});

test('foreign civil traffic outside the scanner is an anonymous blip', async () => {
  const miningTripId = randomUUID();
  // An hour ahead, so a running API worker cannot settle the trip during the test.
  const later = new Date(now.getTime() + 3_600_000);
  await getDb()
    .insert(spacecraftTrips)
    .values({
      id: miningTripId,
      stationSpacecraftId: targetFleetId,
      groupSize: 1,
      fromType: 'station',
      fromId: visibleTargetStationId,
      fromX: 2_500,
      fromY: 0,
      toType: 'station',
      toId: hiddenTargetStationId,
      toX: -2_500,
      toY: 0,
      departedAt: new Date(later.getTime() - 5_000),
      arrivesAt: new Date(later.getTime() + 5_000),
      purpose: 'mining_return',
      cargoManifest: { carbon: 10 },
    });

  const movements = (when: Date) =>
    getVisibleWorldMovements(range, viewerId, when).then((all) =>
      all.filter(({ id }) => id === miningTripId)
    );
  const [blip] = await movements(new Date(later.getTime() - 5_000));
  assert.equal(blip?.kind, 'radar_contact');
  assert.equal(blip.signature, null);
  for (const privateField of ['fromX', 'toX', 'groupSize', 'ownerType', 'cargoManifest']) {
    assert.equal(privateField in blip, false);
  }
  const [scanned] = await movements(later);
  assert.equal(scanned?.kind === 'radar_contact' && scanned.signature, 'miner');
  await getDb().delete(spacecraftTrips).where(eq(spacecraftTrips.id, miningTripId));
});

test('a trip crossing the view stays visible although both endpoints lie outside it', async () => {
  const crossingRange = { minChunkX: -1, maxChunkX: 0, minChunkY: -1, maxChunkY: 0 };
  const farRange = { minChunkX: 40, maxChunkX: 41, minChunkY: 40, maxChunkY: 41 };
  assert.equal(
    (await getVisibleWorldMovements(crossingRange, targetId, now)).some(({ id }) => id === tripId),
    true
  );
  assert.equal(
    (await getVisibleWorldMovements(farRange, targetId, now)).some(({ id }) => id === tripId),
    false
  );
});

test('dev scanner bypass projects the requested chunks without scanner coverage', async () => {
  const [visibleAsteroids, visibleStations, visibleDebris, hiddenMovement, hiddenAsteroid] =
    await Promise.all([
      getVisibleChunkAsteroids(range, [], [], undefined, true),
      getVisibleChunkStations(range, viewerId, [], undefined, true),
      getVisibleDebris(range, [], undefined, true),
      getVisibleWorldMovements(range, viewerId, new Date(now.getTime() - 5_000), true),
      getAsteroidById(hiddenAsteroidId, viewerId, true),
    ]);

  assert.equal(
    visibleAsteroids.some(({ id }) => id === hiddenAsteroidId),
    true
  );
  assert.equal(
    visibleStations.some(({ id }) => id === hiddenTargetStationId),
    true
  );
  assert.equal(
    visibleDebris.some(({ id }) => id === hiddenDebrisId),
    true
  );
  assert.equal(
    hiddenMovement.some(({ id }) => id === tripId),
    true
  );
  assert.equal(hiddenAsteroid?.id, hiddenAsteroidId);

  const app = await buildTestApp();
  try {
    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: `/api/asteroids/${hiddenAsteroidId}?scannerBypass=true`,
      headers: { authorization: `Bearer ${app.jwt.sign({ userId: viewerId, role: 'admin' })}` },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, hiddenAsteroidId);
  } finally {
    await app.close();
  }
});

test('world visibility tables expose the required candidate indexes', async () => {
  const rows = await getDb().execute<{ indexname: string }>(sql`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'asteroids_chunk_idx',
        'debris_fields_chunk_idx',
        'stations_chunk_idx',
        'spacecraft_trips_active_arrives_at_idx'
      )
  `);
  assert.deepEqual(rows.map(({ indexname }) => indexname).sort(), [
    'asteroids_chunk_idx',
    'debris_fields_chunk_idx',
    'spacecraft_trips_active_arrives_at_idx',
    'stations_chunk_idx',
  ]);
});
