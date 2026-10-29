import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BotDecisionOutcome } from '../../src/services/bot/bot.service.js';
import { PlaytestAggregator } from '../../src/lib/playtest/aggregator.js';
import { PlaytestAliasRegistry } from '../../src/lib/playtest/aliases.js';
import type { PlaytestCompletionEvent } from '../../src/lib/playtest/events.js';
import type { PlaytestPopulationMember } from '../../src/lib/playtest/population.js';
import type {
  PlaytestBotSnapshot,
  PlaytestStateSnapshot,
  PlaytestStationSnapshot,
} from '../../src/lib/playtest/snapshot-loader.js';

const userId = '10000000-0000-4000-8000-000000000001';
const stationId = '20000000-0000-4000-8000-000000000001';
const colonyStationId = '20000000-0000-4000-8000-000000000002';
const start = new Date('2030-01-01T00:00:00.000Z');
const hour = new Date('2030-01-01T01:00:00.000Z');
const end = new Date('2030-01-01T02:00:00.000Z');
const later = new Date('2030-01-01T03:00:00.000Z');

function member(): PlaytestPopulationMember {
  return {
    alias: 'player-001',
    userId,
    initialStationId: stationId,
    profile: 'technocrat',
    joinedAt: start,
    populationKind: 'synthetic_player',
  };
}

function station(
  stationAlias: string,
  overrides: Partial<PlaytestStationSnapshot> = {}
): PlaytestStationSnapshot {
  return {
    stationAlias,
    ownerAlias: 'player-001',
    resources: { carbon: 100 },
    resourceUnits: 100,
    storageCapacityPerResource: 100,
    buildingLevelTotal: 6,
    defenseLevelTotal: 2,
    spacecraftByKey: { mole: 3, titan: 1 },
    spacecraftUnits: 4,
    lockedSpacecraftUnits: 1,
    completedResearch: 0,
    activeBuildingUpgrades: 0,
    activeBuildOrders: 1,
    activeResearch: 0,
    activeTrips: 0,
    activeWorldMissions: 0,
    activeCombatMissions: 0,
    activeSalvageMissions: 0,
    progressFingerprint: `${stationAlias}-fingerprint`,
    ...overrides,
  };
}

function botSnapshot(overrides: Partial<PlaytestBotSnapshot> = {}): PlaytestBotSnapshot {
  return {
    botAlias: 'player-001',
    populationKind: 'synthetic_player',
    profile: 'technocrat',
    stationCount: 1,
    resourceUnits: 100,
    spacecraftUnits: 4,
    lockedSpacecraftUnits: 1,
    completedResearch: 0,
    influence: 0,
    activeWork: 1,
    activeGoal: 'increase_income',
    lastAction: 'assign_miner',
    progressFingerprint: 'bot-fingerprint',
    ...overrides,
  };
}

function snapshot(
  capturedAt: Date,
  stations: PlaytestStationSnapshot[],
  botOverrides: Partial<PlaytestBotSnapshot> = {}
): PlaytestStateSnapshot {
  return {
    capturedAt: capturedAt.toISOString(),
    bots: [botSnapshot(botOverrides)],
    stations,
    world: {
      sectorsByRole: { frontier: 8, settlement: 1 },
      populationByKind: { synthetic_player: 1 },
      populationByProfile: { technocrat: 1 },
      stations: stations.length,
      asteroids: 10,
      asteroidResources: { carbon: 500 },
      debrisFields: capturedAt === end ? 1 : 0,
      debrisResources: capturedAt === end ? { titanium: 3 } : {},
    },
  };
}

function decision(decidedAt: Date, overrides: Partial<BotDecisionOutcome>): BotDecisionOutcome {
  return {
    botUserId: userId,
    decidedAt,
    strategy: 'goal_v1',
    profile: 'technocrat',
    activeGoalBefore: null,
    activeGoalTargetBefore: null,
    activeGoalAfter: null,
    activeGoalTargetAfter: null,
    completedGoalType: null,
    action: 'wait',
    resultKind: 'idle',
    reason: 'No action',
    normalizedReason: 'No action',
    hasProgress: false,
    conflictOpportunity: null,
    ...overrides,
  };
}

