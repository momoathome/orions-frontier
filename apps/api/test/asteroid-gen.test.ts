import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD_CONFIG } from '../src/lib/world-config.js';
import { buildAsteroid } from '../src/lib/world-gen/asteroid-gen.js';
import { SeededRng } from '../src/lib/world-gen/rng.js';

test('generates one finite resource budget distributed across all veins', () => {
  const asteroid = buildAsteroid(
    0,
    0,
    'carbon',
    [
      { resource: 'titanium', weight: 1 },
      { resource: 'hydrogenium', weight: 1 },
    ],
    new SeededRng('finite-reserve-test'),
    { small: 1, medium: 0, large: 0, massive: 0 }
  );

  const total = asteroid.veins.reduce((sum, vein) => sum + vein.remainingAmount, 0);
  const range = WORLD_CONFIG.ASTEROID_RESOURCE_AMOUNT.small;

  assert.ok(total >= range.min && total <= range.max);
  assert.ok(asteroid.veins.every((vein) => vein.remainingAmount > 0));
});
