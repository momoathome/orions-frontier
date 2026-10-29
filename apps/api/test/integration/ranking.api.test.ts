import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import type { Ranking } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';
import { authHeaders, buildTestApp } from '../helpers/test-app.js';

const app = await buildTestApp();
const userIds: string[] = [];
const stationIds: string[] = [];
let sectorId = '';

const setCoreLevel = (stationId: string, level: number) =>
  getDb()
    .update(stationBuildings)
    .set({ level })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'core'))
    );

const setMoles = (stationId: string, amount: number) =>
  getDb()
    .update(stationSpacecrafts)
    .set({ amount })
    .where(
      and(eq(stationSpacecrafts.stationId, stationId), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );

before(async () => {
  await runMigrations();
  await initDb();
  const leader = await createTestUser();
  const runnerUp = await createTestUser();
  const newcomer = await createTestUser();
  userIds.push(leader.id, runnerUp.id, newcomer.id);
  sectorId = (await createTestSector()).id;
  // Influence is summed over the leader's two stations; every station starts with 3 Moles.
  const leaderHome = await createTestStation({ userId: leader.id, sectorId });
  const leaderColony = await createTestStation({ userId: leader.id, sectorId });
  const runnerUpHome = await createTestStation({ userId: runnerUp.id, sectorId });
  stationIds.push(leaderHome.id, leaderColony.id, runnerUpHome.id);
  await setCoreLevel(leaderHome.id, 3);
  await setCoreLevel(leaderColony.id, 2);
  await setCoreLevel(runnerUpHome.id, 3);
});

after(async () => {
  const db = getDb();
  await db.delete(stationResources).where(inArray(stationResources.stationId, stationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, stationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, stationIds));
  await db.delete(stations).where(inArray(stations.id, stationIds));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(inArray(users.id, userIds));
  await app.close();
  await closeDb();
});

const fetchRanking = async (userId: string): Promise<Ranking> => {
  const response = await app.inject({
    method: 'GET',
    url: '/api/world/ranking?limit=100',
    headers: authHeaders(app, userId),
  });
  assert.equal(response.statusCode, 200);
  return response.json<Ranking>();
};

test('players are ranked server-wide by the Influence of all their stations and ships', async () => {
  const [leader = '', runnerUp = '', newcomer = ''] = userIds;

  const leaderView = await fetchRanking(leader);
  const runnerUpView = await fetchRanking(runnerUp);
  assert.ok(leaderView.me && runnerUpView.me);
  // Core upgrades 2080 + 800 resources, 6 Moles at half of 190 each.
  assert.deepEqual(leaderView.me.influence, {
    buildings: 29,
    research: 0,
    defense: 0,
    fleet: 6,
    total: 35,
  });
  assert.equal(leaderView.me.stationCount, 2);
  assert.equal(leaderView.me.ownerType, 'player');
  assert.equal(runnerUpView.me.influence.total, 24);
  assert.ok(leaderView.me.rank < runnerUpView.me.rank);

  // Lost ships only reduce the fleet share.
  await setMoles(stationIds[2] ?? '', 1);
  const afterLosses = (await fetchRanking(runnerUp)).me;
  assert.ok(afterLosses);
  assert.equal(afterLosses.influence.buildings, 21);
  assert.equal(afterLosses.influence.fleet, 1);
  assert.equal(afterLosses.influence.total, 22);

  // The list is ordered and the own row matches the player's place in it.
  const scores = leaderView.top.map((entry) => entry.influence.total);
  assert.deepEqual(
    scores,
    [...scores].sort((a, b) => b - a)
  );
  const listed = leaderView.top.find((entry) => entry.userId === leader);
  if (listed) assert.equal(listed.rank, leaderView.me.rank);

  // A player without a station has no rank yet but still sees the board.
  const newcomerView = await fetchRanking(newcomer);
  assert.equal(newcomerView.me, null);
  assert.equal(newcomerView.totalPlayers, leaderView.totalPlayers);

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/world/ranking' });
  assert.equal(unauthenticated.statusCode, 401);
});
