import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function bootstrap(seed) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/run-playtest.mjs',
      '--bootstrap-only',
      '--seed',
      seed,
      '--start',
      '2030-01-01T00:00:00.000Z',
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
    throw new Error(`Playtest bootstrap failed for seed ${seed}`);
  }
  const match = /PLAYTEST_BOOTSTRAP_RESULT=(\{[^\n]+\})/.exec(output);
  if (!match) throw new Error(`Playtest bootstrap result is missing for seed ${seed}`);
  return JSON.parse(match[1]);
}

const first = bootstrap('bootstrap-repeatable');
const repeated = bootstrap('bootstrap-repeatable');
const different = bootstrap('bootstrap-different');

assert.deepEqual(repeated, first);
assert.notEqual(different.checksum, first.checksum);
assert.equal(first.sectors, 9);
assert.equal(first.spawnSlots, 8);
assert.equal(first.users, 0);
assert.equal(first.stations, 0);
assert.ok(first.asteroids > 0);
assert.ok(first.veins >= first.asteroids);
assert.ok(first.resourceUnits > 0);

console.log(
  `Playtest bootstrap reproducible: ${first.checksum}; different seed: ${different.checksum}`
);
