import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '@orions-frontier/shared';
import { parseChunkRange } from '../../src/services/world/world.js';

test('chunk ranges must be integer, ordered, and bounded', () => {
  assert.deepEqual(
    parseChunkRange({ minChunkX: '-1', maxChunkX: '2', minChunkY: '3', maxChunkY: '4' }, 3),
    { minChunkX: -1, maxChunkX: 2, minChunkY: 3, maxChunkY: 4 }
  );

  for (const query of [
    { minChunkX: '', maxChunkX: '1', minChunkY: '0', maxChunkY: '1' },
    { minChunkX: '0.5', maxChunkX: '1', minChunkY: '0', maxChunkY: '1' },
    { minChunkX: '2', maxChunkX: '1', minChunkY: '0', maxChunkY: '1' },
    { minChunkX: '0', maxChunkX: '4', minChunkY: '0', maxChunkY: '1' },
    // Within the span but far outside any world, where Postgres integers would overflow.
    { minChunkX: '1e10', maxChunkX: '1e10', minChunkY: '0', maxChunkY: '1' },
  ]) {
    assert.throws(() => parseChunkRange(query, 3), AppError);
  }
});
