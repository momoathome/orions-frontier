import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../src/lib/db/index.js';
import { runMigrations } from '../src/lib/db/migrate.js';
import { asteroids, asteroidAssignments, asteroidVeins } from '../src/lib/db/schema/asteroids.js';
import { botControllers } from '../src/lib/db/schema/bot-controllers.js';
import { buildingDefinitions } from '../src/lib/db/schema/building-definitions.js';
import { spacecraftBuildOrders } from '../src/lib/db/schema/spacecraft-build-orders.js';
import { spacecraftDefinitions } from '../src/lib/db/schema/spacecraft-definitions.js';
import { spacecraftTrips } from '../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../src/lib/db/schema/stations.js';
import { users } from '../src/lib/db/schema/users.js';
import { sectors } from '../src/lib/db/schema/sectors.js';
import { spawnSlots } from '../src/lib/db/schema/spawn-slots.js';
import { seedBuildingDefinitions, seedSpacecraftDefinitions } from '../src/lib/seed.js';
import { runBotDecisionTick } from '../src/services/bot/bot.service.js';
import { loadEconomicBotState } from '../src/services/bot/bot-state.service.js';
import { seedStationBuildings } from '../src/services/building.service.js';
import { runSimulationTick } from '../src/services/simulation.service.js';
import { seedStationResources } from '../src/services/station-resource.service.js';
import { seedStationSpacecrafts } from '../src/services/spacecraft.service.js';
import { settleTripArrival } from '../src/services/transport/trip-arrivals.service.js';
import { getVisibleChunkStations, getVisibleWorldTrips } from '../src/services/world.service.js';

const userId = randomUUID();
const stationId = randomUUID();
const asteroidIds = [randomUUID(), randomUUID(), randomUUID()];
const testNow = new Date(Date.now() + 24 * 60 * 60 * 1_000);
let moleDefinitionId = '';
let titanDefinitionId = '';
let shipyardDefinitionId = '';
let sectorId = '';

before(async () => {
  await runMigrations();
  await initDb();
  await seedSpacecraftDefinitions();
  await seedBuildingDefinitions();
  const db = getDb();
  const suffix = randomUUID();

  await db.insert(users).values({
    id: userId,
    username: `bot-behavior-${suffix}`,
    email: `bot-behavior-${suffix}@example.test`,
    passwordHash: 'not-used',
  });
  sectorId = randomUUID();
  await db.insert(sectors).values({
    id: sectorId,
    sectorX: 300,
    sectorY: 300,
    role: 'frontier',
    seed: suffix,
  });
  await db
    .insert(stations)
    .values({ id: stationId, userId, sectorId, name: 'Behavior Bot', x: 0, y: 0 });
  await seedStationResources(stationId);
  await seedStationBuildings(stationId);
  await seedStationSpacecrafts(stationId);

  const definitions = await db
    .select({ id: spacecraftDefinitions.id, key: spacecraftDefinitions.key })
    .from(spacecraftDefinitions)
    .where(inArray(spacecraftDefinitions.key, ['mole', 'titan']));
  moleDefinitionId = definitions.find((definition) => definition.key === 'mole')!.id;
  titanDefinitionId = definitions.find((definition) => definition.key === 'titan')!.id;
  const [shipyard] = await db
    .select({ id: buildingDefinitions.id })
    .from(buildingDefinitions)
    .where(eq(buildingDefinitions.key, 'shipyard'));
  shipyardDefinitionId = shipyard!.id;

  await db.insert(asteroids).values({
    id: asteroidIds[0],
    x: 100,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    size: 'small',
    sectorId,
  });
  await db.insert(asteroidVeins).values({
    asteroidId: asteroidIds[0],
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 100,
  });
  await db.insert(botControllers).values({ userId, nextDecisionAt: testNow });
});

