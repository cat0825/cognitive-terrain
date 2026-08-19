/**
 * Shared evaluation-time helper for derived views.
 *
 * Derived claims (reference gaps, exploration suggestions, activity elevation,
 * learning progression) are all a function of the project *and* the moment they
 * were evaluated. Freezing that moment once per page load makes any activity the
 * user records afterwards invisible: `retainLatestActivity` and the staleness
 * checks treat a later timestamp as future and skip it, so a note the user just
 * reviewed keeps being reported as stale for the rest of the session.
 *
 * Deriving the evaluation time from `project.updatedAt` instead ties it to the
 * data it evaluates. Every mutation that records activity also bumps
 * `updatedAt`, so the value advances exactly when there is new activity to
 * account for, and stays stable otherwise. That keeps memoised views from
 * recomputing on unrelated renders while still being reproducible: the same
 * project yields the same evaluation time.
 */

/**
 * Evaluation time for a project's derived views.
 *
 * Uses the later of wall-clock now and `project.updatedAt`. A project whose
 * `updatedAt` is ahead of the local clock (imported from a machine with a fast
 * clock, or a fixed clock in tests) must not evaluate to a time before its own
 * activity, or that activity would look future-dated and be discarded.
 */
export function evaluationTimeForProject(updatedAt: string, nowMs: number = Date.now()): number {
  const projectTime = Date.parse(updatedAt)
  return Number.isFinite(projectTime) ? Math.max(nowMs, projectTime) : nowMs
}
