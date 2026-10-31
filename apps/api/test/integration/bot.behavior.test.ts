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
import { userResearch } from '../../src/lib/db/schema/user-research.js';
import { stationSpacecrafts } from '../../src/lib/db/schema/station-spacecrafts.js';
import {
  createTestSector,
  createTestStation,
  createTestUser,
  deleteTestData,
  grantResearch,
  setTestResources,
} from '../helpers/fixtures.js';
import { runBotDecisionTick } from '../../src/services/bot/bot.js';
import { loadGoalBotState } from '../../src/services/bot/goal-loader.js';
import {
  generateRaidCandidates,
  generateRetaliateCandidates,
  stepRaid,
} from '../../src/services/bot/goals/conflict.js';
import {
  generateExploreSectorCandidate,
  generateEstablishColonyCandidate,
  stepExploreSector,
  stepEstablishColony,
} from '../../src/services/bot/goals/expansion.js';
import {
  generateFortifyCandidate,
  generateBuildStrikeForceCandidate,
  stepFortifyStation,
  stepBuildStrikeForce,
} from '../../src/services/bot/goals/military.js';
import { generateSalvageCandidates, stepSalvage } from '../../src/services/bot/goals/salvage.js';
import { executeBotIntent } from '../../src/services/bot/intent.js';

const userId = randomUUID();
const stationId = randomUUID();
const asteroidIds = [randomUUID(), randomUUID(), randomUUID()] as const;
const testNow = new Date(Date.now() + 24 * 60 * 60 * 1_000);
let sectorId = '';

function uniqueSectorCoordinate(suffix: string, band: number): number {
  return band + (Number.parseInt(suffix.slice(0, 8), 16) % 100_000);
}

before(async () => {
  await runMigrations();
  await initDb();
  const db = getDb();
  await createTestUser({ id: userId });
  sectorId = (await createTestSector({ role: 'frontier' })).id;
  await createTestStation({ id: stationId, userId, sectorId });

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
  await deleteTestData({ userIds: [userId], sectorIds: [sectorId] });
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
  assert.ok(controller!.nextDecisionAt.getTime() > dueAt.getTime());
  assert.equal(controller?.lastAction, 'assign_miner');
  const assignments = await getDb()
    .select()
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.stationId, stationId));
  assert.equal(assignments.length, 1, 'the bot must persist one real mining assignment');
  const trips = await getDb()
    .select()
    .from(spacecraftTrips)
    .where(eq(spacecraftTrips.assignmentId, assignments[0]!.id));
  assert.equal(trips.length, 1, 'the normal mining service must create the outbound trip');
  const state = await loadGoalBotState(userId, dueAt);
  assert.equal(state?.ownStations[0]?.miningAssignments.length, 1);
  assert.equal(state.ownStations[0].trips.length, 1);
});

test('goal state loader shows two bot stations with local resources and scanner-limited visibility', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;

  // Station A: origin with scanner (level 1 from seeding)
  const stationAId = (await createTestStation({ userId: botUserId, sectorId })).id;
  // Station B: colony 3_000 units away (outside Station A's scanner range of 2_000)
  const stationBId = (await createTestStation({ userId: botUserId, sectorId, x: 0, y: 3000 })).id;

  // Set different resource amounts per station to verify local scoping
  await setTestResources(stationAId, { carbon: 500 });
  await setTestResources(stationBId, { carbon: 999 });

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
  assert.equal(stationA.resources.carbon, 500, 'Station A carbon must be 500');
  assert.equal(stationB.resources.carbon, 999, 'Station B carbon must be 999');

  // Visible asteroids should include the one near Station A but not the hidden one
  const visibleIds = state.visibleAsteroids.map((a) => a.id);
  assert.ok(visibleIds.includes(nearAsteroidId), 'Asteroid near Station A must be visible');
  assert.equal(
    visibleIds.includes(hiddenAsteroidId),
    false,
    'Asteroid outside both scanner circles must be hidden'
  );

  // Cleanup
  await db.delete(asteroids).where(inArray(asteroids.id, [nearAsteroidId, hiddenAsteroidId]));
  await deleteTestData({ userIds: [botUserId] });
});

