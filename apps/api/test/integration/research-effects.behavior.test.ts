import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import {
  applyBuildingCostDiscount,
  calculateBuildingUpgradeCost,
  researchModifiers,
} from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids, asteroidVeins } from '../../src/lib/db/schema/asteroids.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { createRealtimeExecutionContext } from '../../src/lib/game-execution-context.js';
import { getAsteroidById, getVisibleChunkAsteroids } from '../../src/services/world/asteroid.js';
import { getResearchModifiers } from '../../src/services/research/effects.js';
import { getUserScannerCoverages } from '../../src/services/station/scanner-coverage.js';
import { createAsteroidAssignment } from '../../src/services/mining/assignment.js';
import { assignIdleMiners } from '../../src/services/mining/autonomy.js';
import { startExpedition } from '../../src/services/missions/world-mission.js';
import { cancelResearch, startResearch } from '../../src/services/station/research-queue.js';
import {
  cancelBuildingUpgrade,
  startBuildingUpgrade,
} from '../../src/services/station/buildings.js';
import { getBuildSlots } from '../../src/services/station/construction.js';
import { creditStationResources } from '../../src/services/station/resources.js';
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
let stationX = 0;
let stationY = 0;
const carbonId = crypto.randomUUID();
const kyberId = crypto.randomUUID();
// Carbon mined out, Kyber left: hidden ore must not keep it on the map.
const mixedId = crypto.randomUUID();
let runningResearch: 'weapons' | 'armor' = 'weapons';

before(async () => {
  await runMigrations();
  await initDb();
  const sector = await createTestSector();
  sectorId = sector.id;
  // A far, unique spot keeps other asteroids out of scanner range.
  stationX = sector.sectorX * 1_000;
  stationY = sector.sectorY * 1_000;
  userId = (await createTestUser()).id;
  stationId = (await createTestStation({ userId, sectorId, x: stationX, y: stationY })).id;
  await getDb()
    .insert(asteroids)
    .values(
      [carbonId, kyberId, mixedId].map((id, index) => ({
        id,
        sectorId,
        x: stationX + 300 + index * 150,
        y: stationY,
        chunkX: Math.floor((stationX + 300 + index * 150) / 1_000),
        chunkY: Math.floor(stationY / 1_000),
        size: 'small' as const,
      }))
    );
  await getDb()
    .insert(asteroidVeins)
    .values([
      { asteroidId: carbonId, veinType: 'primary', resourceKey: 'carbon', remainingAmount: 500 },
      {
        asteroidId: kyberId,
        veinType: 'primary',
        resourceKey: 'kyber_crystal',
        remainingAmount: 500,
      },
      { asteroidId: mixedId, veinType: 'primary', resourceKey: 'carbon', remainingAmount: 0 },
      {
        asteroidId: mixedId,
        veinType: 'trace',
        resourceKey: 'kyber_crystal',
        remainingAmount: 500,
      },
    ]);
});

after(async () => {
  await deleteTestData({ userIds: [userId], sectorIds: [sectorId] });
  await closeDb();
});

test('build slots limit parallel upgrades, show their use and cancel refunds the full cost', async () => {
  const stock = Object.fromEntries(
    calculateBuildingUpgradeCost('warehouse', 2).map((cost) => [cost.resourceKey, cost.amount])
  );
  await setTestResources(stationId, stock);
  const resources = async () =>
    Object.fromEntries(
      (
        await getDb()
          .select()
          .from(stationResources)
          .where(eq(stationResources.stationId, stationId))
      )
        .filter((row) => row.resourceKey in stock)
        .map((row) => [row.resourceKey, row.amount])
    );

  assert.deepEqual(await getBuildSlots(stationId, new Date()), { used: 0, total: 1, queue: [] });
  await startBuildingUpgrade(stationId, 'warehouse', userId);
  assert.deepEqual(await getBuildSlots(stationId, new Date()), { used: 1, total: 1, queue: [] });
  await assert.rejects(startBuildingUpgrade(stationId, 'hangar', userId), /No free build slot/);
  await cancelBuildingUpgrade(stationId, 'warehouse', userId);
  assert.deepEqual(await resources(), stock);
  assert.deepEqual(await getBuildSlots(stationId, new Date()), { used: 0, total: 1, queue: [] });
});

