import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import process from 'node:process';

const defaults = {
  config: 'configs/playtest/baseline-72h.json',
  seeds: ['baseline-alpha', 'baseline-beta', 'baseline-gamma'],
};

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

const config = option('--config') ?? defaults.config;
const seeds = (option('--seeds') ?? defaults.seeds.join(','))
  .split(',')
  .map((seed) => seed.trim())
  .filter(Boolean);
if (seeds.length < 1) throw new Error('--seeds requires at least one non-empty seed');

async function runSeed(seed) {
  const child = spawn(
    process.execPath,
    ['scripts/run-playtest.mjs', '--config', config, '--seed', seed],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
  }
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`Baseline seed ${seed} failed with exit code ${exitCode}`);
  const marker = /PLAYTEST_REPORT=(\{[^\n]+\})/.exec(output);
  if (!marker) throw new Error(`Baseline seed ${seed} did not publish a report`);
  // The report is written inside the container; the same file lies in the bind-mounted folder.
  return join('artifacts/playtests', basename(JSON.parse(marker[1]).reportPath));
}

const reports = [];
for (const seed of seeds) {
  process.stdout.write(`\n=== Baseline seed ${seed} ===\n`);
  reports.push({ seed, reportPath: await runSeed(seed) });
}

process.stdout.write(
  `PLAYTEST_BASELINE_RESULT=${JSON.stringify({
    config,
    seeds,
    reports,
  })}\n`
);