function events(): PlaytestCompletionEvent[] {
  const base = { occurredAt: hour, userId, stationId };
  return [
    {
      ...base,
      type: 'mining_delivery_completed',
      eventId: 'mining',
      tripId: 'trip',
      asteroidId: 'asteroid',
      requested: { carbon: 10 },
      credited: { carbon: 8 },
      discarded: { carbon: 2 },
      targetVisibilityVerified: true,
      asteroidExhausted: true,
    },
    {
      ...base,
      type: 'spacecraft_completed',
      eventId: 'spacecraft',
      orderId: 'order',
      spacecraftKey: 'collector',
      amount: 1,
    },
    {
      ...base,
      type: 'research_completed',
      eventId: 'research',
      researchId: 'research',
      technologyKey: 'station_grid_optimization',
    },
    {
      ...base,
      type: 'defense_completed',
      eventId: 'defense',
      defenseKey: 'shield_array',
      newLevel: 2,
    },
    {
      ...base,
      type: 'world_mission_completed',
      eventId: 'expedition',
      missionId: 'expedition',
      missionType: 'expedition',
      stage: 'target_reached',
    },
    {
      ...base,
      type: 'colony_established',
      eventId: 'colony',
      missionId: 'colony',
      colonyStationId,
      sectorX: 1,
      sectorY: 0,
    },
    {
      ...base,
      type: 'combat_resolved',
      eventId: 'combat',
      missionId: 'combat',
      defenderStationId: '20000000-0000-4000-8000-000000000099',
      winner: 'attacker',
      attackerLosses: 1,
      defenderLosses: 2,
      integrityDamage: 0,
      defenderIntegrity: null,
      stationDestroyed: false,
      targetVisibilityVerified: true,
    },
    {
      ...base,
      type: 'fleet_losses',
      eventId: 'losses',
      missionId: 'combat',
      attackerLosses: 1,
      defenderLosses: 2,
    },
    {
      ...base,
      type: 'loot_acquired',
      eventId: 'loot',
      missionId: 'combat',
      resources: { titanium: 4 },
    },
    {
      ...base,
      type: 'debris_created',
      eventId: 'debris',
      missionId: 'combat',
      debrisId: 'debris',
      resources: { titanium: 5 },
    },
    {
      ...base,
      type: 'salvage_completed',
      eventId: 'salvage',
      missionId: 'salvage',
      requested: { titanium: 2 },
      credited: { titanium: 2 },
      discarded: {},
      targetVisibilityVerified: true,
    },
  ];
}

test('aggregator covers goals, milestones and every metric family with traceable sums', () => {
  const aliases = new PlaytestAliasRegistry([member()]);
  const aggregator = new PlaytestAggregator(aliases);
  aggregator.registerPopulationMember(member());
  aggregator.consumeDecision(
    decision(start, {
      activeGoalAfter: 'increase_income',
      action: 'assign_miner',
      resultKind: 'success',
      hasProgress: true,
    })
  );
  aggregator.consumeSnapshot(snapshot(start, [station('player-001/station-001')]));
  for (const event of events()) aggregator.consumeCompletion(event);
  aggregator.consumeDecision(
    decision(hour, {
      activeGoalBefore: 'increase_income',
      activeGoalAfter: 'retaliate',
      completedGoalType: 'increase_income',
      action: 'start_attack',
      resultKind: 'success',
      hasProgress: true,
      conflictOpportunity: {
        visibleTargets: 2,
        eligibleAfterProtectionAndCooldown: 1,
        sufficientFleetAndReserve: 1,
        viableTargets: 1,
        lastExclusionStage: 'viable_target',
      },
    })
  );
  aggregator.consumeSnapshot(
    snapshot(
      end,
      [
        station('player-001/station-001', {
          resources: { carbon: 50 },
          resourceUnits: 50,
          activeBuildOrders: 0,
        }),
        station('player-001/station-002', {
          resources: { carbon: 10 },
          resourceUnits: 10,
          storageCapacityPerResource: 1_500,
          spacecraftByKey: { mole: 1 },
          spacecraftUnits: 1,
          lockedSpacecraftUnits: 0,
          activeBuildOrders: 0,
        }),
      ],
      {
        stationCount: 2,
        resourceUnits: 60,
        spacecraftUnits: 5,
        lockedSpacecraftUnits: 0,
        completedResearch: 1,
        activeWork: 0,
      }
    )
  );

  const metrics = aggregator.finalize(end);
  const bot = metrics.bots[0]!;
  assert.equal(bot.goals['increase_income']?.selections, 1);
  assert.equal(bot.goals['increase_income'].completions, 1);
  assert.equal(bot.goals['retaliate']?.switches, 0);
  assert.equal(bot.goals['increase_income'].activeDurationMs, 3_600_000);
  assert.equal(bot.goals['retaliate'].success, 1);
  assert.deepEqual(Object.keys(bot.milestones).sort(), [
    'firstAttack',
    'firstColony',
    'firstDefense',
    'firstExpedition',
    'firstMining',
    'firstResearch',
    'firstRetaliation',
    'firstSalvage',
    'stableColony',
    'stableInitialStation',
    'threeMolesAndTitan',
  ]);

  assert.deepEqual(bot.economy.minedResources, { carbon: 10 });
  assert.deepEqual(bot.economy.deliveredResources, { carbon: 8 });
  assert.deepEqual(bot.economy.discardedResources, { carbon: 2 });
  assert.equal(bot.economy.weightedDeliveredUnits, 8);
  assert.equal(bot.economy.minimumResources.carbon, 10);
  assert.equal(bot.economy.fullStorageDurationMs, 2 * 3_600_000);
  assert.deepEqual(bot.economy.fullStorageDurationByStationMs, {
    'player-001/station-001': 2 * 3_600_000,
  });
  assert.equal(bot.economy.exhaustedAsteroids, 1);

  assert.equal(bot.development.completedResearch, 1);
  assert.equal(bot.development.spacecraftUnits, 5);
  assert.equal(bot.development.spacecraftBuilt['collector'], 1);
  assert.equal(bot.development.queueUtilization, 0.5);

  assert.equal(bot.expansion.expeditions, 1);
  assert.equal(bot.expansion.discoveredSectors, 1);
  assert.equal(bot.expansion.colonies, 1);
  assert.equal(bot.expansion.stations, 2);
  assert.equal(bot.expansion.colonyStabilizationDurationMs, 3_600_000);
  assert.deepEqual(bot.expansion.coloniesByStation, {
    'player-001/station-002': {
      foundedAt: hour.toISOString(),
      stabilizationDurationMs: 3_600_000,
    },
  });

  assert.equal(bot.conflict.attacks, 1);
  assert.equal(bot.conflict.retaliations, 1);
  assert.equal(bot.conflict.wins, 1);
  assert.equal(bot.conflict.attackerLosses, 1);
  assert.equal(bot.conflict.defenderLosses, 2);
  assert.equal(bot.conflict.opportunitySamples, 1);
  assert.equal(bot.conflict.visibleTargets, 2);
  assert.equal(bot.conflict.eligibleAfterProtectionAndCooldown, 1);
  assert.equal(bot.conflict.sufficientFleetAndReserve, 1);
  assert.equal(bot.conflict.viableTargets, 1);
  assert.deepEqual(bot.conflict.opportunityStages, { viable_target: 1 });
  assert.deepEqual(bot.conflict.loot, { titanium: 4 });
  assert.equal(Object.values(bot.conflict.targets)[0], 1);

  assert.deepEqual(bot.salvage.debrisCreatedResources, { titanium: 5 });
  assert.deepEqual(bot.salvage.salvagedResources, { titanium: 2 });
  assert.equal(bot.salvage.missions, 1);
  assert.equal(bot.salvage.collectorBuilds, 1);
  assert.deepEqual(metrics.run.salvage.remainingDebrisResources, { titanium: 3 });
  assert.deepEqual(metrics.world.sectorsByRole, { frontier: 8, settlement: 1 });

  assert.equal(metrics.profiles[0]?.bots, 1);
  assert.equal(metrics.profiles[0].economy.deliveredResources.carbon, 8);
  assert.equal(metrics.run.economy.deliveredResources.carbon, 8);
  assert.equal(
    metrics.run.development.spacecraftUnits,
    metrics.bots.reduce((sum, entry) => sum + entry.development.spacecraftUnits, 0)
  );
  assert.doesNotMatch(JSON.stringify(metrics), /NaN|Infinity|10000000-0000|20000000-0000/);
});

