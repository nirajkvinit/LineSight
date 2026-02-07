/**
 * Centralized timer management.
 *
 * Every setTimeout created through this module is tracked in `activeTimers`
 * so the extension can cancel all pending timers on deactivation and avoid
 * firing callbacks after the extension host has torn down.
 */

const activeTimers = new Set<NodeJS.Timeout>();

/** Schedule a tracked timeout. Negative delays are clamped to 0. */
export function scheduleTimeout(callback: () => void, delayMs: number): NodeJS.Timeout {
  const safeDelay = Math.max(0, delayMs);
  const timer = setTimeout(() => {
    activeTimers.delete(timer);
    callback();
  }, safeDelay);
  activeTimers.add(timer);
  return timer;
}

/** Cancel a single tracked timer (safe to call with undefined). */
export function clearTrackedTimer(timer: NodeJS.Timeout | undefined): void {
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  activeTimers.delete(timer);
}

/** Promise-based delay that is also tracked for cleanup. */
export function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    scheduleTimeout(resolve, delayMs);
  });
}

/** Cancel every outstanding tracked timer — called during deactivation. */
export function clearAllTrackedTimers(): void {
  for (const timer of activeTimers) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}
