import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import process from 'node:process';

const commonArgs = [
  '--start',
  '2030-01-01T00:00:00.000Z',
  '--step-seconds',
  '60',
  '--join-interval-minutes',
  '60',
  '--population-limit',
  '2',
  '--snapshot-interval-minutes',
  '30',
];

function reportFromOutput(output, marker) {
  const expression = new RegExp(`${marker}=(\\{[^\\n]+\\})`);
  const match = expression.exec(output);
  if (!match) throw new Error(`${marker} is missing`);
  const result = JSON.parse(match[1]);
  const hostPath = resolve('artifacts/playtests', basename(result.reportPath));
  return JSON.parse(readFileSync(hostPath, 'utf8'));
}

function run(seed, durationHours, environment = {}, expectSuccess = true, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [
      'scripts/run-playtest.mjs',
      '--seed',
      seed,
      '--duration-hours',
      String(durationHours),
      ...commonArgs,
      ...extraArgs,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYTEST_INJECT_INVARIANT: '',
        PLAYTEST_INJECT_WARNING: '',
        ...environment,
      },
    }
  );
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (expectSuccess && result.status !== 0) {
    process.stdout.write(output);
    throw new Error(`Playtest ${seed} failed unexpectedly`);
  }
  if (!expectSuccess && result.status === 0) {
    process.stdout.write(output);
    throw new Error(`Playtest ${seed} was expected to fail`);
  }
  assert.match(output, /Network .* Removed/, 'disposable Docker network must be removed');
  return {
    output,
    status: result.status,
    report: reportFromOutput(
      output,
      expectSuccess ? 'PLAYTEST_REPORT' : 'PLAYTEST_INVARIANT_FAILURE'
    ),
  };
}

function normalized(report) {
  const copy = JSON.parse(JSON.stringify(report));
  delete copy.operations.realDurationMs;
  delete copy.operations.ticksPerSecond;
  return copy;
}

function resourceTotal(resources) {
  return Object.values(resources).reduce((sum, amount) => sum + amount, 0);
}

const compose = readFileSync('compose.playtest.yaml', 'utf8');
assert.doesNotMatch(compose, /^\s+ports:/m);
assert.match(compose, /internal: true/);
assert.doesNotMatch(compose, /apps\/api\/src\/index|npm run dev|fastify/i);

const smoke = run('e2e-smoke', 6).report;
assert.equal(smoke.status, 'success');
assert.equal(
  smoke.population.filter((member) => member.populationKind === 'synthetic_player').length,
  2
);
assert.equal(
  smoke.population.filter((member) => member.populationKind === 'resident_bot').length,
  2
);
assert.ok(resourceTotal(smoke.metrics.run.economy.deliveredResources) > 0);
assert.ok(
  (smoke.collector.eventCounts.building_completed ?? 0) +
    (smoke.collector.eventCounts.defense_completed ?? 0) +
    (smoke.collector.eventCounts.research_completed ?? 0) >
    0
);
assert.ok(
  Object.values(smoke.metrics.run.goals).some((goal) => goal.switches > 0),
  'smoke run must include a goal switch'
);
assert.ok(smoke.operations.realDurationMs > 0);
assert.ok(smoke.operations.ticksPerSecond > 0);

// One run per mechanic with only that profile joining proves bots reach it through the normal economy.
const profiles = ['industrialist', 'pioneer', 'technocrat', 'warlord'];
const scenarios = [
  {
    name: 'research',
    profile: 'technocrat',
    events: ['research_completed'],
    milestone: 'firstResearch',
  },
  {
    name: 'build',
    profile: 'industrialist',
    events: ['building_completed', 'spacecraft_completed'],
    milestone: 'stableInitialStation',
  },
  {
    name: 'exploration',
    profile: 'pioneer',
    events: ['world_mission_completed'],
    milestone: 'firstExpedition',
  },
].map((scenario) => {
  const weights = profiles.flatMap((profile) => [
    `--profile-${profile}`,
    profile === scenario.profile ? '1' : '0',
  ]);
  const report = run(`e2e-scenario-${scenario.name}`, 6, {}, true, weights).report;
  assert.equal(report.status, 'success');
  for (const event of scenario.events) {
    assert.ok(
      (report.collector.eventCounts[event] ?? 0) > 0,
      `${scenario.name}: ${event} expected`
    );
  }
  assert.ok(
    (report.metrics.run.milestonesReached[scenario.milestone] ?? 0) > 0,
    `${scenario.name}: ${scenario.milestone} expected`
  );
  return report;
});

const repeatA = run('e2e-repeatable', 0.25).report;
const repeatB = run('e2e-repeatable', 0.25).report;
assert.deepEqual(normalized(repeatB), normalized(repeatA));
const different = run('e2e-different', 0.25).report;
assert.notEqual(different.worldChecksum, repeatA.worldChecksum);

const warning = run('e2e-warning', 0.1, { PLAYTEST_INJECT_WARNING: '1' }).report;
assert.equal(warning.status, 'success');
assert.ok(warning.warnings.length > 0);
assert.equal(warning.invariantFindings.length, 0);

const failed = run(
  'e2e-invariant-failure',
  0.1,
  { PLAYTEST_INJECT_INVARIANT: 'negative-resource' },
  false
).report;
assert.equal(failed.status, 'failed');
assert.ok(failed.invariantFindings.some((finding) => finding.code === 'negative_resource'));

for (const report of [smoke, ...scenarios, repeatA, repeatB, different, warning, failed]) {
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(
    serialized,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
  );
  assert.doesNotMatch(serialized, /postgres(?:ql)?:\/\/|password_hash|jwt_secret/i);
}

process.stdout.write(
  `Playtest E2E passed: ${smoke.operations.ticks} smoke ticks, ` +
    `${smoke.operations.ticksPerSecond.toFixed(1)} ticks/s\n`
);
