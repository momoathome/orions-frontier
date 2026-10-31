import { reactive } from 'vue';

/** Game clock (ticks while the overview runs) and whether the last API load succeeded. */
export const live = reactive({ now: Date.now(), online: true });

/** Runs a load and records whether the API answered; errors only flip `online`. */
export async function guarded(load: () => Promise<unknown>): Promise<void> {
  try {
    await load();
    live.online = true;
  } catch {
    live.online = false;
  }
}
