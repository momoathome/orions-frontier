import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  NormalizedBotDecision,
  NormalizedStateObservation,
  PlaytestDiagnostic,
} from '../../src/lib/playtest/collector.js';
import type { SoftlockThresholds } from '../../src/lib/playtest/config.js';
import {
  emptyConflictMetrics,
  emptyDevelopmentMetrics,
  emptyEconomyMetrics,
  emptyExpansionMetrics,
  emptySalvageMetrics,
  type BotMetrics,
  type PlaytestMetrics,
} from '../../src/lib/playtest/metrics.js';
import {
  analyzeSoftlocks,
  type PlaytestWarningCode,
} from '../../src/lib/playtest/softlock-analyzer.js';

const start = Date.parse('2030-01-01T00:00:00.000Z');
const end = new Date(start + 10 * 3_600_000);
const thresholds: SoftlockThresholds = {
  blockedGoalMs: 60 * 60_000,
  noProgressMs: 60 * 60_000,
  unstableColonyMs: 60 * 60_000,
  repeatedActionCount: 3,
  goalSwitchesPerHour: 2,
  capacityBottleneckMs: 60 * 60_000,
  coreMilestoneMs: 2 * 60 * 60_000,
};

function bot(overrides: Partial<BotMetrics> = {}): BotMetrics {
  const economy = emptyEconomyMetrics();
  economy.deliveredResources = { carbon: 1 };
  return {
    botAlias: 'player-001',
    profile: 'technocrat',
    populationKind: 'synthetic_player',
    joinedAt: new Date(start).toISOString(),
    goals: {},
    milestones: {},
    economy,
    development: emptyDevelopmentMetrics(),
    expansion: emptyExpansionMetrics(),
    conflict: emptyConflictMetrics(),
    salvage: emptySalvageMetrics(),
    ...overrides,
  };
}

function decision(
  minutes: number,
  overrides: Partial<NormalizedBotDecision> = {}
): NormalizedBotDecision {
  return {
    kind: 'bot_decision',
    botAlias: 'player-001',
    decidedAt: new Date(start + minutes * 60_000).toISOString(),
    strategy: 'goal_v1',
    profile: 'technocrat',
    activeGoalBefore: 'increase_income',
    activeGoalTargetBefore: 'station:player-001/station-001',
    activeGoalAfter: 'increase_income',
    activeGoalTargetAfter: 'station:player-001/station-001',
    completedGoalType: null,
    action: 'wait',
    resultKind: 'waiting',
    normalizedReason: 'Waiting',
    hasProgress: false,
    conflictOpportunity: null,
    ...overrides,
  };
}

function snapshot(hours: number, progressFingerprint: string): NormalizedStateObservation {
  return {
    kind: 'state_snapshot',
    botAlias: 'player-001',
    capturedAt: new Date(start + hours * 3_600_000).toISOString(),
    progressFingerprint,
  };
}

function analyze(candidate: BotMetrics, diagnostics: PlaytestDiagnostic[]): PlaytestWarningCode[] {
  return analyzeWarnings(candidate, diagnostics).map((warning) => warning.code);
}

function analyzeWarnings(candidate: BotMetrics, diagnostics: PlaytestDiagnostic[]) {
  const metrics: PlaytestMetrics = {
    bots: [candidate],
    profiles: [],
    run: {} as PlaytestMetrics['run'],
    stations: [],
    world: {
      sectorsByRole: {},
      populationByKind: {},
      populationByProfile: {},
      stations: 0,
      asteroids: 0,
      asteroidResources: {},
      debrisFields: 0,
      debrisResources: {},
    },
    finalSnapshotAt: end.toISOString(),
  };
  return analyzeSoftlocks({
    diagnosticsByBot: { 'player-001': diagnostics },
    metrics,
    virtualStart: new Date(start),
    virtualEnd: end,
    thresholds,
  });
}

