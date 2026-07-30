import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  [
    'scripts/run-playtest.mjs',
    '--seed',
    'runner-integration',
    '--start',
    '2030-01-01T00:00:00.000Z',
    '--duration-hours',
    '2',
    '--step-seconds',
    '60',
    '--join-interval-minutes',
    '60',
    '--population-limit',
    '2',
    '--snapshot-interval-minutes',
    '30',
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }
);
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
if (result.status !== 0) {
  process.stdout.write(output);
  throw new Error('Two-hour playtest runner integration failed');
}
const match = /PLAYTEST_RUN_RESULT=(\{[^\n]+\})/.exec(output);
if (!match) throw new Error('Playtest run result is missing');
const run = JSON.parse(match[1]);

assert.equal(run.virtualStart, '2030-01-01T00:00:00.000Z');
assert.equal(run.virtualEnd, '2030-01-01T02:00:00.000Z');
assert.equal(run.ticks, 121);
assert.equal(run.snapshots, 5);
assert.equal(run.syntheticPlayers, 2);
assert.equal(run.controlledPopulation, 4);
assert.ok(run.botDecisions > 2);
assert.ok(run.completionEvents > 0);
assert.match(run.worldChecksum, /^[0-9a-f]{64}$/);

console.log(
  `Two-hour playtest completed: ${run.botDecisions} bot decisions, ${run.completionEvents} completions`
);
