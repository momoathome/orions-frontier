import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import {
  calculateBuildingBuildTime,
  calculateResearchDuration,
  getSpacecraft,
} from '@orions-frontier/game-config';
import { QUEUE_LIMIT, type ResourceMap } from '@orions-frontier/shared';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { logbookEntries } from '../../src/lib/db/schema/logbook-entries.js';
import { queuedJobs } from '../../src/lib/db/schema/queued-jobs.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { createRealtimeExecutionContext } from '../../src/lib/game-execution-context.js';
import { applyConstructionSpeed } from '../../src/services/research/index.js';
import { runWorldTick } from '../../src/services/simulation/index.js';
import {
  buildSpacecrafts,
  cancelBuildingUpgrade,
  cancelBuildOrder,
  cancelResearch,
  creditStationResources,
  getBuildSlots,
  getResearchState,
  getStationBuildings,
  getStationDefenseUpgrades,
  recheckResearchQueue,
  removeQueuedResearch,
  removeQueuedStationJob,
  startBuildingUpgrade,
  startDefenseUpgrade,
  startResearch,
  toResourceMap,
} from '../../src/services/station/index.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  grantResearch,
  setTestResources,
} from '../helpers/fixtures.js';

let userId = '';
let stationId = '';
let sectorId = '';
let otherUserId = '';
let otherStationId = '';
// Far below storage, so every refund fits.
const STOCK: ResourceMap = { carbon: 4_000, hydrogenium: 4_000, titanium: 4_000 };

before(async () => {
  await runMigrations();
  await initDb();
  sectorId = (await createTestSector()).id;
  userId = (await createTestUser()).id;
  stationId = (await createTestStation({ userId, sectorId })).id;
  otherUserId = (await createTestUser()).id;
  otherStationId = (await createTestStation({ userId: otherUserId, sectorId, x: 5_000 })).id;
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
  await deleteTestData({ userIds: [userId, otherUserId], sectorIds: [sectorId] });
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
const setLevel = (buildingKey: string, level: number) =>
  getDb()
    .update(stationBuildings)
    .set({ level })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, buildingKey))
    );
const MONTH_MS = 30 * 24 * 3_600_000;

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
  const logged = await getDb()
    .select()
    .from(logbookEntries)
    .where(and(eq(logbookEntries.userId, userId), eq(logbookEntries.type, 'queue_job_dropped')));
  assert.equal(logged.length, 1, 'the cascaded core 4 is logged');

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

test('a cancel refunds what was paid, not what the config costs today', async () => {
  const db = getDb();
  await setLevel('laboratory', 3);
  const context = createRealtimeExecutionContext();
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 2 }], context);
  await startResearch(userId, stationId, 'weapons');
  const paidOnce = await stock();
  // A balance patch after the payment must not change the refund.
  await db
    .update(spacecraftBuildOrders)
    .set({ unitCost: [{ resourceKey: 'carbon', amount: 1 }] })
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  await db
    .update(userResearch)
    .set({ paidCost: [{ resourceKey: 'carbon', amount: 7 }] })
    .where(eq(userResearch.userId, userId));
  const [order] = await db
    .select()
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));

  await cancelBuildOrder(stationId, userId, order!.id, context);
  await cancelResearch(userId, 'weapons', creditStationResources);
  assert.deepEqual(await stock(), { ...paidOnce, carbon: (paidOnce['carbon'] ?? 0) + 2 + 7 });
});

