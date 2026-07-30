import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectName = `orions-frontier-playtest-${process.pid}-${randomUUID().slice(0, 8)}`;
const composeArgs = ['compose', '-p', projectName, '-f', 'compose.playtest.yaml'];
const artifactsDirectory = resolve(process.cwd(), 'artifacts/playtests');
await mkdir(artifactsDirectory, { recursive: true });

let runner;
let exitCode = 1;
try {
  runner = spawn(
    'docker',
    [...composeArgs, 'run', '--build', '--rm', 'playtest-runner', ...process.argv.slice(2)],
    { cwd: process.cwd(), stdio: 'inherit' }
  );
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => runner?.kill(signal));
  }
  exitCode = await new Promise((resolveExit, reject) => {
    runner.once('error', reject);
    runner.once('exit', (code, signal) => {
      resolveExit(code ?? (signal === 'SIGINT' ? 130 : 1));
    });
  });
} finally {
  const cleanup = spawnSync('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  if (cleanup.status !== 0 && exitCode === 0) exitCode = cleanup.status ?? 1;
}

process.exitCode = exitCode;
