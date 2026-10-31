import assert from 'node:assert/strict';
import { entriesOf, type ResourceMap } from '@orions-frontier/shared';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import {
  calculateBuildingEffect,
  calculateBuildingUpgradeCost,
  spacecrafts,
} from '@orions-frontier/game-config';
import { closeDb, getDb, initDb, withExclusiveLock } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { users } from '../../src/lib/db/schema/users.js';
import {
  seedStationBuildings,
  startBuildingUpgrade,
} from '../../src/services/station/buildings.js';
import {
  buildSpacecrafts,
  getStationHangar,
  getStationSpacecrafts,
  seedStationSpacecrafts,
} from '../../src/services/station/spacecraft.js';
import { createStation } from '../../src/services/station/station.js';
import {
  creditStationResources,
  getDeliveredResourceRates,
  getStationResources,
  seedStationResources,
} from '../../src/services/station/resources.js';
import { getUserScannerCoverages } from '../../src/services/station/scanner-coverage.js';
import {
  cancelResearch,
  completeDueResearch,
  getResearchState,
  startResearch,
} from '../../src/services/station/research-queue.js';
import { deleteTestData, grantResearch, setTestResources } from '../helpers/fixtures.js';
import { runExclusiveWorldTick, runWorldTick } from '../../src/services/simulation/simulation.js';
import {
  applyConstructionSpeed,
  applyTravelSpeed,
  getStationResearchModifiers,
} from '../../src/services/research/effects.js';
import { payStationCosts } from '../../src/services/station/repositories/station-resources.js';

const userId = randomUUID();
const stationId = randomUUID();
const sectorId = randomUUID();
const createdUserIds: string[] = [];

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  const suffix = randomUUID();

  await db.insert(sectors).values({
    id: sectorId,
    sectorX: 413,
    sectorY: 413,
    role: 'settlement',
    seed: suffix,
  });

  await db.insert(users).values({
    id: userId,
    username: `write-${suffix}`,
    email: `write-${suffix}@example.test`,
    passwordHash: 'not-used',
  });
  await db
    .insert(stations)
    .values({ id: stationId, userId, sectorId, name: 'Write Test', x: 0, y: 0 });
  await seedStationBuildings(stationId);
  await seedStationSpacecrafts(stationId);
  await seedStationResources(stationId);
});

after(async () => {
  await deleteTestData({ userIds: [userId, ...createdUserIds], sectorIds: [sectorId] });
  await closeDb();
});

async function setResources(amounts: ResourceMap) {
  const db = getDb();
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db
    .insert(stationResources)
    .values(
      entriesOf(amounts).map(([resourceKey, amount]) => ({ stationId, resourceKey, amount }))
    );
}

test('mutating services reject a station owned by another user', async () => {
  const otherUserId = randomUUID();
  await assert.rejects(
    buildSpacecrafts(stationId, otherUserId, [{ spacecraftKey: 'mole', amount: 1 }]),
    /Station not found/
  );
  await assert.rejects(
    startBuildingUpgrade(stationId, 'shipyard', otherUserId),
    /Station not found/
  );
});

test('initial station creation cannot bypass colonization', async () => {
  await assert.rejects(createStation(userId, { name: 'Free second station' }), /already has/);
});

test('station resources are scoped to the owner and active station', async () => {
  assert.equal((await getStationResources(userId, stationId)).carbon, 250);
  await assert.rejects(getStationResources(randomUUID(), stationId), /Station not found/);
});

test('delivery rates only count completed mining returns', async () => {
  const db = getDb();
  const [fleet] = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
  const now = new Date();
  await db.insert(spacecraftTrips).values([
    {
      stationSpacecraftId: fleet!.id,
      groupSize: 1,
      fromType: 'asteroid',
      fromId: randomUUID(),
      toType: 'station',
      toId: stationId,
      departedAt: now,
      arrivesAt: now,
      purpose: 'mining_return',
      cargoManifest: { carbon: 7 },
      status: 'arrived',
    },
    {
      stationSpacecraftId: fleet!.id,
      groupSize: 1,
      fromType: 'station',
      fromId: randomUUID(),
      toType: 'station',
      toId: stationId,
      departedAt: now,
      arrivesAt: now,
      purpose: 'combat_return',
      cargoManifest: { carbon: 11 },
      status: 'arrived',
    },
  ]);

  assert.equal((await getDeliveredResourceRates(userId, stationId)).carbon, 7);
});

