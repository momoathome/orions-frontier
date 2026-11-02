import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StationVisualProfile } from '@orions-frontier/shared';
import {
  forecastAttack,
  forecastFromScouting,
  lootRange,
} from '../../src/services/combat/forecast.js';

// Armor and Guardian at tier 1 count as level 4 each: 24 + 48 = 72 estimated defense.
const target: StationVisualProfile = {
  scaleTier: 1,
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Fixture: die Prognose liest keine Module.
  modules: {} as StationVisualProfile['modules'],
  defense: { armor_plating: 1, guardian_cannon: 1, defense_drones: 0, minefield: 0 },
  traffic: { civilian: 0, military: 0 },
};
const research = { attack: 1, cargo: 1 };
const stock = {
  resources: [
    { resourceKey: 'hydrogenium', amount: 2_000 },
    { resourceKey: 'carbon', amount: 15_100 },
  ],
  protectedAmount: 100,
};
const merlins = (amount: number) => [
  { key: 'merlin', amount, spacecraft: { attack: 15, cargo: 100 } },
];

test('the forecast bands follow the battle rule against the estimated defense', () => {
  // 60 attack does not beat 72; 90 does; 150 also beats 40% more.
  assert.deepEqual(forecastAttack(merlins(4), target, research, stock), {
    winChance: 'low',
    loot: {},
    basis: 'scanner',
  });
  assert.equal(forecastAttack(merlins(6), target, research, stock).winChance, 'medium');
  assert.equal(forecastAttack(merlins(10), target, research, stock).winChance, 'high');
});

test('the loot forecast plunders in key order with the expected survivors cargo', () => {
  // 90 against 72 costs floor(6 × 0.8^1.5) = 4 Merlins; 2 survivors carry 200 of Carbon's 4,500.
  assert.deepEqual(forecastAttack(merlins(6), target, research, stock).loot, {
    carbon: { min: 200, max: 300 },
  });
  // 450 against 72 costs 1 of 30 Merlins; 2,900 cargo fills up with Carbon alone.
  assert.deepEqual(forecastAttack(merlins(30), target, research, stock).loot, {
    carbon: { min: 2_000, max: 3_000 },
  });
  // 60 Merlins: 5,900 cargo takes all 4,500 Carbon, then 570 of Hydrogenium's 570.
  assert.deepEqual(forecastAttack(merlins(60), target, research, stock).loot, {
    carbon: { min: 4_000, max: 5_000 },
    hydrogenium: { min: 500, max: 600 },
  });
});

test('outside the scanner the last report stands in for the scanner, without loot', () => {
  // Reported defense 40 + 4 docked Moles (12) = 52.
  const scouting = { stationDefense: 40, dockedShips: { mole: 4 } };
  assert.deepEqual(forecastFromScouting(merlins(3), scouting, research), {
    winChance: 'low',
    loot: {},
    basis: 'last_report',
  });
  assert.equal(forecastFromScouting(merlins(4), scouting, research).winChance, 'medium');
  assert.equal(forecastFromScouting(merlins(6), scouting, research).winChance, 'high');
});

test('loot ranges step by the leading digit and always hold the amount', () => {
  assert.deepEqual(lootRange(1_234), { min: 1_000, max: 2_000 });
  assert.deepEqual(lootRange(450), { min: 400, max: 500 });
  assert.deepEqual(lootRange(9), { min: 9, max: 10 });
});
