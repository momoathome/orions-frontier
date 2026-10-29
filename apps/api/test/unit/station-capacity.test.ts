import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildings,
  calculateBuildingEffect,
  calculateBuildingUpgradeCost,
  calculateHangarCapacity,
  spacecrafts,
} from '@orions-frontier/game-config';

test('hangar capacity and spacecraft crew requirements match the balancing contract', () => {
  assert.equal(calculateHangarCapacity(1), 20);
  assert.equal(calculateHangarCapacity(12), 130);
  assert.deepEqual(Object.fromEntries(spacecrafts.map(({ key, crew }) => [key, crew])), {
    merlin: 1,
    comet: 2,
    javelin: 4,
    sentinel: 5,
    ares: 15,
    nova: 20,
    horus: 60,
    reaper: 120,
    mole: 2,
    titan: 10,
    collector: 2,
    reclaimer: 8,
  });
});

test('warehouse storage always fits the next upgrade of any building at the same level', () => {
  const storage = (level: number) =>
    calculateBuildingEffect('warehouse', level).find(({ type }) => type === 'storage_capacity')!
      .value;
  assert.equal(storage(1), 5_000);
  for (let level = 1; level < 20; level += 1) {
    for (const building of buildings.filter(({ maxLevel }) => level < maxLevel)) {
      for (const { amount } of calculateBuildingUpgradeCost(building.key, level + 1)) {
        assert.ok(amount <= storage(level), `${building.key} L${level + 1} needs ${amount}`);
      }
    }
  }
});
