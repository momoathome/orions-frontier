import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { queuedJobs } from '../../src/lib/db/schema/queued-jobs.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  setTestResources,
} from '../helpers/fixtures.js';
import { authHeaders, buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
let ownerId = '';
let strangerId = '';
let stationId = '';
let sectorId = '';

before(async () => {
  await runMigrations();
  await initDb();
  ownerId = (await createTestUser()).id;
  strangerId = (await createTestUser()).id;
  sectorId = (await createTestSector()).id;
  stationId = (await createTestStation({ userId: ownerId, sectorId })).id;
  await setTestResources(stationId, { carbon: 4_000, hydrogenium: 4_000, titanium: 4_000 });
});

after(async () => {
  await deleteTestData({ userIds: [ownerId, strangerId], sectorIds: [sectorId] });
  await app.close();
  await closeDb();
});

const remove = (url: string, userId: string) =>
  app.inject({ method: 'DELETE', url, headers: authHeaders(app, userId) });

const waitingJob = async (kind: 'building' | 'research') => {
  const [job] = await getDb()
    .insert(queuedJobs)
    .values({
      userId: ownerId,
      stationId,
      kind,
      key: kind === 'building' ? 'core' : 'weapons',
      targetLevel: 9,
      paidCost: [{ resourceKey: 'carbon', amount: 10 }],
    })
    .returning();
  return job!.id;
};

test('DELETE station queue job: only the owner removes it', async () => {
  const jobId = await waitingJob('building');
  const url = `/api/stations/${stationId}/queue/${jobId}`;
  assert.equal((await remove(url, strangerId)).statusCode, 404);
  assert.equal(
    (await remove(`/api/stations/${stationId}/queue/not-a-uuid`, ownerId)).statusCode,
    400
  );
  assert.equal((await remove(url, ownerId)).statusCode, 204);
  assert.equal((await remove(url, ownerId)).statusCode, 404);
});

test('DELETE research queue job: only the account that queued it removes it', async () => {
  const jobId = await waitingJob('research');
  const url = `/api/me/research/queue/${jobId}`;
  assert.equal((await remove(url, strangerId)).statusCode, 404);
  assert.equal((await remove('/api/me/research/queue/not-a-uuid', ownerId)).statusCode, 400);
  assert.equal((await remove(url, ownerId)).statusCode, 204);
  assert.equal((await remove(url, ownerId)).statusCode, 404);
});

test('DELETE ship build order: only the owner cancels it', async () => {
  const orderId = randomUUID();
  await getDb()
    .insert(spacecraftBuildOrders)
    .values({
      id: orderId,
      stationId,
      spacecraftKey: 'mole',
      amount: 1,
      orderedAmount: 1,
      unitCost: [],
      nextAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 3_600_000),
    });
  const url = `/api/stations/${stationId}/spacecrafts/orders/${orderId}`;
  assert.equal((await remove(url, strangerId)).statusCode, 404);
  assert.equal((await remove(url, ownerId)).statusCode, 204);
  assert.equal((await remove(url, ownerId)).statusCode, 404);
});
