import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildStationVisualProfile,
  levelVisualTier,
  trafficVisualTier,
} from '../../src/services/station/visual.js';

test('station visual levels are projected into coarse tiers', () => {
  assert.equal(levelVisualTier(0), 0);
  assert.equal(levelVisualTier(1), 1);
  assert.equal(levelVisualTier(4), 1);
  assert.equal(levelVisualTier(5), 2);
  assert.equal(levelVisualTier(9), 2);
  assert.equal(levelVisualTier(10), 3);
});

test('station visual traffic is projected into coarse tiers', () => {
  assert.equal(trafficVisualTier(0), 0);
  assert.equal(trafficVisualTier(1), 1);
  assert.equal(trafficVisualTier(4), 1);
  assert.equal(trafficVisualTier(5), 2);
  assert.equal(trafficVisualTier(14), 2);
  assert.equal(trafficVisualTier(15), 3);
});

test('station visual profile exposes modules and traffic without exact levels', () => {
  const profile = buildStationVisualProfile(
    {
      core: 11,
      hangar: 7,
      scanner: 3,
      laboratory: 1,
      shipyard: 5,
      warehouse: 9,
    },
    {
      armor_plating: 6,
      guardian_cannon: 10,
      defense_drones: 3,
      minefield: 0,
    },
    { civilian: 8, military: 18 }
  );

  assert.deepEqual(profile.modules, {
    core: 3,
    hangar: 2,
    scanner: 1,
    laboratory: 1,
    shipyard: 2,
    warehouse: 2,
  });
  assert.deepEqual(profile.defense, {
    armor_plating: 2,
    guardian_cannon: 3,
    defense_drones: 1,
    minefield: 0,
  });
  assert.equal(profile.scaleTier, 2);
  assert.deepEqual(profile.traffic, { civilian: 2, military: 3 });
});