test('typed economic intents execute through the authoritative domain services', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;
  const localStationId = (
    await createTestStation({ userId: botUserId, sectorId, x: 30_000, y: 30_000 })
  ).id;
  await setTestResources(localStationId, 10_000);
  // Building and defense upgrades share the build slots.
  await grantResearch(botUserId, { parallel_construction: 1 });
  const now = new Date();

  await executeBotIntent(
    botUserId,
    { type: 'build_spacecraft', stationId: localStationId, spacecraftKey: 'mole', amount: 1 },
    now
  );
  await executeBotIntent(
    botUserId,
    { type: 'upgrade_building', stationId: localStationId, buildingKey: 'warehouse' },
    now
  );
  await executeBotIntent(
    botUserId,
    {
      type: 'start_research',
      stationId: localStationId,
      technologyKey: 'extraction_algorithms',
    },
    now
  );
  await executeBotIntent(
    botUserId,
    { type: 'upgrade_defense', stationId: localStationId, upgradeKey: 'armor_plating' },
    now
  );

  assert.equal(
    (
      await db
        .select()
        .from(spacecraftBuildOrders)
        .where(eq(spacecraftBuildOrders.stationId, localStationId))
    ).length,
    1
  );
  assert.ok(
    (await db.select().from(userResearch).where(eq(userResearch.userId, botUserId))).some(
      (row) => row.technologyKey === 'extraction_algorithms' && row.completesAt
    )
  );
  const upgradingKeys = (
    await db.select().from(stationBuildings).where(eq(stationBuildings.stationId, localStationId))
  )
    .filter((building) => building.upgradeEndsAt !== null)
    .map((building) => building.buildingKey);
  assert.deepEqual(new Set(upgradingKeys), new Set(['warehouse', 'armor_plating']));

  await deleteTestData({ userIds: [botUserId] });
});

test('a newly selected saving goal remains persisted', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;
  const localStationId = (
    await createTestStation({ userId: botUserId, sectorId, x: 20_000, y: 20_000 })
  ).id;
  const localAsteroidId = randomUUID();
  await db.insert(asteroids).values({
    id: localAsteroidId,
    x: 20_100,
    y: 20_000,
    chunkX: 20,
    chunkY: 20,
    size: 'small',
    sectorId,
  });
  await db.insert(asteroidVeins).values([
    {
      asteroidId: localAsteroidId,
      veinType: 'primary',
      resourceKey: 'carbon',
      remainingAmount: 1_000,
    },
    {
      asteroidId: localAsteroidId,
      veinType: 'secondary',
      resourceKey: 'titanium',
      remainingAmount: 1_000,
    },
    {
      asteroidId: localAsteroidId,
      veinType: 'trace',
      resourceKey: 'hydrogenium',
      remainingAmount: 1_000,
    },
  ]);
  // The only miner is already working a deposit, so missing costs have a procurement path.
  await db.delete(stationSpacecrafts).where(eq(stationSpacecrafts.stationId, localStationId));
  await db.insert(stationSpacecrafts).values({
    stationId: localStationId,
    spacecraftKey: 'mole',
    amount: 1,
    lockedAmount: 1,
  });
  await db.insert(asteroidAssignments).values({
    asteroidId: localAsteroidId,
    stationId: localStationId,
    spacecraftKey: 'mole',
    assignedAmount: 1,
  });
  await setTestResources(localStationId, 0);
  const now = new Date();
  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    profile: 'industrialist',
    nextDecisionAt: now,
  });

  await runBotDecisionTick(now);

  const [controller] = await db
    .select()
    .from(botControllers)
    .where(eq(botControllers.userId, botUserId));
  assert.equal(controller?.lastAction, 'saving');
  assert.ok(controller.activeGoalType, 'saving must not discard the selected goal');
  assert.ok(controller.activeGoalTarget);
  assert.equal(controller.blockedCount, 0);
  assert.equal(controller.lastProgressAt, null);

  await deleteTestData({ userIds: [botUserId] });
  await db.delete(asteroids).where(eq(asteroids.id, localAsteroidId));
});

test('parallel bot ticks claim one decision and create one domain action', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;
  const localStationId = (await createTestStation({ userId: botUserId, sectorId })).id;
  const now = new Date();
  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    nextDecisionAt: now,
  });

  await Promise.all([runBotDecisionTick(now), runBotDecisionTick(now)]);

  const assignments = await db
    .select()
    .from(asteroidAssignments)
    .where(eq(asteroidAssignments.stationId, localStationId));
  assert.equal(assignments.length, 1);

  await deleteTestData({ userIds: [botUserId] });
});

