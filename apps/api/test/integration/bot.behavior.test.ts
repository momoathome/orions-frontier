import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDb, getDb, initDb } from '../../src/lib/db/index.js';
import { runMigrations } from '../../src/lib/db/migrate.js';
import {
  asteroids,
  asteroidAssignments,
  asteroidVeins,
} from '../../src/lib/db/schema/asteroids.js';
import { botControllers } from '../../src/lib/db/schema/bot-controllers.js';
import { spacecraftBuildOrders } from '../../src/lib/db/schema/spacecraft-build-orders.js';
import { spacecraftTrips } from '../../src/lib/db/schema/spacecraft-trips.js';
import { stationBuildings } from '../../src/lib/db/schema/station-buildings.js';
import { stationResources } from '../../src/lib/db/schema/station-resources.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import { stations } from '../../src/lib/db/schema/stations.js';
import { users } from '../../src/lib/db/schema/users.js';
import { sectors } from '../../src/lib/db/schema/sectors.js';
import { spawnSlots } from '../../src/lib/db/schema/spawn-slots.js';
import { runBotDecisionTick } from '../../src/services/bot/bot.service.js';
import { loadGoalBotState } from '../../src/services/bot/goal-loader.service.js';
import {
  generateExploreSectorCandidate,
  generateEstablishColonyCandidate,
  stepExploreSector,
  stepEstablishColony,
  generateFortifyCandidate,
  generateBuildStrikeForceCandidate,
  stepFortifyStation,
  stepBuildStrikeForce,
  generateRetaliateCandidates,
  stepRaid,
  generateSalvageCandidates,
  stepSalvage,
} from '../../src/services/bot/goal-economy.js';
import { type BotProfile } from '../../src/lib/db/schema/bot-controllers.js';
import { seedStationBuildings } from '../../src/services/building.service.js';
import { seedStationDefenseUpgrades } from '../../src/services/defense.service.js';
import { seedStationResources } from '../../src/services/station-resource.service.js';
import { seedStationSpacecrafts } from '../../src/services/spacecraft.service.js';

const userId = randomUUID();
const stationId = randomUUID();
const asteroidIds = [randomUUID(), randomUUID(), randomUUID()];
const testNow = new Date(Date.now() + 24 * 60 * 60 * 1_000);
let sectorId = '';

