import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { LogbookEntry } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { runSimulationTick } from '../../src/services/simulation/simulation.js';
import { recordLogbookEvents } from '../../src/services/logbook/logbook.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
} from '../helpers/fixtures.js';
import { authHeaders, buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
const userIds: string[] = [];
let sectorId = '';
let stationId = '';

before(async () => {
  await runMigrations();
  await initDb();
  const owner = await createTestUser();
  const stranger = await createTestUser();
  userIds.push(owner.id, stranger.id);
  sectorId = (await createTestSector()).id;
  stationId = (await createTestStation({ userId: owner.id, sectorId })).id;
});

after(async () => {
  await deleteTestData({ userIds, sectorIds: [sectorId] });
  await app.close();
  await closeDb();
});

test('a completed upgrade is logged once and only for its owner', async () => {
  const [owner = '', stranger = ''] = userIds;
  const completedAt = new Date(Date.now() - 1_000);
  await getDb()
    .update(stationBuildings)
    .set({ upgradeEndsAt: completedAt, upgradePaidCost: [] })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'warehouse'))
    );

  const drained = await runSimulationTick(new Date());
  await runSimulationTick(new Date());
  await recordLogbookEvents(drained.events);

  const response = await app.inject({
    method: 'GET',
    url: '/api/me/logbook',
    headers: authHeaders(app, owner),
  });
  assert.equal(response.statusCode, 200);
  const entries = response.json<LogbookEntry[]>();
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.ok(entry);
  assert.equal(entry.type, 'building_completed');
  assert.equal(entry.stationId, stationId);
  assert.match(entry.summary, /Warehouse upgraded to level \d+/);
  assert.equal(entry.occurredAt, completedAt.toISOString());

  const foreign = await app.inject({
    method: 'GET',
    url: '/api/me/logbook',
    headers: authHeaders(app, stranger),
  });
  assert.deepEqual(foreign.json(), []);

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/me/logbook' });
  assert.equal(unauthenticated.statusCode, 401);
});
