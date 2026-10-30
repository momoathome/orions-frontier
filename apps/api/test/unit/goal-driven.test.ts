import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GoalCandidate } from '../../src/services/bot/goal-driven-v1.js';
import {
  activeGoalCommitment,
  adaptCategoryWeights,
  CATEGORY_WEIGHTS,
  categoryWeightsFor,
  scoreCandidate,
  selectGoal,
} from '../../src/services/bot/goal-driven-v1.js';

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
import { analyzeConflictOpportunities, stepRaid } from '../../src/services/bot/goals/conflict.js';
import {
  generateIncreaseCapacityCandidate,
  generateIncreaseIncomeCandidate,
  generateStabilizeCandidate,
  stepIncreaseCapacity,
  stepIncreaseIncome,
  stepStabilizeStation,
} from '../../src/services/bot/goals/economy.js';
import { stepEstablishColony } from '../../src/services/bot/goals/expansion.js';
import {
  generateBuildStrikeForceCandidate,
  stepBuildStrikeForce,
} from '../../src/services/bot/goals/military.js';
import {
  generateResearchCandidates,
  stepResearchTechnology,
} from '../../src/services/bot/goals/research.js';
import {
  generateSalvageCandidates,
  pickBestSalvageStation,
  stepSalvage,
} from '../../src/services/bot/goals/salvage.js';
import {
  prioritizeStationsForStabilization,
  selectBestAsteroid,
} from '../../src/services/bot/goals/shared.js';
import type { GoalBotState } from '../../src/services/bot/goal-state.js';
import { checkUrgentMaintenance } from '../../src/services/bot/goal-lifecycle.js';

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
  research: {},
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
  completedExpeditions: 0,
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
  research: { levels: station.research, active: [], slots: 1 },
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
  assert.equal(result.intent.type, 'upgrade_building');
});

test('capacity goals exist only for a demonstrated local bottleneck', () => {
  const ordinary = baseStation();
  assert.equal(generateIncreaseCapacityCandidate(baseState(ordinary), ordinary), null);
});

test('storage pressure keeps warehouse expansion urgent at higher levels', () => {
  const assignment = {
    id: 'assignment-1',
    asteroidId: 'asteroid-1',
    spacecraftKey: 'mole',
    assignedAmount: 1,
    status: 'mining',
  };
  const station = baseStation({
    resources: { carbon: 100_000, titanium: 100_000, hydrogenium: 100_000 },
    buildings: baseStation().buildings.map((building) =>
      building.buildingKey === 'warehouse' ? { ...building, level: 7 } : building
    ),
    miningAssignments: [assignment],
  });
  const state = baseState(station);

  assert.equal(
    generateIncreaseCapacityCandidate(state, station)?.targetRef,
    'station:station-1:warehouse'
  );
});

test('capacity goal completes after its concrete bottleneck is resolved', async () => {
  const station = baseStation();
  const result = await stepIncreaseCapacity(
    baseState(station),
    station,
    'station:station-1:warehouse',
    'industrialist'
  );

  assert.equal(result.type, 'complete');
  assert.equal(result.goalType, 'increase_capacity');
});

test('asteroid selection ignores resources that the station cannot store', () => {
  const station = baseStation({
    resources: { carbon: 1_500, titanium: 0, hydrogenium: 0 },
  });
  const state = baseState(station, {
    visibleAsteroids: [
      {
        id: 'carbon-full',
        x: 10,
        y: 0,
        remainingByResource: { carbon: 10_000 },
        remainingAmount: 10_000,
      },
      {
        id: 'titanium-open',
        x: 1_000,
        y: 0,
        remainingByResource: { titanium: 10_000 },
        remainingAmount: 10_000,
      },
    ],
  });

  assert.equal(selectBestAsteroid(state, station, 'mole')?.id, 'titanium-open');
});

test('warlords without foreign contact prioritize scanner reach', () => {
  const station = baseStation();
  const state = baseState(station);

  assert.equal(
    generateIncreaseCapacityCandidate(state, station, 'warlord')?.targetRef,
    'station:station-1:scanner'
  );
  assert.equal(generateIncreaseCapacityCandidate(state, station, 'industrialist'), null);
  assert.equal(
    generateIncreaseCapacityCandidate({ ...state, completedExpeditions: 2 }, station, 'warlord'),
    null
  );
  assert.equal(
    generateIncreaseCapacityCandidate(
      {
        ...state,
        visibleStations: [
          {
            id: 'foreign-station',
            name: 'Foreign Station',
            x: 100,
            y: 0,
            chunkX: 0,
            chunkY: 0,
            ownerType: 'player',
            ownerId: 'opponent-1',
            isOwn: false,
            scanned: true,
            integrity: null,
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
                armor_plating: 0,
                guardian_cannon: 0,
                defense_drones: 0,
                minefield: 0,
              },
              traffic: { civilian: 0, military: 0 },
            },
          },
        ],
      },
      station,
      'warlord'
    ),
    null
  );
});