test('concurrent starts fill one research slot and one build slot exactly once', async () => {
  await setTestResources(stationId, { carbon: 4_000, titanium: 4_000, hydrogenium: 4_000 });
  const research = await Promise.allSettled([
    startResearch(userId, stationId, 'weapons'),
    startResearch(userId, stationId, 'armor'),
  ]);
  assert.deepEqual(research.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  runningResearch = research[0].status === 'fulfilled' ? 'weapons' : 'armor';

  const builds = await Promise.allSettled([
    startBuildingUpgrade(stationId, 'warehouse', userId),
    startBuildingUpgrade(stationId, 'hangar', userId),
  ]);
  assert.deepEqual(builds.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  await cancelBuildingUpgrade(
    stationId,
    builds[0].status === 'fulfilled' ? 'warehouse' : 'hangar',
    userId
  );
});

test('Research Network runs a second research in parallel', async () => {
  await setTestResources(stationId, { carbon: 4_000, titanium: 4_000, hydrogenium: 4_000 });
  const second = runningResearch === 'weapons' ? 'armor' : 'weapons';
  await assert.rejects(startResearch(userId, stationId, second), /slot/i);
  await grantResearch(userId, { research_network: 1 });
  await startResearch(userId, stationId, second);
  await cancelResearch(userId, second, creditStationResources);
});

test('Nanite Assembly lowers the paid upgrade cost and cancel refunds what was paid', async () => {
  await grantResearch(userId, { nanite_assembly: 5 });
  const full = calculateBuildingUpgradeCost('warehouse', 2);
  const paid = applyBuildingCostDiscount(full, 0.8);
  assert.ok(paid.every((cost, index) => cost.amount < full[index]!.amount));
  const stock = Object.fromEntries(full.map((cost) => [cost.resourceKey, cost.amount]));
  await setTestResources(stationId, stock);
  const resources = async () =>
    Object.fromEntries(
      (
        await getDb()
          .select()
          .from(stationResources)
          .where(eq(stationResources.stationId, stationId))
      )
        .filter((row) => row.resourceKey in stock)
        .map((row) => [row.resourceKey, row.amount])
    );

  await startBuildingUpgrade(stationId, 'warehouse', userId);
  assert.deepEqual(
    await resources(),
    Object.fromEntries(
      full.map((cost, index) => [cost.resourceKey, cost.amount - paid[index]!.amount])
    )
  );
  await cancelBuildingUpgrade(stationId, 'warehouse', userId);
  assert.deepEqual(await resources(), stock);
});

test('Kyber asteroids stay hidden until Spectral Analysis', async () => {
  const listed = async () => {
    const modifiers = await getResearchModifiers(userId);
    const chunk = { x: Math.floor(stationX / 1_000), y: Math.floor(stationY / 1_000) };
    return (
      await getVisibleChunkAsteroids(
        { minChunkX: chunk.x, maxChunkX: chunk.x + 1, minChunkY: chunk.y, maxChunkY: chunk.y },
        await getUserScannerCoverages(userId),
        modifiers.visibleResources
      )
    ).map((asteroid) => asteroid.id);
  };

  assert.equal(await getAsteroidById(kyberId, userId), null);
  assert.equal(await getAsteroidById(mixedId, userId), null);
  assert.ok(!(await listed()).some((id) => id === kyberId || id === mixedId));
  await assert.rejects(
    createAsteroidAssignment({
      userId,
      asteroidId: kyberId,
      stationId,
      spacecraftKey: 'mole',
      assignedAmount: 1,
    }),
    /Asteroid not found/
  );

  await grantResearch(userId, { spectral_analysis: 1 });
  assert.equal((await getAsteroidById(kyberId, userId))?.veins[0]?.resourceKey, 'kyber_crystal');
  assert.ok((await listed()).includes(kyberId));
  assert.ok((await listed()).includes(mixedId));
});

test('expeditions require Long-Range Survey', async () => {
  assert.equal(researchModifiers({}).canExplore, false);
  await assert.rejects(
    startExpedition({ userId, stationId, sectorX: 0, sectorY: 0 }),
    /Requires Long-Range Survey/
  );
});

test('the Autonomous Mining Fleet sends idle miners to the nearest best asteroid', async () => {
  const assign = () =>
    getDb().transaction((tx) =>
      assignIdleMiners(
        tx,
        { stationId, spacecraftKey: 'mole', amount: 1, resourceKey: null, departedAt: new Date() },
        createRealtimeExecutionContext()
      )
    );

  assert.equal(await assign(), null);
  await grantResearch(userId, { autonomous_fleet: 1 });
  const event = await assign();
  assert.equal(event?.type, 'miners_assigned');
  assert.equal(event.asteroidId, carbonId);
  assert.equal(event.rerouted, false);

  // Salvagers stay home for salvage orders.
  const salvage = await getDb().transaction((tx) =>
    assignIdleMiners(
      tx,
      {
        stationId,
        spacecraftKey: 'collector',
        amount: 1,
        resourceKey: null,
        departedAt: new Date(),
      },
      createRealtimeExecutionContext()
    )
  );
  assert.equal(salvage, null);
});

// Last: it marks the station destroyed.
test('due research cannot be cancelled and a destroyed payer gets no refund', async () => {
  const later = createRealtimeExecutionContext(new Date(Date.now() + 3_600_000));
  await assert.rejects(
    cancelResearch(userId, runningResearch, creditStationResources, later),
    /not running/
  );

  await getDb().update(stations).set({ destroyedAt: new Date() }).where(eq(stations.id, stationId));
  const hydrogenium = async () =>
    (
      await getDb()
        .select({ amount: stationResources.amount })
        .from(stationResources)
        .where(
          and(
            eq(stationResources.stationId, stationId),
            eq(stationResources.resourceKey, 'hydrogenium')
          )
        )
    )[0]?.amount;
  const before = await hydrogenium();
  await cancelResearch(userId, runningResearch, creditStationResources);
  assert.equal(await hydrogenium(), before);
  const [row] = await getDb()
    .select({ completesAt: userResearch.completesAt })
    .from(userResearch)
    .where(and(eq(userResearch.userId, userId), eq(userResearch.technologyKey, runningResearch)));
  assert.equal(row?.completesAt, null);
});
