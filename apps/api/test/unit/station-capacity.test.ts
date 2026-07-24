import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateHangarCapacity, spacecrafts } from '@orions-frontier/game-config';

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
