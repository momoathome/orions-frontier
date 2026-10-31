import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids, asteroidVeins } from '../../src/lib/db/schema/asteroids.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
} from '../helpers/fixtures.js';
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
  await deleteTestData({ userIds: [userId], sectorIds: [sectorId] });
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
  assert.equal(resources.json().storageCapacity, 5_000);
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
    url: `/api/stations/${stationId}/buildings/warehouse/upgrade`,
    headers,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().definition.key, 'warehouse');
  assert.equal(response.json().isUpgrading, true);
});
