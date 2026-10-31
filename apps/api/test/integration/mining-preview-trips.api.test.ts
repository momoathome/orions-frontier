import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids, asteroidVeins } from '../../src/lib/db/schema/asteroids.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  grantResearch,
} from '../helpers/fixtures.js';
import { authHeaders, buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
let userId = '';
let otherUserId = '';
let sectorId = '';
let stationId = '';
const nearAsteroidId = randomUUID();
const farAsteroidId = randomUUID();
const hiddenOreAsteroidId = randomUUID();

const addAsteroid = async (id: string, x: number) => {
  await getDb()
    .insert(asteroids)
    .values({ id, x, y: 0, chunkX: Math.floor(x / 1_000), chunkY: 0, size: 'small', sectorId });
  await getDb()
    .insert(asteroidVeins)
    .values({ asteroidId: id, veinType: 'primary', resourceKey: 'carbon', remainingAmount: 150 });
};

before(async () => {
  await runMigrations();
  await initDb();
  userId = (await createTestUser()).id;
  otherUserId = (await createTestUser()).id;
  sectorId = (await createTestSector()).id;
  stationId = (await createTestStation({ userId, sectorId })).id;
  await addAsteroid(nearAsteroidId, 10);
  await addAsteroid(farAsteroidId, 900_000);
  await getDb().insert(asteroids).values({
    id: hiddenOreAsteroidId,
    x: 20,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    size: 'small',
    sectorId,
  });
  await getDb()
    .insert(asteroidVeins)
    .values([
      {
        asteroidId: hiddenOreAsteroidId,
        veinType: 'primary',
        resourceKey: 'titanium',
        remainingAmount: 0,
      },
      {
        asteroidId: hiddenOreAsteroidId,
        veinType: 'secondary',
        resourceKey: 'kyber_crystal',
        remainingAmount: 80,
      },
    ]);
});

after(async () => {
  await deleteTestData({ userIds: [userId, otherUserId], sectorIds: [sectorId] });
  await app.close();
  await closeDb();
});

const preview = (asteroidId: string, query: string, asUser = userId) =>
  app.inject({
    method: 'GET',
    url: `/api/asteroids/${asteroidId}/mining-preview?stationId=${stationId}&${query}`,
    headers: authHeaders(app, asUser),
  });

test('mining preview shows the reserve only for scanned asteroids', async () => {
  const near = await preview(nearAsteroidId, 'spacecraftKey=mole');
  assert.equal(near.statusCode, 200);
  assert.equal(near.json<{ remainingAmount: number | null }>().remainingAmount, 150);

  const far = await preview(farAsteroidId, 'spacecraftKey=mole');
  assert.equal(far.statusCode, 200);
  const blind = far.json<Record<string, unknown>>();
  assert.equal(blind['remainingAmount'], null);
  assert.equal(blind['estimatedDepletionHours'], null);
  assert.equal(blind['finalBatchAmount'], null);
  assert.equal(typeof blind['distance'], 'number');
});

test('mining preview rejects foreign stations, unknown ships and too many miners', async () => {
  const foreign = await preview(nearAsteroidId, 'spacecraftKey=mole', otherUserId);
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(foreign.json(), { message: 'Station, miner or asteroid not found' });

  const unknown = await preview(nearAsteroidId, 'spacecraftKey=nope');
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(unknown.json(), { message: 'Spacecraft not found' });

  const tooMany = await preview(nearAsteroidId, 'spacecraftKey=mole&minerCount=99');
  assert.equal(tooMany.statusCode, 400);
  assert.match(tooMany.json<{ message: string }>().message, /^Only \d+ miners available$/);
});

test('preview of an asteroid with only hidden ore left is 404', async () => {
  const detail = await app.inject({
    method: 'GET',
    url: `/api/asteroids/${hiddenOreAsteroidId}`,
    headers: authHeaders(app, userId),
  });
  assert.equal(detail.statusCode, 404);

  // Same answer as for an asteroid that does not exist, so the hidden kyber vein stays hidden.
  const hidden = await preview(hiddenOreAsteroidId, 'spacecraftKey=mole');
  const missing = await preview(randomUUID(), 'spacecraftKey=mole');
  assert.equal(hidden.statusCode, 404);
  assert.deepEqual(hidden.json(), missing.json());

  await grantResearch(userId, { spectral_analysis: 1 });
  try {
    assert.equal((await preview(hiddenOreAsteroidId, 'spacecraftKey=mole')).statusCode, 200);
  } finally {
    await grantResearch(userId, { spectral_analysis: 0 });
  }
});

test('active trips list the traveling ships of the user only', async () => {
  const trips = () =>
    app.inject({ method: 'GET', url: '/api/me/trips', headers: authHeaders(app, userId) });

  const before = await trips();
  assert.equal(before.statusCode, 200);
  assert.deepEqual(before.json(), []);

  const assign = await app.inject({
    method: 'POST',
    url: `/api/asteroids/${nearAsteroidId}/assignments`,
    headers: authHeaders(app, userId),
    payload: { stationId, spacecraftKey: 'mole' },
  });
  assert.equal(assign.statusCode, 201);

  const active = (await trips()).json<
    { toId: string; purpose: string; spacecraft: { name: string } }[]
  >();
  assert.equal(active.length, 1);
  const [trip] = active;
  assert.ok(trip);
  assert.equal(trip.toId, nearAsteroidId);
  assert.ok(trip.spacecraft.name);

  const otherView = await app.inject({
    method: 'GET',
    url: '/api/me/trips',
    headers: authHeaders(app, otherUserId),
  });
  assert.deepEqual(otherView.json(), []);
});
