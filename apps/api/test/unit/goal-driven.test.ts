import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GoalCandidate } from '../../src/services/bot/goal-driven-v1.js';
import { scoreCandidate, selectGoal } from '../../src/services/bot/goal-driven-v1.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cand = (
  overrides: Partial<GoalCandidate> & { goalType: GoalCandidate['goalType']; targetRef: string }
): GoalCandidate => ({
  category: 'economy',
  baseNeed: 50,
  opportunity: 20,
  longTermValue: 30,
  commitment: 0,
  cost: 20,
  risk: 10,
  blockers: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// All four profile weightings produce different scores
// ---------------------------------------------------------------------------

test('each profile scores the same candidate differently', () => {
  const c = cand({ goalType: 'increase_income', targetRef: 'station:a' });

  const industrialist = scoreCandidate(c, 'industrialist');
  const pioneer = scoreCandidate(c, 'pioneer');
  const technocrat = scoreCandidate(c, 'technocrat');
  const warlord = scoreCandidate(c, 'warlord');

  // Economy weight: industrialist=1.5, pioneer=1.0, technocrat=1.0, warlord=1.0
  // So industrialist should have the highest baseNeed contribution for economy goals
  assert.ok(
    industrialist.score > warlord.score,
    'industrialist should score economy higher than warlord'
  );

  // Check that scores are distinct (different riskWeight etc.)
  const scores = new Set([industrialist.score, pioneer.score, technocrat.score, warlord.score]);
  assert.equal(scores.size, 4, 'All four profiles must produce different scores');
});

test('each profile prefers its own category', () => {
  const economyCand = cand({
    goalType: 'increase_income',
    targetRef: 'station:a',
    category: 'economy',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });
  const researchCand = cand({
    goalType: 'research_technology',
    targetRef: 'tech:foo',
    category: 'research',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });
  const expansionCand = cand({
    goalType: 'explore_sector',
    targetRef: 'sector:1:2',
    category: 'expansion',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });
  const conflictCand = cand({
    goalType: 'raid',
    targetRef: 'user:b',
    category: 'conflict',
    baseNeed: 80,
    opportunity: 0,
    longTermValue: 0,
  });

  const candidates = [economyCand, researchCand, expansionCand, conflictCand];

  // Industrialist → prefers economy
  let result = selectGoal(candidates, 'industrialist', null);
  assert.equal(result.selected?.goalType, 'increase_income', 'industrialist prefers economy');

  // Pioneer → prefers expansion
  result = selectGoal(candidates, 'pioneer', null);
  assert.equal(result.selected?.goalType, 'explore_sector', 'pioneer prefers expansion');

  // Technocrat → prefers research
  result = selectGoal(candidates, 'technocrat', null);
  assert.equal(result.selected?.goalType, 'research_technology', 'technocrat prefers research');

  // Warlord → prefers conflict
  result = selectGoal(candidates, 'warlord', null);
  assert.equal(result.selected?.goalType, 'raid', 'warlord prefers conflict');
});

test('every profile can select goals from every strategic category', () => {
  const candidates: GoalCandidate[] = [
    cand({
      goalType: 'increase_income',
      targetRef: 'station:a',
      category: 'economy',
      baseNeed: 80,
    }),
    cand({
      goalType: 'research_technology',
      targetRef: 'tech:a:vector_navigation',
      category: 'research',
      baseNeed: 80,
    }),
    cand({
      goalType: 'explore_sector',
      targetRef: 'sector:1:2',
      category: 'expansion',
      baseNeed: 80,
    }),
    cand({
      goalType: 'raid',
      targetRef: 'station:target',
      category: 'conflict',
      baseNeed: 80,
    }),
  ];
  for (const profile of ['industrialist', 'pioneer', 'technocrat', 'warlord'] as const) {
    for (const candidate of candidates) {
      assert.ok(
        scoreCandidate(candidate, profile).score > 0,
        `${profile} must be able to select ${candidate.category}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Hysteresis (25% threshold)
// ---------------------------------------------------------------------------

test('keeps current goal when alternative is not 25% higher', () => {
  const current = cand({ goalType: 'stabilize_station', targetRef: 'station:a', baseNeed: 50 });
  const alternative = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 58 });

  // alternative scores ~16% higher, below threshold
  const result = selectGoal([current, alternative], 'industrialist', {
    goalType: 'stabilize_station',
    targetRef: 'station:a',
  });

  assert.equal(result.selected?.goalType, 'stabilize_station');
  assert.ok(result.reason.includes('Keeping'));
});

test('switches when alternative is 25% higher', () => {
  const current = cand({ goalType: 'stabilize_station', targetRef: 'station:a', baseNeed: 50 });
  const alternative = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 90 });

  // alternative scores significantly higher, above 25% threshold
  const result = selectGoal([current, alternative], 'industrialist', {
    goalType: 'stabilize_station',
    targetRef: 'station:a',
  });

  assert.equal(result.selected?.goalType, 'increase_income');
  assert.ok(result.reason.includes('Switching'));
});

test('switches to highest when current goal is no longer a candidate', () => {
  const a = cand({ goalType: 'increase_income', targetRef: 'station:a', baseNeed: 60 });
  const b = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 80 });

  const result = selectGoal([a, b], 'industrialist', {
    goalType: 'stabilize_station',
    targetRef: 'station:old',
  });

  assert.equal(result.selected?.targetRef, 'station:b');
});

// ---------------------------------------------------------------------------
// Tie-breaking
// ---------------------------------------------------------------------------

test('ties broken by goalType then targetRef', () => {
  const a = cand({ goalType: 'increase_income', targetRef: 'station:b', baseNeed: 50 });
  const b = cand({ goalType: 'increase_income', targetRef: 'station:a', baseNeed: 50 });
  const c = cand({ goalType: 'stabilize_station', targetRef: 'station:c', baseNeed: 50 });

  const result = selectGoal([a, b, c], 'industrialist', null);

  // Same score: increase_income < stabilize_station alphabetically
  assert.equal(result.selected?.goalType, 'increase_income');

  // If we only keep increase_income ones, station:a < station:b
  const result2 = selectGoal([a, b], 'industrialist', null);
  assert.equal(result2.selected?.targetRef, 'station:a');
});

// ---------------------------------------------------------------------------
// No positive score
// ---------------------------------------------------------------------------

test('returns null when no candidate has positive score', () => {
  const bad = cand({
    goalType: 'increase_income',
    targetRef: 'station:a',
    baseNeed: 0,
    opportunity: 0,
    longTermValue: 0,
    cost: 100,
  });

  const result = selectGoal([bad], 'industrialist', null);
  assert.equal(result.selected, null);
  assert.ok(result.reason.includes('non-positive'));
});

// ---------------------------------------------------------------------------
// Empty candidates
// ---------------------------------------------------------------------------

test('returns null for empty candidate list', () => {
  const result = selectGoal([], 'industrialist', null);
  assert.equal(result.selected, null);
  assert.equal(result.scored, null);
  assert.ok(result.reason.includes('No candidates'));
});

// ---------------------------------------------------------------------------
// Determinism: identical input → identical output
// ---------------------------------------------------------------------------

test('identical input produces identical result', () => {
  const candidates = [
    cand({ goalType: 'increase_income', targetRef: 'station:a', baseNeed: 70 }),
    cand({
      goalType: 'research_technology',
      targetRef: 'tech:bar',
      baseNeed: 40,
      category: 'research',
    }),
    cand({
      goalType: 'explore_sector',
      targetRef: 'sector:1:2',
      baseNeed: 30,
      category: 'expansion',
    }),
  ];

  const result1 = selectGoal(candidates, 'technocrat', null);
  const result2 = selectGoal(candidates, 'technocrat', null);

  assert.deepEqual(result1, result2);
});

// ---------------------------------------------------------------------------
// Score breakdown is present in result
// ---------------------------------------------------------------------------

test('scored candidate includes breakdown', () => {
  const c = cand({ goalType: 'stabilize_station', targetRef: 'station:x' });
  const scored = scoreCandidate(c, 'pioneer');
  assert.ok('score' in scored);
  assert.ok('scoreBreakdown' in scored);
  assert.ok(typeof scored.scoreBreakdown.baseNeedWeighted === 'number');
  assert.ok(typeof scored.scoreBreakdown.opportunity === 'number');
  assert.ok(typeof scored.scoreBreakdown.longTermValueWeighted === 'number');
  assert.ok(typeof scored.scoreBreakdown.commitment === 'number');
  assert.ok(typeof scored.scoreBreakdown.cost === 'number');
  assert.ok(typeof scored.scoreBreakdown.riskWeighted === 'number');
  assert.ok(typeof scored.scoreBreakdown.blockers === 'number');
});

// ---------------------------------------------------------------------------
// Research generation: different states produce distinct candidates
// ---------------------------------------------------------------------------

import type { StationSnapshot } from '../../src/services/bot/goal-state.js';
import {
  analyzeConflictOpportunities,
  generateSalvageCandidates,
  generateIncreaseCapacityCandidate,
  generateResearchCandidates,
  generateStabilizeCandidate,
  pickBestSalvageStation,
  prioritizeStationsForStabilization,
  stepRaid,
  stepResearchTechnology,
  stepSalvage,
  stepStabilizeStation,
} from '../../src/services/bot/goal-economy.js';
import type { GoalBotState } from '../../src/services/bot/goal-state.js';
import { checkUrgentMaintenance } from '../../src/services/bot/goal-lifecycle.service.js';

const baseStation = (overrides: Partial<StationSnapshot> = {}): StationSnapshot => ({
  id: 'station-1',
  name: 'Test Station',
  x: 0,
  y: 0,
  sectorId: 'sector-1',
  sectorX: 0,
  sectorY: 0,
  createdAt: new Date(0),
  storageCapacity: 1500,
  resources: { carbon: 1000, titanium: 1000, hydrogenium: 1000 },
  buildings: [
    { buildingKey: 'shipyard', level: 1, upgradeEndsAt: null },
    { buildingKey: 'warehouse', level: 1, upgradeEndsAt: null },
    { buildingKey: 'hangar', level: 1, upgradeEndsAt: null },
    { buildingKey: 'laboratory', level: 1, upgradeEndsAt: null },
    { buildingKey: 'scanner', level: 1, upgradeEndsAt: null },
    { buildingKey: 'core', level: 1, upgradeEndsAt: null },
  ],
  defense: [],
  fleets: [],
  builds: [],
  research: [],
  miningAssignments: [],
  trips: [],
  missions: [],
  combatMissions: [],
  salvageMissions: [],
  ...overrides,
});

const baseState = (
  station: StationSnapshot,
  overrides: Partial<GoalBotState> = {}
): GoalBotState => ({
  userId: 'bot-1',
  now: new Date('2026-01-01T00:00:00.000Z'),
  ownStations: [station],
  visibleAsteroids: [
    {
      id: 'asteroid-1',
      x: 100,
      y: 0,
      remainingByResource: { carbon: 1_000 },
      remainingAmount: 1_000,
    },
  ],
  visibleStations: [],
  visibleDebris: [],
  combatReports: [],
  conflictDiagnostics: { protectedOwnerIds: [] },
  ...overrides,
});

test('station stabilization uses real assignments and storage headroom', async () => {
  const assignment = {
    id: 'assignment-1',
    asteroidId: 'asteroid-1',
    spacecraftKey: 'mole',
    assignedAmount: 1,
    status: 'traveling_to_asteroid',
  };
  const stable = baseStation({ miningAssignments: [assignment] });
  assert.equal(generateStabilizeCandidate(baseState(stable), stable), null);
  assert.equal(
    (await stepStabilizeStation(baseState(stable), stable, 'industrialist')).type,
    'complete'
  );

  const full = baseStation({
    resources: { carbon: 1_500, titanium: 1_500, hydrogenium: 1_500 },
    miningAssignments: [assignment],
  });
  const result = await stepStabilizeStation(baseState(full), full, 'industrialist');
  assert.equal(result.type, 'success');
  assert.equal(result.type === 'success' && result.intent.type, 'upgrade_building');
});

test('capacity goals exist only for a demonstrated local bottleneck', () => {
  const ordinary = baseStation();
  assert.equal(generateIncreaseCapacityCandidate(baseState(ordinary), ordinary), null);

  const labBlocked = baseStation({
    research: [
      {
        technologyKey: 'automated_shipyard',
        status: 'completed',
        completesAt: new Date(0),
      },
    ],
  });
  assert.equal(
    generateIncreaseCapacityCandidate(baseState(labBlocked), labBlocked)?.targetRef,
    'station:station-1:laboratory'
  );
});

test('research does not claim to save when the station has no income', async () => {
  const station = baseStation({
    resources: { carbon: 0, titanium: 0, hydrogenium: 0 },
  });
  const result = await stepResearchTechnology(
    station,
    'tech:station-1:extraction_algorithms',
    'technocrat'
  );
  assert.equal(result.type, 'blocked');
});

test('research candidates require a reachable resource and laboratory path', () => {
  const noIncome = baseStation({
    resources: { carbon: 1, titanium: 1, hydrogenium: 1 },
    research: [
      {
        technologyKey: 'extraction_algorithms',
        status: 'completed',
        completesAt: new Date(0),
      },
    ],
  });
  assert.deepEqual(generateResearchCandidates(noIncome), []);

  const withIncome = baseStation({
    ...noIncome,
    miningAssignments: [
      {
        id: 'assignment-1',
        asteroidId: 'asteroid-1',
        spacecraftKey: 'mole',
        assignedAmount: 1,
        status: 'mining',
      },
    ],
  });
  assert.ok(generateResearchCandidates(withIncome).length > 0);
});

test('an unstable colony is prioritized ahead of the initial station', () => {
  const initial = baseStation({ id: 'station-initial', createdAt: new Date(0) });
  const colony = baseStation({
    id: 'station-colony',
    createdAt: new Date(1),
    fleets: [{ spacecraftKey: 'titan', amount: 1, lockedAmount: 0 }],
  });
  const state = baseState(initial, { ownStations: [initial, colony] });

  assert.deepEqual(
    prioritizeStationsForStabilization(state).map((station) => station.id),
    ['station-colony', 'station-initial']
  );
  assert.ok(
    (generateStabilizeCandidate(state, colony)?.commitment ?? 0) >
      (generateStabilizeCandidate(state, initial)?.commitment ?? 0)
  );
});

test('urgent miner maintenance acts on an unstable colony first', async () => {
  const initial = baseStation({
    id: 'station-initial',
    createdAt: new Date(0),
    fleets: [{ spacecraftKey: 'mole', amount: 1, lockedAmount: 0 }],
  });
  const colony = baseStation({
    id: 'station-colony',
    createdAt: new Date(1),
    fleets: [{ spacecraftKey: 'titan', amount: 1, lockedAmount: 0 }],
  });
  const result = await checkUrgentMaintenance(
    baseState(initial, { ownStations: [initial, colony] }),
    'industrialist',
    {}
  );

  assert.equal(result?.type, 'success');
  assert.equal(
    result?.type === 'success' && result.intent.type === 'assign_miner'
      ? result.intent.stationId
      : null,
    'station-colony'
  );
  assert.equal(
    result?.type === 'success' && result.intent.type === 'assign_miner'
      ? result.intent.spacecraftKey
      : null,
    'titan'
  );
});

test('research with active miners gives extraction_algorithms a high score', () => {
  const station = baseStation({
    fleets: [{ spacecraftKey: 'mole', amount: 3, lockedAmount: 1 }],
    miningAssignments: [
      {
        id: 'assignment-1',
        asteroidId: 'asteroid-1',
        spacecraftKey: 'mole',
        assignedAmount: 1,
        status: 'traveling_to_asteroid',
      },
    ],
  });
  const candidates = generateResearchCandidates(station);
  const extraction = candidates.find((c) => c.targetRef.includes('extraction_algorithms'));
  assert.ok(extraction, 'extraction_algorithms should be a candidate');
  assert.ok(
    extraction.baseNeed > 30,
    'extraction_algorithms should have high baseNeed with active miners'
  );
});

test('research with many ships gives modular_cargo_frames a high score', () => {
  const station = baseStation({
    fleets: [
      { spacecraftKey: 'mole', amount: 5, lockedAmount: 0 },
      { spacecraftKey: 'collector', amount: 2, lockedAmount: 0 },
    ],
  });
  const candidates = generateResearchCandidates(station);
  const cargo = candidates.find((c) => c.targetRef.includes('modular_cargo_frames'));
  assert.ok(cargo, 'modular_cargo_frames should be a candidate');
  assert.ok(
    cargo.baseNeed > 30,
    'modular_cargo_frames should have high baseNeed with many cargo ships'
  );
});

test('research with active trips gives vector_navigation a high score', () => {
  const station = baseStation({
    trips: [
      {
        id: 'trip-1',
        purpose: 'mine',
        status: 'traveling',
        arrivesAt: new Date(),
        toId: 'asteroid-1',
      },
      {
        id: 'trip-2',
        purpose: 'salvage',
        status: 'traveling',
        arrivesAt: new Date(),
        toId: 'debris-1',
      },
    ],
  });
  const candidates = generateResearchCandidates(station);
  const vector = candidates.find((c) => c.targetRef.includes('vector_navigation'));
  assert.ok(vector, 'vector_navigation should be a candidate');
  assert.ok(vector.baseNeed > 30, 'vector_navigation should have high baseNeed with active trips');
});

test('research with fighters gives combat_analytics a non-zero score', () => {
  const station = baseStation({
    fleets: [{ spacecraftKey: 'javelin', amount: 2, lockedAmount: 0 }],
  });
  const candidates = generateResearchCandidates(station);
  const combat = candidates.find((c) => c.targetRef.includes('combat_analytics'));
  assert.ok(combat, 'combat_analytics should be a candidate');
  assert.ok(combat.baseNeed > 10, 'combat_analytics should have non-zero baseNeed with fighters');
});

test('raid sends the smallest sufficient single fighter group', async () => {
  const station = baseStation({
    fleets: [
      { spacecraftKey: 'merlin', amount: 10, lockedAmount: 0 },
      { spacecraftKey: 'javelin', amount: 1, lockedAmount: 0 },
    ],
  });
  const state = baseState(station, {
    visibleStations: [
      {
        id: 'target-1',
        name: 'Target',
        x: 100,
        y: 0,
        chunkX: 0,
        chunkY: 0,
        ownerType: 'player',
        ownerId: 'opponent-1',
        isOwn: false,
        visualProfile: {
          scaleTier: 1,
          modules: {
            core: 0,
            shipyard: 0,
            warehouse: 0,
            scanner: 0,
            hangar: 0,
            laboratory: 0,
          },
          defense: {
            armor_plating: 1,
            guardian_cannon: 0,
            defense_drones: 0,
            minefield: 0,
          },
          traffic: { civilian: 0, military: 0 },
        },
      },
    ],
  });

  const result = await stepRaid(state, station, 'station:target-1', 'warlord');
  assert.equal(result.type, 'success');
  assert.deepEqual(
    result.type === 'success'
      ? {
          spacecraftKey: result.intent.type === 'start_attack' ? result.intent.spacecraftKey : null,
          amount: result.intent.type === 'start_attack' ? result.intent.amount : null,
        }
      : null,
    { spacecraftKey: 'javelin', amount: 1 }
  );
});

test('conflict opportunities record the authoritative exclusion stage', () => {
  const station = baseStation({
    fleets: [{ spacecraftKey: 'javelin', amount: 3, lockedAmount: 0 }],
  });
  const target = {
    id: 'target-1',
    name: 'Target',
    x: 100,
    y: 0,
    chunkX: 0,
    chunkY: 0,
    ownerType: 'player' as const,
    ownerId: 'opponent-1',
    isOwn: false,
    visualProfile: {
      scaleTier: 1 as const,
      modules: {
        core: 0 as const,
        shipyard: 0 as const,
        warehouse: 0 as const,
        scanner: 0 as const,
        hangar: 0 as const,
        laboratory: 0 as const,
      },
      defense: {
        armor_plating: 0 as const,
        guardian_cannon: 0 as const,
        defense_drones: 0 as const,
        minefield: 0 as const,
      },
      traffic: { civilian: 0 as const, military: 0 as const },
    },
  };
  const protectedState = baseState(station, {
    visibleStations: [target],
    conflictDiagnostics: { protectedOwnerIds: ['opponent-1'] },
  });
  assert.deepEqual(analyzeConflictOpportunities(protectedState, 'warlord'), {
    visibleTargets: 1,
    eligibleAfterProtectionAndCooldown: 0,
    sufficientFleetAndReserve: 0,
    viableTargets: 0,
    lastExclusionStage: 'target_protected',
  });

  const unprotected = baseState(station, { visibleStations: [target] });
  const opportunity = analyzeConflictOpportunities(unprotected, 'warlord');
  assert.equal(opportunity.eligibleAfterProtectionAndCooldown, 1);
  assert.equal(opportunity.sufficientFleetAndReserve, 1);
  assert.equal(opportunity.lastExclusionStage, 'viable_target');
});

test('salvage must beat mining and chooses the best local station deterministically', () => {
  const near = baseStation({
    id: 'station-near',
    x: 0,
    fleets: [{ spacecraftKey: 'collector', amount: 1, lockedAmount: 0 }],
    resources: { carbon: 0, titanium: 0, hydrogenium: 0 },
  });
  const far = baseStation({
    id: 'station-far',
    x: 10_000,
    fleets: [{ spacecraftKey: 'collector', amount: 1, lockedAmount: 0 }],
    resources: { carbon: 0, titanium: 0, hydrogenium: 0 },
  });
  const profitable = baseState(near, {
    ownStations: [far, near],
    visibleDebris: [{ id: 'debris-rich', x: 100, y: 0, resources: { astatine: 1_000 } }],
  });
  assert.equal(pickBestSalvageStation(profitable, 'debris-rich')?.id, 'station-near');
  assert.equal(generateSalvageCandidates(profitable, 'industrialist').length, 1);

  const unprofitable = baseState(near, {
    visibleDebris: [{ id: 'debris-poor', x: 10_000_000, y: 0, resources: { carbon: 1 } }],
  });
  assert.equal(generateSalvageCandidates(unprofitable, 'industrialist').length, 0);
});

test('collector construction requires one-trip salvage payback', async () => {
  const station = baseStation({
    buildings: baseStation().buildings.map((building) =>
      building.buildingKey === 'shipyard' ? { ...building, level: 2 } : building
    ),
  });
  const poorState = baseState(station, {
    visibleDebris: [{ id: 'debris-poor', x: 100, y: 0, resources: { carbon: 1 } }],
  });
  assert.equal(
    (await stepSalvage(poorState, station, 'debris:debris-poor', 'industrialist')).type,
    'blocked'
  );

  const richState = baseState(station, {
    visibleDebris: [{ id: 'debris-rich', x: 100, y: 0, resources: { astatine: 1_000 } }],
  });
  const result = await stepSalvage(richState, station, 'debris:debris-rich', 'industrialist');
  assert.equal(result.type, 'success');
  assert.equal(result.type === 'success' && result.intent.type, 'build_spacecraft');
  assert.equal(
    result.type === 'success' && result.intent.type === 'build_spacecraft'
      ? result.intent.spacecraftKey
      : null,
    'collector'
  );
});

test('research with upgrades in progress gives station_grid_optimization a boost', () => {
  const station = baseStation({
    buildings: [
      { buildingKey: 'shipyard', level: 1, upgradeEndsAt: new Date(Date.now() + 3600000) },
      { buildingKey: 'warehouse', level: 1, upgradeEndsAt: null },
      { buildingKey: 'hangar', level: 1, upgradeEndsAt: null },
      { buildingKey: 'laboratory', level: 1, upgradeEndsAt: null },
      { buildingKey: 'scanner', level: 1, upgradeEndsAt: null },
      { buildingKey: 'core', level: 1, upgradeEndsAt: null },
    ],
  });
  const candidates = generateResearchCandidates(station);
  const grid = candidates.find((c) => c.targetRef.includes('station_grid_optimization'));
  assert.ok(grid, 'station_grid_optimization should be a candidate');
  assert.ok(grid.baseNeed > 15, 'station_grid_optimization should benefit from active upgrades');
});

test('started research is excluded from candidates', () => {
  const station = baseStation({
    research: [
      { technologyKey: 'extraction_algorithms', status: 'researching', completesAt: new Date() },
    ],
  });
  const candidates = generateResearchCandidates(station);
  const extraction = candidates.find((c) => c.targetRef.includes('extraction_algorithms'));
  assert.equal(extraction, undefined, 'started research should be excluded');
});