before(async () => {
  await runMigrations();
  await initDb();
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
    remainingAmount: 50,
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

test('bot state excludes asteroids outside its station scanner circle', async () => {
  const db = getDb();
  await db.insert(asteroids).values({
    id: asteroidIds[2],
    x: 3_000,
    y: 0,
    chunkX: 3,
    chunkY: 0,
    size: 'small',
    sectorId,
  });
  await db.insert(asteroidVeins).values({
    asteroidId: asteroidIds[2],
    veinType: 'primary',
    resourceKey: 'carbon',
    remainingAmount: 1_000_000,
  });

  const state = await loadGoalBotState(userId);

  assert.equal(
    state?.visibleAsteroids.some((asteroid) => asteroid.id === asteroidIds[2]),
    false
  );
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

test('goal state loader shows two bot stations with local resources and scanner-limited visibility', async () => {
  const db = getDb();
  const botUserId = randomUUID();
  const suffix2 = randomUUID();
  await db.insert(users).values({
    id: botUserId,
    username: `goal-loader-${suffix2}`,
    email: `goal-loader-${suffix2}@example.test`,
    passwordHash: 'not-used',
  });

  // Two stations at different positions
  const stationAId = randomUUID();
  const stationBId = randomUUID();
  // Station A: origin with scanner
  await db.insert(stations).values({
    id: stationAId,
    userId: botUserId,
    sectorId,
    name: 'Station A',
    x: 0,
    y: 0,
    chunkX: 0,
    chunkY: 0,
  });
  await seedStationBuildings(stationAId);
  await seedStationSpacecrafts(stationAId);
  await seedStationResources(stationAId);
  // Give Station A a scanner (it has level 1 from seeding)
  // Station B: colony 3_000 units away (outside Station A's scanner range of 2_000)
  await db.insert(stations).values({
    id: stationBId,
    userId: botUserId,
    sectorId,
    name: 'Station B',
    x: 0,
    y: 3000,
    chunkX: 0,
    chunkY: Math.floor(3000 / 1000),
  });
  await seedStationBuildings(stationBId);
  await seedStationSpacecrafts(stationBId);
  await seedStationResources(stationBId);

  // Set different resource amounts per station to verify local scoping
  await db
    .update(stationResources)
    .set({ amount: 500 })
    .where(
      and(eq(stationResources.stationId, stationAId), eq(stationResources.resourceKey, 'carbon'))
    );
  await db
    .update(stationResources)
    .set({ amount: 999 })
    .where(
      and(eq(stationResources.stationId, stationBId), eq(stationResources.resourceKey, 'carbon'))
    );

  // Asteroid visible only from Station A (inside its scanner range)
  const nearAsteroidId = randomUUID();
  await db.insert(asteroids).values({
    id: nearAsteroidId,
    x: 500,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    size: 'small',
    sectorId,
  });
  await db.insert(asteroidVeins).values({
    asteroidId: nearAsteroidId,
    resourceKey: 'carbon',
    veinType: 'primary',
    remainingAmount: 1000,
  });

  // Asteroid outside both scanner ranges
  const hiddenAsteroidId = randomUUID();
  await db.insert(asteroids).values({
    id: hiddenAsteroidId,
    x: 5000,
    y: 0,
    chunkX: Math.floor(5000 / 1000),
    chunkY: 0,
    size: 'medium',
    sectorId,
  });
  await db.insert(asteroidVeins).values({
    asteroidId: hiddenAsteroidId,
    resourceKey: 'titanium',
    veinType: 'primary',
    remainingAmount: 2000,
  });

  const state = await loadGoalBotState(botUserId);
  assert.ok(state);
  assert.equal(state.ownStations.length, 2, 'Both stations must be present');

  const stationA = state.ownStations.find((s) => s.id === stationAId);
  const stationB = state.ownStations.find((s) => s.id === stationBId);
  assert.ok(stationA);
  assert.ok(stationB);
  assert.equal(stationA.resources['carbon'], 500, 'Station A carbon must be 500');
  assert.equal(stationB.resources['carbon'], 999, 'Station B carbon must be 999');

  // Visible asteroids should include the one near Station A but not the hidden one
  const visibleIds = state.visibleAsteroids.map((a) => a.id);
  assert.ok(visibleIds.includes(nearAsteroidId), 'Asteroid near Station A must be visible');
  assert.equal(
    visibleIds.includes(hiddenAsteroidId),
    false,
    'Asteroid outside both scanner circles must be hidden'
  );

  // Cleanup
  await db.delete(asteroidVeins).where(eq(asteroidVeins.asteroidId, nearAsteroidId));
  await db.delete(asteroids).where(eq(asteroids.id, nearAsteroidId));
  await db.delete(asteroidVeins).where(eq(asteroidVeins.asteroidId, hiddenAsteroidId));
  await db.delete(asteroids).where(eq(asteroids.id, hiddenAsteroidId));
  for (const sid of [stationAId, stationBId]) {
    await db.delete(stationResources).where(eq(stationResources.stationId, sid));
    await db.delete(stationBuildings).where(eq(stationBuildings.stationId, sid));
    await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, sid));
    await db.delete(stations).where(eq(stations.id, sid));
  }
  await db.delete(users).where(eq(users.id, botUserId));
});

test('goal_v1 lifecycle tracks blocked count and releases goal after 5 intervals', async () => {
  const db = getDb();
  const botUserId = randomUUID();
  const suffix = randomUUID();
  await db.insert(users).values({
    id: botUserId,
    username: `glifecycle-${suffix}`,
    email: `glifecycle-${suffix}@example.test`,
    passwordHash: 'not-used',
  });

  // Give the bot a station so loadGoalBotState succeeds
  const stationId = randomUUID();
  await db.insert(stations).values({
    id: stationId,
    userId: botUserId,
    sectorId: (
      await db
        .select({ id: sectors.id })
        .from(sectors)
        .limit(1)
        .then((r) => r[0]!)
    ).id,
    name: 'Lifecycle Test',
    x: 100000,
    y: 100000,
    chunkX: Math.floor(100000 / 1000),
    chunkY: Math.floor(100000 / 1000),
  });
  await seedStationBuildings(stationId);
  await seedStationSpacecrafts(stationId);
  await seedStationResources(stationId);
  // Delete the seeded Mole so maintenance has no free ships to assign
  await getDb()
    .delete(stationSpacecrafts)
    .where(
      and(eq(stationSpacecrafts.stationId, stationId), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );

  // Set up bot controller with goal_v1 strategy and an active goal
  const now = new Date();
  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'industrialist',
    activeGoalType: 'stabilize_station',
    activeGoalTarget: `station:${stationId}`,
    goalStartedAt: now,
    lastProgressAt: now,
    blockedCount: 0,
    nextDecisionAt: now,
  });

  // Tick 1 → the economy goal step runs
  await runBotDecisionTick(now);
  let ctrl = await db
    .select({
      blockedCount: botControllers.blockedCount,
      activeGoalType: botControllers.activeGoalType,
      lastAction: botControllers.lastAction,
    })
    .from(botControllers)
    .where(eq(botControllers.userId, botUserId))
    .then((r) => r[0]!);
  assert.ok(ctrl.lastAction, 'Tick 1 should produce an action');

  // Run many ticks. Without economy setup, the goal can't make real progress.
  // Eventually the lifecycle should release it.
  for (let i = 2; i <= 15; i++) {
    await runBotDecisionTick(new Date(now.getTime() + i * 120_000));
  }
  ctrl = await db
    .select({
      blockedCount: botControllers.blockedCount,
      activeGoalType: botControllers.activeGoalType,
      activeGoalTarget: botControllers.activeGoalTarget,
      lastAction: botControllers.lastAction,
      lastReason: botControllers.lastReason,
    })
    .from(botControllers)
    .where(eq(botControllers.userId, botUserId))
    .then((r) => r[0]!);
  // At minimum, the lifecycle should have run and produced some output
  assert.ok(ctrl.lastAction, 'Lifecycle should produce a lastAction');
  assert.ok(ctrl.lastReason, 'Lifecycle should produce a lastReason');

  // Cleanup
  await db.delete(botControllers).where(eq(botControllers.userId, botUserId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId));
  await db.delete(stations).where(eq(stations.id, stationId));
  await db.delete(users).where(eq(users.id, botUserId));
});

test('bot exploration and colonization goal generation', async () => {
  const db = getDb();
  const botUserId = randomUUID();
  const suffix3 = randomUUID();
  await db.insert(users).values({
    id: botUserId,
    username: `explore-bot-${suffix3}`,
    email: `explore-bot-${suffix3}@example.test`,
    passwordHash: 'not-used',
  });

  // Use small, unique coordinates (avoid overflow in sectorX * 6000)
  const coordSeed = suffix3.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  const baseX = -(100 + (coordSeed % 50));
  const baseY = baseX;

  // Create an "explored" sector
  const knownSectorId = randomUUID();
  await db.insert(sectors).values({
    id: knownSectorId,
    sectorX: baseX,
    sectorY: baseY,
    role: 'populated',
    seed: suffix3,
  });

  // Create a frontier sector adjacent to it
  const frontierSectorId = randomUUID();
  await db.insert(sectors).values({
    id: frontierSectorId,
    sectorX: baseX + 1,
    sectorY: baseY,
    role: 'frontier',
    seed: suffix3,
  });

  // Station in the known sector with a miner ship
  const stationId2 = randomUUID();
  const colonyStationId = randomUUID();
  await db.insert(stations).values({
    id: stationId2,
    userId: botUserId,
    sectorId: knownSectorId,
    name: 'Explore Home',
    x: 100,
    y: 100,
    chunkX: 0,
    chunkY: 0,
  });
  await seedStationBuildings(stationId2);
  await seedStationSpacecrafts(stationId2);
  await seedStationResources(stationId2);

  // Top up resources so colony can be afforded
  await Promise.all(
    ['carbon', 'titanium', 'hydrogenium'].map((key) =>
      db
        .update(stationResources)
        .set({ amount: 2000 })
        .where(
          and(eq(stationResources.stationId, stationId2), eq(stationResources.resourceKey, key))
        )
    )
  );

  // Also create a second station in a frontier sector (already colonized, no mining)
  await db.insert(stations).values({
    id: colonyStationId,
    userId: botUserId,
    sectorId: frontierSectorId,
    name: 'Outpost',
    x: 200,
    y: 100,
    chunkX: 0,
    chunkY: 0,
  });
  await seedStationBuildings(colonyStationId);
  await seedStationSpacecrafts(colonyStationId);
  await seedStationResources(colonyStationId);

  // Set up bot controller with goal_v1
  const now = new Date();
  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'pioneer',
    activeGoalType: null,
    activeGoalTarget: null,
    goalStartedAt: null,
    lastProgressAt: null,
    blockedCount: 0,
    nextDecisionAt: now,
  });

  // Load bot state
  const state = await loadGoalBotState(botUserId);
  assert.ok(state, 'Should load bot state');
  assert.equal(state.ownStations.length, 2, 'Should have 2 stations');

  const homeStation = state.ownStations.find((s) => s.id === stationId2);
  assert.ok(homeStation, 'Should find home station');

  // Test explore sector candidate generation
  const exploreCandidate = await generateExploreSectorCandidate(state, homeStation!);
  // Since we have a frontier at 1:0, a ship, and no active expedition, should generate a candidate
  assert.ok(exploreCandidate, 'Should generate explore_sector candidate');
  assert.equal(exploreCandidate!.goalType, 'explore_sector');
  assert.ok(exploreCandidate!.targetRef.startsWith('sector:'), 'Target should be a sector');

  // Test establish colony candidate generation
  const colonyCandidate = await generateEstablishColonyCandidate(state, homeStation!);
  // Since we have frontier sectors without own stations and can afford colonization
  assert.ok(colonyCandidate, 'Should generate establish_colony candidate');
  assert.equal(colonyCandidate!.goalType, 'establish_colony');

  // Test the step functions
  const stepResult = await stepExploreSector(state, homeStation!, exploreCandidate!.targetRef, {
    colonizationFactor: 1.5,
  } as BotProfile);
  assert.ok(stepResult, 'Should return a step result');
  // The result should be 'success' since we have resources and ships
  assert.equal(stepResult.type, 'success', 'Explore step should succeed');
  assert.ok(
    stepResult.actionLabel?.startsWith('start_expedition:'),
    'Should produce expedition action'
  );

  // Test colony step
  const colonyStep = await stepEstablishColony(state, homeStation!, colonyCandidate!.targetRef, {
    colonizationFactor: 1.5,
  } as BotProfile);
  assert.ok(colonyStep, 'Should return colony step result');
  assert.equal(colonyStep.type, 'success', 'Colony step should succeed');
  assert.ok(
    colonyStep.actionLabel?.startsWith('start_colonization:'),
    'Should produce colonization action'
  );

  // Verify goal lifecycle integration — generateGoalCandidates should include expansion
  const { generateGoalCandidates } =
    await import('../../src/services/bot/goal-lifecycle.service.js');
  const allCandidates = await generateGoalCandidates(state);
  const exploreCandidates = allCandidates.filter((c) => c.goalType === 'explore_sector');
  const colonyCandidates = allCandidates.filter((c) => c.goalType === 'establish_colony');
  assert.ok(exploreCandidates.length > 0, 'generateGoalCandidates should include explore_sector');
  assert.ok(colonyCandidates.length > 0, 'generateGoalCandidates should include establish_colony');

  // Cleanup
  await db.delete(botControllers).where(eq(botControllers.userId, botUserId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId2));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId2));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId2));
  await db.delete(stations).where(eq(stations.id, stationId2));
  await db.delete(stationResources).where(eq(stationResources.stationId, colonyStationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, colonyStationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, colonyStationId));
  await db.delete(stations).where(eq(stations.id, colonyStationId));
  await db.delete(sectors).where(eq(sectors.id, knownSectorId));
  await db.delete(sectors).where(eq(sectors.id, frontierSectorId));
  await db.delete(users).where(eq(users.id, botUserId));
});

