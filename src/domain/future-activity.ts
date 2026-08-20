/**
 * Single source of truth for "is this activity timestamp in the future?".
 *
 * The activity contract promises that future-dated input is ignored, but the
 * decay formulas clamp age with `Math.max(0, now - occurredAt)`, which silently
 * treats a future event as if it had just happened. That pins a note at maximum
 * heat and leaks into activity elevation, temperature, "recent activity", and
 * reference-gap staleness. Every boundary that consumes activity timestamps
 * must therefore agree on one definition, or the same event gets counted by one
 * path and dropped by another.
 */

/**
 * Timestamps this far past the evaluation time are still accepted.
 *
 * Vault files and imported bundles carry timestamps from other machines, whose
 * clocks routinely disagree by seconds. Treating that ordinary skew as
 * corruption would discard valid recent activity, so tolerate a small window
 * and reject only what cannot be explained by clock drift.
 */
export const ACTIVITY_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000

/**
 * True when `occurredAtMs` is beyond the tolerated skew window.
 *
 * A timestamp exactly equal to the evaluation time is not future, and neither
 * is one exactly at the tolerance boundary; only strictly beyond it counts.
 * Non-finite input is not reported as future because callers already reject
 * unparsable timestamps separately, and conflating the two would hide invalid
 * data behind a future-event warning.
 */
export function isFutureActivityTimestamp(
  occurredAtMs: number,
  nowMs: number,
  toleranceMs: number = ACTIVITY_CLOCK_SKEW_TOLERANCE_MS,
): boolean {
  if (!Number.isFinite(occurredAtMs) || !Number.isFinite(nowMs)) return false
  return occurredAtMs > nowMs + Math.max(0, toleranceMs)
}

/** Convenience wrapper for string timestamps that keeps unparsable values non-future. */
export function isFutureActivityTimestampString(
  occurredAt: string,
  nowMs: number,
  toleranceMs: number = ACTIVITY_CLOCK_SKEW_TOLERANCE_MS,
): boolean {
  return isFutureActivityTimestamp(Date.parse(occurredAt), nowMs, toleranceMs)
}
