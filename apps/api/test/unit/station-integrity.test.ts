import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateColonizationCost,
  coarseIntegrity,
  currentIntegrity,
  integrityWaveDamage,
} from '@orions-frontier/game-config';

test('wave damage grows with surviving bombers and caps at 35', () => {
  assert.deepEqual([0, 1, 4, 10].map(integrityWaveDamage), [0, 20, 35, 35]);
});

test('integrity regenerates one point per full hour up to 100', () => {
  const updatedAt = new Date('2030-01-01T00:00:00Z');
  const at = (hours: number) => new Date(updatedAt.getTime() + hours * 3_600_000);
  assert.equal(currentIntegrity(40, updatedAt, at(2.9)), 42);
  assert.equal(currentIntegrity(95, updatedAt, at(24)), 100);
  assert.equal(currentIntegrity(40, updatedAt, at(-1)), 40);
});

test('outsiders see integrity in four coarse tiers', () => {
  assert.deepEqual([0, 1, 25, 26, 51, 76, 100].map(coarseIntegrity), [0, 25, 25, 50, 75, 100, 100]);
});

test('colonization cost rises by half for every further station', () => {
  assert.deepEqual(calculateColonizationCost(1), {
    carbon: 8_000,
    titanium: 8_000,
    hydrogenium: 3_000,
  });
  assert.deepEqual(calculateColonizationCost(2), {
    carbon: 12_000,
    titanium: 12_000,
    hydrogenium: 4_500,
  });
});
