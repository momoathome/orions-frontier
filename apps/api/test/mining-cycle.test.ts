import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateMiningCycle } from '../src/lib/mining-cycle.js';
import { calcArrivesAt } from '../src/lib/travel.js';

test('uses the same accelerated travel duration for previews and stored arrivals', () => {
  const departedAt = new Date('2026-01-01T00:00:00.000Z');
  const arrivesAt = calcArrivesAt(departedAt, 1600, 60);

  assert.equal(arrivesAt.getTime() - departedAt.getTime(), 20 * 60_000);
});

test('calculates the agreed mining round trip and delivery rate', () => {
  const estimate = calculateMiningCycle({
    distance: 1600,
    speed: 60,
    miningRate: 120,
    cargoCapacity: 100,
    minerCount: 1,
    remainingAmount: 10_000,
  });

  assert.equal(estimate.oneWayTravelHours, 1 / 3);
  assert.equal(estimate.miningHours, 5 / 6);
  assert.equal(estimate.roundTripHours, 1.5);
  assert.ok(Math.abs(estimate.deliveryPerHourPerMiner - 66.666_666_666_666_67) < 1e-10);
  assert.equal(estimate.totalDeliveryPerHour, estimate.deliveryPerHourPerMiner);
  assert.equal(estimate.estimatedDepletionHours, 150);
  assert.equal(estimate.finalBatchAmount, 100);
});

test('additional miners increase total delivery and preserve the final partial batch', () => {
  const estimate = calculateMiningCycle({
    distance: 1600,
    speed: 60,
    miningRate: 120,
    cargoCapacity: 100,
    minerCount: 2,
    remainingAmount: 250,
  });

  assert.ok(Math.abs(estimate.totalDeliveryPerHour - 133.333_333_333_333_34) < 1e-10);
  assert.equal(estimate.finalBatchAmount, 50);
});

test('rejects assignments without miners', () => {
  assert.throws(
    () =>
      calculateMiningCycle({
        distance: 100,
        speed: 60,
        miningRate: 120,
        cargoCapacity: 100,
        minerCount: 0,
        remainingAmount: 1000,
      }),
    /minerCount/
  );
});
