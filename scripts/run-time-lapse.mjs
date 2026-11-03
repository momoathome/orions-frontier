import { spawn, spawnSync } from 'node:child_process';

// A throwaway world beside the dev stack: its own project, database volume and ports.
const scale = process.env.TIME_LAPSE_SCALE ?? '60';
const env = {
  ...process.env,
  TIME_LAPSE_SCALE: scale,
  TIME_LAPSE_STARTED_AT: String(Date.now()),
  POSTGRES_PORT: '54329',
  API_PORT: '3001',
  FRONTEND_PORT: '5174',
};
const composeArgs = [
  'compose',
  '-p',
  'orions-frontier-time-lapse',
  '-f',
  'compose.yaml',
  '-f',
  'compose.time-lapse.yaml',
];

console.log(
  `Time-lapse ${scale}x: open http://localhost:5174/map with ADMIN_EMAIL / ADMIN_PASSWORD from .env. ` +
    `72 game hours take ${Math.round((72 * 60) / Number(scale))} minutes. Ctrl+C deletes the world.`
);

const stack = spawn('docker', [...composeArgs, 'up', '--build'], { stdio: 'inherit', env });
// Compose stops the containers on Ctrl+C itself; stay alive to remove them afterwards.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {});
const exitCode = await new Promise((resolve) => stack.once('exit', (code) => resolve(code ?? 0)));

spawnSync('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans'], {
  stdio: 'inherit',
  env,
});
process.exitCode = exitCode;
