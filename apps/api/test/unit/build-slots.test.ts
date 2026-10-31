import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planBuildSlots } from '../../src/services/station/spacecraft.js';

const line = (amount: number, buildTime = 10) => ({
  order: { spacecraftKey: 'mole', amount },
  def: { buildTime },
});

test('a new order goes to the slot that frees first and builds its ships one after another', () => {
  const now = 1_000_000;
  const busy = [
    { slot: 0, endsAt: new Date(now + 50_000) },
    { slot: 1, endsAt: new Date(now - 5_000) }, // already free: starts now, not in the past
    { slot: 5, endsAt: new Date(now + 1) }, // a slot the shipyard no longer has
  ];
  const plan = planBuildSlots(now, 2, busy, [line(3), line(1, 7)], 0.5);
  assert.deepEqual(
    plan.map(({ slot, stepMs, nextAt, endsAt }) => [
      slot,
      stepMs,
      nextAt.getTime() - now,
      endsAt.getTime() - now,
    ]),
    [
      [1, 5_000, 5_000, 15_000], // 3 ships of 5 s in the free slot
      [1, 4_000, 19_000, 19_000], // 3.5 s rounds up to 4 s; slot 1 at 15 s beats slot 0 at 50 s
    ]
  );
});
