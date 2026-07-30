import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRealtimeExecutionContext,
  createSeededExecutionContext,
  resolveGameExecutionContext,
} from '../../src/lib/game-execution-context.js';
import { WORLD_CONFIG } from '../../src/lib/world-config.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('seeded execution contexts produce the same namespace-sensitive UUID sequence', () => {
  const options = {
    now: new Date('2030-01-01T00:00:00.000Z'),
    seed: 'same-seed',
  };
  const first = createSeededExecutionContext(options);
  const second = createSeededExecutionContext(options);

  const firstIds = [first.nextId('station'), first.nextId('trip'), first.nextId('station')];
  const secondIds = [second.nextId('station'), second.nextId('trip'), second.nextId('station')];

  assert.deepEqual(firstIds, secondIds);
  assert.equal(new Set(firstIds).size, firstIds.length);
  assert.ok(firstIds.every((id) => UUID_PATTERN.test(id)));
});

test('seeded execution contexts produce different sequences for seeds and namespaces', () => {
  const now = new Date('2030-01-01T00:00:00.000Z');
  const first = createSeededExecutionContext({ now, seed: 'first-seed' });
  const second = createSeededExecutionContext({ now, seed: 'second-seed' });
  const station = createSeededExecutionContext({ now, seed: 'first-seed' });
  const trip = createSeededExecutionContext({ now, seed: 'first-seed' });

  assert.notEqual(first.nextId('station'), second.nextId('station'));
  assert.notEqual(station.nextId('station'), trip.nextId('trip'));
});

test('at replaces only time and shares the deterministic ID sequence', () => {
  const context = createSeededExecutionContext({
    now: new Date('2030-01-01T00:00:00.000Z'),
    seed: 'timeline',
    worldSeed: 'world-alpha',
  });
  const expected = createSeededExecutionContext({
    now: new Date('2030-01-01T00:00:00.000Z'),
    seed: 'timeline',
    worldSeed: 'world-alpha',
  });

  assert.equal(context.nextId('station'), expected.nextId('station'));
  const later = context.at(new Date('2030-01-02T12:00:00.000Z'));
  assert.equal(later.now.toISOString(), '2030-01-02T12:00:00.000Z');
  assert.equal(later.worldSeed, 'world-alpha');
  assert.equal(later.nextId('trip'), expected.nextId('trip'));
});

test('realtime context keeps production defaults and returns random UUIDs', () => {
  const now = new Date('2026-07-30T10:00:00.000Z');
  const context = createRealtimeExecutionContext(now);
  const first = context.nextId('station');
  const second = context.nextId('station');

  assert.equal(context.now.toISOString(), now.toISOString());
  assert.equal(context.worldSeed, WORLD_CONFIG.WORLD_SEED);
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test('execution contexts reject invalid seeds, times and namespaces', () => {
  assert.throws(
    () => createSeededExecutionContext({ now: new Date('invalid'), seed: 'seed' }),
    /valid start time/
  );
  assert.throws(
    () =>
      createSeededExecutionContext({
        now: new Date('2030-01-01T00:00:00.000Z'),
        seed: '',
      }),
    /non-empty seed/
  );

  const context = createRealtimeExecutionContext();
  assert.throws(() => context.nextId('  '), /namespace/);
});

test('context resolution ignores callback indices and other unrelated values', () => {
  const context = resolveGameExecutionContext(0);
  assert.equal(typeof context.at, 'function');
  assert.equal(typeof context.nextId, 'function');
});
