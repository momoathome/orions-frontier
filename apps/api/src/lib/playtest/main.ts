import { closeDb } from '../db/index.js';
import { createSeededExecutionContext } from '../game-execution-context.js';
import { bootstrapPlaytestWorld } from './bootstrap.js';
import { loadPlaytestConfig } from './config.js';
import { runPlaytestPopulationSmoke } from './population-smoke.js';
import { PlaytestRunFailure, runPlaytest } from './runner.js';
import type { PlaytestConfig } from './config.js';
import { PlaytestInvariantError, writePartialInvariantReport } from './invariants.js';
import { createPlaytestReport } from './report-schema.js';
import { writePlaytestReport } from './report-writer.js';
import { playtestConsoleSummary } from './console-summary.js';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

async function runCompatibilitySmoke(populationSmoke: boolean): Promise<void> {
  const seed = argument('--seed', 'playtest-bootstrap-smoke');
  const virtualStart = new Date(argument('--start', '2030-01-01T00:00:00.000Z'));
  if (!Number.isFinite(virtualStart.getTime())) throw new Error('Invalid --start timestamp');
  const context = createSeededExecutionContext({ now: virtualStart, seed, worldSeed: seed });
  const bootstrap = await bootstrapPlaytestWorld({ seed, virtualStart }, context);
  console.log(`PLAYTEST_BOOTSTRAP_RESULT=${JSON.stringify(bootstrap)}`);
  if (populationSmoke) {
    const population = await runPlaytestPopulationSmoke(context);
    console.log(`PLAYTEST_POPULATION_RESULT=${JSON.stringify(population)}`);
  }
}

let effectiveConfig: PlaytestConfig | null = null;
try {
  if (process.argv.includes('--bootstrap-only') || process.argv.includes('--population-smoke')) {
    await runCompatibilitySmoke(process.argv.includes('--population-smoke'));
  } else {
    const config = await loadPlaytestConfig(process.argv.slice(2));
    effectiveConfig = config;
    const context = createSeededExecutionContext({
      now: config.virtualStart,
      seed: config.seed,
      worldSeed: config.seed,
    });
    const result = await runPlaytest(config, context, {
      onProgress: (progress) => {
        console.log(
          `PLAYTEST_PROGRESS=${JSON.stringify({
            now: progress.now.toISOString(),
            end: progress.end.toISOString(),
            ticks: progress.ticks,
            syntheticPlayers: progress.syntheticPlayers,
            controlledPopulation: progress.controlledPopulation,
          })}`
        );
      },
    });
    const report = createPlaytestReport({ status: 'success', config, result });
    const reportPath = await writePlaytestReport(config, report);
    console.log(playtestConsoleSummary(report, reportPath));
    console.log(`PLAYTEST_REPORT=${JSON.stringify({ status: report.status, reportPath })}`);
    console.log(
      `PLAYTEST_RUN_RESULT=${JSON.stringify({
        seed: config.seed,
        virtualStart: result.virtualStart.toISOString(),
        virtualEnd: result.virtualEnd.toISOString(),
        ticks: result.ticks,
        snapshots: result.snapshots,
        syntheticPlayers: result.population
          .snapshot()
          .filter((member) => member.populationKind === 'synthetic_player').length,
        controlledPopulation: result.population.snapshot().length,
        botDecisions: result.collector.summary().botDecisions,
        completionEvents: result.collector.summary().completionEvents,
        warnings: result.warnings.length,
        worldChecksum: result.bootstrap.checksum,
        realDurationMs: Math.round(result.realDurationMs),
      })}`
    );
  }
} catch (error) {
  if (effectiveConfig && error instanceof PlaytestRunFailure) {
    const invariantFindings =
      error.cause instanceof PlaytestInvariantError ? error.cause.findings : [];
    const report = createPlaytestReport({
      status: 'failed',
      config: effectiveConfig,
      result: error.partialResult,
      invariantFindings,
    });
    const reportPath = await writePlaytestReport(effectiveConfig, report);
    console.error(playtestConsoleSummary(report, reportPath));
    console.error(
      `PLAYTEST_INVARIANT_FAILURE=${JSON.stringify({
        codes: invariantFindings.map((finding) => finding.code),
        reportPath,
      })}`
    );
  } else if (effectiveConfig && error instanceof PlaytestInvariantError) {
    const reportPath = await writePartialInvariantReport(effectiveConfig, error);
    console.error(
      `PLAYTEST_INVARIANT_FAILURE=${JSON.stringify({
        codes: error.findings.map((finding) => finding.code),
        reportPath,
      })}`
    );
  }
  throw error;
} finally {
  await closeDb();
}
