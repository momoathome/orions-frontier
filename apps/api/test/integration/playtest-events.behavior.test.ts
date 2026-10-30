import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { users } from '../../src/lib/db/schema/users.js';
import { PlaytestAliasRegistry } from '../../src/tools/playtest/aliases.js';
import { PlaytestCollector } from '../../src/tools/playtest/collector.js';
import type { PlaytestPopulationMember } from '../../src/tools/playtest/population.js';
import { loadPlaytestSnapshot } from '../../src/tools/playtest/snapshot-loader.js';
import { completeDueResearch } from '../../src/services/research/research.js';
import { createTestSector, createTestStation, createTestUser } from '../helpers/fixtures.js';

let userId = '';
let stationId = '';
let sectorId = '';
let researchId = '';
const completedAt = new Date('2055-01-01T01:00:00.000Z');

before(async () => {
  await runMigrations();
  await initDb();
  const sector = await createTestSector();
  const user = await createTestUser({
    role: 'player',
    createdAt: new Date('2055-01-01T00:00:00Z'),
  });
  const station = await createTestStation({
    userId: user.id,
    sectorId: sector.id,
    createdAt: new Date('2055-01-01T00:00:00Z'),
  });
  userId = user.id;
  stationId = station.id;
  sectorId = sector.id;
  researchId = randomUUID();
  await getDb()
    .insert(botControllers)
    .values({
      userId,
      strategy: 'goal_v1',
      strategyVersion: '1',
      profile: 'technocrat',
      nextDecisionAt: new Date('2100-01-01T00:00:00.000Z'),
    });
  await getDb()
    .insert(userResearch)
    .values({
      id: researchId,
      userId,
      technologyKey: 'extraction_algorithms',
      startedAt: new Date('2055-01-01T00:00:00.000Z'),
      completesAt: completedAt,
      paidByStationId: stationId,
    });
});

after(async () => {
  const db = getDb();
  await db.delete(userResearch).where(eq(userResearch.userId, userId));
  await db.delete(botControllers).where(eq(botControllers.userId, userId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await closeDb();
});

function member(): PlaytestPopulationMember {
  return {
    alias: 'player-001',
    userId,
    initialStationId: stationId,
    profile: 'technocrat',
    joinedAt: new Date('2055-01-01T00:00:00.000Z'),
    populationKind: 'synthetic_player',
  };
}

test('an atomically claimed completion emits once and snapshots remain compact and read-only', async () => {
  const results = await Promise.all([
    completeDueResearch(completedAt),
    completeDueResearch(completedAt),
  ]);
  // Other files may leave due research behind; only this row's claim matters here.
  const events = results
    .flatMap((result) => result.events)
    .filter((event) => event.type === 'research_completed' && event.researchId === researchId);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'research_completed');
  assert.equal(events[0].eventId, `research_completed:${researchId}:1`);

  const researchRow = () =>
    getDb()
      .select({ level: userResearch.level, completesAt: userResearch.completesAt })
      .from(userResearch)
      .where(eq(userResearch.id, researchId));
  const [research] = await researchRow();
  assert.equal(research?.level, 1);
  assert.equal(research.completesAt, null);

  const aliases = new PlaytestAliasRegistry([member()]);
  const collector = new PlaytestCollector(aliases, 5);
  for (const event of events) collector.consumeCompletion(event);
  for (const event of events) collector.consumeCompletion(event);
  assert.deepEqual(collector.summary().eventCounts, { research_completed: 1 });
  assert.equal(collector.summary().duplicateCompletionEvents, 1);

  const before = await researchRow();
  const snapshot = await loadPlaytestSnapshot(completedAt, aliases);
  const afterSnapshot = await researchRow();
  assert.deepEqual(afterSnapshot, before);
  assert.equal(snapshot.bots.length, 1);
  assert.equal(snapshot.stations.length, 1);
  assert.equal(snapshot.bots[0]?.completedResearch, 1);
  assert.match(snapshot.bots[0].progressFingerprint, /^[0-9a-f]{24}$/);
  assert.match(snapshot.stations[0]?.progressFingerprint ?? '', /^[0-9a-f]{24}$/);
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(userId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(stationId));
});