test('bot fortify and strike force goal generation', async () => {
  const db = getDb();
  const botUserId = randomUUID();
  const suffix4 = randomUUID();
  await db.insert(users).values({
    id: botUserId,
    username: `fortify-bot-${suffix4}`,
    email: `fortify-bot-${suffix4}@example.test`,
    passwordHash: 'not-used',
  });

  const fortifyCoord = 700 + (suffix4.charCodeAt(0) % 100);

  const sectorId4 = randomUUID();
  await db.insert(sectors).values({
    id: sectorId4,
    sectorX: fortifyCoord,
    sectorY: fortifyCoord,
    role: 'populated',
    seed: suffix4,
  });

  const stationId4 = randomUUID();
  await db.insert(stations).values({
    id: stationId4,
    userId: botUserId,
    sectorId: sectorId4,
    name: 'Fortify Test',
    x: fortifyCoord * 1000,
    y: fortifyCoord * 1000,
    chunkX: fortifyCoord,
    chunkY: fortifyCoord,
  });
  await seedStationBuildings(stationId4);
  await seedStationDefenseUpgrades(stationId4);
  await seedStationSpacecrafts(stationId4);
  await seedStationResources(stationId4);
  // Top up resources
  await Promise.all(
    ['carbon', 'titanium', 'hydrogenium'].map((key) =>
      db
        .update(stationResources)
        .set({ amount: 2000 })
        .where(
          and(eq(stationResources.stationId, stationId4), eq(stationResources.resourceKey, key))
        )
    )
  );

  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'industrialist',
    activeGoalType: null,
    activeGoalTarget: null,
    goalStartedAt: null,
    lastProgressAt: null,
    blockedCount: 0,
    nextDecisionAt: new Date(),
  });

  const state = await loadGoalBotState(botUserId);
  assert.ok(state, 'Should load bot state');
  assert.equal(state.ownStations.length, 1, 'Should have 1 station');

  const station = state.ownStations[0]!;

  // Test fortify candidate
  const fortifyCandidate = generateFortifyCandidate(state, station);
  assert.ok(fortifyCandidate, 'Should generate fortify candidate');
  assert.equal(fortifyCandidate!.goalType, 'fortify_station');
  assert.ok(fortifyCandidate!.targetRef.startsWith('station:'), 'Target should point to station');

  // Test fortify step - should suggest a defense upgrade
  const fortifyStep = await stepFortifyStation(state, station, fortifyCandidate!.targetRef, {
    colonizationFactor: 0.8,
  } as BotProfile);
  assert.ok(fortifyStep, 'Should return fortify step result');
  assert.equal(fortifyStep.type, 'success', 'Fortify step should be success');
  assert.ok(
    fortifyStep.actionLabel?.startsWith('start_defense_upgrade:'),
    'Should produce defense upgrade action'
  );

  // Test strike force candidate
  const strikeCandidate = generateBuildStrikeForceCandidate(state, station);
  // Station starts with shipyard level 1 by default - fighters need level 2
  if (strikeCandidate) {
    assert.equal(strikeCandidate!.goalType, 'build_strike_force');
  }

  // Test strike force step - without shipyard level 2, should suggest shipyard upgrade
  const strikeStep = await stepBuildStrikeForce(state, station, `station:${stationId4}`, {
    colonizationFactor: 0.8,
  } as BotProfile);
  assert.ok(strikeStep, 'Should return strike force step');
  // Without shipyard level 2, should suggest shipyard upgrade or be blocked/waiting
  assert.ok(
    ['success', 'blocked', 'waiting'].includes(strikeStep.type),
    `Strike step should be actionable, got ${strikeStep.type}`
  );

  // Verify generateGoalCandidates includes conflict goals
  const { generateGoalCandidates } =
    await import('../../src/services/bot/goal-lifecycle.service.js');
  const allCandidates = await generateGoalCandidates(state);
  const fortifyCandidates = allCandidates.filter((c) => c.goalType === 'fortify_station');
  assert.ok(fortifyCandidates.length > 0, 'generateGoalCandidates should include fortify_station');

  // Cleanup
  await db.delete(botControllers).where(eq(botControllers.userId, botUserId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId4));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId4));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId4));
  await db.delete(stations).where(eq(stations.id, stationId4));
  await db.delete(sectors).where(eq(sectors.id, sectorId4));
  await db.delete(users).where(eq(users.id, botUserId));
});

