import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  summarizeStationIncome,
  type AsteroidDetail,
  type AsteroidDetailAssignment,
} from '@orions-frontier/shared';

const hour = 3_600_000;

function assignment(
  stationId: string,
  activeTrip: AsteroidDetailAssignment['activeTrip']
): AsteroidDetailAssignment {
  return {
    id: `${stationId}-assignment`,
    stationId,
    spacecraftKey: 'mole',
    spacecraftName: 'Mole',
    spacecraftMiningRate: 100,
    spacecraftCargo: 100,
    assignedAmount: 2,
    assignedAt: new Date(0).toISOString(),
    recallRequestedAt: null,
    recallRequestedAmount: 0,
    activeTrip,
  };
}

// 1 h out, 1 h mining, 1 h back: 2 miners × 100 cargo / 3 h ≈ 66.7/h per station.
const asteroid: AsteroidDetail = {
  id: 'rock',
  x: 0,
  y: 0,
  chunkX: 0,
  chunkY: 0,
  createdAt: '',
  updatedAt: '',
  scanned: true,
  size: 'small',
  operationsVisible: true,
  inTransit: {},
  veins: [
    {
      id: 'a',
      veinType: 'primary',
      resourceKey: 'carbon',
      remainingAmount: 750,
      initialAmount: 750,
    },
    {
      id: 'b',
      veinType: 'trace',
      resourceKey: 'titanium',
      remainingAmount: 250,
      initialAmount: 250,
    },
  ],
  assignments: [
    assignment('own', {
      id: 'trip',
      purpose: 'mining_return',
      groupSize: 2,
      departedAt: new Date(hour).toISOString(),
      arrivesAt: new Date(2 * hour).toISOString(),
      cargoManifest: { carbon: 150, titanium: 50 },
    }),
    assignment('rival', {
      id: 'rival-trip',
      purpose: 'mine',
      groupSize: 2,
      departedAt: new Date(0).toISOString(),
      arrivesAt: new Date(hour).toISOString(),
      cargoManifest: null,
    }),
  ],
};

test('station income splits own yield by vein share and lists own cargo only', () => {
  const income = summarizeStationIncome('own', [asteroid]);

  assert.equal(income.perHour.carbon?.toFixed(2), '50.00');
  assert.equal(income.perHour.titanium?.toFixed(2), '16.67');
  assert.deepEqual(income.inTransit, { carbon: 150, titanium: 50 });
  assert.deepEqual(
    income.arrivals.map((arrival) => arrival.tripId),
    ['trip']
  );
  const [source] = income.sources;
  assert.ok(source);
  assert.equal(source.miners, 2);
  // Depletion counts every station working the asteroid: 1000 / (2 × 66.7/h) = 7.5 h.
  assert.equal(source.depletionHours?.toFixed(2), '7.50');
});

test('unknown composition still counts toward income', () => {
  const income = summarizeStationIncome('own', [{ ...asteroid, scanned: false, veins: [] }]);

  assert.deepEqual(income.perHour, {});
  const [source] = income.sources;
  assert.ok(source);
  assert.equal(source.byResource.length, 0);
  assert.equal(source.depletionHours, null);
});
