/**
 * Explicit performance budget for the perf gate.
 *
 * Before this existed the gate printed timings and asserted only on pixels,
 * export size, and console errors, so no frame-rate regression could ever fail
 * it. Numbers without thresholds are a report, not a gate.
 *
 * Thresholds are deliberately loose. CI runners are shared, virtualised, and
 * software-rendered, so absolute frame times vary far more than they do locally.
 * The budget is set to catch a real regression — a dropped frame rate or a burst
 * of long tasks — rather than to police a few milliseconds of runner noise. See
 * `docs/perf-budget.md` for the measured baseline these came from and the
 * procedure for changing them.
 */

/** Minimum exported PNG size; a blank or failed export is far smaller. */
const MIN_EXPORT_BYTES = 10_000

/**
 * Per-scenario budgets.
 *
 * `minFps` guards sustained throughput. `maxOver33Ms` guards visible stutter:
 * a frame over 33.3ms is a dropped frame at 30fps, and a handful of those is
 * worse for perceived smoothness than a slightly lower average.
 *
 * Scrub scenarios are allowed more slack because they intentionally drive the
 * timeline as fast as the browser will accept, so they are expected to be the
 * heaviest paths.
 */
const SCENARIO_BUDGETS = {
  idle: { minFps: 20, maxOver33Ms: 12 },
  playback: { minFps: 15, maxOver33Ms: 30 },
  orbit: { minFps: 15, maxOver33Ms: 30 },
  syntheticScrub: { minFps: 12, maxOver33Ms: 45 },
  directStoreScrub: { minFps: 12, maxOver33Ms: 45 },
  pointerScrub: { minFps: 12, maxOver33Ms: 45 },
}

/**
 * Budgets for a software-rendered host with no GPU, such as a GitHub runner.
 *
 * The first real CI run took 1071s where a local run takes ~20s, because
 * SwiftShader rasterises every frame on the CPU. Absolute frame times there
 * describe the renderer, not the application, so holding them to the
 * GPU-accelerated numbers would produce a permanently red gate that says nothing
 * about the code.
 *
 * These limits still catch a catastrophic regression — a scene that stops
 * rendering, or a change that makes frame cost grow without bound — while
 * tolerating the two-orders-of-magnitude slowdown that software rendering
 * inherently costs.
 */
const SOFTWARE_RENDERING_BUDGETS = {
  idle: { minFps: 2, maxOver33Ms: 2_000 },
  playback: { minFps: 1, maxOver33Ms: 3_000 },
  orbit: { minFps: 1, maxOver33Ms: 3_000 },
  syntheticScrub: { minFps: 1, maxOver33Ms: 4_000 },
  directStoreScrub: { minFps: 1, maxOver33Ms: 4_000 },
  pointerScrub: { minFps: 1, maxOver33Ms: 4_000 },
}

const DEFAULT_HOST_PROFILE = {
  id: 'gpu-strict',
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1.5,
  quality: undefined,
  orbitSteps: 90,
  pointerSteps: 120,
  scenarioTimeoutMs: 15_000,
  exportTimeoutMs: 10_000,
}

const SOFTWARE_RENDERING_HOST_PROFILE = {
  id: 'software-rendering-ci',
  viewport: { width: 960, height: 640 },
  deviceScaleFactor: 1,
  quality: 'low',
  orbitSteps: 30,
  pointerSteps: 40,
  scenarioTimeoutMs: 180_000,
  exportTimeoutMs: 60_000,
}

/**
 * Picks the budget for the current host.
 *
 * `PERF_SOFTWARE_RENDERING=1` selects the relaxed set explicitly. CI sets it,
 * because a hosted runner has no GPU; a developer machine keeps the strict
 * budget so a genuine regression is still caught where the numbers are
 * meaningful.
 */
export function budgetsForHost(env = process.env) {
  return env.PERF_SOFTWARE_RENDERING === '1' ? SOFTWARE_RENDERING_BUDGETS : SCENARIO_BUDGETS
}

export function profileForHost(env = process.env) {
  return env.PERF_SOFTWARE_RENDERING === '1' ? SOFTWARE_RENDERING_HOST_PROFILE : DEFAULT_HOST_PROFILE
}

export const PERF_BUDGET = {
  minExportBytes: MIN_EXPORT_BYTES,
  scenarios: SCENARIO_BUDGETS,
  softwareRenderingScenarios: SOFTWARE_RENDERING_BUDGETS,
}

/**
 * Collects every budget violation rather than throwing on the first.
 *
 * A single reported failure would hide the others and turn diagnosis into a
 * sequence of CI runs.
 */
export function collectBudgetViolations(measurements, budgets = budgetsForHost()) {
  const violations = []
  for (const [scenario, budget] of Object.entries(budgets)) {
    const measurement = measurements[scenario]
    if (!measurement) {
      violations.push(`${scenario}: missing measurement`)
      continue
    }
    if (typeof measurement.fps !== 'number' || !Number.isFinite(measurement.fps)) {
      violations.push(`${scenario}: fps is not a finite number (${String(measurement.fps)})`)
    } else if (measurement.fps < budget.minFps) {
      violations.push(`${scenario}: ${measurement.fps}fps below minimum ${budget.minFps}fps`)
    }
    if (typeof measurement.over33Ms === 'number' && measurement.over33Ms > budget.maxOver33Ms) {
      violations.push(`${scenario}: ${measurement.over33Ms} frames over 33.3ms exceeds ${budget.maxOver33Ms}`)
    }
  }
  return violations
}

export function assertWithinBudget(measurements, budgets = budgetsForHost()) {
  const violations = collectBudgetViolations(measurements, budgets)
  if (!violations.length) {
    console.log('perf budget ok')
    return
  }
  throw new Error(`性能预算未达标：\n  ${violations.join('\n  ')}`)
}