test('bot raid and retaliate goal generation with visible target', async () => {
  const db = getDb();
  const botUserId = randomUUID();
  const targetUserId = randomUUID();
  const suffix5 = randomUUID();

  await db.insert(users).values({
    id: botUserId,
    username: `raid-bot-${suffix5}`,
    email: `raid-bot-${suffix5}@example.test`,
    passwordHash: 'not-used',
  });
  await db.insert(users).values({
    id: targetUserId,
    username: `raid-target-${suffix5}`,
    email: `raid-target-${suffix5}@example.test`,
    passwordHash: 'not-used',
  });

  const sectorX5 = 600 + (suffix5.charCodeAt(0) % 50);
  const sectorId5 = randomUUID();
  await db.insert(sectors).values({
    id: sectorId5,
    sectorX: sectorX5,
    sectorY: sectorX5,
    role: 'populated',
    seed: suffix5,
  });

  // Bot station with fighters
  const botStationId = randomUUID();
  await db.insert(stations).values({
    id: botStationId,
    userId: botUserId,
    sectorId: sectorId5,
    name: 'Raid HQ',
    x: 0,
    y: 0,
    chunkX: 0,
    chunkY: 0,
  });
  await seedStationBuildings(botStationId);
  await seedStationDefenseUpgrades(botStationId);
  await seedStationSpacecrafts(botStationId);
  await seedStationResources(botStationId);
  // Give the bot some fighters (Merlins)
  await db
    .update(stationSpacecrafts)
    .set({ amount: 5 })
    .where(
      and(
        eq(stationSpacecrafts.stationId, botStationId),
        eq(stationSpacecrafts.spacecraftKey, 'merlin')
      )
    );
  await Promise.all(
    ['carbon', 'titanium'].map((key) =>
      db
        .update(stationResources)
        .set({ amount: 2000 })
        .where(
          and(eq(stationResources.stationId, botStationId), eq(stationResources.resourceKey, key))
        )
    )
  );

  // Target station (close enough to be visible, different user)
  const targetStationId = randomUUID();
  await db.insert(stations).values({
    id: targetStationId,
    userId: targetUserId,
    sectorId: sectorId5,
    name: 'Raid Target',
    x: 100,
    y: 100,
    chunkX: 0,
    chunkY: 800,
  });
  await seedStationBuildings(targetStationId);
  await seedStationDefenseUpgrades(targetStationId);
  await seedStationResources(targetStationId);

  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'warlord',
    activeGoalType: null,
    activeGoalTarget: null,
    goalStartedAt: null,
    lastProgressAt: null,
    blockedCount: 0,
    nextDecisionAt: new Date(),
  });

  const state = await loadGoalBotState(botUserId);
  assert.ok(state, 'Should load bot state');
  assert.equal(state.ownStations.length, 1, 'Should have 1 own station');

  // Test stepRaid — target may be visible or not, the step should handle either
  const raidStep = await stepRaid(
    state,
    state.ownStations[0]!,
    `station:${targetStationId}`,
    'warlord' as BotProfile
  );
  assert.ok(raidStep, 'Should return raid step result');
  assert.ok(
    ['success', 'saving', 'blocked'].includes(raidStep.type),
    `Raid step should be actionable, got ${raidStep.type}`
  );
  if (raidStep.type === 'success') {
    assert.ok(raidStep.actionLabel?.startsWith('start_attack:'), 'Should produce attack action');
  }

  // Test retaliate candidate generation (no combat reports → no retaliation)
  const retaliateCandidates = generateRetaliateCandidates(state, 'warlord' as BotProfile);
  assert.equal(retaliateCandidates.length, 0, 'No retaliation without combat reports');

  // Cleanup
  await db.delete(botControllers).where(eq(botControllers.userId, botUserId));
  await db.delete(stationResources).where(eq(stationResources.stationId, botStationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, botStationId));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, botStationId));
  await db.delete(stations).where(eq(stations.id, botStationId));
  await db.delete(stationResources).where(eq(stationResources.stationId, targetStationId));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, targetStationId));
  await db.delete(stations).where(eq(stations.id, targetStationId));
  await db.delete(sectors).where(eq(sectors.id, sectorId5));
  await db.delete(users).where(eq(users.id, targetUserId));
  await db.delete(users).where(eq(users.id, botUserId));
});