test('ordered ships finish one at a time and cancelling keeps the finished ones', async () => {
  const db = getDb();
  const context = createRealtimeExecutionContext();
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 3 }], context);
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }], context);
  const orders = async () =>
    (
      await db
        .select()
        .from(spacecraftBuildOrders)
        .where(eq(spacecraftBuildOrders.stationId, stationId))
    ).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
  const moles = async () =>
    (
      await db
        .select({ amount: stationSpacecrafts.amount })
        .from(stationSpacecrafts)
        .where(
          and(
            eq(stationSpacecrafts.stationId, stationId),
            eq(stationSpacecrafts.spacecraftKey, 'mole')
          )
        )
    )[0]?.amount ?? 0;
  const logged = async () =>
    (
      await db
        .select()
        .from(logbookEntries)
        .where(
          and(eq(logbookEntries.userId, userId), eq(logbookEntries.type, 'spacecraft_completed'))
        )
    ).length;
  const [mass, later] = await orders();
  assert.ok(mass && later);
  assert.equal(mass.endsAt.getTime() - mass.nextAt.getTime(), 2 * mass.stepMs);
  const molesBefore = await moles();
  const loggedBefore = await logged();

  // Two steps have passed: two ships are done, also when a second tick runs at the same time.
  const twoBuilt = new Date(mass.nextAt.getTime() + mass.stepMs);
  await Promise.all([runWorldTick(twoBuilt), runWorldTick(twoBuilt)]);
  assert.equal(await moles(), molesBefore + 2);
  const [running] = await orders();
  assert.equal(running?.amount, 1);
  assert.equal(await logged(), loggedBefore);

  // Cancelling refunds only the ship still in the works and moves the later order up.
  await setTestResources(stationId, STOCK);
  await cancelBuildOrder(stationId, userId, mass.id, context.at(twoBuilt));
  assert.equal(await moles(), molesBefore + 2);
  const [moved] = await orders();
  assert.equal(moved?.id, later.id);
  assert.equal(
    moved.endsAt.getTime(),
    later.endsAt.getTime() - (mass.endsAt.getTime() - twoBuilt.getTime())
  );
  const refunded = await stock();
  for (const cost of getSpacecraft('mole')!.costs) {
    assert.equal(refunded[cost.resourceKey], STOCK[cost.resourceKey]! + cost.amount);
  }

  // The last order logs once, when its ship is done.
  await runWorldTick(moved.endsAt);
  assert.equal(await moles(), molesBefore + 3);
  assert.equal(await logged(), loggedBefore + 1);
});

test('a second ship order runs in a free production slot instead of waiting', async () => {
  await setLevel('shipyard', 5); // two production slots
  await setLevel('hangar', 5); // crew for the ships earlier tests built
  const context = createRealtimeExecutionContext();
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 3 }], context);
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }], context);
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }], context);
  const [single, queued, mass] = (
    await getDb()
      .select()
      .from(spacecraftBuildOrders)
      .where(eq(spacecraftBuildOrders.stationId, stationId))
  ).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
  assert.ok(single && queued && mass);

  // The mass order keeps its slot; the next order starts at once in the other slot.
  assert.notEqual(single.slot, mass.slot);
  assert.equal(single.nextAt.getTime() - context.now.getTime(), single.stepMs);
  assert.equal(mass.endsAt.getTime() - context.now.getTime(), 3 * mass.stepMs);
  assert.equal(queued.slot, single.slot);

  // Cancelling the mass order leaves the other slot's orders where they are.
  await cancelBuildOrder(stationId, userId, mass.id, context);
  const [stillSingle, stillQueued] = (
    await getDb()
      .select()
      .from(spacecraftBuildOrders)
      .where(eq(spacecraftBuildOrders.stationId, stationId))
  ).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime());
  assert.equal(stillSingle?.endsAt.getTime(), single.endsAt.getTime());
  assert.equal(stillQueued?.endsAt.getTime(), queued.endsAt.getTime());
});

test('queue jobs of another station or account cannot be removed or refunded', async () => {
  const foreign = async (kind: 'building' | 'research') => {
    const [job] = await getDb()
      .insert(queuedJobs)
      .values({
        userId: otherUserId,
        stationId: otherStationId,
        kind,
        key: kind === 'building' ? 'core' : 'weapons',
        targetLevel: 2,
        paidCost: [{ resourceKey: 'carbon', amount: 100 }],
      })
      .returning();
    return job!.id;
  };
  const buildingJob = await foreign('building');
  const researchJob = await foreign('research');

  await assert.rejects(removeQueuedStationJob(stationId, userId, buildingJob), /not found/i);
  await assert.rejects(
    removeQueuedResearch(userId, researchJob, creditStationResources),
    /not found/i
  );
  const left = await getDb().select().from(queuedJobs).where(eq(queuedJobs.userId, otherUserId));
  assert.equal(left.length, 2);
  assert.deepEqual(await stock(), STOCK);
  await getDb().delete(queuedJobs).where(eq(queuedJobs.userId, otherUserId));
});

test('finishing Parallel Construction starts a waiting upgrade in the new slot', async () => {
  await queueCore(); // core 2 takes the only slot
  await startBuildingUpgrade(stationId, 'laboratory', userId, undefined, true);
  assert.equal((await queue()).length, 1);

  const now = new Date();
  await getDb()
    .insert(userResearch)
    .values({
      userId,
      technologyKey: 'parallel_construction',
      level: 0,
      startedAt: new Date(now.getTime() - 60_000),
      completesAt: new Date(now.getTime() - 1_000),
      paidByStationId: stationId,
      paidCost: [],
    });
  await runWorldTick(now);

  assert.deepEqual(await queue(), []);
  const lab = (await getStationBuildings(stationId)).find((b) => b.definition.key === 'laboratory');
  assert.equal(lab?.isUpgrading, true);
});

