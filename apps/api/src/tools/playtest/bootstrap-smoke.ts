import { closeDb } from '../../lib/db/index.js';
import { createSeededExecutionContext } from '../../lib/game-execution-context.js';
import { bootstrapPlaytestWorld } from './bootstrap.js';
import { runPlaytestPopulationSmoke } from './population-smoke.js';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const seed = argument('--seed', 'playtest-bootstrap-smoke');
const virtualStart = new Date(argument('--start', '2030-01-01T00:00:00.000Z'));
if (!Number.isFinite(virtualStart.getTime())) throw new Error('Invalid --start timestamp');
const context = createSeededExecutionContext({ now: virtualStart, seed, worldSeed: seed });

try {
  const result = await bootstrapPlaytestWorld({ seed, virtualStart }, context);
  console.log(`PLAYTEST_BOOTSTRAP_RESULT=${JSON.stringify(result)}`);
  if (process.argv.includes('--population-smoke')) {
    const population = await runPlaytestPopulationSmoke(context);
    console.log(`PLAYTEST_POPULATION_RESULT=${JSON.stringify(population)}`);
  }
} finally {
  await closeDb();
}
