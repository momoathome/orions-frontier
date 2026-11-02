import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateBuildingUpgradeCost,
  calculateInfluence,
  investedUpgradeCosts,
} from '@orions-frontier/game-config';

test('influence counts invested resources per category, the fleet at half its build cost', () => {
  const influence = calculateInfluence({
    levels: [
      // Core 3: upgrades to 2 (800) and 3 (1280); the seeded level 1 is free.
      { key: 'core', level: 3 },
      { key: 'warehouse', level: 1 },
      // Armor Plating starts at 0, so level 1 cost 200.
      { key: 'armor_plating', level: 1 },
      { key: 'unknown_building', level: 9 },
    ],
    // Weapons 1 and 2 cost 530 + 800 in Hydrogenium, Carbon and Titanium.
    research: { weapons: 2 },
    // Two Merlins cost 400, counted at 50%.
    spacecrafts: [
      { key: 'merlin', amount: 2 },
      { key: 'unknown_ship', amount: 5 },
    ],
  });
  assert.deepEqual(influence, { buildings: 21, research: 13, defense: 2, fleet: 2, total: 38 });
});

test('invested upgrade costs list every paid upgrade above the free starting level', () => {
  assert.deepEqual(investedUpgradeCosts('core', 3), [
    ...calculateBuildingUpgradeCost('core', 2),
    ...calculateBuildingUpgradeCost('core', 3),
  ]);
  const total = (key: string, level: number) =>
    investedUpgradeCosts(key, level).reduce((sum, cost) => sum + cost.amount, 0);
  assert.equal(total('core', 3), 2_080);
  assert.equal(total('armor_plating', 1), 200);
  assert.deepEqual(investedUpgradeCosts('core', 1), []);
  assert.deepEqual(investedUpgradeCosts('unknown_building', 9), []);
});