test('queued research whose laboratory fell is dropped with a refund', async () => {
  await setLevel('laboratory', 3);
  await startResearch(userId, stationId, 'weapons', undefined, true); // runs
  await startResearch(userId, stationId, 'weapons', undefined, true); // waits
  const [waiting] = (await getResearchState(userId)).queue;
  const paid = toResourceMap(waiting!.paidCost);
  const before = await stock();
  await setLevel('laboratory', 1);

  const dropped = await recheckResearchQueue(userId, new Date(), creditStationResources);
  assert.deepEqual(
    dropped.map((event) => [event.type, event.refunded]),
    [['queue_job_dropped', paid]]
  );
  assert.deepEqual((await getResearchState(userId)).queue, []);
  const expected: Record<string, number> = { ...before };
  for (const [key, amount] of Object.entries(paid)) expected[key] = (expected[key] ?? 0) + amount;
  assert.deepEqual(await stock(), expected);
});

test('a level queued after its slot freed starts when it was queued, not before', async () => {
  await queueCore(); // core 2 runs
  await getDb()
    .update(stationBuildings)
    .set({ upgradeEndsAt: new Date(Date.now() - 60_000) })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'core'))
    );
  await queueCore(); // core 3 waits for the due core 2
  const [job] = await getDb().select().from(queuedJobs).where(eq(queuedJobs.stationId, stationId));

  await runWorldTick(new Date());
  const core = (await getStationBuildings(stationId)).find((b) => b.definition.key === 'core');
  assert.equal(core?.level, 2);
  const expected = applyConstructionSpeed(
    0,
    2,
    new Date(job!.createdAt.getTime() + calculateBuildingBuildTime('core', 3) * 1000),
    job!.createdAt
  );
  assert.equal(Date.parse(core.upgradeEndsAt!), expected.getTime());
});

test('a queued defense waits for the queued building it needs and goes when that is cancelled', async () => {
  await grantResearch(userId, { weapons: 1 });
  await setLevel('defense_drones', 0);
  const queueDrones = () =>
    startDefenseUpgrade(stationId, 'defense_drones', userId, undefined, true);
  await queueCore(); // core 2 runs
  await queueDrones(); // needs core 2
  assert.deepEqual(
    (await queue()).map((job) => [job.key, job.targetLevel]),
    [['defense_drones', 1]]
  );
  await cancelBuildingUpgrade(stationId, 'core', userId);
  assert.deepEqual(await queue(), []);
  assert.deepEqual(await stock(), STOCK);

  await queueCore();
  await queueDrones();
  await runWorldTick(new Date(Date.now() + MONTH_MS));
  const drones = (await getStationDefenseUpgrades(stationId, userId)).find(
    (upgrade) => upgrade.definition.key === 'defense_drones'
  );
  assert.equal(drones?.level, 1);
});

test('queued research starts when the running level completes, also while nobody watches', async () => {
  await setLevel('laboratory', 3);
  await startResearch(userId, stationId, 'weapons', undefined, true); // weapons 1 runs
  await startResearch(userId, stationId, 'weapons', undefined, true); // weapons 2 waits
  const running = (await getResearchState(userId)).technologies.find(
    (t) => t.definition.key === 'weapons'
  );
  const firstEnd = Date.parse(running!.completesAt!);

  const tick = await runWorldTick(new Date(Date.now() + MONTH_MS));
  const ends = tick.events
    .filter((event) => event.type === 'research_completed' && event.userId === userId)
    .map((event) => event.occurredAt.getTime());
  // Weapons 2 began when weapons 1 ended, not at the tick.
  assert.deepEqual(ends, [firstEnd, firstEnd + calculateResearchDuration('weapons', 2, 3) * 1000]);
  assert.deepEqual((await getResearchState(userId)).queue, []);
});

test('a laboratory that is only upgrading or queued does not unlock the next research level', async () => {
  await startBuildingUpgrade(stationId, 'laboratory', userId, undefined, true); // lab 2 runs
  await startBuildingUpgrade(stationId, 'laboratory', userId, undefined, true); // lab 3 waits
  await startResearch(userId, stationId, 'weapons', undefined, true); // weapons 1 needs lab 1

  await assert.rejects(
    startResearch(userId, stationId, 'weapons', undefined, true),
    /Requires Laboratory 2/
  );
  const state = await getResearchState(userId);
  assert.deepEqual(state.queue, []);
  assert.deepEqual(state.technologies.find((t) => t.definition.key === 'weapons')?.blockers, [
    { type: 'lab_cap', level: 2, current: 1 },
  ]);
});