test('every softlock detector has a positive evidence-backed path', () => {
  const cases: Array<{
    code: PlaytestWarningCode;
    candidate: BotMetrics;
    diagnostics: PlaytestDiagnostic[];
  }> = [
    {
      code: 'long_blocked_goal',
      candidate: bot(),
      diagnostics: [
        decision(0, { resultKind: 'blocked' }),
        decision(120, { resultKind: 'blocked' }),
      ],
    },
    {
      code: 'no_measurable_progress',
      candidate: bot(),
      diagnostics: [snapshot(0, 'same'), snapshot(2, 'same')],
    },
    {
      code: 'unstable_colony',
      candidate: bot({
        milestones: { firstColony: new Date(start).toISOString() },
        expansion: {
          ...emptyExpansionMetrics(),
          colonies: 1,
          coloniesByStation: {
            'player-001/station-002': {
              foundedAt: new Date(start).toISOString(),
              stabilizationDurationMs: null,
            },
          },
        },
      }),
      diagnostics: [],
    },
    {
      code: 'repeated_action_without_progress',
      candidate: bot(),
      diagnostics: [
        decision(0, {
          action: 'build',
          resultKind: 'blocked',
          normalizedReason: 'Cannot afford',
        }),
        snapshot(0.1, 'same'),
        decision(10, {
          action: 'build',
          resultKind: 'blocked',
          normalizedReason: 'Cannot afford',
        }),
        snapshot(0.2, 'same'),
        decision(20, {
          action: 'build',
          resultKind: 'blocked',
          normalizedReason: 'Cannot afford',
        }),
      ],
    },
    {
      code: 'goal_churn',
      candidate: bot(),
      diagnostics: [
        decision(0, { activeGoalBefore: 'a', activeGoalAfter: 'b' }),
        decision(10, { activeGoalBefore: 'b', activeGoalAfter: 'c' }),
        decision(20, { activeGoalBefore: 'c', activeGoalAfter: 'd' }),
      ],
    },
    {
      code: 'unreachable_resource_without_expansion',
      candidate: bot({
        economy: { ...bot().economy, unreachableResourceNeeds: 1 },
      }),
      diagnostics: [decision(0, { normalizedReason: 'Cannot afford resource' })],
    },
    {
      code: 'storage_capacity_bottleneck',
      candidate: bot({
        economy: {
          ...bot().economy,
          fullStorageDurationMs: 2 * 3_600_000,
          fullStorageDurationByStationMs: {
            'player-001/station-001': 2 * 3_600_000,
          },
        },
      }),
      diagnostics: [],
    },
    {
      code: 'hangar_capacity_bottleneck',
      candidate: bot(),
      diagnostics: [
        decision(0, { normalizedReason: 'Need Hangar capacity' }),
        decision(120, { normalizedReason: 'Need Hangar capacity' }),
      ],
    },
    {
      code: 'queue_capacity_bottleneck',
      candidate: bot({
        development: {
          ...emptyDevelopmentMetrics(),
          queueActiveSamples: 10,
          snapshotSamples: 10,
          queueUtilization: 1,
        },
      }),
      diagnostics: [],
    },
    {
      code: 'warlord_without_attack_chance',
      candidate: bot({
        profile: 'warlord',
        conflict: {
          ...emptyConflictMetrics(),
          opportunitySamples: 10,
          opportunityStages: { no_visible_target: 10 },
        },
      }),
      diagnostics: [],
    },
    {
      code: 'peaceful_profile_without_economic_progress',
      candidate: bot({
        economy: emptyEconomyMetrics(),
      }),
      diagnostics: [],
    },
  ];

  for (const scenario of cases) {
    assert.ok(
      analyze(scenario.candidate, scenario.diagnostics).includes(scenario.code),
      `expected ${scenario.code}`
    );
  }
});

test('healthy progress and missing opportunities do not produce false warnings', () => {
  const healthy = bot({
    milestones: {
      firstMining: new Date(start + 60_000).toISOString(),
      firstColony: new Date(start + 2 * 3_600_000).toISOString(),
      stableColony: new Date(start + 3 * 3_600_000).toISOString(),
    },
    development: {
      ...emptyDevelopmentMetrics(),
      completedResearch: 1,
      queueActiveSamples: 1,
      snapshotSamples: 10,
      queueUtilization: 0.1,
    },
    expansion: { ...emptyExpansionMetrics(), expeditions: 1 },
  });
  const diagnostics: PlaytestDiagnostic[] = [
    snapshot(0, 'a'),
    decision(10, { hasProgress: true, resultKind: 'success' }),
    snapshot(2, 'b'),
    decision(130, {
      action: 'different',
      normalizedReason: 'Progress',
      hasProgress: true,
      resultKind: 'success',
    }),
    snapshot(4, 'c'),
  ];
  assert.deepEqual(analyze(healthy, diagnostics), []);

  const peacefulWithoutAttackOpportunity = bot({ profile: 'warlord' });
  assert.ok(
    !analyze(peacefulWithoutAttackOpportunity, []).includes('warlord_without_attack_chance')
  );
});

