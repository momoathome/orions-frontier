import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroidAssignments,
  asteroids,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';
import { authHeaders, buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
let userId = '';
let sectorId = '';
let stationId = '';
let asteroidId = '';
let headers: ReturnType<typeof authHeaders>;

before(async () => {
  await runMigrations();
  await initDb();
  const user = await createTestUser();
  const sector = await createTestSector();
  const station = await createTestStation({ userId: user.id, sectorId: sector.id });
  userId = user.id;
  sectorId = sector.id;
  stationId = station.id;
  headers = authHeaders(app, userId);

  const [asteroid] = await getDb()
    .insert(asteroids)
    .values({ x: 5, y: 0, chunkX: 0, chunkY: 0, size: 'small', sectorId })
    .returning();
  asteroidId = asteroid!.id;
  await getDb().insert(asteroidVeins).values({
    asteroidId,
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 10_000,
  });
});

after(async () => {
  const db = getDb();
  const fleets = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
  for (const fleet of fleets) {
    await db.delete(spacecraftTrips).where(eq(spacecraftTrips.stationSpacecraftId, fleet.id));
  }
  await db.delete(asteroidAssignments).where(eq(asteroidAssignments.stationId, stationId));
  await db.delete(asteroids).where(eq(asteroids.id, asteroidId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(eq(users.id, userId));
  await app.close();
  await closeDb();
});

test('economy endpoints require authentication and station ownership', async () => {
  const unauthenticated = await app.inject({
    method: 'GET',
    url: `/api/me/resources?stationId=${stationId}`,
  });
  assert.equal(unauthenticated.statusCode, 401);

  const resources = await app.inject({
    method: 'GET',
    url: `/api/me/resources?stationId=${stationId}`,
    headers,
  });
  assert.equal(resources.statusCode, 200);
  assert.equal(resources.json().resources.carbon, 250);
});

test('the assignment endpoint validates input and starts a mining trip', async () => {
  const invalid = await app.inject({
    method: 'POST',
    url: `/api/asteroids/${asteroidId}/assignments`,
    headers,
    payload: { stationId, spacecraftKey: 'mole', assignedAmount: 0 },
  });
  assert.equal(invalid.statusCode, 400);

  const response = await app.inject({
    method: 'POST',
    url: `/api/asteroids/${asteroidId}/assignments`,
    headers,
    payload: { stationId, spacecraftKey: 'mole', assignedAmount: 1 },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(typeof response.json().assignmentId, 'string');

  const [fleet] = await getDb()
    .select({ lockedAmount: stationSpacecrafts.lockedAmount })
    .from(stationSpacecrafts)
    .where(
      and(eq(stationSpacecrafts.stationId, stationId), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );
  assert.equal(fleet?.lockedAmount, 1);
});

test('the building endpoint validates the key and starts an upgrade', async () => {
  const invalid = await app.inject({
    method: 'POST',
    url: `/api/stations/${stationId}/buildings/unknown/upgrade`,
    headers,
  });
  assert.equal(invalid.statusCode, 400);

  const response = await app.inject({
    method: 'POST',
    url: `/api/stations/${stationId}/buildings/core/upgrade`,
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().definition.key, 'core');
  assert.equal(response.json().isUpgrading, true);
});