test('colony stabilization duration records the first stable snapshot', () => {
  const aliases = new PlaytestAliasRegistry([member()]);
  const aggregator = new PlaytestAggregator(aliases);
  aggregator.registerPopulationMember(member());
  aggregator.consumeCompletion({
    type: 'colony_established',
    eventId: 'colony',
    occurredAt: hour,
    userId,
    stationId,
    missionId: 'colony',
    colonyStationId,
    sectorX: 1,
    sectorY: 0,
  });
  const stableStations = [
    station('player-001/station-001'),
    station('player-001/station-002', {
      resourceUnits: 10,
      spacecraftUnits: 1,
    }),
  ];
  aggregator.consumeSnapshot(snapshot(end, stableStations, { stationCount: 2 }));
  aggregator.consumeSnapshot(snapshot(later, stableStations, { stationCount: 2 }));

  const metrics = aggregator.finalize(later);
  assert.equal(
    metrics.bots[0]?.expansion.coloniesByStation['player-001/station-002']?.stabilizationDurationMs,
    3_600_000
  );
});

test('colony stabilization uses an earlier stable snapshot when its event arrives later', () => {
  const aliases = new PlaytestAliasRegistry([member()]);
  const aggregator = new PlaytestAggregator(aliases);
  aggregator.registerPopulationMember(member());
  const stableStations = [
    station('player-001/station-001'),
    station('player-001/station-002', {
      resourceUnits: 10,
      spacecraftUnits: 1,
    }),
  ];

  aggregator.consumeSnapshot(snapshot(end, stableStations, { stationCount: 2 }));
  aggregator.consumeCompletion({
    type: 'colony_established',
    eventId: 'colony',
    occurredAt: hour,
    userId,
    stationId,
    missionId: 'colony',
    colonyStationId,
    sectorX: 1,
    sectorY: 0,
  });
  aggregator.consumeSnapshot(snapshot(later, stableStations, { stationCount: 2 }));

  const metrics = aggregator.finalize(later);
  assert.equal(
    metrics.bots[0]?.expansion.coloniesByStation['player-001/station-002']?.stabilizationDurationMs,
    3_600_000
  );
});
