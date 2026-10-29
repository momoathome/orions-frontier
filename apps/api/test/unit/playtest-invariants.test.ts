import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { validatePlaytestConfig } from '../../src/tools/playtest/config.js';
import {
  PlaytestInvariantError,
  writePartialInvariantReport,
} from '../../src/tools/playtest/invariants.js';

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

test('invariant failure reports are valid, atomic public JSON artifacts', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'orion-invariant-report-'));
  temporaryDirectories.push(outputDirectory);
  const config = validatePlaytestConfig({
    seed: 'failure-report',
    outputDirectory,
    durationHours: 2,
  });
  const error = new PlaytestInvariantError([
    {
      code: 'negative_resource',
      virtualTime: '2030-01-01T01:00:00.000Z',
      affectedAliases: ['player-001/station-001', 'player-001'],
      values: { amount: -1, resourceKey: 'carbon' },
    },
  ]);

  const path = await writePartialInvariantReport(config, error);
  const report = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(report.schemaVersion, 'playtest-partial-v1');
  assert.equal(report.status, 'failed');
  assert.equal(report.seed, 'failure-report');
  assert.equal(report.invariantFindings[0].code, 'negative_resource');
  assert.equal(report.effectiveConfig.durationMs, 2 * 3_600_000);
  assert.doesNotMatch(JSON.stringify(report), /DATABASE_URL|password|postgresql:/i);
  assert.doesNotMatch(path, /\.tmp$/);
});
