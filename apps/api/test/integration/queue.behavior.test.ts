import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { calculateBuildingBuildTime } from '@orions-frontier/game-config';
import { QUEUE_LIMIT, type ResourceMap } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { queuedJobs } from '../../src/lib/db/schema/queued-jobs.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { users } from '../../src/lib/db/schema/users.js';
import { createRealtimeExecutionContext } from '../../src/lib/game-execution-context.js';
import {
  applyConstructionSpeed,
  cancelResearch,
  getResearchState,
  removeQueuedResearch,
  startResearch,
} from '../../src/services/research/index.js';
import { runWorldTick } from '../../src/services/simulation/index.js';
import {
  buildSpacecrafts,
  cancelBuildingUpgrade,
  cancelBuildOrder,
  creditStationResources,
  getBuildSlots,
  getStationBuildings,
  removeQueuedStationJob,
  startBuildingUpgrade,
} from '../../src/services/station/index.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  setTestResources,
} from '../helpers/fixtures.js';

let userId = '';
let stationId = '';
let sectorId = '';
// Far below storage, so every refund fits.
const STOCK: ResourceMap = { carbon: 4_000, hydrogenium: 4_000, titanium: 4_000 };

before(async () => {
  await runMigrations();
  await initDb();
  sectorId = (await createTestSector()).id;
  userId = (await createTestUser()).id;
  stationId = (await createTestStation({ userId, sectorId })).id;
});

beforeEach(async () => {
  const db = getDb();
  await db.delete(queuedJobs).where(eq(queuedJobs.userId, userId));
  await db.delete(userResearch).where(eq(userResearch.userId, userId));
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db
    .update(stationBuildings)
    .set({ level: 1, upgradeEndsAt: null, upgradePaidCost: null })
    .where(eq(stationBuildings.stationId, stationId));
  await setTestResources(stationId, STOCK);
});

after(async () => {
  const db = getDb();
  await db.delete(queuedJobs).where(eq(queuedJobs.userId, userId));
  await db.delete(userResearch).where(eq(userResearch.userId, userId));
  for (const table of [
    stationBuildings,
    stationResources,
    stationSpacecrafts,
    spacecraftBuildOrders,
  ]) {
    await db.delete(table).where(eq(table.stationId, stationId));
  }
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await closeDb();
});

const stock = async () =>
  Object.fromEntries(
    (await getDb().select().from(stationResources).where(eq(stationResources.stationId, stationId)))
      .filter((row) => row.resourceKey in STOCK)
      .map((row) => [row.resourceKey, row.amount])
  );
const queueCore = () => startBuildingUpgrade(stationId, 'core', userId, undefined, true);
const queue = async () => (await getBuildSlots(stationId, new Date())).queue;

test('cancelling a level drops the queued levels that built on it and refunds everything', async () => {
  await queueCore(); // core 2 runs
  await queueCore(); // core 3 waits
  await queueCore(); // core 4 waits
  assert.deepEqual(
    (await queue()).map((job) => job.targetLevel),
    [3, 4]
  );

  // Removing core 3 leaves core 4 without its step, so it goes too.
  await removeQueuedStationJob(stationId, userId, (await queue())[0]!.id);
  assert.deepEqual(await queue(), []);

  await queueCore(); // core 3 again
  await cancelBuildingUpgrade(stationId, 'core', userId);
  assert.deepEqual(await queue(), []);
  assert.deepEqual(await stock(), STOCK);
});

test('a queued level starts when the slot frees, also while nobody watches', async () => {
  const startedAt = new Date();
  await queueCore();
  await queueCore();
  const running = (await getStationBuildings(stationId)).find((b) => b.definition.key === 'core');
  assert.equal(running?.queuedLevel, 3);
  const firstEnd = Date.parse(running.upgradeEndsAt!);

  const tick = await runWorldTick(new Date(startedAt.getTime() + 30 * 24 * 3_600_000));
  const core = (await getStationBuildings(stationId)).find((b) => b.definition.key === 'core');
  assert.equal(core?.level, 3);
  const ends = tick.events
    .filter((event) => event.type === 'building_completed' && event.stationId === stationId)
    .map((event) => event.occurredAt.getTime());
  // Core 3 began when core 2 ended, not at the tick.
  const expected = applyConstructionSpeed(
    0,
    2,
    new Date(firstEnd + calculateBuildingBuildTime('core', 3) * 1000),
    new Date(firstEnd)
  ).getTime();
  assert.deepEqual(ends, [firstEnd, expected]);
});

test('a station queue holds at most ten waiting jobs', async () => {
  const plenty = 1e9;
  await setTestResources(stationId, {
    carbon: plenty,
    titanium: plenty,
    kyber_crystal: plenty,
    astatine: plenty,
  });
  for (let i = 0; i <= QUEUE_LIMIT; i += 1) await queueCore();
  assert.equal((await queue()).length, QUEUE_LIMIT);
  await assert.rejects(queueCore(), /Queue is full/);
});

test('two queue requests for one payment: only one is paid and queued', async () => {
  await queueCore();
  const next = (await getStationBuildings(stationId)).find((b) => b.definition.key === 'core');
  await setTestResources(
    stationId,
    Object.fromEntries(next!.upgradeCosts.map((cost) => [cost.resourceKey, cost.amount]))
  );
  const results = await Promise.allSettled([queueCore(), queueCore()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await queue()).length, 1);
});

test('research queue: cancelling running research drops the level queued after it', async () => {
  await getDb()
    .update(stationBuildings)
    .set({ level: 3 })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'laboratory'))
    );
  await startResearch(userId, stationId, 'weapons', undefined, true);
  await startResearch(userId, stationId, 'weapons', undefined, true);
  const state = await getResearchState(userId);
  assert.deepEqual(
    state.queue.map((job) => job.targetLevel),
    [2]
  );
  assert.equal(state.technologies.find((t) => t.definition.key === 'weapons')?.queuedLevel, 2);

  await cancelResearch(userId, 'weapons', creditStationResources);
  assert.deepEqual((await getResearchState(userId)).queue, []);
  assert.deepEqual(await stock(), STOCK);

  await startResearch(userId, stationId, 'weapons', undefined, true);
  await startResearch(userId, stationId, 'weapons', undefined, true);
  const [job] = (await getResearchState(userId)).queue;
  await removeQueuedResearch(userId, job!.id, creditStationResources);
  await cancelResearch(userId, 'weapons', creditStationResources);
  assert.deepEqual(await stock(), STOCK);
});

test('cancelling a ship order refunds it and moves later orders up', async () => {
  const context = createRealtimeExecutionContext();
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }], context);
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }], context);
  const orders = async () =>
    (
      await getDb()
        .select()
        .from(spacecraftBuildOrders)
        .where(eq(spacecraftBuildOrders.stationId, stationId))
    ).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
  const [first, second] = await orders();

  // The running first order gives back the time it still had left.
  await cancelBuildOrder(stationId, userId, first!.id, context);
  const [moved] = await orders();
  assert.equal(moved?.id, second!.id);
  assert.equal(
    moved.endsAt.getTime(),
    second!.endsAt.getTime() - (first!.endsAt.getTime() - context.now.getTime())
  );
  await cancelBuildOrder(stationId, userId, second!.id, context);
  assert.deepEqual(await stock(), STOCK);
});
