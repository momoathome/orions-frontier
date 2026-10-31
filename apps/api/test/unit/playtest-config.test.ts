import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { loadPlaytestConfig, validatePlaytestConfig } from '../../src/tools/playtest/config.js';

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

test('playtest config applies explicit, bounded defaults', () => {
  const config = validatePlaytestConfig({});
  assert.equal(config.seed, 'playtest-standard');
  assert.equal(config.virtualStart.toISOString(), '2030-01-01T00:00:00.000Z');
  assert.equal(config.durationMs, 24 * 3_600_000);
  assert.equal(config.stepMs, 60_000);
  assert.equal(config.joinIntervalMs, 15 * 60_000);
  assert.equal(config.populationLimit, 12);
  assert.equal(config.snapshotIntervalMs, 15 * 60_000);
  assert.equal(config.outputDirectory, resolve('artifacts/playtests'));
});

test('CLI values override JSON while unspecified profile weights remain intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orion-playtest-config-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'config.json');
  await writeFile(
    path,
    JSON.stringify({
      seed: 'from-file',
      durationHours: 4,
      populationLimit: 8,
      profileWeights: {
        industrialist: 4,
        pioneer: 3,
        technocrat: 2,
        warlord: 1,
      },
    })
  );

  const config = await loadPlaytestConfig([
    '--config',
    path,
    '--seed',
    'from-cli',
    '--duration-hours',
    '2',
    '--profile-technocrat',
    '9',
  ]);
  assert.equal(config.seed, 'from-cli');
  assert.equal(config.durationMs, 2 * 3_600_000);
  assert.equal(config.populationLimit, 8);
  assert.deepEqual(config.profileWeights, {
    industrialist: 4,
    pioneer: 3,
    technocrat: 9,
    warlord: 1,
  });
});

test('playtest config rejects invalid time, weights, limits and excessive tick counts', () => {
  assert.throws(() => validatePlaytestConfig({ virtualStart: 'tomorrow' }), /ISO timestamp/);
  assert.throws(() => validatePlaytestConfig({ stepSeconds: 61 }), /too_big|<=60|60/);
  assert.throws(() => validatePlaytestConfig({ durationHours: 0 }), /too_small|>0/);
  assert.throws(() => validatePlaytestConfig({ populationLimit: 10_001 }), /too_big|10000/);
  assert.throws(
    () =>
      validatePlaytestConfig({
        profileWeights: {
          industrialist: 0,
          pioneer: 0,
          technocrat: 0,
          warlord: 0,
        },
      }),
    /profile weight/i
  );
  assert.throws(
    () =>
      validatePlaytestConfig({
        profileWeights: { industrialist: 1, pioneer: -1, technocrat: 0, warlord: Number.NaN },
      }),
    /too_small|>=0|expected number/
  );
  assert.throws(
    () => validatePlaytestConfig({ durationHours: 365 * 24, stepSeconds: 1 }),
    /31536000 ticks/
  );
});

test('playtest CLI rejects unknown flags and missing or non-finite values', async () => {
  await assert.rejects(loadPlaytestConfig(['--unknown', 'value']), /Unknown playtest option/);
  await assert.rejects(loadPlaytestConfig(['--duration-hours']), /requires a value/);
  await assert.rejects(loadPlaytestConfig(['--duration-hours', 'NaN']), /finite number/);
});
