import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StationVisualProfile } from '@orions-frontier/shared';
import { forecastAttack, lootRange } from '../../src/services/combat/forecast.js';

// Armor and Guardian at tier 1 count as level 4 each: 24 + 48 = 72 estimated defense.
const target: StationVisualProfile = {
  scaleTier: 1,
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Fixture: die Prognose liest keine Module.
  modules: {} as StationVisualProfile['modules'],
  defense: { armor_plating: 1, guardian_cannon: 1, defense_drones: 0, minefield: 0 },
  traffic: { civilian: 0, military: 0 },
};
const research = { attack: 1, shipDefense: 1, cargo: 1 };
const stock = {
  resources: [
    { resourceKey: 'hydrogenium', amount: 2_000 },
    { resourceKey: 'carbon', amount: 15_100 },
  ],
  protectedAmount: 100,
};
const merlins = (amount: number) => [
  { key: 'merlin', amount, spacecraft: { attack: 15, defense: 8, cargo: 100 } },
];

test('the forecast bands follow the battle rule against the estimated defense', () => {
  // 60 attack does not beat 72; 10 Merlins win but 9 of them fall; 20 also beat 40% more.
  assert.deepEqual(forecastAttack(merlins(4), target, research, stock), {
    winChance: 'low',
    loot: {},
  });
  assert.equal(forecastAttack(merlins(10), target, research, stock).winChance, 'medium');
  assert.equal(forecastAttack(merlins(20), target, research, stock).winChance, 'high');
});

test('the loot forecast plunders in key order with the expected survivors cargo', () => {
  // 11 of 20 Merlins survive with 1,100 cargo. Carbon comes first and offers 1,500, so the cargo
  // is full before Hydrogenium: 1,100 Carbon, shown as 1,000-2,000.
  assert.deepEqual(forecastAttack(merlins(20), target, research, stock).loot, {
    carbon: { min: 1_000, max: 2_000 },
  });
  // 10 Merlins: 1 survivor carries 100.
  assert.deepEqual(forecastAttack(merlins(10), target, research, stock).loot, {
    carbon: { min: 100, max: 200 },
  });
});

test('loot ranges step by the leading digit and always hold the amount', () => {
  assert.deepEqual(lootRange(1_234), { min: 1_000, max: 2_000 });
  assert.deepEqual(lootRange(450), { min: 400, max: 500 });
  assert.deepEqual(lootRange(9), { min: 9, max: 10 });
});