test('goal_v1 lifecycle tracks blocked count and releases goal after 5 intervals', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;

  // Give the bot a station so loadGoalBotState succeeds
  const stationId = (
    await createTestStation({ userId: botUserId, sectorId, x: 100_000, y: 100_000 })
  ).id;
  // Delete the seeded Mole so maintenance has no free ships to assign
  await getDb()
    .delete(stationSpacecrafts)
    .where(
      and(eq(stationSpacecrafts.stationId, stationId), eq(stationSpacecrafts.spacecraftKey, 'mole'))
    );
  await setTestResources(stationId, 0);

  // Set up bot controller with goal_v1 strategy and an active goal
  const now = new Date();
  await db.insert(botControllers).values({
    userId: botUserId,
    strategy: 'goal_v1',
    strategyVersion: '1',
    profile: 'industrialist',
    activeGoalType: 'research_technology',
    activeGoalTarget: `tech:${stationId}:extraction_algorithms:1`,
    goalStartedAt: now,
    lastProgressAt: now,
    blockedCount: 0,
    nextDecisionAt: now,
  });

  // Four genuine blocked intervals keep the goal bound.
  for (let interval = 0; interval < 4; interval += 1) {
    await runBotDecisionTick(new Date(now.getTime() + interval * 120_000));
  }
  let ctrl = await db
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
  assert.equal(ctrl.lastAction, 'blocked');
  assert.equal(ctrl.blockedCount, 4);
  assert.equal(ctrl.activeGoalType, 'research_technology');

  // The fifth consecutive blocked interval releases it.
  await runBotDecisionTick(new Date(now.getTime() + 4 * 120_000));
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
  assert.equal(ctrl.lastAction, 'blocked');
  assert.equal(ctrl.blockedCount, 0);
  assert.equal(ctrl.activeGoalType, null);
  assert.equal(ctrl.activeGoalTarget, null);
  assert.match(ctrl.lastReason ?? '', /released after 5 blocked intervals/);

  // Completing an active goal remains observable even if another goal is selected in the same
  // decision. This is required by playtest goal-completion metrics.
  const completedAt = new Date(now.getTime() + 5 * 120_000);
  await grantResearch(botUserId, { extraction_algorithms: 1 });
  await db
    .update(botControllers)
    .set({
      activeGoalType: 'research_technology',
      activeGoalTarget: `tech:${stationId}:extraction_algorithms:1`,
      goalStartedAt: now,
      nextDecisionAt: completedAt,
    })
    .where(eq(botControllers.userId, botUserId));
  const completionOutcomes = await runBotDecisionTick(completedAt);
  const completion = completionOutcomes.find((outcome) => outcome.botUserId === botUserId);
  assert.equal(completion?.completedGoalType, 'research_technology');

  await deleteTestData({ userIds: [botUserId] });
});

test('bot exploration and colonization goal generation', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;

  const baseX = uniqueSectorCoordinate(randomUUID(), -1_000_000_000);
  const baseY = baseX;

  // An "explored" sector and a frontier sector adjacent to it
  const knownSectorId = (await createTestSector({ sectorX: baseX, sectorY: baseY })).id;
  const frontierSectorId = (
    await createTestSector({ sectorX: baseX + 1, sectorY: baseY, role: 'frontier' })
  ).id;

  // Station in the known sector with a miner ship
  const stationId2 = (
    await createTestStation({ userId: botUserId, sectorId: knownSectorId, x: 100, y: 100 })
  ).id;

  // Top up resources so a colony can be afforded at the cost for a third station
  await setTestResources(stationId2, { carbon: 12_000, titanium: 12_000, hydrogenium: 12_000 });

  // Also create a second station in a frontier sector (already colonized, no mining)
  await createTestStation({ userId: botUserId, sectorId: frontierSectorId, x: 200, y: 100 });

  await grantResearch(botUserId, { long_range_survey: 1, colony_logistics: 2 });
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
  const exploreCandidate = await generateExploreSectorCandidate(state, homeStation);
  // Since we have a frontier at 1:0, a ship, and no active expedition, should generate a candidate
  assert.ok(exploreCandidate, 'Should generate explore_sector candidate');
  assert.equal(exploreCandidate.goalType, 'explore_sector');
  assert.ok(exploreCandidate.targetRef.startsWith('sector:'), 'Target should be a sector');

  // Test establish colony candidate generation
  const colonyCandidate = await generateEstablishColonyCandidate(state, homeStation);
  // Since we have frontier sectors without own stations and can afford colonization
  assert.ok(colonyCandidate, 'Should generate establish_colony candidate');
  assert.equal(colonyCandidate.goalType, 'establish_colony');

  // Test the step functions
  const stepResult = await stepExploreSector(
    state,
    homeStation,
    exploreCandidate.targetRef,
    'pioneer'
  );
  assert.ok(stepResult, 'Should return a step result');
  // The result should be 'success' since we have resources and ships
  assert.equal(stepResult.type, 'success', 'Explore step should succeed');
  assert.equal(stepResult.intent.type, 'start_expedition');

  // Test colony step
  const colonyStep = await stepEstablishColony(
    state,
    homeStation,
    colonyCandidate.targetRef,
    'pioneer'
  );
  assert.ok(colonyStep, 'Should return colony step result');
  assert.equal(colonyStep.type, 'success', 'Colony step should succeed');
  assert.equal(colonyStep.intent.type, 'start_colonization');

  // Verify goal lifecycle integration — generateGoalCandidates should include expansion
  const { generateGoalCandidates } = await import('../../src/services/bot/goal-lifecycle.js');
  const allCandidates = await generateGoalCandidates(state);
  const exploreCandidates = allCandidates.filter((c) => c.goalType === 'explore_sector');
  const colonyCandidates = allCandidates.filter((c) => c.goalType === 'establish_colony');
  assert.ok(exploreCandidates.length > 0, 'generateGoalCandidates should include explore_sector');
  assert.ok(colonyCandidates.length > 0, 'generateGoalCandidates should include establish_colony');

  await deleteTestData({ userIds: [botUserId], sectorIds: [knownSectorId, frontierSectorId] });
});