test('income expansion prepares enough hangar crew for a Titan', async () => {
  const station = baseStation({
    resources: { carbon: 10_000, titanium: 10_000, hydrogenium: 10_000, kyber_crystal: 1_000 },
    buildings: baseStation().buildings.map((building) =>
      building.buildingKey === 'shipyard' ? { ...building, level: 5 } : building
    ),
    fleets: [
      { spacecraftKey: 'mole', amount: 3, lockedAmount: 3 },
      { spacecraftKey: 'merlin', amount: 14, lockedAmount: 0 },
    ],
    research: { extraction_algorithms: 4, cargo_compression: 3 },
  });
  const result = await stepIncreaseIncome(baseState(station), station, 'warlord');

  assert.equal(result.type, 'success');
  assert.equal(result.intent.type, 'upgrade_building');
  assert.equal(result.intent.buildingKey, 'hangar');
});

test('income goal hands a Titan that only lacks research to the research goal', () => {
  const fleets = [{ spacecraftKey: 'mole', amount: 3, lockedAmount: 0 }];
  const resources = { carbon: 10_000, titanium: 10_000, hydrogenium: 10_000, kyber_crystal: 1_000 };
  const shipyard = (level: number) =>
    baseStation().buildings.map((building) =>
      building.buildingKey === 'shipyard' ? { ...building, level } : building
    );
  const income = (station: ReturnType<typeof baseStation>) =>
    generateIncreaseIncomeCandidate(baseState(station), station)?.goalType;

  // The Shipyard upgrade stays this goal's step.
  assert.equal(
    income(baseStation({ resources, fleets, buildings: shipyard(1) })),
    'increase_income'
  );
  assert.equal(income(baseStation({ resources, fleets, buildings: shipyard(5) })), undefined);
  assert.equal(
    income(
      baseStation({
        resources,
        fleets,
        buildings: shipyard(5),
        research: { extraction_algorithms: 4, cargo_compression: 3 },
      })
    ),
    'increase_income'
  );
});

test('saving goals send an idle miner toward their missing resource', async () => {
  const station = baseStation({
    resources: { carbon: 1_000, titanium: 1_000, hydrogenium: 1_000, kyber_crystal: 0 },
    buildings: baseStation().buildings.map((building) =>
      building.buildingKey === 'shipyard' ? { ...building, level: 5 } : building
    ),
    fleets: [{ spacecraftKey: 'mole', amount: 3, lockedAmount: 2 }],
    research: { extraction_algorithms: 4, cargo_compression: 3 },
    miningAssignments: [
      {
        id: 'assignment-1',
        asteroidId: 'carbon-field',
        spacecraftKey: 'mole',
        assignedAmount: 2,
        status: 'mining',
      },
    ],
  });
  const state = baseState(station, {
    visibleAsteroids: [
      {
        id: 'carbon-field',
        x: 10,
        y: 0,
        remainingByResource: { carbon: 10_000 },
        remainingAmount: 10_000,
      },
      {
        id: 'kyber-field',
        x: 1_000,
        y: 0,
        remainingByResource: { kyber_crystal: 10_000 },
        remainingAmount: 10_000,
      },
    ],
  });
  const result = await stepIncreaseIncome(state, station, 'technocrat');

  assert.equal(result.type, 'success');
  assert.equal(result.intent.type, 'assign_miner');
  assert.equal(result.intent.asteroidId, 'kyber-field');
});

test('visible resources without a usable miner are not treated as an income path', () => {
  const station = baseStation({
    resources: { carbon: 0, titanium: 0, hydrogenium: 0 },
    fleets: [{ spacecraftKey: 'mole', amount: 1, lockedAmount: 1 }],
  });
  const state = baseState(station, {
    visibleAsteroids: [
      {
        id: 'rich-field',
        x: 100,
        y: 0,
        remainingByResource: { carbon: 10_000, titanium: 10_000, hydrogenium: 10_000 },
        remainingAmount: 30_000,
      },
    ],
  });

  assert.equal(generateIncreaseIncomeCandidate(state, station), null);
});