test('parallel building upgrades deduct resources and start work once', async () => {
  const costs = calculateBuildingUpgradeCost('shipyard', 2);
  await setResources(Object.fromEntries(costs.map((cost) => [cost.resourceKey, cost.amount])));

  const results = await Promise.allSettled([
    startBuildingUpgrade(stationId, 'shipyard', userId),
    startBuildingUpgrade(stationId, 'shipyard', userId),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);

  const resources = await getDb()
    .select()
    .from(stationResources)
    .where(eq(stationResources.stationId, stationId));
  assert.ok(resources.every((resource) => resource.amount === 0));
});

test('concurrent payments never overdraw a resource and leave nothing paid on failure', async () => {
  await setResources({ carbon: 1_000, titanium: 100 });
  const costs = { carbon: 600, titanium: 100 };
  const results = await Promise.allSettled(
    [0, 1].map(() =>
      getDb().transaction(async (tx) => {
        const short = await payStationCosts(tx, stationId, costs);
        if (short) throw new Error(`Insufficient ${short.resourceKey}`);
      })
    )
  );
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(
    Object.fromEntries(
      (
        await getDb()
          .select()
          .from(stationResources)
          .where(eq(stationResources.stationId, stationId))
      ).map((row) => [row.resourceKey, row.amount])
    ),
    { carbon: 400, titanium: 0 }
  );
});

test('Warehouse is a playable upgrade with active protection', async () => {
  // The parallel upgrade test above still holds the base build slot.
  await grantResearch(userId, { parallel_construction: 1 });
  const costs = calculateBuildingUpgradeCost('warehouse', 2);
  await setResources(Object.fromEntries(costs.map((cost) => [cost.resourceKey, cost.amount])));
  const building = await startBuildingUpgrade(stationId, 'warehouse', userId);
  assert.equal(building.definition.key, 'warehouse');
  assert.equal(building.isUpgrading, true);
});

test('parallel spacecraft orders cannot spend the same resources twice', async () => {
  const db = getDb();
  await db
    .update(stationBuildings)
    .set({ upgradeEndsAt: null })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'shipyard'))
    );
  const mole = spacecrafts.find((spacecraft) => spacecraft.key === 'mole')!;
  await setResources(Object.fromEntries(mole.costs.map((cost) => [cost.resourceKey, cost.amount])));

  const results = await Promise.allSettled([
    buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }]),
    buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }]),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);

  const orders = await db
    .select({ id: spacecraftBuildOrders.id })
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  assert.equal(orders.length, 1);
});

test('shipyard unlocks list research-locked spacecraft with their blockers', async () => {
  const db = getDb();
  await db
    .update(stationBuildings)
    .set({ level: 5 })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'shipyard'))
    );

  const titanOf = async () =>
    (await getStationSpacecrafts(stationId)).find((entry) => entry.definition.key === 'titan');
  const locked = await titanOf();
  assert.deepEqual(
    { amount: locked?.amount, lockedAmount: locked?.lockedAmount },
    { amount: 0, lockedAmount: 0 }
  );
  assert.ok(locked?.blockers.some((blocker) => blocker.type === 'research'));

  await grantResearch(userId, { extraction_algorithms: 4, cargo_compression: 3 });
  assert.deepEqual((await titanOf())?.blockers, []);
  await db.delete(userResearch).where(eq(userResearch.userId, userId));
});

test('Laboratory research spends resources, fills one slot and refunds on cancel', async () => {
  const db = getDb();
  const stock = { carbon: 1_000, titanium: 1_000, hydrogenium: 1_000 };
  await setResources(stock);
  const resources = async () =>
    Object.fromEntries(
      (
        await db.select().from(stationResources).where(eq(stationResources.stationId, stationId))
      ).map((row) => [row.resourceKey, row.amount])
    );

  await startResearch(userId, stationId, 'extraction_algorithms');
  await assert.rejects(
    startResearch(userId, stationId, 'extraction_algorithms'),
    /already running/
  );
  await assert.rejects(
    startResearch(userId, stationId, 'cargo_compression'),
    /No free research slot/
  );
  assert.notDeepEqual(await resources(), stock);

  await cancelResearch(userId, 'extraction_algorithms', creditStationResources);
  assert.deepEqual(await resources(), stock);
  await assert.rejects(
    cancelResearch(userId, 'extraction_algorithms', creditStationResources),
    /not running/
  );

  await startResearch(userId, stationId, 'extraction_algorithms');
  const [project] = await db.select().from(userResearch).where(eq(userResearch.userId, userId));
  await completeDueResearch(new Date(project!.completesAt!.getTime() + 1), {
    credit: creditStationResources,
  });
  const state = await getResearchState(userId);
  assert.equal(
    state.technologies.find((tech) => tech.definition.key === 'extraction_algorithms')?.level,
    1
  );
  await db.delete(userResearch).where(eq(userResearch.userId, userId));
});

