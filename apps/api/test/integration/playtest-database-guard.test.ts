import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertPlaytestDatabaseTarget,
  PLAYTEST_DATABASE_HOST,
  PLAYTEST_DATABASE_NAME,
} from '../../src/lib/playtest/database-guard.js';

const validEnvironment = {
  PLAYTEST_MODE: '1',
  PLAYTEST_EXPECTED_HOST: PLAYTEST_DATABASE_HOST,
  PLAYTEST_EXPECTED_DATABASE: PLAYTEST_DATABASE_NAME,
  DATABASE_URL:
    'postgresql://playtest_runner:playtest_only@playtest-postgres:5432/orions_frontier_playtest',
};

test('playtest database guard accepts only the dedicated compose target', () => {
  const target = assertPlaytestDatabaseTarget(validEnvironment);
  assert.equal(target.hostname, PLAYTEST_DATABASE_HOST);
  assert.equal(target.pathname, `/${PLAYTEST_DATABASE_NAME}`);
});

test('playtest database guard rejects development, test and localhost URLs', () => {
  for (const databaseUrl of [
    'postgresql://orionsfrontier:secret@postgres:5432/orionsfrontier',
    'postgresql://test:test@localhost:5432/orions_frontier_playtest',
    'postgresql://test:test@127.0.0.1:5432/orions_frontier_playtest',
  ]) {
    assert.throws(
      () =>
        assertPlaytestDatabaseTarget({
          ...validEnvironment,
          DATABASE_URL: databaseUrl,
        }),
      /guard rejected/
    );
  }
});

test('playtest database guard requires explicit mode and immutable expectations', () => {
  assert.throws(
    () => assertPlaytestDatabaseTarget({ ...validEnvironment, PLAYTEST_MODE: '0' }),
    /PLAYTEST_MODE/
  );
  assert.throws(
    () =>
      assertPlaytestDatabaseTarget({
        ...validEnvironment,
        PLAYTEST_EXPECTED_HOST: 'postgres',
      }),
    /host/
  );
  assert.throws(
    () =>
      assertPlaytestDatabaseTarget({
        ...validEnvironment,
        PLAYTEST_EXPECTED_DATABASE: 'orionsfrontier',
      }),
    /database/
  );
});
