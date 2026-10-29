import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { playtestConsoleSummary } from '../../src/tools/playtest/console-summary.js';
import { validatePlaytestConfig } from '../../src/tools/playtest/config.js';
import type { PlaytestMetrics } from '../../src/tools/playtest/metrics.js';
import {
  playtestConfigHash,
  playtestReportSchema,
  publicPlaytestConfig,
  type PlaytestReport,
} from '../../src/tools/playtest/report-schema.js';
import { writePlaytestReport } from '../../src/tools/playtest/report-writer.js';

const temporaryDirectories: string[] = [];

after(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

function report(outputDirectory: string): {
  config: ReturnType<typeof validatePlaytestConfig>;
  report: PlaytestReport;
} {
  const config = validatePlaytestConfig({
    seed: 'report-test',
    durationHours: 2,
    outputDirectory,
  });
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Teil-Fixture: der Report-Writer prüft nur die angegebenen Felder.
  const metrics = {
    bots: [],
    profiles: [{ profile: 'technocrat', milestonesReached: { firstMining: 1 } }],
    run: {
      bots: 0,
      goals: { increase_income: { selections: 1, blocked: 0 } },
      economy: { deliveredResources: { carbon: 8 }, discardedResources: { carbon: 2 } },
      conflict: { attacks: 1 },
    },
    stations: [],
    world: { stations: 0 },
    finalSnapshotAt: '2030-01-01T02:00:00.000Z',
  } as unknown as PlaytestMetrics;
  return {
    config,
    report: {
      schemaVersion: '1.0.0',
      status: 'success',
      configuration: publicPlaytestConfig(config),
      configHash: playtestConfigHash(config),
      virtualStart: '2030-01-01T00:00:00.000Z',
      virtualEnd: '2030-01-01T02:00:00.000Z',
      worldChecksum: 'a'.repeat(64),
      strategy: { name: 'goal_v1', version: '1' },
      population: [],
      metrics,
      invariantFindings: [],
      warnings: [],
      collector: {
        completionEvents: 1,
        duplicateCompletionEvents: 0,
        botDecisions: 2,
        snapshots: 3,
        eventCounts: { mining_delivery_completed: 1 },
        actionCounts: { assign_miner: 1 },
        resultCounts: { success: 1 },
      },
      operations: {
        realDurationMs: 1234.56789123,
        ticks: 121,
        ticksPerSecond: 98.012345678,
        snapshots: 3,
        maximumControlledPopulation: 4,
      },
    },
  };
}

test('report writer validates, rounds and atomically publishes a versioned artifact', async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'orion-playtest-report-'));
  temporaryDirectories.push(outputDirectory);
  const fixture = report(outputDirectory);
  const path = await writePlaytestReport(fixture.config, fixture.report);
  const persisted = JSON.parse(await readFile(path, 'utf8'));

  assert.equal(persisted.schemaVersion, '1.0.0');
  assert.equal(persisted.status, 'success');
  assert.equal(persisted.operations.realDurationMs, 1234.567891);
  assert.equal(persisted.operations.ticksPerSecond, 98.012346);
  assert.match(path, /2030-01-01T00-00-00-000Z-report-test-[0-9a-f]{16}\.json$/);
  assert.ok((await readdir(outputDirectory)).every((entry) => !entry.endsWith('.tmp')));
  assert.doesNotMatch(JSON.stringify(persisted), /postgresql:|password|jwt_secret/i);

  const summary = playtestConsoleSummary(fixture.report, path);
  assert.match(summary, /SUCCESS/);
  assert.match(summary, /technocrat:1/);
  assert.match(summary, /delivered 8, discarded 2/);
  assert.match(summary, /attacks 1/);
});

test('report schema rejects raw UUIDs and non-finite numbers', () => {
  const fixture = report('/tmp/playtest-report-validation');
  const withUuid = structuredClone(fixture.report);
  withUuid.population.push({
    alias: '10000000-0000-4000-8000-000000000001',
    populationKind: 'synthetic_player',
    profile: 'technocrat',
    joinedAt: withUuid.virtualStart,
    initialStationAlias: 'player-001/station-001',
  });
  assert.throws(() => playtestReportSchema.parse(withUuid), /Raw UUIDs/);

  const withNan = structuredClone(fixture.report);
  withNan.operations.ticksPerSecond = Number.NaN;
  assert.throws(() => playtestReportSchema.parse(withNan), /finite|NaN/i);
});
