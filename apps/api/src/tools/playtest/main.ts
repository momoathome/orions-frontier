import { closeDb } from '../../lib/db/index.js';
import { createSeededExecutionContext } from '../../lib/game-execution-context.js';
import { loadPlaytestConfig } from './config.js';
import { PlaytestRunFailure, runPlaytest } from './runner.js';
import type { PlaytestConfig } from './config.js';
import { PlaytestInvariantError } from './invariants.js';
import { createPlaytestReport } from './report-schema.js';
import { writePlaytestReport } from './report-writer.js';
import { playtestConsoleSummary } from './console-summary.js';

let effectiveConfig: PlaytestConfig | null = null;
try {
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
  }
  throw error;
} finally {
  await closeDb();
}
