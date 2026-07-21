import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EconomicBotState } from '../../src/services/bot/economic-v1.js';
import { decideEconomicAction } from '../../src/services/bot/economic-v1.js';

const baseState = (): EconomicBotState => ({
  userId: 'bot',
  station: { id: 'station', x: 0, y: 0 },
  resources: {},
  shipyardLevel: 1,
  shipyardUpgradeInProgress: false,
  ships: {
    mole: {
      spacecraftKey: 'mole',
      key: 'mole',
      amount: 1,
      lockedAmount: 0,
      inBuild: 0,
      cargo: 100,
      speed: 80,
      miningRate: 120,
    },
    titan: {
      spacecraftKey: 'titan',
      key: 'titan',
      amount: 0,
      lockedAmount: 0,
      inBuild: 0,
      cargo: 300,
      speed: 70,
      miningRate: 500,
    },
  },
  asteroids: [
    {
      id: 'carbon-near',
      x: 100,
      y: 0,
      remainingByResource: { carbon: 10_000 },
      remainingAmount: 10_000,
    },
  ],
});

test('assigns an available miner to the best valid asteroid candidate', () => {
  const state = baseState();
  state.asteroids.unshift({
    id: 'empty',
    x: 10,
    y: 0,
    remainingByResource: { carbon: 0 },
    remainingAmount: 0,
  });

  assert.deepEqual(decideEconomicAction(state), {
    type: 'assign_miner',
    stationId: 'station',
    asteroidId: 'carbon-near',
    spacecraftKey: 'mole',
    amount: 1,
    reason: 'mole assigned to the best available mining yield',
  });
});

test('prefers the resource missing for the next investment', () => {
  const state = baseState();
  state.resources = { carbon: 1_000, titanium: 1_000, hydrogenium: 0 };
  state.asteroids = [
    { ...state.asteroids[0]!, id: 'carbon', remainingByResource: { carbon: 10_000 } },
    { ...state.asteroids[0]!, id: 'hydrogen', remainingByResource: { hydrogenium: 10_000 } },
  ];

  const intent = decideEconomicAction(state);
  assert.equal(intent.type === 'assign_miner' ? intent.asteroidId : undefined, 'hydrogen');
});

test('builds, upgrades and unlocks through the economic progression', () => {
  const state = baseState();
  state.asteroids = [];
  state.resources = { carbon: 10_000, titanium: 10_000, hydrogenium: 10_000, kyber_crystal: 100 };
  state.ships.mole!.lockedAmount = 1;

  assert.equal(decideEconomicAction(state).type, 'build_spacecraft');

  state.ships.mole!.amount = 3;
  assert.deepEqual(decideEconomicAction(state), {
    type: 'upgrade_building',
    stationId: 'station',
    buildingKey: 'shipyard',
    reason: 'Upgrading Shipyard to level 2',
  });

  state.shipyardLevel = 5;
  const titanIntent = decideEconomicAction(state);
  assert.equal(
    titanIntent.type === 'build_spacecraft' ? titanIntent.spacecraftKey : undefined,
    'titan'
  );
});

test('waits without inventing progress when no action is affordable', () => {
  const state = baseState();
  state.asteroids = [];
  state.ships.mole!.lockedAmount = 1;
  assert.deepEqual(decideEconomicAction(state), {
    type: 'wait',
    reason: 'Saving resources for a Mole',
  });
});

test('returns the same intent for the same state', () => {
  const state = baseState();

  assert.deepEqual(decideEconomicAction(state), decideEconomicAction(state));
});