test('bot fortify and strike force goal generation', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;
  const fortifyOrigin = uniqueSectorCoordinate(randomUUID(), 400_000) * 1000;
  const sectorId4 = (await createTestSector()).id;
  const stationId4 = (
    await createTestStation({
      userId: botUserId,
      sectorId: sectorId4,
      x: fortifyOrigin,
      y: fortifyOrigin,
    })
  ).id;
  await setTestResources(stationId4, { carbon: 2000, titanium: 2000, hydrogenium: 2000 });

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
  assert.equal(fortifyCandidate.goalType, 'fortify_station');
  assert.ok(fortifyCandidate.targetRef.startsWith('station:'), 'Target should point to station');

  // Test fortify step - should suggest a defense upgrade
  const fortifyStep = await stepFortifyStation(
    state,
    station,
    fortifyCandidate.targetRef,
    'industrialist'
  );
  assert.ok(fortifyStep, 'Should return fortify step result');
  assert.equal(fortifyStep.type, 'success', 'Fortify step should be success');
  assert.equal(fortifyStep.intent.type, 'upgrade_defense');

  // Test strike force candidate
  const strikeCandidate = generateBuildStrikeForceCandidate(state, station);
  // Station starts with shipyard level 1 by default - fighters need level 2
  if (strikeCandidate) {
    assert.equal(strikeCandidate.goalType, 'build_strike_force');
  }

  // Test strike force step - without shipyard level 2, should suggest shipyard upgrade
  const strikeStep = await stepBuildStrikeForce(
    state,
    station,
    `station:${stationId4}`,
    'industrialist'
  );
  assert.ok(strikeStep, 'Should return strike force step');
  // Without shipyard level 2, should suggest shipyard upgrade or be blocked/waiting
  assert.ok(
    ['success', 'blocked', 'waiting'].includes(strikeStep.type),
    `Strike step should be actionable, got ${strikeStep.type}`
  );

  // Verify generateGoalCandidates includes conflict goals
  const { generateGoalCandidates } = await import('../../src/services/bot/goal-lifecycle.js');
  const allCandidates = await generateGoalCandidates(state);
  const fortifyCandidates = allCandidates.filter((c) => c.goalType === 'fortify_station');
  assert.ok(fortifyCandidates.length > 0, 'generateGoalCandidates should include fortify_station');

  await deleteTestData({ userIds: [botUserId], sectorIds: [sectorId4] });
});

