/**
 * Wraps `run` so a call made while the previous run is still pending is
 * skipped instead of starting a second one. A failed run is reported through
 * `onError` and never throws, so a periodic job keeps going.
 */
export function createNonOverlappingRunner(
  run: () => Promise<unknown>,
  onError: (err: unknown) => void = (err) => console.error(err),
): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      onError(err);
    } finally {
      running = false;
    }
  };
}

/**
 * Runs `run` every `intervalMs`, never two at once. The timer does not keep
 * the process alive. Returns a function that stops it.
 */
export function startNonOverlappingInterval(
  run: () => Promise<unknown>,
  intervalMs: number,
): () => void {
  const tick = createNonOverlappingRunner(run);
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
