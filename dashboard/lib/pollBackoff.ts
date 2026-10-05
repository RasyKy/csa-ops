// Delay before the next poll run. Pure and import-free.
//
// No failures: baseMs. Otherwise baseMs doubled once per consecutive failure,
// never more than maxMs (base 3000, max 30000 gives 3, 6, 12, 24, 30, 30 ...
// seconds for 0, 1, 2, 3, 4, 5 failures).
export function nextDelay(consecutiveFailures: number, baseMs: number, maxMs: number): number {
  if (!(consecutiveFailures > 0)) return baseMs;
  // 2 ** 40 already dwarfs any sane cap; clamping keeps the math finite.
  const doublings = Math.min(Math.floor(consecutiveFailures), 40);
  return Math.min(maxMs, baseMs * 2 ** doublings);
}
