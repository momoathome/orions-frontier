import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMiningTripPhase } from '@orions-frontier/shared';

test('mining trips expose outbound, mining and returning phases from their timestamps', () => {
  assert.equal(
    getMiningTripPhase({ purpose: 'mine', departedAt: 1_000, arrivesAt: 2_000 }, 1_500),
    'outbound'
  );
  assert.equal(
    getMiningTripPhase({ purpose: 'mining_return', departedAt: 3_000, arrivesAt: 4_000 }, 2_500),
    'mining'
  );
  assert.equal(
    getMiningTripPhase({ purpose: 'mining_return', departedAt: 3_000, arrivesAt: 4_000 }, 3_500),
    'returning'
  );
  assert.equal(
    getMiningTripPhase({ purpose: 'mining_return', departedAt: 3_000, arrivesAt: 4_000 }, 4_000),
    null
  );
});
