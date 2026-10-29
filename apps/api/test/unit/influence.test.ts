import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateInfluence } from '@orions-frontier/game-config';

test('influence counts invested resources per category, the fleet at half its build cost', () => {
  const influence = calculateInfluence({
    levels: [
      // Core 3: upgrades to 2 (380) and 3 (570); the seeded level 1 is free.
      { key: 'core', level: 3 },
      { key: 'warehouse', level: 1 },
      // Armor Plating starts at 0, so level 1 cost 200.
      { key: 'armor_plating', level: 1 },
      { key: 'unknown_building', level: 9 },
    ],
    completedResearch: ['automated_shipyard'],
    // Two Merlins cost 400, counted at 50%.
    spacecrafts: [
      { key: 'merlin', amount: 2 },
      { key: 'unknown_ship', amount: 5 },
    ],
  });
  assert.deepEqual(influence, { buildings: 10, research: 4, defense: 2, fleet: 2, total: 18 });
});
