/**
 * Coalesces a burst of calls into one trailing call after `delayMs` of quiet.
 * Realtime events arrive in bursts (one per settled trip), one reload per burst is enough.
 */
export function debounced(fn: () => unknown, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const call = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void fn();
    }, delayMs);
  };
  call.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return call;
}
