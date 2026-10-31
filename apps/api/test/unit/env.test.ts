import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from '../../src/lib/env.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/app',
  CORS_ORIGIN: 'https://game.example',
  JWT_SECRET: 'a'.repeat(32),
  WORLD_SEED: 'b'.repeat(16),
};

test('production needs its own world seed', () => {
  assert.throws(() => parseEnv({ ...production, WORLD_SEED: undefined }), /WORLD_SEED/);
});

test('production refuses placeholder and short JWT secrets', () => {
  assert.doesNotThrow(() => parseEnv(production));
  assert.throws(() => parseEnv({ ...production, JWT_SECRET: 'local-development-secret' }));
  assert.throws(() =>
    parseEnv({
      ...production,
      JWT_SECRET: 'change-this-in-production-to-a-secure-random-string',
    })
  );
  assert.throws(() => parseEnv({ ...production, JWT_SECRET: 'a'.repeat(20) }));
  assert.doesNotThrow(() =>
    parseEnv({ ...production, NODE_ENV: 'development', JWT_SECRET: 'local-development-secret' })
  );
});
