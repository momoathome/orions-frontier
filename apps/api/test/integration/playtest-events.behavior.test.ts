import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResearch } from '../../src/lib/db/schema/station-research.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { PlaytestAliasRegistry } from '../../src/lib/playtest/aliases.js';
import { PlaytestCollector } from '../../src/lib/playtest/collector.js';
import type { PlaytestPopulationMember } from '../../src/lib/playtest/population.js';
import { loadPlaytestSnapshot } from '../../src/lib/playtest/snapshot-loader.js';
import { completeDueResearchDetailed } from '../../src/services/research.service.js';
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
  await getDb().insert(stationResearch).values({
    id: researchId,
    stationId,
    technologyKey: 'station_grid_optimization',
    completesAt: completedAt,
  });
});

after(async () => {
  const db = getDb();
  await db.delete(stationResearch).where(eq(stationResearch.stationId, stationId));
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
    completeDueResearchDetailed(completedAt),
    completeDueResearchDetailed(completedAt),
  ]);
  const events = results.flat();
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'research_completed');
  assert.equal(events[0]?.eventId, `research_completed:${researchId}:complete`);

  const [research] = await getDb()
    .select({ status: stationResearch.status, completedAt: stationResearch.completedAt })
    .from(stationResearch)
    .where(eq(stationResearch.id, researchId));
  assert.equal(research?.status, 'completed');
  assert.equal(research?.completedAt?.toISOString(), completedAt.toISOString());

  const aliases = new PlaytestAliasRegistry([member()]);
  const collector = new PlaytestCollector(aliases, 5);
  for (const event of events) collector.consumeCompletion(event);
  for (const event of events) collector.consumeCompletion(event);
  assert.deepEqual(collector.summary().eventCounts, { research_completed: 1 });
  assert.equal(collector.summary().duplicateCompletionEvents, 1);

  const before = await getDb()
    .select({ status: stationResearch.status, completedAt: stationResearch.completedAt })
    .from(stationResearch)
    .where(eq(stationResearch.id, researchId));
  const snapshot = await loadPlaytestSnapshot(completedAt, aliases);
  const afterSnapshot = await getDb()
    .select({ status: stationResearch.status, completedAt: stationResearch.completedAt })
    .from(stationResearch)
    .where(eq(stationResearch.id, researchId));
  assert.deepEqual(afterSnapshot, before);
  assert.equal(snapshot.bots.length, 1);
  assert.equal(snapshot.stations.length, 1);
  assert.equal(snapshot.bots[0]?.completedResearch, 1);
  assert.match(snapshot.bots[0]?.progressFingerprint ?? '', /^[0-9a-f]{24}$/);
  assert.match(snapshot.stations[0]?.progressFingerprint ?? '', /^[0-9a-f]{24}$/);
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(userId));
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(stationId));
});
