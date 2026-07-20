import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { calculateBuildingUpgradeCost, spacecrafts } from '@orions-frontier/game-config';
import { closeDb, getDb, initDb } from '../src/lib/db/index.js';
import { runMigrations } from '../src/lib/db/migrate.js';
import { buildingDefinitions } from '../src/lib/db/schema/building-definitions.js';
import { spacecraftBuildOrders } from '../src/lib/db/schema/spacecraft-build-orders.js';
import { spawnSlots } from '../src/lib/db/schema/spawn-slots.js';
import { stationBuildings } from '../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../src/lib/db/schema/stations.js';
import { users } from '../src/lib/db/schema/users.js';
import { seedBuildingDefinitions, seedSpacecraftDefinitions } from '../src/lib/seed.js';
import { seedStationBuildings, startBuildingUpgrade } from '../src/services/building.service.js';
import {
  buildSpacecrafts,
  getStationSpacecrafts,
  seedStationSpacecrafts,
} from '../src/services/spacecraft.service.js';
import { createStation } from '../src/services/station.service.js';
import { getUserScannerStrength } from '../src/services/asteroid.service.js';

const userId = randomUUID();
const stationId = randomUUID();
const createdStationIds: string[] = [];
const createdUserIds: string[] = [];
const testSlotIds: string[] = [];

before(async () => {
  await runMigrations();
  await initDb();
  await seedSpacecraftDefinitions();
  await seedBuildingDefinitions();
  const db = getDb();
  const suffix = randomUUID();

  await db.insert(users).values({
    id: userId,
    username: `write-${suffix}`,
    email: `write-${suffix}@example.test`,
    passwordHash: 'not-used',
  });
  await db.insert(stations).values({ id: stationId, userId, name: 'Write Test', x: 0, y: 0 });
  await seedStationBuildings(stationId);
  await seedStationSpacecrafts(stationId);
});

after(async () => {
  const db = getDb();
  const allStationIds = [stationId, ...createdStationIds];
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
  if (testSlotIds.length) await db.delete(spawnSlots).where(inArray(spawnSlots.id, testSlotIds));
  await db.delete(users).where(inArray(users.id, [userId, ...createdUserIds]));
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

test('planned buildings cannot consume resources before their effects exist', async () => {
  await assert.rejects(
    startBuildingUpgrade(stationId, 'warehouse', userId),
    /warehouse is not available yet/
  );
});

test('parallel spacecraft orders cannot spend the same resources twice', async () => {
  const db = getDb();
  const shipyard = await db
    .select({ id: buildingDefinitions.id })
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, 'shipyard'));
  await db
    .update(stationBuildings)
    .set({ upgradeEndsAt: null })
    .where(
      and(
        eq(stationBuildings.stationId, stationId),
        eq(stationBuildings.buildingDefinitionId, shipyard[0]!.id)
      )
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
  const [shipyard] = await db
    .select({ id: buildingDefinitions.id })
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, 'shipyard'));
  await db
    .update(stationBuildings)
    .set({ level: 5 })
    .where(
      and(
        eq(stationBuildings.stationId, stationId),
        eq(stationBuildings.buildingDefinitionId, shipyard!.id)
      )
    );

  const fleet = await getStationSpacecrafts(stationId);
  const titan = fleet.find((entry) => entry.definition.key === 'titan');
  assert.deepEqual(
    { amount: titan?.amount, lockedAmount: titan?.lockedAmount },
    { amount: 0, lockedAmount: 0 }
  );
  assert.equal(
    fleet.some((entry) => entry.definition.role !== 'miner'),
    false
  );
});

test('scanner visibility uses the authenticated users building effect', async () => {
  assert.equal(await getUserScannerStrength(userId), 10);
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
      { slotIndex, x: slotIndex, y: 0 },
      { slotIndex: slotIndex + 1, x: slotIndex + 1, y: 0 },
    ])
    .returning({ id: spawnSlots.id });
  testSlotIds.push(...slots.map((slot) => slot.id));

  const created = await Promise.all([
    createStation(usersToCreate[0]!, { name: 'One' }),
    createStation(usersToCreate[1]!, { name: 'Two' }),
  ]);
  createdStationIds.push(...created.map((station) => station.id));
  assert.equal(new Set(created.map((station) => `${station.x}:${station.y}`)).size, 2);
});
