import { reactive } from 'vue';

const timeLapseScale = Number(import.meta.env.VITE_TIME_LAPSE_SCALE || 1);
const timeLapseStartedAt = Number(import.meta.env.VITE_TIME_LAPSE_STARTED_AT || 0);

/** Game time in ms; the dev time-lapse runs it faster, like the API's gameNow(). */
export const gameNow = (): number =>
  timeLapseScale === 1
    ? Date.now()
    : timeLapseStartedAt + (Date.now() - timeLapseStartedAt) * timeLapseScale;

/** True in the dev time-lapse (`npm run time-lapse`). */
export const timeLapse = timeLapseScale !== 1;

/** Game clock (ticks while the overview runs) and whether the last API load succeeded. */
export const live = reactive({ now: gameNow(), online: true });

/** Runs a load and records whether the API answered; errors only flip `online`. */
export async function guarded(load: () => Promise<unknown>): Promise<void> {
  try {
    await load();
    live.online = true;
  } catch {
    live.online = false;
  }
}
