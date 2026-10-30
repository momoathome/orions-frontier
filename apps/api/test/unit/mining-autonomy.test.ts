import assert from 'node:assert/strict';
import { test } from 'node:test';
import { largestResource, selectMiningTarget } from '../../src/services/mining/autonomy.js';

const station = { x: 0, y: 0 };
const targets = [
  { id: 'b-far-rich', x: 900, y: 0, remainingByResource: { carbon: 900 }, remainingAmount: 900 },
  { id: 'a-near-carbon', x: 100, y: 0, remainingByResource: { carbon: 50 }, remainingAmount: 50 },
  { id: 'c-titanium', x: 50, y: 0, remainingByResource: { titanium: 10 }, remainingAmount: 10 },
];

test('rerouting keeps the resource and picks the nearest asteroid that still has it', () => {
  assert.equal(selectMiningTarget(station, targets, 'carbon', () => 0)?.id, 'a-near-carbon');
  assert.equal(
    selectMiningTarget(station, targets, 'astatine', () => 0),
    null
  );
});

test('the fleet picks the best delivery per hour, ties go to the nearer asteroid', () => {
  const byRemaining = (_distance: number, remaining: number) => remaining;
  assert.equal(selectMiningTarget(station, targets, null, byRemaining)?.id, 'b-far-rich');
  assert.equal(selectMiningTarget(station, targets, null, () => 1)?.id, 'c-titanium');
});

test('largestResource names the biggest cargo share', () => {
  assert.equal(largestResource({ carbon: 3, titanium: 7 }), 'titanium');
  assert.equal(largestResource({}), null);
});
