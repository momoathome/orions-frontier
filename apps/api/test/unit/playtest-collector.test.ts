import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BotDecisionOutcome } from '../../src/services/bot/bot.service.js';
import { PlaytestAliasRegistry } from '../../src/lib/playtest/aliases.js';
import { PlaytestCollector } from '../../src/lib/playtest/collector.js';
import type { PlaytestCompletionEvent } from '../../src/lib/playtest/events.js';
import type { PlaytestPopulationMember } from '../../src/lib/playtest/population.js';

const userId = '10000000-0000-4000-8000-000000000001';
const stationId = '20000000-0000-4000-8000-000000000001';
const sourceId = '30000000-0000-4000-8000-000000000001';
const occurredAt = new Date('2030-01-01T01:00:00.000Z');

function populationMember(): PlaytestPopulationMember {
  return {
    alias: 'player-001',
    userId,
    initialStationId: stationId,
    profile: 'technocrat',
    joinedAt: new Date('2030-01-01T00:00:00.000Z'),
    populationKind: 'synthetic_player',
  };
}

function completionEvents(): PlaytestCompletionEvent[] {
  const base = { occurredAt, userId, stationId };
  return [
    {
      ...base,
      type: 'mining_delivery_completed',
      eventId: `mining:${sourceId}`,
      tripId: sourceId,
      asteroidId: sourceId,
      requested: { carbon: 10 },
      credited: { carbon: 8 },
      discarded: { carbon: 2 },
      targetVisibilityVerified: true,
      asteroidExhausted: false,
    },
    {
      ...base,
      type: 'building_completed',
      eventId: `building:${sourceId}`,
      buildingKey: 'warehouse',
      newLevel: 2,
    },
    {
      ...base,
      type: 'defense_completed',
      eventId: `defense:${sourceId}`,
      defenseKey: 'shield_array',
      newLevel: 2,
    },
    {
      ...base,
      type: 'spacecraft_completed',
      eventId: `spacecraft:${sourceId}`,
      orderId: sourceId,
      spacecraftKey: 'mole',
      amount: 1,
    },
    {
      ...base,
      type: 'research_completed',
      eventId: `research:${sourceId}`,
      researchId: sourceId,
      technologyKey: 'grid_optimization',
    },
    {
      ...base,
      type: 'world_mission_completed',
      eventId: `world:${sourceId}`,
      missionId: sourceId,
      missionType: 'expedition',
      stage: 'returned',
    },
    {
      ...base,
      type: 'colony_established',
      eventId: `colony:${sourceId}`,
      missionId: sourceId,
      colonyStationId: '20000000-0000-4000-8000-000000000002',
      sectorX: 1,
      sectorY: 0,
    },
    {
      ...base,
      type: 'combat_resolved',
      eventId: `combat:${sourceId}`,
      missionId: sourceId,
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
      type: 'loot_acquired',
      eventId: `loot:${sourceId}`,
      missionId: sourceId,
      resources: { titanium: 4 },
    },
    {
      ...base,
      type: 'loot_delivered',
      eventId: `loot-delivery:${sourceId}`,
      missionId: sourceId,
      requested: { titanium: 4 },
      credited: { titanium: 3 },
      discarded: { titanium: 1 },
    },
    {
      ...base,
      type: 'fleet_losses',
      eventId: `losses:${sourceId}`,
      missionId: sourceId,
      attackerLosses: 1,
      defenderLosses: 2,
    },
    {
      ...base,
      type: 'debris_created',
      eventId: `debris:${sourceId}`,
      missionId: sourceId,
      debrisId: sourceId,
      resources: { carbon: 3 },
    },
    {
      ...base,
      type: 'salvage_completed',
      eventId: `salvage:${sourceId}`,
      missionId: sourceId,
      requested: { carbon: 3 },
      credited: { carbon: 3 },
      discarded: {},
      targetVisibilityVerified: true,
    },
  ];
}

test('collector deduplicates completions, removes UUIDs and bounds per-bot diagnostics', () => {
  const aliases = new PlaytestAliasRegistry([populationMember()]);
  const collector = new PlaytestCollector(aliases, 3);
  const events = completionEvents();
  for (const event of events) assert.ok(collector.consumeCompletion(event));
  assert.equal(collector.consumeCompletion(events[0]!), null);

  const decision: BotDecisionOutcome = {
    botUserId: userId,
    decidedAt: occurredAt,
    strategy: 'goal_v1',
    profile: 'technocrat',
    activeGoalBefore: null,
    activeGoalTargetBefore: null,
    activeGoalAfter: 'research_technology',
    activeGoalTargetAfter: `tech:${stationId}:grid_optimization`,
    completedGoalType: null,
    action: 'start_research',
    resultKind: 'success',
    reason: `Researching ${sourceId}`,
    normalizedReason: 'Researching <id>',
    hasProgress: true,
    conflictOpportunity: null,
  };
  const normalizedDecision = collector.consumeBotDecision(decision);
  assert.equal(normalizedDecision.botAlias, 'player-001');
  assert.equal(normalizedDecision.normalizedReason, 'Researching <id>');
  assert.equal(
    normalizedDecision.activeGoalTargetAfter,
    'tech:player-001/station-001:grid_optimization'
  );

  const diagnostics = collector.diagnostics('player-001');
  assert.equal(diagnostics.length, 3);
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /[123]0000000-0000-4000-8000-/);

  collector.consumeSnapshot({
    capturedAt: occurredAt.toISOString(),
    bots: [{ botAlias: 'player-001', progressFingerprint: 'bot-fingerprint' }],
    stations: [
      {
        stationAlias: 'player-001/station-001',
        progressFingerprint: 'station-fingerprint',
      },
    ],
  });
  assert.ok(
    collector.diagnostics('player-001').some((diagnostic) => diagnostic.kind === 'state_snapshot')
  );
  const summary = collector.summary();
  assert.equal(summary.completionEvents, events.length);
  assert.equal(summary.duplicateCompletionEvents, 1);
  assert.equal(summary.botDecisions, 1);
  assert.equal(summary.snapshots, 1);
  assert.equal(summary.eventCounts['combat_resolved'], 1);
  assert.equal(summary.actionCounts['start_research'], 1);
  assert.equal(collector.lastSnapshot()?.capturedAt, occurredAt.toISOString());
});
