/**
 * Coalesces a burst of calls into one trailing call after `delayMs` of quiet.
 * Realtime events arrive in bursts (one per settled trip), one reload per burst is enough.
 * A steady stream of calls still fires at least every `maxWaitMs`, so it never starves.
 */
export function debounced(fn: () => unknown, delayMs: number, maxWaitMs = 5_000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let burstStartedAt: number | null = null;
  const call = () => {
    if (timer) clearTimeout(timer);
    burstStartedAt ??= Date.now();
    const untilMaxWait = burstStartedAt + maxWaitMs - Date.now();
    timer = setTimeout(
      () => {
        timer = null;
        burstStartedAt = null;
        void fn();
      },
      Math.max(0, Math.min(delayMs, untilMaxWait))
    );
  };
  call.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    burstStartedAt = null;
  };
  return call;
}
