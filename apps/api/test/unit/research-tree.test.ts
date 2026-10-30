import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateBuildingUpgradeCost,
  calculateResearchCost,
  calculateResearchDuration,
  defenseUpgrades,
  researchBlockers,
  researchDefinitions,
  researchModifiers,
  researchRequirements,
  spacecrafts,
} from '@orions-frontier/game-config';
import {
  buildingKeys,
  entriesOf,
  researchKeys,
  type BuildingLevels,
  type ResearchKey,
  type ResearchLevels,
  type ResourceKey,
} from '@orions-frontier/shared';

/** Every research and building level needed to research `key` up to `level`, transitively. */
function closure(
  key: ResearchKey,
  level = 1
): { research: ResearchLevels; buildings: BuildingLevels } {
  const research: ResearchLevels = {};
  const buildings: BuildingLevels = {};
  const visit = (current: ResearchKey, target: number) => {
    if ((research[current] ?? 0) >= target) return;
    research[current] = target;
    // The Laboratory caps research levels.
    buildings.laboratory = Math.max(buildings.laboratory ?? 0, target);
    const requirements = researchRequirements(current, target);
    for (const [building, needed] of entriesOf(requirements.buildings ?? {})) {
      buildings[building] = Math.max(buildings[building] ?? 0, needed);
    }
    for (const [prerequisite, needed] of entriesOf(requirements.research ?? {})) {
      visit(prerequisite, needed);
    }
  };
  visit(key, level);
  return { research, buildings };
}

function resourcesNeeded(path: ReturnType<typeof closure>): Set<ResourceKey> {
  const used = new Set<ResourceKey>();
  for (const [key, level] of entriesOf(path.research)) {
    for (let target = 1; target <= level; target++) {
      for (const cost of calculateResearchCost(key, target)) used.add(cost.resourceKey);
    }
  }
  for (const key of buildingKeys) {
    for (let target = 2; target <= (path.buildings[key] ?? 1); target++) {
      for (const cost of calculateBuildingUpgradeCost(key, target)) used.add(cost.resourceKey);
    }
  }
  return used;
}

test('research tree: keys match, prerequisites sit in the same or an earlier tier, no cycles', () => {
  assert.deepEqual(
    researchDefinitions.map((definition) => definition.key),
    [...researchKeys]
  );
  for (const definition of researchDefinitions) {
    for (const prerequisite of Object.keys(definition.requirements.research ?? {})) {
      const required = researchDefinitions.find((other) => other.key === prerequisite);
      assert.ok(required, `${definition.key} needs unknown ${prerequisite}`);
      assert.ok(required.tier <= definition.tier, `${definition.key} needs later ${prerequisite}`);
    }
    // closure() recurses through all prerequisites; a cycle would recurse forever.
    closure(definition.key, definition.maxLevel);
  }
  for (const lane of ['extraction', 'sensors', 'engineering', 'military']) {
    assert.ok(
      researchDefinitions.some((definition) => definition.lane === lane && definition.tier === 5),
      `${lane} has a Tier 5 node`
    );
  }
});

test('research cost and duration scale by tier and level, the Laboratory speeds research up', () => {
  assert.deepEqual(calculateResearchCost('weapons', 1), [
    { resourceKey: 'hydrogenium', amount: 150 },
  ]);
  assert.deepEqual(calculateResearchCost('weapons', 2), [
    { resourceKey: 'hydrogenium', amount: 230 },
  ]);
  assert.deepEqual(
    calculateResearchCost('fleet_coordination', 1).map((cost) => cost.resourceKey),
    ['hydrogenium', 'kyber_crystal', 'astatine']
  );
  assert.equal(calculateResearchDuration('weapons', 1, 1), 600);
  assert.equal(calculateResearchDuration('weapons', 2, 1), 900);
  // Laboratory 11 takes 20% off.
  assert.equal(calculateResearchDuration('weapons', 1, 11), 480);
});

