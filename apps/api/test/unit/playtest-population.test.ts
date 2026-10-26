import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BotProfile } from '../../src/lib/db/schema/bot-controllers.js';
import {
  PlaytestPopulationRegistry,
  type PlaytestPopulationMember,
} from '../../src/lib/playtest/population.js';
import {
  EVEN_PROFILE_WEIGHTS,
  selectWeightedProfile,
  validateProfileWeights,
} from '../../src/lib/playtest/profile-distribution.js';

function member(overrides: Partial<PlaytestPopulationMember> = {}): PlaytestPopulationMember {
  return {
    alias: 'player-001',
    userId: 'user-1',
    initialStationId: 'station-1',
    profile: 'industrialist',
    joinedAt: new Date('2030-01-01T00:00:00.000Z'),
    populationKind: 'synthetic_player',
    ...overrides,
  };
}

test('weighted profile selection is reproducible and honors exclusive weights', () => {
  const selected = Array.from({ length: 20 }, (_, index) =>
    selectWeightedProfile('stable-seed', index, EVEN_PROFILE_WEIGHTS)
  );
  assert.deepEqual(
    selected,
    Array.from({ length: 20 }, (_, index) =>
      selectWeightedProfile('stable-seed', index, EVEN_PROFILE_WEIGHTS)
    )
  );
  assert.ok(new Set(selected).size > 1);

  const exclusive: Record<BotProfile, number> = {
    industrialist: 0,
    pioneer: 0,
    technocrat: 7,
    warlord: 0,
  };
  assert.equal(selectWeightedProfile('stable-seed', 0, exclusive), 'technocrat');
  assert.equal(selectWeightedProfile('stable-seed', 99, exclusive), 'technocrat');
});

test('profile weights reject negative, non-finite and empty distributions', () => {
  assert.throws(() => {
    validateProfileWeights({ ...EVEN_PROFILE_WEIGHTS, warlord: -1 });
  }, /non-negative/);
  assert.throws(() => {
    validateProfileWeights({ ...EVEN_PROFILE_WEIGHTS, pioneer: Number.NaN });
  }, /non-negative/);
  assert.throws(() => {
    validateProfileWeights({
      industrialist: 0,
      pioneer: 0,
      technocrat: 0,
      warlord: 0,
    });
  }, /positive/);
});

test('population registry is stable, defensive and rejects conflicting identities', () => {
  const registry = new PlaytestPopulationRegistry();
  registry.register(member({ alias: 'player-002', userId: 'user-2' }));
  registry.register(member());
  registry.register(member());

  assert.deepEqual(
    registry.snapshot().map((entry) => entry.alias),
    ['player-001', 'player-002']
  );
  const snapshot = registry.snapshot();
  snapshot[0]!.joinedAt.setUTCFullYear(2040);
  assert.equal(
    registry.getByAlias('player-001')?.joinedAt.toISOString(),
    '2030-01-01T00:00:00.000Z'
  );
  assert.equal(registry.getByUserId('user-2')?.alias, 'player-002');

  assert.throws(() => {
    registry.register(member({ userId: 'different-user' }));
  }, /registry collision/);
  assert.throws(() => {
    registry.register(member({ alias: 'different-alias' }));
  }, /registry collision/);
});