after(async () => {
  const db = getDb();
  const fleet = await db
    .select({ id: stationSpacecrafts.id })
    .from(stationSpacecrafts)
    .where(eq(stationSpacecrafts.stationId, stationId));
  if (fleet.length) {
    await db.delete(spacecraftTrips).where(
      inArray(
        spacecraftTrips.stationSpacecraftId,
        fleet.map((entry) => entry.id)
      )
    );
  }
  await db.delete(asteroidAssignments).where(eq(asteroidAssignments.stationId, stationId));
  await db.delete(asteroids).where(inArray(asteroids.id, asteroidIds));
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db.delete(botControllers).where(eq(botControllers.userId, userId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(spawnSlots).where(eq(spawnSlots.sectorId, sectorId));
  await db.delete(sectors).where(eq(sectors.id, sectorId));
  await db.delete(users).where(eq(users.id, userId));
  await closeDb();
});

async function setBotDue(now: Date): Promise<void> {
  await getDb()
    .update(botControllers)
    .set({ nextDecisionAt: now })
    .where(eq(botControllers.userId, userId));
}

test('bot state excludes asteroids outside scanner visibility', async () => {
  const db = getDb();
  await db.insert(asteroids).values({
    id: asteroidIds[2],
    x: 50,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    size: 'small',
    sectorId,
    hiddenLevel: 99,
  });
  await db.insert(asteroidVeins).values({
    asteroidId: asteroidIds[2],
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 1_000_000,
  });

  const state = await loadEconomicBotState(userId);

  assert.equal(
    state?.asteroids.some((asteroid) => asteroid.id === asteroidIds[2]),
    false
  );
});

test('parallel bot ticks create one normal mining assignment and delivery', async () => {
  const db = getDb();
  const [beforeResource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );

  await Promise.all([runBotDecisionTick(testNow), runBotDecisionTick(testNow)]);

  const assignments = await db
    .select()
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.stationId, stationId));
  assert.equal(assignments.length, 1);
  const [afterDecisionResource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  assert.equal(afterDecisionResource?.amount, beforeResource?.amount);

  const [outbound] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignments[0]!.id),
        eq(spacecraftTrips.purpose, 'mine'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(outbound);
  assert.equal(await settleTripArrival(outbound), true);
  const [returnTrip] = await db
    .select()
    .from(spacecraftTrips)
    .where(
      and(
        eq(spacecraftTrips.assignmentId, assignments[0]!.id),
        eq(spacecraftTrips.purpose, 'mining_return'),
        eq(spacecraftTrips.status, 'traveling')
      )
    );
  assert.ok(returnTrip);
  assert.equal(await settleTripArrival(returnTrip), true);

  const [deliveredResource] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  assert.equal(deliveredResource?.amount, (beforeResource?.amount ?? 0) + 100);
});

test('bot builds a Mole through the normal resource and build queue', async () => {
  const db = getDb();
  const now = new Date(testNow.getTime() + 2 * 60_000);
  await setBotDue(now);
  await db
    .update(stationSpacecrafts)
    .set({ lockedAmount: 1 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        eq(stationSpacecrafts.spacecraftDefinitionId, moleDefinitionId)
      )
    );
  const [beforeCarbon] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );

  await runBotDecisionTick(now);

  const orders = await db
    .select()
    .from(spacecraftBuildOrders)
    .where(
      and(
        eq(spacecraftBuildOrders.stationId, stationId),
        eq(spacecraftBuildOrders.spacecraftDefinitionId, moleDefinitionId)
      )
    );
  assert.equal(orders.length, 1);
  assert.equal(orders[0]!.amount, 1);
  const [afterCarbon] = await db
    .select({ amount: stationResources.amount })
    .from(stationResources)
    .where(
      and(eq(stationResources.stationId, stationId), eq(stationResources.resourceKey, 'carbon'))
    );
  assert.equal(afterCarbon?.amount, (beforeCarbon?.amount ?? 0) - 80);
});

test('bot upgrades Shipyard, builds Titan and prefers it for mining', async () => {
  const db = getDb();
  await db.delete(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId));
  await db
    .update(stationSpacecrafts)
    .set({ amount: 3, lockedAmount: 3 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, stationId),
        eq(stationSpacecrafts.spacecraftDefinitionId, moleDefinitionId)
      )
    );
  await db
    .update(stationResources)
    .set({ amount: 100_000 })
    .where(eq(stationResources.stationId, stationId));

  for (let level = 2; level <= 5; level += 1) {
    const now = new Date(testNow.getTime() + level * 10 * 60_000);
    await setBotDue(now);
    await runBotDecisionTick(now);
    const [building] = await db
      .select({ upgradeEndsAt: stationBuildings.upgradeEndsAt })
      .from(stationBuildings)
      .where(
        and(
          eq(stationBuildings.stationId, stationId),
          eq(stationBuildings.buildingDefinitionId, shipyardDefinitionId)
        )
      );
    assert.ok(building?.upgradeEndsAt);
    await runSimulationTick(new Date(building.upgradeEndsAt.getTime() + 1));
  }

  const titanBuildAt = new Date(testNow.getTime() + 60 * 60_000);
  await setBotDue(titanBuildAt);
  await runBotDecisionTick(titanBuildAt);
  const [titanOrder] = await db
    .select()
    .from(spacecraftBuildOrders)
    .where(
      and(
        eq(spacecraftBuildOrders.stationId, stationId),
        eq(spacecraftBuildOrders.spacecraftDefinitionId, titanDefinitionId)
      )
    );
  assert.ok(titanOrder);
  await runSimulationTick(new Date(titanOrder.endsAt.getTime() + 1));

  await db.insert(asteroids).values({
    id: asteroidIds[1],
    x: 200,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    size: 'medium',
    sectorId,
  });
  await db.insert(asteroidVeins).values({
    asteroidId: asteroidIds[1],
    veinType: 'primary',
    resourceKey: 'titanium',
    remainingAmount: 10_000,
  });
  const titanMineAt = new Date(testNow.getTime() + 70 * 60_000);
  await setBotDue(titanMineAt);
  await runBotDecisionTick(titanMineAt);

  const [assignment] = await db
    .select({ spacecraftDefinitionId: asteroidAssignments.spacecraftDefinitionId })
    .from(asteroidAssignments)
    .where(
      and(
        eq(asteroidAssignments.stationId, stationId),
        eq(asteroidAssignments.asteroidId, asteroidIds[1]!)
      )
    );
  assert.equal(assignment?.spacecraftDefinitionId, titanDefinitionId);
});

