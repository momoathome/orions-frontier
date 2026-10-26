import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import type { LogbookEntry } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { runSimulationTick } from '../../src/services/simulation.service.js';
import { recordLogbookEvents } from '../../src/services/logbook.service.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';
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
  const db = getDb();
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, userIds));
  await app.close();
  await closeDb();
});

test('a completed upgrade is logged once and only for its owner', async () => {
  const [owner = '', stranger = ''] = userIds;
  const completedAt = new Date(Date.now() - 1_000);
  await getDb()
    .update(stationBuildings)
    .set({ upgradeEndsAt: completedAt })
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
