import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { calculateBuildingUpgradeCost, researchModifiers } from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroidAssignments,
  asteroids,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { createRealtimeExecutionContext } from '../../src/lib/game-execution-context.js';
import { getAsteroidById, getVisibleChunkAsteroids } from '../../src/services/map/asteroid.js';
import {
  getUserResearchModifiers,
  getUserScannerCoverages,
} from '../../src/services/map/scanner-visibility.js';
import { createAsteroidAssignment } from '../../src/services/mining/assignment.js';
import { assignIdleMiners } from '../../src/services/mining/autonomy.js';
import { startExpedition } from '../../src/services/missions/world-mission.js';
import {
  cancelBuildingUpgrade,
  startBuildingUpgrade,
} from '../../src/services/station/buildings.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
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
      [carbonId, kyberId].map((id, index) => ({
        id,
        sectorId,
        x: stationX + 300 + index * 100,
        y: stationY,
        chunkX: Math.floor((stationX + 300 + index * 100) / 1_000),
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
    ]);
});

after(async () => {
  const db = getDb();
  await db.delete(spacecraftTrips).where(inArray(spacecraftTrips.toId, [carbonId, kyberId]));
  await db
    .delete(asteroidAssignments)
    .where(inArray(asteroidAssignments.asteroidId, [carbonId, kyberId]));
  await db.delete(asteroids).where(inArray(asteroids.id, [carbonId, kyberId]));
  for (const table of [stationBuildings, stationResources, stationSpacecrafts]) {
    await db.delete(table).where(eq(table.stationId, stationId));
  }
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await closeDb();
});

test('build slots limit parallel upgrades and cancel refunds the full cost', async () => {
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

  await startBuildingUpgrade(stationId, 'warehouse', userId);
  await assert.rejects(startBuildingUpgrade(stationId, 'hangar', userId), /No free build slot/);
  await cancelBuildingUpgrade(stationId, 'warehouse', userId);
  assert.deepEqual(await resources(), stock);
});

test('Kyber asteroids stay hidden until Spectral Analysis', async () => {
  const listed = async () => {
    const modifiers = await getUserResearchModifiers(userId);
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
  assert.ok(!(await listed()).includes(kyberId));
  assert.deepEqual(
    await createAsteroidAssignment({
      userId,
      asteroidId: kyberId,
      stationId,
      spacecraftKey: 'mole',
      assignedAmount: 1,
    }),
    { code: 'ASTEROID_NOT_FOUND', message: 'Asteroid not found' }
  );

  await grantResearch(userId, { spectral_analysis: 1 });
  assert.equal((await getAsteroidById(kyberId, userId))?.veins[0]?.resourceKey, 'kyber_crystal');
  assert.ok((await listed()).includes(kyberId));
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
});