test('resource costs above local storage capacity are not treated as mineable', async () => {
  const station = baseStation({
    storageCapacity: 50,
    resources: { carbon: 0, titanium: 0, hydrogenium: 0 },
    fleets: [{ spacecraftKey: 'mole', amount: 1, lockedAmount: 0 }],
  });
  const state = baseState(station, {
    visibleAsteroids: [
      {
        id: 'rich-field',
        x: 100,
        y: 0,
        remainingByResource: { carbon: 10_000, titanium: 10_000, hydrogenium: 10_000 },
        remainingAmount: 30_000,
      },
    ],
  });

  assert.equal(generateIncreaseIncomeCandidate(state, station), null);
  assert.equal((await stepIncreaseIncome(state, station, 'industrialist')).type, 'blocked');
});

test('colonization prepares a free miner instead of blocking on locked mining ships', async () => {
  const station = baseStation({
    fleets: [{ spacecraftKey: 'mole', amount: 1, lockedAmount: 1 }],
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
  const state = baseState(station);
  const result = await stepEstablishColony(state, station, 'sector:1:0', 'pioneer');

  assert.equal(result.type, 'success');
  assert.equal(result.intent.type, 'build_spacecraft');
  assert.equal(result.intent.spacecraftKey, 'mole');
});

test('active expansion keeps its last free support miner out of urgent mining', async () => {
  const onlySupportMiner = baseStation({
    fleets: [{ spacecraftKey: 'mole', amount: 1, lockedAmount: 0 }],
  });
  const activeGoal = {
    goalType: 'explore_sector',
    targetRef: 'sector:1:0',
  };
  assert.equal(
    await checkUrgentMaintenance(baseState(onlySupportMiner), 'pioneer', {}, activeGoal),
    null
  );

  const otherStation = baseStation({
    id: 'station-2',
    createdAt: new Date(1),
    sectorX: 10,
    fleets: [{ spacecraftKey: 'mole', amount: 1, lockedAmount: 0 }],
  });
  const otherAssignment = await checkUrgentMaintenance(
    baseState(onlySupportMiner, { ownStations: [onlySupportMiner, otherStation] }),
    'pioneer',
    {},
    activeGoal
  );
  assert.equal(
    otherAssignment?.type === 'success' && otherAssignment.intent.type === 'assign_miner'
      ? otherAssignment.intent.stationId
      : null,
    'station-2'
  );

  const station = baseStation({
    fleets: [{ spacecraftKey: 'mole', amount: 2, lockedAmount: 1 }],
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
  const result = await checkUrgentMaintenance(baseState(station), 'pioneer', {}, activeGoal);

  assert.equal(result, null);

  const stationWithSpareMiner = {
    ...station,
    fleets: [{ spacecraftKey: 'mole', amount: 3, lockedAmount: 1 }],
  };
  const assignment = await checkUrgentMaintenance(
    baseState(stationWithSpareMiner),
    'pioneer',
    {},
    activeGoal
  );
  assert.equal(assignment?.type, 'success');
  assert.equal(assignment.intent.type, 'assign_miner');
});

test('research does not claim to save when the station has no income', async () => {
  const station = baseStation({
    resources: { carbon: 0, titanium: 0, hydrogenium: 0 },
  });
  const result = await stepResearchTechnology(
    baseState(station),
    station,
    'tech:station-1:extraction_algorithms:1',
    'technocrat'
  );
  assert.equal(result.type, 'blocked');
});

test('research candidates require a reachable resource and laboratory path', () => {
  const noIncome = baseStation({
    resources: { carbon: 1, titanium: 1, hydrogenium: 1 },
    research: { extraction_algorithms: 1 },
  });
  assert.deepEqual(generateResearchCandidates(baseState(noIncome), noIncome), []);

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
  assert.ok(
    generateResearchCandidates(
      baseState(withIncome, {
        visibleAsteroids: [
          {
            id: 'asteroid-1',
            x: 100,
            y: 0,
            remainingByResource: {
              carbon: 1_000,
              titanium: 1_000,
              hydrogenium: 1_000,
            },
            remainingAmount: 3_000,
          },
        ],
      }),
      withIncome
    ).length > 0
  );
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
  assert.equal(result.intent.type, 'assign_miner');
  assert.equal(result.intent.stationId, 'station-colony');
  assert.equal(result.intent.spacecraftKey, 'titan');
});

const shipyardAt = (level: number, laboratory = 1) =>
  baseStation().buildings.map((building) =>
    building.buildingKey === 'shipyard'
      ? { ...building, level }
      : building.buildingKey === 'laboratory'
        ? { ...building, level: laboratory }
        : building
  );

test('a warlord without Weapons researches Weapons before it builds Merlins', async () => {
  const station = baseStation({
    buildings: shipyardAt(2),
    resources: { carbon: 1_000, titanium: 1_000, hydrogenium: 1_000 },
  });
  const state = baseState(station);
  assert.equal(generateBuildStrikeForceCandidate(state, station), null);
  const strike = await stepBuildStrikeForce(state, station, `station:${station.id}`, 'warlord');
  assert.equal(strike.type === 'blocked' && strike.detail, 'research_locked');
  const [best] = generateResearchCandidates(state, station, 'warlord').sort(
    (a, b) => b.baseNeed - a.baseNeed
  );
  assert.equal(best?.targetRef, 'tech:station-1:weapons:1');
});

test('a needed research behind the laboratory cap upgrades the laboratory first', async () => {
  const station = baseStation({
    buildings: shipyardAt(5, 3),
    resources: { carbon: 5_000, titanium: 5_000, hydrogenium: 5_000, kyber_crystal: 500 },
    fleets: [{ spacecraftKey: 'mole', amount: 3, lockedAmount: 0 }],
    research: { extraction_algorithms: 3, cargo_compression: 3 },
  });
  const state = baseState(station);
  const titanStep = await stepIncreaseIncome(state, station, 'industrialist');
  assert.equal(titanStep.type, 'blocked');

  const extraction = generateResearchCandidates(state, station).find((candidate) =>
    candidate.targetRef.endsWith(':extraction_algorithms:4')
  );
  assert.ok(extraction, 'the Titan unlock should stay a candidate despite the lab cap');
  const step = await stepResearchTechnology(state, station, extraction.targetRef, 'technocrat');
  assert.equal(step.type, 'success');
  assert.deepEqual(step.intent, {
    type: 'upgrade_building',
    stationId: 'station-1',
    buildingKey: 'laboratory',
  });
});

test('raid sends the smallest sufficient fighter group with every docked bomber', async () => {
  const station = baseStation({
    fleets: [
      { spacecraftKey: 'merlin', amount: 10, lockedAmount: 0 },
      { spacecraftKey: 'javelin', amount: 1, lockedAmount: 0 },
      { spacecraftKey: 'hammer', amount: 3, lockedAmount: 1 },
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
        scanned: true,
        integrity: null,
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
  assert.deepEqual(result.intent.type === 'start_attack' ? result.intent.fleet : null, {
    javelin: 1,
    hammer: 2,
  });
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
    scanned: true,
    integrity: null,
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
  assert.equal(result.intent.type, 'build_spacecraft');
  assert.equal(result.intent.spacecraftKey, 'collector');
});

test('started research is excluded from candidates', () => {
  const station = baseStation();
  const candidates = generateResearchCandidates(
    baseState(station, { research: { levels: {}, active: ['extraction_algorithms'], slots: 2 } }),
    station
  );
  const extraction = candidates.find((c) => c.targetRef.includes('extraction_algorithms'));
  assert.equal(extraction, undefined, 'started research should be excluded');
});

// ---------------------------------------------------------------------------
// Adaptive category weights
// ---------------------------------------------------------------------------

test('a prolonged saving goal loses weight until a research goal takes over', () => {
  const saving = cand({ goalType: 'increase_capacity', targetRef: 'station:a', commitment: 25 });
  const research = cand({
    goalType: 'research_technology',
    targetRef: 'tech:x',
    category: 'research',
  });
  const active = { goalType: saving.goalType, targetRef: saving.targetRef };
  let weights = categoryWeightsFor('industrialist', null);
  assert.equal(
    selectGoal([saving, research], 'industrialist', active, weights).selected?.goalType,
    saving.goalType
  );

  let intervals = 0;
  while (
    selectGoal([saving, research], 'industrialist', active, weights).selected?.goalType ===
    saving.goalType
  ) {
    weights = adaptCategoryWeights(weights, 'industrialist', [
      { goalType: 'increase_capacity', signal: 'saving' },
    ]);
    intervals += 1;
    saving.commitment = activeGoalCommitment(intervals * 60_000);
    assert.ok(intervals < 60, 'saving pressure must eventually allow a switch');
  }
  assert.ok(intervals > 5, 'hysteresis still protects the goal for several intervals');
  assert.ok(weights.economy >= 0.4);
});

test('outcomes shift weights and they revert toward the profile start weights', () => {
  const base = CATEGORY_WEIGHTS.pioneer;
  const completed = adaptCategoryWeights(base, 'pioneer', [
    { goalType: 'research_technology', signal: 'complete' },
  ]);
  assert.ok(completed.research > base.research);
  const released = adaptCategoryWeights(base, 'pioneer', [
    { goalType: 'raid', signal: 'released' },
  ]);
  assert.ok(released.conflict < base.conflict);

  let drifted = { ...base, research: 2 };
  for (let i = 0; i < 200; i += 1) drifted = adaptCategoryWeights(drifted, 'pioneer', []);
  assert.ok(Math.abs(drifted.research - base.research) < 0.05);
  assert.deepEqual(categoryWeightsFor('pioneer', { research: Number.NaN }), base);
});
