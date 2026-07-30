import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { calculateBuildingUpgradeCost, spacecrafts } from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import { asteroids } from '../../src/lib/db/schema/asteroids.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationResearch } from '../../src/lib/db/schema/station-research.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { users } from '../../src/lib/db/schema/users.js';
import { seedStationBuildings, startBuildingUpgrade } from '../../src/services/building.service.js';
import {
  buildSpacecrafts,
  getStationHangar,
  getStationSpacecrafts,
  seedStationSpacecrafts,
} from '../../src/services/spacecraft.service.js';
import { createStation } from '../../src/services/station.service.js';
import {
  getDeliveredResourceRates,
  getStationResources,
  seedStationResources,
} from '../../src/services/station-resource.service.js';
import { getUserScannerCoverages } from '../../src/services/scanner-visibility.service.js';
import {
  completeDueResearch,
  getResearchState,
  startResearch,
} from '../../src/services/research.service.js';
import { runSimulationTick } from '../../src/services/simulation.service.js';
import {
  applyGridOptimization,
  applyVectorNavigation,
  effectiveAttackPower,
  effectiveCargoCapacity,
  effectiveMiningRate,
} from '../../src/services/research-effects.js';

const userId = randomUUID();
const stationId = randomUUID();
const sectorId = randomUUID();
const createdStationIds: string[] = [];
const createdUserIds: string[] = [];
const testSlotIds: string[] = [];

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
  const db = getDb();
  const allStationIds = [stationId, ...createdStationIds];
  await db.delete(stationResearch).where(inArray(stationResearch.stationId, allStationIds));
  await db
    .delete(spacecraftBuildOrders)
    .where(inArray(spacecraftBuildOrders.stationId, allStationIds));
  await db.delete(stationResources).where(inArray(stationResources.stationId, allStationIds));
  await db.delete(stationSpacecrafts).where(inArray(stationSpacecrafts.stationId, allStationIds));
  await db.delete(stationBuildings).where(inArray(stationBuildings.stationId, allStationIds));
  if (createdStationIds.length) {
    await db
      .update(spawnSlots)
      .set({ stationId: null })
      .where(inArray(spawnSlots.stationId, createdStationIds));
  }
  await db.delete(stations).where(inArray(stations.id, allStationIds));
  await db.delete(asteroids).where(eq(asteroids.sectorId, sectorId));
  if (testSlotIds.length) await db.delete(spawnSlots).where(inArray(spawnSlots.id, testSlotIds));
  await db.delete(users).where(inArray(users.id, [userId, ...createdUserIds]));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await closeDb();
});

async function setResources(amounts: Record<string, number>) {
  const db = getDb();
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db
    .insert(stationResources)
    .values(
      Object.entries(amounts).map(([resourceKey, amount]) => ({ stationId, resourceKey, amount }))
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

test('Warehouse is a playable upgrade with active protection', async () => {
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

test('shipyard unlocks expose buildable spacecraft without an existing fleet row', async () => {
  const db = getDb();
  await db
    .update(stationBuildings)
    .set({ level: 5 })
    .where(
      and(eq(stationBuildings.stationId, stationId), eq(stationBuildings.buildingKey, 'shipyard'))
    );

  const fleet = await getStationSpacecrafts(stationId);
  const titan = fleet.find((entry) => entry.definition.key === 'titan');
  assert.deepEqual(
    { amount: titan?.amount, lockedAmount: titan?.lockedAmount },
    { amount: 0, lockedAmount: 0 }
  );
  assert.ok(fleet.some((entry) => entry.definition.key === 'merlin'));
  assert.ok(fleet.some((entry) => entry.definition.key === 'collector'));
});

test('Laboratory research spends normal resources and accelerates ship construction', async () => {
  const db = getDb();
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await setResources({ carbon: 1_000, titanium: 1_000, hydrogenium: 1_000 });

  await startResearch(stationId, userId, 'automated_shipyard');
  await assert.rejects(
    startResearch(stationId, userId, 'automated_shipyard'),
    /Research already started/
  );
  const [project] = await db
    .select()
    .from(stationResearch)
    .where(eq(stationResearch.stationId, stationId));
  assert.equal((await getResearchState(stationId, userId)).used, 5);
  await completeDueResearch(new Date(project!.completesAt.getTime() + 1));
  assert.equal((await getResearchState(stationId, userId)).technologies[0]?.status, 'completed');

  const startedAt = Date.now();
  await buildSpacecrafts(stationId, userId, [{ spacecraftKey: 'mole', amount: 1 }]);
  const [order] = await db
    .select()
    .from(spacecraftBuildOrders)
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  assert.ok(order);
  assert.ok(order.endsAt.getTime() - startedAt <= 53_500);
});

test('all six research foundations expose their canonical server-side multipliers', async () => {
  const db = getDb();
  await db.delete(stationResearch).where(eq(stationResearch.stationId, stationId));
  const now = new Date();
  await db.insert(stationResearch).values(
    [
      'automated_shipyard',
      'extraction_algorithms',
      'modular_cargo_frames',
      'vector_navigation',
      'combat_analytics',
      'station_grid_optimization',
    ].map((technologyKey) => ({
      stationId,
      technologyKey,
      status: 'completed' as const,
      completesAt: now,
      completedAt: now,
    }))
  );

  assert.ok(Math.abs((await effectiveMiningRate(db, stationId, 100)) - 110) < 1e-9);
  assert.ok(Math.abs((await effectiveCargoCapacity(db, stationId, 100, 'miner')) - 110) < 1e-9);
  assert.ok(Math.abs((await effectiveCargoCapacity(db, stationId, 100, 'salvager')) - 110) < 1e-9);
  assert.ok(Math.abs((await effectiveAttackPower(db, stationId, 100)) - 110) < 1e-9);

  const departedAt = new Date(0);
  const vectorArrival = await applyVectorNavigation(db, stationId, new Date(100_000), departedAt);
  assert.equal(vectorArrival.getTime(), 90_000);

  const gridStartedAt = Date.now();
  const gridArrival = applyGridOptimization(
    true,
    new Date(gridStartedAt + 100_000),
    new Date(gridStartedAt)
  );
  assert.equal(gridArrival.getTime() - gridStartedAt, 90_000);

  await db.delete(stationResearch).where(eq(stationResearch.stationId, stationId));
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
    endsAt: new Date(Date.now() + 60_000),
  });
  await db
    .update(stationResources)
    .set({ amount: 100_000 })
    .where(eq(stationResources.stationId, stationId));

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
    .set({ endsAt: completedAt })
    .where(eq(spacecraftBuildOrders.stationId, stationId));
  await runSimulationTick(completedAt);
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
  const slots = await db
    .insert(spawnSlots)
    .values([
      { sectorId, slotIndex, x: slotIndex, y: 0 },
      { sectorId, slotIndex: slotIndex + 1, x: slotIndex + 1, y: 0 },
    ])
    .returning({ id: spawnSlots.id });
  testSlotIds.push(...slots.map((slot) => slot.id));

  const created = await Promise.all([
    createStation(usersToCreate[0]!, { name: 'One', sectorId }),
    createStation(usersToCreate[1]!, { name: 'Two', sectorId }),
  ]);
  createdStationIds.push(...created.map((station) => station.id));
  assert.equal(new Set(created.map((station) => `${station.x}:${station.y}`)).size, 2);
});