test('bot wait decision leaves the playable state unchanged', async () => {
  const db = getDb();
  const now = new Date(testNow.getTime() + 80 * 60_000);
  await setBotDue(now);
  const before = await Promise.all([
    db.select().from(stationResources).where(eq(stationResources.stationId, stationId)),
    db.select().from(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId)),
    db.select().from(stationBuildings).where(eq(stationBuildings.stationId, stationId)),
    db.select().from(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId)),
    db.select().from(asteroidAssignments).where(eq(asteroidAssignments.stationId, stationId)),
  ]);

  await runBotDecisionTick(now);

  const after = await Promise.all([
    db.select().from(stationResources).where(eq(stationResources.stationId, stationId)),
    db.select().from(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId)),
    db.select().from(stationBuildings).where(eq(stationBuildings.stationId, stationId)),
    db.select().from(spacecraftBuildOrders).where(eq(spacecraftBuildOrders.stationId, stationId)),
    db.select().from(asteroidAssignments).where(eq(asteroidAssignments.stationId, stationId)),
  ]);
  const [controller] = await db
    .select({ lastAction: botControllers.lastAction })
    .from(botControllers)
    .where(eq(botControllers.userId, userId));

  assert.deepEqual(after, before);
  assert.equal(controller?.lastAction, 'wait');
});

test('world projection exposes bot activity without private cargo or resources', async () => {
  const range = { minChunkX: -10, maxChunkX: 10, minChunkY: -10, maxChunkY: 10 };
  const visibleStations = await getVisibleChunkStations(range, userId);
  const station = visibleStations.find((entry) => entry.id === stationId);
  assert.deepEqual(
    { ownerType: station?.ownerType, isOwn: station?.isOwn },
    { ownerType: 'bot', isOwn: true }
  );

  const [activeTrip] = await getDb()
    .select({ id: spacecraftTrips.id })
    .from(spacecraftTrips)
    .innerJoin(stationSpacecrafts, eq(spacecraftTrips.stationSpacecraftId, stationSpacecrafts.id))
    .where(
      and(eq(stationSpacecrafts.stationId, stationId), eq(spacecraftTrips.status, 'traveling'))
    );
  assert.ok(activeTrip);
  const trips = await getVisibleWorldTrips(range, userId);
  const visibleTrip = trips.find((entry) => entry.id === activeTrip.id);
  assert.equal(visibleTrip?.ownerType, 'bot');
  assert.equal(visibleTrip?.groupSize, 1);
  assert.equal(visibleTrip ? 'cargoManifest' in visibleTrip : true, false);

  const foreignTrips = await getVisibleWorldTrips(range, randomUUID());
  assert.equal(foreignTrips.find((entry) => entry.id === activeTrip.id)?.groupSize, null);
});

test('an overdue bot decision survives a database reconnect', async () => {
  const dueAt = new Date(testNow.getTime() + 2 * 60 * 60_000);
  await setBotDue(dueAt);
  await closeDb();
  await initDb();

  await runBotDecisionTick(dueAt);

  const [controller] = await getDb()
    .select({
      nextDecisionAt: botControllers.nextDecisionAt,
      lastAction: botControllers.lastAction,
    })
    .from(botControllers)
    .where(eq(botControllers.userId, userId));
  assert.ok(controller?.nextDecisionAt.getTime() > dueAt.getTime());
  assert.ok(controller?.lastAction);
});
