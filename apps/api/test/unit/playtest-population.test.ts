import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BotProfile } from '../../src/lib/db/schema/bot-controllers.js';
import { PlaytestPopulationRegistry } from '../../src/tools/playtest/population.js';
import {
  EVEN_PROFILE_WEIGHTS,
  selectWeightedProfile,
} from '../../src/tools/playtest/profile-distribution.js';
import { testPopulationMember } from '../helpers/playtest.js';

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

test('population registry is stable, defensive and rejects conflicting identities', () => {
  const registry = new PlaytestPopulationRegistry();
  registry.register(testPopulationMember({ alias: 'player-002', userId: 'user-2' }));
  registry.register(testPopulationMember());
  registry.register(testPopulationMember());

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

  assert.throws(() => {
    registry.register(testPopulationMember({ userId: 'different-user' }));
  }, /registry collision/);
  assert.throws(() => {
    registry.register(testPopulationMember({ alias: 'different-alias' }));
  }, /registry collision/);
});