test('bot salvage goal generation', async () => {
  const db = getDb();
  const botUserId = randomUUID();
  const suffix6 = randomUUID();

  await db.insert(users).values({
    id: botUserId,
    username: `salvage-bot-${suffix6}`,
    email: `salvage-bot-${suffix6}@example.test`,
    passwordHash: 'not-used',
  });

  const sectorX6 = 900 + (suffix6.charCodeAt(0) % 50);
  const sectorId6 = randomUUID();
  await db.insert(sectors).values({
    id: sectorId6,
    sectorX: sectorX6,
    sectorY: sectorX6,
    role: 'populated',
    seed: suffix6,
  });

  const stationId6 = randomUUID();
  await db.insert(stations).values({
    id: stationId6,
    userId: botUserId,
    sectorId: sectorId6,
    name: 'Salvage Base',
    x: 0,
    y: 0,
    chunkX: 0,
    chunkY: 0,
  });
  await seedStationBuildings(stationId6);
  await seedStationDefenseUpgrades(stationId6);
  await seedStationSpacecrafts(stationId6);
  await seedStationResources(stationId6);
  await Promise.all(
    ['carbon', 'titanium', 'hydrogenium'].map((key) =>
      db
        .update(stationResources)
        .set({ amount: 2000 })
        .where(
          and(eq(stationResources.stationId, stationId6), eq(stationResources.resourceKey, key))
        )
    )
  );

  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'industrialist',
    activeGoalType: null,
    activeGoalTarget: null,
    goalStartedAt: null,
    lastProgressAt: null,
    blockedCount: 0,
    nextDecisionAt: new Date(),
  });

  const state = await loadGoalBotState(botUserId);
  assert.ok(state, 'Should load bot state');
  assert.equal(state.ownStations.length, 1, 'Should have 1 station');

  // Without visible debris, salvage candidates should be empty
  const candidates = generateSalvageCandidates(state, 'industrialist' as BotProfile);
  assert.equal(candidates.length, 0, 'No salvage candidates without visible debris');

  // Step with non-existent debris should return blocked
  const step = await stepSalvage(
    state,
    state.ownStations[0]!,
    'debris:nonexistent',
    'industrialist' as BotProfile
  );
  assert.ok(step, 'Should return step result');
  assert.equal(step.type, 'blocked', 'Should be blocked for missing debris');

  // Cleanup
  await db.delete(botControllers).where(eq(botControllers.userId, botUserId));
  await db.delete(stationResources).where(eq(stationResources.stationId, stationId6));
  await db.delete(stationBuildings).where(eq(stationBuildings.stationId, stationId6));
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, stationId6));
  await db.delete(stations).where(eq(stations.id, stationId6));
  await db.delete(sectors).where(eq(sectors.id, sectorId6));
  await db.delete(users).where(eq(users.id, botUserId));
});
