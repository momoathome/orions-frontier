import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv } from '../../src/lib/env.js';
import { DEV_WORLD_SEED, worldSeed } from '../../src/lib/world-config.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/app',
  CORS_ORIGIN: 'https://game.example',
  JWT_SECRET: 'a'.repeat(32),
  WORLD_SEED: 'b'.repeat(16),
};

test('admin account is optional, but needs both values and no placeholder in production', () => {
  const adminPassword = 'c'.repeat(12);
  assert.equal(
    parseEnv({ ...production, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' }).ADMIN_EMAIL,
    undefined
  );
  assert.throws(() => parseEnv({ ...production, ADMIN_EMAIL: 'a@b.de' }), /ADMIN_PASSWORD/);
  assert.throws(() => parseEnv({ ...production, ADMIN_PASSWORD: adminPassword }), /ADMIN_PASSWORD/);
  assert.throws(
    () =>
      parseEnv({
        ...production,
        ADMIN_EMAIL: 'a@b.de',
        ADMIN_PASSWORD: 'change-this-admin-password',
      }),
    /ADMIN_PASSWORD/
  );
  const env = parseEnv({ ...production, ADMIN_EMAIL: 'A@B.de', ADMIN_PASSWORD: adminPassword });
  assert.equal(env.ADMIN_EMAIL, 'a@b.de');
});

test('production needs its own world seed', () => {
  assert.throws(() => parseEnv({ ...production, WORLD_SEED: undefined }), /WORLD_SEED/);
});

test('world seed is read on use, so a later .env load still counts', (t) => {
  const saved = process.env;
  process.env = { ...saved };
  t.after(() => {
    process.env = saved;
  });
  delete process.env['WORLD_SEED'];
  process.env['NODE_ENV'] = 'development';
  assert.equal(worldSeed(), DEV_WORLD_SEED);
  process.env['WORLD_SEED'] = 'c'.repeat(16);
  assert.equal(worldSeed(), 'c'.repeat(16));
  delete process.env['WORLD_SEED'];
  process.env['NODE_ENV'] = 'production';
  assert.throws(() => worldSeed(), /WORLD_SEED/);
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

test('TRUST_PROXY is off by default and takes a flag, a hop count or proxy addresses', () => {
  const trustProxy = (value?: string) =>
    parseEnv({ ...production, TRUST_PROXY: value }).TRUST_PROXY;
  assert.equal(trustProxy(undefined), false);
  assert.equal(trustProxy('false'), false);
  assert.equal(trustProxy('true'), true);
  assert.equal(trustProxy('10.0.0.0/8, 127.0.0.1'), '10.0.0.0/8, 127.0.0.1');
  // One hop: trust the proxy in front of the API, not what reached it before.
  const oneHop = trustProxy('1');
  assert.ok(typeof oneHop === 'function');
  assert.equal(oneHop('10.0.0.1', 0), true);
  assert.equal(oneHop('10.0.0.1', 1), false);
});

test('the time-lapse moves every timestamp ahead, so production refuses it', () => {
  assert.throws(
    () => parseEnv({ ...production, TIME_LAPSE_SCALE: '60', TIME_LAPSE_STARTED_AT: '1' }),
    /TIME_LAPSE_SCALE/
  );
  assert.throws(
    () => parseEnv({ ...production, NODE_ENV: 'development', TIME_LAPSE_SCALE: '60' }),
    /TIME_LAPSE_STARTED_AT/
  );
});
