import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCostShortfall } from '@orions-frontier/shared';

test('cost shortfall names missing resources and waits for the slowest income', () => {
  const costs = [
    { resourceKey: 'carbon', amount: 230 },
    { resourceKey: 'titanium', amount: 150 },
  ];

  assert.deepEqual(getCostShortfall(costs, { carbon: 300, titanium: 200 }, {}), {
    missing: [],
    hoursUntilAffordable: 0,
  });

  const short = getCostShortfall(
    costs,
    { carbon: 80, titanium: 100 },
    { carbon: 300, titanium: 25 }
  );
  assert.deepEqual(short.missing, [
    { resourceKey: 'carbon', amount: 150 },
    { resourceKey: 'titanium', amount: 50 },
  ]);
  assert.equal(short.hoursUntilAffordable, 2);

  assert.equal(
    getCostShortfall(costs, { carbon: 0, titanium: 150 }, {}).hoursUntilAffordable,
    Infinity
  );
});