test('Fabrication Lines shortens ship construction on top of the shipyard bonus', async () => {
  const db = getDb();
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await setResources({ carbon: 1_000, titanium: 1_000, hydrogenium: 1_000 });
  await grantResearch(userId, { fabrication_lines: 2 });

  const startedAt = Date.now();
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }]);
  const [order] = await db
    .select()
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  const shipyardBonus =
    calculateBuildingEffect('shipyard', 5).find(
      (effect) => effect.type === 'spacecraft_production_bonus'
    )?.value ?? 0;
  const expected = Math.ceil(60 * (1 - (shipyardBonus + 6) / 100)) * 1000;
  assert.ok(order);
  assert.ok(Math.abs(order.endsAt.getTime() - startedAt - expected) < 1_500);
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db.delete(userResearch).where(eq(userResearch.userId, userId));
});

test('research levels expose their canonical server-side multipliers', async () => {
  const db = getDb();
  await grantResearch(userId, {
    extraction_algorithms: 2,
    cargo_compression: 2,
    ion_propulsion: 2,
  });

  const modifiers = await getStationResearchModifiers(db, stationId);
  assert.ok(Math.abs(100 * modifiers.miningRate - 110) < 1e-9);
  assert.ok(Math.abs(100 * modifiers.cargo - 110) < 1e-9);

  const arrival = await applyTravelSpeed(db, stationId, new Date(100_000), new Date(0));
  assert.equal(arrival.getTime(), Math.round(100_000 / 1.1));

  const startedAt = Date.now();
  const construction = applyConstructionSpeed(
    10,
    1,
    new Date(startedAt + 100_000),
    new Date(startedAt)
  );
  assert.equal(construction.getTime() - startedAt, 90_000);
  // Core level 20 adds 38% on top of the research's 10%.
  const coreArrival = applyConstructionSpeed(
    10,
    20,
    new Date(startedAt + 100_000),
    new Date(startedAt)
  );
  assert.equal(coreArrival.getTime() - startedAt, 52_000);

  await db.delete(userResearch).where(eq(userResearch.userId, userId));
});

test('scanner visibility uses the authenticated users station building effect', async () => {
  assert.equal((await getUserScannerCoverages(userId))[0]?.range, 1_000);
});

test('weighted fleet and queue crew cannot exceed hangar capacity concurrently', async () => {
  const db = getDb();
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db
    .update(stationSpacecrafts)
    .set({ amount: 0, lockedAmount: 0 })
    .where(eq(stationSpacecrafts.stationId, stationId));
  await db
    .update(stationSpacecrafts)
    .set({ amount: 7 })
    .where(
      and(eq(stationSpacecrafts.stationId, stationId), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );
  await db
    .insert(stationSpacecrafts)
    .values({ stationId, spacecraftKey: 'collector', amount: 0, lockedAmount: 0 })
    .onConflictDoNothing();
  await db.insert(spacecraftBuildOrders).values({
    stationId,
    spacecraftKey: 'collector',
    amount: 2,
    orderedAmount: 2,
    unitCost: [],
    nextAt: new Date(Date.now() + 60_000),
    endsAt: new Date(Date.now() + 60_000),
  });
  await setTestResources(stationId, 100_000);

  assert.deepEqual(await getStationHangar(stationId), { capacity: 20, used: 18 });

  const results = await Promise.allSettled([
    buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }]),
    buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }]),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.deepEqual(await getStationHangar(stationId), { capacity: 20, used: 20 });

  const completedAt = new Date();
  await db
    .update(spacecraftBuildOrders)
    .set({ nextAt: completedAt, endsAt: completedAt })
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  await runWorldTick(completedAt);
  assert.deepEqual(await getStationHangar(stationId), { capacity: 20, used: 20 });
});

test('parallel station creation claims different spawn slots atomically', async () => {
  const db = getDb();
  const suffix = randomUUID();
  const usersToCreate = [randomUUID(), randomUUID()];
  createdUserIds.push(...usersToCreate);
  await db.insert(users).values(
    usersToCreate.map((id, index) => ({
      id,
      username: `spawn-${index}-${suffix}`,
      email: `spawn-${index}-${suffix}@example.test`,
      passwordHash: 'not-used',
    }))
  );
  const slotIndex = 1_000_000 + Math.floor(Math.random() * 100_000);
  await db.insert(spawnSlots).values([
    { sectorId, slotIndex, x: slotIndex, y: 0 },
    { sectorId, slotIndex: slotIndex + 1, x: slotIndex + 1, y: 0 },
  ]);

  const created = await Promise.all([
    createStation(usersToCreate[0]!, { name: 'One', sectorId }),
    createStation(usersToCreate[1]!, { name: 'Two', sectorId }),
  ]);
  assert.equal(new Set(created.map((station) => `${station.x}:${station.y}`)).size, 2);
});

test('a second API process skips the world tick while another one runs it', async () => {
  let skipped: unknown = 'not run';
  await withExclusiveLock('world-tick', async () => {
    skipped = await runExclusiveWorldTick();
  });
  assert.equal(skipped, undefined);
  assert.ok(await runExclusiveWorldTick());
});