test('a viable target without an attack is distinguished from no attack chance', () => {
  const candidate = bot({
    profile: 'warlord',
    conflict: {
      ...emptyConflictMetrics(),
      opportunitySamples: 10,
      visibleTargets: 10,
      eligibleAfterProtectionAndCooldown: 10,
      sufficientFleetAndReserve: 4,
      viableTargets: 2,
      opportunityStages: { viable_target: 2, insufficient_fleet_or_reserve: 8 },
    },
  });

  const codes = analyze(candidate, []);
  assert.ok(codes.includes('warlord_ignored_attack_chance'));
  assert.ok(!codes.includes('warlord_without_attack_chance'));
});

test('a stable first colony does not hide a later unstable colony', () => {
  const candidate = bot({
    expansion: {
      ...emptyExpansionMetrics(),
      colonies: 2,
      coloniesByStation: {
        'player-001/station-002': {
          foundedAt: new Date(start).toISOString(),
          stabilizationDurationMs: 30 * 60_000,
        },
        'player-001/station-003': {
          foundedAt: new Date(start + 2 * 3_600_000).toISOString(),
          stabilizationDurationMs: null,
        },
      },
    },
  });

  const colonyWarnings = analyzeWarnings(candidate, []).filter(
    (warning) => warning.code === 'unstable_colony'
  );
  assert.equal(colonyWarnings.length, 1);
  assert.deepEqual(colonyWarnings[0]?.affectedAliases, ['player-001', 'player-001/station-003']);
});

test('blocked goals are measured only across a contiguous goal and target', () => {
  const diagnostics = [
    decision(0, {
      resultKind: 'blocked',
      activeGoalAfter: 'research_technology',
      activeGoalTargetAfter: 'tech:station-a:first',
    }),
    decision(40, {
      resultKind: 'blocked',
      activeGoalAfter: 'research_technology',
      activeGoalTargetAfter: 'tech:station-a:first',
    }),
    decision(80, {
      resultKind: 'blocked',
      activeGoalAfter: 'research_technology',
      activeGoalTargetAfter: 'tech:station-a:second',
    }),
    decision(120, {
      resultKind: 'blocked',
      activeGoalAfter: 'research_technology',
      activeGoalTargetAfter: 'tech:station-a:second',
    }),
  ];

  assert.ok(!analyze(bot(), diagnostics).includes('long_blocked_goal'));
});

test('waiting on timed work is not an unsuccessful repeated action', () => {
  const diagnostics: PlaytestDiagnostic[] = [
    decision(0, {
      action: 'waiting',
      resultKind: 'waiting',
      normalizedReason: 'Expedition underway',
    }),
    snapshot(0.1, 'same'),
    decision(10, {
      action: 'waiting',
      resultKind: 'waiting',
      normalizedReason: 'Expedition underway',
    }),
    snapshot(0.2, 'same'),
    decision(20, {
      action: 'waiting',
      resultKind: 'waiting',
      normalizedReason: 'Expedition underway',
    }),
  ];

  assert.ok(!analyze(bot(), diagnostics).includes('repeated_action_without_progress'));
});

test('storage bottlenecks require a qualifying station instead of summed bot time', () => {
  const economy = {
    ...bot().economy,
    fullStorageDurationMs: 80 * 60_000,
    fullStorageDurationByStationMs: {
      'player-001/station-001': 40 * 60_000,
      'player-001/station-002': 40 * 60_000,
    },
  };

  assert.ok(!analyze(bot({ economy }), []).includes('storage_capacity_bottleneck'));
});

test('no-progress evidence reports historical, longest and current windows separately', () => {
  const warning = analyzeWarnings(bot(), [
    snapshot(0, 'first'),
    snapshot(2, 'first'),
    snapshot(3, 'changed'),
    snapshot(4, 'changed'),
    snapshot(5, 'current'),
    snapshot(9, 'current'),
  ]).find((candidate) => candidate.code === 'no_measurable_progress');

  assert.ok(warning);
  assert.equal(warning.measurements['firstWindowStart'], new Date(start).toISOString());
  assert.equal(
    warning.measurements['longestWindowStart'],
    new Date(start + 5 * 3_600_000).toISOString()
  );
  assert.equal(warning.measurements['currentWindowActive'], true);
  assert.equal(warning.measurements['currentWindowDurationMs'], 4 * 3_600_000);
});