test('bot raid and retaliate goal generation with visible target', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;
  const targetUserId = (await createTestUser()).id;

  const stationOrigin5 = uniqueSectorCoordinate(randomUUID(), 600_000);
  const sectorId5 = (await createTestSector()).id;

  // Bot station with fighters
  const botStationId = (
    await createTestStation({
      userId: botUserId,
      sectorId: sectorId5,
      x: stationOrigin5,
      y: stationOrigin5,
    })
  ).id;
  await db
    .update(stationBuildings)
    .set({ level: 15 })
    .where(eq(stationBuildings.stationId, botStationId));
  // Give the bot some fighters (Merlins) and the research that unlocks them
  await grantResearch(botUserId, { weapons: 1 });
  await db.insert(stationSpacecrafts).values({
    stationId: botStationId,
    spacecraftKey: 'merlin',
    amount: 5,
    lockedAmount: 0,
  });
  await setTestResources(botStationId, { carbon: 2000, titanium: 2000 });

  // Target station (close enough to be visible, different user)
  const targetStationId = (
    await createTestStation({
      userId: targetUserId,
      sectorId: sectorId5,
      x: stationOrigin5 + 100,
      y: stationOrigin5 + 100,
    })
  ).id;

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
    'warlord'
  );
  assert.ok(raidStep, 'Should return raid step result');
  assert.ok(
    ['success', 'saving', 'blocked'].includes(raidStep.type),
    `Raid step should be actionable, got ${raidStep.type}`
  );
  if (raidStep.type === 'success') {
    assert.equal(raidStep.intent.type, 'start_attack');
  }

  // A protected target releases the raid and is skipped for an hour; the bot keeps its cadence.
  await db
    .delete(stationSpacecrafts)
    .where(
      and(
        eq(stationSpacecrafts.stationId, botStationId),
        eq(stationSpacecrafts.spacecraftKey, 'mole')
      )
    );
  const protectedAttemptAt = new Date();
  await db
    .update(botControllers)
    .set({
      activeGoalType: 'raid',
      activeGoalTarget: `station:${targetStationId}`,
      goalStartedAt: protectedAttemptAt,
      nextDecisionAt: protectedAttemptAt,
    })
    .where(eq(botControllers.userId, botUserId));
  await runBotDecisionTick(protectedAttemptAt);
  const [protectedController] = await db
    .select({
      activeGoalType: botControllers.activeGoalType,
      lastAction: botControllers.lastAction,
      nextDecisionAt: botControllers.nextDecisionAt,
      raidBlockedTarget: botControllers.raidBlockedTarget,
      raidBlockedUntil: botControllers.raidBlockedUntil,
    })
    .from(botControllers)
    .where(eq(botControllers.userId, botUserId));
  assert.notEqual(protectedController?.activeGoalType, 'raid');
  assert.equal(protectedController?.lastAction, 'waiting');
  assert.ok(
    protectedController.nextDecisionAt.getTime() < protectedAttemptAt.getTime() + 60 * 60_000
  );
  assert.equal(protectedController.raidBlockedTarget, `station:${targetStationId}`);
  assert.equal(
    protectedController.raidBlockedUntil?.getTime(),
    protectedAttemptAt.getTime() + 60 * 60_000
  );
  const blockedState = await loadGoalBotState(botUserId);
  assert.ok(blockedState);
  blockedState.blockedRaidTarget = `station:${targetStationId}`;
  assert.ok(
    generateRaidCandidates(blockedState, 'warlord').every(
      (candidate) => candidate.targetRef !== `station:${targetStationId}`
    )
  );

  // Test retaliate candidate generation (no combat reports → no retaliation)
  const retaliateCandidates = generateRetaliateCandidates(state, 'warlord');
  assert.equal(retaliateCandidates.length, 0, 'No retaliation without combat reports');

  await deleteTestData({ userIds: [botUserId, targetUserId], sectorIds: [sectorId5] });
});

test('bot salvage goal generation', async () => {
  const db = getDb();
  const botUserId = (await createTestUser()).id;
  const sectorId6 = (await createTestSector()).id;
  const stationId6 = (await createTestStation({ userId: botUserId, sectorId: sectorId6 })).id;
  await setTestResources(stationId6, { carbon: 2000, titanium: 2000, hydrogenium: 2000 });

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
  const candidates = generateSalvageCandidates(state, 'industrialist');
  assert.equal(candidates.length, 0, 'No salvage candidates without visible debris');

  // A disappeared field means the bounded salvage goal is finished.
  const step = await stepSalvage(
    state,
    state.ownStations[0]!,
    'debris:nonexistent',
    'industrialist'
  );
  assert.ok(step, 'Should return step result');
  assert.equal(step.type, 'complete');

  await deleteTestData({ userIds: [botUserId], sectorIds: [sectorId6] });
});