test('research blockers report tier gate, prerequisites, lab cap and max level', () => {
  assert.deepEqual(researchBlockers('weapons', {}, { laboratory: 1 }), []);
  assert.deepEqual(researchBlockers('weapons', { weapons: 1 }, { laboratory: 1 }), [
    { type: 'lab_cap', level: 2, current: 1 },
  ]);
  assert.deepEqual(researchBlockers('spectral_analysis', { sensor_arrays: 2 }, { laboratory: 2 }), [
    { type: 'building', key: 'scanner', level: 3, current: 0 },
    { type: 'building', key: 'laboratory', level: 3, current: 2 },
  ]);
  assert.deepEqual(
    researchBlockers(
      'parallel_construction',
      { parallel_construction: 1, construction_robotics: 4 },
      {
        laboratory: 5,
        core: 6,
      }
    ),
    [
      { type: 'building', key: 'core', level: 12, current: 6 },
      { type: 'research', key: 'spectral_analysis', level: 1, current: 0 },
    ]
  );
  assert.deepEqual(researchBlockers('research_network', { research_network: 1 }, {}), [
    { type: 'maxed' },
  ]);
});

test('kyber and astatine are never needed before the research that reveals them', () => {
  const spectral = resourcesNeeded(closure('spectral_analysis'));
  assert.ok(!spectral.has('kyber_crystal') && !spectral.has('astatine'), [...spectral].join());
  const deep = closure('deep_spectral_analysis');
  // Deep Spectral needs Spectral, so Kyber is fine here, Astatine is not.
  assert.ok(!resourcesNeeded(deep).has('astatine'));
  assert.deepEqual(closure('spectral_analysis').buildings, { laboratory: 3, scanner: 3 });
});

test('every ship and defense unlock is reachable and the starter units need nothing', () => {
  for (const unit of [...spacecrafts, ...defenseUpgrades]) {
    for (const [key, level] of entriesOf(unit.requirements.research ?? {})) {
      const definition = researchDefinitions.find((candidate) => candidate.key === key);
      assert.ok(definition && level <= definition.maxLevel, `${unit.key} needs ${key} ${level}`);
    }
  }
  assert.deepEqual(spacecrafts.find((ship) => ship.key === 'mole')?.requirements, {});
  assert.deepEqual(
    defenseUpgrades.find((upgrade) => upgrade.key === 'armor_plating')?.requirements,
    {}
  );
});

test('research modifiers follow the levels', () => {
  const none = researchModifiers({});
  assert.equal(none.miningRate, 1);
  assert.equal(none.buildSlots, 1);
  assert.equal(none.stationLimit, 1);
  assert.equal(none.canExplore, false);
  assert.deepEqual(none.visibleResources, ['carbon', 'titanium', 'hydrogenium']);

  const full = researchModifiers({
    extraction_algorithms: 10,
    deep_core_drilling: 5,
    nanite_assembly: 5,
    parallel_construction: 2,
    colony_logistics: 3,
    frontier_charter: 2,
    long_range_survey: 1,
    spectral_analysis: 1,
    deep_spectral_analysis: 1,
  });
  assert.equal(full.miningRate, 1.5);
  assert.equal(full.yield, 1.3);
  assert.equal(full.buildingCost, 0.8);
  assert.equal(full.buildSlots, 3);
  assert.equal(full.stationLimit, 6);
  assert.equal(full.expeditionLimit, 3);
  assert.equal(full.canExplore, true);
  assert.deepEqual(full.visibleResources, [
    'carbon',
    'titanium',
    'hydrogenium',
    'kyber_crystal',
    'astatine',
  ]);
});

test('the effect shown in the tree matches what one level changes', () => {
  const base = researchModifiers({});
  const field: Partial<Record<ResearchKey, keyof typeof base>> = {
    extraction_algorithms: 'miningRate',
    cargo_compression: 'cargo',
    deep_core_drilling: 'yield',
    ion_propulsion: 'speed',
    sensor_arrays: 'scannerRange',
    colony_logistics: 'stationLimit',
    frontier_charter: 'expeditionLimit',
    construction_robotics: 'constructionBonus',
    fabrication_lines: 'shipBuildBonus',
    parallel_construction: 'buildSlots',
    research_network: 'researchSlots',
    nanite_assembly: 'buildingCost',
    weapons: 'attack',
    armor: 'shipDefense',
    shields: 'stationDefense',
    fleet_coordination: 'crew',
  };
  for (const definition of researchDefinitions.filter((d) => d.effect)) {
    const key = field[definition.key];
    assert.ok(key, `${definition.key} has no modifier mapping`);
    const delta = Math.abs(
      Number(researchModifiers({ [definition.key]: 1 })[key]) - Number(base[key])
    );
    const expected = definition.effect!.format === 'count' || key.endsWith('Bonus') ? 1 : 0.01;
    assert.ok(
      Math.abs(delta - definition.effect!.perLevel * expected) < 1e-9,
      `${definition.key}: tree says ${definition.effect!.perLevel}, code changes ${delta}`
    );
  }
});
